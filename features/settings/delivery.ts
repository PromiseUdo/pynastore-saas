'use server';

/*
 * features/settings/delivery.ts
 *
 * The merchant's delivery setup: zones (where they deliver), the rates inside
 * each zone (what it costs and how long it takes), and pickup locations.
 * Checkout quotes from exactly this (lib/storefront/delivery/).
 *
 * PER STORE (ROADMAP Phase 9.2). Every zone and pickup belongs to the store
 * a parcel leaves from, because the same address costs a different amount
 * from Lagos than from Port Harcourt. The store id always arrives from the
 * form and is only ever used together with the organization's id, so another
 * business's store is a miss, not a leak.
 *
 * Nigeria only for now. A zone covers named cities in one state, whole
 * states, or the rest of Nigeria; the most specific zone covering an address
 * wins. Saving refuses overlaps that would make that ambiguous — within one
 * store: the same state in two state zones, the same city in two city zones,
 * or a second "rest of Nigeria" zone — and says which zone already has it.
 * Two stores covering the same place is the point, not an overlap.
 *
 * It also holds the return window — how long after delivery a customer can
 * ask to send items back (lib/storefront/orders/policy.ts). It lives with
 * delivery because it is the same kind of promise, shown in the same panel
 * on every product page.
 *
 * Viewing needs `settings.view`; changing needs `settings.edit`.
 * Money arrives and leaves in MAJOR units (naira), like the rest of the admin.
 */
import { z } from 'zod';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getOrganizationContext } from '@/lib/organization';
import { requirePermission, PERMISSIONS } from '@/lib/permissions';
import { createAuditLog } from '@/lib/audit';
import { NIGERIAN_STATES, normalizePlace, parsePlaceList } from '@/lib/geo/nigeria';
import { quoteEachStore, type StoreDeliverySetup } from '@/lib/storefront/delivery/match';
import { planWithAnyStock } from '@/lib/storefront/delivery/plan';
import { HAS_LIVE_DELIVERY_WHERE, ONLINE_SUPPLY_WHERE } from '@/lib/storefront/delivery/supply';
import { ETA_UNITS, toMinutes, type DeliveryEtaUnit } from '@/lib/storefront/delivery/eta';
import { MAX_RETURN_WINDOW_DAYS } from '@/lib/storefront/orders/policy';

type Result<T = void> = { success: true; data: T } | { success: false; error: string; fieldErrors?: Record<string, string> };

/* ---------------- reading ---------------- */

export interface DeliveryRateRow {
  id: string;
  name: string;
  price: number;
  /** the window in minutes, said in `etaUnit` — see lib/storefront/delivery/eta.ts */
  minMinutes: number;
  maxMinutes: number;
  etaUnit: DeliveryEtaUnit;
  freeOver: number | null;
  isActive: boolean;
}

export interface DeliveryZoneRow {
  id: string;
  /** the store orders leave from; null only for one the migration couldn't place */
  warehouseId: string | null;
  name: string;
  kind: 'CITIES' | 'STATES' | 'NATIONWIDE';
  state: string | null;
  states: string[];
  cities: string[];
  isActive: boolean;
  rates: DeliveryRateRow[];
}

export interface PickupLocationRow {
  id: string;
  /** the store whose stock is collected here; null only for one the migration couldn't place */
  warehouseId: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  instructions: string | null;
  readyMinutes: number;
  readyUnit: DeliveryEtaUnit;
  price: number;
  isActive: boolean;
}

/** A store, as the delivery page needs it: who it is, and whether it can send online orders. */
export interface DeliveryStoreRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  open: boolean;
  sellsOnline: boolean;
  /** has a switched-on zone with a switched-on option, or a switched-on pickup */
  hasLiveDelivery: boolean;
  /** its stock is offered online right now (lib/storefront/delivery/supply.ts) */
  suppliesOnline: boolean;
  /** prices were copied from another store's and nobody has confirmed them */
  needsReview: boolean;
}

