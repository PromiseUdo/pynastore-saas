/*
 * lib/storefront/data/current.ts
 *
 * Which store a catalogue read belongs to, and the one place that decides it.
 *
 * Two ways in, in order:
 *   1. an explicit `store` scope — how every /api/storefront/* route names
 *      its tenant, since proxy.ts excludes /api from the tenant rewrite;
 *   2. the `x-org-slug` header proxy.ts stamps on storefront page requests.
 *
 * If neither is present we refuse rather than guess: serving one merchant's
 * catalogue under another's domain is the one failure this layer must never
 * have. The loaded catalogue is memoised per request (React `cache`), so a
 * page that reads products, categories and collections queries once.
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import type { StoreScope } from '../types';
import { emptyCatalogue, type Catalogue } from './catalogue';
import { loadCatalogueFromDb } from './from-prisma';
import { fixtureCatalogue } from './from-fixtures';

export class StorefrontTenantError extends Error {
  constructor() {
    super('No storefront tenant in scope: pass `store: { organizationSlug }` or call from a storefront request');
    this.name = 'StorefrontTenantError';
  }
}

/**
 * Tests run the engine over the demo catalogue: they assert query behaviour
 * and that the store scope is carried, neither of which needs a database.
 * `STOREFRONT_FIXTURES=1` opts a local dev server into the same thing, for
 * demoing the storefront without seeding a catalogue first.
 *
 * `STOREFRONT_FIXTURES=0` is the opposite instruction, and the only reason
 * it exists: a few tests place real orders against real products (see
 * tests/storefront-orders.test.ts), and an order's line items are foreign
 * keys into the merchant's catalogue — a fixture id would have nothing to
 * point at. Those tests ask for the database explicitly.
 */
export function useFixtures(): boolean {
  const explicit = process.env.STOREFRONT_FIXTURES;
  if (explicit === '0') return false;
  if (explicit === '1') return true;
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

async function slugFromRequest(): Promise<string | null> {
  try {
    return (await headers()).get('x-org-slug');
  } catch {
    // Not in a request (a script, or a test) — nothing to read.
    return null;
  }
}

/** Per-request memo, keyed by slug: one DB read serves the whole render. */
const load = cache(async (organizationSlug: string): Promise<Catalogue> => {
  const catalogue = await loadCatalogueFromDb(organizationSlug);
  // An unknown or suspended store reads as empty rather than as an error, so
  // an API call with a stale slug returns nothing instead of a 500.
  return catalogue ?? emptyCatalogue(organizationSlug);
});

/**
 * The slug a read belongs to, by the same two rules as the catalogue — for
 * store data that isn't part of the catalogue (the merchant's pages).
 * Throws rather than guessing, exactly like `getCatalogue`.
 */
export async function resolveStoreSlug(scope?: StoreScope): Promise<string> {
  const slug = scope?.organizationSlug?.trim() || (await slugFromRequest());
  if (!slug) {
    if (useFixtures()) return 'demo';
    throw new StorefrontTenantError();
  }
  return slug;
}

export async function getCatalogue(scope?: StoreScope): Promise<Catalogue> {
  const slug = scope?.organizationSlug?.trim() || (await slugFromRequest());

  if (useFixtures()) return fixtureCatalogue(slug || 'demo');
  if (!slug) throw new StorefrontTenantError();

  return load(slug);
}
