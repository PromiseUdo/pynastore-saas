'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MapPin, MoreHorizontal, Pencil, Plus, Search, Store, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatMoney } from '@/lib/format';
import { formatEta, formatEtaShort } from '@/lib/storefront/delivery/eta';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import { formatStorePlace } from '@/features/inventory/store-place';
import {
  confirmStoreDelivery,
  createSuggestedDelivery,
  deleteDeliveryRate,
  deleteDeliveryZone,
  deletePickupLocation,
  previewDelivery,
  type DeliveryPreview,
  type DeliveryRateRow,
  type DeliverySettings,
  type DeliveryStoreRow,
  type DeliveryZoneRow,
  type PickupLocationRow,
} from '@/features/settings/delivery';
import { ZoneSheet } from './ZoneSheet';
import { RateDialog } from './RateDialog';
import { PickupDialog } from './PickupDialog';
import { ReturnsPolicyCard } from './ReturnsPolicyCard';
import { ConsolidationCard } from './ConsolidationCard';

const KIND_ORDER: Record<DeliveryZoneRow['kind'], number> = { CITIES: 0, STATES: 1, NATIONWIDE: 2 };

function coverage(zone: DeliveryZoneRow): string {
  if (zone.kind === 'NATIONWIDE') return 'Everywhere in Nigeria your other zones don’t cover';
  if (zone.kind === 'STATES') return zone.states.join(', ');
  return `${zone.cities.join(', ')} (${zone.state})`;
}

/* The wording customers get, so the table and checkout can't drift apart. */
const rateTime = (rate: DeliveryRateRow) => formatEta({ minMinutes: rate.minMinutes, maxMinutes: rate.maxMinutes, unit: rate.etaUnit });

type Removing =
  | { type: 'zone'; zone: DeliveryZoneRow }
  | { type: 'rate'; rate: DeliveryRateRow; zone: DeliveryZoneRow }
  | { type: 'pickup'; pickup: PickupLocationRow };

/* Most specific first — the order checkout matches them in. */
const byKind = (zones: DeliveryZoneRow[]) => [...zones].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

/**
 * Settings → Delivery, one section per store (ROADMAP Phase 9.2).
 *
 * A store gets a section when it sells online or already has delivery set
 * up; a zone or pickup the migration couldn't place gets its own section
 * asking for a store. Each section states whether that store's stock is
 * actually offered online, since a store that can't deliver isn't.
 */
