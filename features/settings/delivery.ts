'use server';

/*
 * features/settings/delivery.ts
 *
 * The merchant's delivery setup: zones (where they deliver), the rates inside
 * each zone (what it costs and how long it takes), and pickup locations.
 * Checkout quotes from exactly this (lib/storefront/delivery/).
 *
 * Nigeria only for now. A zone covers named cities in one state, whole
 * states, or the rest of Nigeria; the most specific zone covering an address
 * wins. Saving refuses overlaps that would make that ambiguous — the same
 * state in two state zones, the same city in two city zones, or a second
 * "rest of Nigeria" zone — and says which zone already has it.
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
import { quoteFromSetup, type DeliverySetup } from '@/lib/storefront/delivery/match';
import { MAX_RETURN_WINDOW_DAYS } from '@/lib/storefront/orders/policy';

type Result<T = void> = { success: true; data: T } | { success: false; error: string; fieldErrors?: Record<string, string> };

/* ---------------- reading ---------------- */

export interface DeliveryRateRow {
  id: string;
  name: string;
  price: number;
  minDays: number;
  maxDays: number;
  freeOver: number | null;
  isActive: boolean;
}

export interface DeliveryZoneRow {
  id: string;
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
  name: string;
  address: string;
  city: string;
  state: string;
  instructions: string | null;
  readyInDays: number;
  price: number;
  isActive: boolean;
}