export interface DeliverySettings {
  /** every store in the business, oldest first */
  stores: DeliveryStoreRow[];
  zones: DeliveryZoneRow[];
  pickups: PickupLocationRow[];
  /** null: the store doesn't take returns through the website */
  returnWindowDays: number | null;
  /** a bag no single store holds: bring it to one store first? (ROADMAP Phase 9.7) */
  consolidation: { enabled: boolean; fee: number; leadMinutes: number; leadUnit: DeliveryEtaUnit };
}

const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

function failure(error: unknown, fallback: string): { success: false; error: string } {
  if (error instanceof Error && error.name === 'PermissionDeniedError') {
    return { success: false, error: 'You don’t have permission to change delivery settings' };
  }
  console.error(`[settings/delivery] ${fallback}:`, error);
  return { success: false, error: fallback };
}

async function context(permission: 'view' | 'edit') {
  const ctx = await getOrganizationContext();
  requirePermission(
    ctx.membership.role.permissions,
    permission === 'view' ? PERMISSIONS.SETTINGS_VIEW : PERMISSIONS.SETTINGS_EDIT,
  );
  return ctx;
}

/** The store a zone or pickup names, if it's this business's. */
async function ownStore(organizationId: string, warehouseId: string) {
  return prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId }, select: { id: true, name: true } });
}

const NO_STORE = { success: false as const, error: 'That store no longer exists', fieldErrors: { warehouseId: 'Choose a store' } };

async function loadSettings(organizationId: string): Promise<DeliverySettings> {
  const [stores, live, supplying, zones, pickups, organization] = await Promise.all([
    prisma.warehouse.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, city: true, state: true, status: true, sellsOnline: true, deliveryNeedsReview: true },
    }),
    prisma.warehouse.findMany({ where: { organizationId, ...HAS_LIVE_DELIVERY_WHERE }, select: { id: true } }),
    prisma.warehouse.findMany({ where: { organizationId, ...ONLINE_SUPPLY_WHERE }, select: { id: true } }),
    prisma.deliveryZone.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { rates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    }),
    prisma.pickupLocation.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        returnWindowDays: true,
        consolidateOrders: true,
        consolidationFee: true,
        consolidationLeadMinutes: true,
        consolidationLeadUnit: true,
      },
    }),
  ]);

  const liveIds = new Set(live.map((w) => w.id));
  const supplyingIds = new Set(supplying.map((w) => w.id));

  return {
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      city: store.city,
      state: store.state,
      open: store.status === 'ACTIVE',
      sellsOnline: store.sellsOnline,
      hasLiveDelivery: liveIds.has(store.id),
      suppliesOnline: supplyingIds.has(store.id),
      needsReview: store.deliveryNeedsReview,
    })),
    zones: zones.map((zone) => ({
      id: zone.id,
      warehouseId: zone.warehouseId,
      name: zone.name,
      kind: zone.kind,
      state: zone.state,
      states: zone.states,
      cities: zone.cities,
      isActive: zone.isActive,
      rates: zone.rates.map((rate) => ({
        id: rate.id,
        name: rate.name,
        price: Number(rate.price),
        minMinutes: rate.minMinutes,
        maxMinutes: rate.maxMinutes,
        etaUnit: rate.etaUnit,
        freeOver: num(rate.freeOver),
        isActive: rate.isActive,
      })),
    })),
    pickups: pickups.map((p) => ({
      id: p.id,
      warehouseId: p.warehouseId,
      name: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      instructions: p.instructions,
      readyMinutes: p.readyMinutes,
      readyUnit: p.readyUnit,
      price: Number(p.price),
      isActive: p.isActive,
    })),
    returnWindowDays: organization?.returnWindowDays ?? null,
    consolidation: {
      enabled: organization?.consolidateOrders ?? false,
      fee: Number(organization?.consolidationFee ?? 0),
      leadMinutes: organization?.consolidationLeadMinutes ?? 1440,
      leadUnit: organization?.consolidationLeadUnit ?? 'DAYS',
    },
  };
}

