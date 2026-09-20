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
 * It also deletes shoppers' expired search vectors (kept 24h).
 *
 * Point any scheduler at it every 10–15 minutes with
 * `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends that header
 * automatically when CRON_SECRET is set). Each run is bounded, so a large
 * backlog drains over several runs within the free-tier budget.
 */
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { indexPendingImages, queueUnindexedImages } from '@/lib/storefront/visual-search/indexing';
import { purgeExpiredQueries } from '@/lib/storefront/visual-search/vector-store';

// Embedding a batch can take a while; ask the platform for the room.
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const queued = await queueUnindexedImages(200);
    const result = await indexPendingImages({ limit: 25 });
    const purgedQueries = await purgeExpiredQueries();
    return NextResponse.json({ queued, ...result, purgedQueries });
  } catch (error) {
    console.error('[cron] index-product-images failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
