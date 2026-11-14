'use server';

/*
 * features/shop-account/trade.ts
 *
 * A signed-in shopper asks for a trade account (ROADMAP 21.1), from
 * Account → Trade account. The store comes from the request and the shopper
 * from the session — never from the form. Whether the shop takes requests,
 * and whether this shopper may ask, is decided in lib/trade/accounts.ts.
 */
import { revalidatePath } from 'next/cache';
import { checkRateLimit } from '@/lib/rate-limit';
import { runAfter } from '@/lib/run-after';
import { findStoreBySlug } from '@/lib/storefront/account/shopper';
import { currentStoreSlug, getShopper } from '@/lib/storefront/account/session';
import { requestTradeAccount } from '@/lib/trade/accounts';
import { tellStoreTradeRequest } from '@/lib/trade/messages';
import { TradeRequestSchema, fieldErrors } from '@/lib/trade/rules';

export type TradeRequestState = {
  error?: string;
  fieldErrors?: Partial<Record<'businessName' | 'taxId' | 'cacNumber' | 'note', string>>;
  values?: { businessName?: string; taxId?: string; cacNumber?: string; note?: string };
  sent?: boolean;
} | null;

const REFUSED: Record<string, string> = {
  'wholesale-off': 'This shop isn’t taking trade accounts at the moment.',
  'requests-closed': 'This shop isn’t taking trade account requests at the moment. Please contact them directly.',
  'already-trade': 'You already have a trade account here.',
  waiting: 'Your request is already with the store.',
  paused: 'Your trade account is paused. Please contact the store.',
  'not-found': 'Your session has ended. Please sign in again.',
  changed: 'Your request was just updated. Refresh the page to see where it is.',
};

export async function requestTradeAccountAction(_prev: TradeRequestState, formData: FormData): Promise<TradeRequestState> {
  const slug = await currentStoreSlug();
  const [store, shopper] = await Promise.all([slug ? findStoreBySlug(slug) : null, getShopper()]);
  if (!store || !shopper || shopper.organizationId !== store.id) return { error: REFUSED['not-found'] };

  const values = {
    businessName: String(formData.get('businessName') ?? ''),
    taxId: String(formData.get('taxId') ?? ''),
    cacNumber: String(formData.get('cacNumber') ?? ''),
    note: String(formData.get('note') ?? ''),
  };
  const parsed = TradeRequestSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  // A real business asks once; this is about a script.
  if (!(await checkRateLimit(`trade-request:${store.id}:${shopper.id}`, 5, 60 * 60 * 1000))) {
    return { error: 'Too many attempts. Please try again later.', values };
  }

  const { note, ...details } = parsed.data;
  const result = await requestTradeAccount({ organizationId: store.id, customerId: shopper.id, details, note });
  if (!result.ok) return { error: REFUSED[result.reason] ?? 'We couldn’t send your request. Please try again.', values };

  runAfter(() => tellStoreTradeRequest({ organizationId: store.id, customerId: shopper.id, businessName: details.businessName }));
  revalidatePath('/account/trade');
  return { sent: true };
}