/* ---------------- returns ---------------- */

/**
 * Turn online returns on (with a window in days) or off. Takes effect at
 * once: product pages quote the new window, and a delivered order whose new
 * deadline has already passed can no longer take a request. Requests already
 * made are untouched.
 */
export async function saveReturnPolicy(input: { enabled: boolean; days: number }): Promise<Result<void>> {
  try {
    const ctx = await context('edit');
    let days: number | null = null;
    if (input.enabled) {
      days = Number(input.days);
      if (!Number.isInteger(days) || days < 1 || days > MAX_RETURN_WINDOW_DAYS) {
        return {
          success: false,
          error: 'Check the number of days',
          fieldErrors: { days: `Enter a whole number of days from 1 to ${MAX_RETURN_WINDOW_DAYS}.` },
        };
      }
    }

    await prisma.organization.update({ where: { id: ctx.organization.id }, data: { returnWindowDays: days } });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.returns.updated',
      entityType: 'Organization',
      entityId: ctx.organization.id,
      metadata: { returnWindowDays: days },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'Couldn’t save your returns policy');
  }
}

/**
 * A bag no single store holds (ROADMAP Phase 9.7): send each store's part as
 * its own parcel (the default), or bring it to one store first — for `fee`
 * (naira) per store items come from, and `leadTime` more in `leadUnit`.
 * Takes effect for the next quote; orders already placed keep their plan.
 */
export async function saveConsolidationPolicy(input: {
  enabled: boolean;
  fee: number | string;
  leadTime: number | string;
  leadUnit: DeliveryEtaUnit;
}): Promise<Result<void>> {
  try {
    const ctx = await context('edit');
    const parsed = z
      .object({
        enabled: z.boolean(),
        fee: money('a fee'),
        leadUnit: etaUnitEnum,
        leadTime: etaAmount,
      })
      .superRefine((v, c) => checkEtaAmount(c, v.leadUnit, v.leadTime, 'leadTime'))
      .safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const { enabled, fee, leadTime, leadUnit } = parsed.data;

    await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: {
        consolidateOrders: enabled,
        consolidationFee: fee,
        consolidationLeadMinutes: toMinutes(leadTime, leadUnit),
        consolidationLeadUnit: leadUnit,
      },
    });
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery.consolidation_updated',
      entityType: 'Organization',
      entityId: ctx.organization.id,
      metadata: { enabled, fee, leadTime, leadUnit },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save how split orders are sent');
  }
}

export async function getDeliverySettings(): Promise<Result<DeliverySettings>> {
  try {
    const ctx = await context('view');
    return { success: true, data: await loadSettings(ctx.organization.id) };
  } catch (error) {
    return failure(error, 'We couldn’t load your delivery settings');
  }
}

/* ---------------- zones ---------------- */

const stateEnum = z.enum(NIGERIAN_STATES, { error: 'Choose a Nigerian state' });

const ZoneSchema = z
  .object({
    // Length is checked in superRefine below, so every problem is reported in
    // one go — zod skips refinements when a plain field check fails first.
    name: z.string().trim(),
    warehouseId: z.string({ error: 'Choose the store orders leave from' }).trim().min(1, 'Choose the store orders leave from'),
    kind: z.enum(['CITIES', 'STATES', 'NATIONWIDE']),
    state: stateEnum.nullish(),
    states: z.array(stateEnum).default([]),
    cities: z.union([z.string(), z.array(z.string())]).default([]),
    isActive: z.boolean().default(true),
  })
  .transform((zone) => ({ ...zone, cities: parsePlaceList(zone.cities) }))
  .superRefine((zone, ctx) => {
    if (zone.name.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Give the zone a name customers will recognise' });
    } else if (zone.name.length > 60) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Keep the name under 60 characters' });
    }
    if (zone.kind === 'CITIES') {
      if (!zone.state) ctx.addIssue({ code: 'custom', path: ['state'], message: 'Choose the state these cities are in' });
      if (zone.cities.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['cities'], message: 'Add at least one city or area' });
      }
    }
    if (zone.kind === 'STATES' && zone.states.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['states'], message: 'Choose at least one state' });
    }
  });

