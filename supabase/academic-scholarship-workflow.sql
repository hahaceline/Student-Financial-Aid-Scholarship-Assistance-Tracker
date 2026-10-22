-- Apply after schema.sql, role-expansion.sql, working-scholar-opportunity-access.sql,
-- and student-application-access.sql. This migration only adds Academic workflow data.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.working_scholar_applications') is null
     or to_regclass('public.scholarship_programs') is null
     or to_regclass('public.document_requirements') is null
     or to_regclass('public.application_documents') is null
     or to_regclass('public.application_document_reviews') is null
     or to_regclass('public.application_status_history') is null
     or to_regclass('public.application_requirement_snapshots') is null
     or to_regclass('public.application_requirement_snapshot_headers') is null
     or to_regclass('public.follow_ups') is null
     or to_regprocedure('public.current_admin_role()') is null
     or to_regprocedure('public.is_student()') is null
     or to_regprocedure('public.is_valid_status_transition(text,text)') is null
     or to_regprocedure('public.student_working_scholar_program_slots()') is null then
    raise exception 'Academic Scholarship prerequisites are missing. Apply the base, role, opportunity, and student-access SQL files first.';
  end if;
end $$;

alter table public.working_scholar_applications
  add column if not exists academic_year text,
  add column if not exists semester text,
  add column if not exists applicant_type text not null default 'INCOMING_FIRST_YEAR';
alter table public.working_scholar_applications
  drop constraint if exists working_scholar_applications_type_check;
alter table public.working_scholar_applications
  add constraint working_scholar_applications_type_check
  check (application_type in ('WORKING_SCHOLAR', 'FINANCIAL_AID', 'ACADEMIC'));
alter table public.document_requirements
  drop constraint if exists document_requirements_type_check;
alter table public.document_requirements
  add constraint document_requirements_type_check
  check (application_type in ('WORKING_SCHOLAR', 'FINANCIAL_AID', 'ACADEMIC'));
alter table public.scholarship_programs
  drop constraint if exists scholarship_programs_application_type_check;
alter table public.scholarship_programs
  add constraint scholarship_programs_application_type_check
  check (application_type in ('WORKING_SCHOLAR', 'FINANCIAL_AID', 'ACADEMIC'));
alter table public.application_requirement_snapshots
  drop constraint if exists application_requirement_snapshots_application_type_check;
alter table public.application_requirement_snapshots
  add constraint application_requirement_snapshots_application_type_check
  check (application_type in ('WORKING_SCHOLAR', 'FINANCIAL_AID', 'ACADEMIC'));
alter table public.application_requirement_snapshot_headers
  drop constraint if exists application_requirement_snapshot_headers_application_type_check;
alter table public.application_requirement_snapshot_headers
  add constraint application_requirement_snapshot_headers_application_type_check
  check (application_type in ('WORKING_SCHOLAR', 'FINANCIAL_AID', 'ACADEMIC'));
create index if not exists academic_applications_status_idx
  on public.working_scholar_applications (application_type, status, application_date desc);
alter table public.document_requirements enable row level security;
alter table public.scholarship_programs enable row level security;

create table if not exists public.academic_scholarship_rules (
  id boolean primary key default true check (id),
  minimum_gwa numeric(5,2) not null default 90 check (minimum_gwa between 0 and 100),
  minimum_subject_grade numeric(5,2) not null default 85 check (minimum_subject_grade between 0 and 100),
  eligible_programs text[] not null default array['BS Ed', 'BE Ed', 'BSSW'],
  application_open_at timestamptz,
  application_deadline timestamptz,
  benefits text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (application_deadline is null or application_open_at is null or application_deadline > application_open_at)
);
insert into public.academic_scholarship_rules (id) values (true) on conflict (id) do nothing;

drop policy if exists apps_insert on public.working_scholar_applications;
create policy apps_insert on public.working_scholar_applications
  for insert to authenticated
  with check (
    (
      public.is_working_scholar_admin()
      and application_type = 'WORKING_SCHOLAR'
      and status = 'PENDING'
    )
    or (
      public.is_student()
      and student_user_id = auth.uid()
      and created_by = auth.uid()
      and status = 'PENDING'
      and exists (
        select 1 from public.profiles profile
         where profile.id = auth.uid()
           and profile.is_active
           and profile.full_name = working_scholar_applications.student_name
           and profile.email = working_scholar_applications.email
      )
      and exists (
        select 1
          from public.scholarship_programs p
         where p.id = working_scholar_applications.program_id
           and p.application_type = working_scholar_applications.application_type
           and p.is_active
           and (p.opens_at is null or p.opens_at <= (now() at time zone 'Asia/Manila')::date)
           and (p.deadline is null or p.deadline >= (now() at time zone 'Asia/Manila')::date)
           and (
             (p.application_type <> 'ACADEMIC' and p.category is distinct from 'ACADEMIC'
               and p.name !~* 'academic scholarship')
             or (
               (p.application_type = 'ACADEMIC' or p.category = 'ACADEMIC'
                 or p.name ~* 'academic scholarship')
               and lower(regexp_replace(working_scholar_applications.course, '[^a-zA-Z]', '', 'g'))
                   in ('bsed', 'beed', 'bssw')
               and working_scholar_applications.year_level = 1
               and working_scholar_applications.gwa >= 90
               and working_scholar_applications.lowest_subject_grade >= 85
               and exists (
                 select 1 from public.document_requirements r
                  where r.application_type = 'ACADEMIC'
                    and r.is_active and r.is_required
                    and (r.program_id is null or r.program_id = p.id)
               )
             )
           )
           and (
             p.application_type <> 'WORKING_SCHOLAR'
             or exists (
               select 1 from public.student_working_scholar_program_slots() slots
                where slots.program_id = p.id
                  and slots.configured
                  and slots.applications_open
                  and slots.remaining > 0
             )
           )
      )
    )
  );

