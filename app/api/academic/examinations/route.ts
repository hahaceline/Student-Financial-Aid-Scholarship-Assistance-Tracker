import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError, parseJson } from '@/lib/api';

const EXAM_STATUSES = ['PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED', 'CANCELLED'] as const;
const RESULT_STATUSES = ['PENDING', 'PASSED', 'FAILED'] as const;
const PAGE_SIZE = 10;

const scheduleSchema = z.object({
  application_id: z.string().uuid().nullable(),
  applicant_name: z.string().trim().min(1).max(200),
  applicant_number: z.string().trim().min(1).max(64),
  course: z.string().trim().min(1).max(160),
  scheduled_at: z.string().datetime({ offset: true }),
  location: z.string().trim().min(1).max(300),
  examination_type: z.string().trim().min(1).max(120),
  assigned_examiner: z.string().trim().min(1).max(160),
  status: z.enum(EXAM_STATUSES),
  remarks: z.string().trim().max(1000).nullable().optional(),
});

const resultSchema = z.object({
  action: z.literal('result'),
  id: z.string().uuid(),
  score: z.number().min(0).max(100).nullable(),
  passing_score: z.number().min(0).max(100).nullable(),
  result: z.enum(RESULT_STATUSES),
  remarks: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.result === 'PENDING') {
    if (value.score !== null || value.passing_score !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pending results cannot include scores.' });
    }
  } else if (value.score === null || value.passing_score === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter both the examination score and passing score.' });
  } else if ((value.result === 'PASSED') !== (value.score >= value.passing_score)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The result must match the score and passing score.' });
  }
});

const updateSchema = z.union([
  scheduleSchema.extend({ action: z.literal('schedule'), id: z.string().uuid() }),
  resultSchema,
]);

