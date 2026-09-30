// lib/sales/parcel-collection.ts
// What each courier collects when a pay-on-delivery order comes in several
// parcels (ROADMAP Phase 9.6). Pure, so the order page and the packing slip
// print the same figures, and they're tested once.
//
// THE RULE. Each parcel's courier collects that parcel's own delivery fee,
// plus its share of the rest of the order total in proportion to the goods it
// carries — so a discount (or tax) is shared out the way the goods are,
// instead of landing on whichever rider knocks first. Worked in kobo, and the
// odd kobo from rounding goes to the biggest parcel, so the amounts always
// add up to exactly what the customer owes.

export interface ParcelShare {
  /** the goods in this parcel, at the prices on the order (major units) */
  goods: number;
  /** this parcel's delivery fee (major units) */
  fee: number;
}

/** Amounts to collect, in the same order as `parcels`, in major units. */
export function collectionSplit(total: number, parcels: ParcelShare[]): number[] {
  if (parcels.length === 0) return [];
  const kobo = (value: number) => Math.round(value * 100);

  const totalKobo = kobo(total);
  const fees = parcels.map((p) => kobo(p.fee));
  const goods = parcels.map((p) => Math.max(0, kobo(p.goods)));
  const goodsTotal = goods.reduce((sum, g) => sum + g, 0);
  const forGoods = totalKobo - fees.reduce((sum, f) => sum + f, 0);

  const amounts = parcels.map((_, i) =>
    fees[i] + (goodsTotal > 0 ? Math.floor((forGoods * goods[i]) / goodsTotal) : i === 0 ? forGoods : 0),
  );

  // The rounding remainder goes to the parcel with the most goods (the first on ties).
  const biggest = goods.reduce((best, g, i) => (g > goods[best] ? i : best), 0);
  amounts[biggest] += totalKobo - amounts.reduce((sum, a) => sum + a, 0);

  return amounts.map((a) => a / 100);
}
