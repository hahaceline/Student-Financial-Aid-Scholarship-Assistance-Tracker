'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bell, ChevronDown, Command, LayoutDashboard, LogOut, Menu, Search, UserRound, X } from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { ROLE_HOME } from '@/lib/role-config';
import { ROLE_LABELS, type AdminRole } from '@/lib/types';

type QuickLink = { label: string; href: string; description: string };

const WORKSPACE_LINKS: Record<AdminRole, QuickLink[]> = {
  SUPER_ADMIN: [
    { label: 'Dashboard', href: '/super-admin/dashboard', description: 'System overview' },
    { label: 'Scholarship programs', href: '/super-admin/programs', description: 'Manage available programs' },
    { label: 'User management', href: '/super-admin/users', description: 'Manage accounts and roles' },
  ],
  ACADEMIC_ADMIN: [
    { label: 'Dashboard', href: '/academic/dashboard', description: 'Academic Scholarship overview' },
  ],
  WORKING_SCHOLAR_ADMIN: [
    { label: 'Dashboard', href: '/working-scholar/dashboard', description: 'Program overview and recent activity' },
    { label: 'Applications', href: '/working-scholar/applications', description: 'Search and review applications' },
    { label: 'Requirements', href: '/working-scholar/requirements', description: 'Manage documents and reviews' },
    { label: 'Follow-ups', href: '/working-scholar/follow-ups', description: 'View open student follow-ups' },
    { label: 'Scholars', href: '/working-scholar/scholars', description: 'Monitor scholar participation' },
    { label: 'Slot management', href: '/working-scholar/slots', description: 'Review capacity and availability' },
    { label: 'Reports', href: '/working-scholar/reports', description: 'View program reports' },
    { label: 'Profile', href: '/working-scholar/profile', description: 'Update your profile' },
  ],
  FINANCE_ADMIN: [
    { label: 'Finance dashboard', href: '/finance/dashboard', description: 'Financial aid overview' },
    { label: 'Financial aid applications', href: '/finance/applications', description: 'Review financial aid applications' },
    { label: 'Finance reports', href: '/finance/reports', description: 'View finance reports' },
  ],
  STUDENT: [
    { label: 'Dashboard', href: '/student/dashboard', description: 'Your student overview' },
    { label: 'Explore opportunities', href: '/student/programs', description: 'Find scholarship opportunities' },
    { label: 'My applications', href: '/student/applications', description: 'Track your applications' },
    { label: 'Requirements', href: '/student/documents', description: 'Review document requirements' },
    { label: 'Notifications', href: '/student/notifications', description: 'View application updates' },
    { label: 'Profile', href: '/student/profile', description: 'Update your profile' },
    { label: 'Help and support', href: '/student/help', description: 'Get help with your account' },
  ],
};

function dashboardHref(role: AdminRole) {
  return ROLE_HOME[role];
}

function profileHref(role: AdminRole) {
  if (role === 'WORKING_SCHOLAR_ADMIN') return '/working-scholar/profile';
  if (role === 'STUDENT') return '/student/profile';
  return null;
}