create table if not exists public.academic_eligibility_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.working_scholar_applications(id) on delete restrict,
  result text not null default 'PENDING_VERIFICATION'
    check (result in ('ELIGIBLE_FOR_REVIEW', 'INELIGIBLE', 'PENDING_VERIFICATION')),
  gwa numeric(5,2) check (gwa between 0 and 100),
  gwa_verified boolean not null default false,
  enrollment_required boolean not null default false,
  enrollment_verified boolean not null default false,
  conflict_reviewed boolean not null default false,
  conflict_exists boolean not null default false,
  conflict_resolution text,
  examination_required boolean not null default false,
  remarks text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.academic_application_subject_grades (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.working_scholar_applications(id) on delete restrict,
  subject text not null check (length(btrim(subject)) between 1 and 160),
  grade numeric(5,2) not null check (grade between 0 and 100),
  previous_grade numeric(5,2) check (previous_grade between 0 and 100),
  correction_reason text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (previous_grade is null or nullif(btrim(correction_reason), '') is not null)
);
create index if not exists academic_app_subject_grades_idx
  on public.academic_application_subject_grades (application_id, created_at desc);

create table if not exists public.academic_scholarships (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.working_scholar_applications(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FOR_REVIEW', 'REMOVED', 'COMPLETED')),
  started_at date not null default current_date,
  ended_at date,
  end_reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('REMOVED', 'COMPLETED') or nullif(btrim(end_reason), '') is not null)
);
create index if not exists academic_scholarships_student_status_idx
  on public.academic_scholarships (student_id, status);
create table if not exists public.academic_scholarship_status_history (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null references public.academic_scholarships(id) on delete restrict,
  from_status text not null,
  to_status text not null,
  reason text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_grade_reviews (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null references public.academic_scholarships(id) on delete restrict,
  academic_year text not null check (length(btrim(academic_year)) between 4 and 20),
  semester text not null check (length(btrim(semester)) between 1 and 40),
  gwa numeric(5,2) check (gwa between 0 and 100),
  certificate_document_id uuid references public.application_documents(id) on delete set null,
  status text not null default 'PENDING_VERIFICATION'
    check (status in ('PENDING_VERIFICATION', 'QUALIFIED', 'REQUIRES_REVIEW')),
  remarks text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scholarship_id, academic_year, semester)
);
create table if not exists public.academic_semester_subject_grades (
  id uuid primary key default gen_random_uuid(),
  grade_review_id uuid not null references public.academic_grade_reviews(id) on delete restrict,
  subject text not null check (length(btrim(subject)) between 1 and 160),
  grade numeric(5,2) not null check (grade between 0 and 100),
  previous_grade numeric(5,2) check (previous_grade between 0 and 100),
  correction_reason text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (previous_grade is null or nullif(btrim(correction_reason), '') is not null)
);
create index if not exists academic_grade_reviews_term_idx
  on public.academic_grade_reviews (academic_year, semester, status);

create table if not exists public.academic_enrollment_verifications (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null references public.academic_scholarships(id) on delete restrict,
  academic_year text not null,
  semester text not null,
  status text not null default 'PENDING_VERIFICATION'
    check (status in ('ENROLLED', 'NOT_ENROLLED', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'PENDING_VERIFICATION')),
  remarks text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scholarship_id, academic_year, semester)
);