export type DeliveryZoneInput = z.input<typeof ZoneSchema>;

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** The overlap that would make matching ambiguous, described for the merchant. */
async function overlap(
  organizationId: string,
  zoneId: string | null,
  zone: { warehouseId: string; kind: string; state?: string | null; states: string[]; cities: string[] },
): Promise<{ field: string; message: string } | null> {
  // Within one store only: two stores both covering Rivers is the point.
  const others = await prisma.deliveryZone.findMany({
    where: {
      organizationId,
      warehouseId: zone.warehouseId,
      kind: zone.kind as 'CITIES' | 'STATES' | 'NATIONWIDE',
      ...(zoneId ? { NOT: { id: zoneId } } : {}),
    },
    select: { name: true, state: true, states: true, cities: true },
  });

  if (zone.kind === 'NATIONWIDE' && others.length) {
    return { field: 'kind', message: `“${others[0].name}” already covers the rest of Nigeria. Edit that zone instead.` };
  }
  if (zone.kind === 'STATES') {
    for (const other of others) {
      const shared = zone.states.filter((s) => other.states.includes(s));
      if (shared.length) {
        return { field: 'states', message: `${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} already in “${other.name}”.` };
      }
    }
  }
  if (zone.kind === 'CITIES') {
    const mine = new Map(zone.cities.map((c) => [normalizePlace(c), c]));
    for (const other of others.filter((o) => o.state === zone.state)) {
      const shared = other.cities.map(normalizePlace).filter((c) => mine.has(c)).map((c) => mine.get(c)!);
      if (shared.length) {
        return { field: 'cities', message: `${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} already in “${other.name}”.` };
      }
    }
  }
  return null;
}

export async function saveDeliveryZone(zoneId: string | null, input: DeliveryZoneInput): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context('edit');
    const parsed = ZoneSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const zone = parsed.data;
    const store = await ownStore(ctx.organization.id, zone.warehouseId);
    if (!store) return NO_STORE;
    const data = {
      warehouseId: store.id,
      name: zone.name,
      kind: zone.kind,
      state: zone.kind === 'CITIES' ? zone.state ?? null : null,
      states: zone.kind === 'STATES' ? zone.states : [],
      cities: zone.kind === 'CITIES' ? zone.cities : [],
      isActive: zone.isActive,
    };

    const clash = await overlap(ctx.organization.id, zoneId, data);
    if (clash) return { success: false, error: clash.message, fieldErrors: { [clash.field]: clash.message } };

    let id: string;
    if (zoneId) {
      const updated = await prisma.deliveryZone.updateMany({ where: { id: zoneId, organizationId: ctx.organization.id }, data });
      if (!updated.count) return { success: false, error: 'That zone no longer exists' };
      id = zoneId;
    } else {
      const count = await prisma.deliveryZone.count({ where: { organizationId: ctx.organization.id, warehouseId: store.id } });
      id = (await prisma.deliveryZone.create({ data: { ...data, organizationId: ctx.organization.id, sortOrder: count }, select: { id: true } })).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: zoneId ? 'settings.delivery_zone.update' : 'settings.delivery_zone.create',
      entityType: 'DeliveryZone',
      entityId: id,
      metadata: { name: data.name, kind: data.kind, warehouseId: store.id, store: store.name },
    });
    return { success: true, data: { id } };
  } catch (error) {
    return failure(error, 'We couldn’t save this zone');
  }
}

export async function deleteDeliveryZone(zoneId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const deleted = await prisma.deliveryZone.deleteMany({ where: { id: zoneId, organizationId: ctx.organization.id } });
    if (!deleted.count) return { success: false, error: 'That zone no longer exists' };
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery_zone.delete',
      entityType: 'DeliveryZone',
      entityId: zoneId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove this zone');
  }
}

