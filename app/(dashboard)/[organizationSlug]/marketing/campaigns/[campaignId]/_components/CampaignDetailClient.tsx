'use client';

/*
 * A campaign's own page.
 *
 * What it says depends on where the campaign is: a draft asks to be
 * scheduled, a scheduled one says when it will start by itself, a running one
 * shows what it is doing, and a finished one shows what it did. The state
 * hint under the badge is there because "Scheduled" alone doesn't tell a shop
 * owner whether they still have to do something.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, FolderOpen, Loader2, Share2, Tag, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { campaignMechanicLabel } from '@/lib/marketing/campaign-rules';
import {
  CAMPAIGN_PHASE_HINT,
  CAMPAIGN_PHASE_LABEL,
  CAMPAIGN_PHASE_VARIANT,
  TARGET_KIND_LABEL,
} from '@/lib/marketing/campaign-labels';
import {
  createCampaignCollection,
  deleteCampaign,
  endCampaign,
  scheduleCampaign,
} from '@/features/marketing/campaigns';
import type { CampaignDetail } from '@/features/marketing/campaign-reads';
import { AnnouncementCard } from './AnnouncementCard';

export function CampaignDetailClient({
  campaign,
  currency,
  canManage,
  storeName,
  storeUrl,
  destinations,
}: {
  campaign: CampaignDetail;
  currency: string;
  canManage: boolean;
  storeName: string;
  storeUrl: string;
  destinations: { label: string; href: string }[];
}) {
  const router = useRouter();
  const money = (value: number) => formatMoney(value, currency);
  const [pending, setPending] = React.useState<string | null>(null);
  const [ending, setEnding] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  async function run(label: string, action: () => Promise<{ success: boolean; error?: string }>, done: string) {
    setPending(label);
    const result = await action();
    setPending(null);
    if (!result.success) {
      toast.error(result.error ?? 'Something went wrong');
      return false;
    }
    toast.success(done);
    router.refresh();
    return true;
  }

  const phase = campaign.phase;
  const perf = campaign.performance;

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaignMechanicLabel(campaign.mechanic as 'PERCENT_OFF', campaign.value, money)} · ${
          TARGET_KIND_LABEL[campaign.targetKind] ?? campaign.targetKind
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/marketing/campaigns"
              className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              All campaigns
            </Link>
            {canManage && phase === 'DRAFT' && (
              <Button
                size="sm"
                disabled={pending !== null}
                onClick={() => run('schedule', () => scheduleCampaign(campaign.id), 'Campaign scheduled')}
              >
                {pending === 'schedule' && <Loader2 className="size-3.5 animate-spin" />}
                Schedule it
              </Button>
            )}
            {canManage && (phase === 'ACTIVE' || phase === 'SCHEDULED') && (
              <Button variant="outline" size="sm" onClick={() => setEnding(true)} disabled={pending !== null}>
                {phase === 'ACTIVE' ? 'End it now' : 'Call it off'}
              </Button>
            )}
            {canManage && (phase === 'DRAFT' || phase === 'CANCELLED') && (
              <Button variant="outline" size="sm" onClick={() => setRemoving(true)} disabled={pending !== null}>
                Delete
              </Button>
            )}
          </div>
        }
      />

      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={CAMPAIGN_PHASE_VARIANT[phase]}>{CAMPAIGN_PHASE_LABEL[phase]}</Badge>
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatDate(campaign.startsAt)}
            {campaign.endsAt ? ` – ${formatDate(campaign.endsAt)}` : ' – until stopped'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{CAMPAIGN_PHASE_HINT[phase]}</p>
        {campaign.description && <p className="text-sm">{campaign.description}</p>}

        {/* ── What it did ─────────────────────────────────────────── */}
        {perf && (
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            <Metric label="Orders" value={formatNumber(perf.orders)} />
            <Metric label="Units sold" value={formatNumber(perf.unitsSold)} />
            <Metric label="Revenue" value={money(perf.revenue)} />
            <Metric
              label="Given away"
              value={money(perf.discountGiven)}
              note="What the sale cost, against the old prices"
            />
          </section>
        )}

        {perf && (
          <p className="text-xs text-muted-foreground">
            Counts orders placed while the campaign was on that contained something it priced.
            {campaign.codeCount > 0 && ` Discount codes were used ${formatNumber(perf.codeRedemptions)} times.`}
          </p>
        )}

        {/* ── A page for the sale ─────────────────────────────────── */}
        {(phase === 'ACTIVE' || phase === 'SCHEDULED' || campaign.collection) && (
          <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              {campaign.collection ? (
                <>
                  <p className="text-sm font-medium">
                    Everything in this sale is in the{' '}
                    <span className="text-foreground">{campaign.collection.name}</span> collection
                  </p>
                  <p className="text-xs text-muted-foreground">
                    /collections/{campaign.collection.slug} ·{' '}
                    {formatNumber(campaign.collection.productCount)}{' '}
                    {campaign.collection.productCount === 1 ? 'product' : 'products'} · you can rename it,
                    add a picture or reorder it like any other collection
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Give this sale a page</p>
                  <p className="text-xs text-muted-foreground">
                    Makes a collection holding exactly what this campaign prices, so you have somewhere to
                    send customers — and something to link the announcement to.
                  </p>
                </>
              )}
            </div>

            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {campaign.collection && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/inventory/collections/${campaign.collection.id}`}>Edit it</Link>
                  </Button>
                )}
                <Button
                  variant={campaign.collection ? 'outline' : 'default'}
                  size="sm"
                  disabled={pending !== null}
                  onClick={async () => {
                    setPending('collection');
                    const result = await createCampaignCollection(campaign.id);
                    setPending(null);
                    if (!result.success) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(
                      result.data.created
                        ? `“${result.data.name}” created with ${result.data.productCount} products`
                        : `“${result.data.name}” updated — ${result.data.productCount} products`,
                    );
                    router.refresh();
                  }}
                >
                  {pending === 'collection' && <Loader2 className="size-3.5 animate-spin" />}
                  {campaign.collection ? 'Update its products' : 'Create the collection'}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* ── What customers are told ─────────────────────────────── */}
        <AnnouncementCard
          campaign={campaign}
          canManage={canManage}
          storeName={storeName}
          storeUrl={storeUrl}
          destinations={destinations}
        />

        {/* ── What it covers ──────────────────────────────────────── */}
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Tag className="size-4" aria-hidden />
              Prices
            </h2>
            <span className="text-xs text-muted-foreground">
              {formatNumber(campaign.prices.length)}{' '}
              {campaign.prices.length === 1 ? 'product' : 'products'}
            </span>
          </div>

          {campaign.prices.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nothing is priced yet. Scheduling the campaign works out which products it covers and fixes
              their prices.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Product</TableColumnHeader>
                    <TableColumnHeader>SKU</TableColumnHeader>
                    <TableColumnHeader align="right">Usual price</TableColumnHeader>
                    <TableColumnHeader align="right">Sale price</TableColumnHeader>
                    <TableColumnHeader align="right">Off</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {campaign.prices.map((price) => (
                    <TableRow key={price.inventoryItemId}>
                      <TableCell className="font-medium text-foreground">{price.name}</TableCell>
                      <TableCell muted className="text-xs">
                        {price.sku}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums text-muted-foreground line-through">
                        {money(price.originalPrice)}
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">
                        {money(price.price)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums text-muted-foreground">
                        {money(price.originalPrice - price.price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </section>

        {/* ── What else belongs to it ─────────────────────────────── */}
        {(campaign.discountCodes.length > 0 || campaign.socialPosts.length > 0) && (
          <section className="grid gap-4 sm:grid-cols-2">
            {campaign.discountCodes.length > 0 && (
              <div className="rounded-lg border bg-card">
                <h2 className="flex items-center gap-1.5 border-b px-4 py-3 text-sm font-semibold">
                  <Ticket className="size-4" aria-hidden />
                  Discount codes
                </h2>
                <ul className="divide-y text-sm">
                  {campaign.discountCodes.map((code) => (
                    <li key={code.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span>
                        <span className="block font-mono font-medium">{code.code}</span>
                        <span className="block text-xs text-muted-foreground">{code.label}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        used {formatNumber(code.usageCount)}×
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {campaign.socialPosts.length > 0 && (
              <div className="rounded-lg border bg-card">
                <h2 className="flex items-center gap-1.5 border-b px-4 py-3 text-sm font-semibold">
                  <Share2 className="size-4" aria-hidden />
                  Posts about it
                </h2>
                <ul className="divide-y text-sm">
                  {campaign.socialPosts.map((post) => (
                    <li key={post.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <Link href={`/social/posts/${post.id}`} className="text-primary hover:underline">
                        {post.platform === 'FACEBOOK_PAGE' ? 'Facebook' : 'Instagram'}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {post.publishedAt ? formatDate(post.publishedAt) : post.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </PageBody>

      <AlertDialogRoot open={ending} onOpenChange={(next) => !next && setEnding(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {phase === 'ACTIVE' ? `End ${campaign.name} now?` : `Call off ${campaign.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {phase === 'ACTIVE'
                ? 'Your usual prices come back straight away — they were never overwritten. Orders already placed at the sale price stay as they are.'
                : 'It won’t run. Nothing ever changed price, so there is nothing to put back.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Leave it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending !== null}
              onClick={async () => {
                const ok = await run('end', () => endCampaign(campaign.id), 'Campaign stopped');
                if (ok) setEnding(false);
              }}
            >
              {pending === 'end' && <Loader2 className="size-3.5 animate-spin" />}
              {phase === 'ACTIVE' ? 'End it now' : 'Call it off'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <AlertDialogRoot open={removing} onOpenChange={(next) => !next && setRemoving(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {campaign.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This campaign never ran, so there’s no history to keep. It can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending !== null}
              onClick={async () => {
                setPending('delete');
                const result = await deleteCampaign(campaign.id);
                setPending(null);
                if (!result.success) {
                  toast.error(result.error);
                  return;
                }
                toast.success('Campaign deleted');
                router.replace('/marketing/campaigns');
              }}
            >
              {pending === 'delete' && <Loader2 className="size-3.5 animate-spin" />}
              Delete campaign
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
