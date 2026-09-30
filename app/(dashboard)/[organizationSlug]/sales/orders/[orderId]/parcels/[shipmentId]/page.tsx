/*
 * A packing slip for one parcel of an online order (ROADMAP Phase 9.6), for
 * the store that sends it: what goes in the box, where it's going, how it
 * travels — and, for pay on delivery, exactly what this parcel's courier
 * collects (lib/sales/parcel-collection.ts), so two riders on one order
 * don't both ask for the full amount.
 *
 * The document is the shared receipt layout; every figure is already on the
 * order.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStoreOrder } from '@/features/sales/orders';
import { getOrganizationSettings } from '@/features/settings/organization';
import { ReceiptDocument, type ReceiptFact } from '@/components/sales/receipt-document';
import { formatDate, formatMoney } from '@/lib/format';
import { formatEta, formatReady } from '@/lib/storefront/delivery/eta';

export const metadata: Metadata = { title: 'Packing slip' };

export default async function PackingSlipPage({ params }: { params: Promise<{ orderId: string; shipmentId: string }> }) {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="packing slips" />;
  }

  const { orderId, shipmentId } = await params;
  const [result, settings] = await Promise.all([getStoreOrder(orderId), getOrganizationSettings()]);
  if (!result.success) notFound();

  const order = result.data;
  const index = order.parcels.findIndex((p) => p.id === shipmentId);
  if (index < 0) notFound();
  const parcel = order.parcels[index];
  const business = settings.success ? settings.data : null;
  const money = (value: number) => formatMoney(value, order.currency);
  const pickup = parcel.kind === 'PICKUP';

  const facts: ReceiptFact[] = [
    { label: 'Order', value: order.reference },
    { label: 'Placed', value: formatDate(order.placedAt) },
    ...(order.parcels.length > 1 ? [{ label: 'Parcel', value: `${index + 1} of ${order.parcels.length}` }] : []),
    { label: pickup ? 'Collected at' : 'Sent from', value: parcel.storeName ?? '—' },
    {
      label: pickup ? 'For' : 'Deliver to',
      value: [
        order.shipFullName,
        order.shipLine1,
        order.shipLine2,
        [order.city, order.state].filter(Boolean).join(', '),
        order.shipPhone,
      ]
        .filter(Boolean)
        .join(', ') || '—',
    },
    {
      label: pickup ? 'Pickup' : 'Delivery',
      value: [parcel.label, parcel.eta ? (pickup ? formatReady(parcel.eta) : formatEta(parcel.eta)) : null].filter(Boolean).join(' · '),
    },
  ];

  const collect = order.paymentStatus === 'DUE_ON_DELIVERY' && parcel.toCollect !== null;

  return (
    <ReceiptDocument
      businessName={ctx.organization.name}
      businessAddress={business?.businessAddress ?? null}
      businessPhone={business?.supportPhone ?? null}
      title="Packing slip"
      facts={facts}
      lines={parcel.items.map((item) => ({
        name: item.name,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        total: money(item.unitPrice * item.quantity),
      }))}
      totals={[{ label: pickup ? 'Pickup charge' : 'Delivery for this parcel', value: parcel.fee === 0 ? 'Free' : money(parcel.fee) }]}
      total={
        collect
          ? { label: pickup ? 'Collect at the counter' : 'Courier collects', value: money(parcel.toCollect!) }
          : { label: 'To collect', value: 'Nothing — already paid' }
      }
      footerFacts={[
        ...(order.parcels.length > 1
          ? [{ label: 'Other parcels', value: 'This order comes in more than one parcel, from different stores.' }]
          : []),
        ...(parcel.trackingNote ? [{ label: 'Courier', value: parcel.trackingNote }] : []),
      ]}
      note={order.note}
    />
  );
}