export interface DeliverySettings {
  zones: DeliveryZoneRow[];
  pickups: PickupLocationRow[];
  /** null: the store doesn't take returns through the website */
  returnWindowDays: number | null;
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

async function loadSettings(organizationId: string): Promise<DeliverySettings> {
  const [zones, pickups, organization] = await Promise.all([
    prisma.deliveryZone.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { rates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    }),
    prisma.pickupLocation.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { returnWindowDays: true } }),
  ]);

  return {
    zones: zones.map((zone) => ({
      id: zone.id,
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
        minDays: rate.minDays,
        maxDays: rate.maxDays,
        freeOver: num(rate.freeOver),
        isActive: rate.isActive,
      })),
    })),
    pickups: pickups.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      instructions: p.instructions,
      readyInDays: p.readyInDays,
      price: Number(p.price),
      isActive: p.isActive,
    })),
    returnWindowDays: organization?.returnWindowDays ?? null,
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
  zone: { kind: string; state?: string | null; states: string[]; cities: string[] },
): Promise<{ field: string; message: string } | null> {
  const others = await prisma.deliveryZone.findMany({
    where: { organizationId, kind: zone.kind as 'CITIES' | 'STATES' | 'NATIONWIDE', ...(zoneId ? { NOT: { id: zoneId } } : {}) },
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
    const data = {
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
      const count = await prisma.deliveryZone.count({ where: { organizationId: ctx.organization.id } });
      id = (await prisma.deliveryZone.create({ data: { ...data, organizationId: ctx.organization.id, sortOrder: count }, select: { id: true } })).id;
    }

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: zoneId ? 'settings.delivery_zone.update' : 'settings.delivery_zone.create',
      entityType: 'DeliveryZone',
      entityId: id,
      metadata: { name: data.name, kind: data.kind },
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

const RateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name this option, e.g. Standard or Same day').max(40, 'Keep the name under 40 characters'),
    price: money('a price'),
    minDays: z.coerce.number().int('Use whole days').min(0, 'Days can’t be negative').max(60, 'Keep it under 60 days'),
    maxDays: z.coerce.number().int('Use whole days').min(0, 'Days can’t be negative').max(60, 'Keep it under 60 days'),
    freeOver: z
      .union([z.literal(''), z.null(), money('an amount')])
      .transform((v) => (v === '' || v === null ? null : v))
      .default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((rate, ctx) => {
    if (rate.maxDays < rate.minDays) {
      ctx.addIssue({ code: 'custom', path: ['maxDays'], message: 'Must be the same as or more than the fastest time' });
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

    const data = { ...parsed.data, zoneId };
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

const PickupSchema = z.object({
  name: z.string().trim().min(2, 'Name this location, e.g. Main shop').max(60, 'Keep the name under 60 characters'),
  address: z.string().trim().min(5, 'Enter the street address').max(200, 'Keep the address under 200 characters'),
  city: z.string().trim().min(2, 'Enter the city or town').max(80),
  state: stateEnum,
  instructions: z
    .string()
    .trim()
    .max(200, 'Keep instructions under 200 characters')
    .transform((v) => v || null)
    .nullish(),
  readyInDays: z.coerce.number().int('Use whole days').min(0, 'Days can’t be negative').max(30, 'Keep it under 30 days'),
  isActive: z.boolean().default(true),
});

export type PickupLocationInput = z.input<typeof PickupSchema>;

export async function savePickupLocation(pickupId: string | null, input: PickupLocationInput): Promise<Result<{ id: string }>> {
  try {
    const ctx = await context('edit');
    const parsed = PickupSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Check the highlighted fields', fieldErrors: fieldErrors(parsed.error) };
    }
    const data = { ...parsed.data, instructions: parsed.data.instructions ?? null };

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
      metadata: { name: data.name, city: data.city },
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
 * the page says so — and it refuses to run once any zone exists.
 */
export async function createSuggestedDelivery(): Promise<Result> {
  try {
    const ctx = await context('edit');
    const existing = await prisma.deliveryZone.count({ where: { organizationId: ctx.organization.id } });
    if (existing) return { success: false, error: 'You already have delivery zones. Edit them instead.' };

    await prisma.deliveryZone.create({
      data: {
        organizationId: ctx.organization.id,
        name: 'Nigeria',
        kind: 'NATIONWIDE',
        rates: {
          create: [
            { organizationId: ctx.organization.id, name: 'Standard', price: 3500, minDays: 3, maxDays: 5, sortOrder: 0 },
            { organizationId: ctx.organization.id, name: 'Express', price: 7000, minDays: 1, maxDays: 2, sortOrder: 1 },
          ],
        },
      },
    });

    await createAuditLog({
      organizationId: ctx.organization.id,
      userId: ctx.userId,
      action: 'settings.delivery_zone.suggested',
      entityType: 'DeliveryZone',
      entityId: ctx.organization.id,
    });
    return { success: true, data: undefined };
  } catch (error) {
    return failure(error, 'We couldn’t create the suggested setup');
  }
}

/**
 * What a customer at this address would be offered — the same matcher
 * checkout uses, run over the merchant's current settings (including zones
 * and options that are switched off, which are skipped exactly as checkout
 * skips them). `subtotal` is in naira.
 */
export async function previewDelivery(input: { state: string; city: string; subtotal?: number }): Promise<
  Result<{ zoneName: string | null; options: { label: string; detail: string; price: number }[] }>
> {
  try {
    const ctx = await context('view');
    const settings = await loadSettings(ctx.organization.id);
    const kobo = (naira: number) => Math.round(naira * 100);
    const setup: DeliverySetup = {
      zones: settings.zones.map((z) => ({
        ...z,
        rates: z.rates.map((r) => ({ ...r, price: kobo(r.price), freeOver: r.freeOver === null ? null : kobo(r.freeOver) })),
      })),
      pickups: settings.pickups.map((p) => ({ ...p, price: kobo(p.price) })),
    };
    const quote = quoteFromSetup(setup, { state: input.state, city: input.city }, kobo(input.subtotal ?? 0));
    return {
      success: true,
      data: {
        zoneName: quote.zone?.name ?? null,
        options: quote.options.map((o) => ({ label: o.label, detail: o.description, price: o.price / 100 })),
      },
    };
  } catch (error) {
    return failure(error, 'We couldn’t check that address');
  }
}
