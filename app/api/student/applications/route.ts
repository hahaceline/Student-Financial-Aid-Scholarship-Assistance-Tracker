import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseJson } from '@/lib/api';
import { studentApplicationSchema } from '@/lib/validations/student';

const EXTERNAL_PROGRAM = /\b(?:CHED|TDPTS?|TDP)\b/i;

async function getActiveInternalApplications(supabase: SupabaseClient, studentId: string) {
  const { data, error } = await supabase
    .from('working_scholar_applications')
    .select('id,program_id,status')
    .eq('student_user_id', studentId)
    .not('status', 'in', '(DENIED,INACTIVE)');
  if (error) return { data: null, error };

  const programIds = [...new Set((data ?? []).map((application) => application.program_id).filter((id): id is string => Boolean(id)))];
  const programsById = new Map<string, string>();
  if (programIds.length > 0) {
    const { data: programs, error: programsError } = await supabase
      .from('scholarship_programs')
      .select('id,name')
      .in('id', programIds);
    if (programsError) return { data: null, error: programsError };
    for (const program of programs ?? []) programsById.set(program.id, program.name);
  }

  const applications = (data ?? []).filter((application) => {
    if (!application.program_id) return true;
    const programName = programsById.get(application.program_id);
    return !programName || !EXTERNAL_PROGRAM.test(programName);
  });
  const programNames = [...new Set(applications
    .map((application) => application.program_id ? programsById.get(application.program_id) : undefined)
    .filter((name): name is string => Boolean(name)))];
  return { data: { applications, programNames }, error: null };
}

export async function GET() {
  const auth = await requireApiRole('STUDENT');
  if (auth.error) return auth.error;
  const { data, error } = await getActiveInternalApplications(auth.ctx.supabase, auth.ctx.profile.id);
  if (error) {
    console.error('Student scholarship conflict query failed:', error.code, error.message);
    return dbError(error, 'GET /api/student/applications: check existing scholarship conflict');
  }
  return NextResponse.json({
    hasActiveConflict: (data?.applications.length ?? 0) > 0,
    activeInternalPrograms: data?.programNames ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole('STUDENT');
  if (auth.error) return auth.error;
  const parsed = await parseJson(request, studentApplicationSchema);
  if (parsed.error) return parsed.error;

  const { data: program, error: programError } = await auth.ctx.supabase
    .from('scholarship_programs')
    .select('id,name,application_type,is_active,category,opens_at,deadline,assigned_office')
    .eq('id', parsed.data.program_id)
    .maybeSingle();
  if (programError) return dbError(programError, 'POST /api/student/applications: load selected program');
  if (!program || !program.is_active) return jsonError('That program is not currently accepting applications.', 400);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (program.opens_at && program.opens_at > today) return jsonError('Applications for this program are not open yet.', 400);
  if (program.deadline && program.deadline < today) return jsonError('The application deadline for this program has passed.', 400);

  const isAcademic = program.application_type === 'ACADEMIC'
    || program.category === 'ACADEMIC'
    || /academic scholarship/i.test(program.name);
  if (isAcademic) {
    const { count, error: requirementsError } = await auth.ctx.supabase.from('document_requirements')
      .select('id', { count: 'exact', head: true })
      .eq('application_type', 'ACADEMIC').eq('is_active', true).eq('is_required', true)
      .or(`program_id.is.null,program_id.eq.${program.id}`);
    if (requirementsError) return dbError(requirementsError, 'POST /api/student/applications: check Academic requirements configuration');
    if (!count) return jsonError('Academic Scholarship applications are not open until the Academic Admin configures required documents.', 409);
    const course = parsed.data.course.toLocaleLowerCase().replace(/[^a-z]/g, '');
    if (!['bsed', 'beed', 'bssw'].includes(course)) {
      return jsonError('Academic Scholarship applications are limited to BS Ed, BE Ed, and BSSW. IT and HM are not eligible.', 422);
    }
    if (parsed.data.year_level !== 1) {
      return jsonError('The Academic Scholarship application is for incoming first-year students. Continuing scholars do not submit a new application each year.', 422);
    }
    if (parsed.data.gwa === undefined || parsed.data.gwa < 90) {
      return jsonError('The Academic Scholarship requires a GWA of 90 or above.', 422);
    }
    if (parsed.data.lowest_grade === undefined || parsed.data.lowest_grade < 85) {
      return jsonError('No subject grade may be below 85 for the Academic Scholarship.', 422);
    }
  }

  if (program.application_type === 'WORKING_SCHOLAR') {
    const { data: slots, error: slotsError } = await auth.ctx.supabase.rpc('student_working_scholar_program_slots');
    if (slotsError) return dbError(slotsError, 'POST /api/student/applications: check Working Scholar slots RPC');
    const slotSummary = Array.isArray(slots)
      ? slots.find((entry: { program_id?: string }) => entry.program_id === program.id)
      : null;
    if (!slotSummary?.configured || !slotSummary.applications_open || slotSummary.remaining <= 0) {
      return jsonError('This Working Scholar opportunity is not currently accepting applications or has no remaining slots.', 400);
    }
  }

  const { data: existing, error: existingError } = await auth.ctx.supabase
    .from('working_scholar_applications')
    .select('id')
    .eq('student_user_id', auth.ctx.profile.id)
    .eq('program_id', program.id)
    .not('status', 'in', '(DENIED,INACTIVE)')
    .limit(1)
    .maybeSingle();
  if (existingError) return dbError(existingError, 'POST /api/student/applications: check duplicate application');
  if (existing) return jsonError('You already have an active application for this program.', 409);

  const { data: activeApplications, error: conflictError } = await getActiveInternalApplications(auth.ctx.supabase, auth.ctx.profile.id);
  if (conflictError) {
    console.error('Student scholarship conflict query failed:', conflictError.code, conflictError.message);
    return dbError(conflictError, 'POST /api/student/applications: check existing scholarship conflict');
  }
  const possibleConflict = (activeApplications?.applications.length ?? 0) > 0;

  const { data, error } = await auth.ctx.supabase.from('working_scholar_applications').insert({
    program_id: program.id,
    application_type: program.application_type,
    student_user_id: auth.ctx.profile.id,
    student_number: null,
    student_name: auth.ctx.profile.full_name,
    email: auth.ctx.profile.email,
    course: parsed.data.course,
    year_level: parsed.data.year_level,
    ...(isAcademic ? { gwa: parsed.data.gwa, lowest_subject_grade: parsed.data.lowest_grade } : {}),
    assigned_office: program.assigned_office
      ?? (program.application_type === 'FINANCIAL_AID' ? 'Finance' : null),
    status: 'PENDING',
    created_by: auth.ctx.profile.id,
  }).select('id,application_no,status,application_date,application_type').single();
  if (error) {
    return dbError(error, 'POST /api/student/applications: insert application and return its reference');
  }
  return NextResponse.json({ application: data, possibleConflict }, { status: 201 });
}
