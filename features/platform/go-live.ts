'use server';

/*
 * features/platform/go-live.ts
 *
 * The go-live checklist (ROADMAP 13.9), for platform staff: what this
 * server's settings say, and moving merchants' payout accounts to the
 * current Paystack mode once the live key is in.
 */
import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/platform-staff';
import { goLiveChecks, MANUAL_STEPS, type GoLiveCheck } from '@/lib/ops/go-live';
import { metaRedirectUri } from '@/lib/social/config';
import { LAST_WEBHOOK_KEY } from '@/lib/payments/paystack-webhook';
import { paystackConfigProblem, paystackKeyMode } from '@/lib/payments/paystack';
import { provisionSubaccount } from '@/lib/payments/subaccounts';

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

export interface GoLivePage {
  checks: GoLiveCheck[];
  manual: typeof MANUAL_STEPS;
  payoutsToMove: number;
  keyMode: 'live' | 'test' | null;
  webhookUrl: string;
}

/**
 * Approved businesses without a payout subaccount that works with the current
 * key: none at all, or one from the other mode. A code recorded before modes
 * were tracked counts as test (lib/payments/subaccounts.ts).
 */
function payoutsToMoveWhere() {
  const otherMode =
    paystackKeyMode() === 'live'
      ? [{ paystackSubaccountMode: null }, { paystackSubaccountMode: { not: 'live' } }]
      : [{ paystackSubaccountMode: { not: 'test' } }];
  return {
    verificationStatus: 'VERIFIED' as const,
    organization: { status: 'ACTIVE' as const },
    OR: [{ paystackSubaccountCode: null }, ...otherMode],
  };
}

export async function getGoLive(): Promise<ActionResult<GoLivePage>> {
  try {
    await requirePlatformStaff();
    const [note, payoutsToMove] = await Promise.all([
      prisma.platformSetting.findUnique({ where: { key: LAST_WEBHOOK_KEY } }),
      paystackKeyMode() ? prisma.merchantPaymentAccount.count({ where: payoutsToMoveWhere() }) : Promise.resolve(0),
    ]);
    let lastWebhook: { at: string; mode: string | null } | null = null;
    try {
      lastWebhook = note ? JSON.parse(note.value) : null;
    } catch {
      lastWebhook = null;
    }
    const origin = new URL(metaRedirectUri()).origin;
    return {
      success: true,
      data: {
        checks: goLiveChecks(process.env, { lastWebhook, payoutsToMove, expectedMetaRedirect: metaRedirectUri(), now: new Date() }),
        manual: MANUAL_STEPS,
        payoutsToMove,
        keyMode: paystackKeyMode(),
        webhookUrl: `${origin}/api/payments/paystack/webhook`,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Not allowed.' };
    console.error('[platform/go-live]', error);
    return { success: false, error: 'We couldn’t load the checklist.' };
  }
}

/**
 * Give every approved business a payout account in the CURRENT Paystack mode
 * — run once, right after the live key goes in. A batch at a time, so a
 * slow Paystack can't time the request out; press again for the rest.
 */
export async function movePayoutsToCurrentMode(): Promise<ActionResult<{ moved: number; failed: number; left: number }>> {
  try {
    const staff = await requirePlatformStaff();
    const problem = paystackConfigProblem();
    if (problem) return { success: false, error: `Fix the Paystack settings first: ${problem}` };

    const batch = await prisma.merchantPaymentAccount.findMany({ where: payoutsToMoveWhere(), select: { organizationId: true }, take: 15 });
    let moved = 0;
    let failed = 0;
    for (const { organizationId } of batch) {
      const result = await provisionSubaccount(organizationId, staff.userId);
      if (result.outcome === 'created' || result.outcome === 'adopted' || result.outcome === 'already-set-up') moved += 1;
      else failed += 1;
    }
    const left = await prisma.merchantPaymentAccount.count({ where: payoutsToMoveWhere() });
    return { success: true, data: { moved, failed, left } };
  } catch (error) {
    if (error instanceof Error && error.name === 'PlatformAccessDeniedError') return { success: false, error: 'Not allowed.' };
    console.error('[platform/go-live] moving payouts failed', error);
    return { success: false, error: 'We couldn’t finish. Some may have moved — the count below is current.' };
  }
}
