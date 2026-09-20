'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MapPin, MoreHorizontal, Pencil, Plus, Search, Store, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';
import {
  createSuggestedDelivery,
  deleteDeliveryRate,
  deleteDeliveryZone,
  deletePickupLocation,
  previewDelivery,
  type DeliveryRateRow,
  type DeliverySettings,
  type DeliveryZoneRow,
  type PickupLocationRow,
} from '@/features/settings/delivery';
import { ZoneSheet } from './ZoneSheet';
import { RateDialog } from './RateDialog';
import { PickupDialog } from './PickupDialog';
import { ReturnsPolicyCard } from './ReturnsPolicyCard';

const KIND_ORDER: Record<DeliveryZoneRow['kind'], number> = { CITIES: 0, STATES: 1, NATIONWIDE: 2 };

function coverage(zone: DeliveryZoneRow): string {
  if (zone.kind === 'NATIONWIDE') return 'Everywhere in Nigeria your other zones don’t cover';
  if (zone.kind === 'STATES') return zone.states.join(', ');
  return `${zone.cities.join(', ')} (${zone.state})`;
}

function days(min: number, max: number): string {
  if (max <= 0) return 'Same day';
  return min === max ? `${min} day${min === 1 ? '' : 's'}` : `${min}–${max} days`;
}

type Removing =
  | { type: 'zone'; zone: DeliveryZoneRow }
  | { type: 'rate'; rate: DeliveryRateRow; zone: DeliveryZoneRow }
  | { type: 'pickup'; pickup: PickupLocationRow };

