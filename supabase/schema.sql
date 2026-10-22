

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('SUPER_ADMIN', 'ACADEMIC_ADMIN', 'WORKING_SCHOLAR_ADMIN', 'FINANCE_ADMIN', 'STUDENT')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);

create sequence if not exists public.application_no_seq;
create sequence if not exists public.scholar_no_seq;

create table if not exists public.working_scholar_applications (
  id uuid primary key default gen_random_uuid(),
  application_no text not null unique
    default ('WSA-' || lpad(nextval('public.application_no_seq')::text, 6, '0')),
  student_number text,
  student_name text not null,
  email text,
  course text not null,
  year_level smallint not null check (year_level between 1 and 8),
  assigned_office text,
  application_date date not null default current_date,
  status text not null default 'PENDING'
    check (status in ('PENDING','UNDER_REVIEW','COMPLETED','FOR_FOLLOW_UP','APPROVED','DENIED','INACTIVE')),
  review_remarks text,
  denial_reason text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint denial_requires_reason check (status <> 'DENIED' or denial_reason is not null)
);
create index if not exists wsa_status_idx on public.working_scholar_applications (status);
create index if not exists wsa_date_idx on public.working_scholar_applications (application_date desc);
create index if not exists wsa_name_idx on public.working_scholar_applications (lower(student_name));

create table if not exists public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_required boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  accepted_mime_types text[] not null default array['application/pdf','image/png','image/jpeg','image/webp'],
  max_file_size_bytes bigint not null default 10485760 check (max_file_size_bytes between 1 and 10485760),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.working_scholar_applications(id) on delete cascade,
  requirement_id uuid references public.document_requirements(id) on delete set null,
  file_name text not null,
  storage_path text,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_sha256 text,
  review_status text not null default 'PENDING'
    check (review_status in ('PENDING','ACCEPTED','REJECTED','NEEDS_CORRECTION')),
  review_remarks text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_documents_file_sha256_format_check
    check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists app_docs_app_idx on public.application_documents (application_id);
create index if not exists app_docs_review_idx on public.application_documents (review_status);
create unique index if not exists application_documents_application_file_sha256_unique
  on public.application_documents (application_id, file_sha256)
  where file_sha256 is not null;

create table if not exists public.application_document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.application_documents(id) on delete cascade,
  review_status text not null check (review_status in ('ACCEPTED','NEEDS_CORRECTION','REJECTED')),
  review_remarks text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default now()
);
create index if not exists app_doc_reviews_doc_idx on public.application_document_reviews (document_id, reviewed_at desc);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.working_scholar_applications(id) on delete cascade,
  requirement_id uuid references public.document_requirements(id) on delete set null,
  document_id uuid references public.application_documents(id) on delete set null,
  message text not null check (length(btrim(message)) > 0),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text
);
create index if not exists follow_ups_app_idx on public.follow_ups (application_id);
create index if not exists follow_ups_status_idx on public.follow_ups (status);

create table if not exists public.working_scholars (
  id uuid primary key default gen_random_uuid(),
  scholar_no text not null unique
    default ('WS-' || lpad(nextval('public.scholar_no_seq')::text, 6, '0')),
  application_id uuid not null unique references public.working_scholar_applications(id) on delete restrict,
  scholar_type text not null default 'NEW' check (scholar_type in ('NEW','PREVIOUS')),
  participation_status text not null default 'INACTIVE' check (participation_status in ('ACTIVE','INACTIVE')),
  accepted_at date not null default current_date,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ws_participation_idx on public.working_scholars (participation_status);

create table if not exists public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.working_scholar_applications(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists history_app_idx on public.application_status_history (application_id, created_at desc);

create table if not exists public.slot_settings (
  id uuid primary key default gen_random_uuid(),
  max_slots integer not null check (max_slots >= 0),
  applications_open boolean not null default false,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists slot_settings_created_idx on public.slot_settings (created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 2. ROLE HELPERS (trusted role comes from the database only)
-- ---------------------------------------------------------------------
create or replace function public.current_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_admin_role() = 'SUPER_ADMIN', false)
$$;

create or replace function public.is_working_scholar_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_admin_role() = 'WORKING_SCHOLAR_ADMIN', false)
$$;

create or replace function public.is_any_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_admin_role() is not null
$$;

-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','working_scholar_applications','document_requirements','application_documents','working_scholars']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Status columns can only change through change_application_status().
create or replace function public.guard_application_update()
returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.denial_reason is distinct from old.denial_reason
      or new.decided_by is distinct from old.decided_by
      or new.decided_at is distinct from old.decided_at)
     and coalesce(current_setting('app.status_rpc', true), '') <> 'on' then
    raise exception 'Application status can only be changed through change_application_status().' using errcode = '42501';
  end if;
  new.application_no := old.application_no;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists guard_application_update on public.working_scholar_applications;
create trigger guard_application_update before update on public.working_scholar_applications
  for each row execute function public.guard_application_update();

create or replace function public.log_initial_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.application_status_history (application_id, from_status, to_status, reason, changed_by)
  values (new.id, null, new.status, 'Application record created', auth.uid());
  return new;
end $$;

drop trigger if exists log_initial_status on public.working_scholar_applications;
create trigger log_initial_status after insert on public.working_scholar_applications
  for each row execute function public.log_initial_status();

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v jsonb := to_jsonb(new);
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, (v->>'id')::uuid,
    jsonb_build_object(
      'ref', coalesce(v->>'application_no', v->>'scholar_no', v->>'name', v->>'file_name', left(v->>'message', 80)),
      'status', coalesce(v->>'status', v->>'participation_status', v->>'review_status'),
      'max_slots', v->>'max_slots')
  );
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['working_scholar_applications','application_documents','follow_ups','working_scholars','document_requirements','slot_settings']
  loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. BUSINESS FUNCTIONS (all permission checks happen inside the database)
