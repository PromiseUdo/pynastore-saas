/*
 * lib/trade/accounts.ts
 *
 * Trade buyers (ROADMAP 21.1): reading a shop's wholesale settings and a
 * customer's standing, and every change of standing. Server only.
 *
 * Every function takes `organizationId` first and uses it together with the
 * customer's id, so another store's id is a miss, not a leak. Who may call
 * the merchant-side changes is checked by the callers
 * (features/sales/trade.ts: `customer.trade.manage`); the shopper-side
 * request is checked against the session (features/shop-account/trade.ts).
 *
 * Each change of status is ONE conditional update ("only if it is still
 * REQUESTED"), so two people deciding at once, or a double-click, can't skip
 * a step: the second finds nothing to change and is told so.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import type { TradeStatus, WholesaleMode, TradePaymentRules, BusinessDetails } from './rules';

export interface WholesaleSettings extends TradePaymentRules {
  mode: WholesaleMode;
  requestsOpen: boolean;
  /** the merchant's choice: wholesale prices are before VAT (ROADMAP 21.2) */
  vatAddedChosen: boolean;
  /** …and it applies: the shop is VAT registered, so VAT really is added to trade buyers' wholesale lines */
  vatAdded: boolean;
  /** the least a trade order's goods may come to, major units (ROADMAP 21.3); null = no minimum */
  minOrderValue: number | null;
}

const SETTINGS_SELECT = {
  wholesaleMode: true,
  wholesaleRequestsOpen: true,
  tradePayOnline: true,
  tradePayTransfer: true,
  tradePayOnDelivery: true,
  wholesaleVatAdded: true,
  vatRegistered: true,
  vatRate: true,
  tradeMinOrderValue: true,
} as const;

type SettingsRow = {
  wholesaleMode: WholesaleMode;
  wholesaleRequestsOpen: boolean;
  tradePayOnline: boolean;
  tradePayTransfer: boolean;
  tradePayOnDelivery: boolean;
  wholesaleVatAdded: boolean;
  vatRegistered: boolean;
  vatRate: { toString(): string } | number;
  tradeMinOrderValue: { toString(): string } | number | null;
};

const OFF: WholesaleSettings = {
  mode: 'OFF',
  requestsOpen: false,
  tradePayOnline: true,
  tradePayTransfer: true,
  tradePayOnDelivery: true,
  vatAddedChosen: false,
  vatAdded: false,
  minOrderValue: null,
};

function toSettings(row: SettingsRow | null): WholesaleSettings {
  if (!row) return OFF;
  return {
    mode: row.wholesaleMode,
    // Asking makes no sense while wholesale is off.
    requestsOpen: row.wholesaleMode !== 'OFF' && row.wholesaleRequestsOpen,
    tradePayOnline: row.tradePayOnline,
    tradePayTransfer: row.tradePayTransfer,
    tradePayOnDelivery: row.tradePayOnDelivery,
    vatAddedChosen: row.wholesaleVatAdded,
    // A shop that isn't VAT registered charges no VAT at all (14.1).
    vatAdded: row.wholesaleVatAdded && row.vatRegistered && Number(row.vatRate) > 0,
    minOrderValue: row.tradeMinOrderValue !== null && Number(row.tradeMinOrderValue) > 0 ? Number(row.tradeMinOrderValue) : null,
  };
}

export const getWholesaleSettings = cache(async (organizationId: string): Promise<WholesaleSettings> =>
  toSettings(await prisma.organization.findUnique({ where: { id: organizationId }, select: SETTINGS_SELECT })),
);

export const getWholesaleSettingsBySlug = cache(async (slug: string): Promise<WholesaleSettings & { organizationId: string | null }> => {
  const row = await prisma.organization.findUnique({ where: { slug }, select: { id: true, ...SETTINGS_SELECT } });
  return { ...toSettings(row), organizationId: row?.id ?? null };
});

export interface TradeStanding {
  status: TradeStatus;
  businessName: string;
  cacNumber: string | null;
  requestNote: string | null;
  decisionReason: string | null;
  requestedAt: Date | null;
  decidedAt: Date | null;
}

const STANDING_SELECT = {
  status: true,
  businessName: true,
  cacNumber: true,
  requestNote: true,
  decisionReason: true,
  requestedAt: true,
  decidedAt: true,
} as const;

