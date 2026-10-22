import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseJson } from '@/lib/api';
import { documentReviewSchema } from '@/lib/validations/applications';
import { DOCUMENT_BUCKET, SIGNED_URL_SECONDS } from '@/lib/constants';
import { isUuid } from '@/lib/utils';

type Ctx = { params: Promise<{ id: string }> };

// Private files are only reachable through a short-lived signed URL.
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN', 'ACADEMIC_ADMIN', 'STUDENT']);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Document not found.', 404);

  const { data: doc, error } = await auth.ctx.supabase.from('application_documents').select('storage_path,application_id').eq('id', id).maybeSingle();
  if (error) return dbError(error);
  if (!doc) return jsonError('Document not found.', 404);
  if (auth.ctx.profile.role === 'ACADEMIC_ADMIN') {
    const { data: application, error: applicationError } = await auth.ctx.supabase.from('working_scholar_applications')
      .select('application_type').eq('id', doc.application_id).maybeSingle();
    if (applicationError) return dbError(applicationError);
    if (application?.application_type !== 'ACADEMIC') return jsonError('Document not found.', 404);
  }
  if (!doc.storage_path) return jsonError('No file is stored for this document (metadata only).', 404);

  const { data, error: signErr } = await auth.ctx.supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
  if (signErr || !data) return jsonError('Could not create a secure link to the file.', 500);
  return NextResponse.json({ url: data.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN', 'ACADEMIC_ADMIN']);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Document not found.', 404);
  const parsed = await parseJson(request, documentReviewSchema);
  if (parsed.error) return parsed.error;

  if (auth.ctx.profile.role === 'ACADEMIC_ADMIN') {
    const { data, error } = await auth.ctx.supabase.rpc('review_academic_document', {
      p_document_id: id,
      p_review_status: parsed.data.review_status,
      p_review_remarks: parsed.data.review_remarks,
    });
    if (error) return dbError(error);
    if (!data) return jsonError('Document not found.', 404);
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await auth.ctx.supabase.rpc('review_application_document', {
    p_document_id: id,
    p_review_status: parsed.data.review_status,
    p_review_remarks: parsed.data.review_remarks,
    p_reviewed_by: auth.ctx.profile.id,
  });
  if (error) return dbError(error);
  if (!data) return jsonError('Document not found.', 404);
  return NextResponse.json({ ok: true });
}
