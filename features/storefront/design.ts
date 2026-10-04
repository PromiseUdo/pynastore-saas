'use server';

/*
 * features/storefront/design.ts
 *
 * Online store → Customize → Look (ROADMAP 15.1): the shop's look, colour,
 * light/dark default and Fine-tune, saved as a draft and published in one
 * step.
 *
 *   save draft  → StorefrontDesign.draft (shoppers see nothing change)
 *   preview     → a signed link that shows the draft to this member only
 *   publish     → draft copied to `published` in ONE conditional update,
 *                 naming the draft the merchant saw, so a draft someone else
 *                 changed in the meantime is never published unseen
 *   discard     → the draft is dropped; the live shop is untouched
 *
 * Everything takes the organization from getOrganizationContext(), never
 * from the browser, and needs `storefront.design` — to read as well as to
 * change. Publishing and discarding are audited; saving a draft is not,
 * because no shopper sees a draft and the publish records what went live.
 */
import type { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';
import { isOrgAsset } from '@/lib/cloudinary/sign';
import { checkBrandColour } from '@/lib/storefront/design/colour';
import { LOOKS } from '@/lib/storefront/design/looks';
import {
  DESIGN_VERSION,
  DesignSchema,
  classicDesign,
  parseDesign,
  type StorefrontDesignConfig,
} from '@/lib/storefront/design/schema';
import { createPreviewToken } from '@/lib/storefront/design/preview';
import type { HomepageSection } from '@/lib/storefront/sections/schema';
import {
  STARTING_LOOK_IDS,
  applyStartingLook,
  startingLookFor,
  type StartingLookId,
} from '@/lib/storefront/design/starting-looks';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import type { ActionResult } from '@/features/sales/shared';

export interface DesignEditorData {
  /** what shoppers see now — Classic when nothing has been published */
  live: StorefrontDesignConfig;
  /** the saved draft, or null when there isn't one */
  draft: StorefrontDesignConfig | null;
  /** ISO time the draft was saved; publish must name it */
  draftSavedAt: string | null;
  /** ISO time of the last publish, or null if the shop is still on Classic-by-default */
  publishedAt: string | null;
  /** the starting look that suits what the merchant said they sell (15.6) */
  suggestedStartingLook: StartingLookId;
}

/** What the editor sends: everything but the version, `sections` optional (null = Classic front page). */
export type DesignInput = Omit<z.input<typeof DesignSchema>, 'version'>;

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change your online store’s look' };
  }
  console.error(`[storefront-design] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/** Schema, then the colour against the chosen look. One rule for save and publish. */
function validate(input: unknown): { ok: true; design: StorefrontDesignConfig } | { ok: false; error: string } {
  const parsed = DesignSchema.safeParse(
    input && typeof input === 'object' ? { ...(input as object), version: DESIGN_VERSION } : input,
  );
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'That design isn’t valid' };
  const design = parsed.data;
  if (design.brandColour) {
    const check = checkBrandColour(design.brandColour, LOOKS[design.look].background, LOOKS[design.look].darkBackground);
    if (!check.ok) {
      return {
        ok: false,
        error: check.suggestion ? `${check.error} Try ${check.suggestion}.` : check.error,
      };
    }
  }
  return { ok: true, design };
}

/**
 * Every collection, category and brand a section names must be this shop's
 * and still on show. Checked on save and again on publish — something can be
 * deleted in between. (The storefront also copes if one disappears after
 * publishing: that band is just left out.)
 */
async function checkReferences(organizationId: string, sections: HomepageSection[] | null): Promise<string | null> {
  if (!sections) return null;
  /* A picture must have been uploaded through THIS shop — the same check as
   * a slide or a logo, so another shop's (or anyone's) image can't be shown. */
  for (const section of sections) {
    if (section.type === 'image-text' && section.image && !isOrgAsset(section.image, organizationId)) {
      return `The picture in “${section.heading}” wasn’t uploaded through this shop. Remove it and upload it again.`;
    }
  }
  const wanted = { collection: new Set<string>(), category: new Set<string>(), brand: new Set<string>() };
  for (const section of sections) {
    if (section.type !== 'products') continue;
    const { source } = section;
    if (source.kind === 'collection' || source.kind === 'category' || source.kind === 'brand') {
      wanted[source.kind].add(source.id);
    }
  }
  const [collections, categories, brands] = await Promise.all([
    wanted.collection.size
      ? prisma.collection.findMany({
          where: { organizationId, isVisible: true, id: { in: [...wanted.collection] } },
          select: { id: true },
        })
      : [],
    wanted.category.size
      ? prisma.category.findMany({
          where: { organizationId, isVisible: true, id: { in: [...wanted.category] } },
          select: { id: true },
        })
      : [],
    wanted.brand.size
      ? prisma.brand.findMany({ where: { organizationId, id: { in: [...wanted.brand] } }, select: { id: true } })
      : [],
  ]);
  const found = {
    collection: new Set(collections.map((c) => c.id)),
    category: new Set(categories.map((c) => c.id)),
    brand: new Set(brands.map((b) => b.id)),
  };
  for (const section of sections) {
    if (section.type !== 'products') continue;
    const { source } = section;
    if ((source.kind === 'collection' || source.kind === 'category' || source.kind === 'brand') && !found[source.kind].has(source.id)) {
      return `“${section.title}” shows a ${source.kind} that no longer exists or is hidden. Choose another for it.`;
    }
  }
  return null;
}

/** What a new draft starts from: the saved draft, else what's live, else Classic. */
async function currentDesign(organizationId: string): Promise<StorefrontDesignConfig> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      storefrontAccent: true,
      storefrontDarkByDefault: true,
      storefrontDesign: { select: { draft: true, published: true } },
    },
  });
  return (
    parseDesign(org.storefrontDesign?.draft) ??
    parseDesign(org.storefrontDesign?.published) ??
    classicDesign({ accent: org.storefrontAccent, darkByDefault: org.storefrontDarkByDefault })
  );
}

async function writeDraft(organizationId: string, userId: string, design: StorefrontDesignConfig) {
  const now = new Date();
  await prisma.storefrontDesign.upsert({
    where: { organizationId },
    create: { organizationId, draft: design, draftSavedAt: now, draftSavedById: userId },
    update: { draft: design, draftSavedAt: now, draftSavedById: userId },
  });
  return now.toISOString();
}

export async function getDesignEditor(): Promise<ActionResult<DesignEditorData>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);

    const org = await prisma.organization.findUnique({
      where: { id: ctx.organization.id },
      select: {
        storefrontAccent: true,
        storefrontDarkByDefault: true,
        businessType: true,
        storefrontDesign: { select: { draft: true, draftSavedAt: true, published: true, publishedAt: true } },
      },
    });
    if (!org) return { success: false, error: 'We couldn’t load your store’s look' };

    const row = org.storefrontDesign;
    const published = parseDesign(row?.published);
    const draft = parseDesign(row?.draft);
    return {
      success: true,
      data: {
        live: published ?? classicDesign({ accent: org.storefrontAccent, darkByDefault: org.storefrontDarkByDefault }),
        draft,
        draftSavedAt: draft && row?.draftSavedAt ? row.draftSavedAt.toISOString() : null,
        publishedAt: published && row?.publishedAt ? row.publishedAt.toISOString() : null,
        suggestedStartingLook: startingLookFor(org.businessType),
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your store’s look');
  }
}

export async function saveDesignDraft(input: DesignInput): Promise<ActionResult<{ draftSavedAt: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;

    /* The Look tab sends only the look: the front page, header and footer
     * belong to their own tabs, and saving a colour must not undo an
     * arrangement saved there. Whatever isn't sent is kept as saved. */
    const current = await currentDesign(organizationId);
    const checked = validate({
      ...input,
      sections: input.sections === undefined ? current.sections : input.sections,
      header: input.header === undefined ? current.header : input.header,
      footer: input.footer === undefined ? current.footer : input.footer,
      // where the design started is a record, not a choice the Look tab makes
      startingLook: input.startingLook === undefined ? current.startingLook : input.startingLook,
    });
    if (!checked.ok) return { success: false, error: checked.error };
    const problem = await checkReferences(organizationId, checked.design.sections);
    if (problem) return { success: false, error: problem };

    return { success: true, data: { draftSavedAt: await writeDraft(organizationId, ctx.userId, checked.design) } };
  } catch (error) {
    return failure(error, 'We couldn’t save your draft');
  }
}

/**
 * Online store → Customize → Look → Starting looks (15.6): put a starting
 * look into the DRAFT — its look, front page and header — keeping the
 * shop's colour, light/dark and footer. Nothing changes for shoppers until
 * the merchant previews and publishes. A colour that doesn't stand out on
 * the new look's background is set aside (the look's own is used) and the
 * merchant is told which, rather than the whole thing being refused.
 */
export async function applyStartingLookToDraft(
  id: string,
): Promise<ActionResult<{ draftSavedAt: string; colourSetAside: string | null }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;
    if (!(STARTING_LOOK_IDS as readonly string[]).includes(id)) {
      return { success: false, error: 'That starting look doesn’t exist' };
    }

    const next = applyStartingLook(id as StartingLookId, await currentDesign(organizationId));
    let colourSetAside: string | null = null;
    if (next.brandColour) {
      const check = checkBrandColour(next.brandColour, LOOKS[next.look].background, LOOKS[next.look].darkBackground);
      if (!check.ok) {
        colourSetAside = next.brandColour;
        next.brandColour = null;
      }
    }
    const { version: _version, ...input } = next;
    const checked = validate(input);
    if (!checked.ok) return { success: false, error: checked.error };

    const draftSavedAt = await writeDraft(organizationId, ctx.userId, checked.design);
    return { success: true, data: { draftSavedAt, colourSetAside } };
  } catch (error) {
    return failure(error, `We couldn’t start from that look`);
  }
}


/**
 * Online store → Customize → Header & footer (15.5): save the header layout
 * and the footer's columns into the draft, leaving everything else as it is
 * in the draft (or as it's live).
 */
export async function saveChromeDraft(input: {
  header: { layout: string };
  footer: unknown;
}): Promise<ActionResult<{ draftSavedAt: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;

    const { version: _version, ...base } = await currentDesign(organizationId);
    const checked = validate({ ...base, header: input.header, footer: input.footer });
    if (!checked.ok) return { success: false, error: checked.error };

    return { success: true, data: { draftSavedAt: await writeDraft(organizationId, ctx.userId, checked.design) } };
  } catch (error) {
    return failure(error, 'We couldn’t save your header and footer');
  }
}

/**
 * Online store → Customize → Front page (15.3): save the arrangement into
 * the draft, leaving the look as it is in the draft (or as it's live).
 */
export async function saveHomepageDraft(
  sections: HomepageSection[],
): Promise<ActionResult<{ draftSavedAt: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;

    const { version: _version, ...base } = await currentDesign(organizationId);
    const checked = validate({ ...base, sections });
    if (!checked.ok) return { success: false, error: checked.error };
    const problem = await checkReferences(organizationId, checked.design.sections);
    if (problem) return { success: false, error: problem };

    return { success: true, data: { draftSavedAt: await writeDraft(organizationId, ctx.userId, checked.design) } };
  } catch (error) {
    return failure(error, 'We couldn’t save your front page');
  }
}

/**
 * Put the saved draft live. `draftSavedAt` is the draft the merchant is
 * looking at: if it has been saved again since (another tab, a colleague),
 * nothing is published and they are told to reload.
 */
export async function publishDesign(draftSavedAt: string): Promise<ActionResult<{ publishedAt: string }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;

    const seen = new Date(draftSavedAt);
    if (Number.isNaN(seen.getTime())) return { success: false, error: 'Save your draft before publishing it' };

    const row = await prisma.storefrontDesign.findUnique({
      where: { organizationId },
      select: { draft: true, draftSavedAt: true },
    });
    if (!row?.draft || !row.draftSavedAt) return { success: false, error: 'There’s no draft to publish' };

    // Checked again: the rules may be stricter, or content deleted, since the draft was saved.
    const checked = validate(parseDesign(row.draft) ?? row.draft);
    if (!checked.ok) return { success: false, error: checked.error };
    const problem = await checkReferences(organizationId, checked.design.sections);
    if (problem) return { success: false, error: problem };

    const now = new Date();
    /* ONE statement, conditional on the draft being the one the merchant
     * saw. Either the whole design goes live and the draft is cleared, or
     * nothing changes — there is no in-between for a shopper to land on. */
    const { count } = await prisma.storefrontDesign.updateMany({
      where: { organizationId, draftSavedAt: seen },
      data: {
        published: checked.design,
        publishedAt: now,
        publishedById: ctx.userId,
        draft: Prisma.DbNull,
        draftSavedAt: null,
        draftSavedById: null,
      },
    });
    if (count === 0) {
      return {
        success: false,
        error: 'Your draft was changed somewhere else since you opened it. Reload the page to see the latest one.',
      };
    }

    await createAuditLog({
      organizationId,
      userId: ctx.userId,
      action: 'storefront.design.published',
      entityType: 'StorefrontDesign',
      entityId: organizationId,
      metadata: {
        look: checked.design.look,
        brandColour: checked.design.brandColour,
        darkByDefault: checked.design.darkByDefault,
        corners: checked.design.corners,
        fonts: checked.design.fonts,
        cards: checked.design.cards,
        sections: checked.design.sections?.filter((s) => s.enabled).map((s) => s.type) ?? 'classic',
        header: checked.design.header.layout,
        footer: checked.design.footer?.columns.filter((c) => c.enabled).map((c) => c.key) ?? 'classic',
        startingLook: checked.design.startingLook,
      },
    });
    return { success: true, data: { publishedAt: now.toISOString() } };
  } catch (error) {
    return failure(error, 'We couldn’t publish your design');
  }
}

export async function discardDesignDraft(): Promise<ActionResult> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const organizationId = ctx.organization.id;

    const { count } = await prisma.storefrontDesign.updateMany({
      where: { organizationId, NOT: { draftSavedAt: null } },
      data: { draft: Prisma.DbNull, draftSavedAt: null, draftSavedById: null },
    });
    if (count > 0) {
      await createAuditLog({
        organizationId,
        userId: ctx.userId,
        action: 'storefront.design.draft_discarded',
        entityType: 'StorefrontDesign',
        entityId: organizationId,
        metadata: {},
      });
    }
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t discard your draft');
  }
}

/**
 * A link that opens the shop showing the saved draft, to this member only,
 * for an hour (lib/storefront/design/preview.ts). In a new tab it goes to the
 * shop's own address — its custom domain when it has one. For the admin's
 * side-by-side frame (`frame: true`, 15.3) it goes to the PLATFORM address:
 * the only one the frame rules allow, and which a preview isn't redirected
 * away from (proxy.ts).
 */
export async function createDesignPreviewLink({ frame = false }: { frame?: boolean } = {}): Promise<
  ActionResult<{ url: string }>
> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.STOREFRONT_DESIGN);
    const token = createPreviewToken({ organizationId: ctx.organization.id, userId: ctx.userId });
    const base = (frame ? getStorefrontUrl(ctx.organization.slug) : await storefrontUrlFor(ctx.organization.slug)).replace(
      /\/$/,
      '',
    );
    return { success: true, data: { url: `${base}/design-preview?token=${encodeURIComponent(token)}` } };
  } catch (error) {
    return failure(error, 'We couldn’t open a preview');
  }
}
