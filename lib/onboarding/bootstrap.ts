import { prisma as db } from '@/lib/prisma';
import { PERMISSIONS, SYSTEM_ROLES, isBuiltPermission } from '@/lib/permissions';
import { isReservedSlug } from '@/lib/tenant/reserved-slugs';
import { startWorkspaceSubscription } from '@/lib/billing/trial';
import { getBillingSettings } from '@/lib/settings';
import { toShopAddress } from './shop-address';
import type { BusinessType, SalesChannels } from './business';
import { applyStartingLook, startingLookFor } from '@/lib/storefront/design/starting-looks';
import { classicDesign } from '@/lib/storefront/design/schema';

/** The shop's first store, created with it (ROADMAP 12.5) — a place is required. */
export interface FirstStore {
  name: string;
  state: string;
  city: string;
}

/**
 * Creates a workspace and everything it starts with, all or nothing: the
 * organization (NOT open yet — 12.5), its system roles, the Owner membership,
 * the first store with its place, the starter categories the merchant
 * ticked, and the subscription (a trial, or none for a repeat owner — 12.1).
 */
export async function bootstrapOrganization({
  name,
  slug,
  ownerUserId,
  firstStore,
  businessType,
  salesChannels,
  categories = [],
}: {
  name: string;
  slug: string;
  ownerUserId: string;
  firstStore?: FirstStore;
  businessType?: BusinessType;
  salesChannels?: SalesChannels;
  /** starter categories the merchant accepted */
  categories?: string[];
}) {
  // Last line of defence: both callers check this and show a friendly
  // message, but no org may ever be created on a reserved hostname.
  if (isReservedSlug(slug)) {
    throw new Error(`Reserved organization slug: ${slug}`);
  }

  const billingSettings = await getBillingSettings();

  return db.$transaction(async (tx) => {
    // 1. Create organization
    const org = await tx.organization.create({
      data: {
        name,
        slug,
        // A new shop opens when the merchant opens it, from the setup guide.
        storefrontOpen: false,
        businessType: businessType ?? null,
        salesChannels: salesChannels ?? null,
      },
    });

    /* 1b. The starting look for what they sell (ROADMAP 15.6), already
     * published: the shop isn't open yet, so nobody sees it until the
     * merchant opens it — and when they do, it suits them. "General" is the
     * Classic look, which is what no design means, so nothing is written. */
    const startingLook = startingLookFor(businessType);
    if (startingLook !== 'general') {
      await tx.storefrontDesign.create({
        data: {
          organizationId: org.id,
          published: applyStartingLook(startingLook, classicDesign({ accent: null, darkByDefault: false })),
          publishedAt: new Date(),
        },
      });
    }

    // 2. Create all system roles for this org
    const createdRoles: Record<string, string> = {}; // roleName -> roleId

    for (const [, roleConfig] of Object.entries(SYSTEM_ROLES)) {
      // Fetch permission IDs for this role's keys
      const permissions = await tx.permission.findMany({
        // Only permissions for features that exist (ROADMAP 12.4).
        where: { key: { in: (roleConfig.permissions as readonly string[]).filter(isBuiltPermission) } },
        select: { id: true },
      });

      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          name: roleConfig.name,
          isSystem: roleConfig.isSystem,
          rolePermissions: {
            create: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      });

      createdRoles[roleConfig.name] = role.id;
    }

    // 3. Create Owner membership for the user who created the org
    const ownerRoleId = createdRoles['Owner'];
    const membership = await tx.membership.create({
      data: {
        userId: ownerUserId,
        organizationId: org.id,
        roleId: ownerRoleId,
        status: 'ACTIVE',
      },
    });

    // 4. Its subscription: a free trial, or — for an owner who already had
    //    one — straight to choosing a plan (ROADMAP 12.1).
    const start = await startWorkspaceSubscription(tx, {
      organizationId: org.id,
      ownerUserId,
      settings: billingSettings,
    });

    // 5. The first store, with its place, so the merchant never meets
    //    "create a store first". It doesn't sell online yet — that's a step
    //    in the setup guide, taken once delivery is set up.
    const store = firstStore
      ? await tx.warehouse.create({
          data: { organizationId: org.id, name: firstStore.name, state: firstStore.state, city: firstStore.city },
          select: { id: true, name: true },
        })
      : null;

    // 6. Starter categories — only the ones the merchant ticked.
    if (categories.length) {
      await tx.category.createMany({
        data: categories.map((c, i) => ({ organizationId: org.id, name: c, slug: toShopAddress(c) || `category-${i + 1}`, sortOrder: i })),
        skipDuplicates: true,
      });
    }

    return { organization: org, membership, start, store };
  },
  // One role per system role plus its permissions, the owner and the
  // subscription: a dozen round trips, which against a remote database can
  // outrun Prisma's 5-second default.
  { timeout: 20_000, maxWait: 10_000 });
}