export async function tradeStanding(organizationId: string, customerId: string): Promise<TradeStanding | null> {
  return prisma.tradeAccount.findFirst({ where: { organizationId, customerId }, select: STANDING_SELECT });
}

/**
 * Whether this customer gets trade terms right now: approved, and the shop
 * has wholesale on. Memoised per request — the catalogue gate, checkout and
 * the account page may all ask during one render.
 */
export const isTradeBuyer = cache(async (organizationId: string, customerId: string): Promise<boolean> => {
  const [settings, account] = await Promise.all([
    getWholesaleSettings(organizationId),
    prisma.tradeAccount.findFirst({ where: { organizationId, customerId, status: 'APPROVED' }, select: { id: true } }),
  ]);
  return settings.mode !== 'OFF' && Boolean(account);
});

/* ---------------- changes ---------------- */

export type TradeChange<R extends string = never> =
  | { ok: true; status: TradeStatus; businessName: string }
  | { ok: false; reason: 'not-found' | 'changed' | R };

async function customerInStore(organizationId: string, customerId: string) {
  return prisma.customer.findFirst({
    where: { id: customerId, organizationId, mergedIntoId: null, accountDeletedAt: null },
    select: { id: true, name: true, taxId: true },
  });
}

/**
 * The shopper asks, from their account. Allowed when wholesale is on and the
 * shop takes requests, and they aren't already a buyer, already waiting, or
 * paused (a paused buyer talks to the store; asking again can't undo it). A
 * declined shopper may ask again.
 */
export async function requestTradeAccount(input: {
  organizationId: string;
  customerId: string;
  details: BusinessDetails;
  note: string | null;
}): Promise<TradeChange<'wholesale-off' | 'requests-closed' | 'already-trade' | 'waiting' | 'paused'>> {
  const settings = await getWholesaleSettings(input.organizationId);
  if (settings.mode === 'OFF') return { ok: false, reason: 'wholesale-off' };
  if (!settings.requestsOpen) return { ok: false, reason: 'requests-closed' };
  const customer = await customerInStore(input.organizationId, input.customerId);
  if (!customer) return { ok: false, reason: 'not-found' };

  const existing = await prisma.tradeAccount.findUnique({ where: { customerId: customer.id }, select: { status: true } });
  if (existing?.status === 'APPROVED') return { ok: false, reason: 'already-trade' };
  if (existing?.status === 'REQUESTED') return { ok: false, reason: 'waiting' };
  if (existing?.status === 'SUSPENDED') return { ok: false, reason: 'paused' };

  const now = new Date();
  const fields = {
    status: 'REQUESTED' as const,
    businessName: input.details.businessName,
    cacNumber: input.details.cacNumber,
    requestNote: input.note,
    decisionReason: null,
    requestedAt: now,
    decidedAt: null,
    decidedById: null,
  };
  const result = await prisma
    .$transaction(async (tx) => {
      if (existing) {
        // Only from DECLINED: anything else changed under us.
        const moved = await tx.tradeAccount.updateMany({ where: { customerId: customer.id, status: 'DECLINED' }, data: fields });
        if (!moved.count) throw new Changed();
      } else {
        await tx.tradeAccount.create({ data: { organizationId: input.organizationId, customerId: customer.id, ...fields } });
      }
      if (input.details.taxId) await tx.customer.update({ where: { id: customer.id }, data: { taxId: input.details.taxId } });
      return 'ok' as const;
    })
    .catch((error) => {
      if (error instanceof Changed || isUniqueClash(error)) return 'changed' as const;
      throw error;
    });
  if (result === 'changed') return { ok: false, reason: 'changed' };
  return { ok: true, status: 'REQUESTED', businessName: input.details.businessName };
}

/**
 * The merchant makes this customer a trade buyer: from nothing, from a
 * request (approving it), or from a decline (changing their mind). A paused
 * buyer is reinstated with `reinstateTrade`, which keeps what they agreed.
 */
