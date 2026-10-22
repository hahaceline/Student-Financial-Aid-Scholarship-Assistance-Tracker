import { NextRequest, NextResponse } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';

const SECTIONS = [
  'applications', 'requirements', 'eligibility', 'examinations', 'grade-monitoring',
  'enrollment', 'scholars', 'conflicts', 'feedback', 'reports', 'settings',
] as const;

export async function GET(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  const section = request.nextUrl.searchParams.get('section');
  if (!SECTIONS.includes(section as (typeof SECTIONS)[number])) return jsonError('Unknown Academic workspace section.', 404);
  const { supabase } = auth.ctx;

  if (section === 'settings') {
    const [rules, programs] = await Promise.all([
      supabase.from('academic_scholarship_rules').select('*').eq('id', true).maybeSingle(),
      supabase.from('scholarship_programs').select('id,name,description,eligibility,requirements,is_active,opens_at,deadline,benefits')
        .eq('application_type', 'ACADEMIC').order('name'),
    ]);
    if (rules.error) return dbError(rules.error);
    if (programs.error) return dbError(programs.error);
    return NextResponse.json({ rows: programs.data ?? [], rules: rules.data });
  }

  if (section === 'applications' || section === 'eligibility' || section === 'examinations') {
    const query = supabase.from('working_scholar_applications')
      .select('id,application_no,student_name,student_number,course,year_level,status,application_date,gwa,lowest_subject_grade,academic_year,semester')
      .eq('application_type', 'ACADEMIC').order('application_date', { ascending: false }).limit(250);
    const { data, error } = await query;
    if (error) return dbError(error);
    if (section === 'applications') return NextResponse.json({ rows: data ?? [] });

    const ids = (data ?? []).map((application) => application.id);
    if (ids.length === 0) return NextResponse.json({ rows: [] });
    const table = section === 'eligibility' ? 'academic_eligibility_reviews' : 'academic_examinations';
    const { data: records, error: recordsError } = await supabase.from(table).select('*').in('application_id', ids).order('updated_at', { ascending: false });
    if (recordsError) return dbError(recordsError);
    return NextResponse.json({ rows: records ?? [] });
  }

  if (section === 'requirements') {
    const { data, error } = await supabase.from('document_requirements')
      .select('id,name,description,is_required,is_active,sort_order,program_id')
      .eq('application_type', 'ACADEMIC').order('sort_order').order('name');
    if (error) return dbError(error);
    return NextResponse.json({ rows: data ?? [] });
  }

  if (section === 'grade-monitoring') {
    const { data, error } = await supabase.from('academic_grade_reviews').select('*')
      .order('academic_year', { ascending: false }).order('semester', { ascending: false }).limit(250);
    if (error) return dbError(error);
    const scholarshipIds = [...new Set((data ?? []).map((row) => row.scholarship_id))];
    const { data: scholars, error: scholarError } = scholarshipIds.length
      ? await supabase.from('academic_scholarships').select('id,application_id').in('id', scholarshipIds)
      : { data: [], error: null };
    if (scholarError) return dbError(scholarError);
    const applicationByScholarship = new Map((scholars ?? []).map((row) => [row.id, row.application_id]));
    return NextResponse.json({ rows: (data ?? []).map((row) => ({ ...row, application_id: applicationByScholarship.get(row.scholarship_id) ?? null })) });
  }

  if (section === 'enrollment') {
    const { data, error } = await supabase.from('academic_enrollment_verifications').select('*')
      .order('academic_year', { ascending: false }).order('semester', { ascending: false }).limit(250);
    if (error) return dbError(error);
    const scholarshipIds = [...new Set((data ?? []).map((row) => row.scholarship_id))];
    const { data: scholars, error: scholarError } = scholarshipIds.length
      ? await supabase.from('academic_scholarships').select('id,application_id').in('id', scholarshipIds)
      : { data: [], error: null };
    if (scholarError) return dbError(scholarError);
    const applicationByScholarship = new Map((scholars ?? []).map((row) => [row.id, row.application_id]));
    return NextResponse.json({ rows: (data ?? []).map((row) => ({ ...row, application_id: applicationByScholarship.get(row.scholarship_id) ?? null })) });
  }

  if (section === 'scholars') {
    const { data, error } = await supabase.from('academic_scholarships')
      .select('id,application_id,student_id,status,started_at,ended_at,end_reason,updated_at')
      .order('updated_at', { ascending: false }).limit(250);
    if (error) return dbError(error);
    return NextResponse.json({ rows: data ?? [] });
  }

  if (section === 'conflicts') {
    const { data, error } = await supabase.from('academic_conflict_reviews').select('*')
      .order('created_at', { ascending: false }).limit(250);
    if (error) return dbError(error);
    return NextResponse.json({ rows: data ?? [] });
  }

  if (section === 'feedback') {
    const { data: applications, error: applicationError } = await supabase.from('working_scholar_applications')
      .select('id').eq('application_type', 'ACADEMIC');
    if (applicationError) return dbError(applicationError);
    const applicationIds = (applications ?? []).map((application) => application.id);
    if (applicationIds.length === 0) return NextResponse.json({ rows: [] });
    const { data, error } = await supabase.from('follow_ups').select('*')
      .in('application_id', applicationIds).order('created_at', { ascending: false }).limit(250);
    if (error) return dbError(error);
    return NextResponse.json({ rows: data ?? [] });
  }

  const { data, error } = await supabase.from('working_scholar_applications')
    .select('status,course,year_level,academic_year,semester,application_date')
    .eq('application_type', 'ACADEMIC').order('application_date', { ascending: false }).limit(1000);
  if (error) return dbError(error);
  return NextResponse.json({ rows: data ?? [] });
}
