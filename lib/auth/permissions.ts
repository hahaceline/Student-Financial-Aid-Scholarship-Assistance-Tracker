import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/env';
import { jsonError } from '@/lib/api';
import { ROLE_HOME } from '@/lib/role-config';
import type { AdminRole, Profile } from '@/lib/types';

export { ROLE_HOME } from '@/lib/role-config';

export function isAdminRole(v: unknown): v is AdminRole {
  return v === 'SUPER_ADMIN' || v === 'ACADEMIC_ADMIN'
    || v === 'WORKING_SCHOLAR_ADMIN' || v === 'FINANCE_ADMIN' || v === 'STUDENT';
}

export interface AdminContext {
  supabase: SupabaseClient;
  user: User;
  profile: Profile;
}

// The role ALWAYS comes from the profiles table, verified server-side on every request.
export const getCurrentAdmin = cache(async (): Promise<AdminContext | null> => {
  if (!getSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,full_name,role,is_active,created_at')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) {
    console.error('Authenticated profile lookup failed:', profileError.code, profileError.message);
    throw new Error('Could not resolve the authenticated user profile.');
  }
  if (!profile || profile.id !== data.user.id || !profile.is_active || !isAdminRole(profile.role)) return null;
  return { supabase, user: data.user, profile: profile as Profile };
});

export async function requireRole(roles: AdminRole | AdminRole[]): Promise<AdminContext> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const ctx = await getCurrentAdmin();
  if (!ctx) redirect('/login?error=unauthorized');
  if (ctx.user.app_metadata?.require_password_change === true) redirect('/reset-password');
  if (!allowed.includes(ctx.profile.role)) {
    redirect(ROLE_HOME[ctx.profile.role]);
  }
  return ctx;
}

export type ApiAuth =
  | { ctx: AdminContext; error?: undefined }
  | { ctx?: undefined; error: NextResponse };

export async function requireApiRole(roles: AdminRole | AdminRole[]): Promise<ApiAuth> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const ctx = await getCurrentAdmin();
  if (!ctx) return { error: jsonError('Please sign in again.', 401) };
  if (ctx.user.app_metadata?.require_password_change === true) {
    return { error: jsonError('Change your initial password before using this feature.', 403) };
  }
  if (!allowed.includes(ctx.profile.role)) return { error: jsonError('You do not have access to this action.', 403) };
  return { ctx };
}
