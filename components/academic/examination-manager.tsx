'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck2,
  Pencil,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ExaminationStatus = 'PENDING' | 'SCHEDULED' | 'ATTENDED' | 'MISSED' | 'RESCHEDULED' | 'CANCELLED';
type ExaminationResult = 'PENDING' | 'PASSED' | 'FAILED';

type Examination = {
  id: string;
  application_id: string | null;
  applicant_name: string | null;
  applicant_number: string | null;
  course: string | null;
  scheduled_at: string | null;
  location: string | null;
  examination_type: string;
  assigned_examiner: string | null;
  status: ExaminationStatus;
  score: number | null;
  passing_score: number | null;
  result: ExaminationResult;
  result_remarks: string | null;
  result_recorded_at: string | null;
  remarks: string | null;
};

type ApplicationOption = {
  id: string;
  application_no: string;
  student_name: string;
  student_number: string | null;
  course: string;
  year_level: number;
  has_examination: boolean;
};

type Stats = { scheduled: number; completed: number; results: number; followUp: number };
type ApiData = { rows: Examination[]; total: number; page: number; pageSize: number; applications: ApplicationOption[]; stats: Stats };
type Filters = { search: string; course: string; date: string; status: string };
type ModalState =
  | { type: 'form'; examination: Examination | null }
  | { type: 'view'; examination: Examination }
  | { type: 'result'; examination: Examination }
  | null;

const STATUSES: ExaminationStatus[] = ['PENDING', 'SCHEDULED', 'RESCHEDULED', 'ATTENDED', 'MISSED', 'CANCELLED'];
const STATUS_LABELS: Record<ExaminationStatus, string> = {
  PENDING: 'Pending',
  SCHEDULED: 'Scheduled',
  ATTENDED: 'Completed',
  MISSED: 'Missed',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
};
const PAGE_SIZE = 10;

async function readResponse<T>(response: Response): Promise<T & { error?: string }> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The request could not be completed.');
  return body;
}

