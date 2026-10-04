/*
 * lib/storefront/design/schema.ts
 *
 * The shape of a shop's design (ROADMAP 15.1) — what StorefrontDesign.draft
 * and .published hold. Pure and client-safe.
 *
 * It is a handful of named choices, never markup or CSS: a look, a colour,
 * light or dark first, up to three Fine-tune overrides (null = "the look's
 * own"), and the front page's sections (null = the Classic front page;
 * lib/storefront/sections/schema.ts). Every value is from a fixed list, a
 * checked #rrggbb or a validated section, so nothing in here can reach the
 * page except as a known attribute value, a colour or a known section.
 *
 * History: v1 (15.1) had no sections; v2 (15.2) added them. Header and
 * footer (15.5) were added within v2 with defaults equal to the old header
 * and footer, so older v2 documents parse and look the same.
 *
 * VERSIONED. Each document says which version it is. A later shape is a new
 * version plus an upgrade function from the one before, run on read — never
 * a guess from which keys happen to be present. Anything that still fails
 * is treated as missing, and the storefront falls back to Classic rather
 * than breaking.
 */
import { z } from 'zod';
import { CARD_KEYS, CORNER_KEYS, FONT_KEYS, LOOK_KEYS } from './looks';
import { isHex } from './colour';
import { SectionListSchema, shopPath, type HomepageSection } from '../sections/schema';
import { STARTING_LOOK_IDS } from './starting-look-ids';

/* ─── Header and footer (15.5) ─────────────────────────────────────────── */

export const HEADER_LAYOUTS = ['standard', 'centered', 'search'] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];

/** The footer's columns that are worked out from the shop's own data. */
export const DERIVED_FOOTER_COLUMNS = ['shop', 'account', 'help', 'about'] as const;
export type DerivedFooterColumn = (typeof DERIVED_FOOTER_COLUMNS)[number];
export const MAX_FOOTER_LINKS = 6;

const derivedColumn = <K extends DerivedFooterColumn>(key: K) =>
  z.object({ key: z.literal(key), enabled: z.boolean() }).strict();

const FooterColumnSchema = z.discriminatedUnion('key', [
  derivedColumn('shop'),
  derivedColumn('account'),
  derivedColumn('help'),
  derivedColumn('about'),
  /** the merchant's own column: a heading and up to six links to pages on the shop */
  z
    .object({
      key: z.literal('links'),
      enabled: z.boolean(),
      title: z.string().trim().max(30),
      links: z
        .array(z.object({ label: z.string().trim().min(1, 'Give every link its words').max(40), href: shopPath.min(1) }).strict())
        .max(MAX_FOOTER_LINKS, `Up to ${MAX_FOOTER_LINKS} links`),
    })
    .strict()
    .refine((c) => !c.enabled || (c.title.length > 0 && c.links.length > 0), {
      message: 'Your own column needs a heading and at least one link to be shown',
    }),
]);

export const FooterSchema = z
  .object({ columns: z.array(FooterColumnSchema).max(5) })
  .strict()
  .refine((f) => new Set(f.columns.map((c) => c.key)).size === f.columns.length, {
    message: 'Each footer column appears once',
  });

export type FooterConfig = z.output<typeof FooterSchema>;
export type FooterColumnConfig = FooterConfig['columns'][number];

/** The footer every shop had: the four worked-out columns, in this order, no column of its own. */
export function classicFooter(): FooterConfig {
  return { columns: DERIVED_FOOTER_COLUMNS.map((key) => ({ key, enabled: true })) };
}

export const DESIGN_VERSION = 2;

export const DesignSchema = z
  .object({
    version: z.literal(DESIGN_VERSION),
    look: z.enum(LOOK_KEYS),
    /** #rrggbb, or null for the look's own brand colour */
    brandColour: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #b42318')
      .transform((v) => v.toLowerCase())
      .nullable(),
    /** open dark for a shopper who hasn't chosen; theirs always wins */
    darkByDefault: z.boolean(),
    corners: z.enum(CORNER_KEYS).nullable(),
    fonts: z.enum(FONT_KEYS).nullable(),
    cards: z.enum(CARD_KEYS).nullable(),
    /** the front page's sections, in order; null = the Classic front page */
    sections: SectionListSchema.nullable().default(null),
    header: z.object({ layout: z.enum(HEADER_LAYOUTS) }).strict().default({ layout: 'standard' }),
    /** null = the Classic footer (classicFooter()) */
    footer: FooterSchema.nullable().default(null),
    /** the starting look this design began from (15.6), so the editor can say so; null = none recorded */
    startingLook: z.enum(STARTING_LOOK_IDS).nullable().default(null),
  })
  .strict();

export type StorefrontDesignConfig = z.output<typeof DesignSchema>;

/*
 * version → upgrade to version + 1. Each step is small and tested; a stored
 * document is walked up one version at a time.
 */
const UPGRADES: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  /* v1 → v2: sections arrived. A v1 design never arranged its front page,
   * so it keeps the Classic one. */
  1: (v1) => ({ ...v1, version: 2, sections: null }),
};

/** A stored document → a valid design, or null when it can't be read. */
export function parseDesign(raw: unknown): StorefrontDesignConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.version === 'number' ? doc.version : NaN;
  while (Number.isInteger(version) && version < DESIGN_VERSION && UPGRADES[version]) {
    doc = UPGRADES[version](doc);
    version += 1;
  }
  const parsed = DesignSchema.safeParse(doc);
  return parsed.success ? parsed.data : null;
}

/**
 * Classic, built from what a shop set before designs existed — so a shop
 * that has never opened the editor looks exactly as it did. Pure: same
 * input, same design, nothing written.
 */
export function classicDesign(legacy: { accent: string | null; darkByDefault: boolean }): StorefrontDesignConfig {
  return {
    version: DESIGN_VERSION,
    look: 'classic',
    brandColour: isHex(legacy.accent) ? legacy.accent.toLowerCase() : null,
    darkByDefault: legacy.darkByDefault,
    corners: null,
    fonts: null,
    cards: null,
    sections: null,
    header: { layout: 'standard' },
    footer: null,
    startingLook: null,
  };
}

/** Same choices — for "unsaved changes" and "draft differs from live". */
export function sameDesign(a: StorefrontDesignConfig, b: StorefrontDesignConfig): boolean {
  return (
    a.look === b.look &&
    a.brandColour === b.brandColour &&
    a.darkByDefault === b.darkByDefault &&
    a.corners === b.corners &&
    a.fonts === b.fonts &&
    a.cards === b.cards &&
    JSON.stringify(a.sections) === JSON.stringify(b.sections) &&
    a.header.layout === b.header.layout &&
    JSON.stringify(a.footer) === JSON.stringify(b.footer)
  );
}

/** Same LOOK only — colour, fonts, corners, cards, light/dark — for the Look tab. */
export function sameLook(a: StorefrontDesignConfig, b: StorefrontDesignConfig): boolean {
  return (
    a.look === b.look &&
    a.brandColour === b.brandColour &&
    a.darkByDefault === b.darkByDefault &&
    a.corners === b.corners &&
    a.fonts === b.fonts &&
    a.cards === b.cards
  );
}

export type { HomepageSection };
