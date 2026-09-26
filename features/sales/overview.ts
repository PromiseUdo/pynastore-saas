'use server';

/*
 * features/sales/overview.ts
 *
 * The figures on the Sales landing page.
 *
 * It used to load EVERY quote, invoice and customer into memory and count them
 * in Node, which grew with the business and put every customer's email into a
 * page that shows four numbers. These are counts and one aggregate, done in the
 * database — the same correction the orders list got in Phase 2.
 *
 * "Overdue" is the same rule `features/sales/invoices.ts` uses (issued or part
 * paid, and the due date has passed), so the tile and the list can't disagree.
 */

import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { InvoiceStatus, QuoteStatus } from '@/lib/generated/prisma/enums';
import type { ActionResult } from './shared';

export interface SalesOverview {
  /** Quotes still in play — drafted or sent, not yet accepted or lost. */
  openQuotes: number;
  /** Money invoiced and not yet received, on invoices that are still owed. */
  unpaidTotal: number;
  overdueInvoices: number;
  customers: number;
  /** Shopper questions nobody has answered — they aren't on the store until someone does. */
  unansweredQuestions: number;
}

export async function getSalesOverview(): Promise<ActionResult<SalesOverview>> {
  try {
    const ctx = await getOrganizationContext();
    requirePermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW);
    const organizationId = ctx.organization.id;

    const owed = { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] };

    const [openQuotes, owedInvoices, overdueInvoices, customers, unansweredQuestions] = await Promise.all([
      prisma.quote.count({
        where: { organizationId, status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT] } },
      }),
      prisma.invoice.aggregate({
        where: { organizationId, status: owed },
        _sum: { totalAmount: true, paidAmount: true },
      }),
      prisma.invoice.count({
        where: { organizationId, status: owed, dueDate: { not: null, lt: new Date() } },
      }),
      prisma.customer.count({ where: { organizationId, mergedIntoId: null } }),
      prisma.productQuestion.count({ where: { organizationId, status: 'PENDING' } }),
    ]);

    return {
      success: true,
      data: {
        openQuotes,
        unpaidTotal: Number(owedInvoices._sum.totalAmount ?? 0) - Number(owedInvoices._sum.paidAmount ?? 0),
        overdueInvoices,
        customers,
        unansweredQuestions,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load your sales figures' };
  }
}
