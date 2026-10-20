-- Allow authenticated students to submit and manage only their own pending
-- applications and documents. Apply after schema.sql, role-expansion.sql, and
-- working-scholar-opportunity-access.sql.
begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.scholarship_programs') is null
     or to_regclass('public.working_scholar_applications') is null
     or to_regclass('public.document_requirements') is null
     or to_regclass('public.application_documents') is null
     or to_regclass('public.application_requirement_snapshots') is null
     or to_regclass('public.application_requirement_snapshot_headers') is null
     or to_regclass('public.application_status_history') is null
     or to_regclass('public.follow_ups') is null
     or to_regprocedure('public.current_admin_role()') is null
     or to_regprocedure('public.student_working_scholar_program_slots()') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'working_scholar_applications'
          and column_name = 'student_user_id'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'working_scholar_applications'
          and column_name = 'program_id'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'working_scholar_applications'
          and column_name = 'lowest_subject_grade'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'working_scholar_applications'
          and column_name = 'gwa'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'scholarship_programs'
          and column_name = 'opens_at'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'scholarship_programs'
          and column_name = 'category'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'scholarship_programs'
          and column_name = 'deadline'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'document_requirements'
          and column_name = 'program_id'
     ) then
    raise exception 'Student application prerequisites are missing. Apply the complete base, role-expansion, and Working Scholar opportunity migrations first.';
  end if;
end $$;

alter table public.application_documents
  add column if not exists file_sha256 text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.application_documents'::regclass
       and conname = 'application_documents_file_sha256_format_check'
  ) then
    alter table public.application_documents
      add constraint application_documents_file_sha256_format_check
      check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create unique index if not exists application_documents_application_file_sha256_unique
  on public.application_documents (application_id, file_sha256)
  where file_sha256 is not null;

create or replace function public.is_student()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_admin_role() = 'STUDENT', false)
$$;

create or replace function public.is_finance_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_admin_role() = 'FINANCE_ADMIN', false)
$$;

-- This helper is used by legacy admin-only policies. A Student is not an
-- administrator, even though the student is an authenticated active profile.
create or replace function public.is_any_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.current_admin_role() in (
      'SUPER_ADMIN', 'ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN'
    ),
    false
  )
$$;

revoke all on function public.is_student() from public, anon;
grant execute on function public.is_student() to authenticated;
revoke all on function public.is_finance_admin() from public, anon;
grant execute on function public.is_finance_admin() to authenticated;
revoke all on function public.is_any_admin() from public, anon;
grant execute on function public.is_any_admin() to authenticated;

grant select on public.profiles, public.scholarship_programs,
  public.document_requirements, public.working_scholar_applications,
  public.application_documents, public.application_requirement_snapshots,
  public.application_status_history, public.follow_ups
  to authenticated;
grant insert on public.working_scholar_applications, public.application_documents
  to authenticated;
grant usage, select on sequence public.application_no_seq to authenticated;

alter table public.profiles enable row level security;
alter table public.scholarship_programs enable row level security;
alter table public.working_scholar_applications enable row level security;
alter table public.document_requirements enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_requirement_snapshots enable row level security;
alter table public.application_requirement_snapshot_headers enable row level security;
alter table public.application_status_history enable row level security;
alter table public.follow_ups enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_any_admin());

drop policy if exists programs_select on public.scholarship_programs;
create policy programs_select on public.scholarship_programs
  for select to authenticated
  using (
    (public.is_student() and is_active)
    or public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID')
  );

drop policy if exists apps_select on public.working_scholar_applications;
create policy apps_select on public.working_scholar_applications
  for select to authenticated
  using (
    public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN'
        and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
    or (public.is_student() and student_user_id = auth.uid())
  );

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
             p.category is distinct from 'ACADEMIC'
             and p.name !~* 'academic scholarship'
             or (
               p.category = 'ACADEMIC' or p.name ~* 'academic scholarship'
             ) and lower(regexp_replace(working_scholar_applications.course, '[^a-zA-Z]', '', 'g'))
                   in ('bsed', 'beed', 'bssw')
               and working_scholar_applications.year_level = 1
               and working_scholar_applications.gwa >= 90
               and working_scholar_applications.lowest_subject_grade >= 85
           )
           and (
             p.application_type <> 'WORKING_SCHOLAR'
             or exists (
               select 1
                 from public.student_working_scholar_program_slots() slots
                where slots.program_id = p.id
                  and slots.configured
                  and slots.applications_open
                  and slots.remaining > 0
             )
           )
      )
    )
  );

drop policy if exists apps_update on public.working_scholar_applications;
create policy apps_update on public.working_scholar_applications
  for update to authenticated
  using (
    public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN'
        and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
  )
  with check (
    public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN'
        and application_type = 'FINANCIAL_AID' and assigned_office = 'Finance')
  );

drop policy if exists req_select on public.document_requirements;
create policy req_select on public.document_requirements
  for select to authenticated
  using (
    (public.is_student() and is_active)
    or public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
    or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and application_type = 'WORKING_SCHOLAR')
    or (public.current_admin_role() = 'FINANCE_ADMIN' and application_type = 'FINANCIAL_AID')
  );

drop policy if exists docs_select on public.application_documents;
create policy docs_select on public.application_documents
  for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists docs_insert on public.application_documents;
