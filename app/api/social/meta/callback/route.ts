/*
 * app/api/social/meta/callback/route.ts
 *
 * Where Meta sends the merchant back after they authorise MansaaS.
 *
 * This handler is the one place in the social system that runs WITHOUT the
 * tenant context the rest of the app relies on:
 *
 *   - Meta matches redirect URIs exactly and allows no wildcard, so this URL
 *     lives on the root domain, not on {slug}.{ROOT_DOMAIN}.
 *   - proxy.ts excludes /api from its matcher, so there is no `x-org-slug`
 *     header here even if it did.
 *
 * So the organization arrives inside the signed `state`, and this handler
 * treats it as a CLAIM, not as an authorisation. Before anything is written:
 *
 *   1. the state's HMAC must verify        → the org id wasn't edited
 *   2. its nonce must match the httpOnly cookie → not a replayed link
 *   3. it must not have expired
 *   4. there must be a signed-in user      → the session cookie is scoped to
 *                                            .{ROOT_DOMAIN}, so it is here
 *   5. that user must be the one who started the flow
 *   6. that user must STILL hold an active membership in that organization
 *      with `social.manage`                → the actual tenant boundary
 *
 * Only then are the accounts fetched and parked in a draft, and the merchant
 * is sent to their own subdomain to choose. The access tokens Meta returned
 * never touch the redirect URL, the cookie, or anything the browser can read.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { getMarketingUrl } from '@/lib/tenant/urls';
import { getRootDomain, isLocalHostname } from '@/lib/tenant/resolveHostname';
import { decodeState, STATE_COOKIE } from '@/lib/social/state';
import { metaRedirectUri } from '@/lib/social/config';
import { createConnectionDraft } from '@/lib/social/service';
import { metaProvider } from '@/lib/social/providers/meta';
import { SocialProviderError } from '@/lib/social/types';

/** Tokens and per-merchant data: never cached, never statically rendered. */
export const dynamic = 'force-dynamic';

/**
 * Sends the merchant back to their own dashboard with a short reason code.
 * Only codes — never Meta's raw error text, which is written for developers
 * and can be alarming or misleading in a shop owner's browser.
 */
function backToDashboard(returnTo: string | null, params: Record<string, string>): NextResponse {
  const target = new URL(returnTo ?? getMarketingUrl('/'));
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  const response = NextResponse.redirect(target);
  // The nonce is spent either way — success or failure.
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: !isLocalHostname(getRootDomain()),
    domain: `.${getRootDomain().split(':')[0]}`,
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  const metaError = url.searchParams.get('error');

  /* 1–3. The state has to verify before its contents mean anything — in
   * particular before `returnTo` is used as a redirect target, which is why
   * nothing redirects anywhere tenant-specific above this line. */
  let state;
  try {
    state = decodeState(rawState, request.cookies.get(STATE_COOKIE)?.value ?? null);
  } catch (error) {
    console.error('[social] callback rejected an unverifiable state:', error);
    // An unsigned state's returnTo is not trustworthy — go to the safe origin.
    return backToDashboard(getMarketingUrl('/'), { social_error: 'expired' });
  }

  /* `returnTo` came out of a signature we just verified, but it is still a
   * URL that will be handed to the browser. Confine it to this deployment's
   * own domains so a compromised signing key can't also become an open
   * redirect. */
  const returnTo = safeReturnTo(state.returnTo);

  // The merchant pressed Cancel on Meta's dialog, or Meta refused.
  if (metaError) {
    const denied = metaError === 'access_denied';
    console.warn('[social] Meta returned an error:', metaError);
    return backToDashboard(returnTo, { social_error: denied ? 'denied' : 'meta' });
  }

  if (!code) {
    return backToDashboard(returnTo, { social_error: 'denied' });
  }

  // 4–5. A signed state is not a session. Both must agree.
  const session = await auth();
  if (!session?.user?.id) {
    return backToDashboard(returnTo, { social_error: 'signed_out' });
  }
  if (session.user.id !== state.userId) {
    console.error('[social] callback state belonged to a different user');
    return backToDashboard(returnTo, { social_error: 'expired' });
  }

  /* 6. THE tenant check. Re-read from the database rather than trusting the
   * JWT's current-org claim: a member can be removed, suspended, or have
   * their role changed between starting the flow and coming back, and the
   * state itself only proves the id wasn't tampered with — not that this
   * user may act for that store. */
  if (!(await canManageSocial(session.user.id, state.organizationId))) {
    console.error('[social] callback user may not manage social for the claimed organization');
    return backToDashboard(returnTo, { social_error: 'forbidden' });
  }

  try {
    /* The SAME URL the authorization request used — Meta compares them. */
    const result = await metaProvider.exchangeCode(code, metaRedirectUri());

    if (result.accounts.length === 0) {
      return backToDashboard(returnTo, { social_error: 'no_pages' });
    }

    const draftId = await createConnectionDraft(state.organizationId, session.user.id, state.provider, result);

    /* The chooser lives on the merchant's own subdomain, where the org
     * context exists again. Only the draft id travels in the URL: it is
     * useless to anyone but this member in this store. */
    const target = new URL(returnTo);
    target.pathname = target.pathname.replace(/\/social\/?$/, '/social/connect');
    target.searchParams.set('draft', draftId);
    return backToDashboard(target.toString(), {});
  } catch (error) {
    if (error instanceof SocialProviderError) {
      console.error('[social] exchange failed:', error.kind, error.message);
      return backToDashboard(returnTo, {
        social_error: error.kind === 'permission_missing' ? 'permissions' : 'meta',
      });
    }
    console.error('[social] callback failed:', error);
    return backToDashboard(returnTo, { social_error: 'meta' });
  }
}

/** Only this deployment's own hosts may be redirected to. */
function safeReturnTo(candidate: string): string {
  try {
    const parsed = new URL(candidate);
    const root = getRootDomain().split(':')[0];
    if (parsed.hostname === root || parsed.hostname.endsWith(`.${root}`)) return parsed.toString();
  } catch {
    /* fall through */
  }
  return getMarketingUrl('/');
}

/**
 * Active membership + `social.manage`, read fresh.
 *
 * Mirrors lib/organization.ts, including its rule that an Owner holds every
 * permission at runtime — a store whose Owner role predates this permission
 * must still be able to connect an account.
 */
async function canManageSocial(userId: string, organizationId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: {
      role: {
        select: {
          name: true,
          isSystem: true,
          rolePermissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });
  if (!membership) return false;

  if (membership.role.isSystem && membership.role.name === SYSTEM_ROLES.OWNER.name) return true;
  return membership.role.rolePermissions.some((rp) => rp.permission.key === PERMISSIONS.SOCIAL_MANAGE);
}

/* Meta's dialog only ever sends the merchant here by GET. Anything else is
 * not part of the flow. */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
