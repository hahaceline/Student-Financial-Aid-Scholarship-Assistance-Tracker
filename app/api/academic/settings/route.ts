import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';

const settingsSchema = z.object({
  minimum_gwa: z.literal(90),
  minimum_subject_grade: z.literal(85),
  eligible_programs: z.array(z.enum(['BS Ed', 'BE Ed', 'BSSW'])).length(3),
  benefits: z.string().trim().min(1).max(2000),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Provide valid Academic Scholarship settings.', 400);
  const { data, error } = await auth.ctx.supabase.from('academic_scholarship_rules').update({
    ...parsed.data, updated_by: auth.ctx.profile.id, updated_at: new Date().toISOString(),
  }).eq('id', true).select('*').maybeSingle();
  if (error) return dbError(error);
  if (!data) return jsonError('Academic Scholarship rules have not been initialized. Apply the workflow migration first.', 409);
  return NextResponse.json({ rules: data });
}
