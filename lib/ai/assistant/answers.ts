/*
 * Grounded product Q&A.
 *
 * Every sentence this file produces is assembled from fields of the product
 * row the caller fetched: specs, highlights, description, variant stock,
 * the rating summary, real reviews, and the store's own delivery/returns
 * data. There is no fallback prose that describes a product in general
 * terms, because that is how a shopper ends up told something the listing
 * never said.
 *
 * The important return value is `grounded: false`. Everything that can't be
 * answered from the row is routed to a single honest line — "I don't have
 * enough information to confirm that" — plus an offer to show what IS listed
 * (§11). A confident-sounding guess is the failure mode this section exists
 * to prevent.
 *
 * Attribution is built into the wording ("the listed specifications say…",
 * "customers rated…") so a shopper can always tell what is quoted from the
 * listing and what is the assistant's framing (§37).
 */
import { formatMoney } from '@/lib/storefront/format';
import type { Product } from '@/lib/storefront/types';
import type { ProductReviewsResult, ProductSpecificationsResult, StorePoliciesResult } from './tools';
import type { QuestionTopic } from './types';

export interface GroundedAnswer {
  body: string;
  /** false when the listing simply does not carry the answer */
  grounded: boolean;
}

export const NOT_ENOUGH_INFORMATION =
  'I don’t have enough information to confirm that.';

export interface ProductAnswerInput {
  product: Product;
  topic: QuestionTopic;
  message: string;
  specifications: ProductSpecificationsResult;
  reviews: ProductReviewsResult | null;
  policies: StorePoliciesResult;
  /** midpoint price of the product's own department, for value questions */
  categoryMedianPrice?: number | null;
  categoryName?: string;
  currency: string;
}

/** Spec labels that answer a topic, in the order they should be preferred. */
const SPEC_LABELS: Partial<Record<QuestionTopic, string[]>> = {
  material: ['Composition', 'Material', 'Fabric'],
  care: ['Care', 'Cleaning', 'Storage'],
  battery: ['Battery'],
  connectivity: ['Connectivity', 'In the box'],
  warranty: ['Warranty'],
  sizing: ['Fit', 'Dimensions', 'Size', 'Net weight'],
};

export function answerProductQuestion(input: ProductAnswerInput): GroundedAnswer {
  const { product, topic, message, specifications, reviews, policies, currency } = input;
  const name = product.name;

  switch (topic) {
    case 'sizing':
      return sizingAnswer(input);

    case 'colour':
      return colourAnswer(input);

    case 'stock':
      return stockAnswer(input);

    case 'reviews':
      return reviewsAnswer(input);

    case 'value':
      return valueAnswer(input);

    case 'water':
      return evidenceAnswer(input, ['waterproof', 'water-resistant', 'water resistant', 'splash'], 'water resistance');

    case 'suitability':
      return suitabilityAnswer(input);

    case 'delivery': {
      if (!policies.delivery.length) return unknown(name);
      const lines = policies.delivery.map(
        (option) =>
          `${option.label} (${option.free ? 'free' : formatMoney(option.price, currency)}) — ${option.detail}`,
      );
      return {
        grounded: true,
        body: `This store lists ${policies.delivery.length} delivery ${
          policies.delivery.length === 1 ? 'option' : 'options'
        }: ${lines.join('; ')}. You'll see the exact charge for your address at checkout.`,
      };
    }

    case 'returns': {
      if (policies.returnWindowDays == null) return unknown(name);
      const pickup =
        policies.pickupAvailable == null
          ? ''
          : policies.pickupAvailable
            ? ' Collection from a pickup location is available.'
            : '';
      return {
        grounded: true,
        body: `You can ask to return items within ${policies.returnWindowDays} days of delivery, from your account.${pickup}`,
      };
    }

    case 'specs': {
      if (!specifications.specs.length && !specifications.highlights.length) return unknown(name);
      const specs = specifications.specs.map((s) => `${s.label}: ${s.value}`);
      const parts = [
        specs.length ? `The listed specifications are — ${specs.join('; ')}.` : '',
        specifications.highlights.length
          ? `The listing also highlights: ${specifications.highlights.join('; ')}.`
          : '',
      ].filter(Boolean);
      return { grounded: true, body: parts.join(' ') };
    }

    default: {
      /* A labelled spec that answers the topic directly. */
      const fromSpec = specFor(specifications, SPEC_LABELS[topic] ?? []);
      if (fromSpec) {
        return {
          grounded: true,
          body: `The listed specifications give ${fromSpec.label.toLowerCase()} as ${fromSpec.value}.`,
        };
      }
      /* Otherwise: does the listing's own copy mention what was asked? */
      const evidence = evidenceFor(product, keywords(message));
      if (evidence) {
        return { grounded: true, body: `The listing says: “${evidence}”.` };
      }
      return unknown(name);
    }
  }
}

