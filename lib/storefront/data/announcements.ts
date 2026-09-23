/*
 * lib/storefront/data/announcements.ts
 *
 * The campaign announcements a shopper should see right now.
 *
 * Live campaigns only — the same window rule the prices use, so a bar can
 * never outlast the sale it is announcing. Nothing here is generated: a
 * campaign whose merchant wrote no words returns nothing at all.
 *
 * Server only.
 */
import { prisma } from '@/lib/prisma';
import { resolveAnnouncement, type Announcement } from '@/lib/marketing/announcement';

export async function loadLiveAnnouncements(
  /** the tenant, as the catalogue carries it */
  organizationSlug: string,
  now: Date = new Date(),
): Promise<Announcement[]> {
  if (!organizationSlug) return [];

  const campaigns = await prisma.campaign.findMany({
    where: {
      /* Scoped through the store, so an announcement can only ever belong
       * to the shop whose domain was asked for. */
      organization: { slug: organizationSlug, status: 'ACTIVE' },
      status: 'SCHEDULED',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      announcementStyle: { not: 'NONE' },
    },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      announcementStyle: true,
      announcementText: true,
      announcementDetail: true,
      announcementCta: true,
      announcementHref: true,
      announcementImageUrl: true,
      announcementBg: true,
      announcementFg: true,
      announcementScroll: true,
    },
  });

  return campaigns
    .map((campaign) =>
      resolveAnnouncement(campaign.id, {
        style: campaign.announcementStyle,
        text: campaign.announcementText,
        detail: campaign.announcementDetail,
        cta: campaign.announcementCta,
        href: campaign.announcementHref,
        image: campaign.announcementImageUrl,
        background: campaign.announcementBg,
        foreground: campaign.announcementFg,
        scroll: campaign.announcementScroll,
      }),
    )
    .filter((a): a is Announcement => a !== null);
}
