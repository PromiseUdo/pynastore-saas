/*
 * lib/tax-settings.ts
 *
 * A shop's VAT setting, from its record (ROADMAP 14.1). Server only; the
 * rule itself is ./tax.ts.
 */
import { prisma } from '@/lib/prisma';
import { shopVat, type ShopVat } from './tax';

const SELECT = { vatRegistered: true, vatRate: true, vatNumber: true } as const;

function toShopVat(row: { vatRegistered: boolean; vatRate: { toString(): string }; vatNumber: string | null } | null): ShopVat | null {
  if (!row) return null;
  return shopVat({ registered: row.vatRegistered, ratePct: Number(row.vatRate.toString()), vatNumber: row.vatNumber });
}

export async function shopVatById(organizationId: string): Promise<ShopVat | null> {
  return toShopVat(await prisma.organization.findUnique({ where: { id: organizationId }, select: SELECT }));
}

export async function shopVatBySlug(organizationSlug: string): Promise<ShopVat | null> {
  return toShopVat(await prisma.organization.findUnique({ where: { slug: organizationSlug }, select: SELECT }));
}