export function DeliverySettingsClient({ settings, canManage }: { settings: DeliverySettings; canManage: boolean }) {
  const router = useRouter();
  const { stores, zones, pickups } = settings;

  const sections = stores.filter(
    (store) =>
      (store.sellsOnline && store.open) ||
      zones.some((z) => z.warehouseId === store.id) ||
      pickups.some((p) => p.warehouseId === store.id),
  );
  const unassignedZones = byKind(zones.filter((z) => z.warehouseId === null));
  const unassignedPickups = pickups.filter((p) => p.warehouseId === null);
  // With one store in play, "add" needs no choice — every new zone is its.
  const soleStoreId = sections.length === 1 ? sections[0].id : null;

  const [zoneSheet, setZoneSheet] = React.useState<{ open: boolean; editing: DeliveryZoneRow | null; storeId: string | null }>({
    open: false,
    editing: null,
    storeId: null,
  });
  const [rateDialog, setRateDialog] = React.useState<{ open: boolean; zone: DeliveryZoneRow | null; editing: DeliveryRateRow | null }>({
    open: false,
    zone: null,
    editing: null,
  });
  const [pickupDialog, setPickupDialog] = React.useState<{ open: boolean; editing: PickupLocationRow | null; storeId: string | null }>({
    open: false,
    editing: null,
    storeId: null,
  });
  const [removing, setRemoving] = React.useState<Removing | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  const nothingSetUp = zones.length === 0 && pickups.length === 0;
  const anyStoreDelivers = stores.some((s) => s.suppliesOnline && s.hasLiveDelivery);

  const addZone = (storeId: string | null) => setZoneSheet({ open: true, editing: null, storeId: storeId ?? soleStoreId });
  const addPickup = (storeId: string | null) => setPickupDialog({ open: true, editing: null, storeId: storeId ?? soleStoreId });

  async function suggested(store: DeliveryStoreRow) {
    setPending(`suggest-${store.id}`);
    const result = await createSuggestedDelivery(store.id);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Added a starting setup for ${store.name} — check the prices match what you charge`);
    router.refresh();
  }

  async function confirmReview(store: DeliveryStoreRow) {
    setPending(`review-${store.id}`);
    const result = await confirmStoreDelivery(store.id);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Marked ${store.name}’s delivery prices as checked`);
    router.refresh();
  }

  async function confirmRemove() {
    if (!removing) return;
    setPending('remove');
    const result =
      removing.type === 'zone'
        ? await deleteDeliveryZone(removing.zone.id)
        : removing.type === 'rate'
          ? await deleteDeliveryRate(removing.rate.id)
          : await deletePickupLocation(removing.pickup.id);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Removed');
    setRemoving(null);
    router.refresh();
  }

  const zoneHandlers = (zone: DeliveryZoneRow) => ({
    onEdit: () => setZoneSheet({ open: true, editing: zone, storeId: null }),
    onRemove: () => setRemoving({ type: 'zone', zone }),
    onAddRate: () => setRateDialog({ open: true, zone, editing: null }),
    onEditRate: (rate: DeliveryRateRow) => setRateDialog({ open: true, zone, editing: rate }),
    onRemoveRate: (rate: DeliveryRateRow) => setRemoving({ type: 'rate', rate, zone }),
  });
  const pickupHandlers = {
    onEdit: (pickup: PickupLocationRow) => setPickupDialog({ open: true, editing: pickup, storeId: null }),
    onRemove: (pickup: PickupLocationRow) => setRemoving({ type: 'pickup', pickup }),
  };

  return (
    <>
      <PageHeader
        title="Delivery and returns"
        description="What it costs to send an order from each of your stores, where customers can collect, and how long they have to return things."
        actions={
          canManage && stores.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => addPickup(null)}>
                <Store className="size-3.5" />
                Add pickup location
              </Button>
              <Button size="sm" onClick={() => addZone(null)}>
                <Plus className="size-3.5" />
                Add delivery zone
              </Button>
            </div>
          ) : undefined
        }
      />

      <PageBody>
        {stores.length === 0 || sections.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={stores.length === 0 ? 'Add a store first' : 'Choose which stores sell online'}
            description={
              stores.length === 0
                ? 'Delivery is priced from the store an order leaves, so create the store you send orders from before setting prices.'
                : 'Delivery is set per store. Turn on “Sells online” for the stores your website sells from, then say where each one delivers.'
            }
            action={
              <Link href="/inventory/warehouses" className={buttonVariants({ size: 'sm' })}>
                Go to stores
              </Link>
            }
          />
        ) : (
          <div className="space-y-8">
            {nothingSetUp && (
              <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                Customers can’t check out until you say where you deliver and what it costs. Start with your own city at a
                local price, then add the rest of Nigeria — or offer pickup from your shop.
              </p>
            )}
            {!nothingSetUp && !anyStoreDelivers && (
              <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                No store that sells online has anything switched on, so customers can’t check out. Turn on a zone with at
                least one delivery option, or a pickup location.
              </p>
            )}

            {sections.map((store) => (
              <StoreSection
                key={store.id}
                store={store}
                zones={byKind(zones.filter((z) => z.warehouseId === store.id))}
                pickups={pickups.filter((p) => p.warehouseId === store.id)}
                anyStoreDelivers={anyStoreDelivers}
                canManage={canManage}
                pending={pending}
                onAddZone={() => addZone(store.id)}
                onAddPickup={() => addPickup(store.id)}
                onSuggested={() => suggested(store)}
                onConfirmReview={() => confirmReview(store)}
                zoneHandlers={zoneHandlers}
                pickupHandlers={pickupHandlers}
              />
            ))}

            {(unassignedZones.length > 0 || unassignedPickups.length > 0) && (
              <section aria-labelledby="unassigned-heading" className="space-y-3">
                <div>
                  <h2 id="unassigned-heading" className="text-sm font-semibold">
                    Not linked to a store
                  </h2>
                  <p role="status" className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    We couldn’t tell which store these belong to, so customers aren’t offered them. Edit each one and choose
                    the store orders leave from.
                  </p>
                </div>
                {unassignedZones.map((zone) => (
                  <ZoneCard key={zone.id} zone={zone} canManage={canManage} {...zoneHandlers(zone)} />
                ))}
                {unassignedPickups.length > 0 && <PickupTable pickups={unassignedPickups} canManage={canManage} {...pickupHandlers} />}
              </section>
            )}

            {!nothingSetUp && <AddressCheck />}
          </div>
        )}

        {/* Only a business with more than one store can split an order. */}
        {stores.filter((s) => s.sellsOnline).length > 1 && (
          <ConsolidationCard policy={settings.consolidation} canManage={canManage} />
        )}
        <ReturnsPolicyCard returnWindowDays={settings.returnWindowDays} canManage={canManage} />
      </PageBody>

      {canManage && (
        <>
          <ZoneSheet
            key={`zone-${zoneSheet.editing?.id ?? 'new'}-${zoneSheet.storeId}-${zoneSheet.open}`}
            open={zoneSheet.open}
            onOpenChange={(open) => setZoneSheet((s) => ({ ...s, open }))}
            editing={zoneSheet.editing}
            stores={stores}
            defaultStoreId={zoneSheet.storeId}
          />
          <RateDialog
            key={`rate-${rateDialog.zone?.id}-${rateDialog.editing?.id ?? 'new'}-${rateDialog.open}`}
            open={rateDialog.open}
            onOpenChange={(open) => setRateDialog((s) => ({ ...s, open }))}
            zone={rateDialog.zone}
            editing={rateDialog.editing}
          />
          <PickupDialog
            key={`pickup-${pickupDialog.editing?.id ?? 'new'}-${pickupDialog.storeId}-${pickupDialog.open}`}
            open={pickupDialog.open}
            onOpenChange={(open) => setPickupDialog((s) => ({ ...s, open }))}
            editing={pickupDialog.editing}
            stores={stores}
            defaultStoreId={pickupDialog.storeId}
          />
          <AlertDialogRoot open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {removing?.type === 'zone'
                    ? `Remove “${removing.zone.name}”?`
                    : removing?.type === 'rate'
                      ? `Remove “${removing.rate.name}”?`
                      : `Remove “${removing?.type === 'pickup' ? removing.pickup.name : ''}”?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {removing?.type === 'zone'
                    ? 'Customers in this zone will no longer be offered delivery from this store, and its delivery options are removed with it.'
                    : removing?.type === 'rate'
                      ? `Customers in ${removing.zone.name} will no longer see this option.`
                      : 'Customers will no longer be able to collect orders from here.'}{' '}
                  Orders already placed keep the delivery they were placed with. This can’t be undone — to pause instead,
                  switch it off.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button variant="destructive" onClick={confirmRemove} disabled={pending === 'remove'}>
                  {pending === 'remove' && <Loader2 className="size-3.5 animate-spin" />}
                  Remove
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogRoot>
        </>
      )}
    </>
  );
}

type ZoneHandlers = {
  onEdit: () => void;
  onRemove: () => void;
  onAddRate: () => void;
  onEditRate: (rate: DeliveryRateRow) => void;
  onRemoveRate: (rate: DeliveryRateRow) => void;
};

type PickupHandlers = { onEdit: (pickup: PickupLocationRow) => void; onRemove: (pickup: PickupLocationRow) => void };

/** One store's delivery: its state, its zones, its pickup points. */
function StoreSection({
  store,
  zones,
  pickups,
  anyStoreDelivers,
  canManage,
  pending,
  onAddZone,
  onAddPickup,
  onSuggested,
  onConfirmReview,
  zoneHandlers,
  pickupHandlers,
}: {
  store: DeliveryStoreRow;
  zones: DeliveryZoneRow[];
  pickups: PickupLocationRow[];
  anyStoreDelivers: boolean;
  canManage: boolean;
  pending: string | null;
  onAddZone: () => void;
  onAddPickup: () => void;
  onSuggested: () => void;
  onConfirmReview: () => void;
  zoneHandlers: (zone: DeliveryZoneRow) => ZoneHandlers;
  pickupHandlers: PickupHandlers;
}) {
  const headingId = `store-${store.id}-heading`;
  const place = formatStorePlace(store);
  const empty = zones.length === 0 && pickups.length === 0;
  const noNationwide = !zones.some((z) => z.kind === 'NATIONWIDE' && z.isActive);
  // Left out of online stock because another store can deliver and this one can't.
  const heldBack = store.sellsOnline && store.open && !store.suppliesOnline;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-sm font-semibold">
              From {store.name}
            </h2>
            {!store.open ? (
              <Badge variant="muted">Closed</Badge>
            ) : store.sellsOnline ? (
              <Badge variant={store.suppliesOnline ? 'info' : 'warning'}>
                {store.suppliesOnline ? 'Sells online' : 'Not selling yet'}
              </Badge>
            ) : (
              <Badge variant="muted">Not selling online</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {place ? `Orders leave from ${place}.` : 'Add this store’s city and state on the Stores page.'}{' '}
            A customer gets the most specific zone covering their address: a city zone first, then a state zone, then
            “Rest of Nigeria”.
            {noNationwide && zones.length > 0 && ' Addresses outside all of these zones can’t choose delivery from here.'}
          </p>
        </div>
        {canManage && !empty && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onAddPickup}>
              <Store className="size-3.5" />
              Add pickup
            </Button>
            <Button variant="outline" size="sm" onClick={onAddZone}>
              <Plus className="size-3.5" />
              Add zone
            </Button>
          </div>
        )}
      </div>

      {store.needsReview && (
        <div
          role="status"
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <p>
            <span className="font-medium">Check these prices.</span> Delivery is now set per store, and {store.name} was
            given a copy of your earlier prices. Sending from here may cost more or less — edit anything that’s wrong, then
            confirm.
          </p>
          {canManage && (
            <Button size="sm" variant="outline" onClick={onConfirmReview} disabled={pending === `review-${store.id}`}>
              {pending === `review-${store.id}` && <Loader2 className="size-3.5 animate-spin" />}
              Prices are right
            </Button>
          )}
        </div>
      )}

      {heldBack && anyStoreDelivers && (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {store.name}’s stock isn’t offered online yet, because it has no way to send orders. Add a zone with a delivery
          option, or a pickup location.
        </p>
      )}

      {empty ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-8 text-center">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Truck className="size-4" />
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">No delivery from {store.name} yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Say where orders from this store can go and what that costs, or let customers collect.
          </p>
          {canManage ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={onAddZone}>
                <Plus className="size-3.5" />
                Add delivery zone
              </Button>
              <Button variant="outline" size="sm" onClick={onAddPickup}>
                <Store className="size-3.5" />
                Add pickup location
              </Button>
              <Button variant="ghost" size="sm" onClick={onSuggested} disabled={pending === `suggest-${store.id}`}>
                {pending === `suggest-${store.id}` && <Loader2 className="size-3.5 animate-spin" />}
                Use a starting setup
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Ask an admin to set up delivery.</p>
          )}
          {canManage && (
            <p className="mt-3 max-w-md text-xs text-muted-foreground">
              The starting setup is “Rest of Nigeria” with Standard (₦3,500, 3–5 days) and Express (₦7,000, 1–2 days).
              Edit the prices before customers see them.
            </p>
          )}
        </div>
      ) : (
        <>
          {zones.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
              No delivery zones — customers can only collect this store’s stock.
            </p>
          ) : (
            <div className="space-y-3">
              {zones.map((zone) => (
                <ZoneCard key={zone.id} zone={zone} canManage={canManage} {...zoneHandlers(zone)} />
              ))}
            </div>
          )}
          {pickups.length > 0 && <PickupTable pickups={pickups} canManage={canManage} {...pickupHandlers} />}
        </>
      )}
    </section>
  );
}

function PickupTable({ pickups, canManage, onEdit, onRemove }: { pickups: PickupLocationRow[]; canManage: boolean } & PickupHandlers) {
  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Pickup location</TableColumnHeader>
            <TableColumnHeader>Ready after</TableColumnHeader>
            <TableColumnHeader>Status</TableColumnHeader>
            <TableColumnHeader>
              <span className="sr-only">Actions</span>
            </TableColumnHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {pickups.map((pickup) => (
            <TableRow key={pickup.id}>
              <TableCell>
                <span className="block font-medium text-foreground">{pickup.name}</span>
                <span className="text-xs text-muted-foreground">
                  {pickup.address}, {pickup.city}, {pickup.state}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">
                {formatEtaShort({ minMinutes: pickup.readyMinutes, maxMinutes: pickup.readyMinutes, unit: pickup.readyUnit })}
              </TableCell>
              <TableCell>
                <Badge variant={pickup.isActive ? 'success' : 'draft'}>{pickup.isActive ? 'On' : 'Off'}</Badge>
              </TableCell>
              <TableCell align="right">
                {canManage && <RowMenu label={pickup.name} onEdit={() => onEdit(pickup)} onRemove={() => onRemove(pickup)} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function RowMenu({ label, onEdit, onRemove }: { label: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <DropdownMenuRoot>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          <Trash2 />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  );
}

function ZoneCard({
  zone,
  canManage,
  onEdit,
  onRemove,
  onAddRate,
  onEditRate,
  onRemoveRate,
}: {
  zone: DeliveryZoneRow;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onAddRate: () => void;
  onEditRate: (rate: DeliveryRateRow) => void;
  onRemoveRate: (rate: DeliveryRateRow) => void;
}) {
  const live = zone.isActive && zone.rates.some((r) => r.isActive);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{zone.name}</h3>
            <Badge variant={live ? 'success' : 'draft'}>
              {!zone.isActive ? 'Off' : zone.rates.some((r) => r.isActive) ? 'On' : 'No options yet'}
            </Badge>
          </div>
          <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
            {coverage(zone)}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onAddRate}>
              <Plus className="size-3.5" />
              Add option
            </Button>
            <RowMenu label={zone.name} onEdit={onEdit} onRemove={onRemove} />
          </div>
        )}
      </div>

      {zone.rates.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No delivery options yet, so customers here can’t choose delivery. Add one — for example “Standard”.
        </p>
      ) : (
        <TableWrapper className="rounded-none border-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Option</TableColumnHeader>
                <TableColumnHeader align="right">Price</TableColumnHeader>
                <TableColumnHeader>Delivery time</TableColumnHeader>
                <TableColumnHeader align="right">Free over</TableColumnHeader>
                <TableColumnHeader>
                  <span className="sr-only">Actions</span>
                </TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {zone.rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell>
                    <span className="font-medium text-foreground">{rate.name}</span>
                    {!rate.isActive && (
                      <Badge variant="draft" className="ml-2">
                        Off
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {rate.price === 0 ? 'Free' : formatMoney(rate.price)}
                  </TableCell>
                  <TableCell className="tabular-nums">{rateTime(rate)}</TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {rate.freeOver === null ? '—' : formatMoney(rate.freeOver)}
                  </TableCell>
                  <TableCell align="right">
                    {canManage && <RowMenu label={rate.name} onEdit={() => onEditRate(rate)} onRemove={() => onRemoveRate(rate)} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}

/** "What would a customer here see?" — runs the same matching checkout uses. */
function AddressCheck() {
  const [state, setState] = React.useState('');
  const [city, setCity] = React.useState('');
  const [subtotal, setSubtotal] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<DeliveryPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (!state) {
      setError('Choose a state');
      return;
    }
    setPending(true);
    setError(null);
    const response = await previewDelivery({ state, city, subtotal: subtotal ? Number(subtotal.replace(/,/g, '')) : 0 });
    setPending(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setResult(response.data);
  }

  return (
    <section aria-labelledby="check-heading" className="rounded-lg border bg-card p-4">
      <h2 id="check-heading" className="text-sm font-semibold">
        Check an address
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        See exactly what a customer at an address would be offered at checkout, and what each store would charge.
      </p>

      <form onSubmit={check} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="check-state">State</Label>
          <SelectRoot value={state} onValueChange={setState}>
            <SelectTrigger id="check-state">
              <SelectValue placeholder="Choose a state" />
            </SelectTrigger>
            <SelectContent>
              {NIGERIAN_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="check-city">City</Label>
          <Input id="check-city" placeholder="e.g. Port Harcourt" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="check-subtotal">Items total (₦)</Label>
          <Input id="check-subtotal" inputMode="decimal" placeholder="0" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending} className="h-9">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          Check
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {result && (
        <div role="status" className="mt-4 space-y-4 border-t pt-3 text-sm">
          <PreviewBlock
            title="At checkout"
            note={
              result.stores.length > 1 && result.checkout.storeName
                ? `When every store has the items, the order is sent from the store that’s cheapest to deliver from — here, ${result.checkout.storeName}. If only one store has everything, it goes from there at that store’s price; a bag split between stores pays each store’s delivery.`
                : null
            }
            zoneName={result.checkout.zoneName}
            options={result.checkout.options}
            emptyText="This customer couldn’t check out."
          />
          {result.stores.length > 1 &&
            result.stores.map((store) => (
              <PreviewBlock
                key={store.storeId}
                title={`From ${store.storeName}`}
                note={null}
                zoneName={store.zoneName}
                options={store.options}
                emptyText="Nothing from this store for this address."
              />
            ))}
        </div>
      )}
    </section>
  );
}

function PreviewBlock({
  title,
  note,
  zoneName,
  options,
  emptyText,
}: {
  title: string;
  note: string | null;
  zoneName: string | null;
  options: { label: string; detail: string; price: number }[];
  emptyText: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <p className="mt-1 text-muted-foreground">
        {zoneName ? (
          <>
            Matched zone: <span className="font-medium text-foreground">{zoneName}</span>
          </>
        ) : (
          'No delivery zone covers this address.'
        )}
      </p>
      {options.length === 0 ? (
        <p className="mt-2 font-medium text-destructive">{emptyText}</p>
      ) : (
        <ul className="mt-2 divide-y">
          {options.map((option) => (
            <li key={option.label + option.detail} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.detail}</span>
              </span>
              <span className="tabular-nums">{option.price === 0 ? 'Free' : formatMoney(option.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
