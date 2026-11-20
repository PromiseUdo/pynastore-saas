'use client';

/*
 * Create or edit a delivery zone.
 *
 * A Sheet rather than a dialog: choosing states is a long list. The three kinds
 * are explained in the merchant's terms, with the matching rule stated once —
 * a customer gets the most specific zone that covers them — so "Within Port
 * Harcourt" next to "Rivers" does what the merchant expects.
 *
 * Every zone belongs to the store orders leave from (Phase 9.2): Port
 * Harcourt → Port Harcourt and Lagos → Port Harcourt are different prices.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { CheckboxRoot } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError } from '@/components/ui/form-field';
import { RadioGroup, RadioGroupCard } from '@/components/ui/radio-group';
import { SheetRoot, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { NIGERIAN_STATES, normalizePlace } from '@/lib/geo/nigeria';
import { findLga, knownAreasIn, lgasOf } from '@/lib/geo/nigeria-lgas';
import { saveDeliveryZone, type DeliveryStoreRow, type DeliveryZoneRow } from '@/features/settings/delivery';
import { StoreSelectField } from './StoreSelectField';
import { StateSelect } from '@/components/dashboard/state-select';

type Kind = DeliveryZoneRow['kind'];

const KINDS: { value: Kind; title: string; description: string }[] = [
  {
    value: 'CITIES',
    title: 'Areas (LGAs) in one state',
    description: 'For local delivery, e.g. Port Harcourt, Obio-Akpor and Eleme in Rivers.',
  },
  { value: 'STATES', title: 'Whole states', description: 'e.g. Rivers, Bayelsa and Delta.' },
  {
    value: 'NATIONWIDE',
    title: 'Rest of Nigeria',
    description: 'Everywhere your other zones don’t cover. You can have one of these.',
  },
];

export function ZoneSheet({
  open,
  onOpenChange,
  editing,
  stores,
  defaultStoreId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DeliveryZoneRow | null;
  stores: DeliveryStoreRow[];
  /** the store a new zone starts on — the section it was added from */
  defaultStoreId: string | null;
}) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = React.useState(editing?.warehouseId ?? defaultStoreId ?? '');
  const [name, setName] = React.useState(editing?.name ?? '');
  const [kind, setKind] = React.useState<Kind>(editing?.kind ?? 'CITIES');
  const [state, setState] = React.useState(editing?.state ?? '');
  const [states, setStates] = React.useState<string[]>(editing?.states ?? []);
  // An older zone's typed names are read as the LGAs they're in (ROADMAP 25.1);
  // anything that isn't one is shown, so the merchant can pick its LGA.
  const initial = React.useMemo(() => readZonePlaces(editing?.state ?? '', editing?.cities ?? []), [editing]);
  const [lgas, setLgas] = React.useState<string[]>(initial.lgas);
  const [lgaSearch, setLgaSearch] = React.useState('');
  // Neighbourhoods inside the zone's one LGA (ROADMAP 25.2); empty = the whole LGA.
  const [areas, setAreas] = React.useState((editing?.areas ?? []).join(', '));
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function toggleState(value: string, checked: boolean) {
    setStates((current) => (checked ? [...current, value] : current.filter((s) => s !== value)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    const result = await saveDeliveryZone(editing?.id ?? null, {
      warehouseId,
      name,
      kind,
      state: kind === 'CITIES' ? (state as (typeof NIGERIAN_STATES)[number]) || null : null,
      states: kind === 'STATES' ? (states as (typeof NIGERIAN_STATES)[number][]) : [],
      cities: kind === 'CITIES' ? lgas : [],
      areas: kind === 'CITIES' && lgas.length === 1 ? areas : [],
      isActive,
    });
    setPending(false);

    if (!result.success) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length) setErrors(result.fieldErrors);
      else setFormError(result.error);
      return;
    }
    toast.success(editing ? 'Zone updated' : 'Zone added — now add its delivery options');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit delivery zone' : 'Add delivery zone'}</SheetTitle>
            <SheetDescription>
              A group of places you deliver to at the same prices. A customer gets the most specific zone that covers
              their address: a city zone beats a state zone, which beats “Rest of Nigeria”.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <StoreSelectField
              id="zone-store"
              label="Delivers from"
              help="The store these orders leave from. Each store has its own zones, because the same address costs more to reach from further away."
              stores={stores}
              value={warehouseId}
              onChange={setWarehouseId}
              error={errors.warehouseId}
            />

            <Field>
              <Label htmlFor="zone-name">Zone name *</Label>
              <Input
                id="zone-name"
                autoFocus
                placeholder="e.g. Within Port Harcourt"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errors.name ? true : undefined}
              />
              {errors.name ? (
                <FieldError>{errors.name}</FieldError>
              ) : (
                <FieldDescription>Customers see this at checkout, e.g. “Delivery to Within Port Harcourt”.</FieldDescription>
              )}
            </Field>

            <Field>
              <Label id="zone-kind-label">Covers *</Label>
              <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} aria-labelledby="zone-kind-label">
                {KINDS.map((option) => (
                  <RadioGroupCard key={option.value} value={option.value} id={`zone-kind-${option.value}`} className="p-3">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                  </RadioGroupCard>
                ))}
              </RadioGroup>
              {errors.kind && <FieldError>{errors.kind}</FieldError>}
            </Field>

            {kind === 'CITIES' && (
              <>
                <Field>
                  <Label htmlFor="zone-state">State *</Label>
                  <StateSelect
                    id="zone-state"
                    value={state}
                    onChange={(next) => {
                      // LGAs belong to a state: a new state starts a new list.
                      if (next !== state) setLgas([]);
                      setState(next);
                    }}
                    invalid={Boolean(errors.state)}
                  />
                  {errors.state && <FieldError>{errors.state}</FieldError>}
                </Field>

                <LgaChecklist
                  state={state}
                  value={lgas}
                  onChange={setLgas}
                  search={lgaSearch}
                  onSearch={setLgaSearch}
                  error={errors.cities}
                  converted={initial.converted}
                  unmatched={initial.unmatched}
                />

                {/* Only part of one LGA at this price (ROADMAP 25.2). */}
                {lgas.length === 1 && (
                  <Field>
                    <Label htmlFor="zone-areas">
                      Only part of {lgas[0]}? <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="zone-areas"
                      placeholder="e.g. Bode Thomas, Ojuelegba"
                      value={areas}
                      onChange={(event) => setAreas(event.target.value)}
                      aria-invalid={errors.areas ? true : undefined}
                    />
                    {errors.areas ? (
                      <FieldError>{errors.areas}</FieldError>
                    ) : (
                      <FieldDescription>
                        List the neighbourhoods this price covers, separated by commas. Leave it empty to cover all of{' '}
                        {lgas[0]}. Customers in {lgas[0]} then pick their neighbourhood from your list, and anyone
                        elsewhere in {lgas[0]} gets the price of a zone that covers all of it.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </>
            )}

            {kind === 'STATES' && (
              <Field>
                <div className="flex items-center justify-between">
                  <Label id="zone-states-label">States *</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{states.length} chosen</span>
                </div>
                <div
                  role="group"
                  aria-labelledby="zone-states-label"
                  className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border p-3"
                >
                  {NIGERIAN_STATES.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                      <CheckboxRoot checked={states.includes(s)} onCheckedChange={(c) => toggleState(s, c === true)} />
                      {s}
                    </label>
                  ))}
                </div>
                {errors.states && <FieldError>{errors.states}</FieldError>}
              </Field>
            )}

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="zone-active">Deliver to this zone</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Turn off to pause delivery here without losing its prices.
                </p>
              </div>
              <SwitchRoot id="zone-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save zone' : 'Add zone'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </SheetRoot>
  );
}

