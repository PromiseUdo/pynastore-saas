'use client';

/*
 * The campaign list.
 *
 * Grouped by what a merchant needs to do about each one: what is live now,
 * what is waiting, and what is over. A flat table sorted by date would bury
 * the running sale — the only row anyone is worried about — among last
 * year's.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Megaphone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { campaignMechanicLabel, type CampaignPhase } from '@/lib/marketing/campaign-rules';
import {
  CAMPAIGN_PHASE_LABEL,
  CAMPAIGN_PHASE_VARIANT,
  TARGET_KIND_LABEL,
} from '@/lib/marketing/campaign-labels';
import type { CampaignRow } from '@/features/marketing/campaign-reads';

const GROUPS: { phases: CampaignPhase[]; title: string; note: string }[] = [
  { phases: ['ACTIVE'], title: 'Running now', note: 'Customers are seeing these prices.' },
  { phases: ['SCHEDULED'], title: 'Coming up', note: 'Priced and waiting. They start by themselves.' },
  { phases: ['DRAFT'], title: 'Drafts', note: 'Not priced yet, and not on your store.' },
  { phases: ['ENDED', 'CANCELLED'], title: 'Finished', note: 'Your usual prices are back.' },
];

export function CampaignsPageClient({
  campaigns,
  currency,
  canManage,
}: {
  campaigns: CampaignRow[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const money = (value: number) => formatMoney(value, currency);

  const newButton = canManage ? (
    <Button asChild size="sm">
      <Link href="/marketing/campaigns/new">
        <Plus className="size-3.5" />
        New campaign
      </Link>
    </Button>
  ) : undefined;

  const header = (
    <PageHeader
      title="Campaigns"
      description="Run a sale on chosen products for a stretch of time. Prices go back by themselves when it ends."
      actions={newButton}
    />
  );

  if (campaigns.length === 0) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="A campaign puts chosen products on sale between two dates — a Christmas sale, a weekend on one collection. Your usual prices are never overwritten, so they come back on their own."
            action={newButton}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      {header}
      <PageBody className="space-y-8">
        {GROUPS.map((group) => {
          const rows = campaigns.filter((c) => group.phases.includes(c.phase));
          if (rows.length === 0) return null;

          return (
            <section key={group.title} className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold">{group.title}</h2>
                <p className="text-xs text-muted-foreground">{group.note}</p>
              </div>

              <ul className="divide-y rounded-lg border bg-card">
                {rows.map((campaign) => (
                  <li key={campaign.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/marketing/campaigns/${campaign.id}`)}
                      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-40 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{campaign.name}</span>
                          <Badge variant={CAMPAIGN_PHASE_VARIANT[campaign.phase]}>
                            {CAMPAIGN_PHASE_LABEL[campaign.phase]}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {campaignMechanicLabel(
                            campaign.mechanic as 'PERCENT_OFF',
                            campaign.value,
                            money,
                          )}{' '}
                          · {TARGET_KIND_LABEL[campaign.targetKind] ?? campaign.targetKind}
                          {campaign.productCount > 0 &&
                            ` · ${formatNumber(campaign.productCount)} ${
                              campaign.productCount === 1 ? 'product' : 'products'
                            }`}
                        </span>
                      </span>

                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatDate(campaign.startsAt)}
                        {campaign.endsAt ? ` – ${formatDate(campaign.endsAt)}` : ' – until stopped'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </PageBody>
    </>
  );
}
