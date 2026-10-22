import type { ApplicationStatus, DocumentReviewStatus } from '@/lib/status';

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'ACADEMIC_ADMIN'
  | 'WORKING_SCHOLAR_ADMIN'
  | 'FINANCE_ADMIN'
  | 'STUDENT';

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ACADEMIC_ADMIN: 'Academic Admin',
  WORKING_SCHOLAR_ADMIN: 'Working Scholar Admin',
  FINANCE_ADMIN: 'Finance Admin',
  STUDENT: 'Student',
};

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at?: string;
}

export interface ApplicationRow {
  id: string;
  application_no: string;
  student_number: string | null;
  student_name: string;
  email: string | null;
  course: string;
  year_level: number;
  assigned_office: string | null;
  application_date: string;
  status: ApplicationStatus;
  review_remarks: string | null;
  denial_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlotSummary {
  configured: boolean;
  max_slots: number;
  applications_open: boolean;
  active_scholars: number;
  remaining: number;
}

export interface DocumentRow {
  id: string;
  requirement_id: string | null;
  file_name: string;
  storage_path: string | null;
  review_status: DocumentReviewStatus;
  review_remarks: string | null;
  created_at: string;
  reviewed_at: string | null;
  requirement: { name: string } | null;
}

export interface RequirementRow {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  accepted_mime_types: string[];
  max_file_size_bytes: number;
  created_at?: string;
  updated_at?: string;
}

export interface FollowUpRow {
  id: string;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  requirement: { name: string } | null;
}

export interface ActionState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
}
