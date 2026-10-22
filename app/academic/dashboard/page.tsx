import Link from 'next/link';
import { BookOpenCheck, CalendarDays, FileText, GraduationCap } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { countOf } from '@/lib/queries';
import { requireRole } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function AcademicDashboardPage() {
  const { supabase } = await requireRole('ACADEMIC_ADMIN');
  const [applications, pending, scholars, examinations] = await Promise.all([
    supabase.from('working_scholar_applications')
      .select('id', { count: 'exact', head: true })
      .eq('application_type', 'ACADEMIC'),
    supabase.from('working_scholar_applications')
      .select('id', { count: 'exact', head: true })
      .eq('application_type', 'ACADEMIC')
      .eq('status', 'PENDING'),
    supabase.from('academic_scholarships').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('academic_examinations').select('id', { count: 'exact', head: true })
      .in('status', ['SCHEDULED', 'RESCHEDULED']),
  ]);
  const queryError = applications.error ?? pending.error ?? scholars.error ?? examinations.error;
  if (queryError) {
    console.error('Academic dashboard query failed:', queryError.code, queryError.message);
    throw new Error('Academic dashboard records could not be loaded.');
  }

  return (
    <>
      <PageHeader
        title="Academic Admin dashboard"
        description="Review incoming applications, verify eligibility, manage examinations, and monitor active scholars."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Academic applications" value={countOf(applications)} icon={FileText} />
        <StatCard label="Pending review" value={countOf(pending)} icon={BookOpenCheck} />
        <StatCard label="Active Academic scholars" value={countOf(scholars)} icon={GraduationCap} />
        <StatCard label="Scheduled examinations" value={countOf(examinations)} icon={CalendarDays} />
      </div>
      <nav aria-label="Academic workflow" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['/academic/applications', 'Review applications'],
          ['/academic/requirements', 'Manage requirements'],
          ['/academic/grade-monitoring', 'Monitor semester grades'],
          ['/academic/reports', 'View reports'],
        ].map(([href, label]) => <Link key={href} href={href} className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-sky-800 hover:border-sky-300 hover:bg-sky-50">{label} →</Link>)}
      </nav>
    </>
  );
}
