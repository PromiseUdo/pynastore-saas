/*
 * lib/storefront/design/preview.ts
 *
 * "Preview draft" (ROADMAP 15.1): letting the merchant see their unpublished
 * design on their real shop, without anyone else seeing it.
 *
 * Why a signed link and not the login cookie: the admin session cookie is
 * scoped to the platform's root domain, and a shop with its own domain is
 * permanently redirected there (proxy.ts) — where that cookie never arrives.
 * So the editor mints a short-lived link, signed with HMAC-SHA256 over
 * AUTH_SECRET and bound to one member of one shop. The storefront swaps it
 * for an httpOnly cookie on its own host and drops it from the address bar.
 *
 * The token alone grants nothing. On every preview request the member is
 * re-read: still active in THIS shop, and still allowed `storefront.design`
 * (or the Owner). Revoke someone and their preview stops on the next page.
 * The most a leaked link can show is colours and fonts that aren't live yet,
 * for at most an hour.
 *
 * Server only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';

export { PREVIEW_COOKIE } from './preview-cookie';
export const PREVIEW_TTL_MS = 60 * 60 * 1000;

/** Separates these signatures from any other use of the same secret. */
const PURPOSE = 'storefront-design-preview:v1';

interface PreviewToken {
  organizationId: string;
  userId: string;
  expiresAt: number;
}

function sign(payload: string): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return createHmac('sha256', secret).update(`${PURPOSE}.${payload}`).digest('base64url');
}

export function createPreviewToken(
  input: { organizationId: string; userId: string },
  now = Date.now(),
): string {
  const token: PreviewToken = { ...input, expiresAt: now + PREVIEW_TTL_MS };
  const payload = Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** A token that verifies and hasn't expired, or null. Never throws. */
export function readPreviewToken(raw: string | null | undefined, now = Date.now()): PreviewToken | null {
  if (!raw || raw.length > 1024) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  let expected: Buffer;
  try {
    expected = Buffer.from(sign(payload));
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewToken;
    if (typeof token.organizationId !== 'string' || typeof token.userId !== 'string') return null;
    if (!Number.isFinite(token.expiresAt) || token.expiresAt < now) return null;
    return token;
  } catch {
    return null;
  }
}

/** Is this member, right now, allowed to see this shop's draft design? */
export async function mayPreviewDesign(token: PreviewToken, organizationId: string): Promise<boolean> {
  if (token.organizationId !== organizationId) return false;
  const membership = await prisma.membership.findFirst({
    where: { userId: token.userId, organizationId, status: 'ACTIVE' },
    select: {
      role: {
        select: {
          name: true,
          isSystem: true,
          rolePermissions: {
            where: { permission: { key: PERMISSIONS.STOREFRONT_DESIGN } },
            select: { permissionId: true },
          },
        },
      },
    },
  });
  if (!membership) return false;
  // The Owner holds every permission, including ones added later (lib/organization.ts).
  if (membership.role.isSystem && membership.role.name === SYSTEM_ROLES.OWNER.name) return true;
  return membership.role.rolePermissions.length > 0;
}