/* ---------------- rates ---------------- */

const money = (label: string) =>
  z.coerce
    .number({ error: `Enter ${label}` })
    .min(0, `${label[0].toUpperCase()}${label.slice(1)} can’t be negative`)
    .max(10_000_000, `That ${label} looks too high`);

/*
 * Delivery time. A merchant measures it in whatever unit fits their trade —
 * a supermarket runs in minutes, a rider in hours, a wholesaler in working
 * days — so the form takes a number in a unit and we keep both the minutes
 * and the unit (lib/storefront/delivery/eta.ts). 0 to 0 means same day.
 */
const ETA_MAX: Record<DeliveryEtaUnit, number> = { MINUTES: 1440, HOURS: 72, DAYS: 60 };
const ETA_NOUN: Record<DeliveryEtaUnit, string> = { MINUTES: 'minutes', HOURS: 'hours', DAYS: 'days' };

const etaUnitEnum = z.enum(ETA_UNITS, { error: 'Choose minutes, hours or days' });

const etaAmount = z.coerce.number().int('Use whole numbers').min(0, 'This can’t be negative');

function checkEtaAmount(ctx: z.RefinementCtx, unit: DeliveryEtaUnit, value: number, path: string) {
  if (value > ETA_MAX[unit]) {
    ctx.addIssue({ code: 'custom', path: [path], message: `Keep it under ${ETA_MAX[unit]} ${ETA_NOUN[unit]}` });
  }
}

const RateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name this option, e.g. Standard or Same day').max(40, 'Keep the name under 40 characters'),
    price: money('a price'),
    etaUnit: etaUnitEnum.default('DAYS'),
    minTime: etaAmount,
    maxTime: etaAmount,
    freeOver: z
      .union([z.literal(''), z.null(), money('an amount')])
      .transform((v) => (v === '' || v === null ? null : v))
      .default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((rate, ctx) => {
    checkEtaAmount(ctx, rate.etaUnit, rate.minTime, 'minTime');
    checkEtaAmount(ctx, rate.etaUnit, rate.maxTime, 'maxTime');
    if (rate.maxTime < rate.minTime) {
      ctx.addIssue({ code: 'custom', path: ['maxTime'], message: 'Must be the same as or more than the fastest time' });
    }
  });

export type DeliveryRateInput = z.input<typeof RateSchema>;

export async function saveDeliveryRate(zoneId: string, rateId: string | null, input: DeliveryRateInput): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context('edit');
    const parsed = RateSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const zone = await prisma.deliveryZone.findFirst({ where: { id: zoneId, organizationId: ctx.organization.id }, select: { id: true } });
    if (!zone) return { success: false, error: 'That zone no longer exists' };

    const { minTime, maxTime, etaUnit, ...rest } = parsed.data;
    const data = {
      ...rest,
      zoneId,
      etaUnit,
      minMinutes: toMinutes(minTime, etaUnit),
      maxMinutes: toMinutes(maxTime, etaUnit),
    };
    let id: string;
    if (rateId) {
      const updated = await prisma.deliveryRate.updateMany({ where: { id: rateId, organizationId: ctx.organization.id }, data });
      if (!updated.count) return { success: false, error: 'That delivery option no longer exists' };
      id = rateId;
    } else {
      const count = await prisma.deliveryRate.count({ where: { zoneId } });
      id = (await prisma.deliveryRate.create({ data: { ...data, organizationId: ctx.organization.id, sortOrder: count }, select: { id: true } })).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: rateId ? 'settings.delivery_rate.update' : 'settings.delivery_rate.create',
      entityType: 'DeliveryRate',
      entityId: id,
      metadata: { name: data.name, price: data.price },
    });
    return { success: true, data: { id } };
  } catch (error) {
    return failure(error, 'We couldn’t save this delivery option');
  }
}

