/*
 * /account/trade — the shopper's trade account (ROADMAP 21.1): where they
 * stand, and the request form when the shop takes requests. Everything is
 * read with this store's id AND the signed-in shopper's, from the session.
 */
import type { Metadata } from 'next';
import { getShopper } from '@/lib/storefront/account/session';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/storefront/format';
import { getWholesaleSettings, tradeStanding } from '@/lib/trade/accounts';
import { AccountCard } from '../../_components/account-card';
import { AccountHeading } from '../../_components/account-heading';
import { TradeRequestForm } from '../../_components/trade-request-form';

export const metadata: Metadata = { title: 'Trade account' };

export default async function TradeAccountPage() {
  const shopper = (await getShopper())!;
  const [settings, standing, customer] = await Promise.all([
    getWholesaleSettings(shopper.organizationId),
    tradeStanding(shopper.organizationId, shopper.id),
    prisma.customer.findFirst({ where: { id: shopper.id, organizationId: shopper.organizationId }, select: { taxId: true } }),
  ]);
  const taxId = customer?.taxId ?? null;
  const on = settings.mode !== 'OFF';

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
      <AccountHeading>Trade account</AccountHeading>

      {standing?.status === 'APPROVED' && (
        <AccountCard
          title="You’re a trade buyer"
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
          title="Your trade account is paused"
          description="Trade terms don’t apply for now. Please contact the store if you have questions."
        >
          {standing.decisionReason && <p className="text-sm">The store’s note: “{standing.decisionReason}”</p>}
          {details}
        </AccountCard>
      )}

      {standing?.status === 'DECLINED' && (
        <AccountCard
          title="The store couldn’t open a trade account for you"
          description="You can keep shopping as a normal customer."
        >
          {standing.decisionReason && <p className="text-sm">The store’s note: “{standing.decisionReason}”</p>}
          {settings.requestsOpen && (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold">Ask again</p>
              <TradeRequestForm businessName={standing.businessName} taxId={taxId ?? ''} />
            </div>
          )}
        </AccountCard>
      )}

      {!standing &&
        (on && settings.requestsOpen ? (
          <AccountCard
            title="Buy wholesale"
            description="If you buy for a business — a shop, a restaurant, a reseller — ask the store for a trade account. They’ll check your details and email you their answer."
          >
            <TradeRequestForm taxId={taxId ?? ''} />
          </AccountCard>
        ) : (
          <AccountCard
            title={on ? 'Trade accounts are by invitation' : 'This shop doesn’t sell wholesale'}
            description={
              on
                ? 'This shop sets up trade accounts for the businesses it supplies. Please contact them if you’d like one.'
                : 'There’s nothing to set up here.'
            }
          >
            {null}
          </AccountCard>
        ))}
    </div>
  );
}
