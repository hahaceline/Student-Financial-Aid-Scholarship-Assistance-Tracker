import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseWith } from '@/lib/api';
import { applicationUpdateSchema, statusChangeSchema } from '@/lib/validations/applications';
import { isUuid } from '@/lib/utils';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN', 'ACADEMIC_ADMIN', 'STUDENT']);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Application not found.', 404);
  const { supabase } = auth.ctx;

  const [app, docs, followUps, history] = await Promise.all([
    supabase.from('working_scholar_applications').select('*').eq('id', id).maybeSingle(),
    supabase.from('application_documents').select('*').eq('application_id', id).order('created_at'),
    supabase.from('follow_ups').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('application_status_history').select('*').eq('application_id', id).order('created_at', { ascending: false }),
  ]);
  if (app.error) return dbError(app.error);
  if (!app.data) return jsonError('Application not found.', 404);
  if (docs.error) return dbError(docs.error);
  if (followUps.error) return dbError(followUps.error);
  if (history.error) return dbError(history.error);
  const { data: requirements, error: requirementsError } = await supabase
    .from('application_requirement_snapshots')
    .select('id:requirement_id,name,description,is_required,accepted_mime_types,max_file_size_bytes,sort_order,application_type')
    .eq('application_id', id).order('sort_order');
  if (requirementsError) return dbError(requirementsError);
  let activeScholar = false;
  if (auth.ctx.profile.role === 'STUDENT' && app.data.application_type === 'WORKING_SCHOLAR') {
    const { data, error } = await supabase
      .from('working_scholars')
      .select('participation_status')
      .eq('application_id', id)
      .maybeSingle();
    if (error) return dbError(error);
    activeScholar = data?.participation_status === 'ACTIVE';
  }
  let academic = null;
  if (auth.ctx.profile.role === 'STUDENT' && app.data.application_type === 'ACADEMIC') {
    const [assessment, examination] = await Promise.all([
      supabase.from('academic_eligibility_reviews').select('result,gwa,remarks,reviewed_at').eq('application_id', id).maybeSingle(),
      supabase.from('academic_examinations').select('scheduled_at,location,status,remarks').eq('application_id', id).maybeSingle(),
    ]);
    if (assessment.error) return dbError(assessment.error);
    if (examination.error) return dbError(examination.error);
    const { data: scholarship, error: scholarshipError } = await supabase.from('academic_scholarships')
      .select('id,status,started_at,ended_at,end_reason').eq('application_id', id).maybeSingle();
    if (scholarshipError) return dbError(scholarshipError);
    let gradeReviews: unknown[] = [];
    let enrollments: unknown[] = [];
    let award: unknown = null;
    if (scholarship) {
      const [gradesResult, enrollmentResult, awardResult] = await Promise.all([
        supabase.from('academic_grade_reviews').select('academic_year,semester,gwa,status,remarks')
          .eq('scholarship_id', scholarship.id).order('academic_year', { ascending: false }),
        supabase.from('academic_enrollment_verifications').select('academic_year,semester,status,remarks')
          .eq('scholarship_id', scholarship.id).order('academic_year', { ascending: false }),
        supabase.from('academic_notices_of_award').select('id,terms_version,terms_text,issued_at,acknowledged_at')
          .eq('scholarship_id', scholarship.id).maybeSingle(),
      ]);
      if (gradesResult.error) return dbError(gradesResult.error);
      if (enrollmentResult.error) return dbError(enrollmentResult.error);
      if (awardResult.error) return dbError(awardResult.error);
      gradeReviews = gradesResult.data ?? [];
      enrollments = enrollmentResult.data ?? [];
      award = awardResult.data;
    }
    academic = {
      assessment: assessment.data,
      examination: examination.data,
      scholarship,
      gradeReviews,
      enrollments,
      award,
    };
  }
  return NextResponse.json({ application: app.data, requirements: requirements ?? [], documents: docs.data ?? [], followUps: followUps.data ?? [], history: history.data ?? [], activeScholar, academic });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireApiRole(['WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN']);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Application not found.', 404);

  let raw: Record<string, unknown>;
  try { raw = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const { action, ...body } = raw;

  if (action === 'change_status') {
    const parsed = parseWith(body, statusChangeSchema);
    if (parsed.error) return parsed.error;
    // Transition rules, denial reason and history are enforced atomically inside the database function.
    const { data, error } = await auth.ctx.supabase.rpc('change_application_status', {
      p_application_id: id, p_new_status: parsed.data.status, p_reason: parsed.data.reason ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ application: data });
  }

  if (action === 'update_fields') {
    const parsed = parseWith(body, applicationUpdateSchema);
    if (parsed.error) return parsed.error;
    const changes = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    const { data, error } = await auth.ctx.supabase
      .from('working_scholar_applications').update(changes).eq('id', id).select('id').maybeSingle();
    if (error) return dbError(error);
    if (!data) return jsonError('Application not found.', 404);
    return NextResponse.json({ ok: true });
  }

  return jsonError('Unknown action.', 400);
}