/** An older zone's place names as LGAs: which it means, and which it can't place. */
function readZonePlaces(state: string, places: string[]) {
  const lgas: string[] = [];
  const unmatched: string[] = [];
  let converted = false;
  for (const place of places) {
    const lga = state ? findLga(state, place) : null;
    if (!lga) unmatched.push(place);
    else {
      if (lga !== place) converted = true;
      if (!lgas.includes(lga)) lgas.push(lga);
    }
  }
  return { lgas, unmatched, converted };
}

/**
 * The state's LGAs to tick (ROADMAP 25.1) — the same official list shoppers
 * pick from at checkout, so a zone and an address can't miss each other over
 * a spelling. Searching finds an LGA by its name or a well-known place in it
 * ("Lekki" finds Eti Osa).
 */
function LgaChecklist({
  state,
  value,
  onChange,
  search,
  onSearch,
  error,
  converted,
  unmatched,
}: {
  state: string;
  value: string[];
  onChange: (lgas: string[]) => void;
  search: string;
  onSearch: (search: string) => void;
  error?: string;
  /** an older zone's typed names were read as LGAs */
  converted: boolean;
  /** an older zone's names that aren't an LGA or a known place in one */
  unmatched: string[];
}) {
  const all = lgasOf(state);
  const query = normalizePlace(search);
  const shown = query
    ? all.filter(
        (lga) =>
          normalizePlace(lga).includes(query) || knownAreasIn(state, lga).some((area) => normalizePlace(area).includes(query)),
      )
    : all;
  const toggle = (lga: string, on: boolean) => onChange(on ? [...value, lga] : value.filter((l) => l !== lga));

  return (
    <Field>
      <div className="flex items-center justify-between">
        <Label id="zone-lgas-label">LGAs *</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{value.length} chosen</span>
      </div>
      {!state ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Choose the state first.</p>
      ) : (
        <>
          <Input
            type="search"
            placeholder="Search, e.g. Surulere or Lekki"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            aria-label={`Search ${state} LGAs`}
          />
          <div
            role="group"
            aria-labelledby="zone-lgas-label"
            className="grid max-h-64 grid-cols-1 gap-x-3 gap-y-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2"
          >
            {shown.map((lga) => {
              const areas = knownAreasIn(state, lga);
              return (
                <label key={lga} className="flex cursor-pointer items-start gap-2 text-sm">
                  <CheckboxRoot className="mt-0.5" checked={value.includes(lga)} onCheckedChange={(c) => toggle(lga, c === true)} />
                  <span>
                    {lga}
                    {areas.length > 0 && (
                      <span className="block text-xs text-muted-foreground">{areas.slice(0, 4).join(', ')}</span>
                    )}
                  </span>
                </label>
              );
            })}
            {shown.length === 0 && <p className="text-sm text-muted-foreground">No LGA in {state} matches “{search}”.</p>}
          </div>
        </>
      )}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>
          Customers pick their LGA from this same list at checkout, so every address in a ticked LGA gets this zone’s
          prices.
        </FieldDescription>
      )}
      {converted && (
        <p className="text-xs text-muted-foreground">
          This zone listed areas by name. They’re now ticked as the LGAs they’re in — check it’s right, then save.
        </p>
      )}
      {unmatched.length > 0 && (
        <p className="text-xs text-destructive">
          We couldn’t place {unmatched.join(', ')} in an LGA. Tick the LGA {unmatched.length === 1 ? 'it’s' : 'they’re'} in
          instead.
        </p>
      )}
    </Field>
  );
}
