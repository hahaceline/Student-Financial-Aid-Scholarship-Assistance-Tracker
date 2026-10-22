import { notFound } from 'next/navigation';
import { AcademicApplicationWorkspace } from '@/components/academic/academic-application-workspace';
import { requireRole } from '@/lib/auth/permissions';
import { isUuid } from '@/lib/utils';

export default async function AcademicApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('ACADEMIC_ADMIN');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AcademicApplicationWorkspace id={id} />;
}
