/*
 * /design-preview on a storefront (ROADMAP 15.1).
 *
 *   ?token=…  — the signed link from Online store → Customize → Preview.
 *               Checked (signature, expiry, this shop, the member still on
 *               its team with `storefront.design`), then swapped for an
 *               httpOnly cookie on THIS host and dropped from the address
 *               bar. A link that fails just opens the shop as shoppers see
 *               it — no error page that confirms anything about the token.
 *   ?exit=1   — clears the cookie and goes back to the live look.
 *
 * The cookie is re-checked on every page (app/store/[organizationSlug]/
 * layout.tsx), so holding it grants nothing on its own. See
 * lib/storefront/design/preview.ts for why this is a signed link rather than
 * the admin session.
 */
import { prisma } from '@/lib/prisma';
import { PREVIEW_COOKIE, mayPreviewDesign, readPreviewToken } from '@/lib/storefront/design/preview';

export const dynamic = 'force-dynamic';

function home(cookie: string | null): Response {
  /* A relative Location: this handler runs behind proxy.ts's rewrite, so
   * request.url names /store/{slug}/…, not the address the shopper used. */
  const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function cookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PREVIEW_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const search = new URL(request.url).searchParams;

  if (search.has('exit')) return home(cookie('', 0));

  const raw = search.get('token');
  const token = readPreviewToken(raw);
  if (!raw || !token) return home(null);

  const organization = await prisma.organization.findFirst({
    where: { slug: organizationSlug, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!organization || !(await mayPreviewDesign(token, organization.id))) return home(null);

  const seconds = Math.max(1, Math.floor((token.expiresAt - Date.now()) / 1000));
  // base64url and "." only — cookie-safe as it is.
  return home(cookie(raw, seconds));
}
