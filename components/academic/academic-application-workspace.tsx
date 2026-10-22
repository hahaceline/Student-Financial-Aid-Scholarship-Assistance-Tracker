'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Row = Record<string, unknown>;
type Detail = {
  application: Row;
  documents: Row[];
  requirements: Row[];
  history: Row[];
  followUps: Row[];
  assessment: Row | null;
  subjectGrades: Row[];
  examination: Row | null;
  conflict: Row | null;
  scholarship: Row | null;
  gradeReviews: Row[];
  enrollments: Row[];
  award: Row | null;
};

function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function gradeRows(value: FormDataEntryValue | null) {
  return String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [subject, grade, correction_reason] = line.split('|').map((part) => part.trim());
    return { subject, grade: Number(grade), ...(correction_reason ? { correction_reason } : {}) };
  });
}

export function AcademicApplicationWorkspace({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/academic/applications/${id}`);
      const result = await response.json() as Detail & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Could not load application (${response.status}).`);
      setDetail(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load application.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function send(path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
      setNotice('Changes saved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  function handle(action: string, read: (form: FormData) => Record<string, unknown>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void send(`/api/academic/applications/${id}`, 'PATCH', { action, ...read(form) });
    };
  }

  async function openDocument(documentId: string) {
    setError('');
    try {
      const response = await fetch(`/api/documents/${documentId}`);
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? 'Could not open the private document.');
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open document.');
    }
  }

  if (loading) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading application…</p>;
  if (!detail) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error || 'Application not found.'}</p>;

  const app = detail.application;
  const scholarship = detail.scholarship;

  return (
    <main className="space-y-6">
      <header>
        <Link href="/academic/applications" className="text-sm font-medium text-sky-700 hover:underline">← Academic applications</Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{text(app.student_name)}</h1>
        <p className="mt-1 text-sm text-slate-600">{text(app.application_no)} · {text(app.course)} · Year {text(app.year_level)} · {text(app.status)}</p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Application documents</h2>
        <div className="mt-3 space-y-3">
          {detail.documents.map((document) => <div key={text(document.id)} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div><p className="font-medium text-slate-800">{text(document.file_name)}</p><p className="text-xs text-slate-500">Review: {text(document.review_status)} {document.review_remarks ? `· ${text(document.review_remarks)}` : ''}</p></div>
            <div className="flex flex-wrap gap-2">
              {typeof document.id === 'string' && <button type="button" onClick={() => void openDocument(document.id as string)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Open securely</button>}
              {typeof document.id === 'string' && <button type="button" disabled={busy} onClick={() => void send(`/api/documents/${document.id}`, 'PATCH', { review_status: 'ACCEPTED', review_remarks: null })} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Accept</button>}
              {typeof document.id === 'string' && <button type="button" disabled={busy} onClick={() => {
                const remarks = window.prompt('Explain what needs correction.');
                if (remarks?.trim()) void send(`/api/documents/${document.id}`, 'PATCH', { review_status: 'NEEDS_CORRECTION', review_remarks: remarks });
              }} className="rounded-md border border-amber-400 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-50">Request correction</button>}
            </div>
          </div>)}
          {detail.documents.length === 0 && <p className="text-sm text-slate-500">No uploaded documents.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Verify eligibility</h2>
        <p className="mt-1 text-sm text-slate-600">Enter verified grades and record enrollment, conflict, and exam requirements. A grade correction must include a reason in the third field.</p>
        <form onSubmit={handle('assessment', (form) => ({
          gwa: Number(form.get('gwa')),
          subject_grades: gradeRows(form.get('subject_grades')),
          enrollment_required: form.get('enrollment_required') === 'on',
          enrollment_verified: form.get('enrollment_verified') === 'on',
          conflict_reviewed: form.get('conflict_reviewed') === 'on',
          conflict_exists: form.get('conflict_exists') === 'on',
          conflict_resolution: String(form.get('conflict_resolution') ?? ''),
          examination_required: form.get('examination_required') === 'on',
          remarks: String(form.get('remarks') ?? ''),
        }))} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Verified GWA<input name="gwa" type="number" min="0" max="100" step="0.01" required defaultValue={text(detail.assessment?.gwa) === '—' ? text(app.gwa) === '—' ? '' : text(app.gwa) : text(detail.assessment?.gwa)} className="input mt-1" /></label>
          <label className="text-sm text-slate-700">Subject grades (one per line: subject | grade | correction reason)<textarea name="subject_grades" required defaultValue={detail.subjectGrades.map((grade) => `${text(grade.subject)} | ${text(grade.grade)}`).join('\n')} className="input mt-1" rows={4} placeholder="English | 90&#10;Mathematics | 88" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="enrollment_required" type="checkbox" defaultChecked={detail.assessment?.enrollment_required === true} /> Enrollment check required</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="enrollment_verified" type="checkbox" defaultChecked={detail.assessment?.enrollment_verified === true} /> Enrollment verified</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="conflict_reviewed" type="checkbox" defaultChecked={detail.assessment?.conflict_reviewed === true} /> Conflict review completed</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="conflict_exists" type="checkbox" defaultChecked={detail.assessment?.conflict_exists === true} /> Potential overlap identified</label>
          <label className="text-sm text-slate-700 sm:col-span-2">Conflict resolution<textarea name="conflict_resolution" defaultValue={text(detail.assessment?.conflict_resolution) === '—' ? '' : text(detail.assessment?.conflict_resolution)} className="input mt-1" rows={2} /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="examination_required" type="checkbox" defaultChecked={detail.assessment?.examination_required === true} /> Entrance examination required</label>
          <label className="text-sm text-slate-700 sm:col-span-2">Assessment remarks<textarea name="remarks" defaultValue={text(detail.assessment?.remarks) === '—' ? '' : text(detail.assessment?.remarks)} className="input mt-1" rows={2} /></label>
          <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{busy ? 'Saving…' : 'Save verified assessment'}</button>
        </form>
        <p className="mt-3 text-sm text-slate-600">Current result: <strong>{text(detail.assessment?.result)}</strong></p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Entrance examination</h2>
          <form onSubmit={handle('examination', (form) => ({
            scheduled_at: form.get('scheduled_at') ? new Date(String(form.get('scheduled_at'))).toISOString() : null,
            location: String(form.get('location') ?? ''), status: String(form.get('status')),
            reschedule_request: String(form.get('reschedule_request') ?? ''), remarks: String(form.get('remarks') ?? ''),
          }))} className="mt-3 grid gap-3">
            <label className="text-sm text-slate-700">Date and time<input name="scheduled_at" type="datetime-local" defaultValue={typeof detail.examination?.scheduled_at === 'string' ? detail.examination.scheduled_at.slice(0, 16) : ''} className="input mt-1" /></label>
            <label className="text-sm text-slate-700">Location<input name="location" defaultValue={text(detail.examination?.location) === '—' ? '' : text(detail.examination?.location)} className="input mt-1" /></label>
            <label className="text-sm text-slate-700">Status<select name="status" defaultValue={text(detail.examination?.status) === '—' ? 'PENDING' : text(detail.examination?.status)} className="input mt-1">
              {['PENDING', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED'].map((status) => <option key={status}>{status}</option>)}
            </select></label>
            <label className="text-sm text-slate-700">Reschedule request/remarks<textarea name="reschedule_request" defaultValue={text(detail.examination?.reschedule_request) === '—' ? '' : text(detail.examination?.reschedule_request)} className="input mt-1" /></label>
            <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save examination</button>
          </form>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Student feedback</h2>
          <form onSubmit={handle('feedback', (form) => ({ message: String(form.get('message') ?? '') }))} className="mt-3 space-y-3">
            <label className="block text-sm text-slate-700">Message<textarea name="message" minLength={3} maxLength={2000} required className="input mt-1" rows={4} /></label>
            <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send follow-up</button>
          </form>
          <ul className="mt-4 space-y-3">{detail.followUps.map((item) => <li key={text(item.id)} className="border-t border-slate-100 pt-3 text-sm"><p>{text(item.message)}</p><p className="mt-1 text-xs text-slate-500">{text(item.created_at)} · {text(item.status)}</p></li>)}</ul>
        </section>
      </div>

      {scholarship && <>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Continuing scholar monitoring</h2>
          <p className="mt-1 text-sm text-slate-600">Scholar status: {text(scholarship.status)}. Submit one monitored GWA and subject-grade set per semester.</p>
          <form onSubmit={handle('grade_review', (form) => ({
            scholarship_id: scholarship.id,
            academic_year: String(form.get('academic_year') ?? ''),
            semester: String(form.get('semester') ?? ''),
            gwa: Number(form.get('gwa')),
            subject_grades: gradeRows(form.get('subject_grades')),
            remarks: String(form.get('remarks') ?? ''),
          }))} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">Academic year<input name="academic_year" required placeholder="2025-2026" className="input mt-1" /></label>
            <label className="text-sm text-slate-700">Semester<input name="semester" required placeholder="1st Semester" className="input mt-1" /></label>
            <label className="text-sm text-slate-700">GWA<input name="gwa" type="number" min="0" max="100" step="0.01" required className="input mt-1" /></label>
            <label className="text-sm text-slate-700">Grades, one per line: subject | grade<textarea name="subject_grades" required className="input mt-1" rows={3} /></label>
            <label className="text-sm text-slate-700 sm:col-span-2">Remarks<textarea name="remarks" className="input mt-1" /></label>
            <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">Save semester review</button>
          </form>
          <div className="mt-4 space-y-2 text-sm">{detail.gradeReviews.map((grade) => <p key={text(grade.id)}>{text(grade.academic_year)} · {text(grade.semester)} · GWA {text(grade.gwa)} · {text(grade.status)}</p>)}</div>
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Verify enrollment</h2>
            <form onSubmit={handle('enrollment', (form) => ({
              scholarship_id: scholarship.id, academic_year: String(form.get('academic_year') ?? ''),
              semester: String(form.get('semester') ?? ''), status: String(form.get('status')),
              remarks: String(form.get('remarks') ?? ''),
            }))} className="mt-3 grid gap-3">
              <label className="text-sm text-slate-700">Academic year<input name="academic_year" required placeholder="2025-2026" className="input mt-1" /></label>
              <label className="text-sm text-slate-700">Semester<input name="semester" required placeholder="1st Semester" className="input mt-1" /></label>
              <label className="text-sm text-slate-700">Enrollment status<select name="status" className="input mt-1">{['ENROLLED', 'NOT_ENROLLED', 'TRANSFERRED_OUT', 'DROPPED_OUT', 'PENDING_VERIFICATION'].map((status) => <option key={status}>{status}</option>)}</select></label>
              <label className="text-sm text-slate-700">Remarks<textarea name="remarks" className="input mt-1" /></label>
              <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save enrollment</button>
            </form>
            <ul className="mt-3 space-y-1 text-sm">{detail.enrollments.map((record) => <li key={text(record.id)}>{text(record.academic_year)} · {text(record.semester)} · {text(record.status)}</li>)}</ul>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Award notice and scholar status</h2>
            {detail.award ? <p className="mt-2 text-sm text-slate-700">Award version {text(detail.award.terms_version)} · {detail.award.acknowledged_at ? `Acknowledged ${text(detail.award.acknowledged_at)}` : 'Awaiting student acknowledgment'}</p>
              : <form onSubmit={handle('award', (form) => ({ scholarship_id: scholarship.id, terms_version: String(form.get('terms_version') ?? ''), terms_text: String(form.get('terms_text') ?? '') }))} className="mt-3 space-y-3">
                <label className="block text-sm text-slate-700">Terms version<input name="terms_version" required defaultValue="1.0" className="input mt-1" /></label>
                <label className="block text-sm text-slate-700">Approved terms<textarea name="terms_text" minLength={20} required placeholder="Enter the institution-approved award terms, conditions, and renewal requirements." className="input mt-1" rows={4} /></label>
                <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Issue award notice</button>
              </form>}
          </section>
        </div>
        <form onSubmit={handle('scholar_status', (form) => ({ scholarship_id: scholarship.id, status: String(form.get('status')), reason: String(form.get('reason') ?? '') }))} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
          <label className="text-sm text-slate-700">Scholar status<select name="status" defaultValue={text(scholarship.status)} className="input mt-1">{['ACTIVE', 'FOR_REVIEW', 'REMOVED', 'COMPLETED'].map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="text-sm text-slate-700 sm:col-span-2">Reason (required for all status changes)<input name="reason" required minLength={1} maxLength={1000} className="input mt-1" /></label>
          <button disabled={busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3">Update scholar status</button>
        </form>
      </>}

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <h2 className="font-semibold text-slate-900 sm:col-span-2">Application decision</h2>
        <p className="text-sm text-slate-600 sm:col-span-2">Approval is enforced by the database: required documents, verified eligibility, conflict resolution, and required examination attendance must be complete.</p>
        {(['UNDER_REVIEW', 'COMPLETED', 'FOR_FOLLOW_UP', 'APPROVED', 'DENIED'] as const).map((status) => <button key={status} type="button" disabled={busy} onClick={() => {
          const reason = status === 'DENIED' || status === 'FOR_FOLLOW_UP' ? window.prompt(`Reason for ${status.toLowerCase().replaceAll('_', ' ')}?`) : '';
          if ((status !== 'DENIED' && status !== 'FOR_FOLLOW_UP') || reason?.trim()) void send(`/api/academic/applications/${id}`, 'PATCH', { action: 'status', status, reason: reason ?? '' });
        }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-sky-500 disabled:opacity-50">{status.replaceAll('_', ' ')}</button>)}
      </section>
    </main>
  );
}