-- ---------------------------------------------------------------------
create or replace function public.is_valid_status_transition(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'PENDING'       then p_to in ('UNDER_REVIEW','FOR_FOLLOW_UP','DENIED')
    when 'UNDER_REVIEW'  then p_to in ('COMPLETED','FOR_FOLLOW_UP','APPROVED','DENIED')
    when 'COMPLETED'     then p_to in ('UNDER_REVIEW','FOR_FOLLOW_UP','APPROVED','DENIED')
    when 'FOR_FOLLOW_UP' then p_to in ('UNDER_REVIEW','COMPLETED','DENIED')
    when 'APPROVED'      then p_to in ('INACTIVE')
    when 'DENIED'        then p_to in ('UNDER_REVIEW')
    when 'INACTIVE'      then p_to in ('UNDER_REVIEW')
    else false end
$$;

create or replace function public.change_application_status(
  p_application_id uuid, p_new_status text, p_reason text default null)
returns public.working_scholar_applications
language plpgsql security definer set search_path = public as $$
declare
  v_app public.working_scholar_applications;
  v_old text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to change application status.' using errcode = '42501';
  end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  v_old := v_app.status;
  if not public.is_valid_status_transition(v_old, p_new_status) then
    raise exception 'Invalid status change: % to %.', v_old, p_new_status;
  end if;
  if p_new_status = 'DENIED' and v_reason is null then
    raise exception 'A denial reason is required.';
  end if;
  if p_new_status = 'FOR_FOLLOW_UP' and v_reason is null then
    raise exception 'A follow-up message is required.';
  end if;

  perform set_config('app.status_rpc', 'on', true);
  update public.working_scholar_applications set
    status = p_new_status,
    denial_reason = case when p_new_status = 'DENIED' then v_reason else null end,
    decided_by = case when p_new_status in ('APPROVED','DENIED') then auth.uid()
                      when p_new_status = 'INACTIVE' then decided_by else null end,
    decided_at = case when p_new_status in ('APPROVED','DENIED') then now()
                      when p_new_status = 'INACTIVE' then decided_at else null end
  where id = p_application_id
  returning * into v_app;
  perform set_config('app.status_rpc', 'off', true);

  insert into public.application_status_history (application_id, from_status, to_status, reason, changed_by)
  values (p_application_id, v_old, p_new_status, v_reason, auth.uid());
  return v_app;
end $$;

create or replace function public.create_follow_up(
  p_application_id uuid, p_message text, p_requirement_id uuid default null, p_document_id uuid default null)
returns public.follow_ups
language plpgsql security definer set search_path = public as $$
declare
  v_app public.working_scholar_applications;
  v_fu public.follow_ups;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to create follow-ups.' using errcode = '42501';
  end if;
  if v_msg is null then raise exception 'A follow-up message is required.'; end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if p_document_id is not null and not exists (
    select 1 from public.application_documents d where d.id = p_document_id and d.application_id = p_application_id) then
    raise exception 'The selected document does not belong to this application.';
  end if;

  insert into public.follow_ups (application_id, requirement_id, document_id, message, created_by)
  values (p_application_id, p_requirement_id, p_document_id, v_msg, auth.uid())
  returning * into v_fu;

  if v_app.status in ('PENDING','UNDER_REVIEW','COMPLETED') then
    perform public.change_application_status(p_application_id, 'FOR_FOLLOW_UP', v_msg);
  end if;
  return v_fu;
end $$;

create or replace function public.resolve_follow_up(p_follow_up_id uuid, p_note text default null)
returns public.follow_ups
language plpgsql security definer set search_path = public as $$
declare
  v_fu public.follow_ups;
  v_status text;
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to resolve follow-ups.' using errcode = '42501';
  end if;
  update public.follow_ups
     set status = 'RESOLVED', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_follow_up_id and status = 'OPEN'
   returning * into v_fu;
  if not found then raise exception 'Follow-up not found or already resolved.' using errcode = 'P0002'; end if;

  select status into v_status from public.working_scholar_applications where id = v_fu.application_id;
  if v_status = 'FOR_FOLLOW_UP' and not exists (
    select 1 from public.follow_ups f where f.application_id = v_fu.application_id and f.status = 'OPEN') then
    perform public.change_application_status(v_fu.application_id, 'UNDER_REVIEW', 'All follow-ups resolved');
  end if;
  return v_fu;
end $$;

create or replace function public.register_scholar(p_application_id uuid, p_type text default 'NEW')
returns public.working_scholars
language plpgsql security definer set search_path = public as $$
declare
  v_app public.working_scholar_applications;
  v_row public.working_scholars;
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to register scholars.' using errcode = '42501';
  end if;
  if p_type not in ('NEW','PREVIOUS') then raise exception 'Invalid scholar type.'; end if;
  select * into v_app from public.working_scholar_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if v_app.status <> 'APPROVED' then raise exception 'Only approved applications can be registered as scholars.'; end if;
  if exists (select 1 from public.working_scholars where application_id = p_application_id) then
    raise exception 'This application is already registered as a scholar.';
  end if;
  insert into public.working_scholars (application_id, scholar_type, participation_status, accepted_at, created_by)
  values (p_application_id, p_type, 'INACTIVE', coalesce(v_app.decided_at::date, current_date), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Activation is serialized with slot changes, so slots can never be over-allocated.
create or replace function public.set_scholar_participation(p_scholar_id uuid, p_status text)
returns public.working_scholars
language plpgsql security definer set search_path = public as $$
declare
  v_row public.working_scholars;
  v_max integer;
  v_active bigint;
  v_app_status text;
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to change participation.' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'Invalid participation status.'; end if;
  perform pg_advisory_xact_lock(hashtext('working_scholar_slots'));
  select * into v_row from public.working_scholars where id = p_scholar_id for update;
  if not found then raise exception 'Scholar not found.' using errcode = 'P0002'; end if;
  if v_row.participation_status = p_status then raise exception 'Scholar is already %.', lower(p_status); end if;

  if p_status = 'ACTIVE' then
    select a.status into v_app_status from public.working_scholar_applications a where a.id = v_row.application_id;
    if v_app_status <> 'APPROVED' then raise exception 'Only scholars with an approved application can be activated.'; end if;
    select s.max_slots into v_max from public.slot_settings s order by s.created_at desc limit 1;
    if v_max is null then raise exception 'Slots have not been configured yet. Set the maximum slots first.'; end if;
    select count(*) into v_active from public.working_scholars where participation_status = 'ACTIVE';
    if v_active >= v_max then raise exception 'No slots available (% of % in use).', v_active, v_max; end if;
    update public.working_scholars set participation_status = 'ACTIVE', activated_at = now(), deactivated_at = null
      where id = p_scholar_id returning * into v_row;
  else
    update public.working_scholars set participation_status = 'INACTIVE', deactivated_at = now()
      where id = p_scholar_id returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.update_slot_settings(p_max integer, p_open boolean, p_note text default null)
returns public.slot_settings
language plpgsql security definer set search_path = public as $$
declare
  v_active bigint;
  v_row public.slot_settings;
begin
  if public.current_admin_role() is distinct from 'WORKING_SCHOLAR_ADMIN' then
    raise exception 'You are not authorized to change slot settings.' using errcode = '42501';
  end if;
  if p_max is null or p_max < 0 then raise exception 'Maximum slots must be zero or greater.'; end if;
  perform pg_advisory_xact_lock(hashtext('working_scholar_slots'));
  select count(*) into v_active from public.working_scholars where participation_status = 'ACTIVE';
  if p_max < v_active then
    raise exception 'Maximum slots (%) cannot be lower than the number of active scholars (%).', p_max, v_active;
  end if;
  insert into public.slot_settings (max_slots, applications_open, note, changed_by)
  values (p_max, coalesce(p_open, false), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- 5. READ FUNCTIONS (run as the caller, so RLS still applies)
-- ---------------------------------------------------------------------
-- Remaining Slots = Maximum Slots - Active Scholars
create or replace function public.slot_summary()
returns table (configured boolean, max_slots integer, applications_open boolean, active_scholars bigint, remaining integer)
language sql stable set search_path = public as $$
  with latest as (
    select s.max_slots as m, s.applications_open as o from public.slot_settings s order by s.created_at desc limit 1
  ),
  act as (select count(*) as n from public.working_scholars w where w.participation_status = 'ACTIVE')
  select exists (select 1 from latest),
         coalesce((select l.m from latest l), 0),
         coalesce((select l.o from latest l), false),
         (select a.n from act a),
         greatest(coalesce((select l.m from latest l), 0) - (select a.n from act a), 0)::integer
$$;

create or replace function public.application_status_counts()
returns table (status text, total bigint)
language sql stable set search_path = public as $$
  select a.status, count(*) from public.working_scholar_applications a group by a.status
$$;

create or replace function public.application_filter_options()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'courses', coalesce((select jsonb_agg(t.c order by t.c) from (
        select distinct a.course as c from public.working_scholar_applications a where a.course is not null) t), '[]'::jsonb),
    'offices', coalesce((select jsonb_agg(t.o order by t.o) from (
        select distinct a.assigned_office as o from public.working_scholar_applications a where a.assigned_office is not null) t), '[]'::jsonb)
  )
$$;

create or replace function public.report_summary(
  p_from date default null, p_to date default null, p_course text default null, p_office text default null)
returns jsonb language sql stable set search_path = public as $$
  with apps as (
    select a.* from public.working_scholar_applications a
    where (p_from is null or a.application_date >= p_from)
      and (p_to is null or a.application_date <= p_to)
      and (p_course is null or a.course = p_course)
      and (p_office is null or a.assigned_office = p_office)
  ),
  sch as (
    select w.scholar_no, w.participation_status, a.student_name, a.course, a.assigned_office, a.year_level
    from public.working_scholars w
    join public.working_scholar_applications a on a.id = w.application_id
    where (p_course is null or a.course = p_course) and (p_office is null or a.assigned_office = p_office)
  )
  select jsonb_build_object(
    'total_applications', (select count(*) from apps),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('label', s.status, 'total', s.total) order by s.status)
        from (select status, count(*) as total from apps group by status) s), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('label', m.month, 'total', m.total) order by m.month)
        from (select to_char(date_trunc('month', application_date), 'YYYY-MM') as month, count(*) as total
              from apps group by 1) m), '[]'::jsonb),
    'participation', coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'total', p.total) order by p.label)
        from (select participation_status as label, count(*) as total from sch group by 1) p), '[]'::jsonb),
    'by_course', coalesce((select jsonb_agg(jsonb_build_object('label', c.label, 'total', c.total, 'active', c.active) order by c.label)
        from (select coalesce(course, 'Unspecified') as label, count(*) as total,
                     count(*) filter (where participation_status = 'ACTIVE') as active
              from sch group by 1) c), '[]'::jsonb),
    'by_office', coalesce((select jsonb_agg(jsonb_build_object('label', o.label, 'total', o.total, 'active', o.active) order by o.label)
        from (select coalesce(assigned_office, 'Unassigned') as label, count(*) as total,
                     count(*) filter (where participation_status = 'ACTIVE') as active
              from sch group by 1) o), '[]'::jsonb),
    'fourth_year', coalesce((select jsonb_agg(to_jsonb(f) order by f.student_name)
        from (select scholar_no, student_name, course, assigned_office, year_level, participation_status
              from sch where year_level >= 4 order by student_name limit 200) f), '[]'::jsonb),
    'slots', (select to_jsonb(s) from public.slot_summary() s)
  )
