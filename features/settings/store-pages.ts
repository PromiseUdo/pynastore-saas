'use server';

/*
 * features/settings/store-pages.ts
 *
 * The online store's pages — About, Delivery and returns, FAQ, Size guide,
 * Contact, Terms, Privacy, and any others the merchant adds. The storefront
 * serves exactly the published ones at /pages/{web address} and links them
 * from the footer, checkout, the cookie notice and product pages
 * (lib/storefront/pages/rules.ts decides where).
 *
 * The words are the merchant's. Nothing here writes, fills in or suggests
 * page text: these pages are the store's promises and often its legal
 * position, so they must be ones the merchant made.
 *
 * Viewing needs `settings.view`; changing needs `settings.edit` — the same
 * as the delivery and returns settings these pages describe.
 *
 * A web address is set when a page is created and only changes when the
 * merchant edits it — renaming a page never moves it, so links customers
 * saved or shared keep working.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { PAGE_BODY_MAX } from '@/lib/storefront/pages/format';
import {
  PAGE_SLUG_MAX,
  STORE_PAGE_KINDS,
  STORE_PAGE_KIND_INFO,
  isValidPageSlug,
  pageSlugFrom,
  uniquePageSlug,
  type StorePageKind,
} from '@/lib/storefront/pages/rules';

type Result<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

/** More than any store needs; keeps the footer and the admin list sane. */
const MAX_PAGES = 50;

/* ---------------- reading ---------------- */

export interface StorePageRow {
  id: string;
  kind: StorePageKind;
  title: string;
  slug: string;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  /** a rough length, so the list can show an empty draft for what it is */
  wordCount: number;
}

export interface StorePageDetail extends StorePageRow {
  body: string;
}

/**
 * What the app itself enforces, shown beside the Delivery and returns page
 * so what the merchant writes can match what checkout and the returns form
 * actually do.
 */