create table if not exists public.academic_examinations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.working_scholar_applications(id) on delete restrict,
  scheduled_at timestamptz,
  location text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED')),
  reschedule_request text,
  remarks text,
  managed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.academic_examination_history (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.academic_examinations(id) on delete restrict,
  previous_schedule timestamptz,
  new_schedule timestamptz,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_notices_of_award (
  id uuid primary key default gen_random_uuid(),
  scholarship_id uuid not null unique references public.academic_scholarships(id) on delete restrict,
  terms_version text not null,
  terms_text text not null,
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.academic_conflict_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.working_scholar_applications(id) on delete restrict,
  other_scholarship text,
  conflict_status text not null default 'PENDING_REVIEW'
    check (conflict_status in ('PENDING_REVIEW', 'NO_CONFLICT', 'CONFLICT_CONFIRMED', 'RESOLVED')),
  resolution text,
  remarks text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'academic_scholarship_rules','academic_eligibility_reviews','academic_application_subject_grades',
    'academic_scholarships','academic_scholarship_status_history','academic_grade_reviews',
    'academic_semester_subject_grades','academic_enrollment_verifications','academic_examinations',
    'academic_examination_history','academic_notices_of_award','academic_conflict_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant select, update on public.academic_scholarship_rules to authenticated;
grant insert, update on public.document_requirements, public.scholarship_programs to authenticated;

drop policy if exists academic_requirements_manage on public.document_requirements;
create policy academic_requirements_manage on public.document_requirements
  for all to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
  with check (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC');
drop policy if exists academic_programs_manage on public.scholarship_programs;
create policy academic_programs_manage on public.scholarship_programs
  for all to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
  with check (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC');

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and exists (
      select 1 from public.working_scholar_applications a
      where a.student_user_id = profiles.id and a.application_type = 'ACADEMIC'
    ))
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and exists (
      select 1 from public.working_scholar_applications a
      where a.student_user_id = profiles.id and a.application_type = 'WORKING_SCHOLAR'
    ))
    or (public.current_admin_role() = 'FINANCE_ADMIN' and exists (
      select 1 from public.working_scholar_applications a
      where a.student_user_id = profiles.id and a.application_type = 'FINANCIAL_AID'
        and a.assigned_office = 'Finance'
    ))
  );

drop policy if exists programs_select on public.scholarship_programs;
create policy programs_select on public.scholarship_programs for select to authenticated
  using (
    (public.is_student() and is_active)
    or public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID')
  );

drop policy if exists apps_select on public.working_scholar_applications;
create policy apps_select on public.working_scholar_applications for select to authenticated
  using (
    public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
    or (public.is_student() and student_user_id = auth.uid())
  );

drop policy if exists apps_update on public.working_scholar_applications;
create policy apps_update on public.working_scholar_applications for update to authenticated
  using (
    public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
  )
  with check (
    public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
  );

drop policy if exists req_select on public.document_requirements;
create policy req_select on public.document_requirements for select to authenticated
  using (
    (public.is_student() and is_active)
    or public.current_admin_role() = 'SUPER_ADMIN'
    or (public.current_admin_role() = 'ACADEMIC_ADMIN' and application_type = 'ACADEMIC')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID')
  );

drop policy if exists docs_select on public.application_documents;
create policy docs_select on public.application_documents for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists docs_update on public.application_documents;
create policy docs_update on public.application_documents for update to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
       )
  ))
  with check (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
       )
  ));

drop policy if exists app_requirement_snapshots_select on public.application_requirement_snapshots;
create policy app_requirement_snapshots_select on public.application_requirement_snapshots for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_requirement_snapshots.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists history_select on public.application_status_history;
create policy history_select on public.application_status_history for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_status_history.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = follow_ups.application_id
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists app_docs_storage_select on storage.objects;
create policy app_docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'application-documents' and exists (
    select 1 from public.working_scholar_applications a
     where a.id::text = (storage.foldername(name))[1]
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists app_docs_storage_delete on storage.objects;
create policy app_docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'application-documents' and exists (
    select 1 from public.working_scholar_applications a
     where a.id::text = (storage.foldername(name))[1]
       and (
         public.current_admin_role() = 'SUPER_ADMIN'
         or (public.current_admin_role() = 'ACADEMIC_ADMIN' and a.application_type = 'ACADEMIC')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN' and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid()
             and (a.status = 'PENDING' or exists (
               select 1 from public.application_documents correction
                where correction.application_id = a.id
                  and correction.review_status in ('NEEDS_CORRECTION', 'REJECTED')
             )))
       )
  ));

drop policy if exists academic_rules_select on public.academic_scholarship_rules;
create policy academic_rules_select on public.academic_scholarship_rules for select to authenticated
  using (public.current_admin_role() in ('ACADEMIC_ADMIN', 'SUPER_ADMIN', 'STUDENT'));
drop policy if exists academic_rules_update on public.academic_scholarship_rules;
create policy academic_rules_update on public.academic_scholarship_rules for update to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN')
  with check (
    public.current_admin_role() = 'ACADEMIC_ADMIN'
    and minimum_gwa = 90
    and minimum_subject_grade = 85
    and eligible_programs = array['BS Ed', 'BE Ed', 'BSSW']
  );

do $$
declare t text;
begin
  foreach t in array array[
    'academic_eligibility_reviews','academic_application_subject_grades','academic_scholarships',
    'academic_grade_reviews','academic_semester_subject_grades','academic_enrollment_verifications',
    'academic_examinations','academic_examination_history','academic_notices_of_award','academic_conflict_reviews'
  ] loop
    execute format('drop policy if exists academic_scope_select on public.%I', t);
    execute format('drop policy if exists academic_scope_insert on public.%I', t);
    execute format('drop policy if exists academic_scope_update on public.%I', t);
  end loop;
end $$;

-- Policies use per-table related records where the owner key differs.
drop policy if exists academic_scope_select on public.academic_eligibility_reviews;
create policy academic_scope_select on public.academic_eligibility_reviews for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.working_scholar_applications a where a.id = application_id and a.student_user_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_application_subject_grades;
create policy academic_scope_select on public.academic_application_subject_grades for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.working_scholar_applications a where a.id = application_id and a.student_user_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_scholarships;
create policy academic_scope_select on public.academic_scholarships for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and student_id = auth.uid()));
drop policy if exists academic_scope_select on public.academic_scholarship_status_history;
create policy academic_scope_select on public.academic_scholarship_status_history for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_scholarships s where s.id = scholarship_id and s.student_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_grade_reviews;
create policy academic_scope_select on public.academic_grade_reviews for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_scholarships s where s.id = scholarship_id and s.student_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_semester_subject_grades;
create policy academic_scope_select on public.academic_semester_subject_grades for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_grade_reviews r join public.academic_scholarships s on s.id = r.scholarship_id
    where r.id = grade_review_id and s.student_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_enrollment_verifications;
