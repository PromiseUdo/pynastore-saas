'use server';

import { z } from 'zod';
import { getOrganizationContext } from '@/lib/organization';
import { prisma } from '@/lib/prisma';
import { requirePermission, PERMISSIONS, PermissionDeniedError } from '@/lib/permissions';
import { searchDomain as searchNamecheapDomain, isValidDomainFormat } from '@/lib/domains/namecheap';
import { quoteDomainNgn } from '@/lib/domains/pricing';
import { buildAndInitializeCheckout, CheckoutError, type DomainChoiceInput } from '@/lib/billing/checkout';

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type DomainSearchResultData =
  | { domain: string; available: false }
  | { domain: string; available: true; priceUsd: number; priceNgn: number };

/** Live availability + pricing lookup for the "Register a new domain" search UI. */
export async function searchDomain(query: string): Promise<ActionResult<DomainSearchResultData>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

    const trimmed = query.trim();
    if (!trimmed) {
      return { success: false, error: 'Enter a domain to search.' };
    }
    if (!isValidDomainFormat(trimmed)) {
      return { success: false, error: `"${trimmed}" doesn't look like a valid domain.` };
    }

    const result = await searchNamecheapDomain(trimmed);
    if (!result.available) {
      return { success: true, data: { domain: result.domain, available: false } };
    }

    const { ngnPrice } = await quoteDomainNgn(result.priceUsd);
    return {
      success: true,
      data: { domain: result.domain, available: true, priceUsd: result.priceUsd, priceNgn: ngnPrice },
    };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage billing.' };
    }
    console.error('[searchDomain]', err);
    return { success: false, error: 'Domain search failed. Please try again.' };
  }
}

const PurchaseDomainSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EXISTING'), domain: z.string().min(3) }),
  z.object({ type: z.literal('REGISTER'), domain: z.string().min(3) }),
]);

/**
 * Standalone domain setup/change for an org that's already on a paid plan
 * (reachable from Settings -> Billing, independent of the upgrade wizard).
 * Charges only the domain fee — 0 for EXISTING (connecting a domain you
 * already own is free, so this skips Paystack entirely and returns
 * authorizationUrl: null — nothing left for the caller to redirect to) or
 * the quoted price for REGISTER. The org's current plan is left untouched.
 */
export async function purchaseDomain(
  input: z.infer<typeof PurchaseDomainSchema>,
): Promise<ActionResult<{ authorizationUrl: string | null }>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.BILLING_MANAGE);

    const parsed = PurchaseDomainSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true },
    });
    if (!user?.email) {
      return { success: false, error: 'Your account has no email on file.' };
    }

    const result = await buildAndInitializeCheckout({
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      userId: ctx.userId,
      userEmail: user.email,
      domainChoice: parsed.data as DomainChoiceInput,
    });

    return {
      success: true,
      data: { authorizationUrl: result.requiresPayment ? result.authorizationUrl : null },
    };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { success: false, error: 'You do not have permission to manage billing.' };
    }
    if (err instanceof CheckoutError) {
      return { success: false, error: err.message };
    }
    console.error('[purchaseDomain]', err);
    return { success: false, error: 'Failed to start checkout. Please try again.' };
  }
}