export interface StoreFacts {
  returnWindowDays: number | null;
  activeDeliveryZones: number;
  activePickupLocations: number;
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change store pages' };
  }
  console.error(`[settings/store-pages] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function context(permission: 'view' | 'edit') {
  const ctx = await getOrganizationContext();
  requirePermission(
    ctx.membership.role.permissions,
    permission === 'view' ? PERMISSIONS.SETTINGS_VIEW : PERMISSIONS.SETTINGS_EDIT,
  );
  return ctx;
}

const words = (body: string) => body.split(/\s+/).filter(Boolean).length;

const ROW_SELECT = {
  id: true,
  kind: true,
  title: true,
  slug: true,
  body: true,
  isPublished: true,
  publishedAt: true,
  updatedAt: true,
} as const;

function toDetail(row: {
  id: string;
  kind: string;
  title: string;
  slug: string;
  body: string;
  isPublished: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}): StorePageDetail {
  return {
    id: row.id,
    kind: row.kind as StorePageKind,
    title: row.title,
    slug: row.slug,
    body: row.body,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    wordCount: words(row.body),
  };
}

export async function listStorePages(): Promise<Result<StorePageRow[]>> {
  try {
    const ctx = await context('view');
    const rows = await prisma.storePage.findMany({
      where: { organizationId: ctx.organization.id },
      select: ROW_SELECT,
      orderBy: [{ title: 'asc' }],
    });
    return {
      success: true,
      data: rows.map((row) => {
        const { body: _body, ...rest } = toDetail(row);
        return rest;
      }),
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your store pages');
  }
}

export async function getStorePageForEdit(pageId: string): Promise<Result<StorePageDetail | null>> {
  try {
    const ctx = await context('view');
    const row = await prisma.storePage.findFirst({
      where: { id: pageId, organizationId: ctx.organization.id },
      select: ROW_SELECT,
    });
    return { success: true, data: row ? toDetail(row) : null };
  } catch (error) {
    return failure(error, 'We couldn’t load this page');
  }
}

export async function getStoreFacts(): Promise<Result<StoreFacts>> {
  try {
    const ctx = await context('view');
    const organizationId = ctx.organization.id;
    const [org, activeDeliveryZones, activePickupLocations] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { returnWindowDays: true } }),
      prisma.deliveryZone.count({ where: { organizationId, isActive: true } }),
      prisma.pickupLocation.count({ where: { organizationId, isActive: true } }),
    ]);
    return {
      success: true,
      data: { returnWindowDays: org?.returnWindowDays ?? null, activeDeliveryZones, activePickupLocations },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your store settings');
  }
}

/* ---------------- saving ---------------- */

const PageSchema = z
  .object({
    kind: z.enum(STORE_PAGE_KINDS),
    title: z.string().trim(),
    /** empty on a new page: one is made from the title */
    slug: z.string().trim().toLowerCase(),
    body: z.string().transform((body) => body.replace(/\r\n?/g, '\n')),
    isPublished: z.boolean(),
  })
  .superRefine((page, ctx) => {
    if (page.title.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Give the page a title' });
    } else if (page.title.length > 80) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Keep the title under 80 characters' });
    }
    if (page.slug && !isValidPageSlug(page.slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: `Use lower-case letters, numbers and dashes only, up to ${PAGE_SLUG_MAX} characters`,
      });
    }
    if (page.body.length > PAGE_BODY_MAX) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'This page is too long — split it into two pages' });
    }
    // A published page with nothing on it is a dead end with a link pointing at it.
    if (page.isPublished && !page.body.trim()) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write the page before publishing it' });
    }
  });

export type StorePageInput = z.input<typeof PageSchema>;

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function saveStorePage(
  pageId: string | null,
  input: StorePageInput,
): Promise<Result<{ id: string; slug: string }>> {
  try {
    const ctx = await context('edit');
    const organizationId = ctx.organization.id;
    const parsed = PageSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const page = parsed.data;

    const [existing, siblings] = await Promise.all([
      pageId
        ? prisma.storePage.findFirst({
            where: { id: pageId, organizationId },
            select: { kind: true, slug: true, isPublished: true, publishedAt: true },
          })
        : null,
      prisma.storePage.findMany({
        where: { organizationId, ...(pageId ? { NOT: { id: pageId } } : {}) },
        select: { kind: true, slug: true, title: true },
      }),
    ]);
    if (pageId && !existing) return { success: false, error: 'That page no longer exists' };

    // What a page is for doesn't change once it exists — it decides where the store links it.
    const kind = existing ? (existing.kind as StorePageKind) : page.kind;

    if (!existing && siblings.length >= MAX_PAGES) {
      return { success: false, error: `A store can have up to ${MAX_PAGES} pages. Delete one you no longer need first.` };
    }
    if (kind !== 'CUSTOM') {
      const other = siblings.find((s) => s.kind === kind);
      if (other) {
        return {
          success: false,
          error: `You already have a ${STORE_PAGE_KIND_INFO[kind].label.toLowerCase()} page (“${other.title}”). Edit that one instead.`,
        };
      }
    }

    const taken = siblings.map((s) => s.slug);
    let slug: string;
    if (page.slug) {
      if (taken.includes(page.slug)) {
        return {
          success: false,
          error: 'Another page already uses that web address',
          fieldErrors: { slug: 'Another of your pages already uses this web address' },
        };
      }
      slug = page.slug;
    } else if (existing) {
      // Cleared the box on an existing page: keep the address it already has.
      slug = existing.slug;
    } else {
      const base = kind === 'CUSTOM' ? pageSlugFrom(page.title) : STORE_PAGE_KIND_INFO[kind].slug;
      slug = uniquePageSlug(base, taken);
    }

    const publishedAt = page.isPublished ? (existing?.isPublished ? existing.publishedAt : new Date()) : null;
    const data = { title: page.title, slug, body: page.body, isPublished: page.isPublished, publishedAt };

    let id: string;
    if (pageId) {
      await prisma.storePage.update({ where: { id: pageId }, data });
      id = pageId;
    } else {
      id = (await prisma.storePage.create({ data: { ...data, kind, organizationId }, select: { id: true } })).id;
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: pageId ? 'settings.store_page.update' : 'settings.store_page.create',
      entityType: 'StorePage',
      entityId: id,
      metadata: {
        kind,
        slug,
        isPublished: page.isPublished,
        ...(existing && existing.slug !== slug ? { previousSlug: existing.slug } : {}),
      },
    });

    return { success: true, data: { id, slug } };
  } catch (error) {
    // The unique index is the last word on web addresses (two tabs saving at once).
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return {
        success: false,
        error: 'Another page already uses that web address',
        fieldErrors: { slug: 'Another of your pages already uses this web address' },
      };
    }
    return failure(error, 'We couldn’t save this page');
  }
}

export async function setStorePagePublished(pageId: string, isPublished: boolean): Promise<Result> {
  try {
    const ctx = await context('edit');
    const page = await prisma.storePage.findFirst({
      where: { id: pageId, organizationId: ctx.organization.id },
      select: { body: true, isPublished: true },
    });
    if (!page) return { success: false, error: 'That page no longer exists' };
    if (isPublished && !page.body.trim()) {
      return { success: false, error: 'This page has nothing written on it yet. Write it before publishing.' };
    }
    if (page.isPublished === isPublished) return { success: true, data: undefined };

    await prisma.storePage.update({
      where: { id: pageId },
      data: { isPublished, publishedAt: isPublished ? new Date() : null },
    });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: isPublished ? 'settings.store_page.publish' : 'settings.store_page.unpublish',
      entityType: 'StorePage',
      entityId: pageId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t change this page');
  }
}

export async function deleteStorePage(pageId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const page = await prisma.storePage.findFirst({
      where: { id: pageId, organizationId: ctx.organization.id },
      select: { kind: true, slug: true, title: true },
    });
    if (!page) return { success: false, error: 'That page no longer exists' };

    await prisma.storePage.delete({ where: { id: pageId } });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.store_page.delete',
      entityType: 'StorePage',
      entityId: pageId,
      metadata: { kind: page.kind, slug: page.slug, title: page.title },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t delete this page');
  }
}
