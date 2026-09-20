/*
 * Requests to the storefront API routes as a browser would send them, and
 * throwaway stores to send them to.
 *
 * The routes decide the store from the request itself
 * (lib/storefront/request-store.ts), so a test has to reproduce what really
 * arrives: the Host header of a store's own domain, or — on the mobile mall —
 * the shared host plus the Referer of the /s/{slug} page the call came from.
 */
import { prisma } from '@/lib/prisma';

export const ROOT_DOMAIN = 'app.localhost:3000';
export const MOBILE_DOMAIN = 'm.app.localhost:3000';

/** Pin the domains the host parser reads, so tests don't depend on a local .env. */
export function pinDomains(): void {
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = ROOT_DOMAIN;
  process.env.NEXT_PUBLIC_MOBILE_DOMAIN = MOBILE_DOMAIN;
}

export const storefrontHost = (slug: string) => `shop.${slug}.${ROOT_DOMAIN}`;

/** A call from a page on the store's own domain (shop.{slug}.{root}). */
export function storefrontRequest(
  slug: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  const host = storefrontHost(slug);
  return new Request(`http://${host}${path}`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', referer: `http://${host}/`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * A call from the mobile mall. `pageSlug` is the store whose /s/{slug} page
 * the shopper is on (null = the browser sent no Referer).
 */
export function mobileRequest(
  pageSlug: string | null,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://${MOBILE_DOMAIN}${path}`, {
    method: 'POST',
    headers: {
      host: MOBILE_DOMAIN,
      'content-type': 'application/json',
      ...(pageSlug ? { referer: `http://${MOBILE_DOMAIN}/s/${pageSlug}/products/something` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Active organisations with unique slugs; `cleanup` deletes them. */
export async function createTestStores(prefix: string, count: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stores: { id: string; slug: string }[] = [];
  for (let i = 0; i < count; i++) {
    const slug = `${prefix}-${i}-${suffix}`;
    const org = await prisma.organization.create({ data: { name: `Test store ${i}`, slug }, select: { id: true, slug: true } });
    stores.push(org);
  }
  const cleanup = async () => {
    await prisma.organization.deleteMany({ where: { id: { in: stores.map((s) => s.id) } } });
  };
  return { stores, cleanup };
}