export async function deleteDeliveryRate(rateId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const deleted = await prisma.deliveryRate.deleteMany({ where: { id: rateId, organizationId: ctx.organization.id } });
    if (!deleted.count) return { success: false, error: 'That delivery option no longer exists' };
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery_rate.delete',
      entityType: 'DeliveryRate',
      entityId: rateId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove this delivery option');
  }
}

/* ---------------- pickup locations ---------------- */

const PickupSchema = z
  .object({
  name: z.string().trim().min(2, 'Name this location, e.g. Main shop').max(60, 'Keep the name under 60 characters'),
  warehouseId: z.string({ error: 'Choose the store whose stock is collected here' }).trim().min(1, 'Choose the store whose stock is collected here'),
  address: z.string().trim().min(5, 'Enter the street address').max(200, 'Keep the address under 200 characters'),
  city: z.string().trim().min(2, 'Enter the city or town').max(80),
  state: stateEnum,
  instructions: z
    .string()
    .trim()
    .max(200, 'Keep instructions under 200 characters')
    .transform((v) => v || null)
    .nullish(),
  readyUnit: etaUnitEnum.default('DAYS'),
  readyTime: etaAmount,
  isActive: z.boolean().default(true),
}).superRefine((pickup, ctx) => {
  checkEtaAmount(ctx, pickup.readyUnit, pickup.readyTime, 'readyTime');
});

export type PickupLocationInput = z.input<typeof PickupSchema>;

export async function savePickupLocation(pickupId: string | null, input: PickupLocationInput): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context('edit');
    const parsed = PickupSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const { readyTime, readyUnit, ...rest } = parsed.data;
    const store = await ownStore(ctx.organization.id, rest.warehouseId);
    if (!store) return NO_STORE;
    const data = {
      ...rest,
      warehouseId: store.id,
      instructions: parsed.data.instructions ?? null,
      readyUnit,
      readyMinutes: toMinutes(readyTime, readyUnit),
    };

    let id: string;
    if (pickupId) {
      const updated = await prisma.pickupLocation.updateMany({ where: { id: pickupId, organizationId: ctx.organization.id }, data });
      if (!updated.count) return { success: false, error: 'That pickup location no longer exists' };
      id = pickupId;
    } else {
      id = (await prisma.pickupLocation.create({ data: { ...data, organizationId: ctx.organization.id }, select: { id: true } })).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: pickupId ? 'settings.pickup_location.update' : 'settings.pickup_location.create',
      entityType: 'PickupLocation',
      entityId: id,
      metadata: { name: data.name, city: data.city, warehouseId: store.id, store: store.name },
    });
    return { success: true, data: { id } };
  } catch (error) {
    return failure(error, 'We couldn’t save this pickup location');
  }
}

export async function deletePickupLocation(pickupId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const deleted = await prisma.pickupLocation.deleteMany({ where: { id: pickupId, organizationId: ctx.organization.id } });
    if (!deleted.count) return { success: false, error: 'That pickup location no longer exists' };
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.pickup_location.delete',
      entityType: 'PickupLocation',
      entityId: pickupId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t remove this pickup location');
  }
}

/* ---------------- helpers for the page ---------------- */

/**
 * A starting point for a store with nothing set up: one "rest of Nigeria"
 * zone with Standard and Express. Every figure is the merchant's to edit —
 * the page says so — and it refuses to run once that store has any zone.
 */