$$;

-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.working_scholar_applications enable row level security;
alter table public.document_requirements enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_document_reviews enable row level security;
alter table public.follow_ups enable row level security;
alter table public.working_scholars enable row level security;
alter table public.application_status_history enable row level security;
alter table public.slot_settings enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: readable by active admins. NO insert/update/delete policy: only the server
-- (service role) or bootstrap_super_admin() can create or change profiles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_any_admin());

drop policy if exists apps_select on public.working_scholar_applications;
create policy apps_select on public.working_scholar_applications for select to authenticated
  using (public.is_any_admin());
drop policy if exists apps_insert on public.working_scholar_applications;
create policy apps_insert on public.working_scholar_applications for insert to authenticated
  with check (public.is_working_scholar_admin() and status = 'PENDING');
drop policy if exists apps_update on public.working_scholar_applications;
create policy apps_update on public.working_scholar_applications for update to authenticated
  using (public.is_working_scholar_admin()) with check (public.is_working_scholar_admin());

drop policy if exists req_select on public.document_requirements;
create policy req_select on public.document_requirements for select to authenticated using (public.is_any_admin());
drop policy if exists req_insert on public.document_requirements;
create policy req_insert on public.document_requirements for insert to authenticated with check (public.is_working_scholar_admin());
drop policy if exists req_update on public.document_requirements;
create policy req_update on public.document_requirements for update to authenticated
  using (public.is_working_scholar_admin()) with check (public.is_working_scholar_admin());