export function DeliverySettingsClient({ settings, canManage }: { settings: DeliverySettings; canManage: boolean }) {
  const router = useRouter();
  const { pickups } = settings;
  // Most specific first — the order checkout matches them in.
  const zones = [...settings.zones].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const [zoneSheet, setZoneSheet] = React.useState<{ open: boolean; editing: DeliveryZoneRow | null }>({ open: false, editing: null });
  const [rateDialog, setRateDialog] = React.useState<{ open: boolean; zone: DeliveryZoneRow | null; editing: DeliveryRateRow | null }>({
    open: false,
    zone: null,
    editing: null,
  });
  const [pickupDialog, setPickupDialog] = React.useState<{ open: boolean; editing: PickupLocationRow | null }>({ open: false, editing: null });
  const [removing, setRemoving] = React.useState<Removing | null>(null);
  const [pending, setPending] = React.useState(false);

  const nothingSetUp = zones.length === 0 && pickups.length === 0;
  const liveOptions =
    zones.filter((z) => z.isActive && z.rates.some((r) => r.isActive)).length + pickups.filter((p) => p.isActive).length;
  const noNationwide = !zones.some((z) => z.kind === 'NATIONWIDE' && z.isActive);

  async function suggested() {
    setPending(true);
    const result = await createSuggestedDelivery();
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Added a starting setup — check the prices match what you charge');
    router.refresh();
  }

  async function confirmRemove() {
    if (!removing) return;
    setPending(true);
    const result =
      removing.type === 'zone'
        ? await deleteDeliveryZone(removing.zone.id)
        : removing.type === 'rate'
          ? await deleteDeliveryRate(removing.rate.id)
          : await deletePickupLocation(removing.pickup.id);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Removed');
    setRemoving(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Delivery and returns"
        description="Where you deliver in Nigeria, what it costs, where customers can collect orders, and how long they have to return them."
        actions={
          canManage && !nothingSetUp ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPickupDialog({ open: true, editing: null })}>
                <Store className="size-3.5" />
                Add pickup location
              </Button>
              <Button size="sm" onClick={() => setZoneSheet({ open: true, editing: null })}>
                <Plus className="size-3.5" />
                Add delivery zone
              </Button>
            </div>
          ) : undefined
        }
      />

      <PageBody>
        {nothingSetUp ? (
          <div className="mx-auto flex max-w-xl flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Truck className="size-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-foreground">Set up delivery to start taking orders</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Customers can’t check out until you say where you deliver and what it costs. Start with your own city at a
              local price, then add the rest of Nigeria — or offer pickup from your shop.
            </p>
            {canManage ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setZoneSheet({ open: true, editing: null })}>
                  <Plus className="size-3.5" />
                  Add delivery zone
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPickupDialog({ open: true, editing: null })}>
                  <Store className="size-3.5" />
                  Add pickup location
                </Button>
                <Button variant="ghost" size="sm" onClick={suggested} disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
                  Use a starting setup
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Ask an admin to set up delivery.</p>
            )}
            {canManage && (
              <p className="mt-3 text-xs text-muted-foreground">
                The starting setup is “Rest of Nigeria” with Standard (₦3,500, 3–5 days) and Express (₦7,000, 1–2 days).
                Edit the prices before customers see them.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {liveOptions === 0 && (
              <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                Nothing is switched on, so customers can’t check out. Turn on a zone with at least one delivery option, or a
                pickup location.
              </p>
            )}

            <section aria-labelledby="zones-heading">
              <h2 id="zones-heading" className="text-sm font-semibold">
                Delivery zones
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A customer gets the most specific zone covering their address: a city zone first, then a state zone, then
                “Rest of Nigeria”.
                {noNationwide && zones.length > 0 && ' Addresses outside all your zones can’t choose delivery.'}
              </p>

              {zones.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No delivery zones yet — customers can only collect from your pickup locations.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {zones.map((zone) => (
                    <ZoneCard
                      key={zone.id}
                      zone={zone}
                      canManage={canManage}
                      onEdit={() => setZoneSheet({ open: true, editing: zone })}
                      onRemove={() => setRemoving({ type: 'zone', zone })}
                      onAddRate={() => setRateDialog({ open: true, zone, editing: null })}
                      onEditRate={(rate) => setRateDialog({ open: true, zone, editing: rate })}
                      onRemoveRate={(rate) => setRemoving({ type: 'rate', rate, zone })}
                    />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="pickups-heading">
              <h2 id="pickups-heading" className="text-sm font-semibold">
                Pickup locations
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Offered to every customer at checkout, wherever they live. Pickup is free.
              </p>
              {pickups.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No pickup locations.{' '}
                  {canManage && (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setPickupDialog({ open: true, editing: null })}
                    >
                      Add one
                    </button>
                  )}
                </p>
              ) : (
                <TableWrapper className="mt-3">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableColumnHeader>Location</TableColumnHeader>
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
                          <TableCell className="tabular-nums">{pickup.readyInDays === 0 ? 'Same day' : days(pickup.readyInDays, pickup.readyInDays)}</TableCell>
                          <TableCell>
                            <Badge variant={pickup.isActive ? 'success' : 'draft'}>{pickup.isActive ? 'On' : 'Off'}</Badge>
                          </TableCell>
                          <TableCell align="right">
                            {canManage && (
                              <RowMenu
                                label={pickup.name}
                                onEdit={() => setPickupDialog({ open: true, editing: pickup })}
                                onRemove={() => setRemoving({ type: 'pickup', pickup })}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
              )}
            </section>

            <AddressCheck />
          </div>
        )}

        <ReturnsPolicyCard returnWindowDays={settings.returnWindowDays} canManage={canManage} />
      </PageBody>

      {canManage && (
        <>
          <ZoneSheet
            key={`zone-${zoneSheet.editing?.id ?? 'new'}-${zoneSheet.open}`}
            open={zoneSheet.open}
            onOpenChange={(open) => setZoneSheet((s) => ({ ...s, open }))}
            editing={zoneSheet.editing}
          />
          <RateDialog
            key={`rate-${rateDialog.zone?.id}-${rateDialog.editing?.id ?? 'new'}-${rateDialog.open}`}
            open={rateDialog.open}
            onOpenChange={(open) => setRateDialog((s) => ({ ...s, open }))}
            zone={rateDialog.zone}
            editing={rateDialog.editing}
          />
          <PickupDialog
            key={`pickup-${pickupDialog.editing?.id ?? 'new'}-${pickupDialog.open}`}
            open={pickupDialog.open}
            onOpenChange={(open) => setPickupDialog((s) => ({ ...s, open }))}
            editing={pickupDialog.editing}
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
                    ? 'Customers in this zone will no longer be offered delivery here, and its delivery options are removed with it.'
                    : removing?.type === 'rate'
                      ? `Customers in ${removing.zone.name} will no longer see this option.`
                      : 'Customers will no longer be able to collect orders from here.'}{' '}
                  Orders already placed keep the delivery they were placed with. This can’t be undone — to pause instead,
                  switch it off.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button variant="destructive" onClick={confirmRemove} disabled={pending}>
                  {pending && <Loader2 className="size-3.5 animate-spin" />}
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
                  <TableCell className="tabular-nums">{days(rate.minDays, rate.maxDays)}</TableCell>
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
  const [result, setResult] = React.useState<{ zoneName: string | null; options: { label: string; detail: string; price: number }[] } | null>(
    null,
  );
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
      <p className="mt-0.5 text-xs text-muted-foreground">See exactly what a customer at an address would be offered at checkout.</p>

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
        <div role="status" className="mt-4 border-t pt-3 text-sm">
          <p className="text-muted-foreground">
            {result.zoneName ? (
              <>
                Matched zone: <span className="font-medium text-foreground">{result.zoneName}</span>
              </>
            ) : (
              'No delivery zone covers this address.'
            )}
          </p>
          {result.options.length === 0 ? (
            <p className="mt-2 font-medium text-destructive">This customer couldn’t check out.</p>
          ) : (
            <ul className="mt-2 divide-y">
              {result.options.map((option) => (
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
      )}
    </section>
  );
}
