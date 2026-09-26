import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditEntityLabel, describeAuditAction } from './audit-labels';

/*
 * Every action this app actually writes, collected from the createAuditLog
 * calls across features/. If someone adds a new one without teaching
 * lib/audit-labels.ts about it, this list stops matching and the test fails
 * — which is the point: a raw key must never reach a merchant's screen.
 */
const ACTIONS = [
  'billing.subscription.activated',
  'billing.subscription.canceled',
  'billing.subscription.payment_failed',
  'billing.subscription.renewed',
  'inventory.brand.created',
  'inventory.brand.deleted',
  'inventory.category.created',
  'inventory.category.deleted',
  'inventory.category.updated',
  'inventory.collection.created',
  'inventory.collection.deleted',
  'inventory.collection.updated',
  'inventory.cycle_count.cancelled',
  'inventory.cycle_count.completed',
  'inventory.cycle_count.created',
  'inventory.item.created',
  'inventory.item.updated',
  'inventory.kit.assembled',
  'inventory.kit.created',
  'inventory.putaway.location_set',
  'inventory.transfer.cancelled',
  'inventory.transfer.dispatched',
  'inventory.transfer.received',
  'inventory.warehouse.created',
  'inventory.warehouse.product_removed',
  'inventory.warehouse.products_added',
  'inventory.warehouse.sells_online_changed',
  'inventory.warehouse.stock_settings_updated',
  'inventory.warehouse.updated',
  'marketing.campaign.announcement_updated',
  'marketing.campaign.cancelled',
  'marketing.campaign.collection_created',
  'marketing.campaign.collection_synced',
  'marketing.campaign.created',
  'marketing.campaign.deleted',
  'marketing.campaign.ended',
  'marketing.campaign.scheduled',
  'procurement.po.approved',
  'procurement.po.cancelled',
  'procurement.po.created',
  'procurement.po.dropship_delivered',
  'procurement.po.ordered',
  'procurement.po.received',
  'procurement.po.rejected',
  'procurement.po.submitted',
  'procurement.supplier.created',
  'procurement.supplier.updated',
  'role.created',
  'role.deleted',
  'role.duplicated',
  'role.updated',
  'sales.customer.created',
  'sales.customer.merged',
  'sales.customer.updated',
  'sales.discount_code.delete',
  'sales.fulfillment.cancelled',
  'sales.fulfillment.packed',
  'sales.fulfillment.picked',
  'sales.fulfillment.shipped',
  'sales.invoice.created',
  'sales.invoice.issued',
  'sales.invoice.payment_recorded',
  'sales.invoice.reminded',
  'sales.invoice.sent',
  'sales.invoice.voided',
  'sales.order.created',
  'sales.order.refunded',
  'sales.order_return.approved',
  'sales.order_return.refunded',
  'sales.order_return.rejected',
  'sales.question.answer',
  'sales.question.hide',
  'sales.question.restore',
  'sales.quote.accepted',
  'sales.quote.converted',
  'sales.quote.created',
  'sales.quote.rejected',
  'sales.quote.sent',
  'sales.return.approved',
  'sales.return.rejected',
  'sales.return.requested',
  'sales.review.hide',
  'sales.review.restore',
  'settings.bank_account.delete',
  'settings.delivery_rate.delete',
  'settings.delivery_zone.delete',
  'settings.delivery_zone.suggested',
  'settings.hero_slide.deleted',
  'settings.hero_slide.updated',
  'settings.organization.update',
  'settings.pickup_location.delete',
  'settings.returns.updated',
  'settings.store_page.delete',
  'settings.storefront.updated',
  'social.connection.created',
  'social.connection.disconnected',
  'social.post.discarded',
  'social.post.published',
  'staff.invitation.accepted',
  'staff.invitation.resent',
  'staff.invitation.revoked',
  'staff.invitation.sent',
  'staff.member.removed',
  'staff.member.role_changed',
  'staff.member.stores_changed',
];

describe('describeAuditAction', () => {
  it('has words for every action the app writes', () => {
    const unknown = ACTIONS.filter((a) => describeAuditAction(a) === null);
    expect(unknown).toEqual([]);
  });

  it('never leaves a raw key or an underscore on screen', () => {
    for (const action of ACTIONS) {
      const label = auditActionLabel(action);
      expect(label).not.toContain('_');
      expect(label).not.toBe(action);
    }
  });

  it('reads as a sentence about the record', () => {
    expect(describeAuditAction('procurement.po.approved')).toBe('Approved a purchase order');
    expect(describeAuditAction('sales.invoice.voided')).toBe('Voided an invoice');
    expect(describeAuditAction('role.created')).toBe('Created a role');
  });

  it('prefers an override where the pattern reads badly', () => {
    expect(describeAuditAction('inventory.warehouse.sells_online_changed')).toBe(
      'Changed whether a store sells online',
    );
    expect(describeAuditAction('staff.member.role_changed')).toBe('Changed a member’s role');
  });

  it('returns null for something it has never been taught', () => {
    expect(describeAuditAction('nonsense.thing.happened')).toBeNull();
    expect(auditActionLabel('nonsense.thing.happened')).toBe('nonsense.thing.happened');
  });
});

describe('auditEntityLabel', () => {
  it('splits a model name into words', () => {
    expect(auditEntityLabel('PurchaseOrder')).toBe('Purchase order');
    expect(auditEntityLabel('Organization')).toBe('Organization');
  });
});
