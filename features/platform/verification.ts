'use server';

/*
 * features/platform/verification.ts
 *
 * The verification queue in the platform console (ROADMAP 11.3, the review
 * half of 10.8). Platform staff read what a merchant submitted in
 * Settings → Payments → Get paid online, open their documents, and approve it
 * or send it back with a reason.
 *
 * Every action here is platform staff only (lib/platform-staff.ts) and acts on
 * an organization named by id — this is the one place an id from the browser
 * is NOT paired with the caller's own organization, because the caller has
 * none: acting across merchants is the point. What stops misuse is the staff
 * check, repeated in every function, and the audit entry each decision leaves
 * on the merchant's own activity log.
 *
 * Approving is OUR verification only. It never means Paystack is set up: the
 * subaccount is created afterwards (10.3), and the merchant's setup page keeps
 * the two apart.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { privateDownloadUrl } from '@/lib/cloudinary/sign';
import { sendPaymentVerificationResultEmail } from '@/lib/email';
import { getAdminUrl } from '@/lib/tenant/urls';
import { provisionSubaccount, syncSubaccount } from '@/lib/payments/subaccounts';
import type { BusinessType, DocumentKind, IdType, SetupStatus, VerificationStatus } from '@/lib/payments/payment-setup';
import type { ProvisionOutcome } from '@/lib/payments/subaccounts';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export type QueueFilter = 'PENDING' | 'REJECTED' | 'VERIFIED' | 'ALL';

export interface QueueRow {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  businessName: string | null;
  businessType: BusinessType | null;
  verificationStatus: VerificationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

export interface QueuePage {
  rows: QueueRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<'PENDING' | 'REJECTED' | 'VERIFIED', number>;
}

export interface VerificationCase {
  organization: { id: string; name: string; slug: string; status: string; createdAt: Date };
  account: {
    businessType: BusinessType | null;
    businessName: string | null;
    cacNumber: string | null;
    registeredName: string | null;
    idType: IdType | null;
    settlementBankName: string | null;
    settlementAccountNumber: string | null;
    settlementAccountName: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    verificationStatus: VerificationStatus;
    setupStatus: SetupStatus;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    rejectionReason: string | null;
    paystackSubaccountCode: string | null;
    paystackIsVerified: boolean | null;
    paystackSyncedAt: Date | null;
    setupError: string | null;
  };
  documents: { id: string; kind: DocumentKind; fileName: string; format: string; bytes: number }[];
  history: { id: string; action: string; at: Date; by: string | null }[];
}

const PAGE_SIZE = 25;

function denied(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PlatformAccessDeniedError') {
    return { success: false, error: 'Only platform staff can do this' };
  }
  console.error(`[platform/verification] ${fallback}:`, error);
  return { success: false, error: fallback };
}

/**
 * The queue. Waiting submissions come oldest first — that merchant has waited
 * longest; decided ones newest first. Search matches the business name, the
 * shop's name or its web address.
 */
