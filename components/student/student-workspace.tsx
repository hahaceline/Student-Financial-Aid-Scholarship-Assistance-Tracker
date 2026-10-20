'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight, Bell, BookOpenCheck, Building2, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp,
  Clock3, CloudUpload, FileCheck2, FileText, GraduationCap, Loader2, Search,
  ShieldCheck, Sparkles, UserRound, X,
} from 'lucide-react';

type ProgramType = 'WORKING_SCHOLAR' | 'FINANCIAL_AID';
type ScholarshipCategory = 'ACADEMIC' | 'WORKING_SCHOLAR' | 'SPORTS_ATHLETICS' | 'GAD' | 'OTHER_INTERNAL';
type OpportunityStatus = 'Open' | 'Closing Soon' | 'Upcoming' | 'Full' | 'Closed';
type EligibilityStatus = 'Eligible' | 'Not Eligible' | 'Check Requirements';
type Program = {
  id: string;
  name: string;
  application_type: ProgramType;
  description: string;
  eligibility: string;
  requirements: string[];
  is_active: boolean;
  category?: ScholarshipCategory;
  responsible_office?: string | null;
  benefits?: string | null;
  opens_at?: string | null;
  deadline?: string | null;
  assigned_office?: string | null;
  max_slots?: number | null;
};
type ProgramSlotSummary = {
  program_id: string;
  configured: boolean;
  max_slots: number;
  applications_open: boolean;
  active_scholars: number;
  remaining: number;
  uses_program_limit: boolean;
};
type Requirement = {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  application_type: ProgramType;
  program_id?: string | null;
  accepted_mime_types: string[];
  max_file_size_bytes: number;
};
type ApplicationRequirement = Omit<Requirement, 'is_active'>;
type ApplicationDocument = {
  id: string;
  requirement_id: string | null;
  file_name: string;
  review_status: string;
  review_remarks: string | null;
  created_at?: string;
};
type Application = {
  id: string;
  application_no: string;
  student_name: string;
  course: string;
  year_level: number;
  application_date: string;
  updated_at: string;
  status: string;
  application_type: ProgramType;
  program_id?: string | null;
  program?: { name: string; category: ScholarshipCategory } | null;
  gwa?: number | null;
  lowest_subject_grade?: number | null;
  requirements?: ApplicationRequirement[];
  review_remarks: string | null;
  denial_reason: string | null;
  documents: ApplicationDocument[];
};
type Profile = { id: string; email: string; full_name: string };
type HistoryEntry = { id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string };
type FollowUp = { id: string; message: string; status: string; created_at: string };
type ApplicationDetail = {
  application: Application;
  requirements: ApplicationRequirement[];
  documents: ApplicationDocument[];
  history: HistoryEntry[];
  followUps: FollowUp[];
  activeScholar?: boolean;
};

const DRAFT_KEY = 'student-aid-application-draft-v1';
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending review',
  UNDER_REVIEW: 'Under review',
  COMPLETED: 'Review completed',
  FOR_FOLLOW_UP: 'Action required',
  APPROVED: 'Approved',
  DENIED: 'Not approved',
  INACTIVE: 'Inactive',
};
const DASHBOARD_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending review',
  UNDER_REVIEW: 'Under review',
  COMPLETED: 'Review completed',
  FOR_FOLLOW_UP: 'For follow-up',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  INACTIVE: 'Inactive',
};
async function readJson<T>(response: Response, source?: string): Promise<T> {
  const body = await response.text();
  let result: T & { error?: string };
  try {
    result = JSON.parse(body) as T & { error?: string };
  } catch {
    throw new Error(`${source ? `${source}: ` : ''}The server returned an invalid response.`);
  }
  if (!response.ok) {
    const prefix = source ? `${source} (HTTP ${response.status})` : `Request failed (HTTP ${response.status})`;
    throw new Error(`${prefix}: ${result.error ?? 'The request could not be completed.'}`);
  }
  return result;
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function loadError(cause: unknown, source: string, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  return message.startsWith(`${source} `) ? message : `${source}: ${message || fallback}`;
}

function niceDate(value: string | null | undefined) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
}

function applicationTypeLabel(type: ProgramType) {
  return type === 'WORKING_SCHOLAR' ? 'Working Scholar Program' : 'Financial aid & scholarship';
}

const CATEGORY_LABELS: Record<ScholarshipCategory, string> = {
  ACADEMIC: 'Academic Scholarship',
  WORKING_SCHOLAR: 'Working Scholar',
  SPORTS_ATHLETICS: 'Sports/Athletics',
  GAD: 'Gender and Development',
  OTHER_INTERNAL: 'Other Internal Scholarships',
};

function scholarshipCategory(program: Program): ScholarshipCategory {
  if (/academic scholarship/i.test(program.name)) return 'ACADEMIC';
  if (program.application_type === 'WORKING_SCHOLAR') return 'WORKING_SCHOLAR';
  if (program.category) return program.category;
  if (/academic/i.test(program.name)) return 'ACADEMIC';
  if (/sports?|athletic/i.test(program.name)) return 'SPORTS_ATHLETICS';
  if (/gender and development|\bGAD\b/i.test(program.name)) return 'GAD';
  return 'OTHER_INTERNAL';
}

function applicationStatus(program: Program, slots: ProgramSlotSummary | undefined): OpportunityStatus {
  if (!program.is_active) return 'Closed';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (program.opens_at && program.opens_at > today) return 'Upcoming';
  if (program.deadline && program.deadline < today) return 'Closed';
  if (program.application_type === 'WORKING_SCHOLAR') {
    if (!slots?.configured) return 'Upcoming';
    if (slots.remaining <= 0) return 'Full';
    if (!slots.applications_open) return 'Closed';
  }
  if (program.deadline) {
    const deadline = new Date(`${program.deadline}T00:00:00+08:00`);
    const todayInManila = new Date(`${today}T00:00:00+08:00`);
    const daysRemaining = Math.ceil((deadline.getTime() - todayInManila.getTime()) / 86400000);
    if (daysRemaining <= 14) return 'Closing Soon';
  }
  return 'Open';
}

function isAcademic(program: Program) {
  return scholarshipCategory(program) === 'ACADEMIC';
}

function eligibilityStatus(program: Program, applications: Application[]): EligibilityStatus {
  if (!isAcademic(program)) return 'Check Requirements';

  const studentRecord = applications.find((application) => (
    application.status === 'APPROVED'
    && application.course.trim()
    && application.year_level !== null
    && application.year_level !== undefined
  ));
  if (!studentRecord) return 'Check Requirements';

  const course = studentRecord.course.toLocaleLowerCase().replace(/[^a-z]/g, '');
  if (!['bsed', 'beed', 'bssw'].includes(course) || studentRecord.year_level !== 1) {
    return 'Not Eligible';
  }
  if (studentRecord.gwa === null || studentRecord.gwa === undefined
    || studentRecord.lowest_subject_grade === null || studentRecord.lowest_subject_grade === undefined) {
    return 'Check Requirements';
  }
  return studentRecord.gwa >= 90 && studentRecord.lowest_subject_grade >= 85
    ? 'Eligible'
    : 'Not Eligible';
}

function isClosingWithin(program: Program, days: number) {
  if (!program.deadline) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const deadline = new Date(`${program.deadline}T00:00:00+08:00`);
  const todayInManila = new Date(`${today}T00:00:00+08:00`);
  const daysRemaining = Math.ceil((deadline.getTime() - todayInManila.getTime()) / 86400000);
  return daysRemaining >= 0 && daysRemaining <= days;
}

