'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Bell, BookOpenCheck, CalendarDays, CircleHelp, ClipboardCheck, FileText, Gauge, GraduationCap,
  LayoutDashboard, LogOut, MessageSquareWarning, Settings2, UserCircle, Users, X, type LucideIcon,
} from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import type { AdminRole } from '@/lib/types';

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: Record<AdminRole, NavItem[]> = {
  SUPER_ADMIN: [
    { href: '/super-admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/super-admin/programs', label: 'Scholarship Programs', icon: GraduationCap },
    { href: '/super-admin/users', label: 'User Management', icon: Users },
  ],
  ACADEMIC_ADMIN: [
    { href: '/academic/dashboard', label: 'Academic Dashboard', icon: LayoutDashboard },
    { href: '/academic/applications', label: 'Applications', icon: FileText },
    { href: '/academic/requirements', label: 'Requirements', icon: ClipboardCheck },
    { href: '/academic/eligibility', label: 'Eligibility Review', icon: BookOpenCheck },
    { href: '/academic/examinations', label: 'Examinations', icon: CalendarDays },
    { href: '/academic/grade-monitoring', label: 'Grade Monitoring', icon: GraduationCap },
    { href: '/academic/enrollment', label: 'Enrollment', icon: Users },
    { href: '/academic/scholars', label: 'Scholars', icon: GraduationCap },
    { href: '/academic/conflicts', label: 'Conflict Review', icon: MessageSquareWarning },
    { href: '/academic/feedback', label: 'Student Feedback', icon: Bell },
    { href: '/academic/reports', label: 'Reports', icon: BarChart3 },
    { href: '/academic/settings', label: 'Settings', icon: Settings2 },
  ],
  WORKING_SCHOLAR_ADMIN: [
    { href: '/working-scholar/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/working-scholar/applications', label: 'Applications', icon: FileText },
    { href: '/working-scholar/requirements', label: 'Requirements', icon: ClipboardCheck },
    { href: '/working-scholar/follow-ups', label: 'Follow-ups', icon: MessageSquareWarning },
    { href: '/working-scholar/scholars', label: 'Scholars', icon: GraduationCap },
    { href: '/working-scholar/slots', label: 'Slot Management', icon: Gauge },
    { href: '/working-scholar/reports', label: 'Reports', icon: BarChart3 },
    { href: '/working-scholar/profile', label: 'Profile', icon: UserCircle },
  ],
  FINANCE_ADMIN: [
    { href: '/finance/dashboard', label: 'Finance Dashboard', icon: LayoutDashboard },
    { href: '/finance/applications', label: 'Financial Aid Applications', icon: FileText },
    { href: '/finance/reports', label: 'Finance Reports', icon: BarChart3 },
  ],
  STUDENT: [
    { href: '/student/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/student/programs', label: 'Explore Opportunities', icon: GraduationCap },
    { href: '/student/applications', label: 'My Applications', icon: FileText },
    { href: '/student/documents', label: 'Requirements', icon: ClipboardCheck },
    { href: '/student/notifications', label: 'Notifications', icon: Bell },
    { href: '/student/profile', label: 'My Profile', icon: UserCircle },
    { href: '/student/help', label: 'Help & Support', icon: CircleHelp },
  ],
};

export function AdminSidebar({
  role, fullName, email, open, onClose,
}: { role: AdminRole; fullName: string; email: string; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'A';

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/35 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        data-role={role}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-20 items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-slate-800">Aid Tracker</p>
              <p className="text-[11px] text-slate-500">Scholarship assistance</p>
            </div>
          </div>
          <button type="button" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV[role].map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                  active
                    ? 'border-sky-100 bg-sky-50 text-sky-800 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-sky-600'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', active ? 'bg-white text-sky-700' : 'bg-slate-100 text-slate-500')}>
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{fullName}</p>
                <p className="truncate text-[11px] text-slate-500">{email}</p>
              </div>
            </div>
          </div>

          <form action={logoutAction} className="mt-3">
            <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              <LogOut className="h-4 w-4" />Log Out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
