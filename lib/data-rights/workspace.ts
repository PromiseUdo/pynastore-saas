/*
 * lib/data-rights/workspace.ts
 *
 * Closing a workspace, and what happens after (ROADMAP 13.8). This is what
 * Organization.status = DELETED means, and where it's carried out:
 *
 *  Day 0 — closeWorkspace (the Owner, Settings → General):
 *    the admin and the storefront go offline (proxy.ts sends both away), the
 *    subscription is cancelled at Paystack, a custom domain stops, social
 *    accounts are disconnected and their tokens destroyed, and the Owners are
 *    emailed what happens next. Nothing else is deleted yet.
 *
 *  Days 0–30 — restoreClosedWorkspace (platform staff, on request):
 *    everything comes back as it was, except the plan (re-subscribe) and the
 *    social accounts (reconnect).
 *
 *  Day 30 — purgeClosedWorkspace (the daily retention job):
 *    deleted: every uploaded file (product photos, logos, verification
 *    documents), the storefront's pages and slides, social posts, staff
 *    access and invitations, payout and verification records, and every
 *    shopper's account data — sign-in, addresses, wishlists, reviews,
 *    questions, notes, marketing consent, contact details; customers with
 *    no orders, invoices or quotes are deleted outright.
 *    kept: the business records the law requires — orders, invoices, quotes,
 *    payments, refunds, returns, purchase orders and stock history — with
 *    the products, stores and customer names they refer to.
 *
 *  Year 6 — eraseOrganization (./erase.ts, the same job): everything left is
 *    erased, down to the organization itself.
 */
import { ownerEmails } from '@/lib/org-owners';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { disableSubscription } from '@/lib/billing/paystack';
import { destroyOrganizationAssets } from '@/lib/cloudinary/sign';
import { takeDomainOffline } from '@/lib/domains/shop-domain';
import { disconnectConnection } from '@/lib/social/service';
import { forgetOrgStatus } from '@/lib/tenant/org-status';
import { sendPlatformNoticeEmail } from '@/lib/email';
import { formatDate } from '@/lib/format';
import { PLATFORM_NAME } from '@/lib/brand';
import { platformSupportEmail } from '@/lib/platform-contact';
import { reportCaughtError } from '@/lib/ops/errors';
import { CLOSURE_GRACE_DAYS, FINANCIAL_RETENTION_YEARS, erasedAt, restorableUntil } from './policy';

export class WorkspaceClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceClosureError';
  }
}


/**
 * Close a workspace. `confirmName` must match its name exactly — the check the
 * dialog makes, repeated here. Returns when it can be restored until.
 */