drop policy if exists docs_select on public.application_documents;
create policy docs_select on public.application_documents for select to authenticated using (public.is_any_admin());
drop policy if exists docs_insert on public.application_documents;
create policy docs_insert on public.application_documents for insert to authenticated with check (public.is_working_scholar_admin());
drop policy if exists docs_update on public.application_documents;
create policy docs_update on public.application_documents for update to authenticated
  using (public.is_working_scholar_admin()) with check (public.is_working_scholar_admin());

-- follow_ups, working_scholars, history, slot_settings: read-only for admins; writes go through functions above.
drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups for select to authenticated using (public.is_any_admin());
drop policy if exists scholars_select on public.working_scholars;
create policy scholars_select on public.working_scholars for select to authenticated using (public.is_any_admin());
drop policy if exists history_select on public.application_status_history;
create policy history_select on public.application_status_history for select to authenticated using (public.is_any_admin());
drop policy if exists slots_select on public.slot_settings;
create policy slots_select on public.slot_settings for select to authenticated using (public.is_any_admin());
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_super_admin());

-- ---------------------------------------------------------------------
-- 7. PRIVATE STORAGE FOR DOCUMENTS
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-documents', 'application-documents', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists app_docs_storage_select on storage.objects;
create policy app_docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'application-documents' and public.is_any_admin());
drop policy if exists app_docs_storage_insert on storage.objects;
create policy app_docs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'application-documents' and public.is_working_scholar_admin());
drop policy if exists app_docs_storage_delete on storage.objects;
create policy app_docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'application-documents' and public.is_working_scholar_admin());

