'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExaminationManager } from '@/components/academic/examination-manager';

type Row = Record<string, unknown>;
type SectionResponse = { rows: Row[]; rules?: Row | null };

const TITLES: Record<string, string> = {
  applications: 'Academic applications',
  requirements: 'Document requirements',
  eligibility: 'Eligibility assessments',
  examinations: 'Entrance examinations',
  'grade-monitoring': 'Semester grade monitoring',
  enrollment: 'Enrollment verification',
  scholars: 'Academic scholars',
  conflicts: 'Scholarship conflict review',
  feedback: 'Student feedback and follow-ups',
  reports: 'Academic reports',
  settings: 'Academic Scholarship settings',
};

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function recordLink(row: Row) {
  const id = typeof row.application_id === 'string' ? row.application_id : typeof row.id === 'string' ? row.id : null;
  return id ? `/academic/applications/${id}` : null;
}

export function AcademicSection({ section }: { section: string }) {
  const [data, setData] = useState<SectionResponse>({ rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/academic/sections?section=${encodeURIComponent(section)}`);
      const result = await response.json() as SectionResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Could not load records (${response.status}).`);
      setData({ rows: result.rows ?? [], rules: result.rules ?? null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load Academic records.');
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    if (section !== 'examinations') void load();
  }, [load, section]);

  const columns = useMemo(() => {
    const row = data.rows[0];
    if (!row) return [];
    return Object.keys(row).filter((key) => !['created_at', 'updated_at', 'verified_by', 'reviewed_by', 'managed_by', 'changed_by'].includes(key));
  }, [data.rows]);

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/academic/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        minimum_gwa: 90,
        minimum_subject_grade: 85,
          eligible_programs: ['BS Ed', 'BE Ed', 'BSSW'],
          benefits: String(form.get('benefits') ?? ''),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not save settings.');
      setNotice('Academic Scholarship settings saved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function submitRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/academic/requirements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''), description: String(form.get('description') ?? ''),
          is_required: form.get('is_required') === 'on', is_active: true, sort_order: Number(form.get('sort_order') ?? 0),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not add requirement.');
      formElement.reset();
      setNotice('Academic requirement added.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add requirement.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRequirement(id: string, isActive: boolean) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/academic/requirements', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, is_active: !isActive }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update requirement.');
      setNotice('Requirement state updated. Existing application checklists are unchanged.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update requirement.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleProgram(id: string, isActive: boolean) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/scholarship-programs/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !isActive }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update Academic opportunity.');
      setNotice('Academic opportunity state updated.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update Academic opportunity.');
    } finally {
      setSaving(false);
    }
  }

  const rules = data.rules;
  const title = TITLES[section] ?? 'Academic workspace';

  if (section === 'examinations') return <ExaminationManager />;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">Records and changes are restricted to the Academic Admin workspace.</p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {section === 'settings' && rules && (
        <form onSubmit={submitSettings} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <p className="text-sm font-medium text-slate-700">Minimum GWA<strong className="mt-1 block rounded-md bg-slate-50 px-3 py-2 text-slate-900">{valueText(rules.minimum_gwa)} (fixed qualification)</strong></p>
          <p className="text-sm font-medium text-slate-700">Minimum subject grade<strong className="mt-1 block rounded-md bg-slate-50 px-3 py-2 text-slate-900">{valueText(rules.minimum_subject_grade)} (fixed qualification)</strong></p>
          <p className="text-sm text-slate-600 sm:col-span-2">Eligible programs: BS Ed, BE Ed, and BSSW. IT and HM are not eligible.</p>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Benefits<textarea name="benefits" rows={3} maxLength={2000} defaultValue={valueText(rules.benefits)} required className="input mt-1" /></label>
          <button disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving…' : 'Save qualification settings'}</button>
        </form>
      )}

      {section === 'requirements' && (
        <form onSubmit={submitRequirement} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Requirement name<input name="name" minLength={2} maxLength={120} required className="input mt-1" /></label>
          <label className="text-sm font-medium text-slate-700">Display order<input name="sort_order" type="number" min="0" max="10000" defaultValue="50" className="input mt-1" /></label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Description<textarea name="description" maxLength={500} className="input mt-1" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="is_required" defaultChecked /> Required for application approval</label>
          <button disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add requirement'}</button>
        </form>
      )}

      {section === 'settings' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Academic Scholarship opportunities</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.rows.map((row) => <li key={valueText(row.id)} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span><strong>{valueText(row.name)}</strong> · {row.is_active ? 'Active' : 'Inactive'} · Opens {valueText(row.opens_at)} · Deadline {valueText(row.deadline)}</span>
              {typeof row.id === 'string' && <button type="button" disabled={saving} onClick={() => void toggleProgram(row.id as string, row.is_active === true)} className="font-medium text-sky-700 hover:underline">{row.is_active ? 'Close applications' : 'Open applications'}</button>}
            </li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Only Academic Admin can publish Academic opportunities. Opening applications requires active, required Academic documents.</p>
          <Link href="/academic/programs" className="mt-3 inline-flex rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white">Manage opportunities</Link>
        </section>
      )}

      {loading ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading records…</p> : data.rows.length === 0
        ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No records found in this section yet.</p>
        : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
              {columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 font-semibold">{column.replaceAll('_', ' ')}</th>)}
              {section !== 'settings' && <th className="px-4 py-3">Action</th>}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row, index) => {
                const href = recordLink(row);
                return <tr key={valueText(row.id) === '—' ? `${section}-${index}` : valueText(row.id)}>
                  {columns.map((column) => <td key={column} className="max-w-sm px-4 py-3 align-top text-slate-700">{valueText(row[column])}</td>)}
                  {section !== 'settings' && <td className="whitespace-nowrap px-4 py-3">
                    {section === 'requirements' && typeof row.id === 'string'
                      ? <button type="button" disabled={saving} onClick={() => void toggleRequirement(row.id as string, row.is_active === true)} className="font-medium text-sky-700 hover:underline">{row.is_active ? 'Deactivate' : 'Activate'}</button>
                      : href ? <Link className="font-medium text-sky-700 hover:underline" href={href}>Review application</Link> : null}
                  </td>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      {!loading && section !== 'applications' && section !== 'requirements' && section !== 'settings' && <p className="text-xs text-slate-500">Use the related application review to record changes, including examination scheduling, grade and enrollment verification, and student follow-up.</p>}
    </main>
  );
}