create policy academic_scope_select on public.academic_enrollment_verifications for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_scholarships s where s.id = scholarship_id and s.student_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_examinations;
create policy academic_scope_select on public.academic_examinations for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.working_scholar_applications a where a.id = application_id and a.student_user_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_examination_history;
create policy academic_scope_select on public.academic_examination_history for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_examinations e join public.working_scholar_applications a on a.id = e.application_id
    where e.id = examination_id and a.student_user_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_notices_of_award;
create policy academic_scope_select on public.academic_notices_of_award for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.academic_scholarships s where s.id = scholarship_id and s.student_id = auth.uid()
  )));
drop policy if exists academic_scope_select on public.academic_conflict_reviews;
create policy academic_scope_select on public.academic_conflict_reviews for select to authenticated
  using (public.current_admin_role() = 'ACADEMIC_ADMIN' or (public.current_admin_role() = 'STUDENT' and exists (
    select 1 from public.working_scholar_applications a where a.id = application_id and a.student_user_id = auth.uid()
  )));

-- Academic Admin may review documents only on Academic applications.
create or replace function public.review_academic_document(
  p_document_id uuid, p_review_status text, p_review_remarks text default null
)
returns public.application_documents language plpgsql security definer set search_path = public as $$
declare v_doc public.application_documents;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may review Academic documents.' using errcode = '42501';
  end if;
  if p_review_status not in ('ACCEPTED', 'NEEDS_CORRECTION', 'REJECTED') then
    raise exception 'Choose a valid document review status.'; end if;
  if p_review_status in ('NEEDS_CORRECTION', 'REJECTED') and nullif(btrim(coalesce(p_review_remarks, '')), '') is null then
    raise exception 'A remark is required for an incomplete or rejected document.'; end if;
  update public.application_documents d
    set review_status = p_review_status, review_remarks = nullif(btrim(coalesce(p_review_remarks, '')), ''),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    from public.working_scholar_applications a
    where d.id = p_document_id and a.id = d.application_id and a.application_type = 'ACADEMIC'
    returning d.* into v_doc;
  if not found then raise exception 'Academic document not found.' using errcode = 'P0002'; end if;
  insert into public.application_document_reviews (document_id, review_status, review_remarks, reviewed_by)
  values (v_doc.id, p_review_status, v_doc.review_remarks, auth.uid());
  return v_doc;
end $$;

create or replace function public.create_academic_follow_up(
  p_application_id uuid, p_message text, p_requirement_id uuid default null, p_document_id uuid default null
)
returns public.follow_ups language plpgsql security definer set search_path = public as $$
declare v_app public.working_scholar_applications; v_follow_up public.follow_ups;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may send Academic application feedback.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then raise exception 'Feedback message is required.'; end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id and application_type = 'ACADEMIC' for update;
  if not found then raise exception 'Academic application not found.' using errcode = 'P0002'; end if;
  if p_requirement_id is not null and not exists (
    select 1 from public.application_requirement_snapshots r
    where r.application_id = p_application_id and r.requirement_id = p_requirement_id
  ) then raise exception 'The selected requirement does not belong to this application.'; end if;
  if p_document_id is not null and not exists (
    select 1 from public.application_documents d where d.id = p_document_id and d.application_id = p_application_id
  ) then raise exception 'The selected document does not belong to this application.'; end if;
  insert into public.follow_ups (application_id, requirement_id, document_id, message, created_by)
  values (p_application_id, p_requirement_id, p_document_id, btrim(p_message), auth.uid()) returning * into v_follow_up;
  if v_app.status in ('PENDING', 'UNDER_REVIEW', 'COMPLETED') then
    perform set_config('app.status_rpc', 'on', true);
    update public.working_scholar_applications
       set status = 'FOR_FOLLOW_UP', review_remarks = btrim(p_message), updated_at = now()
     where id = p_application_id;
    perform set_config('app.status_rpc', 'off', true);
    insert into public.application_status_history (application_id, from_status, to_status, reason, changed_by)
    values (p_application_id, v_app.status, 'FOR_FOLLOW_UP', btrim(p_message), auth.uid());
  end if;
  return v_follow_up;
end $$;

