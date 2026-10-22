import { AcademicProgramForm } from '@/components/academic/academic-program-form';
import { requireRole } from '@/lib/auth/permissions';

export default async function AcademicProgramsPage() {
  await requireRole('ACADEMIC_ADMIN');
  return <AcademicProgramForm />;
}
