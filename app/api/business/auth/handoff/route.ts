/*
 * GET /api/business/auth/handoff?token=…&verifier=…&next=…
 *
 * The business app's staff sign-in, step 3 of 3 (ROADMAP 19.2). Opened by
 * the app's own WebView, on the business host, with the verifier only that
 * WebView holds: spends the one-minute ticket and sets the session HERE,
 * where the app will use it. A wrong or missing verifier, a spent or
 * expired ticket, or any other host signs nobody in.
 */
import { NextResponse } from 'next/server';
// next-auth re-exports this same class; importing it from here keeps the route testable.
import { AuthError } from '@auth/core/errors';
import { signIn } from '@/lib/auth';
import { safeBusinessPath } from '@/lib/tenant/business';
import { resolveHostname } from '@/lib/tenant/resolveHostname';
import { getBusinessUrl } from '@/lib/tenant/urls';

export async function GET(request: Request) {
  if (resolveHostname(request.headers.get('host')).siteType !== 'business') {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const failed = () => {
    const login = new URL(getBusinessUrl('/login'));
    login.searchParams.set('error', 'app-sign-in');
    return NextResponse.redirect(login);
  };

  try {
    const target = await signIn('app-handoff', {
      token: url.searchParams.get('token') ?? '',
      verifier: url.searchParams.get('verifier') ?? '',
      redirectTo: getBusinessUrl(safeBusinessPath(url.searchParams.get('next') || '/')),
      redirect: false,
    });
    // A refused ticket comes back as Auth.js's error page, not as a throw, in some versions.
    if (!target || new URL(target, getBusinessUrl()).searchParams.has('error')) return failed();
    return NextResponse.redirect(new URL(target, getBusinessUrl()));
  } catch (error) {
    if (error instanceof AuthError) return failed();
    throw error;
  }
}