create or replace function public.save_academic_assessment(
  p_application_id uuid, p_gwa numeric, p_subject_grades jsonb, p_enrollment_required boolean,
  p_enrollment_verified boolean, p_conflict_reviewed boolean, p_conflict_exists boolean,
  p_conflict_resolution text, p_examination_required boolean, p_remarks text default null
)
returns public.academic_eligibility_reviews language plpgsql security definer set search_path = public as $$
declare
  v_app public.working_scholar_applications;
  v_review public.academic_eligibility_reviews;
  v_rules public.academic_scholarship_rules;
  v_grade jsonb;
  v_subject text;
  v_value numeric;
  v_previous numeric;
  v_ineligible text;
  v_docs_complete boolean;
  v_course_eligible boolean;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may record eligibility assessment.' using errcode = '42501';
  end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id and application_type = 'ACADEMIC' for update;
  if not found then raise exception 'Academic application not found.' using errcode = 'P0002'; end if;
  if p_gwa is null or p_gwa not between 0 and 100 or jsonb_typeof(p_subject_grades) <> 'array'
     or jsonb_array_length(p_subject_grades) = 0 then raise exception 'Enter verified GWA and at least one subject grade.'; end if;
  if p_conflict_exists and (not p_conflict_reviewed or nullif(btrim(coalesce(p_conflict_resolution, '')), '') is null) then
    raise exception 'Record the conflict review and resolution before saving.'; end if;
  select * into v_rules from public.academic_scholarship_rules where id;
  select exists (
    select 1 from unnest(v_rules.eligible_programs) e
    where lower(regexp_replace(e, '[^a-zA-Z]', '', 'g'))
      = lower(regexp_replace(v_app.course, '[^a-zA-Z]', '', 'g'))
  ) into v_course_eligible;
  select not exists (
    select 1 from public.application_requirement_snapshots r
    where r.application_id = p_application_id and r.is_required
      and not exists (
        select 1 from public.application_documents d where d.application_id = p_application_id
          and d.requirement_id = r.requirement_id and d.review_status = 'ACCEPTED'
      )
  ) into v_docs_complete;
  v_ineligible := case
    when not v_course_eligible then 'Program is not on the approved eligible-program list.'
    when p_gwa < v_rules.minimum_gwa then 'GWA is below the minimum of ' || v_rules.minimum_gwa || '.'
    else null end;
  for v_grade in select value from jsonb_array_elements(p_subject_grades) loop
    v_subject := nullif(btrim(v_grade->>'subject'), '');
    if v_subject is null or coalesce(v_grade->>'grade', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Each subject grade requires a subject name and numeric grade.'; end if;
    v_value := (v_grade->>'grade')::numeric;
    if v_value not between 0 and 100 then raise exception 'Subject grades must be from 0 to 100.'; end if;
    select g.grade into v_previous from public.academic_application_subject_grades g
    where g.application_id = p_application_id and lower(btrim(g.subject)) = lower(v_subject)
    order by g.created_at desc, g.id desc limit 1;
    if not found or v_previous is distinct from v_value then
      if v_previous is not null and nullif(btrim(v_grade->>'correction_reason'), '') is null then
        raise exception 'A correction reason is required when changing a subject grade.'; end if;
      insert into public.academic_application_subject_grades
        (application_id, subject, grade, previous_grade, correction_reason, verified_by, verified_at)
      values (p_application_id, v_subject, v_value, v_previous,
        nullif(btrim(v_grade->>'correction_reason'), ''), auth.uid(), now());
    end if;
    if v_value < v_rules.minimum_subject_grade then
      v_ineligible := coalesce(v_ineligible, 'A verified subject grade is below the minimum of ' || v_rules.minimum_subject_grade || '.');
    end if;
  end loop;
  insert into public.academic_eligibility_reviews (
    application_id, result, gwa, gwa_verified, enrollment_required, enrollment_verified,
    conflict_reviewed, conflict_exists, conflict_resolution, examination_required,
    remarks, reviewed_by, reviewed_at, updated_at
  ) values (
    p_application_id,
    case when v_ineligible is not null then 'INELIGIBLE'
         when not v_docs_complete or (p_enrollment_required and not p_enrollment_verified) or not p_conflict_reviewed then 'PENDING_VERIFICATION'
         else 'ELIGIBLE_FOR_REVIEW' end,
    p_gwa, true, p_enrollment_required, p_enrollment_verified, p_conflict_reviewed,
    p_conflict_exists, nullif(btrim(coalesce(p_conflict_resolution, '')), ''),
    p_examination_required, coalesce(nullif(btrim(coalesce(p_remarks, '')), ''), v_ineligible),
    auth.uid(), now(), now()
  ) on conflict (application_id) do update set
    result = excluded.result, gwa = excluded.gwa, gwa_verified = true,
    enrollment_required = excluded.enrollment_required, enrollment_verified = excluded.enrollment_verified,
    conflict_reviewed = excluded.conflict_reviewed, conflict_exists = excluded.conflict_exists,
    conflict_resolution = excluded.conflict_resolution, examination_required = excluded.examination_required,
    remarks = excluded.remarks, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  returning * into v_review;
  insert into public.academic_conflict_reviews
    (application_id, conflict_status, resolution, remarks, reviewed_by, reviewed_at)
  values (p_application_id,
    case when not p_conflict_reviewed then 'PENDING_REVIEW'
         when p_conflict_exists and nullif(btrim(coalesce(p_conflict_resolution, '')), '') is not null then 'RESOLVED'
         when p_conflict_exists then 'CONFLICT_CONFIRMED' else 'NO_CONFLICT' end,
    nullif(btrim(coalesce(p_conflict_resolution, '')), ''), nullif(btrim(coalesce(p_remarks, '')), ''),
    case when p_conflict_reviewed then auth.uid() else null end, case when p_conflict_reviewed then now() else null end)
  on conflict (application_id) do update set
    conflict_status = excluded.conflict_status, resolution = excluded.resolution,
    remarks = excluded.remarks, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  return v_review;
end $$;

create or replace function public.save_academic_grade_review(
  p_scholarship_id uuid, p_academic_year text, p_semester text, p_gwa numeric,
  p_subject_grades jsonb, p_remarks text default null
)
returns public.academic_grade_reviews language plpgsql security definer set search_path = public as $$
declare
  v_review public.academic_grade_reviews;
  v_grade jsonb;
  v_subject text;
  v_value numeric;
  v_previous numeric;
  v_minimum numeric;
  v_qualified boolean := true;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may record semester grades.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_academic_year, '')), '') is null
     or nullif(btrim(coalesce(p_semester, '')), '') is null
     or p_gwa is null or p_gwa not between 0 and 100
     or jsonb_typeof(p_subject_grades) <> 'array'
     or jsonb_array_length(p_subject_grades) = 0 then
    raise exception 'Enter an academic year, semester, GWA, and at least one subject grade.';
  end if;
  if not exists (select 1 from public.academic_scholarships where id = p_scholarship_id) then
    raise exception 'Academic scholar not found.' using errcode = 'P0002';
  end if;
  select minimum_subject_grade into v_minimum from public.academic_scholarship_rules where id;
  if p_gwa < (select minimum_gwa from public.academic_scholarship_rules where id) then
    v_qualified := false;
  end if;
  insert into public.academic_grade_reviews (
    scholarship_id, academic_year, semester, gwa, status, remarks, verified_by, verified_at, updated_at
  ) values (
    p_scholarship_id, btrim(p_academic_year), btrim(p_semester), p_gwa,
    'PENDING_VERIFICATION', nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid(), now(), now()
  ) on conflict (scholarship_id, academic_year, semester) do update set
    gwa = excluded.gwa, status = 'PENDING_VERIFICATION', remarks = excluded.remarks,
    verified_by = auth.uid(), verified_at = now(), updated_at = now()
  returning * into v_review;
  for v_grade in select value from jsonb_array_elements(p_subject_grades) loop
    v_subject := nullif(btrim(v_grade->>'subject'), '');
    if v_subject is null or coalesce(v_grade->>'grade', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Each subject grade requires a subject name and numeric grade.';
    end if;
    v_value := (v_grade->>'grade')::numeric;
    if v_value not between 0 and 100 then raise exception 'Subject grades must be from 0 to 100.'; end if;
    select g.grade into v_previous from public.academic_semester_subject_grades g
     where g.grade_review_id = v_review.id and lower(btrim(g.subject)) = lower(v_subject)
     order by g.created_at desc, g.id desc limit 1;
    if not found or v_previous is distinct from v_value then
      if v_previous is not null and nullif(btrim(v_grade->>'correction_reason'), '') is null then
        raise exception 'A correction reason is required when changing a semester subject grade.';
      end if;
      insert into public.academic_semester_subject_grades (
        grade_review_id, subject, grade, previous_grade, correction_reason, verified_by, verified_at
      ) values (
        v_review.id, v_subject, v_value, v_previous,
        nullif(btrim(v_grade->>'correction_reason'), ''), auth.uid(), now()
      );
    end if;
    if v_value < v_minimum then v_qualified := false; end if;
  end loop;
  update public.academic_grade_reviews set status = case when v_qualified then 'QUALIFIED' else 'REQUIRES_REVIEW' end
   where id = v_review.id returning * into v_review;
  if not v_qualified then
    update public.academic_scholarships
       set status = 'FOR_REVIEW', changed_by = auth.uid(), updated_at = now()
     where id = p_scholarship_id and status = 'ACTIVE';
    if found then
      insert into public.academic_scholarship_status_history
        (scholarship_id, from_status, to_status, reason, changed_by)
      values (
        p_scholarship_id, 'ACTIVE', 'FOR_REVIEW',
        'Semester grade review is below the Academic Scholarship minimum.', auth.uid()
      );
    end if;
  end if;
  return v_review;
end $$;

create or replace function public.save_academic_enrollment(
  p_scholarship_id uuid, p_academic_year text, p_semester text, p_status text, p_remarks text default null
)
returns public.academic_enrollment_verifications language plpgsql security definer set search_path = public as $$
declare v_row public.academic_enrollment_verifications;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may verify enrollment.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_academic_year, '')), '') is null
     or nullif(btrim(coalesce(p_semester, '')), '') is null
     or p_status not in ('ENROLLED', 'NOT_ENROLLED', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'PENDING_VERIFICATION') then
    raise exception 'Provide a valid academic year, semester, and enrollment status.';
  end if;
  if not exists (select 1 from public.academic_scholarships where id = p_scholarship_id and status = 'ACTIVE') then
    raise exception 'Active Academic scholar not found.' using errcode = 'P0002';
  end if;
  insert into public.academic_enrollment_verifications (
    scholarship_id, academic_year, semester, status, remarks, verified_by, verified_at, updated_at
  ) values (
    p_scholarship_id, btrim(p_academic_year), btrim(p_semester), p_status,
    nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid(), now(), now()
  ) on conflict (scholarship_id, academic_year, semester) do update set
    status = excluded.status, remarks = excluded.remarks, verified_by = auth.uid(),
    verified_at = now(), updated_at = now()
  returning * into v_row;
  if p_status in ('NOT_ENROLLED', 'TRANSFERRED_OUT', 'DROPPED_OUT') then
    update public.academic_scholarships
       set status = 'FOR_REVIEW', changed_by = auth.uid(), updated_at = now()
     where id = p_scholarship_id and status = 'ACTIVE';
    if found then
      insert into public.academic_scholarship_status_history
        (scholarship_id, from_status, to_status, reason, changed_by)
      values (p_scholarship_id, 'ACTIVE', 'FOR_REVIEW',
        'Enrollment status requires Academic Scholarship review: ' || p_status, auth.uid());
    end if;
  end if;
  return v_row;