export async function listVerificationQueue(params: {
  status?: QueueFilter;
  q?: string;
  page?: number;
}): Promise<ActionResult<QueuePage>> {
  try {
    await requirePlatformStaff();
    const status = params.status ?? 'PENDING';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const q = params.q?.trim().slice(0, 100);

    const where = {
      // A setup nobody has submitted yet isn't ours to review.
      verificationStatus: status === 'ALL' ? { in: ['PENDING', 'REJECTED', 'VERIFIED'] as VerificationStatus[] } : status,
      ...(q
        ? {
            OR: [
              { businessName: { contains: q, mode: 'insensitive' as const } },
              { organization: { name: { contains: q, mode: 'insensitive' as const } } },
              { organization: { slug: { contains: q.toLowerCase() } } },
            ],
          }
        : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.merchantPaymentAccount.findMany({
        where,
        select: {
          organizationId: true,
          businessName: true,
          businessType: true,
          verificationStatus: true,
          submittedAt: true,
          reviewedAt: true,
          organization: { select: { name: true, slug: true } },
        },
        orderBy: status === 'PENDING' ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.merchantPaymentAccount.count({ where }),
      prisma.merchantPaymentAccount.groupBy({
        by: ['verificationStatus'],
        where: { verificationStatus: { in: ['PENDING', 'REJECTED', 'VERIFIED'] } },
        _count: { _all: true },
      }),
    ]);

    const counts = { PENDING: 0, REJECTED: 0, VERIFIED: 0 };
    for (const g of grouped) {
      if (g.verificationStatus in counts) counts[g.verificationStatus as keyof typeof counts] = g._count._all;
    }

    return {
      success: true,
      data: {
        rows: rows.map((r) => ({
          organizationId: r.organizationId,
          organizationName: r.organization.name,
          organizationSlug: r.organization.slug,
          businessName: r.businessName,
          businessType: r.businessType,
          verificationStatus: r.verificationStatus,
          submittedAt: r.submittedAt,
          reviewedAt: r.reviewedAt,
        })),
        total,
        page,
        pageSize: PAGE_SIZE,
        counts,
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load the queue');
  }
}

export async function getVerificationCase(organizationId: string): Promise<ActionResult<VerificationCase | null>> {
  try {
    await requirePlatformStaff();
    const account = await prisma.merchantPaymentAccount.findUnique({
      where: { organizationId },
      include: {
        organization: { select: { id: true, name: true, slug: true, status: true, createdAt: true } },
        documents: {
          select: { id: true, kind: true, fileName: true, format: true, bytes: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!account) return { success: true, data: null };

    const [reviewer, history] = await Promise.all([
      account.reviewedById
        ? prisma.user.findUnique({ where: { id: account.reviewedById }, select: { name: true, email: true } })
        : null,
      prisma.auditLog.findMany({
        where: {
          organizationId,
          OR: [
            { action: { startsWith: 'settings.payment_setup.' } },
            { action: { startsWith: 'platform.verification.' } },
            { action: { startsWith: 'platform.payouts.' } },
          ],
        },
        select: { id: true, action: true, createdAt: true, user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    return {
      success: true,
      data: {
        organization: account.organization,
        account: {
          businessType: account.businessType,
          businessName: account.businessName,
          cacNumber: account.cacNumber,
          registeredName: account.registeredName,
          idType: account.idType,
          settlementBankName: account.settlementBankName,
          settlementAccountNumber: account.settlementAccountNumber,
          settlementAccountName: account.settlementAccountName,
          contactName: account.contactName,
          contactEmail: account.contactEmail,
          contactPhone: account.contactPhone,
          verificationStatus: account.verificationStatus,
          setupStatus: account.setupStatus,
          submittedAt: account.submittedAt,
          reviewedAt: account.reviewedAt,
          reviewedBy: reviewer ? (reviewer.name ?? reviewer.email) : null,
          rejectionReason: account.rejectionReason,
          paystackSubaccountCode: account.paystackSubaccountCode,
          paystackIsVerified: account.paystackIsVerified,
          paystackSyncedAt: account.paystackSyncedAt,
          setupError: account.setupError,
        },
        documents: account.documents,
        history: history.map((h) => ({
          id: h.id,
          action: h.action,
          at: h.createdAt,
          by: h.user ? (h.user.name ?? h.user.email) : null,
        })),
      },
    };
  } catch (error) {
    return denied(error, 'We couldn’t load this business');
  }
}

/** A five-minute link to one of a merchant's documents. */
export async function getCaseDocumentUrl(
  organizationId: string,
  documentId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    await requirePlatformStaff();
    const document = await prisma.merchantVerificationDocument.findFirst({
      where: { id: documentId, organizationId },
      select: { publicId: true, format: true },
    });
    if (!document) return { success: false, error: 'That document isn’t available' };
    return { success: true, data: { url: privateDownloadUrl(document.publicId, document.format) } };
  } catch (error) {
    return denied(error, 'We couldn’t open this document');
  }
}

async function notifyMerchant(
  organizationId: string,
  outcome: 'approved' | 'rejected',
  reason: string | null,
): Promise<void> {
  const account = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: {
      contactEmail: true,
      businessName: true,
      setupStatus: true,
      organization: { select: { name: true, slug: true } },
    },
  });
  if (!account?.contactEmail) return;
  await sendPaymentVerificationResultEmail({
    to: account.contactEmail,
    businessName: account.businessName ?? account.organization.name,
    outcome,
    reason,
    payoutsReady: account.setupStatus === 'ACTIVE',
    setupUrl: getAdminUrl(account.organization.slug, '/settings/payments/online'),
  });
}

/**
 * Approve a waiting submission. Claimed on status, so two staff pressing at
 * once decide it once, and a merchant who took it back meanwhile isn't
 * approved behind their back.
 */
export async function approveVerification(
  organizationId: string,
): Promise<ActionResult<{ payouts: ProvisionOutcome['outcome'] }>> {
  try {
    const staff = await requirePlatformStaff();
    const updated = await prisma.merchantPaymentAccount.updateMany({
      where: { organizationId, verificationStatus: 'PENDING' },
      data: { verificationStatus: 'VERIFIED', reviewedAt: new Date(), reviewedById: staff.userId, rejectionReason: null },
    });
    if (updated.count === 0) {
      return { success: false, error: 'This isn’t waiting for review any more — someone may have decided it already.' };
    }

    await createAuditLog({
      organizationId,
      userId: staff.userId,
      action: 'platform.verification.approved',
      entityType: 'MerchantPaymentAccount',
      entityId: organizationId,
    });

    // Approval stands whatever Paystack says: a subaccount that can't be
    // created yet is left as "needs attention", retryable from this page (10.3).
    const payouts = await provisionSubaccount(organizationId, staff.userId);

    await notifyMerchant(organizationId, 'approved', null);
    return { success: true, data: { payouts: payouts.outcome } };
  } catch (error) {
    return denied(error, 'We couldn’t approve this business');
  }
}

const ReasonSchema = z
  .string()
  .trim()
  .min(10, 'Say what the merchant needs to change, in a sentence or two')
  .max(500, 'Keep the reason under 500 characters');

/** Send a waiting submission back, telling the merchant exactly what to fix. */
export async function rejectVerification(
  organizationId: string,
  reason: string,
): Promise<ActionResult | { success: false; error: string; fieldError: string }> {
  try {
    const staff = await requirePlatformStaff();
    const parsed = ReasonSchema.safeParse(reason);
    if (!parsed.success) {
      return { success: false, error: 'Check the reason', fieldError: parsed.error.issues[0].message };
    }
    const updated = await prisma.merchantPaymentAccount.updateMany({
      where: { organizationId, verificationStatus: 'PENDING' },
      data: {
        verificationStatus: 'REJECTED',
        setupStatus: 'NOT_STARTED',
        reviewedAt: new Date(),
        reviewedById: staff.userId,
        rejectionReason: parsed.data,
      },
    });
    if (updated.count === 0) {
      return { success: false, error: 'This isn’t waiting for review any more — someone may have decided it already.' };
    }

    await createAuditLog({
      organizationId,
      userId: staff.userId,
      action: 'platform.verification.rejected',
      entityType: 'MerchantPaymentAccount',
      entityId: organizationId,
      metadata: { reason: parsed.data },
    });
    await notifyMerchant(organizationId, 'rejected', parsed.data);
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t send this back');
  }
}

/**
 * Try again to give an approved business its subaccount — after Paystack
 * refused it or couldn't be reached. Looks for one an earlier attempt may have
 * created before making another (lib/payments/subaccounts.ts).
 */
export async function retrySubaccount(organizationId: string): Promise<ActionResult<{ outcome: ProvisionOutcome['outcome'] }>> {
  try {
    const staff = await requirePlatformStaff();
    const result = await provisionSubaccount(organizationId, staff.userId);
    if (result.outcome === 'not-eligible') return { success: false, error: 'Only an approved business gets payouts' };
    if (result.outcome === 'busy') return { success: false, error: 'Payouts are already being set up for this business' };
    if (result.outcome === 'failed') return { success: false, error: result.error };
    return { success: true, data: { outcome: result.outcome } };
  } catch (error) {
    return denied(error, 'We couldn’t set up payouts');
  }
}

/** Re-read the subaccount from Paystack now, rather than waiting for our copy to go stale. */
export async function checkSubaccount(organizationId: string): Promise<ActionResult> {
  try {
    await requirePlatformStaff();
    await syncSubaccount(organizationId, { force: true });
    return { success: true, data: undefined };
  } catch (error) {
    return denied(error, 'We couldn’t check with Paystack');
  }
}
