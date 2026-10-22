'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

export function AcademicProgramForm() {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    const requirements = String(form.get('requirements') ?? '').split('\n').map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/scholarship-programs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          application_type: 'ACADEMIC',
          category: 'ACADEMIC',
          description: String(form.get('description') ?? ''),
          eligibility: String(form.get('eligibility') ?? ''),
          requirements,
          is_active: form.get('is_active') === 'on',
          benefits: String(form.get('benefits') ?? ''),
          opens_at: String(form.get('opens_at') ?? '') || null,
          deadline: String(form.get('deadline') ?? '') || null,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not create the Academic Scholarship opportunity.');
      window.location.href = '/academic/settings';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the Academic Scholarship opportunity.');
      setSaving(false);
    }
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Create Academic Scholarship opportunity</h1>
        <p className="mt-1 text-sm text-slate-600">Eligibility remains limited to BS Ed, BE Ed, and BSSW, with a minimum 90 GWA and 85 in every subject. Configure official required documents before accepting applications.</p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <form onSubmit={submit} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Opportunity name<input name="name" minLength={3} maxLength={120} required defaultValue="Academic Scholarship" className="input mt-1" /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Description<textarea name="description" maxLength={2000} required className="input mt-1" rows={3} /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Eligibility criteria<textarea name="eligibility" maxLength={2000} required defaultValue="Incoming first-year applicants in BS Ed, BE Ed, or BSSW; minimum GWA 90 and no subject grade below 85. IT and HM are not eligible." className="input mt-1" rows={3} /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Program requirements, one per line<textarea name="requirements" required placeholder="Enter institution-approved requirements" className="input mt-1" rows={4} /></label>
        <label className="text-sm font-medium text-slate-700">Application opens<input name="opens_at" type="date" className="input mt-1" /></label>
        <label className="text-sm font-medium text-slate-700">Application deadline<input name="deadline" type="date" className="input mt-1" /></label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Benefits<textarea name="benefits" maxLength={2000} placeholder="Enter institution-approved scholarship benefits" className="input mt-1" rows={2} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="is_active" defaultChecked /> Accepting applications</label>
        <div className="flex items-center gap-3 sm:justify-end">
          <Link href="/academic/settings" className="text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</Link>
          <button type="submit" disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Create opportunity'}</button>
        </div>
      </form>
    </main>
  );
}
