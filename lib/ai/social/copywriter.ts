/*
 * lib/ai/social/copywriter.ts
 *
 * Gemini writes social copy from a product's real rows — and only from them.
 *
 * Reuses the existing integration: lib/ai/assistant/gemini/client.ts, the
 * same GEMINI_API_KEY, the same server-only `generateJson` with a response
 * schema. There is no second AI provider and no second key. Everything here
 * runs on the server; the key is never named with NEXT_PUBLIC_ and never
 * leaves the process.
 *
 * What the model is trusted with, and what it isn't:
 *   • It is given ProductFacts — a fixed set of fields read from the
 *     merchant's own database rows (lib/social/product-facts.ts). It never
 *     sees a query, an id, an organization, or another store's anything.
 *   • It writes prose. It does not decide what is true: the prompt forbids
 *     inventing prices, discounts, specs, stock, materials, delivery,
 *     warranties or features, and ./validate.ts strips those claims from the
 *     output afterwards whether or not the prompt was obeyed.
 *   • It never publishes. Every function here returns a draft to a form the
 *     merchant edits and submits themselves.
 *
 * Cost: one call per button press, a few hundred tokens (one product, no
 * catalogue). Every call is taken from ./quota.ts first. Unlike the shopping
 * assistant there is no deterministic fallback — a caption is written by the
 * model or not at all — so exhaustion is reported honestly rather than faked.
 */
import { GeminiError, generateJson, geminiConfigured } from '@/lib/ai/assistant/gemini/client';
import type { ProductFacts } from '@/lib/social/product-facts';
import type { SocialPlatform } from '@/lib/social/types';
import { noteCopyRateLimited, reserveCopyCall } from './quota';
import { cleanHashtags, stripForeignLinks, stripUnsupportedClaims, type CaptionCheck } from './validate';

/** Why copy couldn't be written, in terms the UI can act on. */
export type CopyFailure =
  | 'not_configured'
  | 'budget_exhausted'
  | 'rate_limited'
  | 'unavailable'
  | 'unusable_output';

export class CopywriterError extends Error {
  constructor(
    readonly kind: CopyFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CopywriterError';
  }
}

/** The tones a merchant can ask for. Fixed list — never free text from a form. */
export const REWRITE_TONES = {
  professional: 'More professional',
  playful: 'More playful',
  luxurious: 'More luxurious',
  concise: 'More concise',
  sales: 'More sales-focused',
} as const;

export type RewriteTone = keyof typeof REWRITE_TONES;

export function isRewriteTone(value: string): value is RewriteTone {
  return value in REWRITE_TONES;
}

const TONE_INSTRUCTIONS: Record<RewriteTone, string> = {
  professional: 'Rewrite it in a calm, professional voice. No slang, no exclamation marks, no emoji.',
  playful: 'Rewrite it warmer and more playful. Light humour is fine; at most two emoji.',
  luxurious: 'Rewrite it to feel considered and premium. Unhurried sentences, no hype, no emoji.',
  concise: 'Rewrite it much shorter — two sentences at most, keeping the single most useful fact.',
  sales: 'Rewrite it to invite a purchase, ending with a clear call to action. Never invent an offer or urgency.',
};

/* ─── Platform voices ───────────────────────────────────────────────────── */

interface PlatformStyle {
  name: string;
  guidance: string;
  maxChars: number;
  hashtagCount: number;
}

/*
 * TikTok is here on purpose even though nothing publishes to it yet: a
 * merchant can still write and save TikTok-shaped copy, and when the
 * provider lands the copywriter needs no change.
 */
const PLATFORM_STYLES: Record<SocialPlatform, PlatformStyle> = {
  FACEBOOK_PAGE: {
    name: 'Facebook Page',
    guidance: [
      'Write for a Facebook Page audience: full sentences, a little more room to explain.',
      'Two or three short paragraphs at most. Emoji are optional and sparing.',
      'A link may be included; it will be clickable.',
    ].join(' '),
    maxChars: 900,
    hashtagCount: 5,
  },
  INSTAGRAM_BUSINESS: {
    name: 'Instagram',
    guidance: [
      'Write for Instagram: visual-first, personal, a strong opening line since the rest is hidden behind "more".',
      'Short lines. Emoji are welcome but no more than three.',
      'Do NOT include a URL — links are not clickable in an Instagram caption.',
    ].join(' '),
    maxChars: 1_500,
    hashtagCount: 12,
  },
  TIKTOK: {
    name: 'TikTok',
    guidance: [
      'Write for TikTok: one punchy hook, spoken rather than written, very short.',
      'Casual and direct. Emoji fine. No URL.',
    ].join(' '),
    maxChars: 300,
    hashtagCount: 6,
  },
};

