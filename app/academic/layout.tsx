import type { ReactNode } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { requireRole } from '@/lib/auth/permissions';

export default async function AcademicLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireRole('ACADEMIC_ADMIN');
  return (
    <AdminLayout role={profile.role} fullName={profile.full_name} email={profile.email}>
      {children}
    </AdminLayout>
  );
}
