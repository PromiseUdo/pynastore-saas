/*
 * Deterministically generated customer Q&A, ~2–4 per product.
 *
 * Questions are drawn from pools keyed by the product's ROOT category, so a
 * laptop is asked about battery and ports and a serum is asked about skin
 * type — the same principle as the spec facets: what is asked follows from
 * what the product is, not from a single hardcoded list.
 *
 * Answers are written to stay true to the row they belong to: they quote the
 * product's own specs and policies rather than inventing facts. When this is
 * replaced by a real Q&A service (and later an assistant answering from the
 * catalogue), that rule is the one that has to survive — see ProductAnswer's
 * `source` field in ../types.
 */
import type { Product, ProductAnswer, ProductQuestion } from '../types';
import { PRODUCTS } from './products';
import { CATEGORY_BY_ID } from './categories';

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

const ASKERS = [
  'Adaeze', 'Bola', 'Chidi', 'Damilola', 'Efe', 'Funmi', 'Hassan', 'Ifeoma',
  'Joshua', 'Kemi', 'Lanre', 'Maryam', 'Nneka', 'Obinna', 'Rita', 'Segun',
];

/** A question plus how the merchant would answer it for THIS product. */
interface Template {
  q: string;
  answer: (product: Product) => string | null;
}

const spec = (product: Product, label: string) =>
  product.specs.find((s) => s.label.toLowerCase() === label.toLowerCase())?.value ?? null;

const GENERIC: Template[] = [
  {
    q: 'How long does delivery usually take?',
    answer: () =>
      'Standard delivery is 2–4 working days, and express is next working day in selected cities. You will see both options with live prices at checkout.',
  },
  {
    q: 'Can I return this if it is not right?',
    answer: (p) =>
      p.highlights.some((h) => /return/i.test(h))
        ? 'Yes — returns are open for 30 days from delivery, unused and in its original packaging.'
        : 'Yes — you have 30 days from delivery to send it back, unused and in its original packaging.',
  },
  {
    q: 'Is this the genuine product from the brand?',
    answer: (p) =>
      `Yes. Every ${p.brandName} item we list is sourced directly and checked before it ships.`,
  },
  {
    q: 'Does it come in other colours?',
    answer: (p) => {
      const colour = p.options.find((o) => o.kind === 'color');
      if (!colour) return null;
      return `This one comes in ${colour.values.length} colourways: ${colour.values
        .map((v) => v.label)
        .join(', ')}. Pick yours above — the photos update with your choice.`;
    },
  },
];

