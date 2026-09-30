/*
 * lib/payments/subaccounts.ts
 *
 * A merchant's Paystack subaccount (ROADMAP 10.3). Server only. This is the
 * ONLY place a subaccount is created, and it is created exactly once:
 *
 *   - only for a business we have VERIFIED (10.8) — the function refuses
 *     anything else, whoever calls it;
 *   - the record is CLAIMED (setupStatus → CREATING, conditionally) before
 *     Paystack is called, so two approvals racing each other create one;
 *   - Paystack itself does not refuse a second subaccount for the same bank
 *     account (checked in test mode, 10.13), so a RETRY first looks for a
 *     subaccount an earlier, timed-out request may have created — matched on
 *     the organization id we put in its metadata — and adopts it instead;
 *   - the code is unique in our table, so a second one can't be recorded.
 *
 * Paystack sends no subaccount webhooks, so its state is re-read here
 * (`syncSubaccount`) when our copy is stale — on the merchant's payment pages
 * and from the platform console — and a subaccount Paystack has deactivated
 * turns online payments off (setupStatus DISABLED).
 *
 * The merchant never supplies a key; every call uses the platform's.
 */
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  PaystackError,
  createSubaccount,
  fetchSubaccount,
  findSubaccountsByMetadata,
  isPaystackConfigured,
  type PaystackSubaccount,
} from './paystack';

/** A claim older than this is a request that died; it may be taken over. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** How long our copy of Paystack's subaccount state is trusted. */
const SYNC_TTL_MS = 10 * 60 * 1000;

export type ProvisionOutcome =
  | { outcome: 'created' | 'adopted' | 'already-set-up'; code: string }
  | { outcome: 'not-eligible' | 'busy' }
  | { outcome: 'failed'; error: string };

/** Written on the subaccount; what lets a lost one be found again. */
function metadataFor(organizationId: string) {
  return { organizationId, platform: 'mansaas' };
}

function describeFailure(error: unknown): { message: string; uncertain: boolean } {
  if (error instanceof PaystackError && error.httpStatus >= 400 && error.httpStatus < 500) {
    return { message: `Paystack refused the subaccount: ${error.message}`, uncertain: false };
  }
  // A timeout or a 5xx: Paystack may have created it anyway. The next attempt
  // looks before it creates.
  return {
    message: 'Paystack couldn’t be reached, so we don’t know whether the subaccount was created. Retrying checks first.',
    uncertain: true,
  };
}

async function recordResult(
  organizationId: string,
  sub: PaystackSubaccount,
): Promise<void> {
  await prisma.merchantPaymentAccount.update({
    where: { organizationId },
    data: {
      paystackSubaccountCode: sub.code,
      setupStatus: sub.active ? 'ACTIVE' : 'DISABLED',
      setupError: sub.active ? null : 'Paystack has this subaccount switched off.',
      paystackIsVerified: sub.isVerified,
      paystackSyncedAt: new Date(),
    },
  });
}

/**
 * Give a verified business its subaccount. Safe to call any number of times:
 * it does nothing for a business that isn't verified, returns the existing
 * one for a business that has it, and never creates a second.
 */
