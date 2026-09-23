'use server';

/*
 * features/marketing/campaign-reads.ts
 *
 * Reading campaigns, and what they did.
 *
 * PERFORMANCE IS COMPUTED, NOT STORED. An order counts towards a campaign
 * when it was placed inside the window AND contains a product the campaign
 * priced. That is exactly what "this sale sold these things" means, and it
 * stays true if a campaign is re-priced or ended early — a `campaignId`
 * stamped on a line at checkout would not.
 *
 * `discountGiven` is the difference between what those units sold for and
 * what they would have cost at the snapshotted original price. It is the
 * real cost of the sale, which is the number a merchant actually wants and
 * the one nothing else in the app could tell them.
 */
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { campaignPhase, type CampaignPhase } from '@/lib/marketing/campaign-rules';
import type { ActionResult } from '@/features/sales/shared';

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  phase: CampaignPhase;
  mechanic: string;
  value: number;
  startsAt: string;
  endsAt: string | null;
  targetKind: string;
  productCount: number;
  codeCount: number;
}

export interface CampaignPerformance {
  orders: number;
  revenue: number;
  unitsSold: number;
  discountGiven: number;
  codeRedemptions: number;
}

export interface CampaignDetail extends CampaignRow {
  targetIds: string[];
  prices: {
    inventoryItemId: string;
    name: string;
    sku: string;
    originalPrice: number;
    price: number;
  }[];
  discountCodes: { id: string; code: string; label: string; usageCount: number }[];
  socialPosts: { id: string; status: string; platform: string; publishedAt: string | null }[];
  /** null until it has started — there is nothing to measure before then */
  performance: CampaignPerformance | null;
  /** the collection made from this campaign, if the merchant asked for one */
  collection: { id: string; name: string; slug: string; productCount: number } | null;
  /** what customers are told, in the merchant's words */
  announcement: {
    style: string;
    text: string | null;
    detail: string | null;
    cta: string | null;
    href: string | null;
    imageUrl: string | null;
    imagePublicId: string | null;
    background: string | null;
    foreground: string | null;
    scroll: boolean;
  };
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to view campaigns' };
  }
  console.error(`[campaigns] ${fallback}:`, error);
  return { success: false, error: fallback };
}

export async function listCampaigns(): Promise<ActionResult<CampaignRow[]>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);

    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ startsAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        mechanic: true,
        value: true,
        startsAt: true,
        endsAt: true,
        targetKind: true,
        _count: { select: { prices: true, discountCodes: true } },
      },
    });

    const now = new Date();
    return {
      success: true,
      data: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        phase: campaignPhase({ status: c.status, startsAt: c.startsAt, endsAt: c.endsAt }, now),
        mechanic: c.mechanic,
        value: Number(c.value),
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt?.toISOString() ?? null,
        targetKind: c.targetKind,
        productCount: c._count.prices,
        codeCount: c._count.discountCodes,
      })),
    };
  } catch (error) {
    return failure(error, 'We couldn’t load your campaigns');
  }
}

