/*
 * Search-by-image settings — every tunable number in one place.
 *
 * SIMILARITY METRIC: cosine similarity between L2-normalised embeddings
 * (pgvector's `<=>` is cosine DISTANCE, so similarity = 1 - distance).
 * Cosine is what embedding models are trained to be compared with, it
 * ignores vector length, and on normalised vectors it ranks identically to
 * the inner product — so the choice costs nothing and survives a model that
 * stops normalising.
 *
 * THRESHOLDS: calibrated on a small first sample with gemini-embedding-2 at
 * 768 dimensions (2026-09-19): the same product re-cropped or greyscaled
 * scored 0.86–0.93; two different skirts 0.59; unrelated photos (a landscape,
 * a laptop, a skirt) 0.53–0.67. This model's similarity has a high floor —
 * everything is "a bit similar" — so a naive threshold like 0.5 would match
 * everything, and 0.9 would only find the exact photo. Hence three levels:
 *
 *   min    0.62  below this a match is indistinguishable from an unrelated
 *                photo and is dropped
 *   good   0.70  the top match clears the unrelated band → "Best visual matches"
 *   strong 0.80  the top match looks like the same kind of item → "Visual matches"
 *
 * A top match under `good` is still shown, under the page's honest
 * "Closest we could find" heading. These are a starting point, not an optimum:
 * tune them with real shopper photos against real catalogues (every value can
 * be overridden from the environment without a deploy of new code).
 */

function envNumber(name: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

/** Fixed by the `vector(768)` columns: changing it is a migration plus a full re-index. */
export const EMBEDDING_DIMENSIONS = 768;

export function visualSearchConfig() {
  return {
    /** the image-embedding model; must accept images (gemini-embedding-2 does) */
    model: process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-2',
    dimensions: EMBEDDING_DIMENSIONS,

    maxResults: Math.round(envNumber('VISUAL_SEARCH_MAX_RESULTS', 24, { min: 1, max: 48 })),
    minSimilarity: envNumber('VISUAL_SEARCH_MIN_SIMILARITY', 0.62, { min: 0, max: 1 }),
    goodSimilarity: envNumber('VISUAL_SEARCH_GOOD_SIMILARITY', 0.7, { min: 0, max: 1 }),
    strongSimilarity: envNumber('VISUAL_SEARCH_STRONG_SIMILARITY', 0.8, { min: 0, max: 1 }),
    /**
     * Drop results more than this far below the best match, so one strong
     * hit isn't padded out with the unrelated band.
     */
    relativeBand: envNumber('VISUAL_SEARCH_RELATIVE_BAND', 0.15, { min: 0, max: 1 }),
    /** image rows considered before grouping by product */
    candidateImages: 200,

    /** a shopper's search vector is kept this long so its results page can be refreshed */
    queryTtlMs: 24 * 60 * 60 * 1000,

    /** product-image indexing retries: 1m, 5m, 30m, 2h, 12h, then give up until re-indexed */
    retryDelaysMs: [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000],
    /** longest edge of the product image sent to the model — Cloudinary resizes it */
    productImageEdge: 768,
  };
}

export type VisualSearchConfig = ReturnType<typeof visualSearchConfig>;
