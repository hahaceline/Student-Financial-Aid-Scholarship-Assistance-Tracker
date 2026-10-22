import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseJson } from '@/lib/api';
import { requirementCreateSchema, requirementUpdateSchema } from '@/lib/validations/applications';
import { isUuid } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(['STUDENT', 'WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN', 'ACADEMIC_ADMIN']);
  if (auth.error) return auth.error;
  const type = request.nextUrl.searchParams.get('application_type');
  const programId = request.nextUrl.searchParams.get('program_id');
  if (type !== 'WORKING_SCHOLAR' && type !== 'FINANCIAL_AID' && type !== 'ACADEMIC' && type !== null) {
    return jsonError('Choose a valid application type.', 400);
  }
  if (programId && !isUuid(programId)) return jsonError('Choose a valid scholarship program.', 400);
  if (programId) {
    const { data: program, error: programError } = await auth.ctx.supabase
      .from('scholarship_programs')
      .select('id,application_type,is_active')
      .eq('id', programId)
      .maybeSingle();
    if (programError) {
      console.error('Requirements program lookup failed:', programError.code, programError.message);
      return dbError(programError);
    }
    if (!program || (auth.ctx.profile.role === 'STUDENT' && !program.is_active)) {
      return jsonError('Scholarship program not found.', 404);
    }
    if (type && program.application_type !== type) return jsonError('The application type does not match this scholarship program.', 400);
  }

  let query = auth.ctx.supabase
    .from('document_requirements')
    .select('id,name,description,is_required,is_active,sort_order,accepted_mime_types,max_file_size_bytes,application_type,program_id')
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (type) query = query.eq('application_type', type);
  if (auth.ctx.profile.role === 'STUDENT') {
    if (programId) {
      query.eq('program_id', programId);
    } else {
      query.is('program_id', null);
    }
  } else if (programId) {
    query.eq('program_id', programId);
  }
  const { data, error } = await query;
  if (error) {
    console.error('Requirements API query failed:', error.code, error.message);
    return dbError(error);
  }
  if (auth.ctx.profile.role === 'STUDENT' && programId && data?.length === 0) {
    let generalQuery = auth.ctx.supabase
      .from('document_requirements')
      .select('id,name,description,is_required,is_active,sort_order,accepted_mime_types,max_file_size_bytes,application_type,program_id')
      .eq('is_active', true)
      .is('program_id', null)
      .order('sort_order')
      .order('name');
    if (type) generalQuery = generalQuery.eq('application_type', type);
    const { data: generalRequirements, error: generalError } = await generalQuery;
    if (generalError) return dbError(generalError);
    return NextResponse.json({ requirements: generalRequirements });
  }
  return NextResponse.json({ requirements: data });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN']);
  if (auth.error) return auth.error;
  const parsed = await parseJson(request, requirementCreateSchema);
  if (parsed.error) return parsed.error;
  const applicationType = auth.ctx.profile.role === 'FINANCE_ADMIN' ? 'FINANCIAL_AID' : 'WORKING_SCHOLAR';
  const duplicateQuery = auth.ctx.supabase.from('document_requirements').select('name').eq('application_type', applicationType);
  const { data: names, error: duplicateError } = await duplicateQuery;
  if (duplicateError) return dbError(duplicateError);
  const duplicate = names?.some((row) => row.name.trim().toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase());
  if (duplicate) return jsonError('A requirement with this name already exists. Edit the existing requirement instead.', 409);
  const { data, error } = await auth.ctx.supabase
    .from('document_requirements').insert({
      ...parsed.data,
      application_type: applicationType,
      created_by: auth.ctx.profile.id,
    }).select('id').single();
  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN']);
  if (auth.error) return auth.error;
  const parsed = await parseJson(request, requirementUpdateSchema);
  if (parsed.error) return parsed.error;
  const { id, ...rest } = parsed.data;
  const changes = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return jsonError('Nothing to update.', 422);
  const updatedName = typeof changes.name === 'string' ? changes.name : null;
  if (updatedName !== null) {
    const { data: current, error: currentError } = await auth.ctx.supabase
      .from('document_requirements').select('application_type').eq('id', id).maybeSingle();
    if (currentError) return dbError(currentError);
    if (!current) return jsonError('Requirement not found.', 404);
    const { data: names, error: duplicateError } = await auth.ctx.supabase
      .from('document_requirements').select('id,name').eq('application_type', current.application_type);
    if (duplicateError) return dbError(duplicateError);
    const duplicate = names?.some((row) => row.id !== id && row.name.trim().toLocaleLowerCase() === updatedName.toLocaleLowerCase());
    if (duplicate) return jsonError('A requirement with this name already exists. Choose a different name.', 409);
  }
  const { data, error } = await auth.ctx.supabase.from('document_requirements').update(changes).eq('id', id).select('id').maybeSingle();
  if (error) return dbError(error);
  if (!data) return jsonError('Requirement not found.', 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN']);
  if (auth.error) return auth.error;
  const id = request.nextUrl.searchParams.get('id');
  if (!isUuid(id)) return jsonError('Requirement not found.', 404);
  const { count, error: countError } = await auth.ctx.supabase
    .from('application_documents').select('id', { count: 'exact', head: true }).eq('requirement_id', id);
  if (countError) return dbError(countError);
  const applicationType = auth.ctx.profile.role === 'FINANCE_ADMIN' ? 'FINANCIAL_AID' : 'WORKING_SCHOLAR';
  const { count: applicationCount, error: applicationCountError } = await auth.ctx.supabase
    .from('working_scholar_applications').select('id', { count: 'exact', head: true }).eq('application_type', applicationType);
  if (applicationCountError) return dbError(applicationCountError);
  if (count || applicationCount) return jsonError('This requirement is linked to application history. Deactivate it to preserve the checklist and records.', 409);
  const { error } = await auth.ctx.supabase.from('document_requirements').delete().eq('id', id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