/* ─── Prompts ───────────────────────────────────────────────────────────── */

/**
 * The rule the whole feature rests on. Stated as a closed world — "these
 * fields are everything you know" — because that is easier for a model to
 * obey than a list of prohibitions, and the prohibitions are enforced after
 * the fact anyway.
 */
const GROUND_RULES = [
  'You write social media copy for small online shops.',
  'The PRODUCT FACTS below are everything you know about this product. They come from the shop’s own records.',
  'Write ONLY from those facts. If a fact is not listed, it is not known and must not be mentioned.',
  'Never state or imply: a price or discount that is not listed; stock levels or scarcity; urgency such as "selling fast";',
  'materials, dimensions or specifications that are not listed; delivery times or shipping offers; warranties, guarantees or returns;',
  'product features that are not listed; awards, reviews, ratings or customer quotes.',
  'Never invent a web address. Never address the reader by name. Do not use ALL CAPS for emphasis.',
  'Write in the shop’s own voice, in plain English a customer would understand.',
].join(' ');

/** The facts, as the model receives them: a labelled list, no JSON, no ids. */
function factSheet(facts: ProductFacts): string {
  const lines: string[] = [`Product name: ${facts.name}`, `Shop name: ${facts.storeName}`];

  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };

  add('Shop description', facts.storeDescription);
  add('Short description', facts.shortDescription);
  add('Full description', facts.description);
  add('Category', facts.categoryPath.join(' › ') || null);
  add('Brand', facts.brandName);
  add('Price', facts.priceLabel);
  if (facts.variantSummary.length) lines.push(`Options available: ${facts.variantSummary.join(' | ')}`);
  if (facts.highlights.length) lines.push(`Highlights: ${facts.highlights.join(' | ')}`);
  if (facts.specs.length) lines.push(`Specifications: ${facts.specs.join(' | ')}`);
  if (facts.tags.length) lines.push(`Shop’s own tags: ${facts.tags.join(', ')}`);

  return lines.join('\n');
}

/* ─── Calling the model ─────────────────────────────────────────────────── */

/** Reserves budget, calls Gemini, and turns every failure into a CopyFailure. */
async function callModel<T>(
  organizationId: string,
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  maxOutputTokens: number,
): Promise<T> {
  if (!geminiConfigured()) {
    throw new CopywriterError('not_configured', 'GEMINI_API_KEY is not set');
  }
  if (!reserveCopyCall(organizationId)) {
    throw new CopywriterError('budget_exhausted', 'social copy budget exhausted');
  }

  try {
    return (await generateJson({ system, prompt, schema, maxOutputTokens })) as T;
  } catch (error) {
    if (error instanceof GeminiError) {
      if (error.kind === 'rate_limited') {
        noteCopyRateLimited(error.retryAfterMs);
        throw new CopywriterError('rate_limited', error.message);
      }
      if (error.kind === 'not_configured') throw new CopywriterError('not_configured', error.message);
      if (error.kind === 'invalid_response') throw new CopywriterError('unusable_output', error.message);
      throw new CopywriterError('unavailable', error.message);
    }
    throw new CopywriterError('unavailable', error instanceof Error ? error.message : 'unknown failure');
  }
}

const CAPTION_SCHEMA = {
  type: 'object',
  properties: { caption: { type: 'string' } },
  required: ['caption'],
} as const;

const HASHTAG_SCHEMA = {
  type: 'object',
  properties: { hashtags: { type: 'array', items: { type: 'string' } } },
  required: ['hashtags'],
} as const;

/** What a caption request produces: the text, plus anything we had to remove. */
export interface GeneratedCaption extends CaptionCheck {
  /** True when the check removed something, so the UI can say so. */
  wasEdited: boolean;
}

