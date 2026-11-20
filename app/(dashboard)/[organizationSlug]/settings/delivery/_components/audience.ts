/*
 * Who a delivery option or pickup point is offered to (ROADMAP 21.4A), in the
 * merchant's words. Shared by the option and pickup dialogs and the tables.
 */
import type { DeliveryAudience } from '@/lib/storefront/delivery/match';

export const AUDIENCE_LABEL: Record<DeliveryAudience, string> = {
  EVERYONE: 'Everyone',
  RETAIL: 'Retail customers only',
  TRADE: 'Wholesalers only',
};

/** The short badge beside a name in a table; none for everyone. */
export const AUDIENCE_BADGE: Record<DeliveryAudience, string | null> = {
  EVERYONE: null,
  RETAIL: 'Retail only',
  TRADE: 'Wholesale only',
};

export const AUDIENCES: DeliveryAudience[] = ['EVERYONE', 'RETAIL', 'TRADE'];