function safeFilter(value: string) {
  return value.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 80);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const search = safeFilter(params.get('search') ?? '');
  const course = safeFilter(params.get('course') ?? '');
  const status = params.get('status') ?? '';
  const date = params.get('date') ?? '';
  if (status && !EXAM_STATUSES.includes(status as (typeof EXAM_STATUSES)[number])) {
    return jsonError('Choose a valid examination status.', 400);
  }
  if (date && !isDate(date)) return jsonError('Choose a valid examination date.', 400);

  const { supabase } = auth.ctx;
  let rowsQuery = supabase.from('academic_examinations')
    .select('id,application_id,applicant_name,applicant_number,course,scheduled_at,location,examination_type,assigned_examiner,status,score,passing_score,result,result_remarks,result_recorded_at,remarks,created_at,updated_at', { count: 'exact' })
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (search) rowsQuery = rowsQuery.or(`applicant_name.ilike.%${search}%,applicant_number.ilike.%${search}%`);
  if (course) rowsQuery = rowsQuery.ilike('course', `%${course}%`);
  if (status) rowsQuery = rowsQuery.eq('status', status);
  if (date) {
    rowsQuery = rowsQuery
      .gte('scheduled_at', `${date}T00:00:00+08:00`)
      .lt('scheduled_at', `${nextDate(date)}T00:00:00+08:00`);
  }

  const [rowsResult, scheduledResult, completedResult, resultsResult, followUpResult, reviewsResult, examAppsResult] = await Promise.all([
    rowsQuery,
    supabase.from('academic_examinations').select('id', { count: 'exact', head: true })
      .not('scheduled_at', 'is', null).neq('status', 'CANCELLED'),
    supabase.from('academic_examinations').select('id', { count: 'exact', head: true })
      .eq('status', 'ATTENDED'),
    supabase.from('academic_examinations').select('id', { count: 'exact', head: true })
      .in('result', ['PASSED', 'FAILED']),
    supabase.from('academic_examinations').select('id', { count: 'exact', head: true })
      .or('status.eq.MISSED,result.eq.FAILED'),
    supabase.from('academic_eligibility_reviews').select('application_id')
      .eq('examination_required', true),
    supabase.from('academic_examinations').select('application_id')
      .not('application_id', 'is', null).limit(1000),
  ]);

  for (const [result, label] of [
    [rowsResult, 'load examination records'],
    [scheduledResult, 'count scheduled examinations'],
    [completedResult, 'count completed examinations'],
    [resultsResult, 'count recorded examination results'],
    [followUpResult, 'count examination follow-ups'],
    [reviewsResult, 'load examination-eligible applications'],
    [examAppsResult, 'load linked examination applications'],
  ] as const) {
    if (result.error) return dbError(result.error, label);
  }

  const applicationIds = [...new Set([
    ...(reviewsResult.data ?? []).map((row) => row.application_id),
    ...(examAppsResult.data ?? []).map((row) => row.application_id).filter((id): id is string => typeof id === 'string'),
  ])];
  const { data: applicationRows, error: applicationsError } = applicationIds.length
    ? await supabase.from('working_scholar_applications')
      .select('id,application_no,student_name,student_number,course,year_level')
      .eq('application_type', 'ACADEMIC').in('id', applicationIds)
      .order('application_date', { ascending: false })
    : { data: [], error: null };
  if (applicationsError) return dbError(applicationsError, 'load eligible Academic applicants');

  const existingApplicationIds = new Set((examAppsResult.data ?? [])
    .map((row) => row.application_id).filter((id): id is string => typeof id === 'string'));

  return NextResponse.json({
    rows: rowsResult.data ?? [],
    total: rowsResult.count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    applications: (applicationRows ?? []).map((application) => ({
      ...application,
      has_examination: existingApplicationIds.has(application.id),
    })),
    stats: {
      scheduled: scheduledResult.count ?? 0,
      completed: completedResult.count ?? 0,
      results: resultsResult.count ?? 0,
      followUp: followUpResult.count ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  const parsed = await parseJson(request, scheduleSchema);
  if (parsed.error) return parsed.error;
  const { data, error } = await auth.ctx.supabase.rpc('manage_entrance_examination', {
    p_examination_id: null,
    p_application_id: parsed.data.application_id,
    p_applicant_name: parsed.data.applicant_name,
    p_applicant_number: parsed.data.applicant_number,
    p_course: parsed.data.course,
    p_scheduled_at: parsed.data.scheduled_at,
    p_location: parsed.data.location,
    p_examination_type: parsed.data.examination_type,
    p_assigned_examiner: parsed.data.assigned_examiner,
    p_status: parsed.data.status,
    p_remarks: parsed.data.remarks ?? null,
  });
  if (error) return dbError(error, 'create entrance examination');
  return NextResponse.json({ examination: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  const parsed = await parseJson(request, updateSchema);
  if (parsed.error) return parsed.error;

  if (parsed.data.action === 'result') {
    const { data, error } = await auth.ctx.supabase.rpc('record_entrance_examination_result', {
      p_examination_id: parsed.data.id,
      p_score: parsed.data.score,
      p_passing_score: parsed.data.passing_score,
      p_result: parsed.data.result,
      p_remarks: parsed.data.remarks ?? null,
    });
    if (error) return dbError(error, 'record entrance examination result');
    return NextResponse.json({ examination: data });
  }

  const { data, error } = await auth.ctx.supabase.rpc('manage_entrance_examination', {
    p_examination_id: parsed.data.id,
    p_application_id: parsed.data.application_id,
    p_applicant_name: parsed.data.applicant_name,
    p_applicant_number: parsed.data.applicant_number,
    p_course: parsed.data.course,
    p_scheduled_at: parsed.data.scheduled_at,
    p_location: parsed.data.location,
    p_examination_type: parsed.data.examination_type,
    p_assigned_examiner: parsed.data.assigned_examiner,
    p_status: parsed.data.status,
    p_remarks: parsed.data.remarks ?? null,
  });
  if (error) return dbError(error, 'update entrance examination');
  return NextResponse.json({ examination: data });
}