export async function approveTrade(input: {
  organizationId: string;
  customerId: string;
  decidedById: string;
  /** given when making one from nothing, or editing a request's details as it's approved */
  details?: BusinessDetails;
}): Promise<TradeChange<'already-trade' | 'paused' | 'needs-details'>> {
  const customer = await customerInStore(input.organizationId, input.customerId);
  if (!customer) return { ok: false, reason: 'not-found' };
  const existing = await prisma.tradeAccount.findUnique({ where: { customerId: customer.id }, select: { status: true, businessName: true } });
  if (existing?.status === 'APPROVED') return { ok: false, reason: 'already-trade' };
  if (existing?.status === 'SUSPENDED') return { ok: false, reason: 'paused' };
  if (!existing && !input.details) return { ok: false, reason: 'needs-details' };

  const businessName = input.details?.businessName ?? existing!.businessName;
  const decided = {
    status: 'APPROVED' as const,
    decisionReason: null,
    decidedAt: new Date(),
    decidedById: input.decidedById,
    ...(input.details ? { businessName: input.details.businessName, cacNumber: input.details.cacNumber } : {}),
  };
  const result = await prisma
    .$transaction(async (tx) => {
      if (existing) {
        const moved = await tx.tradeAccount.updateMany({
          where: { customerId: customer.id, status: existing.status },
          data: decided,
        });
        if (!moved.count) throw new Changed();
      } else {
        await tx.tradeAccount.create({
          data: { organizationId: input.organizationId, customerId: customer.id, businessName, cacNumber: null, ...decided },
        });
      }
      if (input.details?.taxId !== undefined && input.details.taxId !== null) {
        await tx.customer.update({ where: { id: customer.id }, data: { taxId: input.details.taxId } });
      }
      return 'ok' as const;
    })
    .catch((error) => {
      if (error instanceof Changed || isUniqueClash(error)) return 'changed' as const;
      throw error;
    });
  if (result === 'changed') return { ok: false, reason: 'changed' };
  return { ok: true, status: 'APPROVED', businessName };
}

/** Say no to a request. The reason, if given, is shown to the shopper. */
export async function declineTrade(input: {
  organizationId: string;
  customerId: string;
  decidedById: string;
  reason: string | null;
}): Promise<TradeChange> {
  return move(input, 'REQUESTED', 'DECLINED');
}

/** Pause a trade buyer: trade terms stop applying until reinstated. */
export async function suspendTrade(input: {
  organizationId: string;
  customerId: string;
  decidedById: string;
  reason: string | null;
}): Promise<TradeChange> {
  return move(input, 'APPROVED', 'SUSPENDED');
}

export async function reinstateTrade(input: { organizationId: string; customerId: string; decidedById: string }): Promise<TradeChange> {
  return move({ ...input, reason: null }, 'SUSPENDED', 'APPROVED');
}

async function move(
  input: { organizationId: string; customerId: string; decidedById: string; reason: string | null },
  from: TradeStatus,
  to: TradeStatus,
): Promise<TradeChange> {
  const account = await prisma.tradeAccount.findFirst({
    where: { organizationId: input.organizationId, customerId: input.customerId },
    select: { id: true, businessName: true },
  });
  if (!account) return { ok: false, reason: 'not-found' };
  const moved = await prisma.tradeAccount.updateMany({
    where: { id: account.id, status: from },
    data: { status: to, decisionReason: input.reason, decidedAt: new Date(), decidedById: input.decidedById },
  });
  if (!moved.count) return { ok: false, reason: 'changed' };
  return { ok: true, status: to, businessName: account.businessName };
}

/** Correct the business details. The status stays as it is. */
export async function updateTradeDetails(input: {
  organizationId: string;
  customerId: string;
  details: BusinessDetails;
}): Promise<TradeChange> {
  const account = await prisma.tradeAccount.findFirst({
    where: { organizationId: input.organizationId, customerId: input.customerId },
    select: { id: true, status: true },
  });
  if (!account) return { ok: false, reason: 'not-found' };
  await prisma.$transaction([
    prisma.tradeAccount.update({
      where: { id: account.id },
      data: { businessName: input.details.businessName, cacNumber: input.details.cacNumber },
    }),
    prisma.customer.update({ where: { id: input.customerId }, data: { taxId: input.details.taxId } }),
  ]);
  return { ok: true, status: account.status, businessName: input.details.businessName };
}

class Changed extends Error {}

/** Two requests creating the same customer's row at once: the second loses on the unique key. */
function isUniqueClash(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
