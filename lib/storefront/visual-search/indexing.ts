/*
 * Product-image indexing — the "generate ONCE, reuse forever" half of search
 * by image.
 *
 *   product saved (features/inventory/products.ts)
 *     └─ syncProductImageEmbeddings()   one PENDING row per image, instantly
 *     └─ after(indexPendingImages())    embeds them once the vendor's response
 *                                       has been sent — the save never waits
 *   /api/cron/index-product-images      picks up anything left: new rows the
 *                                       after() couldn't finish, retries of
 *                                       failures, and images that pre-date
 *                                       this feature (backfill)
 *
 * Why this shape: there is no job queue in this app, and adding a paid one
 * for this would be overkill. `after()` gives "don't block the vendor", the
 * existing cron pattern (CRON_SECRET) gives "survive a crash / a 429 / a
 * cold instance", and the PENDING/FAILED rows ARE the queue — durable, in
 * the database the app already has.
 *
 * Cost rules:
 *   • an image is embedded when it is new; an unchanged image never is. The
 *     editor replaces a changed image with a new row (new URL), and deletes
 *     removed ones — their embeddings cascade away with them;
 *   • identical bytes already embedded elsewhere in the store are copied, not
 *     re-embedded (sha256 of the bytes sent to the model);
 *   • every call is taken from the indexing budget in ./quota.ts; with no
 *     budget, no key or a 429 the rows simply stay PENDING for next time.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { visualSearchConfig } from './config';
import { getImageEmbedder, isNotConfigured, isRateLimited, type EmbeddableImage } from './embedding';
import { sniffImageType } from './image-input';
import { noteEmbeddingRateLimited, reserveIndexingEmbedding } from './quota';
import { copyEmbeddingByHash, writeImageEmbedding } from './vector-store';

/** How long a worker holds a row it is embedding, so two workers never pay for one image. */
const LEASE_MS = 2 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/* ─────────────────────────── queueing ────────────────────────────────── */

/**
 * Make sure every current image of one product has an embedding row.
 * Cheap (no model call); runs right after a product save. Rows made by a
 * different model are queued again, since vectors of two models don't mix.
 *
 * Scoped: the product must belong to `organizationId`, and so must each image.
 */
export async function syncProductImageEmbeddings(organizationId: string, productId: string): Promise<number> {
  const { model } = visualSearchConfig();
  const images = await prisma.productImage.findMany({
    where: { organizationId, inventoryItemId: productId, inventoryItem: { organizationId } },
    select: { id: true, embedding: { select: { id: true, model: true, status: true } } },
  });

  const missing = images.filter((i) => !i.embedding);
  if (missing.length) {
    await prisma.productImageEmbedding.createMany({
      data: missing.map((i) => ({ organizationId, productImageId: i.id, inventoryItemId: productId })),
      skipDuplicates: true,
    });
  }

  const staleModel = images
    .filter((i) => i.embedding?.status === 'INDEXED' && i.embedding.model !== model)
    .map((i) => i.embedding!.id);
  if (staleModel.length) {
    await prisma.productImageEmbedding.updateMany({
      where: { id: { in: staleModel }, organizationId },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null },
    });
  }

  return missing.length + staleModel.length;
}

/** Backfill: rows for images that have none (images older than this feature). */
export async function queueUnindexedImages(limit = 200): Promise<number> {
  const images = await prisma.productImage.findMany({
    where: { embedding: { is: null } },
    select: { id: true, organizationId: true, inventoryItemId: true },
    take: limit,
  });
  if (!images.length) return 0;
  const { count } = await prisma.productImageEmbedding.createMany({
    data: images.map((i) => ({ organizationId: i.organizationId, productImageId: i.id, inventoryItemId: i.inventoryItemId })),
    skipDuplicates: true,
  });
  return count;
}

/** Retry a product's failed images now — the admin's "Try again". Tenant-scoped. */
export async function requeueProductImages(organizationId: string, productId: string): Promise<number> {
  await syncProductImageEmbeddings(organizationId, productId);
  const { count } = await prisma.productImageEmbedding.updateMany({
    where: { organizationId, inventoryItemId: productId, status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: null },
  });
  return count;
}

/* ─────────────────────────── the worker ──────────────────────────────── */

export interface IndexRunResult {
  indexed: number;
  /** filled from an identical image already embedded in the store — no model call */
  reused: number;
  failed: number;
  /** left for later: no budget, no key, or Gemini asked us to wait */
  deferred: number;
}

/**
 * Embed waiting images, oldest first. Optionally narrowed to one store or
 * one product (the post-save run). Never throws: a failure is recorded on
 * the row and retried with backoff.
 */