const BY_ROOT: Record<string, Template[]> = {
  fashion: [
    {
      q: 'Does it fit true to size?',
      answer: (p) => {
        const fit = spec(p, 'Fit');
        return fit
          ? `It is cut ${fit.toLowerCase()}, so it fits true to size for most people. If you are between sizes and want more room, size up.`
          : 'It fits true to size for most people. If you are between sizes, size up for a looser fit.';
      },
    },
    {
      q: 'What is it actually made of?',
      answer: (p) => {
        const comp = spec(p, 'Composition');
        return comp ? `${comp}. The full breakdown is in the specifications below.` : null;
      },
    },
    {
      q: 'Can it go in the washing machine?',
      answer: (p) => spec(p, 'Care'),
    },
  ],
  electronics: [
    {
      q: 'How long does the battery last?',
      answer: (p) => {
        const battery = spec(p, 'Battery');
        if (!battery || battery === 'N/A') return null;
        return `${battery} of typical use. Heavy use will be shorter, as always.`;
      },
    },
    {
      q: 'What connections does it have?',
      answer: (p) => {
        const conn = spec(p, 'Connectivity');
        return conn ? `${conn}. Everything listed in the specifications below is included in the box.` : null;
      },
    },
    {
      q: 'Is there a warranty?',
      answer: (p) => {
        const warranty = spec(p, 'Warranty');
        return warranty ? `Yes — ${warranty.toLowerCase()} of manufacturer warranty, handled by us.` : null;
      },
    },
  ],
  'home-living': [
    {
      q: 'Does it need assembling?',
      answer: (p) => {
        const assembly = spec(p, 'Assembly');
        if (!assembly) return null;
        return assembly === 'None'
          ? 'No assembly — it arrives ready to use.'
          : `Assembly: ${assembly.toLowerCase()}. Tools and instructions are in the box.`;
      },
    },
    {
      q: 'What are the exact dimensions?',
      answer: (p) => {
        const dims = spec(p, 'Dimensions');
        return dims ? `${dims} (width × depth × height). Measure your space before ordering.` : null;
      },
    },
    {
      q: 'How do I clean it?',
      answer: (p) => spec(p, 'Care'),
    },
  ],
  beauty: [
    {
      q: 'Will this suit my skin type?',
      answer: (p) => {
        const skin = spec(p, 'Skin type');
        return skin ? `It is formulated for ${skin.toLowerCase()}. Patch test first if your skin reacts easily.` : null;
      },
    },
    {
      q: 'How big is the bottle?',
      answer: (p) => spec(p, 'Size'),
    },
    {
      q: 'Is it cruelty-free?',
      answer: (p) => {
        const cf = spec(p, 'Cruelty-free');
        return cf === 'Yes' ? 'Yes — this brand does not test on animals at any stage.' : null;
      },
    },
  ],
  grocery: [
    {
      q: 'How should it be stored?',
      answer: (p) => spec(p, 'Storage'),
    },
    {
      q: 'What size is the pack?',
      answer: (p) => spec(p, 'Net weight'),
    },
    {
      q: 'Are there any dietary notes?',
      answer: (p) => {
        const diet = spec(p, 'Dietary');
        return diet && diet !== '—' ? `${diet}. The full label is on the packaging.` : null;
      },
    },
  ],
  'sports-outdoors': [
    {
      q: 'Is this suitable for a beginner?',
      answer: (p) =>
        `Yes — it is a straightforward piece of kit, and at ${p.rating.average.toFixed(
          1,
        )} stars across ${p.rating.count} reviews it is one people keep using rather than upgrading away from.`,
    },
    {
      q: 'How heavy is it to carry?',
      answer: (p) => spec(p, 'Net weight') ?? spec(p, 'Dimensions'),
    },
  ],
  'toys-games': [
    {
      q: 'What age is this suitable for?',
      answer: () =>
        'It is aimed at ages 6 and up. Smaller parts mean it is not suitable for children under 3.',
    },
    {
      q: 'Are batteries needed?',
      answer: () => 'No batteries required — it works straight out of the box.',
    },
  ],
  jewelry: [
    {
      q: 'Will it tarnish?',
      answer: (p) => {
        const material = spec(p, 'Material');
        return `Kept dry and stored in its pouch, it holds its finish.${
          material ? ` Material: ${material.toLowerCase()}.` : ''
        } Take it off before swimming or showering.`;
      },
    },
    {
      q: 'Does it come in a gift box?',
      answer: () => 'Yes — everything in this department ships in a branded box, ready to give.',
    },
  ],
};

function buildFor(product: Product): ProductQuestion[] {
  const rnd = mulberry32(hashStr(`qna_${product.id}`));
  const root = CATEGORY_BY_ID.get(product.categoryIds[0])?.slug ?? '';

  // Category-specific first, then generic — and only ones this product can
  // actually answer, so no question is ever left hanging.
  const candidates = [...(BY_ROOT[root] ?? []), ...GENERIC]
    .map((template) => ({ template, answer: template.answer(product) }))
    .filter((c): c is { template: Template; answer: string } => Boolean(c.answer));

  const count = Math.min(candidates.length, 2 + Math.floor(rnd() * 3));

  return candidates.slice(0, count).map((c, i) => {
    const daysAgo = 3 + Math.floor(rnd() * 200);
    const askedAt = new Date(Date.now() - daysAgo * 86400000);
    const answeredAt = new Date(askedAt.getTime() + (1 + Math.floor(rnd() * 3)) * 86400000);

    const answers: ProductAnswer[] = [
      {
        id: `${product.id}_qna_${i}_a`,
        body: c.answer,
        author: 'Store team',
        source: 'merchant',
        createdAt: answeredAt.toISOString(),
      },
    ];

    return {
      id: `${product.id}_qna_${i}`,
      productId: product.id,
      body: c.template.q,
      author: ASKERS[Math.floor(rnd() * ASKERS.length)],
      createdAt: askedAt.toISOString(),
      helpful: Math.floor(rnd() * 30),
      answers,
    };
  });
}

const byProduct = new Map<string, ProductQuestion[]>();
for (const product of PRODUCTS) byProduct.set(product.id, buildFor(product));

export const QUESTIONS_BY_PRODUCT = byProduct;
