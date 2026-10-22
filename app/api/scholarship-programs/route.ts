import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';

type ProgramType = 'WORKING_SCHOLAR' | 'FINANCIAL_AID' | 'ACADEMIC';
function isProgramType(value: unknown): value is ProgramType {
  return value === 'WORKING_SCHOLAR' || value === 'FINANCIAL_AID' || value === 'ACADEMIC';
}

export async function GET() {
  const auth = await requireApiRole(['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'STUDENT']);
  if (auth.error) return auth.error;
  const { data, error } = await auth.ctx.supabase
    .from('scholarship_programs')
    .select('id,name,application_type,description,eligibility,requirements,is_active,category,responsible_office,benefits,opens_at,deadline,assigned_office,max_slots')
    .order('name');
  if (error) {
    console.error('Scholarship programs API query failed:', error.code, error.message);
    return dbError(error);
  }
  if (!['STUDENT', 'WORKING_SCHOLAR_ADMIN', 'SUPER_ADMIN'].includes(auth.ctx.profile.role)) {
    return NextResponse.json({ programs: data, workingScholarProgramSlots: [] });
  }
  const { data: slotRows, error: slotsError } = await auth.ctx.supabase.rpc('student_working_scholar_program_slots');
  if (slotsError) {
    console.error('Student Working Scholar program slot summary failed:', slotsError.code, slotsError.message);
    return dbError(slotsError);
  }
  const visiblePrograms = auth.ctx.profile.role === 'STUDENT'
    ? (data ?? []).filter((program) => !/\b(?:CHED|TDPTS?|TDP)\b/i.test(program.name))
    : data;
  return NextResponse.json({ programs: visiblePrograms, workingScholarProgramSlots: slotRows ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(['SUPER_ADMIN', 'ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN']);
  if (auth.error) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const { name, application_type, description, eligibility, requirements, is_active } = body;
  const category = body.category;
  const responsible_office = body.responsible_office;
  const benefits = body.benefits;
  const opens_at = body.opens_at;
  const deadline = body.deadline;
  const assigned_office = body.assigned_office;
  const max_slots = body.max_slots;
  if (typeof name !== 'string' || name.trim().length < 3 || name.length > 120
    || !isProgramType(application_type)
    || typeof description !== 'string' || description.length > 2000
    || typeof eligibility !== 'string' || eligibility.trim().length < 2 || eligibility.length > 2000
    || !Array.isArray(requirements) || requirements.length > 30
    || !requirements.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 200)
    || typeof is_active !== 'boolean'
    || (category !== undefined && !['ACADEMIC', 'WORKING_SCHOLAR', 'SPORTS_ATHLETICS', 'GAD', 'OTHER_INTERNAL'].includes(String(category)))
    || (responsible_office !== undefined && responsible_office !== null && (typeof responsible_office !== 'string' || responsible_office.length > 150))
    || (benefits !== undefined && benefits !== null && (typeof benefits !== 'string' || benefits.length > 2000))
    || (opens_at !== undefined && opens_at !== null && (typeof opens_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(opens_at)))
    || (deadline !== undefined && deadline !== null && (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)))
    || (assigned_office !== undefined && assigned_office !== null && (typeof assigned_office !== 'string' || assigned_office.length > 150))) {
    return jsonError('Provide a valid program name, type, description, eligibility, requirements, and active state.', 400);
  }
  if (max_slots !== undefined && max_slots !== null
    && (typeof max_slots !== 'number' || !Number.isInteger(max_slots) || max_slots < 0 || max_slots > 100000)) {
    return jsonError('Program slots must be a whole number from 0 to 100,000.', 400);
  }
  if (max_slots !== undefined && application_type !== 'WORKING_SCHOLAR') {
    return jsonError('Program slot limits are only available for Working Scholar opportunities.', 400);
  }
  if (opens_at && deadline && opens_at > deadline) return jsonError('The application opening date must be on or before the deadline.', 400);
  if (application_type !== 'WORKING_SCHOLAR' && category === 'WORKING_SCHOLAR') {
    return jsonError('Working Scholar category must use the Working Scholar application type.', 400);
  }
  if (application_type === 'WORKING_SCHOLAR' && category !== undefined && category !== 'WORKING_SCHOLAR' && category !== 'OTHER_INTERNAL') {
    return jsonError('Choose the Working Scholar category for Working Scholar applications.', 400);
  }
  if (auth.ctx.profile.role === 'WORKING_SCHOLAR_ADMIN' && application_type !== 'WORKING_SCHOLAR') {
    return jsonError('Working Scholar Admin can only manage Working Scholar programs.', 403);
  }
  if (auth.ctx.profile.role === 'ACADEMIC_ADMIN' && application_type !== 'ACADEMIC') {
    return jsonError('Academic Admin can only manage Academic Scholarship programs.', 403);
  }
  if (application_type === 'ACADEMIC') {
    if (requirements.length === 0) return jsonError('Add the institution-approved program requirements before creating this opportunity.', 400);
    if (is_active) {
      const { count, error: requirementsError } = await auth.ctx.supabase.from('document_requirements')
        .select('id', { count: 'exact', head: true })
        .eq('application_type', 'ACADEMIC').eq('is_required', true).eq('is_active', true).is('program_id', null);
      if (requirementsError) return dbError(requirementsError);
      if (!count) return jsonError('Configure at least one active, required Academic document before opening applications.', 409);
    }
  }
  const resolvedCategory = application_type === 'WORKING_SCHOLAR' ? 'WORKING_SCHOLAR' : category;
  const { data, error } = await auth.ctx.supabase.from('scholarship_programs').insert({
    name: name.trim(), application_type, description: description.trim(), eligibility: eligibility.trim(),
    requirements: requirements.map((item) => (item as string).trim()), is_active,
    ...(resolvedCategory ? { category: resolvedCategory } : {}),
    ...(typeof responsible_office === 'string' ? { responsible_office: responsible_office.trim() || null } : {}),
    ...(typeof benefits === 'string' ? { benefits: benefits.trim() || null } : {}),
    ...(typeof opens_at === 'string' ? { opens_at } : {}),
    ...(typeof deadline === 'string' ? { deadline } : {}),
    ...(typeof assigned_office === 'string' ? { assigned_office: assigned_office.trim() || null } : {}),
    ...(max_slots !== undefined ? { max_slots } : {}),
    created_by: auth.ctx.profile.id,
  }).select('id,name,application_type,description,eligibility,requirements,is_active,category,responsible_office,benefits,opens_at,deadline,assigned_office,max_slots').single();
  if (error) return dbError(error);
  return NextResponse.json({ program: data }, { status: 201 });
}