function localDateTime(value: string | null) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function displayDate(value: string | null) {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function displayTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function Badge({ children, tone }: { children: ReactNode; tone: 'blue' | 'green' | 'amber' | 'red' | 'gray' }) {
  const colors = {
    blue: 'border-sky-200 bg-sky-50 text-sky-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    gray: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>{children}</span>;
}

function statusTone(status: ExaminationStatus): 'blue' | 'green' | 'amber' | 'red' | 'gray' {
  if (status === 'ATTENDED') return 'green';
  if (status === 'SCHEDULED' || status === 'RESCHEDULED') return 'blue';
  if (status === 'MISSED' || status === 'CANCELLED') return 'red';
  return 'amber';
}

function resultTone(result: ExaminationResult): 'green' | 'red' | 'amber' {
  if (result === 'PASSED') return 'green';
  if (result === 'FAILED') return 'red';
  return 'amber';
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close dialog">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, hint }: { label: string; value: number; icon: LucideIcon; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 border-l-4 border-l-sky-600 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <span className="rounded-lg bg-sky-50 p-2 text-sky-700"><Icon className="h-5 w-5" /></span>
      </div>
    </div>
  );
}

export function ExaminationManager() {
  const [data, setData] = useState<ApiData>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    applications: [],
    stats: { scheduled: 0, completed: 0, results: 0, followUp: 0 },
  });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ search: '', course: '', date: '', status: '' });
  const [appliedFilters, setAppliedFilters] = useState<Filters>({ search: '', course: '', date: '', status: '' });
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await fetch(`/api/academic/examinations?${params.toString()}`);
      const result = await readResponse<ApiData>(response);
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load examination records.');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);

  useEffect(() => { void load(); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedFilters(filters);
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>, examination: Examination | null) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get('date') ?? '');
    const time = String(form.get('time') ?? '');
    const scheduled = new Date(`${date}T${time}`);
    if (!date || !time || Number.isNaN(scheduled.getTime())) {
      setError('Enter a valid examination date and time.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...(examination ? { action: 'schedule', id: examination.id } : {}),
        application_id: String(form.get('application_id') ?? '') || null,
        applicant_name: String(form.get('applicant_name') ?? '').trim(),
        applicant_number: String(form.get('applicant_number') ?? '').trim(),
        course: String(form.get('course') ?? '').trim(),
        scheduled_at: scheduled.toISOString(),
        location: String(form.get('location') ?? '').trim(),
        examination_type: String(form.get('examination_type') ?? '').trim(),
        assigned_examiner: String(form.get('assigned_examiner') ?? '').trim(),
        status: String(form.get('status') ?? 'SCHEDULED'),
        remarks: String(form.get('remarks') ?? '').trim() || null,
      };
      const response = await fetch('/api/academic/examinations', {
        method: examination ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await readResponse<{ examination: Examination }>(response);
      setModal(null);
      setNotice(examination ? 'Examination details updated.' : 'Examination scheduled.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the examination.');
    } finally {
      setSaving(false);
    }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>, examination: Examination) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = String(form.get('result') ?? 'PENDING') as ExaminationResult;
    const scoreValue = String(form.get('score') ?? '').trim();
    const passingValue = String(form.get('passing_score') ?? '').trim();
    const score = result === 'PENDING' ? null : Number(scoreValue);
    const passingScore = result === 'PENDING' ? null : Number(passingValue);
    if (result !== 'PENDING' && (
      scoreValue === '' || passingValue === '' || score === null || passingScore === null || !Number.isFinite(score) || !Number.isFinite(passingScore)
      || score < 0 || score > 100 || passingScore < 0 || passingScore > 100
    )) {
      setError('Enter valid examination and passing scores from 0 to 100.');
      return;
    }
    if (result === 'PASSED' && score! < passingScore!) {
      setError('A passing result requires an examination score equal to or above the passing score.');
      return;
    }
    if (result === 'FAILED' && score! >= passingScore!) {
      setError('A failed result requires an examination score below the passing score.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/academic/examinations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'result',
          id: examination.id,
          score,
          passing_score: passingScore,
          result,
          remarks: String(form.get('result_remarks') ?? '').trim() || null,
        }),
      });
      await readResponse<{ examination: Examination }>(response);
      setModal(null);
      setNotice('Examination result saved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the examination result.');
    } finally {
      setSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Entrance examinations</h1>
          <p className="mt-1 text-sm text-slate-600">Manage schedules and results for applicants who require an examination.</p>
        </div>
        <button type="button" onClick={() => { setError(''); setModal({ type: 'form', examination: null }); }} className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-800">
          <Plus className="h-4 w-4" />Add Examination
        </button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section aria-label="Examination summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total scheduled examinations" value={data.stats.scheduled} icon={CalendarDays} hint="Not cancelled" />
        <SummaryCard label="Completed examinations" value={data.stats.completed} icon={CheckCircle2} hint="Attendance completed" />
        <SummaryCard label="Results recorded" value={data.stats.results} icon={FileCheck2} hint="Passed or failed" />
        <SummaryCard label="Applicants for follow-up" value={data.stats.followUp} icon={UserRound} hint="Missed or failed" />
      </section>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative text-sm font-medium text-slate-700">
          <span>Applicant</span>
          <Search className="pointer-events-none absolute left-3 top-[2.15rem] h-4 w-4 text-slate-400" />
          <input className="input mt-1 pl-9" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Name or number" />
        </label>
        <label className="text-sm font-medium text-slate-700">Course or program
          <input className="input mt-1" value={filters.course} onChange={(event) => setFilters({ ...filters, course: event.target.value })} placeholder="Search course" />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination date
          <input className="input mt-1" type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
        </label>
        <label className="text-sm font-medium text-slate-700">Status
          <select className="input mt-1" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Apply filters</button>
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Examination records</h2>
          <p className="text-sm text-slate-500">{data.total} record{data.total === 1 ? '' : 's'}</p>
        </div>
        {loading ? <p className="p-6 text-sm text-slate-600">Loading examination records…</p>
          : data.rows.length === 0 ? <div className="p-8 text-center">
            <BookOpenCheck className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 font-medium text-slate-800">No examination records found</p>
            <p className="mt-1 text-sm text-slate-500">Add a schedule or change your filters to see matching records.</p>
          </div>
            : <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Applicant Name</th>
                    <th className="px-4 py-3">Applicant Number</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Examination Date</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Venue</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Result</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((examination) => (
                    <tr key={examination.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{examination.applicant_name || 'Applicant details unavailable'}</td>
                      <td className="px-4 py-3 text-slate-700">{examination.applicant_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{examination.course || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{displayDate(examination.scheduled_at)}</td>
                      <td className="px-4 py-3 text-slate-700">{displayTime(examination.scheduled_at)}</td>
                      <td className="px-4 py-3 text-slate-700">{examination.location || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{examination.score === null ? '—' : `${examination.score} / ${examination.passing_score ?? '—'}`}</td>
                      <td className="px-4 py-3"><Badge tone={resultTone(examination.result)}>{examination.result}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={statusTone(examination.status)}>{STATUS_LABELS[examination.status]}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button type="button" title="View examination" aria-label={`View ${examination.applicant_name ?? 'applicant'} examination`} onClick={() => setModal({ type: 'view', examination })} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-sky-700"><Eye className="h-4 w-4" /></button>
                          <button type="button" title="Edit or reschedule" aria-label={`Edit ${examination.applicant_name ?? 'applicant'} examination`} onClick={() => { setError(''); setModal({ type: 'form', examination }); }} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-sky-700"><Pencil className="h-4 w-4" /></button>
                          <button type="button" title={examination.status === 'ATTENDED' ? 'Record result' : 'Mark examination completed before recording the result'} aria-label={`Record result for ${examination.applicant_name ?? 'applicant'}`} disabled={examination.status !== 'ATTENDED'} onClick={() => { setError(''); setModal({ type: 'result', examination }); }} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"><ClipboardList className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span>{data.total === 0 ? '0 records' : `Page ${page} of ${totalPages}`}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40">Previous</button>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>

      {modal?.type === 'form' && (
        <ScheduleForm
          key={modal.examination?.id ?? 'new-examination'}
          examination={modal.examination}
          applications={data.applications}
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={(event) => void saveSchedule(event, modal.examination)}
        />
      )}
      {modal?.type === 'result' && (
        <ResultForm
          key={modal.examination.id}
          examination={modal.examination}
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={(event) => void saveResult(event, modal.examination)}
        />
      )}
      {modal?.type === 'view' && <ExaminationDetails examination={modal.examination} onClose={() => setModal(null)} />}
    </main>
  );
}

function ScheduleForm({
  examination, applications, saving, onClose, onSubmit,
}: {
  examination: Examination | null;
  applications: ApplicationOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const scheduled = localDateTime(examination?.scheduled_at ?? null);
  const [applicationId, setApplicationId] = useState(examination?.application_id ?? '');
  const [applicantName, setApplicantName] = useState(examination?.applicant_name ?? '');
  const [applicantNumber, setApplicantNumber] = useState(examination?.applicant_number ?? '');
  const [course, setCourse] = useState(examination?.course ?? '');
  const application = applications.find((item) => item.id === applicationId);

  function selectApplication(id: string) {
    setApplicationId(id);
    const selected = applications.find((item) => item.id === id);
    if (selected) {
      setApplicantName(selected.student_name);
      setApplicantNumber(selected.student_number ?? '');
      setCourse(selected.course);
    }
  }

  return (
    <Dialog title={examination ? 'Edit examination' : 'Add examination'} onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Link eligible Academic application (optional)
          <select name="application_id" className="input mt-1" value={applicationId} onChange={(event) => selectApplication(event.target.value)}>
            <option value="">Standalone applicant</option>
            {applications.map((item) => (
              <option key={item.id} value={item.id} disabled={item.has_examination && item.id !== examination?.application_id}>
                {item.student_name} · {item.application_no}{item.has_examination && item.id !== examination?.application_id ? ' · already scheduled' : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">Only applications marked as requiring an examination can be linked.</span>
        </label>
        <label className="text-sm font-medium text-slate-700">Applicant name
          <input name="applicant_name" required maxLength={200} className="input mt-1" value={applicantName} readOnly={Boolean(application)} onChange={(event) => setApplicantName(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">Applicant or student number
          <input name="applicant_number" required maxLength={64} className="input mt-1" value={applicantNumber} readOnly={Boolean(application?.student_number)} onChange={(event) => setApplicantNumber(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">Course or program
          <input name="course" required maxLength={160} className="input mt-1" value={course} readOnly={Boolean(application)} onChange={(event) => setCourse(event.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination type
          <input name="examination_type" required maxLength={120} className="input mt-1" defaultValue={examination?.examination_type ?? 'Entrance Examination'} />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination date
          <input name="date" type="date" required className="input mt-1" defaultValue={scheduled.date} />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination time
          <input name="time" type="time" required className="input mt-1" defaultValue={scheduled.time} />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination venue
          <input name="location" required maxLength={300} className="input mt-1" defaultValue={examination?.location ?? ''} />
        </label>
        <label className="text-sm font-medium text-slate-700">Assigned examiner
          <input name="assigned_examiner" required maxLength={160} className="input mt-1" defaultValue={examination?.assigned_examiner ?? ''} />
        </label>
        <label className="text-sm font-medium text-slate-700">Examination status
          <select name="status" className="input mt-1" defaultValue={examination?.status ?? 'SCHEDULED'}>
            {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Remarks
          <textarea name="remarks" rows={2} maxLength={1000} className="input mt-1" defaultValue={examination?.remarks ?? ''} />
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : examination ? 'Save changes' : 'Schedule examination'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ResultForm({
  examination, saving, onClose, onSubmit,
}: {
  examination: Examination;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [result, setResult] = useState<ExaminationResult>(examination.result);
  return (
    <Dialog title="Record examination result" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2">
          <p className="font-semibold text-slate-900">{examination.applicant_name}</p>
          <p className="mt-1 text-slate-600">{examination.applicant_number} · {examination.course}</p>
        </div>
        <label className="text-sm font-medium text-slate-700">Examination score
          <input name="score" type="number" min="0" max="100" step="0.01" required={result !== 'PENDING'} disabled={result === 'PENDING'} className="input mt-1" defaultValue={examination.score ?? ''} />
        </label>
        <label className="text-sm font-medium text-slate-700">Passing score
          <input name="passing_score" type="number" min="0" max="100" step="0.01" required={result !== 'PENDING'} disabled={result === 'PENDING'} className="input mt-1" defaultValue={examination.passing_score ?? ''} />
        </label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Result
          <select name="result" className="input mt-1" value={result} onChange={(event) => setResult(event.target.value as ExaminationResult)}>
            <option value="PENDING">Pending</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">Result remarks
          <textarea name="result_remarks" rows={3} maxLength={1000} className="input mt-1" defaultValue={examination.result_remarks ?? ''} />
        </label>
        {examination.result_recorded_at && <p className="text-xs text-slate-500 sm:col-span-2">Last recorded {new Date(examination.result_recorded_at).toLocaleString()}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save result'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ExaminationDetails({ examination, onClose }: { examination: Examination; onClose: () => void }) {
  const fields = [
    ['Applicant name', examination.applicant_name],
    ['Applicant number', examination.applicant_number],
    ['Course or program', examination.course],
    ['Examination type', examination.examination_type],
    ['Date', displayDate(examination.scheduled_at)],
    ['Time', displayTime(examination.scheduled_at)],
    ['Venue', examination.location],
    ['Assigned examiner', examination.assigned_examiner],
    ['Score', examination.score === null ? 'Not recorded' : String(examination.score)],
    ['Passing score', examination.passing_score === null ? 'Not recorded' : String(examination.passing_score)],
    ['Result', examination.result],
    ['Result recorded', examination.result_recorded_at ? new Date(examination.result_recorded_at).toLocaleString() : 'Not recorded'],
    ['Remarks', examination.result_remarks || examination.remarks || '—'],
  ];
  return (
    <Dialog title="Examination details" onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={statusTone(examination.status)}>{STATUS_LABELS[examination.status]}</Badge>
        <Badge tone={resultTone(examination.result)}>{examination.result}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Close</button>
      </div>
    </Dialog>
  );
}
