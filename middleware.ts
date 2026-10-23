import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv } from '@/lib/env';

// Middleware refreshes the session and redirects anonymous visitors.
// It is NOT the security boundary: every page, API route and RLS policy re-checks.
const PUBLIC_PATHS = ['/login', '/auth'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDemoPath = pathname === '/demo' || pathname.startsWith('/demo/')
    || pathname === '/api/demo' || pathname.startsWith('/api/demo/');
  const demoModeEnabled = process.env.DEMO_MODE_ENABLED === 'true'
    && !!process.env.DEMO_SESSION_SECRET
    && !!process.env.DEMO_ACCESS_PASSWORD;
  if (isDemoPath && demoModeEnabled) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isApi = pathname.startsWith('/api/');
  const env = getSupabaseEnv();

  if (!env) {
    if (!isPublic && !isApi) return NextResponse.redirect(new URL('/login', request.url));
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublic && !isApi) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return response;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