-- ---------------------------------------------------------------------
-- 8. SECURE FIRST SUPER ADMIN
-- Step 1: create the user in Dashboard > Authentication > Users (Add user).
-- Step 2: run   select public.bootstrap_super_admin('you@school.edu', 'Your Name');
-- It only works while NO Super Admin exists, and only from the SQL editor
-- (it is not callable by the browser or the API).
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(p_email text, p_full_name text default 'Super Administrator')
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_user_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
    raise exception 'A Super Admin already exists. Use the Super Admin dashboard to manage accounts.';
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No Supabase Auth user with email %. Create the user in Authentication > Users first.', p_email;
  end if;
  insert into public.profiles (id, email, full_name, role, is_active)
  values (v_user_id, lower(btrim(p_email)), btrim(p_full_name), 'SUPER_ADMIN', true);
  return 'Super Admin created for ' || lower(btrim(p_email));
end $$;

-- ---------------------------------------------------------------------
-- 9. FUNCTION PERMISSIONS
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.current_admin_role()', 'public.is_super_admin()', 'public.is_working_scholar_admin()', 'public.is_any_admin()',
    'public.is_valid_status_transition(text,text)', 'public.change_application_status(uuid,text,text)',
    'public.create_follow_up(uuid,text,uuid,uuid)', 'public.resolve_follow_up(uuid,text)',
    'public.register_scholar(uuid,text)', 'public.set_scholar_participation(uuid,text)',
    'public.update_slot_settings(integer,boolean,text)', 'public.slot_summary()',
    'public.application_status_counts()', 'public.application_filter_options()',
    'public.report_summary(date,date,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;

  foreach s in array array[
    'public.bootstrap_super_admin(text,text)', 'public.audit_row_change()',
    'public.log_initial_status()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', s);
  end loop;
end $$;
