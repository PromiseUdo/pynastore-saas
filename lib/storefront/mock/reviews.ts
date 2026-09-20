/*
 * Deterministically generated reviews (~6–10 per product), consistent with
 * each product's `rating` summary from products.ts.
 */
import type { Review } from '../types';
import { PRODUCTS } from './products';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NAMES = [
  'Amara O.', 'Tunde A.', 'Chiamaka E.', 'David M.', 'Zainab I.', 'Grace N.',
  'Emeka U.', 'Fatima B.', 'Kelechi O.', 'Ngozi P.', 'Ibrahim K.', 'Blessing A.',
  'Samuel T.', 'Aisha M.', 'Chinedu R.', 'Yetunde F.',
];

const TITLES: Record<number, string[]> = {
  5: ['Exactly what I hoped for', 'Buy it', 'Exceeded expectations', 'Perfect'],
  4: ['Really good, minor niggles', 'Happy with this', 'Solid choice'],
  3: ['It’s fine', 'Okay for the price', 'Middle of the road'],
  2: ['Disappointed', 'Not quite right', 'Expected more'],
  1: ['Would not recommend', 'Returned it', 'Not for me'],
};

const BODIES: Record<number, string[]> = {
  5: [
    'Quality is genuinely excellent and it arrived a day early. No notes.',
    'Third thing I’ve bought from this brand and the consistency is why I keep coming back.',
    'Photos don’t do it justice. Feels premium and the fit is spot on.',
  ],
  4: [
    'Great overall. Knocked a star because the packaging was a bit flimsy.',
    'Does everything I need. Sizing runs slightly large so size down.',
    'Really pleased — just wish it came in more colours.',
  ],
  3: [
    'Perfectly usable but nothing about it wowed me. Fair for what I paid.',
    'Decent quality, delivery took longer than the estimate.',
  ],
  2: [
    'The material feels cheaper than I expected from the listing.',
    'Started showing wear within a couple of weeks.',
  ],
  1: [
    'Arrived with a defect and the returns process was a hassle.',
    'Completely different to the description. Sent it straight back.',
  ],
};

function pick<T>(a: T[], rnd: () => number): T {
  return a[Math.floor(rnd() * a.length)];
}

const all: Review[] = [];
for (const p of PRODUCTS) {
  const rnd = mulberry32(hashStr(`rev_${p.id}`));
  const n = 6 + Math.floor(rnd() * 5);
  // weighted rating draw from the product's distribution
  const dist = p.rating.distribution;
  const pool: number[] = [];
  ([1, 2, 3, 4, 5] as const).forEach((star) => {
    for (let i = 0; i < Math.max(1, Math.round((dist[star] / p.rating.count) * 20)); i++) pool.push(star);
  });
  for (let i = 0; i < n; i++) {
    const rating = pick(pool.length ? pool : [4, 5], rnd) as 1 | 2 | 3 | 4 | 5;
    const daysAgo = 2 + Math.floor(rnd() * 300);
    all.push({
      id: `${p.id}_rev_${i}`,
      productId: p.id,
      author: pick(NAMES, rnd),
      rating,
      title: pick(TITLES[rating], rnd),
      body: pick(BODIES[rating], rnd),
      createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      verified: rnd() < 0.85,
      helpful: Math.floor(rnd() * 42),
    });
  }
}

export const REVIEWS: Review[] = all;

const byProduct = new Map<string, Review[]>();
for (const r of REVIEWS) {
  const list = byProduct.get(r.productId) ?? [];
  list.push(r);
  byProduct.set(r.productId, list);
}
export const REVIEWS_BY_PRODUCT = byProduct;