export async function provisionSubaccount(
  organizationId: string,
  actorUserId: string | null,
): Promise<ProvisionOutcome> {
  const account = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: {
      verificationStatus: true,
      setupStatus: true,
      paystackSubaccountCode: true,
      businessName: true,
      settlementBankCode: true,
      settlementAccountNumber: true,
      settlementAccountName: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      organization: { select: { name: true, slug: true } },
    },
  });
  if (!account || account.verificationStatus !== 'VERIFIED') return { outcome: 'not-eligible' };
  if (account.paystackSubaccountCode) {
    return { outcome: 'already-set-up', code: account.paystackSubaccountCode };
  }
  if (!isPaystackConfigured()) {
    await prisma.merchantPaymentAccount.update({
      where: { organizationId },
      data: { setupStatus: 'ACTION_REQUIRED', setupError: 'PAYSTACK_SECRET_KEY is not configured on the server.' },
    });
    return { outcome: 'failed', error: 'Paystack isn’t configured on the server' };
  }

  // A retry — after a failure, or taking over a claim that died — may follow
  // a request that created the subaccount without us hearing back.
  const retrying = account.setupStatus === 'ACTION_REQUIRED' || account.setupStatus === 'CREATING';

  const claimed = await prisma.merchantPaymentAccount.updateMany({
    where: {
      organizationId,
      verificationStatus: 'VERIFIED',
      paystackSubaccountCode: null,
      OR: [
        { setupStatus: { in: ['NOT_STARTED', 'AWAITING_VERIFICATION', 'ACTION_REQUIRED'] } },
        { setupStatus: 'CREATING', updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      ],
    },
    data: { setupStatus: 'CREATING', setupError: null },
  });
  if (claimed.count === 0) return { outcome: 'busy' };

  if (!account.businessName || !account.settlementBankCode || !account.settlementAccountNumber || !account.settlementAccountName) {
    const error = 'The business name or settlement account is missing, so there is nothing to give Paystack.';
    await prisma.merchantPaymentAccount.update({
      where: { organizationId },
      data: { setupStatus: 'ACTION_REQUIRED', setupError: error },
    });
    return { outcome: 'failed', error };
  }

  try {
    if (retrying) {
      const existing = await findSubaccountsByMetadata('organizationId', organizationId);
      const adopt = existing.find((s) => s.active) ?? existing[0];
      if (adopt) {
        await recordResult(organizationId, adopt);
        await createAuditLog({
          organizationId,
          userId: actorUserId,
          action: 'platform.payouts.subaccount_adopted',
          entityType: 'MerchantPaymentAccount',
          entityId: organizationId,
          metadata: { code: adopt.code, found: existing.length },
        });
        return { outcome: 'adopted', code: adopt.code };
      }
    }

    const created = await createSubaccount({
      businessName: account.businessName,
      bankCode: account.settlementBankCode,
      accountNumber: account.settlementAccountNumber,
      contactName: account.contactName,
      contactEmail: account.contactEmail,
      contactPhone: account.contactPhone,
      description: `${account.organization.name} (${account.organization.slug})`,
      metadata: metadataFor(organizationId),
    });
    await recordResult(organizationId, created);
    await createAuditLog({
      organizationId,
      userId: actorUserId,
      action: 'platform.payouts.subaccount_created',
      entityType: 'MerchantPaymentAccount',
      entityId: organizationId,
      metadata: { code: created.code, active: created.active },
    });
    return { outcome: 'created', code: created.code };
  } catch (error) {
    const { message, uncertain } = describeFailure(error);
    console.error(`[subaccounts] provisioning failed for ${organizationId}:`, error);
    await prisma.merchantPaymentAccount.updateMany({
      where: { organizationId, setupStatus: 'CREATING' },
      data: { setupStatus: 'ACTION_REQUIRED', setupError: message },
    });
    await createAuditLog({
      organizationId,
      userId: actorUserId,
      action: 'platform.payouts.subaccount_failed',
      entityType: 'MerchantPaymentAccount',
      entityId: organizationId,
      metadata: { uncertain, message },
    });
    return { outcome: 'failed', error: message };
  }
}

/**
 * Re-read the subaccount from Paystack and bring our copy in line — ACTIVE if
 * Paystack has it switched on, DISABLED if it's switched off or gone. Skipped
 * while our copy is fresh unless `force`. Never throws: an unreachable
 * Paystack leaves the last known state as it was.
 */
export async function syncSubaccount(organizationId: string, { force = false }: { force?: boolean } = {}): Promise<void> {
  const account = await prisma.merchantPaymentAccount.findUnique({
    where: { organizationId },
    select: { paystackSubaccountCode: true, paystackSyncedAt: true, setupStatus: true },
  });
  const code = account?.paystackSubaccountCode;
  if (!code || !isPaystackConfigured()) return;
  if (!force && account.paystackSyncedAt && Date.now() - account.paystackSyncedAt.getTime() < SYNC_TTL_MS) return;

  try {
    const sub = await fetchSubaccount(code);
    const now = new Date();
    if (!sub) {
      await prisma.merchantPaymentAccount.update({
        where: { organizationId },
        data: { setupStatus: 'DISABLED', setupError: 'Paystack no longer knows this subaccount.', paystackSyncedAt: now },
      });
      return;
    }
    await prisma.merchantPaymentAccount.update({
      where: { organizationId },
      data: {
        setupStatus: sub.active ? 'ACTIVE' : 'DISABLED',
        setupError: sub.active ? null : 'Paystack has this subaccount switched off.',
        paystackIsVerified: sub.isVerified,
        paystackSyncedAt: now,
      },
    });
  } catch (error) {
    console.error(`[subaccounts] could not check ${code} with Paystack:`, error);
  }
}