export function AdminHeader({
  role, fullName, email, onMenu,
}: { role: AdminRole; fullName: string; email: string; onMenu: () => void }) {
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<'quick' | 'account' | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'A';
  const links = WORKSPACE_LINKS[role];
  const profile = profileHref(role);
  const filteredLinks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return links;
    return links.filter((link) => `${link.label} ${link.description}`.toLowerCase().includes(normalized));
  }, [links, query]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    searchTrigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMenu(null);
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        if (searchOpen) closeSearch();
        if (menu) setMenu(null);
      }
      if (!searchOpen || filteredLinks.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % filteredLinks.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + filteredLinks.length) % filteredLinks.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        router.push(filteredLinks[activeIndex]?.href ?? filteredLinks[0].href);
        setSearchOpen(false);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, closeSearch, filteredLinks, menu, router, searchOpen]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !controls.current?.contains(event.target)) setMenu(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menu]);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 sm:px-6">
      <div className="mx-auto flex h-20 max-w-[1700px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:border-sky-300 hover:bg-sky-50 lg:hidden" onClick={onMenu} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden min-w-0 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Student Financial Aid &amp; Scholarship Assistance Tracker</p>
            <p className="mt-1 text-base font-semibold text-slate-800">{ROLE_LABELS[role]} Portal</p>
          </div>
        </div>

        <div ref={controls} className="relative flex items-center gap-2 sm:gap-3">
          <button ref={searchTrigger} type="button" aria-label="Open quick navigation (Ctrl+K)" title="Quick navigation (Ctrl+K)" onClick={() => { setMenu(null); setSearchOpen(true); }} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700">
            <Search className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Open workspace shortcuts" aria-expanded={menu === 'quick'} onClick={() => setMenu((value) => value === 'quick' ? null : 'quick')} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700">
            <Bell className="h-4 w-4" />
          </button>

          <button type="button" aria-label="Open account menu" aria-expanded={menu === 'account'} onClick={() => setMenu((value) => value === 'account' ? null : 'account')} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:border-sky-300 hover:bg-sky-50">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white" aria-hidden="true">{initials}</div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-semibold text-slate-800">{fullName}</p>
              <p className="text-[11px] text-slate-500">{ROLE_LABELS[role]}</p>
            </div>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>

          {menu === 'quick' && (
            <div className="absolute right-14 top-14 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-lg" role="menu" aria-label="Workspace shortcuts">
              <div className="border-b border-slate-200 px-3 py-2">
                <p className="text-sm font-bold text-slate-900">Workspace shortcuts</p>
                <p className="text-xs text-slate-600">Jump to a section in your {ROLE_LABELS[role]} workspace.</p>
              </div>
              <div className="mt-1 max-h-[min(65vh,28rem)] overflow-y-auto">
                {links.slice(0, 5).map((link) => (
                  <Link key={link.href} href={link.href} role="menuitem" onClick={() => setMenu(null)} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-sky-50 focus:bg-sky-50">
                    <span><span className="block font-semibold text-slate-900">{link.label}</span><span className="block text-xs text-slate-600">{link.description}</span></span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-sky-700" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {menu === 'account' && (
            <div className="absolute right-0 top-14 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-lg" role="menu" aria-label="Account menu">
              <div className="border-b border-slate-200 px-3 py-2">
                <p className="truncate text-sm font-bold text-slate-900">{fullName}</p>
                <p className="truncate text-xs text-slate-600">{email}</p>
              </div>
              <Link href={dashboardHref(role)} role="menuitem" onClick={() => setMenu(null)} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-sky-50">
                <LayoutDashboard className="h-4 w-4 text-sky-700" />Workspace dashboard
              </Link>
              {profile && <Link href={profile} role="menuitem" onClick={() => setMenu(null)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-sky-50">
                <UserRound className="h-4 w-4 text-sky-700" />Profile settings
              </Link>}
              <form action={logoutAction} className="border-t border-slate-200 pt-1">
                <button type="submit" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50">
                  <LogOut className="h-4 w-4" />Log out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSearch(); }}>
          <section role="dialog" aria-modal="true" aria-label="Quick navigation" className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4">
              <Search className="h-5 w-5 shrink-0 text-sky-700" />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workspace pages..."
                aria-label="Search workspace pages"
                className="header-search-input h-14 min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none focus:border-transparent focus:ring-0"
              />
              <button type="button" onClick={closeSearch} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-sky-300 hover:text-sky-700" aria-label="Close quick navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
              {filteredLinks.length ? filteredLinks.map((link, index) => (
                <button
                  type="button"
                  key={link.href}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => { router.push(link.href); closeSearch(); }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition ${activeIndex === index ? 'bg-sky-100 text-sky-950' : 'text-slate-800 hover:bg-slate-100'}`}
                >
                  <span className="flex items-center gap-3"><Command className="h-4 w-4 text-sky-700" /><span><span className="block text-sm font-semibold">{link.label}</span><span className="block text-xs text-slate-600">{link.description}</span></span></span>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                </button>
              )) : <p className="px-4 py-8 text-center text-sm text-slate-600">No workspace pages match “{query}”.</p>}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
              <span>Navigate with ↑ ↓ and Enter</span><span>Esc to close</span>
            </div>
          </section>
        </div>
      )}
    </header>
  );
}
