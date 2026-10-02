/*
 * lib/data-rights/shopper.ts
 *
 * A shopper's rights over their own account at one store (ROADMAP 13.8,
 * NDPA): to get a copy of what the store holds about them, and to delete
 * the account. A shopper account IS the merchant's Customer record (see the
 * storefront account notes), so "delete" can't mean dropping the row while
 * past orders and invoices still name them — the law requires those be kept
 * (policy.ts). It means:
 *
 *   - gone now: the sign-in (password, Google link, sessions, reset and
 *     email-change links), saved addresses, wishlist, reviews, questions and
 *     "helpful" votes, the merchant's notes and tags, marketing consent;
 *   - contact details cleared from the customer record, so the store can't
 *     reach them through it, and the email is free to register again;
 *   - kept, for the retention period only: the orders and invoices, with the
 *     name and delivery details written on them. The daily retention job
 *     (./retention.ts) anonymises each once it's past the period.
 *
 * A customer with no orders, invoices or quotes at all is deleted outright.
 */
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { FINANCIAL_RETENTION_YEARS } from './policy';

export interface ShopperExport {
  about: string;
  store: string;
  exportedAt: string;
  profile: {
    name: string;
    email: string | null;
    phone: string | null;
    marketingConsent: boolean;
    marketingConsentUpdatedAt: string | null;
    accountCreatedAt: string;
    lastSignInAt: string | null;
    signInWith: string[];
  };
  savedAddresses: { fullName: string; phone: string; line1: string; line2: string | null; city: string; state: string; country: string; postalCode: string | null; isDefault: boolean }[];
  wishlist: { product: string; savedAt: string }[];
  orders: {
    reference: string;
    placedAt: string;
    status: string;
    paymentStatus: string;
    currency: string;
    total: string;
    contact: { name: string; email: string | null; phone: string | null };
    deliverTo: string | null;
    items: { name: string; variant: string | null; quantity: number; unitPrice: string }[];
  }[];
  reviews: { product: string; rating: number; title: string; body: string; writtenAt: string }[];
  questions: { product: string; question: string; answer: string | null; askedAt: string }[];
}

/** Everything the store holds about this shopper, in plain JSON they can keep. */
export async function exportShopperData(organizationId: string, customerId: string): Promise<ShopperExport | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId, accountDeletedAt: null },
    include: {
      organization: { select: { name: true } },
      oauthAccounts: { select: { provider: true } },
      addresses: { orderBy: { createdAt: 'asc' } },
      wishlist: { include: { product: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      orders: { include: { lineItems: true }, orderBy: { placedAt: 'asc' } },
      reviews: { include: { product: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      questions: { include: { product: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!customer) return null;

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const money = (n: unknown) => Number(n).toFixed(2);

  return {
    about: `Everything ${customer.organization.name} holds about your account, as of the time below. Orders are kept for ${FINANCIAL_RETENTION_YEARS} years because the law requires it, even if you delete your account.`,
    store: customer.organization.name,
    exportedAt: new Date().toISOString(),
    profile: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      marketingConsent: customer.marketingConsent,
      marketingConsentUpdatedAt: iso(customer.consentUpdatedAt),
      accountCreatedAt: customer.createdAt.toISOString(),
      lastSignInAt: iso(customer.lastLoginAt),
      signInWith: [...(customer.passwordHash ? ['password'] : []), ...customer.oauthAccounts.map((a) => a.provider)],
    },
    savedAddresses: customer.addresses.map((a) => ({
      fullName: a.fullName,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      country: a.country,
      postalCode: a.postalCode,
      isDefault: a.isDefault,
    })),
    wishlist: customer.wishlist.map((w) => ({ product: w.product.name, savedAt: w.createdAt.toISOString() })),
    orders: customer.orders.map((o) => ({
      reference: o.reference,
      placedAt: o.placedAt.toISOString(),
      status: o.status,
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      total: money(o.totalAmount),
      contact: { name: [o.firstName, o.lastName].filter(Boolean).join(' '), email: o.email, phone: o.phone },
      deliverTo: o.shipLine1
        ? [o.shipFullName, o.shipLine1, o.shipLine2, o.shipCity, o.shipState, o.shipCountry, o.shipPostalCode].filter(Boolean).join(', ')
        : null,
      items: o.lineItems.map((l) => ({ name: l.name, variant: l.variantName, quantity: l.quantity, unitPrice: money(l.unitPrice) })),
    })),
    reviews: customer.reviews.map((r) => ({ product: r.product.name, rating: r.rating, title: r.title, body: r.body, writtenAt: r.createdAt.toISOString() })),
    questions: customer.questions.map((q) => ({ product: q.product.name, question: q.body, answer: q.answerBody, askedAt: q.createdAt.toISOString() })),
  };
}

export type DeletionOutcome = 'deleted' | 'records-kept';

/**
 * Delete a shopper's account. `deleted`: nothing tied them to business
 * records, so the customer is gone. `records-kept`: their orders, invoices or
 * quotes remain, naming them, until the retention job anonymises them.
 * Idempotent: an account already deleted returns null.
 */
export async function deleteShopperAccount(organizationId: string, customerId: string): Promise<DeletionOutcome | null> {
  const outcome = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId, accountDeletedAt: null },
      select: {
        id: true,
        _count: { select: { orders: true, invoices: true, quotes: true, dropShipPurchaseOrders: true, mergedFrom: true } },
      },
    });
    if (!customer) return null;

    // What exists only because of the online account, or says what they think.
    await tx.customerOAuthAccount.deleteMany({ where: { customerId } });
    await tx.customerPasswordResetToken.deleteMany({ where: { customerId } });
    await tx.customerEmailChange.deleteMany({ where: { customerId } });
    await tx.customerAddress.deleteMany({ where: { customerId } });
    await tx.customerWishlistItem.deleteMany({ where: { customerId } });
    await tx.productReviewVote.deleteMany({ where: { customerId } });
    await tx.productReview.deleteMany({ where: { customerId } });
    await tx.productQuestion.deleteMany({ where: { customerId } });

    const c = customer._count;
    if (c.orders + c.invoices + c.quotes + c.dropShipPurchaseOrders + c.mergedFrom === 0) {
      await tx.customer.delete({ where: { id: customerId } });
      return 'deleted' as const;
    }

    await tx.customer.update({
      where: { id: customerId },
      data: {
        // Kept: `name`, which past invoices print, and `taxId` if an invoice may need it.
        email: null,
        phone: null,
        address: null,
        notes: null,
        tags: [],
        passwordHash: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        sessionVersion: { increment: 1 }, // every open session ends
        marketingConsent: false,
        consentUpdatedAt: new Date(),
        accountDeletedAt: new Date(),
        ...(c.invoices === 0 ? { taxId: null } : {}),
      },
    });
    return 'records-kept' as const;
  });

  if (outcome) {
    await createAuditLog({
      organizationId,
      userId: null,
      action: 'sales.customer.account_deleted',
      entityType: 'Customer',
      entityId: customerId,
      metadata: { outcome },
    });
  }
  return outcome;
}
