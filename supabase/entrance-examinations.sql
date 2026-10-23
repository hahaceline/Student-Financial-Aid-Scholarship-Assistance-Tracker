-- Apply after academic-scholarship-workflow.sql.
-- Repairs the Academic application term columns and expands examination records
-- without changing scholarship eligibility or Working Scholar requirements.
begin;

do $$
begin
  if to_regclass('public.working_scholar_applications') is null
     or to_regclass('public.academic_eligibility_reviews') is null
     or to_regprocedure('public.current_admin_role()') is null then
    raise exception 'Entrance examination prerequisites are missing. Apply the Academic Scholarship workflow migration first.';
  end if;
end $$;

alter table public.working_scholar_applications
  add column if not exists academic_year text,
  add column if not exists semester text;

create table if not exists public.academic_examinations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid unique references public.working_scholar_applications(id) on delete restrict,
  applicant_name text,
  applicant_number text,
  course text,
  scheduled_at timestamptz,
  location text,
  examination_type text not null default 'Entrance Examination',
  assigned_examiner text,
  status text not null default 'PENDING',
  reschedule_request text,
  remarks text,
  score numeric(5,2),
  passing_score numeric(5,2),
  result text not null default 'PENDING',
  result_remarks text,
  result_recorded_at timestamptz,
  managed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.academic_examinations
  add column if not exists applicant_name text,
  add column if not exists applicant_number text,
  add column if not exists course text,
  add column if not exists examination_type text not null default 'Entrance Examination',
  add column if not exists assigned_examiner text,
  add column if not exists score numeric(5,2),
  add column if not exists passing_score numeric(5,2),
  add column if not exists result text not null default 'PENDING',
  add column if not exists result_remarks text,
  add column if not exists result_recorded_at timestamptz;

alter table public.academic_examinations
  alter column application_id drop not null;

update public.academic_examinations e
set applicant_name = coalesce(nullif(btrim(e.applicant_name), ''), a.student_name),
    applicant_number = coalesce(nullif(btrim(e.applicant_number), ''), a.student_number),
    course = coalesce(nullif(btrim(e.course), ''), a.course)
from public.working_scholar_applications a
where e.application_id = a.id
  and (e.applicant_name is null or e.applicant_number is null or e.course is null);

