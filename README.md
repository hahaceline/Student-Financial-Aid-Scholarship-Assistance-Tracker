# Student Financial Aid & Scholarship Assistance Tracker

Next.js 15, React 19, TypeScript, Tailwind CSS, Supabase Auth and Postgres. Login uses real Supabase email/password accounts; no local mock identity is used by the login flow.

## Requirements

- Node.js 20 LTS or later
- A Supabase project with the Auth and Postgres APIs enabled

## Install and configure

From PowerShell in this folder:

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local
```

Configure the project URL and public anon/publishable key:

| Variable | Supabase source | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings > API > Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings > API > anon/publishable key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API > service_role/secret key | Private server-only |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally | Public |

Never expose, print, or commit `SUPABASE_SERVICE_ROLE_KEY`. `.env.local` is gitignored.

## Apply database schema and RLS

In the Supabase Dashboard SQL Editor, run these files in order:

1. `supabase/schema.sql`
2. `supabase/role-expansion.sql`

The role-expansion migration is intended to add Finance Admin and Student roles, application ownership, scholarship programs, requirement snapshots, document review history, and role-scoped policies. **Do not apply the currently checked-in `supabase/role-expansion.sql` as-is:** it is incomplete and does not contain the full scholarship-program and slot-summary schema expected by the application. Restore/review the complete migration before applying it to a database. Review schemas before applying to a database with existing custom tables.

When repairing an existing deployment, first verify that the Supabase Dashboard project reference matches the reference in `NEXT_PUBLIC_SUPABASE_URL`. If the base application tables already exist, apply `supabase/role-expansion.sql` only; do not rerun the base schema just to refresh the API cache. If the API still reports a stale schema after a successful migration, execute `NOTIFY pgrst, 'reload schema';` in that same project's SQL Editor.

After the complete role-expansion schema is installed, apply `supabase/working-scholar-opportunity-access.sql` to grant the Working Scholar Admin role access only to Working Scholar program records, enforce one active application per student/program, and add optional per-opportunity `max_slots`. It aborts without deleting data if prerequisites are missing or existing duplicate active applications need review. Working Scholar opportunities are managed from Slot Management; per-opportunity limits and publish state use `scholarship_programs`, and the existing schoolwide `slot_settings` remains an overall cap and controls whether applications are open. A program with no configured limit uses the shared cap. Occupied slots continue to mean activated scholars, matching the existing approval/activation rules; pending applications do not occupy slots.

Then apply `supabase/student-application-access.sql`. This migration is required for student submissions: it replaces the base admin-only insert policies with narrowly scoped policies for an authenticated student's own pending application and documents, and restricts document storage to that application owner. Do not substitute broader grants or disable row-level security. Confirm that the migration is applied to the same Supabase project configured by `NEXT_PUBLIC_SUPABASE_URL`.

## Create the four real Supabase accounts

There are no hard-coded passwords. Set `SETUP_EMAIL_DOMAIN=student.local` and private initial passwords of at least 12 characters in `.env.local`. Unless email overrides are set, the script provisions these Auth users:

- `superadmin@student.local` — Super Admin
- `workingscholar@student.local` — Working Scholar Admin
- `financeadmin@student.local` — Finance Admin
- `acdstudent@student.local` — Student

The `.local` domain is for development and does not receive mail. The provisioning script creates confirmed users through Supabase's server-side Admin API; it does not use email delivery. Set `SETUP_*_FULL_NAME` and `SETUP_*_PASSWORD` for each account. You can override an address with its matching `SETUP_*_EMAIL` variable.

Keep `SUPABASE_SERVICE_ROLE_KEY` private in that same file. `SUPABASE_URL` is optional; if omitted, the script uses `NEXT_PUBLIC_SUPABASE_URL`. Then run:

```powershell
npm run provision:accounts
```

The script creates users in Supabase Auth, links each profile to that Auth user's UUID, and can be rerun without duplicating users. It refuses a conflicting role assignment. New users are email-confirmed and must change their initial password on first sign-in. Existing Auth passwords are left untouched unless `RESET_EXISTING_ACCOUNT_PASSWORDS=true` is explicitly set. Output includes actual configured emails and roles, but never prints passwords. Use the values entered in your private `.env.local` as initial credentials.

The Super Admin User Management screen can also create Working Scholar Admin, Finance Admin, or Student users or send invitations. Invite and recovery links require the Supabase email templates to point at `/auth/callback` and the Site URL to match `NEXT_PUBLIC_SITE_URL`.

## Run

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Other checks:

```powershell
npm run typecheck
npm run lint
npm run build
```

## Live role workflows

- **Super Admin** → `/super-admin/dashboard`: administer user accounts, scholarship programs, and system-wide records.
- **Working Scholar Admin** → `/working-scholar/dashboard`: review and manage working-scholar records, configure shared slot capacity and application availability, publish Working Scholar opportunities and optional per-program slot limits from Slot Management, configure the Support Services document checklist, and review submitted documents.
- **Finance Admin** → `/finance/dashboard`: review financial-aid applications assigned to Finance and see Finance reports.
- **Student** → `/student/dashboard`: a student-oriented home, searchable internal programs, category and application-status filters, guided application submission with required-document uploads, application status history, profile name updates, real application activity, and help guidance. Academic applications enforce the interviewed program/GWA/grade rules and retain a per-program checklist snapshot. Existing Academic Scholars are monitored for continuation rather than prompted to reapply annually.

The Working Scholar checklist starts empty. The proposed identification/enrollment examples are not preloaded or represented as confirmed institutional policy; Support Services must confirm the official documents and upload limits before applications rely on them.

The role is taken from the authenticated user's `public.profiles` row. Server page/API checks and Postgres Row Level Security apply; Student data is constrained to the authenticated user's own profile ID, and Finance operations are scoped to financial-aid applications assigned to the Finance office. Status transitions remain validated by the database function.

After login, `public.profiles.id` must equal the authenticated Supabase user's ID. The role in that matching profile selects the landing page: Working Scholar Admin, Finance Admin, Super Admin, or Student. To switch roles, sign out and use the existing account for the intended role. If the matching profile has an incorrect role, have an authorized administrator correct the assignment; the app does not grant roles automatically.

For a fictional, read-only Scholars page preview during development, run `npm run dev` and open `/working-scholar/scholars?demo=1` while signed in as Working Scholar Admin. The page shows 30 clearly marked sample records using BSBA, BSIT, and EDUC. Samples are generated in the page only, are not written to Supabase, and cannot be activated or edited. Active demo previews are capped by currently remaining live capacity; actual slot summaries continue to count only persisted scholars. No database migration or seed script is needed.

Student application drafts are saved in that browser's local storage until submission because the current database schema does not include a draft model. Submitted applications, statuses, profile names, and uploaded files use Supabase. Optional office, benefit, and application dates are shown only when configured; Working Scholar availability combines actual activated scholars against the per-program limit (when configured) and the shared schoolwide cap. Deadlines, announcements, office contact details, and read/unread notification state are not invented when the database does not provide them.

## Troubleshooting

| Error | Action |
|---|---|
| `Supabase is not configured` | Check URL and public key in `.env.local`; restart `npm run dev`. |
| `Email or password is incorrect` | Supabase intentionally uses a generic response for an unknown user or wrong password. Check that the account is in this exact project, confirmed, and using the current password. |
| `profiles` returns `PGRST205` or 404 | Run `supabase/schema.sql` and then `supabase/role-expansion.sql` in the project matching `.env.local`; refresh the Supabase API schema cache if needed. |
| Student portal reports scholarship/application database errors or missing `scholarship_programs`, program metadata, `application_requirement_snapshots`, `application_type`, `student_user_id`, or the student slot summary | Apply `supabase/schema.sql` and then `supabase/role-expansion.sql` to the Supabase project configured in `.env.local`, and refresh its API schema cache. Verify the project URL before applying migrations. These schema objects are required by student opportunity and application queries; do not work around this by disabling RLS. |
| Student application submission returns HTTP 403 | Check the server log's `Database authorization denied` entry for the operation, SQLSTATE, message, details, and hint. The student application route uses the signed-in user's cookie-backed Supabase client and gets ownership from the active `profiles.id` matching `auth.uid()`; it does not trust a browser-supplied student ID. The base schema intentionally permits only staff to insert applications. Apply `supabase/student-application-access.sql` after the complete role-expansion and Working Scholar opportunity migrations in the same Supabase project configured by `NEXT_PUBLIC_SUPABASE_URL`. A local SQL file does not update the hosted database. |

To verify the migration in Supabase SQL Editor, first confirm that the dashboard project reference matches `NEXT_PUBLIC_SUPABASE_URL`, then run this read-only check:

```sql
select
  has_table_privilege('authenticated', 'public.working_scholar_applications', 'INSERT') as authenticated_can_insert_applications,
  has_sequence_privilege('authenticated', 'public.application_no_seq', 'USAGE') as authenticated_can_use_application_number_sequence,
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'working_scholar_applications'
       and policyname = 'apps_insert'
       and cmd = 'INSERT'
       and 'authenticated' = any(roles)
       and with_check like '%student_user_id%auth.uid%'
  ) as owner_scoped_student_insert_policy_present;
```

All three results should be `true`. This confirms the table grant, sequence access, and presence of the expected owner-scoped policy; it does not substitute for an end-to-end student submission test. If any result is `false`, apply the migration above to that project, confirm it completes, and rerun the check. For a complete verification, submit an eligible application while signed in as a Student, then verify the resulting row has `student_user_id = auth.uid()` and `status = 'PENDING'`; also confirm unauthenticated submissions return 401 and a student cannot insert a row for another profile.
| Login opens the wrong role portal | Sign out, confirm the intended email/account, and sign in again. The destination comes from the active `profiles` row whose `id` matches the authenticated Supabase user. Ask an authorized administrator to correct an erroneous profile role; do not edit Auth metadata to impersonate a role. |
| User has no profile | Run `npm run provision:accounts` after applying both SQL files. |
| `SUPABASE_SERVICE_ROLE_KEY` missing | Add it privately to `.env.local`; never use a `NEXT_PUBLIC_` variable for it. |
| `Could not find the function public.…` | Rerun the schema scripts and refresh the API schema cache. |
| Document upload fails | Confirm the private `application-documents` bucket from `schema.sql` exists. Each requirement's configured types and size limit are enforced within the bucket's PDF, PNG, JPEG, and WebP / 10 MB maximum. |