create policy docs_insert on public.application_documents
  for insert to authenticated
  with check (
    (
      public.is_working_scholar_admin()
      and exists (
        select 1 from public.working_scholar_applications a
         where a.id = application_documents.application_id
           and a.application_type = 'WORKING_SCHOLAR'
      )
    )
    or (
      public.current_admin_role() = 'FINANCE_ADMIN'
      and exists (
        select 1 from public.working_scholar_applications a
         where a.id = application_documents.application_id
           and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance'
      )
    )
    or (
      public.is_student()
      and created_by = auth.uid()
      and review_status = 'PENDING'
      and reviewed_by is null
      and reviewed_at is null
      and review_remarks is null
      and storage_path is not null
      and file_size > 0
      and requirement_id is not null
      and exists (
        select 1
          from public.working_scholar_applications a
          join public.application_requirement_snapshots r
            on r.application_id = a.id
           and r.requirement_id = application_documents.requirement_id
         where a.id = application_documents.application_id
           and a.student_user_id = auth.uid()
           and (
             a.status = 'PENDING'
             or exists (
               select 1 from public.application_documents correction
                where correction.application_id = a.id
                  and correction.requirement_id = application_documents.requirement_id
                  and correction.review_status in ('NEEDS_CORRECTION', 'REJECTED')
             )
           )
           and storage_path like a.id::text || '/%'
           and mime_type = any(r.accepted_mime_types)
           and file_size <= r.max_file_size_bytes
      )
    )
  );

drop policy if exists docs_update on public.application_documents;
create policy docs_update on public.application_documents
  for update to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
       )
  ))
  with check (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_documents.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
       )
  ));

drop policy if exists app_requirement_snapshots_select on public.application_requirement_snapshots;
create policy app_requirement_snapshots_select on public.application_requirement_snapshots
  for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_requirement_snapshots.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists history_select on public.application_status_history;
create policy history_select on public.application_status_history
  for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = application_status_history.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups
  for select to authenticated
  using (exists (
    select 1 from public.working_scholar_applications a
     where a.id = follow_ups.application_id
       and (
         public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
         or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
         or (public.current_admin_role() = 'FINANCE_ADMIN'
             and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
         or (public.is_student() and a.student_user_id = auth.uid())
       )
  ));

create or replace function public.snapshot_application_requirements()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_has_program_requirements boolean;
begin
  insert into public.application_requirement_snapshot_headers (application_id, application_type)
  values (new.id, new.application_type)
  on conflict (application_id) do nothing;

  select exists (
    select 1
      from public.document_requirements r
     where r.is_active
       and r.application_type = new.application_type
       and r.program_id = new.program_id
  ) into v_has_program_requirements;

  insert into public.application_requirement_snapshots (
    application_id, requirement_id, application_type, name, description,
    is_required, accepted_mime_types, max_file_size_bytes, sort_order
  )
  select new.id, r.id, r.application_type, r.name, r.description,
         r.is_required, r.accepted_mime_types, r.max_file_size_bytes, r.sort_order
    from public.document_requirements r
   where r.is_active
     and r.application_type = new.application_type
     and (
       (v_has_program_requirements and r.program_id = new.program_id)
       or (not v_has_program_requirements and r.program_id is null)
     )
   order by r.sort_order, r.name;

  return new;
end $$;
revoke all on function public.snapshot_application_requirements() from public, anon, authenticated;

drop trigger if exists snapshot_application_requirements on public.working_scholar_applications;
create trigger snapshot_application_requirements
  after insert on public.working_scholar_applications
  for each row execute function public.snapshot_application_requirements();

drop policy if exists app_docs_storage_select on storage.objects;
create policy app_docs_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'application-documents'
    and exists (
      select 1 from public.working_scholar_applications a
       where a.id::text = (storage.foldername(name))[1]
         and (
           public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
           or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
           or (public.current_admin_role() = 'FINANCE_ADMIN'
               and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
           or (public.is_student() and a.student_user_id = auth.uid())
         )
    )
  );

drop policy if exists app_docs_storage_insert on storage.objects;
create policy app_docs_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'application-documents'
    and exists (
      select 1 from public.working_scholar_applications a
       where a.id::text = (storage.foldername(name))[1]
         and (
           (public.is_working_scholar_admin() and a.application_type = 'WORKING_SCHOLAR')
           or (public.current_admin_role() = 'FINANCE_ADMIN'
               and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
           or (public.is_student() and a.student_user_id = auth.uid()
               and (a.status = 'PENDING' or exists (
                 select 1 from public.application_documents correction
                  where correction.application_id = a.id
                    and correction.review_status in ('NEEDS_CORRECTION', 'REJECTED')
               )))
         )
    )
  );

drop policy if exists app_docs_storage_delete on storage.objects;
create policy app_docs_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'application-documents'
    and exists (
      select 1 from public.working_scholar_applications a
       where a.id::text = (storage.foldername(name))[1]
         and (
           public.current_admin_role() in ('SUPER_ADMIN', 'ACADEMIC_ADMIN')
           or (public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN' and a.application_type = 'WORKING_SCHOLAR')
           or (public.current_admin_role() = 'FINANCE_ADMIN'
               and a.application_type = 'FINANCIAL_AID' and a.assigned_office = 'Finance')
           or (public.is_student() and a.student_user_id = auth.uid()
               and (a.status = 'PENDING' or exists (
                 select 1 from public.application_documents correction
                  where correction.application_id = a.id
                    and correction.review_status in ('NEEDS_CORRECTION', 'REJECTED')
               )))
         )
    )
  );

notify pgrst, 'reload schema';
commit;
