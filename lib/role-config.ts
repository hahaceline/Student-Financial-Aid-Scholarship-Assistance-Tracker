import type { AdminRole } from '@/lib/types';

export const ROLE_HOME: Record<AdminRole, string> = {
  SUPER_ADMIN: '/super-admin/dashboard',
  ACADEMIC_ADMIN: '/academic/dashboard',
  WORKING_SCHOLAR_ADMIN: '/working-scholar/dashboard',
  FINANCE_ADMIN: '/finance/dashboard',
  STUDENT: '/student/dashboard',
};
