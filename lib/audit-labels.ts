/*
 * lib/audit-labels.ts
 *
 * Turning an audit action key into something a shop owner can read.
 *
 * Entries are written `domain.entity.verb` ("procurement.po.approved"), with
 * a few two-part ones ("role.created"). Showing those raw would break AGENTS
 * §6, and `.replace('_',' ')` would give "Po approved" — so the entity and
 * the verb each get real words, and the handful that don't fit the pattern
 * are named outright in OVERRIDES.
 *
 * Pure, so the table and the CSV say exactly the same thing.
 */

/** Entity phrases carry their own article, which keeps "a"/"an" out of the code. */
const ENTITY: Record<string, string> = {
  'inventory.brand': 'a brand',
  'inventory.category': 'a category',
  'inventory.collection': 'a collection',
  'inventory.cycle_count': 'a stock count',
  'inventory.item': 'a product',
  'inventory.kit': 'a kit',
  'inventory.putaway': 'a shelf location',
  'inventory.transfer': 'a stock transfer',
  'inventory.warehouse': 'a store',
  'marketing.campaign': 'a campaign',
  'procurement.po': 'a purchase order',
  'procurement.supplier': 'a supplier',
  'sales.customer': 'a customer',
  'sales.discount_code': 'a discount code',
  'sales.fulfillment': 'a fulfillment',
  'sales.invoice': 'an invoice',
  'sales.order': 'an order',
  'sales.order_return': 'an online return',
  'sales.question': 'a customer question',
  'sales.quote': 'a quote',
  'sales.return': 'a return',
  'sales.review': 'a review',
  'settings.bank_account': 'a bank account',
  'settings.delivery_rate': 'a delivery rate',
  'settings.delivery_zone': 'a delivery zone',
  'settings.organization': 'the business details',
  'settings.pickup_location': 'a pickup point',
  'settings.returns': 'the returns policy',
  'settings.store_page': 'a store page',
  'settings.hero_slide': 'a front-page slide',
  'social.connection': 'a social account',
  'social.post': 'a social post',
  'staff.invitation': 'an invitation',
  'staff.member': 'a member',
  'billing.subscription': 'the subscription',
  role: 'a role',
};

const VERB: Record<string, string> = {
  accepted: 'Accepted',
  activated: 'Activated',
  answer: 'Answered',
  approved: 'Approved',
  assembled: 'Assembled',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  completed: 'Completed',
  converted: 'Converted',
  created: 'Created',
  delete: 'Deleted',
  deleted: 'Deleted',
  discarded: 'Discarded',
  disconnected: 'Disconnected',
  dispatched: 'Sent out',
  duplicated: 'Duplicated',
  hide: 'Hid',
  issued: 'Issued',
  merged: 'Merged',
  ordered: 'Ordered',
  packed: 'Packed',
  picked: 'Picked',
  published: 'Published',
  received: 'Received',
  refunded: 'Refunded',
  rejected: 'Declined',
  removed: 'Removed',
  renewed: 'Renewed',
  requested: 'Requested',
  resent: 'Resent',
  restore: 'Restored',
  revoked: 'Revoked',
  sent: 'Sent',
  shipped: 'Shipped',
  submitted: 'Submitted',
  suggested: 'Suggested',
  update: 'Updated',
  updated: 'Updated',
  voided: 'Voided',
};

/** The ones the pattern can't say well. */
const OVERRIDES: Record<string, string> = {
  'billing.subscription.payment_failed': 'A subscription payment failed',
  'inventory.putaway.location_set': 'Set a shelf location',
  'inventory.warehouse.sells_online_changed': 'Changed whether a store sells online',
  'inventory.warehouse.products_added': 'Added products to a store',
  'inventory.warehouse.stock_settings_updated': 'Changed a product’s stock settings at a store',
  'inventory.warehouse.product_removed': 'Stopped a store carrying a product',
  'procurement.po.dropship_delivered': 'Marked a drop-shipped order delivered',
  'sales.invoice.payment_recorded': 'Recorded a payment on an invoice',
  'sales.invoice.reminded': 'Sent a reminder about an invoice',
  'sales.customer.consent_given': 'Recorded that a customer agreed to marketing',
  'sales.customer.consent_withdrawn': 'Recorded that a customer opted out of marketing',
  'sales.customer.merged': 'Merged two customer records',
  'marketing.campaign.scheduled': 'Scheduled a campaign',
  'marketing.campaign.ended': 'Ended a campaign early',
  'marketing.campaign.announcement_updated': 'Changed what a campaign tells customers',
  'marketing.campaign.collection_created': 'Made a collection from a campaign',
  'marketing.campaign.collection_synced': 'Refreshed a campaign’s collection',
  'settings.delivery_zone.suggested': 'Added the suggested delivery zones',
  'settings.organization.update': 'Updated the business details',
  'settings.storefront.updated': 'Changed the storefront’s look',
  'settings.returns.updated': 'Updated the returns policy',
  'staff.member.role_changed': 'Changed a member’s role',
  'staff.member.stores_changed': 'Changed which stores a member can work in',
};

/**
 * "Approved a purchase order". Returns null when the action is one this
 * helper has never been taught — the caller then shows the raw key rather
 * than a guess, which is how a new action makes itself noticed.
 */
export function describeAuditAction(action: string): string | null {
  const override = OVERRIDES[action];
  if (override) return override;

  const parts = action.split('.');
  if (parts.length < 2) return null;

  const verb = VERB[parts[parts.length - 1]];
  const entity = ENTITY[parts.slice(0, -1).join('.')];
  if (!verb || !entity) return null;

  return `${verb} ${entity}`;
}

/** What the table shows: the phrase, or the raw key when it is unknown. */
export function auditActionLabel(action: string): string {
  return describeAuditAction(action) ?? action;
}

/*
 * The filter offers areas of the business rather than 90 individual actions —
 * "show me what happened in Sales" is the question people actually have.
 * Each value is matched as a `startsWith` prefix on the action.
 */
export const AUDIT_AREAS = [
  { value: 'inventory', label: 'Inventory' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'sales', label: 'Sales' },
  { value: 'social', label: 'Social' },
  { value: 'staff', label: 'Members' },
  { value: 'role', label: 'Roles' },
  { value: 'settings', label: 'Settings' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'billing', label: 'Billing' },
] as const;

export type AuditArea = (typeof AUDIT_AREAS)[number]['value'];

export function isAuditArea(value: string | undefined): value is AuditArea {
  return Boolean(value) && AUDIT_AREAS.some((a) => a.value === value);
}

/** Plain words for the record type a row points at ("PurchaseOrder" → "Purchase order"). */
export function auditEntityLabel(entityType: string): string {
  const spaced = entityType.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
