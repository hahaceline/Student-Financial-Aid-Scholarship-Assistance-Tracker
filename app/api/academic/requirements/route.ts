import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/permissions';
import { dbError, jsonError } from '@/lib/api';

const requirementSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  is_required: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(10000),
});

export async function POST(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const parsed = requirementSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Provide a valid document requirement.', 400);
  const { data, error } = await auth.ctx.supabase.from('document_requirements').insert({
    ...parsed.data, application_type: 'ACADEMIC', accepted_mime_types: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
    max_file_size_bytes: 10485760,
  }).select('id,name,description,is_required,is_active,sort_order').single();
  if (error) return dbError(error);
  return NextResponse.json({ requirement: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApiRole('ACADEMIC_ADMIN');
  if (auth.error) return auth.error;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body.', 400); }
  const parsed = z.object({ id: z.string().uuid(), is_active: z.boolean() }).safeParse(body);
  if (!parsed.success) return jsonError('Provide a valid requirement and active state.', 400);
  const { data, error } = await auth.ctx.supabase.from('document_requirements')
    .update({ is_active: parsed.data.is_active }).eq('id', parsed.data.id).eq('application_type', 'ACADEMIC')
    .select('id').maybeSingle();
  if (error) return dbError(error);
  if (!data) return jsonError('Academic requirement not found.', 404);
  return NextResponse.json({ ok: true });
}
