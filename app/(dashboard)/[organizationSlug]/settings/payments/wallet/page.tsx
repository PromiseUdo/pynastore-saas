/*
 * Settings → Payments → Shop wallet (ROADMAP 20.4).
 *
 * The shop's EduPay wallet: its balance and transactions, read from EduPay
 * on every load; its PIN, and adding money with Paystack (20.3). Customers
 * pay into it (20.5), refunds leave from it (20.6), and its Owner withdraws to
 * the shop's verified bank account, by hand or on a schedule (20.7).
 *
 * The wallet is made when the shop is approved for online payments. Opening
 * this page is also how a shop approved before wallets gets one.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, TriangleAlert, Wallet } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { EmptyState } from '@/components/layout/empty-state';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { buttonVariants } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { shopWalletView } from '@/lib/wallet/shop';
import { WalletTransactions } from './_components/WalletTransactions';
import { ShopPinCard } from './_components/ShopPinCard';
import { PendingShopTopUps, ShopTopUpButton } from './_components/ShopTopUp';
import { Payouts } from './_components/Payouts';
import { pendingTopUps } from '@/lib/wallet/top-up';
import { payoutView } from '@/lib/wallet/payouts';
import { auth } from '@/lib/auth';
import { isStrongSignIn } from '@/lib/account-security/strong-sign-in';

export const metadata: Metadata = { title: 'Shop wallet' };

const PAGE_SIZE = 20;

type Props = { searchParams: Promise<{ page?: string }> };

export default async function ShopWalletPage({ searchParams }: Props) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="the shop wallet" />;
  const canManage = hasPermission(perms, PERMISSIONS.SETTINGS_EDIT);

  const page = Math.max(1, Number.parseInt((await searchParams).page ?? '1', 10) || 1);
  const view = await shopWalletView(ctx.organization.id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pending =
    view.state === 'active' ? await pendingTopUps({ kind: 'SHOP', organizationId: ctx.organization.id, startedById: ctx.userId }) : [];

  const payouts = view.state === 'active' ? await payoutView(ctx.organization.id) : null;
  const isOwner = ctx.membership.role.isSystem && ctx.membership.role.name === SYSTEM_ROLES.OWNER.name;
  const strongSignIn = isStrongSignIn((await auth())?.signInMethod);

  return (
    <>
      <PageHeader
        title="Shop wallet"
        description="Your shop’s EduPay wallet: its balance and every payment in and out."
        actions={view.state === 'active' && canManage ? <ShopTopUpButton /> : undefined}
      />
      <PageBody>
        {view.state === 'unavailable' && (
          <EmptyState icon={Wallet} title="Wallets aren’t available yet" description="Shop wallets haven’t been switched on for this platform yet." />
        )}

        {view.state === 'not-approved' && (
          <EmptyState
            icon={Wallet}
            title="Your wallet opens once you’re approved"
            description="Your shop gets an EduPay wallet as soon as we approve your business for online payments."
            action={
              canManage ? (
                <Link href="/settings/payments/online" className={buttonVariants({ size: 'sm' })}>
                  Set up online payments
                </Link>
              ) : undefined
            }
          />
        )}

        {view.state === 'setting-up' && (
          <EmptyState
            icon={Clock}
            title="Setting up your wallet"
            description="This usually takes a moment."
            action={
              <Link href="/settings/payments/wallet" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Check again
              </Link>
            }
          />
        )}

        {view.state === 'problem' && (
          <EmptyState
            icon={TriangleAlert}
            title="We couldn’t set up your wallet"
            description="Something went wrong on our side. Please try again later, and contact support if it keeps happening."
          />
        )}

        {view.state === 'active' && (
          <div className="space-y-6">
            <StatGrid>
              <StatCard
                title="Balance"
                value={view.wallet ? formatMoney(view.wallet.balanceKobo / 100, view.wallet.currency) : '—'}
                description={view.wallet ? (view.origin === 'CONNECTED' ? 'Held by EduPay in your own wallet' : 'Held by EduPay for your shop') : 'We couldn’t reach EduPay just now'}
                icon={Wallet}
              />
            </StatGrid>

            {view.origin === 'CONNECTED' && (
              <p className="text-sm text-muted-foreground">
                This is your own EduPay wallet — the one already registered to your shop’s contact email. You use the
                same wallet when you shop, so its balance and PIN are shared.
              </p>
            )}

            {pending.length > 0 && <PendingShopTopUps items={pending} />}

            {view.pin && <ShopPinCard pin={view.pin} canManage={canManage} />}

            {payouts && (
              <Payouts
                view={payouts}
                isOwner={isOwner}
                strongSignIn={strongSignIn}
                balance={view.wallet ? view.wallet.balanceKobo / 100 : null}
                connected={view.origin === 'CONNECTED'}
              />
            )}

            <WalletTransactions
              transactions={view.transactions}
              total={view.total}
              page={page}
              pageSize={PAGE_SIZE}
              currency={view.wallet?.currency ?? 'NGN'}
            />
          </div>
        )}

        {view.state !== 'unavailable' && (
          <p className="mt-8 text-xs text-muted-foreground">Wallets are provided by EduPay.</p>
        )}
      </PageBody>
    </>
  );
}
