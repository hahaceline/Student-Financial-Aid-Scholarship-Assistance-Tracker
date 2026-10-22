import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const auth = await requireApiRole(['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN']);
  if (auth.error) return auth.error;
  const { id } = await params;
  const { data: existingProgram, error: existingProgramError } = await auth.ctx.supabase
    .from('scholarship_programs')
    .select('application_type')
    .eq('id', id)
    .maybeSingle();
  if (existingProgramError) return dbError(existingProgramError);
  if (!existingProgram) return jsonError('Scholarship program not found.', 404);
  if (auth.ctx.profile.role === 'WORKING_SCHOLAR_ADMIN' && existingProgram.application_type !== 'WORKING_SCHOLAR') {
    return jsonError('Working Scholar Admin can only manage Working Scholar programs.', 403);
  }
  if (auth.ctx.profile.role === 'ACADEMIC_ADMIN' && existingProgram.application_type !== 'ACADEMIC') {
    return jsonError('Academic Admin can only manage Academic Scholarship programs.', 403);
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 3 || body.name.length > 120) return jsonError('Program name must be 3 to 120 characters.', 400);
    changes.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 2000) return jsonError('Program description is too long.', 400);
    changes.description = body.description.trim();
  }
  if (body.eligibility !== undefined) {
    if (typeof body.eligibility !== 'string' || body.eligibility.trim().length < 2 || body.eligibility.length > 2000) return jsonError('Provide valid eligibility criteria.', 400);
    changes.eligibility = body.eligibility.trim();
  }
  if (body.requirements !== undefined) {
    if (!Array.isArray(body.requirements) || body.requirements.length > 30
      || !body.requirements.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 200)) {
      return jsonError('Provide up to 30 valid requirement names.', 400);
    }
    changes.requirements = body.requirements.map((item) => (item as string).trim());
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return jsonError('Program active state must be a boolean.', 400);
    if (body.is_active && existingProgram.application_type === 'ACADEMIC') {
      const { count, error: requirementsError } = await auth.ctx.supabase.from('document_requirements')
        .select('id', { count: 'exact', head: true })
        .eq('application_type', 'ACADEMIC').eq('is_required', true).eq('is_active', true)
        .or(`program_id.is.null,program_id.eq.${id}`);
      if (requirementsError) return dbError(requirementsError);
      if (!count) return jsonError('Configure at least one active, required Academic document before opening applications.', 409);
    }
    changes.is_active = body.is_active;
  }
  if (body.max_slots !== undefined) {
    if (body.max_slots !== null
      && (typeof body.max_slots !== 'number' || !Number.isInteger(body.max_slots) || body.max_slots < 0 || body.max_slots > 100000)) {
      return jsonError('Program slots must be a whole number from 0 to 100,000.', 400);
    }
    if (existingProgram.application_type !== 'WORKING_SCHOLAR') {
      return jsonError('Program slot limits are only available for Working Scholar opportunities.', 400);
    }
    changes.max_slots = body.max_slots;
  }
  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !['ACADEMIC', 'WORKING_SCHOLAR', 'SPORTS_ATHLETICS', 'GAD', 'OTHER_INTERNAL'].includes(body.category)) {
      return jsonError('Choose a valid scholarship category.', 400);
    }
    const { data: current, error: currentError } = await auth.ctx.supabase
      .from('scholarship_programs')
      .select('application_type')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return dbError(currentError);
    if (!current) return jsonError('Scholarship program not found.', 404);
    if ((body.category === 'WORKING_SCHOLAR') !== (current.application_type === 'WORKING_SCHOLAR')) {
      return jsonError('The Working Scholar category must match the program’s application type.', 400);
    }
    changes.category = body.category;
  }
  for (const field of ['responsible_office', 'assigned_office'] as const) {
    if (body[field] !== undefined) {
      if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > 150)) {
        return jsonError('Office names must be 150 characters or fewer.', 400);
      }
      changes[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
    }
  }
  if (body.benefits !== undefined) {
    if (body.benefits !== null && (typeof body.benefits !== 'string' || body.benefits.length > 2000)) {
      return jsonError('Benefits must be 2,000 characters or fewer.', 400);
    }
    changes.benefits = typeof body.benefits === 'string' ? body.benefits.trim() || null : null;
  }
  for (const field of ['opens_at', 'deadline'] as const) {
    if (body[field] !== undefined) {
      if (body[field] !== null && (typeof body[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body[field]))) {
        return jsonError('Use a valid application date.', 400);
      }
      changes[field] = body[field];
    }
  }
  const opensAt = typeof changes.opens_at === 'string' ? changes.opens_at
    : typeof body.opens_at === 'string' ? body.opens_at : null;
  const deadline = typeof changes.deadline === 'string' ? changes.deadline
    : typeof body.deadline === 'string' ? body.deadline : null;
  if (opensAt && deadline && opensAt > deadline) return jsonError('The application opening date must be on or before the deadline.', 400);
  if (Object.keys(changes).length === 0) return jsonError('No program changes were provided.', 400);
  const { data, error } = await auth.ctx.supabase.from('scholarship_programs').update(changes)
    .eq('id', id).select('id,name,application_type,description,eligibility,requirements,is_active,category,responsible_office,benefits,opens_at,deadline,assigned_office,max_slots').maybeSingle();
  if (error) return dbError(error);
  if (!data) return jsonError('Scholarship program not found.', 404);
  return NextResponse.json({ program: data });
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const auth = await requireApiRole('SUPER_ADMIN');
  if (auth.error) return auth.error;
  const { id } = await params;
  const { error, count } = await auth.ctx.supabase.from('scholarship_programs').delete({ count: 'exact' }).eq('id', id);
  if (error) return dbError(error);
  if (!count) return jsonError('Scholarship program not found.', 404);
  return NextResponse.json({ ok: true });
}