export async function getCampaign(campaignId: string): Promise<ActionResult<CampaignDetail>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        mechanic: true,
        value: true,
        startsAt: true,
        endsAt: true,
        targetKind: true,
        targetIds: true,
        prices: {
          select: {
            inventoryItemId: true,
            originalPrice: true,
            price: true,
            inventoryItem: { select: { name: true, sku: true, parentItem: { select: { name: true } } } },
          },
        },
        collection: { select: { id: true, name: true, slug: true, _count: { select: { items: true } } } },
        announcementStyle: true,
        announcementText: true,
        announcementDetail: true,
        announcementCta: true,
        announcementHref: true,
        announcementImageUrl: true,
        announcementImagePublicId: true,
        announcementBg: true,
        announcementFg: true,
        announcementScroll: true,
        discountCodes: { select: { id: true, code: true, label: true, usageCount: true } },
        socialPosts: { select: { id: true, status: true, platform: true, publishedAt: true } },
      },
    });
    if (!campaign) return { success: false, error: 'Campaign not found' };

    const now = new Date();
    const phase = campaignPhase(
      { status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt },
      now,
    );

    const started = phase === 'ACTIVE' || phase === 'ENDED';
    const performance = started
      ? await measure(
          organizationId,
          campaign.startsAt,
          campaign.endsAt ?? now,
          campaign.prices.map((p) => ({
            id: p.inventoryItemId,
            originalPrice: Number(p.originalPrice),
          })),
          campaign.discountCodes.reduce((sum, code) => sum + code.usageCount, 0),
        )
      : null;

    return {
      success: true,
      data: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        phase,
        mechanic: campaign.mechanic,
        value: Number(campaign.value),
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt?.toISOString() ?? null,
        targetKind: campaign.targetKind,
        targetIds: campaign.targetIds,
        productCount: campaign.prices.length,
        codeCount: campaign.discountCodes.length,
        prices: campaign.prices.map((p) => ({
          inventoryItemId: p.inventoryItemId,
          name: p.inventoryItem.parentItem
            ? `${p.inventoryItem.parentItem.name} · ${p.inventoryItem.name}`
            : p.inventoryItem.name,
          sku: p.inventoryItem.sku,
          originalPrice: Number(p.originalPrice),
          price: Number(p.price),
        })),
        discountCodes: campaign.discountCodes,
        socialPosts: campaign.socialPosts.map((post) => ({
          id: post.id,
          status: post.status,
          platform: post.platform,
          publishedAt: post.publishedAt?.toISOString() ?? null,
        })),
        performance,
        collection: campaign.collection
          ? {
              id: campaign.collection.id,
              name: campaign.collection.name,
              slug: campaign.collection.slug,
              productCount: campaign.collection._count.items,
            }
          : null,
        announcement: {
          style: campaign.announcementStyle,
          text: campaign.announcementText,
          detail: campaign.announcementDetail,
          cta: campaign.announcementCta,
          href: campaign.announcementHref,
          imageUrl: campaign.announcementImageUrl,
          imagePublicId: campaign.announcementImagePublicId,
          background: campaign.announcementBg,
          foreground: campaign.announcementFg,
          scroll: campaign.announcementScroll,
        },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t load that campaign');
  }
}

/** What the campaign's products sold while it was on. */
async function measure(
  organizationId: string,
  from: Date,
  to: Date,
  priced: { id: string; originalPrice: number }[],
  codeRedemptions: number,
): Promise<CampaignPerformance> {
  if (priced.length === 0) {
    return { orders: 0, revenue: 0, unitsSold: 0, discountGiven: 0, codeRedemptions };
  }

  const ids = priced.map((p) => p.id);
  const originalById = new Map(priced.map((p) => [p.id, p.originalPrice]));

  const lines = await prisma.orderLineItem.findMany({
    where: {
      order: {
        organizationId,
        placedAt: { gte: from, lte: to },
        // A cancelled order sold nothing, here as everywhere else.
        status: { not: 'CANCELLED' },
      },
      OR: [{ variantId: { in: ids } }, { AND: [{ variantId: null }, { productId: { in: ids } }] }],
    },
    select: { orderId: true, variantId: true, productId: true, quantity: true, totalPrice: true, unitPrice: true },
  });

  const orders = new Set<string>();
  let revenue = 0;
  let unitsSold = 0;
  let discountGiven = 0;

  for (const line of lines) {
    const itemId = line.variantId ?? line.productId;
    const original = itemId ? originalById.get(itemId) : undefined;
    if (original === undefined) continue;

    orders.add(line.orderId);
    revenue += Number(line.totalPrice);
    unitsSold += line.quantity;
    /* What the sale cost: the gap between the old price and what was
     * actually charged. Never negative — a line sold ABOVE its old price
     * (a counter override, say) did not cost the campaign anything. */
    discountGiven += Math.max(0, (original - Number(line.unitPrice)) * line.quantity);
  }

  return {
    orders: orders.size,
    revenue,
    unitsSold,
    discountGiven,
    codeRedemptions,
  };
}
