import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';
import { isUuid } from '@/lib/utils';

type Context = { params: Promise<{ id: string }> };

const subjectGradesSchema = z.array(z.object({
  subject: z.string().trim().min(1).max(160),
  grade: z.number().min(0).max(100),
  correction_reason: z.string().trim().max(500).optional(),
})).min(1).max(100);

const assessmentSchema = z.object({
  gwa: z.number().min(0).max(100),
  subject_grades: subjectGradesSchema,
  enrollment_required: z.boolean(),
  enrollment_verified: z.boolean(),
  conflict_reviewed: z.boolean(),
  conflict_exists: z.boolean(),
  conflict_resolution: z.string().trim().max(1000).nullable().optional(),
  examination_required: z.boolean(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(_request: NextRequest, { params }: Context) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Academic application not found.', 404);
  const { supabase } = auth.ctx;
  const { data: application, error: applicationError } = await supabase.from('working_scholar_applications')
    .select('*').eq('id', id).eq('application_type', 'ACADEMIC').maybeSingle();
  if (applicationError) return dbError(applicationError);
  if (!application) return jsonError('Academic application not found.', 404);
  const [documents, requirements, history, followUps, assessment, subjects, examination, conflict, scholarship] = await Promise.all([
    supabase.from('application_documents').select('*').eq('application_id', id).order('created_at'),
    supabase.from('application_requirement_snapshots')
      .select('id:requirement_id,name,description,is_required,accepted_mime_types,max_file_size_bytes,sort_order')
      .eq('application_id', id).order('sort_order'),
    supabase.from('application_status_history').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('follow_ups').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('academic_eligibility_reviews').select('*').eq('application_id', id).maybeSingle(),
    supabase.from('academic_application_subject_grades').select('*').eq('application_id', id).order('created_at', { ascending: false }),
    supabase.from('academic_examinations').select('*').eq('application_id', id).maybeSingle(),
    supabase.from('academic_conflict_reviews').select('*').eq('application_id', id).maybeSingle(),
    supabase.from('academic_scholarships').select('*').eq('application_id', id).maybeSingle(),
  ]);
  for (const result of [documents, requirements, history, followUps, assessment, subjects, examination, conflict, scholarship]) {
    if (result.error) return dbError(result.error);
  }

  let gradeReviews: unknown[] = [];
  let enrollments: unknown[] = [];
  let award: unknown = null;
  if (scholarship.data) {
    const [gradesResult, enrollmentResult, awardResult] = await Promise.all([
      supabase.from('academic_grade_reviews').select('*').eq('scholarship_id', scholarship.data.id)
        .order('academic_year', { ascending: false }).order('semester', { ascending: false }),
      supabase.from('academic_enrollment_verifications').select('*').eq('scholarship_id', scholarship.data.id)
        .order('academic_year', { ascending: false }).order('semester', { ascending: false }),
      supabase.from('academic_notices_of_award').select('*').eq('scholarship_id', scholarship.data.id).maybeSingle(),
    ]);
    if (gradesResult.error) return dbError(gradesResult.error);
    if (enrollmentResult.error) return dbError(enrollmentResult.error);
    if (awardResult.error) return dbError(awardResult.error);
    gradeReviews = gradesResult.data ?? [];
    enrollments = enrollmentResult.data ?? [];
    award = awardResult.data;
  }
  return NextResponse.json({
    application,
    documents: documents.data ?? [],
    requirements: requirements.data ?? [],
    history: history.data ?? [],
    followUps: followUps.data ?? [],
    assessment: assessment.data,
    subjectGrades: subjects.data ?? [],
    examination: examination.data,
    conflict: conflict.data,
    scholarship: scholarship.data,
    gradeReviews,
    enrollments,
    award,
  });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Academic application not found.', 404);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('action' in body) || typeof body.action !== 'string') {
    return jsonError('Choose a valid Academic workflow action.', 400);
  }
  const payload = body as Record<string, unknown>;
  const { supabase } = auth.ctx;
  const action = payload.action;

  if (action === 'assessment') {
    const parsed = assessmentSchema.safeParse(payload);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Provide valid eligibility review data.', 400);
    const { data, error } = await supabase.rpc('save_academic_assessment', {
      p_application_id: id,
      p_gwa: parsed.data.gwa,
      p_subject_grades: parsed.data.subject_grades,
      p_enrollment_required: parsed.data.enrollment_required,
      p_enrollment_verified: parsed.data.enrollment_verified,
      p_conflict_reviewed: parsed.data.conflict_reviewed,
      p_conflict_exists: parsed.data.conflict_exists,
      p_conflict_resolution: parsed.data.conflict_resolution ?? null,
      p_examination_required: parsed.data.examination_required,
      p_remarks: parsed.data.remarks ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ assessment: data });
  }

  if (action === 'status') {
    const parsed = z.object({
      status: z.enum(['UNDER_REVIEW', 'COMPLETED', 'FOR_FOLLOW_UP', 'APPROVED', 'DENIED']),
      reason: z.string().trim().max(2000).nullable().optional(),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Provide a valid application decision.', 400);
    const { data, error } = await supabase.rpc('change_academic_application_status', {
      p_application_id: id, p_new_status: parsed.data.status, p_reason: parsed.data.reason ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ application: data });
  }

  if (action === 'feedback') {
    const parsed = z.object({
      message: z.string().trim().min(3).max(2000),
      requirement_id: z.string().uuid().nullable().optional(),
      document_id: z.string().uuid().nullable().optional(),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Write valid feedback for the student.', 400);
    const { data, error } = await supabase.rpc('create_academic_follow_up', {
      p_application_id: id, p_message: parsed.data.message,
      p_requirement_id: parsed.data.requirement_id ?? null, p_document_id: parsed.data.document_id ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ followUp: data });
  }

  if (action === 'examination') {
    const parsed = z.object({
      scheduled_at: z.string().datetime().nullable().optional(),
      location: z.string().trim().max(300).nullable().optional(),
      status: z.enum(['PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED']),
      reschedule_request: z.string().trim().max(1000).nullable().optional(),
      remarks: z.string().trim().max(1000).nullable().optional(),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Provide valid examination details.', 400);
    const { data, error } = await supabase.rpc('save_academic_examination', {
      p_application_id: id, p_scheduled_at: parsed.data.scheduled_at ?? null,
      p_location: parsed.data.location ?? null, p_status: parsed.data.status,
      p_reschedule_request: parsed.data.reschedule_request ?? null, p_remarks: parsed.data.remarks ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ examination: data });
  }

  if (action === 'grade_review') {
    const parsed = z.object({
      scholarship_id: z.string().uuid(), academic_year: z.string().trim().min(4).max(20),
      semester: z.string().trim().min(1).max(40), gwa: z.number().min(0).max(100),
      subject_grades: subjectGradesSchema, remarks: z.string().trim().max(2000).nullable().optional(),
    }).safeParse(payload);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Provide valid semester grade data.', 400);
    const { data, error } = await supabase.rpc('save_academic_grade_review', {
      p_scholarship_id: parsed.data.scholarship_id, p_academic_year: parsed.data.academic_year,
      p_semester: parsed.data.semester, p_gwa: parsed.data.gwa,
      p_subject_grades: parsed.data.subject_grades, p_remarks: parsed.data.remarks ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ gradeReview: data });
  }

  if (action === 'enrollment') {
    const parsed = z.object({
      scholarship_id: z.string().uuid(), academic_year: z.string().trim().min(4).max(20),
      semester: z.string().trim().min(1).max(40),
      status: z.enum(['ENROLLED', 'NOT_ENROLLED', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'PENDING_VERIFICATION']),
      remarks: z.string().trim().max(1000).nullable().optional(),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Provide valid enrollment verification details.', 400);
    const { data, error } = await supabase.rpc('save_academic_enrollment', {
      p_scholarship_id: parsed.data.scholarship_id, p_academic_year: parsed.data.academic_year,
      p_semester: parsed.data.semester, p_status: parsed.data.status, p_remarks: parsed.data.remarks ?? null,
    });
    if (error) return dbError(error);
    return NextResponse.json({ enrollment: data });
  }

  if (action === 'scholar_status') {
    const parsed = z.object({
      scholarship_id: z.string().uuid(),
      status: z.enum(['ACTIVE', 'FOR_REVIEW', 'REMOVED', 'COMPLETED']),
      reason: z.string().trim().min(1).max(1000),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Provide a valid scholar status and reason.', 400);
    const { data, error } = await supabase.rpc('change_academic_scholarship_status', {
      p_scholarship_id: parsed.data.scholarship_id, p_new_status: parsed.data.status, p_reason: parsed.data.reason,
    });
    if (error) return dbError(error);
    return NextResponse.json({ scholarship: data });
  }

  if (action === 'award') {
    const parsed = z.object({
      scholarship_id: z.string().uuid(), terms_version: z.string().trim().min(1).max(50),
      terms_text: z.string().trim().min(20).max(10000),
    }).safeParse(payload);
    if (!parsed.success) return jsonError('Provide a version and complete award terms.', 400);
    const { data, error } = await supabase.rpc('issue_academic_award', {
      p_scholarship_id: parsed.data.scholarship_id,
      p_terms_version: parsed.data.terms_version,
      p_terms_text: parsed.data.terms_text,
    });
    if (error) return dbError(error);
    return NextResponse.json({ award: data }, { status: 201 });
  }

  return jsonError('Unknown Academic workflow action.', 400);
}
