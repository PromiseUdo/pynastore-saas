/*
 * GET /api/cron/index-product-images
 *
 * The durable half of search-by-image indexing (lib/storefront/visual-search/
 * indexing.ts). A product save already embeds its new photos right after the
 * response (`after()`); this picks up whatever that couldn't finish:
 *
 *   • images that pre-date the feature, or whose post-save run was cut short
 *     (backfill: a PENDING row is created for any image without one);
 *   • failures, retried with backoff (1m → 12h, then left for "Try again");
 *   • rows deferred by the embedding budget or a Gemini 429.
 *
 * It also deletes shoppers' expired search vectors (kept 24h). Each run is
 * bounded, so a large backlog drains over several runs within the free-tier
 * budget. Every 15 minutes; see lib/cron/jobs.ts and docs/SCHEDULED-JOBS.md.
 */
import { cronRoute } from '@/lib/cron/route';

// Embedding a batch can take a while; ask the platform for the room.
export const maxDuration = 60;

export const GET = cronRoute('index-product-images');