/** Runs the model's caption through every check before anyone sees it. */
function finalise(raw: unknown, facts: ProductFacts, style: PlatformStyle): GeneratedCaption {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) throw new CopywriterError('unusable_output', 'model returned an empty caption');

  const linksRemoved = stripForeignLinks(text, facts.productUrl);
  const checked = stripUnsupportedClaims(linksRemoved, facts);

  if (!checked.text.trim()) {
    /* Everything it wrote was a claim we can't support. Better to say the
     * generation failed than to hand back an empty box. */
    throw new CopywriterError('unusable_output', 'nothing survived fact-checking');
  }

  const trimmed =
    checked.text.length > style.maxChars ? `${checked.text.slice(0, style.maxChars).trimEnd()}…` : checked.text;

  return { text: trimmed, removed: checked.removed, wasEdited: checked.removed.length > 0 };
}

/* ─── The three things a merchant can ask for ───────────────────────────── */

/** "✨ Generate caption" — a first draft for this product on this platform. */
export async function generateCaption(
  organizationId: string,
  facts: ProductFacts,
  platform: SocialPlatform,
): Promise<GeneratedCaption> {
  const style = PLATFORM_STYLES[platform];

  const raw = await callModel<{ caption?: string }>(
    organizationId,
    `${GROUND_RULES} ${style.guidance} Keep the caption under ${style.maxChars} characters. Do not include hashtags — they are added separately.`,
    `Write one ${style.name} caption for this product.\n\nPRODUCT FACTS\n${factSheet(facts)}`,
    CAPTION_SCHEMA,
    600,
  );

  return finalise(raw.caption, facts, style);
}

/** "Generate hashtags" — from the product, its category, the shop, the platform. */
export async function generateHashtags(
  organizationId: string,
  facts: ProductFacts,
  platform: SocialPlatform,
): Promise<string[]> {
  const style = PLATFORM_STYLES[platform];

  const raw = await callModel<{ hashtags?: unknown }>(
    organizationId,
    [
      GROUND_RULES,
      `Suggest hashtags for a ${style.name} post.`,
      'Each must describe what the product actually is, the category it belongs to, or the shop itself.',
      'No generic engagement bait (#follow4follow, #likeforlike, #viral, #fyp), no price or sale tags,',
      'no tags about stock or delivery, and nothing unrelated to the product.',
      'Prefer specific over popular. Return them most relevant first, without the # symbol.',
    ].join(' '),
    `Suggest up to ${style.hashtagCount} hashtags.\n\nPRODUCT FACTS\n${factSheet(facts)}`,
    HASHTAG_SCHEMA,
    300,
  );

  const list = Array.isArray(raw.hashtags) ? raw.hashtags.filter((tag): tag is string => typeof tag === 'string') : [];
  const cleaned = cleanHashtags(list, style.hashtagCount);

  if (cleaned.length === 0) throw new CopywriterError('unusable_output', 'no usable hashtags returned');
  return cleaned;
}

/** "Rewrite" — the merchant's current text, in a different voice. */
export async function rewriteCaption(
  organizationId: string,
  facts: ProductFacts,
  platform: SocialPlatform,
  tone: RewriteTone,
  current: string,
): Promise<GeneratedCaption> {
  const style = PLATFORM_STYLES[platform];

  const raw = await callModel<{ caption?: string }>(
    organizationId,
    [
      GROUND_RULES,
      style.guidance,
      TONE_INSTRUCTIONS[tone],
      'Rewrite only. Do not add any fact that is not in the PRODUCT FACTS, even if the draft contains one.',
      `Keep it under ${style.maxChars} characters. Do not add hashtags.`,
    ].join(' '),
    `PRODUCT FACTS\n${factSheet(facts)}\n\nCURRENT DRAFT\n${current.slice(0, 2_000)}`,
    CAPTION_SCHEMA,
    600,
  );

  return finalise(raw.caption, facts, style);
}

/** Platform limits the composer needs before it calls anything. */
export function platformCopyStyle(platform: SocialPlatform): { maxChars: number; hashtagCount: number } {
  const { maxChars, hashtagCount } = PLATFORM_STYLES[platform];
  return { maxChars, hashtagCount };
}