create table if not exists public.academic_examination_history (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.academic_examinations(id) on delete restrict,
  previous_schedule timestamptz,
  new_schedule timestamptz,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.academic_examinations
  drop constraint if exists academic_examinations_status_check;
alter table public.academic_examinations
  add constraint academic_examinations_status_check
  check (status in ('PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED', 'CANCELLED'));

alter table public.academic_examinations
  drop constraint if exists academic_examinations_result_check;
alter table public.academic_examinations
  add constraint academic_examinations_result_check
  check (result in ('PENDING', 'PASSED', 'FAILED'));

alter table public.academic_examinations
  drop constraint if exists academic_examinations_result_scores_check;
alter table public.academic_examinations
  add constraint academic_examinations_result_scores_check
  check (
    (score is null or score between 0 and 100)
    and (passing_score is null or passing_score between 0 and 100)
    and (
      (result = 'PENDING' and score is null and passing_score is null and result_recorded_at is null)
      or (
        result in ('PASSED', 'FAILED')
        and score is not null
        and passing_score is not null
        and result_recorded_at is not null
        and ((result = 'PASSED' and score >= passing_score) or (result = 'FAILED' and score < passing_score))
      )
    )
  );

create index if not exists academic_examinations_schedule_idx
  on public.academic_examinations (scheduled_at, status);
create index if not exists academic_examinations_applicant_number_idx
  on public.academic_examinations (lower(btrim(applicant_number)));

alter table public.academic_examinations enable row level security;
alter table public.academic_examination_history enable row level security;

drop policy if exists academic_scope_select on public.academic_examinations;
drop policy if exists academic_examinations_read on public.academic_examinations;
create policy academic_scope_select on public.academic_examinations
  for select to authenticated
  using (
    public.current_admin_role() = 'ACADEMIC_ADMIN'
    or (
      public.current_admin_role() = 'STUDENT'
      and application_id is not null
      and exists (
        select 1 from public.working_scholar_applications a
        where a.id = application_id and a.student_user_id = auth.uid()
      )
    )
  );

drop policy if exists academic_examinations_write on public.academic_examinations;
drop policy if exists academic_examinations_insert on public.academic_examinations;
drop policy if exists academic_examinations_update on public.academic_examinations;
drop policy if exists academic_exam_history_read on public.academic_examination_history;
drop policy if exists academic_scope_select on public.academic_examination_history;
create policy academic_scope_select on public.academic_examination_history
  for select to authenticated
  using (
    public.current_admin_role() = 'ACADEMIC_ADMIN'
    or (
      public.current_admin_role() = 'STUDENT'
      and exists (
        select 1
        from public.academic_examinations e
        join public.working_scholar_applications a on a.id = e.application_id
        where e.id = examination_id and a.student_user_id = auth.uid()
      )
    )
  );
drop policy if exists academic_exam_history_write on public.academic_examination_history;

revoke insert, update, delete on public.academic_examinations from authenticated;
revoke insert, update, delete on public.academic_examination_history from authenticated;
grant select on public.academic_examinations, public.academic_examination_history to authenticated;

create or replace function public.manage_entrance_examination(
  p_examination_id uuid,
  p_application_id uuid,
  p_applicant_name text,
  p_applicant_number text,
  p_course text,
  p_scheduled_at timestamptz,
  p_location text,
  p_examination_type text,
  p_assigned_examiner text,
  p_status text,
  p_remarks text default null
)
returns public.academic_examinations
language plpgsql security definer set search_path = public as $$
declare
  v_exam public.academic_examinations;
  v_previous_schedule timestamptz;
  v_applicant_name text := nullif(btrim(coalesce(p_applicant_name, '')), '');
  v_applicant_number text := nullif(btrim(coalesce(p_applicant_number, '')), '');
  v_course text := nullif(btrim(coalesce(p_course, '')), '');
  v_examination_type text := nullif(btrim(coalesce(p_examination_type, '')), '');
  v_assigned_examiner text := nullif(btrim(coalesce(p_assigned_examiner, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_application_name text;
  v_application_number text;
  v_application_course text;
begin
  if coalesce(public.current_admin_role(), '') <> 'ACADEMIC_ADMIN' then
    raise exception 'Only an Academic Admin may manage examinations.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED', 'CANCELLED') then
    raise exception 'Choose a valid examination status.';
  end if;
  if p_scheduled_at is null or v_location is null or v_examination_type is null or v_assigned_examiner is null then
    raise exception 'A date, time, venue, examination type, and assigned examiner are required.';
  end if;
  if p_examination_id is not null then
    select * into v_exam from public.academic_examinations
    where id = p_examination_id for update;
    if not found then raise exception 'Examination not found.' using errcode = 'P0002'; end if;
    v_previous_schedule := v_exam.scheduled_at;
  end if;

  if p_application_id is not null then
    select a.student_name, a.student_number, a.course
      into v_application_name, v_application_number, v_application_course
    from public.working_scholar_applications a
    where a.id = p_application_id and a.application_type = 'ACADEMIC';
    if not found then raise exception 'Academic application not found.' using errcode = 'P0002'; end if;
    if not exists (
      select 1 from public.academic_eligibility_reviews r
      where r.application_id = p_application_id and r.examination_required
    ) and not coalesce(v_exam.application_id = p_application_id, false) then
      raise exception 'This application has not been marked as requiring an examination.';
    end if;
    v_applicant_name := v_application_name;
    v_applicant_number := coalesce(nullif(btrim(v_application_number), ''), v_applicant_number);
    v_course := v_application_course;
  end if;
  if v_applicant_name is null or v_applicant_number is null or v_course is null then
    raise exception 'Applicant name, applicant number, and course are required.';
  end if;
  if length(v_applicant_name) > 200 or length(v_applicant_number) > 64
     or length(v_course) > 160 or length(v_examination_type) > 120
     or length(v_assigned_examiner) > 160 or length(v_location) > 300
     or length(coalesce(v_remarks, '')) > 1000 then
    raise exception 'One or more examination fields exceed the allowed length.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    lower(v_applicant_number) || '|' || lower(v_examination_type) || '|' || p_scheduled_at::text, 0
  ));
  if exists (
    select 1 from public.academic_examinations e
    where e.id is distinct from p_examination_id
      and lower(btrim(e.applicant_number)) = lower(v_applicant_number)
      and lower(btrim(e.examination_type)) = lower(v_examination_type)
      and e.scheduled_at = p_scheduled_at
  ) then
    raise exception 'This applicant already has the same examination scheduled at that time.' using errcode = '23505';
  end if;

  if p_examination_id is null then
    insert into public.academic_examinations (
      application_id, applicant_name, applicant_number, course, scheduled_at, location,
      examination_type, assigned_examiner, status, remarks, managed_by, updated_at
    ) values (
      p_application_id, v_applicant_name, v_applicant_number, v_course, p_scheduled_at, v_location,
      v_examination_type, v_assigned_examiner, p_status, v_remarks, auth.uid(), now()
    ) returning * into v_exam;
  else
    update public.academic_examinations set
      application_id = p_application_id,
      applicant_name = v_applicant_name,
      applicant_number = v_applicant_number,
      course = v_course,
      scheduled_at = p_scheduled_at,
      location = v_location,
      examination_type = v_examination_type,
      assigned_examiner = v_assigned_examiner,
      status = p_status,
      remarks = v_remarks,
      managed_by = auth.uid(),
      updated_at = now()
    where id = p_examination_id returning * into v_exam;
  end if;

  if v_previous_schedule is distinct from p_scheduled_at then
    insert into public.academic_examination_history (
      examination_id, previous_schedule, new_schedule, reason, changed_by
    ) values (
      v_exam.id, v_previous_schedule, p_scheduled_at, v_remarks, auth.uid()
    );
  end if;
  return v_exam;
end $$;

create or replace function public.record_entrance_examination_result(
  p_examination_id uuid,
  p_score numeric,
  p_passing_score numeric,
  p_result text,
  p_remarks text default null
)
returns public.academic_examinations
language plpgsql security definer set search_path = public as $$
declare
  v_exam public.academic_examinations;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  if coalesce(public.current_admin_role(), '') <> 'ACADEMIC_ADMIN' then
    raise exception 'Only an Academic Admin may record examination results.' using errcode = '42501';
  end if;
  if p_result is null or p_result not in ('PENDING', 'PASSED', 'FAILED') then
    raise exception 'Choose a valid examination result.';
  end if;
  if length(coalesce(v_remarks, '')) > 1000 then
    raise exception 'Result remarks must be 1000 characters or fewer.';
  end if;
  if p_result = 'PENDING' then
    if p_score is not null or p_passing_score is not null then
      raise exception 'Pending results cannot include a score or passing score.';
    end if;
  elsif p_score is null or p_passing_score is null
     or p_score < 0 or p_score > 100 or p_passing_score < 0 or p_passing_score > 100 then
    raise exception 'Enter valid scores from 0 to 100.';
  elsif (p_result = 'PASSED' and p_score < p_passing_score)
     or (p_result = 'FAILED' and p_score >= p_passing_score) then
    raise exception 'The selected result must match the examination score and passing score.';
  end if;

  select * into v_exam from public.academic_examinations
  where id = p_examination_id for update;
  if not found then raise exception 'Examination not found.' using errcode = 'P0002'; end if;
  if p_result <> 'PENDING' and v_exam.status <> 'ATTENDED' then
    raise exception 'Mark the examination as completed before recording a result.';
  end if;

  update public.academic_examinations set
    score = p_score,
    passing_score = p_passing_score,
    result = p_result,
    result_remarks = v_remarks,
    result_recorded_at = case when p_result = 'PENDING' then null else now() end,
    managed_by = auth.uid(),
    updated_at = now()
  where id = p_examination_id
  returning * into v_exam;
  return v_exam;
end $$;

revoke all on function public.manage_entrance_examination(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) from public, anon;
revoke all on function public.record_entrance_examination_result(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.manage_entrance_examination(uuid, uuid, text, text, text, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.record_entrance_examination_result(uuid, numeric, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
