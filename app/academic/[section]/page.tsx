import { notFound } from 'next/navigation';
import { AcademicSection } from '@/components/academic/academic-section';
import { requireRole } from '@/lib/auth/permissions';

const SECTIONS = new Set([
  'applications', 'requirements', 'eligibility', 'examinations', 'grade-monitoring',
  'enrollment', 'scholars', 'conflicts', 'feedback', 'reports', 'settings',
]);

export default async function AcademicSectionPage({ params }: { params: Promise<{ section: string }> }) {
  await requireRole('ACADEMIC_ADMIN');
  const { section } = await params;
  if (!SECTIONS.has(section)) notFound();
  return <AcademicSection section={section} />;
}
