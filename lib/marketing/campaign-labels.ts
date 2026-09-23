/*
 * lib/marketing/campaign-labels.ts
 *
 * The words and colours for campaigns, in one place — a plain module, since
 * both the server pages and the client screens need them and a `'use server'`
 * file may only export async functions.
 */
import type { BadgeVariant } from '@/lib/sales/order-labels';
import type { CampaignPhase } from './campaign-rules';

export const CAMPAIGN_PHASE_LABEL: Record<CampaignPhase, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Running',
  ENDED: 'Finished',
  CANCELLED: 'Called off',
};

export const CAMPAIGN_PHASE_VARIANT: Record<CampaignPhase, BadgeVariant> = {
  DRAFT: 'draft',
  SCHEDULED: 'pending',
  ACTIVE: 'success',
  ENDED: 'completed',
  CANCELLED: 'cancelled',
};

/** What each state means for the shop, in one line. */
export const CAMPAIGN_PHASE_HINT: Record<CampaignPhase, string> = {
  DRAFT: 'Nothing is priced yet. Schedule it to fix the prices and let it run.',
  SCHEDULED: 'Prices are fixed and waiting. It starts by itself — nothing to press.',
  ACTIVE: 'Live on your store right now. Customers see these prices.',
  ENDED: 'Over. Your usual prices came back by themselves.',
  CANCELLED: 'Called off before it ran. Nothing ever changed price.',
};

export const TARGET_KIND_LABEL: Record<string, string> = {
  PRODUCT: 'Chosen products',
  COLLECTION: 'Collections',
  CATEGORY: 'Categories',
  STORE: 'Everything in the store',
};