/* ─────────────────────────── topic answers ──────────────────────────── */

function sizingAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { specifications, product } = input;
  const sizeOption = product.options.find((o) => o.kind === 'size' || /size/i.test(o.name));

  if (sizeOption) {
    const available = specifications.availableOptionValues[sizeOption.name] ?? [];
    const all = sizeOption.values.map((v) => v.label);
    const fit = specFor(specifications, ['Fit']);
    const fitLine = fit ? ` The listed fit is ${fit.value.toLowerCase()}.` : '';

    if (!available.length) {
      return {
        grounded: true,
        body: `${sizeOption.name} options on this listing are ${all.join(', ')}, but none are in stock right now.${fitLine}`,
      };
    }
    return {
      grounded: true,
      body: `This listing carries ${sizeOption.name.toLowerCase()} ${all.join(', ')}, and ${
        available.length === all.length ? 'all are' : `${available.join(', ')} ${available.length === 1 ? 'is' : 'are'}`
      } in stock.${fitLine}`,
    };
  }

  const dimension = specFor(input.specifications, ['Dimensions', 'Size', 'Net weight']);
  if (dimension) {
    return {
      grounded: true,
      body: `There are no size options on this listing. The listed ${dimension.label.toLowerCase()} is ${dimension.value}.`,
    };
  }
  return unknown(input.product.name);
}

function colourAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { product, specifications, message } = input;
  const colourOption = product.options.find((o) => o.kind === 'color' || /colou?r/i.test(o.name));
  if (!colourOption) return unknown(product.name);

  const all = colourOption.values.map((v) => v.label);
  const available = specifications.availableOptionValues[colourOption.name] ?? [];

  /* "Do you have this in blue?" — answer about THAT colour, from stock. */
  const asked = all.find((label) => new RegExp(`\\b${escapeRe(label)}\\b`, 'i').test(message));
  if (asked) {
    return available.includes(asked)
      ? { grounded: true, body: `Yes — ${asked} is listed and in stock for this product.` }
      : {
          grounded: true,
          body: `${asked} is listed for this product but shows no stock at the moment. In stock right now: ${
            available.length ? available.join(', ') : 'none of the colours'
          }.`,
        };
  }

  return {
    grounded: true,
    body: `This listing comes in ${all.join(', ')}${
      available.length && available.length < all.length
        ? `, and ${available.join(', ')} ${available.length === 1 ? 'is' : 'are'} in stock`
        : ''
    }.`,
  };
}

function stockAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { product, specifications } = input;
  if (!product.inStock) {
    return { grounded: true, body: `${product.name} is showing as out of stock right now.` };
  }
  const available = Object.entries(specifications.availableOptionValues)
    .filter(([, values]) => values.length)
    .map(([option, values]) => `${option.toLowerCase()}: ${values.join(', ')}`);
  return {
    grounded: true,
    body: available.length
      ? `Yes — it's in stock. Available ${available.join('; ')}.`
      : `Yes — it's in stock.`,
  };
}

function reviewsAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { product, reviews } = input;
  if (!reviews || reviews.summary.count === 0) {
    return {
      grounded: true,
      body: `${product.name} has no customer reviews yet, so there's nothing I can tell you about how it's been received.`,
    };
  }
  const { average, count } = reviews.summary;
  const quoted = reviews.items[0];
  const quote = quoted
    ? ` The most helpful review, ${quoted.rating}/5, says: “${trim(quoted.body, 160)}”.`
    : '';
  return {
    grounded: true,
    body: `Customers rated it ${average.toFixed(1)}/5 across ${count} ${count === 1 ? 'review' : 'reviews'}.${quote}`,
  };
}

/**
 * "Is this worth it?" answered with figures rather than an opinion: what it
 * is rated, by how many people, and where its price sits in its own
 * department. The verdict is left to the shopper.
 */
function valueAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { product, reviews, categoryMedianPrice, categoryName, currency } = input;
  const parts: string[] = [];

  if (reviews && reviews.summary.count > 0) {
    parts.push(
      `it's rated ${reviews.summary.average.toFixed(1)}/5 from ${reviews.summary.count} ${
        reviews.summary.count === 1 ? 'review' : 'reviews'
      }`,
    );
  } else {
    parts.push('it has no reviews yet');
  }

  parts.push(`it's listed at ${formatMoney(product.priceFrom, currency)}`);

  if (categoryMedianPrice != null && categoryName) {
    const side = product.priceFrom < categoryMedianPrice ? 'below' : product.priceFrom > categoryMedianPrice ? 'above' : 'right at';
    parts.push(
      `which is ${side} the ${formatMoney(categoryMedianPrice, currency)} midpoint for ${categoryName} in this store`,
    );
  }

  if (product.compareAtPrice && product.compareAtPrice > product.priceFrom) {
    parts.push(`and it's currently reduced from ${formatMoney(product.compareAtPrice, currency)}`);
  }

  return {
    grounded: true,
    body: `I can only go on what's listed: ${parts.join(', ')}. Whether that's worth it depends on what you need it for — happy to line it up against similar products if that helps.`,
  };
}

/**
 * "Is this good for running?" — answered only if the listing actually says
 * something about it. The use case is matched against the product's own
 * copy, category and tags; no match means no answer.
 */
function suitabilityAnswer(input: ProductAnswerInput): GroundedAnswer {
  const { product, message, categoryName } = input;
  const terms = keywords(message);
  const evidence = evidenceFor(product, terms);
  if (evidence) {
    return {
      grounded: true,
      body: `The listing supports that: “${evidence}”. That's what the product information says — it isn't a guarantee it'll suit you.`,
    };
  }
  const inCategory =
    categoryName && terms.some((t) => categoryName.toLowerCase().includes(t));
  if (inCategory) {
    return {
      grounded: true,
      body: `It's listed under ${categoryName}, but the product information doesn't say anything more specific about that use.`,
    };
  }
  return unknown(product.name);
}

/** A yes/no attribute question answered strictly from the listing's copy. */
function evidenceAnswer(input: ProductAnswerInput, terms: string[], label: string): GroundedAnswer {
  const evidence = evidenceFor(input.product, terms);
  if (evidence) return { grounded: true, body: `The listing says: “${evidence}”.` };
  return {
    grounded: false,
    body: `${NOT_ENOUGH_INFORMATION} The listing for ${input.product.name} doesn't mention ${label}.`,
  };
}

/* ───────────────────────────── helpers ──────────────────────────────── */

function unknown(productName: string): GroundedAnswer {
  return {
    grounded: false,
    body: `${NOT_ENOUGH_INFORMATION} The listing for ${productName} doesn't cover that.`,
  };
}

function specFor(
  specifications: ProductSpecificationsResult,
  labels: string[],
): { label: string; value: string } | null {
  for (const wanted of labels) {
    const hit = specifications.specs.find((s) => s.label.toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * The sentence in the product's own text that mentions what was asked.
 *
 * Searches highlights and specs before the description, because those are
 * the merchant's deliberate claims. Returns the sentence verbatim so the
 * answer can quote rather than paraphrase.
 */
export function evidenceFor(product: Product, terms: string[]): string | null {
  if (!terms.length) return null;
  const hit = (text: string) => terms.some((t) => text.toLowerCase().includes(t));

  for (const highlight of product.highlights) if (hit(highlight)) return highlight;
  for (const spec of product.specs) if (hit(spec.value) || hit(spec.label)) return `${spec.label}: ${spec.value}`;
  if (hit(product.shortDescription)) return trim(product.shortDescription, 200);

  for (const sentence of product.description.split(/(?<=[.!?])\s+/)) {
    const clean = sentence.replace(/\*\*/g, '').trim();
    if (clean && hit(clean)) return trim(clean, 200);
  }
  return null;
}

const QUESTION_WORDS = new Set([
  'is', 'are', 'this', 'that', 'it', 'the', 'a', 'an', 'for', 'good', 'ok',
  'okay', 'can', 'do', 'does', 'i', 'use', 'with', 'and', 'or', 'to', 'in',
  'on', 'what', 'how', 'will', 'would', 'suitable', 'work', 'right', 'you',
  'have', 'any', 'my', 'me', 'be', 'used', 'using', 'about', 'product',
]);

/** Content words from a question, for matching against the listing's copy. */
export function keywords(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !QUESTION_WORDS.has(w));
}

function trim(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
