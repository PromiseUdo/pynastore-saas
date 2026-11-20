/*
 * /account/trade — the shopper's trade account (ROADMAP 21.1): where they
 * stand, and the request form when the shop takes requests. Everything is
 * read with this store's id AND the signed-in shopper's, from the session.
 */
import type { Metadata } from 'next';
import { getShopper } from '@/lib/storefront/account/session';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { formatDate, formatMoney } from '@/lib/storefront/format';
import { accountBalance, accountTerms } from '@/lib/trade/credit';
import { getWholesaleSettings, tradeStanding } from '@/lib/trade/accounts';
import { AccountCard } from '../../_components/account-card';
import { AccountHeading } from '../../_components/account-heading';
import { TradeRequestForm } from '../../_components/trade-request-form';

export const metadata: Metadata = { title: 'Wholesale account' };

export default async function TradeAccountPage() {
  const shopper = (await getShopper())!;
  const [settings, standing, customer] = await Promise.all([
    getWholesaleSettings(shopper.organizationId),
    tradeStanding(shopper.organizationId, shopper.id),
    prisma.customer.findFirst({
      where: { id: shopper.id, organizationId: shopper.organizationId },
      select: { taxId: true },
    }),
  ]);
  const taxId = customer?.taxId ?? null;
  const on = settings.mode !== 'OFF';
  /* Pay on account (ROADMAP 21.5): their terms, and what they owe this shop —
   * orders on account and invoices together. Shown while they owe anything,
   * even if the store has since taken the credit away. */
  const [terms, balance] =
    standing?.status === 'APPROVED' || standing?.status === 'SUSPENDED'
      ? await Promise.all([
          accountTerms(shopper.organizationId, shopper.id),
          accountBalance(shopper.organizationId, shopper.id),
        ])
      : [null, null];
  const money = (major: number) => formatMoney(Math.round(major * 100));

  const details = standing && (
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">Business</dt>
      <dd>{standing.businessName}</dd>
      <dt className="text-muted-foreground">Tax ID</dt>
      <dd>{taxId || '—'}</dd>
      <dt className="text-muted-foreground">CAC number</dt>
      <dd>{standing.cacNumber || '—'}</dd>
    </dl>
  );

  return (
    <div className="space-y-5">
      <AccountHeading>Wholesale account</AccountHeading>

      {standing?.status === 'APPROVED' && (
        <AccountCard
          title="You’re a wholesaler"
          description={
            on
              ? `You shop here as ${standing.businessName}.${standing.decidedAt ? ` Approved ${formatDate(standing.decidedAt.toISOString())}.` : ''}`
              : 'This shop isn’t selling wholesale at the moment, so you’re shopping as a normal customer for now.'
          }
        >
          {details}
          <p className="mt-4 text-sm text-muted-foreground">
            To change these details, please contact the store.
          </p>
        </AccountCard>
      )}

      {(terms || (balance && balance.owed > 0)) && (
        <AccountCard
          title="Pay on account"
          description={
            terms
              ? `You can order now and pay the store within ${terms.days} days${
                  terms.creditLimit !== null
                    ? `, owing up to ${money(terms.creditLimit)} at once`
                    : ''
                }. New orders on account need nothing overdue.`
              : 'What you still owe the store.'
          }
        >
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">You owe</dt>
            <dd className="font-semibold tabular-nums">
              {money(balance?.owed ?? 0)}
            </dd>
            {balance && balance.overdue > 0 && (
              <>
                <dt className="text-muted-foreground">Overdue</dt>
                <dd className="font-semibold text-destructive tabular-nums">
                  {money(balance.overdue)}
                </dd>
              </>
            )}
          </dl>
          {balance && balance.items.length > 0 && (
            <ul className="mt-4 divide-y rounded-2xl border text-sm">
              {balance.items.map((item) => {
                const href =
                  item.kind === 'order'
                    ? `/account/orders/${encodeURIComponent(item.number)}`
                    : item.token
                      ? `/invoice/${item.token}`
                      : null;
                const label = `${item.kind === 'order' ? 'Order' : 'Invoice'} ${item.number}`;
                return (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span>
                      {href ? (
                        <Link
                          href={href}
                          className="font-medium underline underline-offset-4"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="font-medium">{label}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {item.dueAt
                          ? `${item.overdue ? 'Overdue since' : 'Due'} ${formatDate(item.dueAt)}`
                          : 'No due date'}
                      </span>
                    </span>
                    <span
                      className={`tabular-nums ${item.overdue ? 'font-semibold text-destructive' : ''}`}
                    >
                      {money(item.owed)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Pay the store directly — each order’s invoice shows how. They record
            payments as they arrive.
          </p>
        </AccountCard>
      )}

      {standing?.status === 'REQUESTED' && (
        <AccountCard
          title="Your request is with the store"
          description={`You asked${standing.requestedAt ? ` on ${formatDate(standing.requestedAt.toISOString())}` : ''}. The store will email you once they’ve decided. Until then you shop as a normal customer.`}
        >
          {details}
        </AccountCard>
      )}

      {standing?.status === 'SUSPENDED' && (
        <AccountCard
          title="Your wholesale account is paused"
          description="Wholesale terms don’t apply for now. Please contact the store if you have questions."
        >
          {standing.decisionReason && (
            <p className="text-sm">
              The store’s note: “{standing.decisionReason}”
            </p>
          )}
          {details}
        </AccountCard>
      )}

      {standing?.status === 'DECLINED' && (
        <AccountCard
          title="The store couldn’t open a wholesale account for you"
          description="You can keep shopping as a normal customer."
        >
          {standing.decisionReason && (
            <p className="text-sm">
              The store’s note: “{standing.decisionReason}”
            </p>
          )}
          {settings.requestsOpen && (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold">Ask again</p>
              <TradeRequestForm
                businessName={standing.businessName}
                taxId={taxId ?? ''}
              />
            </div>
          )}
        </AccountCard>
      )}

      {!standing &&
        (on && settings.requestsOpen ? (
          <AccountCard
            title="Buy wholesale"
            description="If you buy for a business, a shop, a reseller, ask the store for a wholesale account."
          >
            <TradeRequestForm taxId={taxId ?? ''} />
          </AccountCard>
        ) : (
          <AccountCard
            title={
              on
                ? 'Wholesale accounts are by invitation'
                : 'This shop doesn’t sell wholesale'
            }
            description={
              on
                ? 'This shop sets up wholesale accounts for the businesses it supplies. Please contact them if you’d like one.'
                : 'There’s nothing to set up here.'
            }
          >
            {null}
          </AccountCard>
        ))}
    </div>
  );
}