end $$;

create or replace function public.issue_academic_award(
  p_scholarship_id uuid, p_terms_version text, p_terms_text text
)
returns public.academic_notices_of_award language plpgsql security definer set search_path = public as $$
declare v_award public.academic_notices_of_award;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may issue a notice of award.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_terms_version, '')), '') is null
     or nullif(btrim(coalesce(p_terms_text, '')), '') is null then
    raise exception 'Award terms and version are required.';
  end if;
  if not exists (
    select 1 from public.academic_scholarships s
    join public.working_scholar_applications a on a.id = s.application_id
    where s.id = p_scholarship_id and s.status = 'ACTIVE'
      and a.application_type = 'ACADEMIC' and a.status = 'APPROVED'
  ) then raise exception 'Only approved active Academic scholars may receive an award notice.' using errcode = 'P0002'; end if;
  insert into public.academic_notices_of_award (scholarship_id, terms_version, terms_text, issued_by)
  values (p_scholarship_id, btrim(p_terms_version), btrim(p_terms_text), auth.uid())
  returning * into v_award;
  return v_award;
end $$;

create or replace function public.change_academic_application_status(
  p_application_id uuid, p_new_status text, p_reason text default null
)
returns public.working_scholar_applications language plpgsql security definer set search_path = public as $$
declare
  v_app public.working_scholar_applications;
  v_old_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may decide Academic applications.' using errcode = '42501';
  end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id and application_type = 'ACADEMIC' for update;
  if not found then raise exception 'Academic application not found.' using errcode = 'P0002'; end if;
  if p_new_status not in ('APPROVED', 'DENIED', 'UNDER_REVIEW', 'COMPLETED', 'FOR_FOLLOW_UP') then
    raise exception 'Choose a valid Academic application status.'; end if;
  if not public.is_valid_status_transition(v_app.status, p_new_status) then
    raise exception 'Invalid Academic application status change: % to %.', v_app.status, p_new_status;
  end if;
  if p_new_status = 'DENIED' and v_reason is null then raise exception 'A rejection reason is required.'; end if;
  if p_new_status = 'FOR_FOLLOW_UP' and v_reason is null then raise exception 'A follow-up reason is required.'; end if;
  if p_new_status = 'APPROVED' and not exists (
    select 1 from public.academic_eligibility_reviews r
    where r.application_id = p_application_id and r.result = 'ELIGIBLE_FOR_REVIEW'
      and r.gwa_verified and r.gwa >= (select minimum_gwa from public.academic_scholarship_rules where id)
      and (not r.enrollment_required or r.enrollment_verified)
      and r.conflict_reviewed and (not r.conflict_exists or nullif(btrim(r.conflict_resolution), '') is not null)
      and (not r.examination_required or exists (
        select 1 from public.academic_examinations e where e.application_id = p_application_id and e.status = 'ATTENDED'
      ))
  ) then raise exception 'Complete eligible grade, enrollment, conflict, and examination checks before acceptance.'; end if;
  if p_new_status = 'APPROVED' and exists (
    select 1 from public.application_requirement_snapshots r
    where r.application_id = p_application_id and r.is_required and not exists (
      select 1 from public.application_documents d where d.application_id = p_application_id
       and d.requirement_id = r.requirement_id and d.review_status = 'ACCEPTED'
    )
  ) then raise exception 'Accept all required application documents before acceptance.'; end if;

  v_old_status := v_app.status;
  perform set_config('app.status_rpc', 'on', true);
  update public.working_scholar_applications set status = p_new_status,
    denial_reason = case when p_new_status = 'DENIED' then v_reason else null end,
    review_remarks = case when v_reason is not null then v_reason else review_remarks end,
    decided_by = case when p_new_status in ('APPROVED', 'DENIED') then auth.uid() else decided_by end,
    decided_at = case when p_new_status in ('APPROVED', 'DENIED') then now() else decided_at end,
    updated_at = now()
  where id = p_application_id returning * into v_app;
  perform set_config('app.status_rpc', 'off', true);
  insert into public.application_status_history (application_id, from_status, to_status, reason, changed_by)
  values (p_application_id, v_old_status, p_new_status, v_reason, auth.uid());
  if p_new_status = 'APPROVED' then
    insert into public.academic_scholarships (application_id, student_id, status, changed_by)
    values (p_application_id, v_app.student_user_id, 'ACTIVE', auth.uid())
    on conflict (application_id) do nothing;
  end if;
  return v_app;