export async function indexPendingImages(
  opts: { organizationId?: string; productId?: string; limit?: number } = {},
): Promise<IndexRunResult> {
  const config = visualSearchConfig();
  const embedder = getImageEmbedder();
  const result: IndexRunResult = { indexed: 0, reused: 0, failed: 0, deferred: 0 };
  const now = new Date();

  const rows = await prisma.productImageEmbedding.findMany({
    where: {
      ...(opts.organizationId && { organizationId: opts.organizationId }),
      ...(opts.productId && { inventoryItemId: opts.productId }),
      OR: [
        { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: 'FAILED', attempts: { lt: config.retryDelaysMs.length }, nextAttemptAt: { lte: now } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      attempts: true,
      productImage: { select: { url: true, organizationId: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 20,
  });

  for (const row of rows) {
    if (!embedder.configured()) {
      result.deferred += rows.length - (result.indexed + result.reused + result.failed + result.deferred);
      break;
    }
    if (!(await claim(row.id))) continue; // another worker has it

    try {
      // Belt and braces: the image and its embedding row must be the same store's.
      if (row.productImage.organizationId !== row.organizationId) {
        await fail(row.id, row.attempts, 'Image belongs to another organisation', true);
        result.failed++;
        continue;
      }

      const source = await fetchProductImage(row.productImage.url, config.productImageEdge);
      if (!source.ok) {
        await fail(row.id, row.attempts, source.reason, source.permanent);
        result.failed++;
        continue;
      }

      const sourceHash = createHash('sha256').update(source.image.bytes).digest('hex');
      if (
        await copyEmbeddingByHash({ organizationId: row.organizationId, embeddingId: row.id, sourceHash, model: embedder.model })
      ) {
        result.reused++;
        continue;
      }

      if (!reserveIndexingEmbedding()) {
        await release(row.id);
        result.deferred++;
        break; // budget spent for now — the rest wait for the next run
      }

      const vector = await embedder.embedImage(source.image);
      await writeImageEmbedding({ embeddingId: row.id, vector, model: embedder.model, sourceHash });
      result.indexed++;
    } catch (error) {
      if (isRateLimited(error)) {
        noteEmbeddingRateLimited(error.retryAfterMs);
        await release(row.id);
        result.deferred++;
        break;
      }
      if (isNotConfigured(error)) {
        await release(row.id);
        result.deferred++;
        break;
      }
      await fail(row.id, row.attempts, error instanceof Error ? error.message : 'Embedding failed', false);
      result.failed++;
    }
  }

  return result;
}

/* ─────────────────────────── row bookkeeping ─────────────────────────── */

/** Take a row for LEASE_MS. False when someone else already holds it (or it's gone). */
async function claim(id: string): Promise<boolean> {
  const now = new Date();
  const { count } = await prisma.productImageEmbedding.updateMany({
    where: {
      id,
      status: { in: ['PENDING', 'FAILED'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  return count === 1;
}

/** Hand a claimed row back untouched, for the next run. */
async function release(id: string): Promise<void> {
  await prisma.productImageEmbedding.updateMany({ where: { id }, data: { nextAttemptAt: null } });
}

async function fail(id: string, attempts: number, reason: string, permanent: boolean): Promise<void> {
  const { retryDelaysMs } = visualSearchConfig();
  const next = permanent ? retryDelaysMs.length : attempts + 1;
  const delay = retryDelaysMs[attempts];
  await prisma.productImageEmbedding.updateMany({
    where: { id },
    data: {
      status: 'FAILED',
      attempts: next,
      lastError: reason.slice(0, 300),
      // null once retries are used up: the row waits for "Try again".
      nextAttemptAt: next < retryDelaysMs.length && delay ? new Date(Date.now() + delay) : null,
    },
  });
}

/* ─────────────────────────── fetching the image ──────────────────────── */

type FetchedImage =
  | { ok: true; image: EmbeddableImage }
  | { ok: false; reason: string; permanent: boolean };

/**
 * The product image as a ≤`edge`px JPEG, via Cloudinary's on-the-fly resize.
 *
 * Only merchant uploads on Cloudinary are fetched — the product editor only
 * accepts those (isOrgAsset), and refusing every other host means this
 * server can never be pointed at an internal address.
 */
export function embeddableImageUrl(url: string, edge: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return null;
  if (!parsed.pathname.includes('/image/upload/')) return null;
  return url.replace('/image/upload/', `/image/upload/c_limit,w_${edge},h_${edge},f_jpg,q_85/`);
}

async function fetchProductImage(url: string, edge: number): Promise<FetchedImage> {
  const target = embeddableImageUrl(url, edge);
  if (!target) return { ok: false, reason: 'Image is not a Cloudinary upload', permanent: true };

  let res: Response;
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store', redirect: 'error' });
  } catch {
    return { ok: false, reason: 'Could not download the image', permanent: false };
  }
  if (res.status === 404) return { ok: false, reason: 'Image no longer exists (404)', permanent: false };
  if (!res.ok) return { ok: false, reason: `Image download failed (${res.status})`, permanent: false };

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) return { ok: false, reason: 'Image is too large', permanent: true };
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return { ok: false, reason: 'Image is not a JPEG or PNG', permanent: false };
  return { ok: true, image: { bytes, mimeType } };
}

/* ─────────────────────────── admin status ────────────────────────────── */

export interface ProductImageSearchStatus {
  images: number;
  indexed: number;
  pending: number;
  failed: number;
}

/** How ready one product is for search by image. Tenant-scoped. */
export async function productImageSearchStatus(
  organizationId: string,
  productId: string,
): Promise<ProductImageSearchStatus> {
  const [images, groups] = await Promise.all([
    prisma.productImage.count({ where: { organizationId, inventoryItemId: productId } }),
    prisma.productImageEmbedding.groupBy({
      by: ['status'],
      where: { organizationId, inventoryItemId: productId },
      _count: { _all: true },
    }),
  ]);
  const count = (status: 'INDEXED' | 'PENDING' | 'FAILED') =>
    groups.find((g) => g.status === status)?._count._all ?? 0;
  const indexed = count('INDEXED');
  const failed = count('FAILED');
  // Images without a row yet are waiting too.
  return { images, indexed, failed, pending: Math.max(0, images - indexed - failed) };
}