export async function closeWorkspace(input: {
  organizationId: string;
  userId: string;
  confirmName: string;
  reason?: string | null;
}): Promise<{ restorableUntil: Date }> {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true, status: true, subscription: true },
  });
  if (!org || org.status === 'DELETED') throw new WorkspaceClosureError('This workspace is already closed.');
  if (input.confirmName.trim() !== org.name.trim()) {
    throw new WorkspaceClosureError('Type the workspace’s name exactly as it’s shown to confirm.');
  }

  // Email the Owners before memberships stop mattering.
  const owners = await ownerEmails(org.id);
  const closedAt = new Date();

  // Stop the money first: a shop that's gone must not be charged again.
  const sub = org.subscription;
  if (sub?.paystackSubscriptionCode && sub.paystackEmailToken && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
    try {
      await disableSubscription(sub.paystackSubscriptionCode, sub.paystackEmailToken);
    } catch (error) {
      // Recorded and alerted: staff must cancel it by hand in Paystack.
      await reportCaughtError(error, 'workspace-close:disable-subscription', { message: `Couldn’t cancel ${org.name}’s Paystack subscription on closing: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: org.id },
      data: {
        status: 'DELETED',
        closedAt,
        closedById: input.userId,
        closureReason: input.reason?.trim().slice(0, 500) || null,
        storefrontOpen: false,
      },
    });
    if (sub) await tx.subscription.update({ where: { organizationId: org.id }, data: { cancelAtPeriodEnd: true } });
    const domain = await tx.shopDomain.findUnique({ where: { organizationId: org.id }, select: { status: true } });
    if (domain && !['DISCONNECTED', 'EXPIRED', 'FAILED'].includes(domain.status)) {
      await takeDomainOffline(tx, org.id, 'DISCONNECTED');
    }
  });
  forgetOrgStatus(org.slug);

  // Social tokens are keys to someone's Facebook Page: destroyed now, not in 30 days.
  const connections = await prisma.socialConnection.findMany({
    where: { organizationId: org.id, parentConnectionId: null, status: { not: 'DISCONNECTED' } },
    select: { id: true },
  });
  for (const c of connections) await disconnectConnection(org.id, c.id);

  await createAuditLog({
    organizationId: org.id,
    userId: input.userId,
    action: 'settings.organization.closed',
    entityType: 'Organization',
    entityId: org.id,
    metadata: { reason: input.reason ?? null },
  });

  const until = restorableUntil(closedAt);
  const support = platformSupportEmail();
  await sendPlatformNoticeEmail({
    to: owners,
    subject: `${org.name} is closed`,
    preview: `Your workspace is closed. It can be restored until ${formatDate(until)}.`,
    heading: `${org.name} is closed`,
    paragraphs: [
      'Your dashboard and your online store are offline, and your plan won’t renew.',
      `Changed your mind? ${support ? `Write to ${support}` : 'Contact us'} before ${formatDate(until)} and we can restore everything as it was — you’d reconnect social accounts and choose a plan again.`,
      `After ${formatDate(until)}, your photos and files, store pages, staff access and your customers’ account details are deleted for good.`,
      `Your orders, invoices and payment records are kept for ${FINANCIAL_RETENTION_YEARS} years, because the law requires business records to be, and then erased — on ${formatDate(erasedAt(closedAt))}.`,
    ],
    footer: `Sent by ${PLATFORM_NAME} to the owners of ${org.name}.`,
  });

  return { restorableUntil: until };
}

/** Staff: undo a closing within the grace period. */
export async function restoreClosedWorkspace(organizationId: string, staffUserId: string, now: Date = new Date()): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, slug: true, status: true, closedAt: true, closedDataPurgedAt: true },
  });
  if (!org || org.status !== 'DELETED' || !org.closedAt) throw new WorkspaceClosureError('This workspace isn’t closed.');
  if (org.closedDataPurgedAt || now >= restorableUntil(org.closedAt)) {
    throw new WorkspaceClosureError(`It was closed more than ${CLOSURE_GRACE_DAYS} days ago, and its data has been deleted.`);
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: { status: 'ACTIVE', closedAt: null, closedById: null, closureReason: null },
  });
  forgetOrgStatus(org.slug);
  await createAuditLog({
    organizationId,
    userId: staffUserId,
    action: 'platform.organization.reopened',
    entityType: 'Organization',
    entityId: organizationId,
  });
}

/**
 * Day 30: delete everything but the business records the law requires. Safe
 * to run again: each step deletes what's left. Files first — if Cloudinary
 * refuses, nothing is marked done and tomorrow's run tries again.
 */
export async function purgeClosedWorkspace(organizationId: string, now: Date = new Date()): Promise<{ purged: boolean; files: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true, closedAt: true, closedDataPurgedAt: true },
  });
  if (!org || org.status !== 'DELETED' || !org.closedAt || org.closedDataPurgedAt) return { purged: false, files: 0 };
  if (now < restorableUntil(org.closedAt)) return { purged: false, files: 0 };

  const files = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ? await destroyOrganizationAssets(organizationId) : 0;

  await prisma.$transaction(
    async (tx) => {
      const where = { organizationId };
      // Store content and the platform relationship.
      await tx.socialPost.deleteMany({ where });
      await tx.socialConnectionDraft.deleteMany({ where });
      await tx.socialConnection.deleteMany({ where: { ...where, parentConnectionId: { not: null } } });
      await tx.socialConnection.deleteMany({ where });
      await tx.storePage.deleteMany({ where });
      await tx.storefrontHeroSlide.deleteMany({ where });
      await tx.storefrontDesign.deleteMany({ where });
      await tx.productImage.deleteMany({ where }); // embeddings cascade
      await tx.visualSearchQuery.deleteMany({ where });
      await tx.onboardingEmail.deleteMany({ where });
      await tx.pushDevice.deleteMany({ where }); // order notifications cascade (16.4)
      await tx.mobileApp.deleteMany({ where }); // the sealed APNs key goes with it
      await tx.merchantPaymentAccount.deleteMany({ where }); // verification documents cascade
      await tx.merchantVerificationDocument.deleteMany({ where });
      await tx.merchantBankAccount.deleteMany({ where });
      await tx.invitation.deleteMany({ where });
      await tx.membership.deleteMany({ where }); // store access cascades

      // Every shopper's account, as if each had deleted it themselves.
      const customer = { customer: { organizationId } };
      await tx.customerOAuthAccount.deleteMany({ where });
      await tx.customerPasswordResetToken.deleteMany({ where: customer });
      await tx.customerEmailChange.deleteMany({ where: customer });
      await tx.customerAddress.deleteMany({ where: customer });
      await tx.customerWishlistItem.deleteMany({ where: customer });
      await tx.productReviewVote.deleteMany({ where: customer });
      await tx.productReview.deleteMany({ where });
      await tx.productQuestion.deleteMany({ where });
      await tx.customer.deleteMany({
        where: { organizationId, orders: { none: {} }, invoices: { none: {} }, quotes: { none: {} }, dropShipPurchaseOrders: { none: {} }, mergedFrom: { none: {} } },
      });
      await tx.customer.updateMany({
        where,
        data: {
          email: null,
          phone: null,
          address: null,
          notes: null,
          tags: [],
          passwordHash: null,
          emailVerifiedAt: null,
          marketingConsent: false,
          accountDeletedAt: now,
        },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { closedDataPurgedAt: now, logoUrl: null, logoPublicId: null, closureReason: null },
      });
    },
    { timeout: 120_000 },
  );
  return { purged: true, files };
}
