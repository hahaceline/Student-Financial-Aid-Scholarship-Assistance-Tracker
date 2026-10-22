import { NextResponse, type NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';
import { isUuid } from '@/lib/utils';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('STUDENT');
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isUuid(id)) return jsonError('Award notice not found.', 404);
  const { data, error } = await auth.ctx.supabase.rpc('acknowledge_academic_award', { p_award_id: id });
  if (error) return dbError(error);
  if (!data) return jsonError('Award notice not found.', 404);
  return NextResponse.json({ award: data });
}
