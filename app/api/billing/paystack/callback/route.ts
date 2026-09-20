/*
 * GET /api/billing/paystack/callback
 *
 * Paystack redirects the browser here after checkout. We verify the
 * transaction and apply it immediately for fast UX, but the webhook route
 * remains the source of truth in case the user never lands back here.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTransaction } from '@/lib/billing/paystack';
import { applySuccessfulCharge } from '@/lib/billing/apply-charge';
import { getAdminUrl, getMarketingUrl } from '@/lib/tenant/urls';

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('reference');

  if (!reference) {
    return NextResponse.redirect(getMarketingUrl('/'));
  }

  const transaction = await prisma.billingTransaction.findUnique({
    where: { reference },
    select: { organizationId: true, status: true, organization: { select: { slug: true } } },
  });

  if (!transaction) {
    return NextResponse.redirect(getMarketingUrl('/'));
  }

  const billingUrl = getAdminUrl(transaction.organization.slug, '/settings/billing');

  try {
    if (transaction.status !== 'SUCCESS') {
      const data = await verifyTransaction(reference);
      if (data.status === 'success') {
        await applySuccessfulCharge(data);
        return NextResponse.redirect(`${billingUrl}?checkout=success`);
      }
      return NextResponse.redirect(`${billingUrl}?checkout=failed`);
    }
    return NextResponse.redirect(`${billingUrl}?checkout=success`);
  } catch (err) {
    console.error('[paystack callback]', err);
    return NextResponse.redirect(`${billingUrl}?checkout=failed`);
  }
}