function Pill({ children, color = 'sky' }: { children: React.ReactNode; color?: 'sky' | 'green' | 'amber' | 'slate' }) {
  const styles = {
    sky: 'bg-sky-100 text-sky-800',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-900',
    slate: 'bg-slate-100 text-slate-700',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles[color]}`}>{children}</span>;
}

export function StudentWorkspace() {
  const pathname = usePathname();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [workingScholarProgramSlots, setWorkingScholarProgramSlots] = useState<Record<string, ProgramSlotSummary>>({});
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [programRequirements, setProgramRequirements] = useState<Requirement[]>([]);
  const [programRequirementsLoading, setProgramRequirementsLoading] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationTotal, setApplicationTotal] = useState(0);
  const [applicationPage, setApplicationPage] = useState(1);
  const [morePending, setMorePending] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [programsLoaded, setProgramsLoaded] = useState(false);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [conflictCheckLoaded, setConflictCheckLoaded] = useState(false);
  const [hasActiveScholarshipConflict, setHasActiveScholarshipConflict] = useState(false);
  const [requirementsLoaded, setRequirementsLoaded] = useState(false);
  const [dashboardDetail, setDashboardDetail] = useState<ApplicationDetail | null>(null);
  const [dashboardDetailLoading, setDashboardDetailLoading] = useState(false);
  const [dashboardDetailError, setDashboardDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'ALL' | ScholarshipCategory>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'ACADEMIC' | ProgramType>('ALL');
  const [eligibilityFilter, setEligibilityFilter] = useState<'ALL' | EligibilityStatus>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OpportunityStatus>('ALL');
  const [deadlineFilter, setDeadlineFilter] = useState<'ALL' | '7_DAYS' | '30_DAYS' | 'NO_DEADLINE'>('ALL');
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);
  const [applyStep, setApplyStep] = useState(0);
  const [course, setCourse] = useState('');
  const [yearLevel, setYearLevel] = useState('1');
  const [gwa, setGwa] = useState('');
  const [lowestGrade, setLowestGrade] = useState('');
  const [applicationFiles, setApplicationFiles] = useState<Record<string, File>>({});
  const [submitPending, setSubmitPending] = useState(false);
  const [submitted, setSubmitted] = useState<{ reference: string; applicationId: string; status: string } | null>(null);
  const [createdApplication, setCreatedApplication] = useState<{ id: string; application_no: string; status: string } | null>(null);
  const [uploadedApplicationFiles, setUploadedApplicationFiles] = useState<Record<string, boolean>>({});
  const [applicationFileErrors, setApplicationFileErrors] = useState<Record<string, string>>({});
  const applicationDialogRef = useRef<HTMLElement>(null);
  const submissionInFlight = useRef(false);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState('');
  const [uploading, setUploading] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePending, setProfilePending] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const draftKey = profile?.id ? `${DRAFT_KEY}:${profile.id}` : null;
  const latestApplication = applications[0] ?? null;
  const latestApplicationId = latestApplication?.id;
  const requiredProgramRequirements = programRequirements.filter((requirement) => requirement.is_required);
  const selectedRequiredDocuments = requiredProgramRequirements.filter((requirement) => applicationFiles[requirement.id]).length;

  function closeApplication() {
    if (submitPending) return;
    if (createdApplication && !submitted) {
      if (!window.confirm('Your application record has been created, but some documents are not confirmed uploaded. Close now? You can finish uploading from Requirements & Documents.')) return;
      setApplyProgram(null);
      return;
    }
    const hasUnsavedWork = Boolean(course.trim() || gwa || lowestGrade || Object.keys(applicationFiles).length);
    if (hasUnsavedWork && !submitted && !window.confirm('Close this application? Your selected files will be discarded. Your academic details are saved in this browser.')) return;
    setApplyProgram(null);
  }

  const closeApplicationRef = useRef(closeApplication);
  closeApplicationRef.current = closeApplication;

  useEffect(() => {
    if (!applyProgram) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    applicationDialogRef.current?.focus();

    function trapFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeApplicationRef.current();
        return;
      }
      if (event.key !== 'Tab' || !applicationDialogRef.current) return;
      const focusable = [...applicationDialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', trapFocus);
      previouslyFocused?.focus();
    };
  }, [applyProgram]);

  const view = pathname.endsWith('/programs') ? 'programs'
    : pathname.endsWith('/applications') ? 'applications'
      : pathname.endsWith('/documents') ? 'documents'
        : pathname.endsWith('/notifications') ? 'notifications'
          : pathname.endsWith('/profile') ? 'profile'
            : pathname.endsWith('/help') ? 'help' : 'dashboard';

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgramsLoaded(false);
    setApplicationsLoaded(false);
    setConflictCheckLoaded(false);
    setRequirementsLoaded(false);
    const requests = await Promise.allSettled([
      fetch('/api/scholarship-programs'),
      fetch('/api/applications?page=1'),
      fetch('/api/student/profile'),
      fetch('/api/requirements?application_type=WORKING_SCHOLAR'),
      fetch('/api/requirements?application_type=FINANCIAL_AID'),
      fetch('/api/student/applications'),
    ]);
    const failures: string[] = [];
    try {
      if (requests[0].status === 'rejected') throw requests[0].reason;
      const result = await readJson<{ programs: Program[]; workingScholarProgramSlots: ProgramSlotSummary[] }>(requests[0].value, 'Scholarship programs');
      setPrograms(result.programs);
      setWorkingScholarProgramSlots(Object.fromEntries(result.workingScholarProgramSlots.map((slots) => [slots.program_id, slots])));
      setProgramsLoaded(true);
    } catch (cause) {
      failures.push(loadError(cause, 'Scholarship programs', 'Scholarship opportunities could not be loaded.'));
    }
    try {
      if (requests[1].status === 'rejected') throw requests[1].reason;
      const result = await readJson<{ applications: Application[]; total: number }>(requests[1].value, 'Your applications');
      setApplications(result.applications);
      setApplicationTotal(result.total);
      setApplicationPage(1);
      setApplicationsLoaded(true);
    } catch (cause) {
      failures.push(loadError(cause, 'Your applications', 'Applications could not be loaded.'));
    }
    try {
      if (requests[2].status === 'rejected') throw requests[2].reason;
      const result = await readJson<{ profile: Profile }>(requests[2].value, 'Your student profile');
      setProfile(result.profile);
      setProfileName(result.profile.full_name ?? '');
    } catch (cause) {
      failures.push(loadError(cause, 'Your student profile', 'Your profile could not be loaded.'));
    }
    const allRequirements: Requirement[] = [];
    let requirementRequestsSucceeded = true;
    for (const [index, source] of [[3, 'Working Scholar requirements'], [4, 'Financial Aid requirements']] as const) {
      try {
        if (requests[index].status === 'rejected') throw requests[index].reason;
        const result = await readJson<{ requirements: Requirement[] }>(requests[index].value, source);
        allRequirements.push(...result.requirements);
      } catch (cause) {
        requirementRequestsSucceeded = false;
        failures.push(loadError(cause, source, `${source} could not be loaded.`));
      }
    }
    try {
      if (requests[5].status === 'rejected') throw requests[5].reason;
      const result = await readJson<{ hasActiveConflict: boolean }>(requests[5].value, 'Scholarship conflict check');
      setHasActiveScholarshipConflict(result.hasActiveConflict);
      setConflictCheckLoaded(true);
    } catch (cause) {
      failures.push(loadError(cause, 'Scholarship conflict check', 'Existing scholarship conflicts could not be checked.'));
    }
    setRequirements(allRequirements);
    setRequirementsLoaded(requirementRequestsSucceeded);
    setError(failures.join(' '));
    setLoading(false);
    setDraftReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!applyProgram) {
      setProgramRequirements([]);
      setProgramRequirementsLoading(false);
      return;
    }
    let cancelled = false;
    setProgramRequirements([]);
    setProgramRequirementsLoading(true);
    void fetch(`/api/requirements?application_type=${applyProgram.application_type}&program_id=${applyProgram.id}`)
      .then((response) => readJson<{ requirements: Requirement[] }>(response, 'Scholarship documents'))
      .then((result) => { if (!cancelled) setProgramRequirements(result.requirements); })
      .catch((cause: unknown) => {
        if (!cancelled) setError(loadError(cause, 'Scholarship documents', 'The scholarship document checklist could not be loaded.'));
      })
      .finally(() => { if (!cancelled) setProgramRequirementsLoading(false); });
    return () => { cancelled = true; };
  }, [applyProgram]);

  useEffect(() => {
    if (view !== 'dashboard' || !latestApplicationId) {
      setDashboardDetail(null);
      setDashboardDetailError('');
      setDashboardDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDashboardDetail(null);
    setDashboardDetailError('');
    setDashboardDetailLoading(true);
    void fetch(`/api/applications/${latestApplicationId}`)
      .then((response) => readJson<ApplicationDetail>(response))
      .then((result) => { if (!cancelled) setDashboardDetail(result); })
      .catch((cause: unknown) => {
        if (!cancelled) setDashboardDetailError(cause instanceof Error ? cause.message : 'Application updates could not be loaded.');
      })
      .finally(() => { if (!cancelled) setDashboardDetailLoading(false); });
    return () => { cancelled = true; };
  }, [latestApplicationId, view]);

  useEffect(() => {
    if (!draftReady || !draftKey) return;
    try {
      const draft = JSON.parse(window.localStorage.getItem(draftKey) ?? '{}') as {
        course?: string; yearLevel?: string; programId?: string;
      };
      if (typeof draft.course === 'string') setCourse(draft.course);
      if (typeof draft.yearLevel === 'string') setYearLevel(draft.yearLevel);
      if (draft.programId) {
        const match = programs.find((program) => program.id === draft.programId);
        if (match) setApplyProgram(match);
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey, draftReady, programs]);

  useEffect(() => {
    if (!draftReady || !draftKey || submitted) return;
    window.localStorage.setItem(draftKey, JSON.stringify({
      course, yearLevel, programId: applyProgram?.id ?? '',
    }));
  }, [applyProgram?.id, course, draftKey, draftReady, submitted, yearLevel]);

  const filteredPrograms = useMemo(() => programs.filter((program) => {
    const label = CATEGORY_LABELS[scholarshipCategory(program)];
    const matchesQuery = `${program.name} ${label} ${program.application_type} ${program.description} ${program.eligibility} ${program.requirements.join(' ')}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === 'ALL' || scholarshipCategory(program) === category;
    const matchesType = typeFilter === 'ALL'
      || (typeFilter === 'ACADEMIC' ? isAcademic(program) : program.application_type === typeFilter);
    const matchesStatus = statusFilter === 'ALL' || applicationStatus(program, workingScholarProgramSlots[program.id]) === statusFilter;
    const matchesEligibility = eligibilityFilter === 'ALL' || eligibilityStatus(program, applications) === eligibilityFilter;
    const matchesDeadline = deadlineFilter === 'ALL'
      || (deadlineFilter === 'NO_DEADLINE' ? !program.deadline
        : isClosingWithin(program, deadlineFilter === '7_DAYS' ? 7 : 30));
    return matchesQuery && matchesCategory && matchesType && matchesStatus && matchesEligibility && matchesDeadline;
  }), [applications, category, deadlineFilter, eligibilityFilter, programs, query, statusFilter, typeFilter, workingScholarProgramSlots]);

  const availableOpportunityCount = programs.filter((program) => {
    const status = applicationStatus(program, workingScholarProgramSlots[program.id]);
    return status === 'Open' || status === 'Closing Soon';
  }).length;
  const eligibleOpportunityCount = programs.filter((program) => eligibilityStatus(program, applications) === 'Eligible').length;
  const closingSoonCount = programs.filter((program) => applicationStatus(program, workingScholarProgramSlots[program.id]) === 'Closing Soon').length;

  function startApplication(program: Program) {
    setApplyProgram(program);
    setApplyStep(0);
    setSubmitted(null);
    setYearLevel('1');
    setGwa('');
    setLowestGrade('');
    setApplicationFiles({});
    setCreatedApplication(null);
    setUploadedApplicationFiles({});
    setApplicationFileErrors({});
    setNotice('');
  }

  function continueApplication() {
    if (!applyProgram) return;
    setError('');
    if (applyStep === 1) {
      if (course.trim().length < 2) {
        setError('Enter your course or academic program before continuing.');
        return;
      }
      if (!isAcademic(applyProgram) && (!Number.isInteger(Number(yearLevel)) || Number(yearLevel) < 1 || Number(yearLevel) > 8)) {
        setError('Enter a current year level from 1 to 8.');
        return;
      }
      if (isAcademic(applyProgram)) {
        const normalizedCourse = course.toLocaleLowerCase().replace(/[^a-z]/g, '');
        if (!['bsed', 'beed', 'bssw'].includes(normalizedCourse)) {
          setError('Academic Scholarship applications are limited to BS Ed, BE Ed, and BSSW. IT and HM are not eligible.');
          return;
        }
        if (!gwa || !lowestGrade || Number(gwa) < 90 || Number(lowestGrade) < 85) {
          setError('To continue, your GWA must be 90 or above and no subject grade may be below 85.');
          return;
        }
      }
      if (programRequirementsLoading) {
        setError('Wait for the scholarship document checklist to finish loading.');
        return;
      }
      const missingUploads = requiredProgramRequirements.filter((requirement) => !applicationFiles[requirement.id]);
      if (missingUploads.length) {
        setError(`Select the required documents before continuing: ${missingUploads.map((item) => item.name).join(', ')}.`);
        return;
      }
      const invalidUploads = requiredProgramRequirements.filter((requirement) => applicationFileErrors[requirement.id]);
      if (invalidUploads.length) {
        setError('Fix the highlighted document issues before continuing.');
        return;
      }
    }
    setApplyStep((step) => Math.min(step + 1, 2));
  }

  function selectApplicationFile(requirement: Requirement, file: File | undefined, input: HTMLInputElement) {
    if (!file) return;
    const maxBytes = Math.min(requirement.max_file_size_bytes, 10 * 1024 * 1024);
    let validationError = '';
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / 1024 / 1024 * 10) / 10;
      validationError = `File is larger than ${maxMb} MB. Please choose a smaller file.`;
    } else if (!requirement.accepted_mime_types.includes(file.type)) {
      const formats = requirement.accepted_mime_types
        .map((type) => type === 'application/pdf' ? 'PDF' : type === 'image/jpeg' ? 'JPG' : type === 'image/png' ? 'PNG' : type === 'image/webp' ? 'WebP' : type)
        .join(', ');
      validationError = `This file format is not supported. Please upload ${formats}.`;
    }
    if (validationError) {
      setApplicationFileErrors((current) => ({ ...current, [requirement.id]: validationError }));
      input.value = '';
      return;
    }
    setApplicationFiles((current) => ({ ...current, [requirement.id]: file }));
    input.value = '';
    setApplicationFileErrors((current) => {
      const next = { ...current };
      delete next[requirement.id];
      return next;
    });
    setError('');
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!applyProgram || submissionInFlight.current) return;
    if (programRequirementsLoading) {
      setError('Wait for the scholarship document checklist to finish loading.');
      return;
    }
    const missingUploads = requiredProgramRequirements.filter((requirement) => !applicationFiles[requirement.id]);
    if (missingUploads.length) {
      setError(`Upload the required documents before submitting: ${missingUploads.map((item) => item.name).join(', ')}.`);
      return;
    }
    if (Object.keys(applicationFileErrors).length) {
      setError('Fix the highlighted document issues before submitting.');
      return;
    }
    submissionInFlight.current = true;
    setSubmitPending(true);
    setError('');
    setNotice('');
    try {
      const selectedFiles = new Map<string, string>();
      for (const [requirementId, file] of Object.entries(applicationFiles)) {
        const digest = await sha256File(file);
        const priorRequirementId = selectedFiles.get(digest);
        if (priorRequirementId) {
          const priorName = programRequirements.find((requirement) => requirement.id === priorRequirementId)?.name ?? 'another requirement';
          const currentName = programRequirements.find((requirement) => requirement.id === requirementId)?.name ?? 'this requirement';
          throw new Error(`The same file is selected for "${priorName}" and "${currentName}". Choose a separate file for each document requirement.`);
        }
        selectedFiles.set(digest, requirementId);
      }

      let application = createdApplication;
      if (!application) {
        const result = await readJson<{ application: { id: string; application_no: string; status: string }; possibleConflict: boolean }>(
          await fetch('/api/student/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              program_id: applyProgram.id, course, year_level: isAcademic(applyProgram) ? 1 : Number(yearLevel),
              ...(isAcademic(applyProgram) ? { gwa: Number(gwa), lowest_grade: Number(lowestGrade) } : {}),
            }),
          }),
          'Application record creation',
        );
        application = result.application;
        setCreatedApplication(application);
        setHasActiveScholarshipConflict(result.possibleConflict);
      }
      const uploadFailures: string[] = [];
      for (const [requirementId, file] of Object.entries(applicationFiles)) {
        if (uploadedApplicationFiles[requirementId]) continue;
        const requirementName = programRequirements.find((requirement) => requirement.id === requirementId)?.name ?? file.name;
        const form = new FormData();
        form.set('application_id', application.id);
        form.set('requirement_id', requirementId);
        form.set('file', file);
        try {
          await readJson(await fetch('/api/documents', { method: 'POST', body: form }), `Upload "${requirementName}"`);
          setUploadedApplicationFiles((current) => ({ ...current, [requirementId]: true }));
        } catch (cause) {
          uploadFailures.push(`${requirementName}: ${cause instanceof Error ? cause.message : 'Upload failed.'}`);
        }
      }
      if (uploadFailures.length) {
        throw new Error(`Your application record was created, but these documents are not uploaded yet: ${uploadFailures.join(', ')}. Retry here to finish submitting, or close and upload them from Requirements & Documents.`);
      }
      setSubmitted({ reference: application.application_no, applicationId: application.id, status: application.status });
      if (draftKey) window.localStorage.removeItem(draftKey);
      setNotice('Your application and selected documents were submitted. The responsible office will review them.');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your application could not be submitted.');
    } finally {
      submissionInFlight.current = false;
      setSubmitPending(false);
    }
  }

  async function uploadRequirement(applicationId: string, requirementId: string, file: File | undefined) {
    if (!file) return;
    const application = applications.find((item) => item.id === applicationId);
    const requirement = application?.requirements?.find((item) => item.id === requirementId)
      ?? requirements.find((item) => item.id === requirementId);
    const maxBytes = requirement?.max_file_size_bytes ?? 10 * 1024 * 1024;
    const acceptedTypes = requirement?.accepted_mime_types ?? ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (file.size > maxBytes) {
      setError(`The selected file exceeds the maximum permitted size of ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB.`);
      return;
    }
    if (!acceptedTypes.includes(file.type)) {
      setError('This file type is not accepted for the selected requirement.');
      return;
    }
    setUploading(`${applicationId}:${requirementId}`);
    setError('');
    setNotice('');
    const form = new FormData();
    form.set('application_id', applicationId);
    form.set('requirement_id', requirementId || '');
    form.set('file', file);
    try {
      await readJson(await fetch('/api/documents', { method: 'POST', body: form }));
      setNotice('Your document was uploaded successfully and is awaiting review.');
      await reload();
      if (detail?.application.id === applicationId) await loadDetails(applicationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document could not be uploaded.');
    } finally {
      setUploading('');
    }
  }

  async function loadDetails(applicationId: string) {
    setDetailLoading(applicationId);
    setError('');
    try {
      const result = await readJson<ApplicationDetail>(await fetch(`/api/applications/${applicationId}`));
      setDetail(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Application details could not be loaded.');
    } finally {
      setDetailLoading('');
    }
  }

  async function loadMoreApplications() {
    const nextPage = applicationPage + 1;
    setMorePending(true);
    setError('');
    try {
      const result = await readJson<{ applications: Application[]; total: number }>(
        await fetch(`/api/applications?page=${nextPage}`),
      );
      setApplications((current) => [...current, ...result.applications]);
      setApplicationTotal(result.total);
      setApplicationPage(nextPage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'More applications could not be loaded.');
    } finally {
      setMorePending(false);
    }
  }

  async function openDocument(documentId: string) {
    const preview = window.open('about:blank', '_blank');
    try {
      const result = await readJson<{ url: string }>(await fetch(`/api/documents/${documentId}`));
      if (preview) {
        preview.opener = null;
        preview.location.href = result.url;
      }
      else window.location.assign(result.url);
    } catch (cause) {
      preview?.close();
      setError(cause instanceof Error ? cause.message : 'The private document could not be opened.');
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfilePending(true);
    setError('');
    setNotice('');
    try {
      const result = await readJson<{ profile: Profile }>(await fetch('/api/student/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: profileName }),
      }));
      setProfile(result.profile);
      setProfileName(result.profile.full_name);
      setNotice('Your profile was updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your profile could not be updated.');
    } finally {
      setProfilePending(false);
    }
  }

  const activeApplications = applications.filter((application) => !['DENIED', 'INACTIVE'].includes(application.status));
  const activePrograms = programs.filter((program) => program.is_active);
  const requiredRequirements = latestApplication
    ? (latestApplication.requirements ?? requirements.filter((requirement) => requirement.application_type === latestApplication.application_type)).filter((requirement) => requirement.is_required)
    : [];
  const acceptedRequirements = dashboardDetail
    ? requiredRequirements.filter((requirement) => {
      const latest = dashboardDetail.documents.filter((document) => document.requirement_id === requirement.id)
        .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())[0];
      return latest?.review_status === 'ACCEPTED';
    })
    : [];
  const requirementsPercent = requiredRequirements.length
    ? Math.round((acceptedRequirements.length / requiredRequirements.length) * 100)
    : 0;
  const documentCorrections = latestApplication?.documents.filter((document) => (
    document.review_status === 'REJECTED' || document.review_status === 'NEEDS_CORRECTION'
  )) ?? [];
  const openFollowUp = dashboardDetail?.followUps.find((followUp) => followUp.status === 'OPEN');
  const dashboardUpdates = [
    ...(dashboardDetail?.followUps.filter((followUp) => followUp.status === 'OPEN').map((followUp) => ({
      id: `follow-up-${followUp.id}`, date: followUp.created_at, title: 'A follow-up needs your attention', message: followUp.message, kind: 'follow-up' as const,
    })) ?? []),
    ...(documentCorrections.map((document) => ({
      id: `document-${document.id}`, date: document.created_at ?? latestApplication?.updated_at ?? '',
      title: document.review_status === 'REJECTED' ? 'A document was not accepted' : 'A document needs correction',
      message: document.review_remarks || document.file_name, kind: 'document' as const,
    }))),
    ...(dashboardDetail?.history.slice(0, 2).map((entry) => ({
      id: `history-${entry.id}`, date: entry.created_at,
      title: `Application ${STATUS_LABELS[entry.to_status]?.toLowerCase() ?? entry.to_status.toLowerCase().replaceAll('_', ' ')}`,
      message: entry.reason || `Reference ${latestApplication?.application_no}`,
      kind: 'status' as const,
    })) ?? []),
  ].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime()).slice(0, 4);
  const currentJourneyStep = !latestApplication ? -1
    : dashboardDetail?.activeScholar ? 4
      : ['APPROVED', 'DENIED', 'INACTIVE'].includes(latestApplication.status) ? 3
      : ['FOR_FOLLOW_UP', 'COMPLETED'].includes(latestApplication.status) ? 2
        : latestApplication.status === 'UNDER_REVIEW' ? 1 : 0;
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || 'Student';
  const statusColor = latestApplication?.status === 'APPROVED' ? 'green'
    : latestApplication?.status === 'FOR_FOLLOW_UP' ? 'amber'
      : latestApplication?.status === 'DENIED' || latestApplication?.status === 'INACTIVE' ? 'slate' : 'sky';
  const dashboardPrograms = activePrograms.length ? activePrograms.slice(0, 2) : programs.slice(0, 2);
  const title = view === 'dashboard' ? 'Student dashboard'
    : view === 'programs' ? 'Scholarship Opportunities'
      : view === 'applications' ? 'My applications'
        : view === 'documents' ? 'Requirements & documents'
          : view === 'notifications' ? 'Updates & notifications'
            : view === 'profile' ? 'My profile' : 'Help & support';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Assumption College of Davao</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        </div>
        <p className="text-sm text-slate-600">{view === 'programs'
          ? 'Discover scholarships and financial assistance programs that match your qualifications.'
          : 'A secure scholarship portal connected to your student account.'}</p>
      </header>

      {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div className="flex-1">{error}<button type="button" className="ml-2 font-semibold underline" onClick={() => void reload()}>Try Again</button></div></div>}
      {notice && <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />{notice}</div>}
      {loading && <div role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading your information…</div>}

      {view === 'dashboard' && (
        <>
          <section className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm sm:p-8">
            <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="relative">
                <p className="text-sm font-semibold text-sky-800">Assumption College of Davao</p>
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-sm font-semibold text-sky-900"><Sparkles className="h-4 w-4" />Welcome back, {firstName}</p>
                <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">Your Future Starts Here.</h2>
                <p className="mt-2 max-w-2xl text-base leading-7 text-slate-700">Explore scholarship opportunities, prepare your requirements, and track your application—all in one place.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link className="btn-primary inline-flex items-center gap-2" href="/student/programs">Explore Scholarships <ArrowRight className="h-4 w-4" /></Link>
                  <Link className="btn-secondary inline-flex items-center gap-2" href="/student/applications">Track My Application <FileText className="h-4 w-4" /></Link>
                  {(!profile?.full_name || profile.full_name.trim().length < 2) && <Link className="btn-secondary" href="/student/profile">Complete my profile</Link>}
                </div>
                <p className="mt-5 text-sm text-slate-600">One step at a time, you’re moving toward your educational goals.</p>
              </div>
              <div aria-hidden="true" className="relative mx-auto hidden h-44 w-44 place-items-center lg:grid">
                <div className="absolute inset-3 rounded-3xl border border-sky-200 bg-white/60" />
                <div className="relative flex h-36 w-36 items-center justify-center rounded-2xl bg-white text-sky-800 shadow-sm ring-1 ring-sky-100"><GraduationCap className="h-20 w-20 stroke-[1.4]" /></div>
                <div className="absolute -bottom-1 -right-8 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"><BookOpenCheck className="h-4 w-4 text-sky-700" />Learn · Prepare · Grow</div>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Student overview">
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-sky-100 p-2.5 text-sky-900"><GraduationCap className="h-5 w-5" /></span><p className="text-sm font-semibold text-slate-700">Available Scholarships</p></div>
              <p className="mt-4 text-3xl font-bold text-slate-950">{programsLoaded ? activePrograms.length : '—'}</p><p className="mt-1 text-xs text-slate-500">Published and currently open</p>
              <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:underline" href="/student/programs">Explore opportunities <ChevronRight className="h-4 w-4" /></Link>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-blue-100 p-2.5 text-blue-900"><FileText className="h-5 w-5" /></span><p className="text-sm font-semibold text-slate-700">My Applications</p></div>
              <p className="mt-4 text-3xl font-bold text-slate-950">{applicationsLoaded ? applicationTotal : '—'}</p><p className="mt-1 text-xs text-slate-500">{applicationsLoaded ? `${activeApplications.length} currently in progress` : 'Your submitted applications'}</p>
              <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:underline" href="/student/applications">View applications <ChevronRight className="h-4 w-4" /></Link>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-900"><ShieldCheck className="h-5 w-5" /></span><p className="text-sm font-semibold text-slate-700">Latest Application Status</p></div>
              {applicationsLoaded && latestApplication ? <><p className="mt-4"><Pill color={statusColor}>{DASHBOARD_STATUS_LABELS[latestApplication.status] ?? latestApplication.status.replaceAll('_', ' ')}</Pill></p><p className="mt-2 truncate text-xs text-slate-500">{latestApplication.application_no}</p></> : <p className="mt-4 text-lg font-bold text-slate-950">{applicationsLoaded ? 'No application yet' : '—'}</p>}
              <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:underline" href={applicationsLoaded && latestApplication ? '/student/applications' : '/student/programs'}>{applicationsLoaded && latestApplication ? 'Track status' : 'Explore scholarships'} <ChevronRight className="h-4 w-4" /></Link>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-900"><FileCheck2 className="h-5 w-5" /></span><p className="text-sm font-semibold text-slate-700">Requirements Progress</p></div>
              {!latestApplication && applicationsLoaded ? <p className="mt-4 text-lg font-bold text-slate-950">Apply to begin</p>
                : !applicationsLoaded || dashboardDetailLoading || (!requirementsLoaded && loading) ? <p className="mt-4 text-lg font-bold text-slate-950">Loading…</p>
                  : !requirementsLoaded || dashboardDetailError ? <p className="mt-4 text-lg font-bold text-slate-950">Unavailable</p>
                  : !requiredRequirements.length ? <p className="mt-4 text-lg font-bold text-slate-950">No checklist set</p>
                    : <><p className="mt-4 text-3xl font-bold text-slate-950">{requirementsPercent}%</p><p className="mt-1 text-xs text-slate-500">{acceptedRequirements.length} of {requiredRequirements.length} required documents accepted</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Accepted required documents" aria-valuemin={0} aria-valuemax={requiredRequirements.length} aria-valuenow={acceptedRequirements.length}><div className="h-full rounded-full bg-sky-600 transition-[width]" style={{ width: `${requirementsPercent}%` }} /></div></>}
              <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:underline" href="/student/documents">View requirements <ChevronRight className="h-4 w-4" /></Link>
            </article>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Your progress</p><h2 className="mt-1 text-xl font-bold text-slate-950">My Application Journey</h2><p className="mt-1 text-sm text-slate-600">A clear view of the steps recorded for your latest application.</p></div>{latestApplication && <Pill color={statusColor}>{DASHBOARD_STATUS_LABELS[latestApplication.status] ?? latestApplication.status.replaceAll('_', ' ')}</Pill>}</div>
              {applicationsLoaded && !latestApplication ? <EmptyState message="Your journey begins when you submit an application. Explore the programs currently published by your school." link="/student/programs" linkLabel="Explore Opportunities" />
                : !applicationsLoaded ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading your application journey…</p>
                  : <>
                    <ol className={dashboardDetail?.activeScholar ? 'mt-7 grid gap-4 sm:grid-cols-5' : 'mt-7 grid gap-4 sm:grid-cols-4'} aria-label="Application progress">
                      {['Application submitted', 'Under review', 'Requirements / follow-up', 'Final decision', ...(dashboardDetail?.activeScholar ? ['Active Working Scholar'] : [])].map((step, index) => {
                        const complete = index < currentJourneyStep;
                        const current = index === currentJourneyStep;
                        return <li key={step} aria-current={current ? 'step' : undefined} className="relative flex gap-3 sm:block">
                          <span className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${complete || current ? 'bg-sky-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{complete ? <Check className="h-4 w-4" /> : index + 1}</span>
                          <div className="sm:mt-3"><p className={`text-sm font-semibold ${current ? 'text-sky-900' : 'text-slate-800'}`}>{step}</p><p className="mt-1 text-xs text-slate-500">{current ? index === 4 ? 'Confirmed active' : DASHBOARD_STATUS_LABELS[latestApplication?.status ?? ''] ?? 'Current stage' : complete ? 'Recorded' : 'Next step'}</p></div>
                        </li>;
                      })}
                    </ol>
                    {latestApplication && <div className="mt-6 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">Reference {latestApplication.application_no} · Submitted {niceDate(latestApplication.application_date)}</p>
                      {(latestApplication.status === 'FOR_FOLLOW_UP' || documentCorrections.length > 0) && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">A next step needs your attention</p><p className="mt-1">{openFollowUp?.message || latestApplication.review_remarks || (documentCorrections.length ? documentCorrections[0].review_remarks || `${documentCorrections[0].file_name} needs correction.` : 'Review the latest application updates for the requested information.')}</p><Link className="mt-2 inline-flex items-center gap-1 font-semibold text-amber-950 underline" href="/student/notifications">Review your updates <ArrowRight className="h-4 w-4" /></Link></div>}
                      {dashboardDetailLoading && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking saved status history…</p>}
                      {dashboardDetailError && <p role="alert" className="mt-3 text-sm text-rose-700">{dashboardDetailError}</p>}
                    </div>}
                  </>}
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-800">From your records</p><h2 className="mt-1 text-xl font-bold text-slate-950">Updates for You</h2></div><Bell className="h-5 w-5 text-sky-800" /></div>
              {dashboardDetailLoading ? <p role="status" className="mt-5 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading saved updates…</p>
                : dashboardDetailError ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{dashboardDetailError}</p>
                  : dashboardUpdates.length ? <ul className="mt-4 divide-y divide-slate-100">{dashboardUpdates.map((update) => <li key={update.id} className="py-3 first:pt-0"><div className="flex gap-3"><span className="mt-0.5 rounded-lg bg-sky-50 p-2 text-sky-900">{update.kind === 'follow-up' ? <Bell className="h-4 w-4" /> : update.kind === 'document' ? <FileCheck2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{update.title}</p><p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{update.message}</p><p className="mt-1 text-xs text-slate-500">{niceDate(update.date)}</p></div></div></li>)}</ul>
                    : <div className="mt-5 rounded-xl bg-sky-50/70 p-4"><p className="font-semibold text-slate-900">You’re all caught up!</p><p className="mt-1 text-sm leading-6 text-slate-600">Updates will appear here when your application has a recorded status change, follow-up, or document review.</p></div>}
              {latestApplication && <Link className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:underline" href="/student/applications">View application <ChevronRight className="h-4 w-4" /></Link>}
            </article>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-800">School-published programs</p><h2 className="mt-1 text-xl font-bold text-slate-950">Opportunities for You</h2><p className="mt-1 text-sm text-slate-600">Program details and availability come from your school’s current listings.</p></div><Link className="text-sm font-semibold text-sky-800 hover:underline" href="/student/programs">Browse all opportunities <ArrowRight className="ml-1 inline h-4 w-4" /></Link></div>
            {!programsLoaded ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{loading ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading published opportunities…</span> : <span>Opportunities could not be loaded. <button type="button" className="font-semibold text-sky-800 underline" onClick={() => void reload()}>Try again</button></span>}</div>
              : !programs.length ? <EmptyState message="No programs have been published yet. Please check back later or contact the Scholarship Office through the school’s official channels." link="/student/help" linkLabel="Help & Support" />
                : <div className="grid gap-4 lg:grid-cols-2">{dashboardPrograms.map((program) => <ProgramCard key={program.id} program={program} onApply={startApplication} slots={workingScholarProgramSlots[program.id]} eligibility={eligibilityStatus(program, applications)} application={applications.find((item) => item.program_id === program.id)} />)}</div>}
          </section>

          <section className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-sky-800">A simple place to begin</p><h2 className="mt-1 text-xl font-bold text-slate-950">Your Next Steps</h2></div>
            <div className="grid gap-3 md:grid-cols-3">
              <Link className="group flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" href="/student/programs"><span className="rounded-xl bg-sky-100 p-3 text-sky-900"><GraduationCap className="h-5 w-5" /></span><span><span className="block font-semibold text-slate-950">Explore Opportunities</span><span className="mt-1 block text-sm leading-5 text-slate-600">Discover programs published by your school.</span><span className="mt-3 inline-flex items-center text-sm font-semibold text-sky-800">Explore <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span></span></Link>
              <Link className="group flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" href="/student/documents"><span className="rounded-xl bg-blue-100 p-3 text-blue-900"><FileCheck2 className="h-5 w-5" /></span><span><span className="block font-semibold text-slate-950">Prepare Requirements</span><span className="mt-1 block text-sm leading-5 text-slate-600">Review the checklist and any document feedback.</span><span className="mt-3 inline-flex items-center text-sm font-semibold text-sky-800">View requirements <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span></span></Link>
              <Link className="group flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700" href="/student/applications"><span className="rounded-xl bg-indigo-50 p-3 text-indigo-900"><FileText className="h-5 w-5" /></span><span><span className="block font-semibold text-slate-950">Track Progress</span><span className="mt-1 block text-sm leading-5 text-slate-600">Check your latest status and saved updates.</span><span className="mt-3 inline-flex items-center text-sm font-semibold text-sky-800">My applications <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span></span></Link>
            </div>
          </section>
        </>
      )}

      {view === 'programs' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Scholarship opportunity summary">
            <SummaryMetric
              icon={<GraduationCap className="h-5 w-5" />}
              label="Available Opportunities"
              value={programsLoaded ? availableOpportunityCount : '—'}
              detail="Currently open or closing soon"
              color="sky"
            />
            <SummaryMetric
              icon={<ShieldCheck className="h-5 w-5" />}
              label="Eligible Scholarships"
              value={programsLoaded && applicationsLoaded ? eligibleOpportunityCount : '—'}
              detail={applicationsLoaded ? 'Based on administrator-approved academic information' : 'Eligibility needs your application data'}
              color="green"
            />
            <SummaryMetric
              icon={<FileText className="h-5 w-5" />}
              label="Applications Submitted"
              value={applicationsLoaded ? applicationTotal : '—'}
              detail="Applications linked to your account"
              color="blue"
            />
            <SummaryMetric
              icon={<Clock3 className="h-5 w-5" />}
              label="Closing Soon"
              value={programsLoaded ? closingSoonCount : '—'}
              detail="Deadlines within 14 days"
              color="amber"
            />
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
              <label className="relative block sm:col-span-2"><span className="sr-only">Search scholarships</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input className="input pl-9" placeholder="Search by scholarship, program, or keyword" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label className="text-sm font-medium text-slate-700">Program type<select className="input mt-1" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="ALL">All program types</option><option value="ACADEMIC">Academic Scholarship</option><option value="WORKING_SCHOLAR">Working Scholar Program</option><option value="FINANCIAL_AID">Financial Aid</option></select></label>
              <label className="text-sm font-medium text-slate-700">Category<select className="input mt-1" value={category} onChange={(event) => setCategory(event.target.value as 'ALL' | ScholarshipCategory)}><option value="ALL">All categories</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-sm font-medium text-slate-700">Eligibility<select className="input mt-1" value={eligibilityFilter} onChange={(event) => setEligibilityFilter(event.target.value as typeof eligibilityFilter)}><option value="ALL">Any eligibility</option><option value="Eligible">Eligible</option><option value="Not Eligible">Not eligible</option><option value="Check Requirements">Check requirements</option></select></label>
              <label className="text-sm font-medium text-slate-700">Application status<select className="input mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ALL">All statuses</option><option value="Open">Open</option><option value="Closing Soon">Closing soon</option><option value="Upcoming">Upcoming</option><option value="Full">Full</option><option value="Closed">Closed</option></select></label>
              <label className="text-sm font-medium text-slate-700">Deadline<select className="input mt-1" value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value as typeof deadlineFilter)}><option value="ALL">Any deadline</option><option value="7_DAYS">Within 7 days</option><option value="30_DAYS">Within 30 days</option><option value="NO_DEADLINE">No date configured</option></select></label>
            </div>
          </div>
          {!programsLoaded ? <div role={loading ? 'status' : 'alert'} className={`rounded-2xl border p-6 text-center ${loading ? 'border-slate-200 bg-white text-slate-600' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
            {loading ? <div className="grid gap-4 md:grid-cols-2" aria-label="Loading opportunities">{[1, 2, 3, 4].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div> : <><p>Scholarship opportunities could not be loaded. Your data has not been replaced with sample listings.</p><button type="button" className="btn-primary mt-4" onClick={() => void reload()}>Try Again</button></>}
          </div> : !programs.length ? <div className="rounded-2xl border border-dashed border-sky-300 bg-white px-6 py-12 text-center shadow-sm"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sky-900"><GraduationCap className="h-6 w-6" /></span><h2 className="mt-4 font-bold text-slate-900">No scholarship opportunities are currently available.</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">Please check again later or contact the Scholarship Office through the school’s official channels.</p><button type="button" className="btn-primary mt-5" onClick={() => void reload()}>Refresh</button></div>
            : filteredPrograms.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center"><h2 className="font-bold text-slate-900">No matching opportunities</h2><p className="mt-2 text-sm text-slate-600">Try changing your search, eligibility, deadline, or status filters.</p><button type="button" className="btn-secondary mt-4" onClick={() => { setQuery(''); setCategory('ALL'); setTypeFilter('ALL'); setEligibilityFilter('ALL'); setStatusFilter('ALL'); setDeadlineFilter('ALL'); }}>Clear filters</button></div>
              : <div className="grid gap-4 lg:grid-cols-2">{filteredPrograms.map((program) => <ProgramCard key={program.id} program={program} onApply={startApplication} slots={workingScholarProgramSlots[program.id]} requirements={requirements.filter((item) => item.application_type === program.application_type)} eligibility={eligibilityStatus(program, applications)} application={applications.find((item) => item.program_id === program.id)} />)}</div>}
        </section>
      )}

      {view === 'applications' && (
        <section className="space-y-4">
          {applications.length === 0 && !loading ? <EmptyState message="You haven't submitted an application yet. Explore the available scholarships to get started." link="/student/programs" linkLabel="Explore scholarships" /> : applications.map((application) => (
            <article key={application.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div><Pill color={application.status === 'APPROVED' ? 'green' : application.status === 'FOR_FOLLOW_UP' ? 'amber' : 'sky'}>{STATUS_LABELS[application.status] ?? application.status.replaceAll('_', ' ')}</Pill><h2 className="mt-3 text-lg font-bold text-slate-900">{application.program?.name ?? applicationTypeLabel(application.application_type)}</h2><p className="mt-1 text-sm text-slate-600">Reference <span className="font-semibold text-slate-800">{application.application_no}</span></p><p className="mt-1 text-sm text-slate-600">Submitted {niceDate(application.application_date)} · Updated {niceDate(application.updated_at)}</p>{application.gwa !== null && application.gwa !== undefined && <p className="mt-1 text-sm text-slate-600">GWA {application.gwa} · Lowest grade {application.lowest_subject_grade ?? 'Not recorded'}</p>}</div>
                <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2" disabled={detailLoading === application.id} onClick={() => void loadDetails(application.id)}>{detailLoading === application.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}View status & details</button>
              </div>
              {application.status === 'FOR_FOLLOW_UP' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Please review the administrator feedback below and contact the Scholarship Office for permitted next steps. Document uploads are enabled only while the application is pending.</p>}
              {application.review_remarks && <p className="mt-3 text-sm text-slate-700"><strong>Administrator feedback:</strong> {application.review_remarks}</p>}
              {application.denial_reason && <p className="mt-3 text-sm text-rose-700"><strong>Decision note:</strong> {application.denial_reason}</p>}
              {detail?.application.id === application.id && <ApplicationDetails detail={detail} onOpenDocument={openDocument} />}
            </article>
          ))}
          {applications.length < applicationTotal && <button type="button" className="btn-secondary w-full" onClick={() => void loadMoreApplications()} disabled={morePending}>{morePending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}Load older applications</button>}
        </section>
      )}

      {view === 'documents' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm leading-6 text-sky-950"><strong>Private document storage.</strong> Each checklist item shows its accepted file types and size limit. Documents remain pending until reviewed by an administrator. Upload controls appear only when the database workflow permits changes.</div>
          {applications.length === 0 && !loading ? <EmptyState message="Documents can be uploaded after you submit an application." link="/student/programs" linkLabel="Explore scholarships" /> : applications.map((application) => (
            <article key={application.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">{application.application_no} · {application.program?.name ?? applicationTypeLabel(application.application_type)}</h2><p className="mt-1 text-sm text-slate-600">{application.documents.length} uploaded document{application.documents.length === 1 ? '' : 's'}</p></div><Pill color={application.status === 'PENDING' ? 'green' : 'slate'}>{STATUS_LABELS[application.status] ?? application.status}</Pill></div>
              {(() => {
                const applicationRequirements = application.requirements ?? requirements.filter((r) => r.application_type === application.application_type);
                const required = applicationRequirements.filter((requirement) => requirement.is_required);
                const accepted = required.filter((requirement) => {
                  const latest = application.documents.filter((document) => document.requirement_id === requirement.id).sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())[0];
                  return latest?.review_status === 'ACCEPTED';
                }).length;
                return <p className="mt-3 text-sm font-semibold text-slate-700">{applicationRequirements.length ? `${accepted} of ${required.length} required documents accepted.` : 'The official checklist is not configured yet; requirement completion cannot be confirmed.'}</p>;
              })()}
              <DocumentList documents={application.documents} requirements={requirements.filter((r) => r.application_type === application.application_type)} onOpen={openDocument} />
              {application.status === 'PENDING' || application.documents.some((document) => ['NEEDS_CORRECTION', 'REJECTED'].includes(document.review_status)) ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{(application.requirements ?? requirements.filter((r) => r.application_type === application.application_type)).map((requirement) => {
                const key = `${application.id}:${requirement.id}`;
                const acceptedNames = requirement.accepted_mime_types.map((type) => type === 'application/pdf' ? 'PDF' : type === 'image/jpeg' ? 'JPEG' : type === 'image/png' ? 'PNG' : type === 'image/webp' ? 'WebP' : type).join(', ');
                const maxMb = Math.round(requirement.max_file_size_bytes / 1024 / 1024 * 10) / 10;
                const newestDocument = application.documents.filter((document) => document.requirement_id === requirement.id).sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())[0];
                const uploadLabel = newestDocument?.review_status === 'NEEDS_CORRECTION' || newestDocument?.review_status === 'REJECTED' ? 'Upload corrected document' : 'Upload document';
                if (newestDocument && !['NEEDS_CORRECTION', 'REJECTED'].includes(newestDocument.review_status)) {
                  return <div key={requirement.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><span><span className="font-semibold text-slate-800">{requirement.name}</span><span className="block text-xs text-slate-600">A document is already {newestDocument.review_status === 'ACCEPTED' ? 'accepted' : 'awaiting review'}.</span></span><Pill color={newestDocument.review_status === 'ACCEPTED' ? 'green' : 'slate'}>{newestDocument.review_status === 'ACCEPTED' ? 'Accepted' : 'Awaiting review'}</Pill></div>;
                }
                if (application.status !== 'PENDING' && !newestDocument) {
                  return <div key={requirement.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{requirement.name} · Uploads are available only for requested corrections.</div>;
                }
                return <label key={requirement.id} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-sky-300 bg-sky-50/70 p-3 text-sm hover:bg-sky-50 focus-within:ring-2 focus-within:ring-sky-700"><span><span className="font-semibold text-slate-800">{uploadLabel}: {requirement.name} · {requirement.is_required ? 'Required' : 'Optional'}</span><span className="block text-xs text-slate-600">{requirement.description || 'No upload instructions provided.'}</span><span className="mt-1 block text-xs text-slate-600">{acceptedNames} · maximum {maxMb} MB</span></span><span className="shrink-0 text-sky-900">{uploading === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-5 w-5" />}</span><input className="sr-only" type="file" accept={requirement.accepted_mime_types.join(',')} disabled={!!uploading} onChange={(event) => { void uploadRequirement(application.id, requirement.id, event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>;
              })}</div> : <p className="mt-4 text-sm text-slate-600">This application is not in the pending state, so document uploads are currently disabled.</p>}
              {(application.requirements ?? requirements.filter((r) => r.application_type === application.application_type)).length === 0 && <p className="mt-3 text-sm text-slate-600">No checklist requirements have been configured for this program type. Review the program details or contact the Scholarship Office.</p>}
            </article>
          ))}
          {applications.length < applicationTotal && <button type="button" className="btn-secondary w-full" onClick={() => void loadMoreApplications()} disabled={morePending}>{morePending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}Load older applications</button>}
        </section>
      )}

      {view === 'notifications' && (
        <section className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-bold text-slate-900">Application activity</h2><p className="mt-1 text-sm text-slate-600">Updates below come from your saved application status history and administrator follow-ups.</p></div>
          {applications.length === 0 && !loading ? <EmptyState message="Application updates will appear here after you submit an application." link="/student/programs" linkLabel="Explore scholarships" /> : applications.map((application) => (
            <article key={application.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><div className="flex items-start gap-3"><span className="mt-1 rounded-full bg-sky-100 p-2 text-sky-900"><Bell className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-900">{application.application_no} · {STATUS_LABELS[application.status] ?? application.status.replaceAll('_', ' ')}</h2><p className="mt-1 text-sm text-slate-600">Latest record update: {niceDate(application.updated_at)}</p>{application.review_remarks && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{application.review_remarks}</p>}{application.denial_reason && <p className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{application.denial_reason}</p>}<button type="button" className="mt-3 text-sm font-semibold text-sky-800 hover:underline" onClick={() => void loadDetails(application.id)}>Load verified status history</button>{detail?.application.id === application.id && <ApplicationDetails detail={detail} compact onOpenDocument={openDocument} />}</div></div></article>
          ))}
          {applications.length < applicationTotal && <button type="button" className="btn-secondary w-full" onClick={() => void loadMoreApplications()} disabled={morePending}>{morePending && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}Load older applications</button>}
          <p className="text-xs text-slate-500">Read/unread notifications are not enabled by the current database schema; no messages are fabricated here.</p>
        </section>
      )}

      {view === 'profile' && (
        <section className="max-w-2xl rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-sky-100 p-3 text-sky-900"><UserRound className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-900">Student account details</h2><p className="text-sm text-slate-600">Only your display name can be changed here. Account email and permissions are managed securely.</p></div></div>
          <form className="space-y-4" onSubmit={updateProfile}>
            <label className="block text-sm font-medium text-slate-700">Full name<input className="input mt-1" value={profileName} maxLength={120} minLength={2} required onChange={(event) => setProfileName(event.target.value)} /></label>
            <label className="block text-sm font-medium text-slate-700">Account email<input className="input mt-1 bg-slate-50" value={profile?.email ?? ''} readOnly /></label>
            <p className="text-xs text-slate-500">Student number, course, and year level are stored on each application because the current profile schema does not maintain those fields separately.</p>
            <button className="btn-primary inline-flex items-center gap-2" type="submit" disabled={profilePending}>{profilePending && <Loader2 className="h-4 w-4 animate-spin" />}Save profile</button>
          </form>
        </section>
      )}

      {view === 'help' && (
        <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6"><div className="flex items-center gap-2"><CircleHelp className="h-5 w-5 text-sky-800" /><h2 className="text-lg font-bold text-slate-900">How to use the portal</h2></div><div className="mt-4 space-y-4 text-sm leading-6 text-slate-700"><p><strong>1. Explore:</strong> review currently published opportunities and the eligibility information provided by the school.</p><p><strong>2. Apply:</strong> select a program, enter your course and year level, review the details, and confirm submission.</p><p><strong>3. Prepare documents:</strong> upload the configured checklist items while your application is pending. Files are private and linked to your own application.</p><p><strong>4. Track progress:</strong> check My Applications and Updates for the status and recorded feedback. Preliminary requirements do not guarantee approval.</p></div></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6"><div className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-sky-800" /><h2 className="text-lg font-bold text-slate-900">Questions and assistance</h2></div><p className="mt-3 text-sm leading-6 text-slate-600">No verified Scholarship Office contact details or inquiry service are configured in this project. Please contact the school office through its official published channels for current requirements and deadlines.</p><Link className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-sky-800 hover:underline" href="/student/programs">Review opportunities <ArrowRight className="h-4 w-4" /></Link></div>
        </section>
      )}

      {applyProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-[2px] sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeApplication(); }}>
          <section ref={applicationDialogRef} role="dialog" aria-modal="true" aria-labelledby="application-dialog-title" tabIndex={-1} className="flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(1100px,calc(100vw-2rem))] sm:rounded-3xl">
            <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-7 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-800">Scholarship application</p>
                  <h2 id="application-dialog-title" className="mt-1 text-lg font-bold leading-tight text-slate-950 sm:text-2xl">Apply for {applyProgram.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">Complete the steps below to submit your scholarship application.</p>
                </div>
                <button type="button" aria-label="Close application" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-700" onClick={closeApplication} disabled={submitPending}><X className="h-5 w-5" /></button>
              </div>
              {!submitted && <nav aria-label="Application progress" className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-4">
                {[
                  { label: 'Get started', detail: 'Review the opportunity' },
                  { label: 'Your details', detail: 'Details and documents' },
                  { label: 'Review & submit', detail: 'Check before sending' },
                ].map((step, index) => {
                  const complete = index < applyStep;
                  const active = index === applyStep;
                  return <div key={step.label} aria-current={active ? 'step' : undefined} className="relative flex min-w-0 items-start gap-2 sm:gap-3">
                    {index < 2 && <span aria-hidden="true" className={`absolute left-8 right-[-0.5rem] top-4 hidden h-px sm:block ${complete ? 'bg-sky-700' : 'bg-slate-200'}`} />}
                    <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${active ? 'border-sky-700 bg-sky-700 text-white ring-4 ring-sky-100' : complete ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-500'}`}>
                      {complete ? <Check aria-hidden="true" className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className="min-w-0 pt-0.5">
                      <span className={`block truncate text-xs font-bold uppercase tracking-wide sm:text-sm ${active ? 'text-sky-900' : complete ? 'text-slate-800' : 'text-slate-500'}`}>{step.label}</span>
                      <span className="mt-0.5 hidden text-xs text-slate-500 sm:block">{step.detail}</span>
                    </span>
                  </div>;
                })}
              </nav>}
            </header>

            {submitted ? <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
              <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-8">
                <span className="inline-flex rounded-2xl bg-emerald-100 p-3 text-emerald-800"><CheckCircle2 aria-hidden="true" className="h-8 w-8" /></span>
                <h3 className="mt-4 text-xl font-bold text-emerald-950">Application submitted successfully</h3>
                <p className="mt-2 text-sm leading-6 text-emerald-900">Your application for <strong>{applyProgram.name}</strong> was recorded with status <strong>{STATUS_LABELS[submitted.status] ?? submitted.status}</strong>.</p>
                {submitted.reference && <p className="mt-4 text-sm text-emerald-900">Application reference <span className="ml-1 font-mono font-bold">{submitted.reference}</span></p>}
                <p className="mt-3 text-sm leading-6 text-emerald-900">The responsible office will review your application and supporting documents. Submission does not mean the application has been approved.</p>
                {notice && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
                {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300 bg-white p-3 text-sm text-rose-800">{error}</p>}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/student/applications" className="btn-primary">View My Applications</Link>
                  <Link href="/student/documents" className="btn-secondary">Review documents</Link>
                  <button type="button" className="btn-secondary" onClick={() => { setApplyProgram(null); setSubmitted(null); setCreatedApplication(null); setUploadedApplicationFiles({}); setCourse(''); setYearLevel('1'); setApplicationFiles({}); }}>Done</button>
                </div>
              </div>
            </div> : <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
              if (applyStep < 2) {
                event.preventDefault();
                continueApplication();
              } else void submitApplication(event);
            }}>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
                {error && <p role="alert" className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p>}
                {applyStep === 0 && <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-xs font-bold uppercase tracking-wide text-sky-800">Opportunity overview</p><h3 className="mt-1 text-lg font-bold text-slate-950">{applyProgram.name}</h3></div>
                      <Pill>{CATEGORY_LABELS[scholarshipCategory(applyProgram)]}</Pill>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{applyProgram.description || 'No program description has been provided.'}</p>
                    <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Availability</dt><dd className="mt-1"><Pill color={applicationStatus(applyProgram, workingScholarProgramSlots[applyProgram.id]) === 'Open' ? 'green' : applicationStatus(applyProgram, workingScholarProgramSlots[applyProgram.id]) === 'Closing Soon' ? 'amber' : 'slate'}>{applicationStatus(applyProgram, workingScholarProgramSlots[applyProgram.id])}</Pill></dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Application deadline</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-800"><CalendarDays aria-hidden="true" className="h-4 w-4 text-sky-800" />{niceDate(applyProgram.deadline)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Responsible office</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-800"><Building2 aria-hidden="true" className="h-4 w-4 text-sky-800" />{applyProgram.responsible_office || applyProgram.assigned_office || 'Not specified'}</dd></div>
                      {applyProgram.application_type === 'WORKING_SCHOLAR' && <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available slots</dt><dd className="mt-1 text-sm font-medium text-slate-800">{workingScholarProgramSlots[applyProgram.id]?.configured ? `${workingScholarProgramSlots[applyProgram.id].remaining} of ${workingScholarProgramSlots[applyProgram.id].max_slots} remaining` : 'Not configured'}</dd></div>}
                      {applyProgram.benefits && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Benefits</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{applyProgram.benefits}</dd></div>}
                    </dl>
                  </section>
                  <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5">
                    <div className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-sky-800" /><h3 className="text-base font-bold text-slate-950">Eligibility checklist</h3></div>
                    {applyProgram.requirements.length > 0 ? <ul className="mt-3 space-y-2.5">{applyProgram.requirements.map((item) => <li key={item} className="flex gap-2.5 text-sm leading-5 text-slate-700"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><span>{item}</span></li>)}</ul>
                      : <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{applyProgram.eligibility || 'Eligibility details have not been configured. Please contact the responsible office to confirm before applying.'}</p>}
                    {applyProgram.requirements.length > 0 && applyProgram.eligibility && <p className="mt-3 border-t border-sky-200 pt-3 text-sm leading-6 text-slate-700">{applyProgram.eligibility}</p>}
                    <div className="mt-4 rounded-xl border border-sky-200 bg-white p-3 text-sm leading-5 text-slate-700">Before continuing, make sure you meet the eligibility requirements and have your required documents ready.</div>
                    {programRequirementsLoading ? <p role="status" className="mt-3 text-xs text-slate-600">Loading this opportunity’s document checklist…</p>
                      : <p className="mt-3 text-xs font-semibold text-sky-950">{requiredProgramRequirements.length} required document{requiredProgramRequirements.length === 1 ? '' : 's'}{programRequirements.some((requirement) => !requirement.is_required) ? ` · ${programRequirements.filter((requirement) => !requirement.is_required).length} optional` : ''}</p>}
                  </section>
                </div>}

                {applyStep === 1 && <div className="grid items-start gap-4 lg:grid-cols-[0.78fr_1.22fr]">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-center gap-2"><GraduationCap aria-hidden="true" className="h-5 w-5 text-sky-800" /><h3 className="text-base font-bold text-slate-950">Your academic information</h3></div>
                    <p className="mt-1 text-sm text-slate-600">Tell us about your current academic status.</p>
                    <div className="mt-4 space-y-3">
                      <label className="block text-sm font-semibold text-slate-700">Student name<input className="input mt-1 bg-slate-50" value={profile?.full_name ?? ''} readOnly aria-label="Student name from your profile" /></label>
                      <label className="block text-sm font-semibold text-slate-700">Student email<input className="input mt-1 bg-slate-50" type="email" value={profile?.email ?? ''} readOnly aria-label="Student email from your profile" /></label>
                      <label className="block text-sm font-semibold text-slate-700">{isAcademic(applyProgram) ? 'Course or academic program' : 'Course or academic program'}
                        {isAcademic(applyProgram) ? <select className="input mt-1" value={course} required onChange={(event) => setCourse(event.target.value)}><option value="">Choose your program</option><option>BS Ed</option><option>BE Ed</option><option>BSSW</option><option>IT</option><option>HM</option></select>
                          : <input className="input mt-1" value={course} required minLength={2} maxLength={120} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Bachelor of Science in…" />}
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">{isAcademic(applyProgram) ? 'Current year level' : 'Current year level'}
                        {isAcademic(applyProgram) ? <input className="input mt-1 bg-slate-50" value="1 · Incoming first-year student" readOnly />
                          : <input className="input mt-1" type="number" min={1} max={8} required value={yearLevel} onChange={(event) => setYearLevel(event.target.value)} />}
                      </label>
                      {isAcademic(applyProgram) && <>
                        <label className="block text-sm font-semibold text-slate-700">General Weighted Average (GWA)<input className="input mt-1" type="number" min={90} max={100} step="0.01" required value={gwa} onChange={(event) => setGwa(event.target.value)} /></label>
                        <label className="block text-sm font-semibold text-slate-700">Lowest subject grade<input className="input mt-1" type="number" min={85} max={100} step="0.01" required value={lowestGrade} onChange={(event) => setLowestGrade(event.target.value)} /></label>
                      </>}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">Your name and email come from your authenticated student profile.</p>
                  </section>

                  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><div className="flex items-center gap-2"><FileCheck2 aria-hidden="true" className="h-5 w-5 text-sky-800" /><h3 className="text-base font-bold text-slate-950">Your required documents</h3></div><p className="mt-1 text-sm text-slate-600">Upload clear copies of the documents needed for your application.</p></div>
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-900">{selectedRequiredDocuments} of {requiredProgramRequirements.length} required</span>
                    </div>
                    {requiredProgramRequirements.length > 0 && <div className="mt-3" aria-label={`${selectedRequiredDocuments} of ${requiredProgramRequirements.length} required documents selected`}>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600 transition-[width] duration-200" style={{ width: `${selectedRequiredDocuments / requiredProgramRequirements.length * 100}%` }} /></div>
                    </div>}
                    {programRequirementsLoading ? <p role="status" className="mt-5 text-sm text-slate-600">Loading configured documents…</p>
                      : programRequirements.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-h-[calc(100dvh-350px)] lg:overflow-y-auto lg:pr-1">
                        {programRequirements.map((requirement) => {
                          const file = applicationFiles[requirement.id];
                          const errorMessage = applicationFileErrors[requirement.id];
                          const acceptedFormats = requirement.accepted_mime_types.map((type) => type === 'application/pdf' ? 'PDF' : type === 'image/jpeg' ? 'JPG' : type === 'image/png' ? 'PNG' : type === 'image/webp' ? 'WebP' : type).join(', ');
                          const maxMb = Math.round(Math.min(requirement.max_file_size_bytes, 10 * 1024 * 1024) / 1024 / 1024 * 10) / 10;
                          return <article key={requirement.id} className={`flex min-w-0 flex-col rounded-xl border p-3 ${errorMessage ? 'border-rose-300 bg-rose-50/60' : file ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/70'}`}>
                            <div className="flex items-start gap-2.5">
                              <span className="mt-0.5 rounded-lg bg-white p-1.5 text-sky-800 shadow-sm"><FileText aria-hidden="true" className="h-4 w-4" /></span>
                              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><h4 className="text-sm font-bold leading-5 text-slate-900">{requirement.name}</h4><Pill color={requirement.is_required ? 'amber' : 'slate'}>{requirement.is_required ? 'Required' : 'Optional'}</Pill></div>
                                <p className="mt-1 text-xs leading-4 text-slate-600">{requirement.description || 'Upload a clear copy of this document.'}</p>
                              </div>
                            </div>
                            <p className="mt-2 text-[11px] leading-4 text-slate-500">{acceptedFormats} · max {maxMb} MB</p>
                            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                              <span className={`min-w-0 truncate text-xs font-medium ${file ? 'text-emerald-800' : 'text-slate-500'}`} title={file?.name}>{file ? `File selected: ${file.name}` : 'Not selected'}</span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {file && <button type="button" aria-label={`Remove ${requirement.name}`} className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-sky-700" onClick={() => {
                                  setApplicationFiles((current) => { const next = { ...current }; delete next[requirement.id]; return next; });
                                  setApplicationFileErrors((current) => { const next = { ...current }; delete next[requirement.id]; return next; });
                                }}><X aria-hidden="true" className="h-4 w-4" /></button>}
                                <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 text-xs font-semibold text-sky-900 transition hover:border-sky-500 hover:bg-sky-50 focus-within:ring-2 focus-within:ring-sky-700">
                                  <CloudUpload aria-hidden="true" className="h-4 w-4" />{file ? 'Replace' : 'Choose file'}
                                  <input className="sr-only" type="file" accept={requirement.accepted_mime_types.join(',')} aria-label={`${file ? 'Replace' : 'Choose'} ${requirement.name}`} aria-describedby={`${requirement.id}-help${errorMessage ? ` ${requirement.id}-error` : ''}`} onChange={(event) => selectApplicationFile(requirement, event.target.files?.[0], event.currentTarget)} />
                                </label>
                              </div>
                            </div>
                            <span id={`${requirement.id}-help`} className="sr-only">{acceptedFormats}, maximum {maxMb} MB</span>
                            {errorMessage && <p id={`${requirement.id}-error`} role="alert" className="mt-2 text-xs font-medium text-rose-800">{errorMessage}</p>}
                          </article>;
                        })}
                      </div> : <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">No document checklist is configured for this opportunity. The responsible office can confirm what to provide.</p>}
                    {programRequirements.some((requirement) => !requirement.is_required) && <p className="mt-2 text-xs text-slate-500">Optional files do not count toward the required document total.</p>}
                  </section>
                </div>}

                {applyStep === 2 && <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-center gap-2"><GraduationCap aria-hidden="true" className="h-5 w-5 text-sky-800" /><h3 className="text-base font-bold text-slate-950">Scholarship details</h3></div>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Program</dt><dd className="mt-1 font-semibold text-slate-900">{applyProgram.name}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</dt><dd className="mt-1 text-slate-800">{CATEGORY_LABELS[scholarshipCategory(applyProgram)]}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Responsible office</dt><dd className="mt-1 text-slate-800">{applyProgram.responsible_office || applyProgram.assigned_office || 'Not specified'}</dd></div>
                    </dl>
                    <div className="mt-4 border-t border-slate-100 pt-4"><h4 className="text-sm font-bold text-slate-900">Applicant information</h4><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs font-semibold text-slate-500">Student</dt><dd className="mt-0.5 text-slate-800">{profile?.full_name || 'Name unavailable'}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Email</dt><dd className="mt-0.5 break-words text-slate-800">{profile?.email || 'Email unavailable'}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Course / academic program</dt><dd className="mt-0.5 text-slate-800">{course}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">Current year level</dt><dd className="mt-0.5 text-slate-800">{isAcademic(applyProgram) ? '1 · Incoming first-year student' : yearLevel}</dd></div>
                      {isAcademic(applyProgram) && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">GWA / lowest subject grade</dt><dd className="mt-0.5 text-slate-800">{gwa} / {lowestGrade}</dd></div>}
                    </dl></div>
                  </section>
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 aria-hidden="true" className="h-5 w-5 text-sky-800" /><h3 className="text-base font-bold text-slate-950">Document checklist</h3></div><span className="text-xs font-bold text-slate-600">{selectedRequiredDocuments} / {requiredProgramRequirements.length} required</span></div>
                    {programRequirements.length ? <ul className="mt-3 divide-y divide-slate-100">
                      {programRequirements.map((requirement) => {
                        const file = applicationFiles[requirement.id];
                        const errorMessage = applicationFileErrors[requirement.id];
                        return <li key={requirement.id} className="flex min-w-0 items-start gap-2.5 py-2.5">
                          {errorMessage ? <X aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" /> : file ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
                          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{requirement.name} <span className="font-normal text-slate-500">· {requirement.is_required ? 'Required' : 'Optional'}</span></span>
                            <span className={`block truncate text-xs ${errorMessage ? 'text-rose-800' : file ? 'text-emerald-800' : 'text-slate-500'}`} title={file?.name}>{errorMessage || (file ? `Selected: ${file.name}` : 'Missing file')}</span>
                          </span>
                        </li>;
                      })}
                    </ul> : <p className="mt-3 text-sm text-slate-600">No document checklist is configured for this opportunity.</p>}
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><h4 className="text-sm font-bold text-amber-950">Important reminder</h4><p className="mt-1 text-sm leading-5 text-amber-900">The responsible office will review your application and documents. Submitting does not automatically mean you have been approved.</p></div>
                  </section>
                  {hasActiveScholarshipConflict && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-5 text-amber-950 lg:col-span-2"><strong>Possible scholarship conflict:</strong> You have another active internal scholarship application or award. This is a warning for office review, not an automatic rejection; you may continue or contact the responsible office.</p>}
                  {!conflictCheckLoaded && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 lg:col-span-2">Your existing applications could not be checked. Retry loading your information before submitting.</p>}
                </div>}
              </div>

              <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <button type="button" className="btn-secondary" onClick={() => applyStep === 0 ? closeApplication() : (setError(''), setApplyStep((step) => step - 1))} disabled={submitPending || Boolean(createdApplication && applyStep === 2)}>{applyStep === 0 ? 'Cancel' : 'Back to previous step'}</button>
                <button type="submit" className="btn-primary inline-flex min-h-11 items-center justify-center gap-2" disabled={submitPending || !applyProgram.is_active || programRequirementsLoading || (applyStep === 2 && !conflictCheckLoaded)}>
                  {submitPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : applyStep < 2 ? <ArrowRight aria-hidden="true" className="h-4 w-4" /> : null}
                  {submitPending ? 'Submitting…' : applyStep === 0 ? 'Continue to Your Details' : applyStep === 1 ? 'Continue to Review' : 'Confirm and Submit Application'}
                </button>
              </footer>
            </form>}
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ icon, label, value, detail, color }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  detail: string;
  color: 'sky' | 'green' | 'blue' | 'amber';
}) {
  const colors = {
    sky: 'bg-sky-100 text-sky-900',
    green: 'bg-emerald-100 text-emerald-900',
    blue: 'bg-blue-100 text-blue-900',
    amber: 'bg-amber-100 text-amber-900',
  };
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <span className={`rounded-xl p-2.5 ${colors[color]}`}>{icon}</span>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
      </div>
      <p className="mt-4 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function ProgramCard({ program, onApply, slots, requirements = [], eligibility, application }: {
  program: Program;
  onApply: (program: Program) => void;
  slots?: ProgramSlotSummary;
  requirements?: Requirement[];
  eligibility: EligibilityStatus;
  application?: Application;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const category = scholarshipCategory(program);
  const academic = isAcademic(program);
  const status = applicationStatus(program, slots);
  const statusColor = status === 'Open' ? 'green' : status === 'Closing Soon' || status === 'Full' ? 'amber' : status === 'Upcoming' ? 'sky' : 'slate';
  const eligibilityColor = eligibility === 'Eligible' ? 'green' : eligibility === 'Not Eligible' ? 'slate' : 'amber';
  const eligibilityText = academic
    ? 'BS Ed, BE Ed, and BSSW; GWA of 90 or above; no subject grade below 85. Initial applications are for incoming first-year students. IT and HM are ineligible.'
    : program.eligibility || 'Eligibility requirements have not been configured.';
  const description = program.description || 'No program description has been provided.';
  return (
    <article className="flex flex-col rounded-2xl border-2 border-sky-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-sky-100 p-2.5 text-sky-900">{program.application_type === 'WORKING_SCHOLAR' ? <Building2 className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}</span><Pill color={statusColor}>{status}</Pill></div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-sky-800">{CATEGORY_LABELS[category]}</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">{program.name}</h2>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-slate-700">Eligibility</span><Pill color={eligibilityColor}>{eligibility}</Pill></div>
      <p className="mt-2 line-clamp-3 text-sm leading-5 text-slate-700">{eligibility === 'Check Requirements' ? 'More student information or office review is needed to confirm eligibility.' : eligibility === 'Eligible' ? 'Administrator-approved academic information meets the confirmed requirements.' : 'At least one confirmed academic requirement is not met.'}</p>
      {program.responsible_office && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600"><Building2 className="h-4 w-4 shrink-0 text-sky-800" />{program.responsible_office}</p>}
      {program.benefits && <p className="mt-2 text-sm text-slate-700"><span className="font-semibold">Benefits:</span> {program.benefits}</p>}
      {academic && <p className="mt-2 text-sm text-slate-700"><span className="font-semibold">Minimum GWA:</span> 90 · <span className="font-semibold">Minimum subject grade:</span> 85</p>}
      {program.application_type === 'WORKING_SCHOLAR' && slots?.configured && <p className="mt-2 text-sm font-medium text-slate-700">Available {slots.uses_program_limit ? 'program' : 'schoolwide'} slots: {slots.remaining} of {slots.max_slots}</p>}
      {(program.opens_at || program.deadline) && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays className="h-4 w-4 shrink-0 text-sky-800" />{program.opens_at ? `Opens ${niceDate(program.opens_at)}` : 'Opening date not configured'}{program.deadline ? ` · Deadline ${niceDate(program.deadline)}` : ''}</p>}
      {application && <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 p-3"><p className="text-sm font-semibold text-sky-950">Your application: {STATUS_LABELS[application.status] ?? application.status.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-sky-900">Reference {application.application_no}</p></div>}
      {showDetails && <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
        <div><h3 className="text-sm font-semibold text-slate-900">Complete eligibility</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{eligibilityText}</p>{academic && <p className="mt-2 text-sm text-slate-700">Initial application: incoming first-year students before classes start; deadline is approximately one week before classes. Continuing scholars may continue up to fourth year if requirements are maintained, with no default annual re-application.</p>}</div>
        <div><h3 className="text-sm font-semibold text-slate-900">Benefits</h3><p className="mt-1 text-sm text-slate-700">{academic ? '100% tuition coverage. Miscellaneous and other fees remain the student’s responsibility.' : program.benefits || 'Benefits have not been confirmed for this opportunity.'}</p></div>
        <div><h3 className="text-sm font-semibold text-slate-900">Required documents</h3>{academic ? <ul className="mt-1 space-y-1 text-sm text-slate-700"><li>Report Card (required)</li><li>Ranking Certificate (required)</li><li>Birth Certificate (required)</li></ul> : program.requirements.length ? <ul className="mt-1 space-y-1 text-sm text-slate-700">{program.requirements.map((name) => <li key={name}>{name}</li>)}</ul> : requirements.length ? <ul className="mt-1 space-y-1 text-sm text-slate-700">{requirements.map((requirement) => <li key={requirement.id}>{requirement.name}{requirement.is_required ? ' (required)' : ' (optional)'}</li>)}</ul> : <p className="mt-1 text-sm text-slate-600">Requirements have not been configured.</p>}</div>
        {program.application_type === 'WORKING_SCHOLAR' && <div><h3 className="text-sm font-semibold text-slate-900">Working Scholar availability and duties</h3><p className="mt-1 text-sm text-slate-700">{slots?.configured ? `${slots.remaining} of ${slots.max_slots} ${slots.uses_program_limit ? 'program' : 'schoolwide'} slots currently available.` : 'Working Scholar slots have not been configured.'}</p>{program.assigned_office && <p className="mt-1 text-sm text-slate-700">Work assignment: {program.assigned_office}</p>}<p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{program.description || 'Specific duties have not been provided for this program.'}</p><p className="mt-1 text-sm text-slate-600">Work schedule: Not specified.</p></div>}
        <div><h3 className="text-sm font-semibold text-slate-900">Application period</h3><p className="mt-1 text-sm text-slate-700">{program.opens_at || program.deadline ? `${program.opens_at ? niceDate(program.opens_at) : 'Opening date not configured'} – ${program.deadline ? niceDate(program.deadline) : 'Deadline not configured'}` : 'Application dates have not been configured.'}</p></div>
        <div><h3 className="text-sm font-semibold text-slate-900">Application procedure</h3><p className="mt-1 text-sm text-slate-700">Complete the online application, provide the requested information, upload the configured documents, review your details, and confirm submission.</p></div>
        {program.responsible_office && <p className="text-sm text-slate-700"><strong>Responsible office:</strong> {program.responsible_office}</p>}
      </div>}
      <div className="mt-auto flex flex-wrap gap-2 pt-5"><button type="button" className="btn-secondary btn-sm" aria-expanded={showDetails} onClick={() => setShowDetails((value) => !value)}>{showDetails ? 'Hide Details' : 'View Details'}</button>{application ? <Link href="/student/applications" className="btn-primary btn-sm inline-flex items-center gap-1">View Application <ArrowRight className="h-4 w-4" /></Link> : (status === 'Open' || status === 'Closing Soon') && <button type="button" className="btn-primary btn-sm inline-flex items-center gap-1" onClick={() => onApply(program)}>Apply Now <ArrowRight className="h-4 w-4" /></button>}</div>
    </article>
  );
}

function DocumentList({ documents, requirements, onOpen }: {
  documents: ApplicationDocument[]; requirements: Requirement[]; onOpen: (id: string) => void;
}) {
  if (!documents.length && !requirements.length) return <p className="mt-4 text-sm text-slate-600">No documents or checklist items are recorded yet.</p>;
  return <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">{(documents.length ? documents : []).map((document) => {
    const linkedRequirement = requirements.find((item) => item.id === document.requirement_id);
    const label = document.review_status === 'ACCEPTED' ? 'Accepted'
      : document.review_status === 'NEEDS_CORRECTION' ? 'Needs replacement'
        : document.review_status === 'REJECTED' ? 'Rejected' : 'Awaiting review';
    return <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="flex min-w-0 items-center gap-2"><FileCheck2 className="h-4 w-4 shrink-0 text-sky-800" /><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{linkedRequirement?.name ?? document.file_name}</p><p className="text-xs text-slate-600">{document.file_name} · {niceDate(document.created_at)}</p>{document.review_remarks && <p className="mt-1 text-xs text-amber-800">{document.review_remarks}</p>}</div></div><div className="flex items-center gap-2"><Pill color={document.review_status === 'ACCEPTED' ? 'green' : document.review_status === 'NEEDS_CORRECTION' || document.review_status === 'REJECTED' ? 'amber' : 'slate'}>{label}</Pill><button type="button" className="text-xs font-semibold text-sky-800 hover:underline" onClick={() => onOpen(document.id)}>Open</button></div></li>;
  })}{requirements.filter((requirement) => requirement.is_required && !documents.some((document) => document.requirement_id === requirement.id)).map((requirement) => <li key={requirement.id} className="flex items-center justify-between gap-2 p-3 text-sm"><span className="flex items-center gap-2 text-slate-700"><Clock3 className="h-4 w-4 text-amber-700" />{requirement.name}</span><Pill color="amber">Not submitted</Pill></li>)}</ul>;
}

function ApplicationDetails({ detail, onOpenDocument, compact = false }: {
  detail: ApplicationDetail; onOpenDocument: (id: string) => void; compact?: boolean;
}) {
  return (
    <div className={`mt-5 border-t border-slate-100 pt-4 ${compact ? '' : 'grid gap-5 md:grid-cols-2'}`}>
      <section><h3 className="text-sm font-bold text-slate-900">Status history</h3>{detail.history.length ? <ol className="mt-3 space-y-3">{detail.history.map((entry) => <li key={entry.id} className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-600" /><div><p className="text-sm font-semibold text-slate-800">{STATUS_LABELS[entry.to_status] ?? entry.to_status.replaceAll('_', ' ')}</p><p className="text-xs text-slate-500">{niceDate(entry.created_at)}{entry.reason ? ` · ${entry.reason}` : ''}</p></div></li>)}</ol> : <p className="mt-2 text-sm text-slate-600">No status history has been recorded.</p>}</section>
      <section className="mt-4 md:mt-0"><h3 className="text-sm font-bold text-slate-900">Application documents</h3>{detail.documents.length ? <ul className="mt-2 space-y-2">{detail.documents.map((document) => <li key={document.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate text-slate-700">{document.file_name} · {document.review_status.replaceAll('_', ' ')}</span><button type="button" className="shrink-0 text-xs font-semibold text-sky-800 hover:underline" onClick={() => onOpenDocument(document.id)}>Open</button></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No documents uploaded.</p>}{detail.followUps.length > 0 && <div className="mt-4"><h3 className="text-sm font-bold text-slate-900">Follow-up requests</h3><ul className="mt-2 space-y-2">{detail.followUps.map((followUp) => <li key={followUp.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{followUp.message}<span className="mt-1 block text-xs">{followUp.status} · {niceDate(followUp.created_at)}</span></li>)}</ul></div>}</section>
    </div>
  );
}

function EmptyState({ message, link, linkLabel }: { message: string; link: string; linkLabel: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sky-900"><GraduationCap className="h-6 w-6" /></span><h2 className="mt-4 font-bold text-slate-900">Nothing to show just yet</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{message}</p><Link className="btn-primary mt-5 inline-flex items-center gap-2" href={link}>{linkLabel}<ArrowRight className="h-4 w-4" /></Link></div>;
}