export async function createSuggestedDelivery(warehouseId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const store = await ownStore(ctx.organization.id, String(warehouseId ?? ''));
    if (!store) return NO_STORE;
    const existing = await prisma.deliveryZone.count({ where: { organizationId: ctx.organization.id, warehouseId: store.id } });
    if (existing) return { success: false, error: `${store.name} already has delivery zones. Edit them instead.` };

    await prisma.deliveryZone.create({
      data: {
        organizationId: ctx.organization.id,
        warehouseId: store.id,
        name: 'Nigeria',
        kind: 'NATIONWIDE',
        rates: {
          create: [
            { organizationId: ctx.organization.id, name: 'Standard', price: 3500, minMinutes: toMinutes(3, 'DAYS'), maxMinutes: toMinutes(5, 'DAYS'), sortOrder: 0 },
            { organizationId: ctx.organization.id, name: 'Express', price: 7000, minMinutes: toMinutes(1, 'DAYS'), maxMinutes: toMinutes(2, 'DAYS'), sortOrder: 1 },
          ],
        },
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery_zone.suggested',
      entityType: 'Warehouse',
      entityId: store.id,
      metadata: { store: store.name },
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t create the suggested setup');
  }
}

/**
 * "These prices are right." Clears the review flag the Phase 9.2 migration
 * put on a store whose delivery was copied from another store's. Nothing
 * about checkout changes — the copied prices were already in use.
 */
export async function confirmStoreDelivery(warehouseId: string): Promise<Result> {
  try {
    const ctx = await context('edit');
    const updated = await prisma.warehouse.updateMany({
      where: { id: String(warehouseId ?? ''), organizationId: ctx.organization.id },
      data: { deliveryNeedsReview: false },
    });
    if (!updated.count) return { success: false, error: 'That store no longer exists' };
    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery.reviewed',
      entityType: 'Warehouse',
      entityId: warehouseId,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t save that');
  }
}

export interface DeliveryPreviewOption {
  label: string;
  detail: string;
  price: number;
}

export interface DeliveryPreview {
  /** what each store that sells online would offer this address */
  stores: { storeId: string; storeName: string; zoneName: string | null; options: DeliveryPreviewOption[] }[];
  /** what checkout offers when every store has the items — the cheapest store to send from (lib/storefront/delivery/plan.ts) */
  checkout: { storeName: string | null; zoneName: string | null; options: DeliveryPreviewOption[] };
}

/**
 * What a customer at this address would be offered — the same matcher
 * checkout uses, run over the merchant's current settings (including zones
 * and options that are switched off, which are skipped exactly as checkout
 * skips them), store by store, and then what checkout charges. Only stores
 * whose stock is sold online count, as at checkout. `subtotal` is in naira.
 */
export async function previewDelivery(input: { state: string; city: string; subtotal?: number }): Promise<Result<DeliveryPreview>> {
  try {
    const ctx = await context('view');
    const settings = await loadSettings(ctx.organization.id);
    const kobo = (naira: number) => Math.round(naira * 100);
    const setups: StoreDeliverySetup[] = settings.stores
      .filter((store) => store.suppliesOnline)
      .map((store) => ({
        warehouseId: store.id,
        name: store.name,
        state: store.state,
        zones: settings.zones
          .filter((z) => z.warehouseId === store.id)
          .map((z) => ({
            ...z,
            rates: z.rates.map((r) => ({ ...r, price: kobo(r.price), freeOver: r.freeOver === null ? null : kobo(r.freeOver) })),
          })),
        pickups: settings.pickups.filter((p) => p.warehouseId === store.id).map((p) => ({ ...p, price: kobo(p.price) })),
      }));

    const address = { state: input.state, city: input.city };
    const subtotal = kobo(input.subtotal ?? 0);
    const naira = (options: { label: string; description: string; price: number }[]) =>
      options.map((o) => ({ label: o.label, detail: o.description, price: o.price / 100 }));
    const checkout = planWithAnyStock(setups, address, subtotal);
    const firstDelivery = checkout.options.find((o) => o.kind === 'delivery');
    const checkoutStore = firstDelivery ? checkout.plans[firstDelivery.id].shipments[0].store.name : null;

    return {
      success: true,
      data: {
        stores: quoteEachStore(setups, address, subtotal).map((q) => ({
          storeId: q.store.id,
          storeName: q.store.name,
          zoneName: q.zone?.name ?? null,
          options: naira(q.options),
        })),
        checkout: { storeName: checkoutStore, zoneName: checkout.zone?.name ?? null, options: naira(checkout.options) },
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t check that address');
  }
}
