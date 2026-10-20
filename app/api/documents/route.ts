import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseWith } from '@/lib/api';
import { documentCreateSchema } from '@/lib/validations/applications';
import { ALLOWED_UPLOAD_TYPES, DOCUMENT_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/constants';

// Records a document for an application. A file is optional: you can record a paper document
// received at the office (metadata only) or upload a scan to PRIVATE storage.
export async function POST(request: NextRequest) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'STUDENT']);
  if (auth.error) return auth.error;

  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError('Invalid form data.', 400); }

  const file = form.get('file');
  const hasFile = file instanceof File && file.size > 0;
  const parsed = parseWith(
    {
      application_id: form.get('application_id'),
      requirement_id: form.get('requirement_id') || null,
      file_name: (form.get('file_name') as string | null)?.trim() || (hasFile ? file.name : null),
    },
    documentCreateSchema,
  );
  if (parsed.error) return parsed.error;
  if (!parsed.data.file_name) return jsonError('Enter a document name or choose a file.', 422);

  const isStudent = auth.ctx.profile.role === 'STUDENT';
  if (isStudent && (!hasFile || !parsed.data.requirement_id)) {
    return jsonError('Choose a file for one of the configured requirements.', 422);
  }
  let applicationQuery = auth.ctx.supabase
    .from('working_scholar_applications').select('application_type,status')
    .eq('id', parsed.data.application_id);
  if (isStudent) applicationQuery = applicationQuery.eq('student_user_id', auth.ctx.profile.id);
  const { data: application, error: applicationError } = await applicationQuery.maybeSingle();
  if (applicationError) return dbError(applicationError, 'POST /api/documents: verify application ownership');
  if (!application) return jsonError('Application not found.', 404);
  if (isStudent && application.status !== 'PENDING' && !parsed.data.requirement_id) {
    return jsonError('Only requested requirement corrections can be uploaded after the application enters review.', 403);
  }

  let acceptedTypes: readonly string[] = ALLOWED_UPLOAD_TYPES;
  let maxUploadBytes = MAX_UPLOAD_BYTES;
  if (parsed.data.requirement_id) {
    const requirementQuery = isStudent
      ? auth.ctx.supabase.from('application_requirement_snapshots')
        .select('application_type,accepted_mime_types,max_file_size_bytes')
        .eq('application_id', parsed.data.application_id).eq('requirement_id', parsed.data.requirement_id)
      : auth.ctx.supabase.from('document_requirements')
        .select('application_type,is_active,accepted_mime_types,max_file_size_bytes')
        .eq('id', parsed.data.requirement_id);
    const { data: requirement, error: requirementError } = await requirementQuery.maybeSingle();
    if (requirementError) return dbError(requirementError, 'POST /api/documents: verify application requirement');
    if (!requirement || requirement.application_type !== application.application_type) {
      return jsonError('Choose a requirement for this application.', 422);
    }
    if (isStudent && application.status !== 'PENDING') {
      const { data: correction, error: correctionError } = await auth.ctx.supabase
        .from('application_documents').select('id').eq('application_id', parsed.data.application_id)
        .eq('requirement_id', parsed.data.requirement_id).in('review_status', ['NEEDS_CORRECTION', 'REJECTED'])
        .limit(1).maybeSingle();
      if (correctionError) return dbError(correctionError, 'POST /api/documents: verify requested correction');
      if (!correction) return jsonError('Only requested requirement corrections can be uploaded after the application enters review.', 403);
    }
    acceptedTypes = requirement.accepted_mime_types;
    maxUploadBytes = Math.min(Number(requirement.max_file_size_bytes), MAX_UPLOAD_BYTES);
  }

  let storagePath: string | null = null;
  let fileSha256: string | null = null;
  if (hasFile) {
    if (file.size > maxUploadBytes) return jsonError(`File is too large. The limit is ${Math.floor(maxUploadBytes / 1024 / 1024 * 10) / 10} MB.`, 413);
    if (!acceptedTypes.includes(file.type)) return jsonError('This file type is not accepted for the selected requirement.', 415);
    if (!ALLOWED_UPLOAD_TYPES.some((allowedType) => allowedType === file.type)) {
      return jsonError('This file type is not supported by secure storage.', 415);
    }
    fileSha256 = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
    const { data: duplicate, error: duplicateError } = await auth.ctx.supabase
      .from('application_documents')
      .select('id,requirement_id,review_status')
      .eq('application_id', parsed.data.application_id)
      .eq('file_sha256', fileSha256)
      .maybeSingle();
    if (duplicateError) return dbError(duplicateError, 'POST /api/documents: check duplicate document content');
    if (duplicate) {
      if (duplicate.requirement_id !== parsed.data.requirement_id) {
        return jsonError('This file is already attached to another document requirement. Choose a separate file for each requirement.', 409);
      }
      if (duplicate.review_status === 'PENDING' || duplicate.review_status === 'ACCEPTED') {
        return NextResponse.json({ id: duplicate.id, reused: true });
      }
      return jsonError('This document was not accepted. Choose a corrected file before uploading it again.', 409);
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    storagePath = `${parsed.data.application_id}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await auth.ctx.supabase.storage
      .from(DOCUMENT_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('POST /api/documents: private storage upload denied or failed:', {
        httpStatus: upErr.statusCode,
        message: upErr.message,
      });
      if (upErr.statusCode === '401') return jsonError('Your sign-in session is no longer valid. Please sign in again.', 401);
      if (upErr.statusCode === '403') return jsonError('You do not have permission to upload a document for this application.', 403);
      return jsonError('The file could not be uploaded. Nothing was saved.', 500);
    }
  }

  const { data, error } = await auth.ctx.supabase.from('application_documents').insert({
    application_id: parsed.data.application_id,
    requirement_id: parsed.data.requirement_id,
    file_name: parsed.data.file_name,
    storage_path: storagePath,
    mime_type: hasFile ? file.type : null,
    file_size: hasFile ? file.size : null,
    file_sha256: fileSha256,
    created_by: auth.ctx.profile.id,
  }).select('id').single();
  if (error) {
    if (storagePath) {
      const { error: cleanupError } = await auth.ctx.supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
      if (cleanupError) console.error('Orphaned application document cleanup failed:', cleanupError.message);
    }
    if (error.code === '23505' && error.message.includes('application_documents_application_file_sha256_unique')) {
      return jsonError('This file is already attached to another document requirement. Choose a separate file for each requirement.', 409);
    }
    return dbError(error, 'POST /api/documents: insert document metadata and return its reference');
  }
  return NextResponse.json(data, { status: 201 });
}