end $$;

create or replace function public.change_academic_scholarship_status(
  p_scholarship_id uuid, p_new_status text, p_reason text
)
returns public.academic_scholarships language plpgsql security definer set search_path = public as $$
declare v_row public.academic_scholarships; v_old text; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then
    raise exception 'Only Academic Admin may update scholar status.' using errcode = '42501';
  end if;
  if p_new_status not in ('ACTIVE', 'FOR_REVIEW', 'REMOVED', 'COMPLETED') then raise exception 'Invalid scholar status.'; end if;
  if p_new_status in ('REMOVED', 'COMPLETED') and v_reason is null then raise exception 'A reason is required.'; end if;
  select * into v_row from public.academic_scholarships where id = p_scholarship_id for update;
  if not found then raise exception 'Scholar record not found.' using errcode = 'P0002'; end if;
  v_old := v_row.status;
  update public.academic_scholarships set status = p_new_status,
    ended_at = case when p_new_status in ('REMOVED', 'COMPLETED') then current_date else null end,
    end_reason = case when p_new_status in ('REMOVED', 'COMPLETED') then v_reason else null end,
    changed_by = auth.uid(), updated_at = now()
  where id = p_scholarship_id returning * into v_row;
  insert into public.academic_scholarship_status_history (scholarship_id, from_status, to_status, reason, changed_by)
  values (p_scholarship_id, v_old, p_new_status, coalesce(v_reason, 'Status updated'), auth.uid());
  return v_row;
end $$;

create or replace function public.save_academic_examination(
  p_application_id uuid, p_scheduled_at timestamptz, p_location text, p_status text,
  p_reschedule_request text default null, p_remarks text default null
)
returns public.academic_examinations language plpgsql security definer set search_path = public as $$
declare v_exam public.academic_examinations; v_old timestamptz;
begin
  if public.current_admin_role() <> 'ACADEMIC_ADMIN' then raise exception 'Only Academic Admin may manage examinations.' using errcode = '42501'; end if;
  if p_status not in ('PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED') then raise exception 'Invalid examination status.'; end if;
  if p_status in ('SCHEDULED', 'RESCHEDULED') and (p_scheduled_at is null or nullif(btrim(coalesce(p_location, '')), '') is null) then
    raise exception 'A date, time, and location are required.'; end if;
  if not exists (select 1 from public.working_scholar_applications where id = p_application_id and application_type = 'ACADEMIC') then
    raise exception 'Academic application not found.' using errcode = 'P0002'; end if;
  select scheduled_at into v_old from public.academic_examinations where application_id = p_application_id for update;
  insert into public.academic_examinations (application_id, scheduled_at, location, status, reschedule_request, remarks, managed_by, updated_at)
  values (p_application_id, p_scheduled_at, nullif(btrim(coalesce(p_location, '')), ''), p_status,
    nullif(btrim(coalesce(p_reschedule_request, '')), ''), nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid(), now())
  on conflict (application_id) do update set
    scheduled_at = excluded.scheduled_at, location = excluded.location, status = excluded.status,
    reschedule_request = excluded.reschedule_request, remarks = excluded.remarks, managed_by = auth.uid(), updated_at = now()
  returning * into v_exam;
  if v_old is distinct from p_scheduled_at then
    insert into public.academic_examination_history (examination_id, previous_schedule, new_schedule, reason, changed_by)
    values (v_exam.id, v_old, p_scheduled_at, coalesce(nullif(btrim(coalesce(p_reschedule_request, '')), ''), nullif(btrim(coalesce(p_remarks, '')), '')), auth.uid());
  end if;
  return v_exam;
end $$;

create or replace function public.acknowledge_academic_award(p_award_id uuid)
returns public.academic_notices_of_award language plpgsql security definer set search_path = public as $$
declare v_award public.academic_notices_of_award;
begin
  if public.current_admin_role() <> 'STUDENT' then raise exception 'Only the recipient may acknowledge the award.' using errcode = '42501'; end if;
  update public.academic_notices_of_award n set acknowledged_at = coalesce(n.acknowledged_at, now()), acknowledged_by = auth.uid()
  from public.academic_scholarships s where n.id = p_award_id and s.id = n.scholarship_id and s.student_id = auth.uid()
  returning n.* into v_award;
  if not found then raise exception 'Notice of Award not found.' using errcode = 'P0002'; end if;
  return v_award;
end $$;

revoke all on function public.review_academic_document(uuid, text, text) from public, anon;
revoke all on function public.create_academic_follow_up(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.save_academic_assessment(uuid, numeric, jsonb, boolean, boolean, boolean, boolean, text, boolean, text) from public, anon;
revoke all on function public.save_academic_grade_review(uuid, text, text, numeric, jsonb, text) from public, anon;
revoke all on function public.save_academic_enrollment(uuid, text, text, text, text) from public, anon;
revoke all on function public.issue_academic_award(uuid, text, text) from public, anon;
revoke all on function public.change_academic_application_status(uuid, text, text) from public, anon;
revoke all on function public.change_academic_scholarship_status(uuid, text, text) from public, anon;
revoke all on function public.save_academic_examination(uuid, timestamptz, text, text, text, text) from public, anon;
revoke all on function public.acknowledge_academic_award(uuid) from public, anon;
grant execute on function public.review_academic_document(uuid, text, text) to authenticated;
grant execute on function public.create_academic_follow_up(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.save_academic_assessment(uuid, numeric, jsonb, boolean, boolean, boolean, boolean, text, boolean, text) to authenticated;
grant execute on function public.save_academic_grade_review(uuid, text, text, numeric, jsonb, text) to authenticated;
grant execute on function public.save_academic_enrollment(uuid, text, text, text, text) to authenticated;
grant execute on function public.issue_academic_award(uuid, text, text) to authenticated;
grant execute on function public.change_academic_application_status(uuid, text, text) to authenticated;
grant execute on function public.change_academic_scholarship_status(uuid, text, text) to authenticated;
grant execute on function public.save_academic_examination(uuid, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.acknowledge_academic_award(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
