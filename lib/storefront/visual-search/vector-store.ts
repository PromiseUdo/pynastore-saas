/*
 * pgvector access — the only file that writes SQL against embedding columns.
 *
 * Prisma can't read or write the `vector` type, so this is raw SQL, always
 * through tagged templates (every value is a bound parameter, never string
 * concatenation).
 *
 * TENANT ISOLATION lives IN the queries, not after them: every read takes an
 * `organizationId` and filters on it in the WHERE — on the embedding row AND
 * on the product it belongs to — so another store's vectors are never even
 * candidates. A query id or product id from another store simply finds no
 * row. Callers get that id from the trusted server-side store resolution
 * (see ./service.ts), never from the client.
 *
 * SEARCH is an exact nearest-neighbour scan over one store's indexed images,
 * ordered by cosine distance (`<=>`). No ANN index on purpose — see the
 * migration 20260919160000_visual_search_embeddings for why; the scan is
 * bounded by the store's own image count. If a single store ever holds
 * ~50k+ images, add an HNSW index with `hnsw.iterative_scan` enabled so the
 * tenant filter can't starve it of results.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/** pgvector's text format: '[0.1,0.2,…]'. Numbers only — validated by the caller's embedder. */
export function toVectorLiteral(values: number[]): string {
  if (!values.every((v) => Number.isFinite(v))) throw new Error('Vector contains a non-finite value');
  return `[${values.join(',')}]`;
}

export interface NearestProduct {
  productId: string;
  /** cosine similarity of the product's closest image, -1..1 (in practice 0..1) */
  similarity: number;
}

/**
 * The store's products whose images are closest to `vector`, best first.
 *
 * Visibility is part of the query too: only published, active, top-level
 * products, and only embeddings produced by `model` (vectors from different
 * models are not comparable). The catalogue re-checks visibility afterwards
 * (hidden categories, online stock) — this is the first gate, not the only one.
 *
 * A product with several images is scored by its CLOSEST image: a shopper's
 * photo of the back of a jacket should find the jacket whose second photo is
 * the back.
 */
export async function nearestProducts(params: {
  organizationId: string;
  vector: string;
  model: string;
  limit: number;
  candidateImages: number;
  excludeProductId?: string;
}): Promise<NearestProduct[]> {
  const { organizationId, vector, model, limit, candidateImages } = params;
  const exclude = params.excludeProductId ?? null;

  const rows = await prisma.$queryRaw<{ productId: string; similarity: number }[]>`
    WITH candidates AS (
      SELECT e."inventoryItemId" AS product_id,
             1 - (e.embedding <=> ${vector}::vector) AS similarity
      FROM product_image_embeddings e
      JOIN inventory_items i ON i.id = e."inventoryItemId"
      WHERE e."organizationId" = ${organizationId}
        AND i."organizationId" = ${organizationId}
        AND e.status = 'INDEXED'::"EmbeddingStatus"
        AND e.model = ${model}
        AND e.embedding IS NOT NULL
        AND i."isPublished" = true
        AND i.status = 'ACTIVE'
        AND i."parentItemId" IS NULL
        AND (${exclude}::text IS NULL OR e."inventoryItemId" <> ${exclude}::text)
      ORDER BY e.embedding <=> ${vector}::vector
      LIMIT ${candidateImages}
    )
    SELECT product_id AS "productId", MAX(similarity)::float8 AS similarity
    FROM candidates
    GROUP BY product_id
    ORDER BY similarity DESC, product_id
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ productId: r.productId, similarity: Number(r.similarity) }));
}

/* ─────────────────────────── shopper queries ─────────────────────────── */

/** Keep a shopper's search vector (never the photo) so its results page can be re-rendered. */
export async function saveQueryVector(params: {
  organizationId: string;
  vector: number[];
  model: string;
  expiresAt: Date;
}): Promise<string> {
  const id = `vq_${randomUUID().replace(/-/g, '')}`;
  await prisma.$executeRaw`
    INSERT INTO visual_search_queries (id, "organizationId", embedding, model, "expiresAt")
    VALUES (${id}, ${params.organizationId}, ${toVectorLiteral(params.vector)}::vector, ${params.model}, ${params.expiresAt})
  `;
  return id;
}

/** A saved query's vector — only for the store that made it, and only until it expires. */
export async function loadQueryVector(
  organizationId: string,
  queryId: string,
): Promise<{ vector: string; model: string } | null> {
  const rows = await prisma.$queryRaw<{ vector: string; model: string }[]>`
    SELECT embedding::text AS vector, model
    FROM visual_search_queries
    WHERE id = ${queryId} AND "organizationId" = ${organizationId} AND "expiresAt" > now()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function purgeExpiredQueries(): Promise<number> {
  return prisma.$executeRaw`DELETE FROM visual_search_queries WHERE "expiresAt" <= now()`;
}

/* ─────────────────────────── product vectors ─────────────────────────── */

/**
 * "Find similar": the product's main indexed image vector, from this store
 * only. Stored at indexing time, so this costs no model call.
 */
export async function productVector(
  organizationId: string,
  productId: string,
  model: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ vector: string }[]>`
    SELECT e.embedding::text AS vector
    FROM product_image_embeddings e
    JOIN product_images pi ON pi.id = e."productImageId"
    WHERE e."organizationId" = ${organizationId}
      AND e."inventoryItemId" = ${productId}
      AND e.status = 'INDEXED'::"EmbeddingStatus"
      AND e.model = ${model}
      AND e.embedding IS NOT NULL
    ORDER BY pi."sortOrder" ASC
    LIMIT 1
  `;
  return rows[0]?.vector ?? null;
}

/** Store a freshly generated embedding and mark the row indexed. */
export async function writeImageEmbedding(params: {
  embeddingId: string;
  vector: number[];
  model: string;
  sourceHash: string;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE product_image_embeddings
    SET embedding = ${toVectorLiteral(params.vector)}::vector,
        model = ${params.model},
        dimensions = ${params.vector.length},
        "sourceHash" = ${params.sourceHash},
        status = 'INDEXED'::"EmbeddingStatus",
        "lastError" = NULL,
        "nextAttemptAt" = NULL,
        "indexedAt" = now(),
        "updatedAt" = now()
    WHERE id = ${params.embeddingId}
  `;
}

/**
 * The same bytes were already embedded for another image in THIS store (a
 * photo reused across products, or re-uploaded): copy that vector instead of
 * paying for it again. Returns true when a copy was made.
 */
export async function copyEmbeddingByHash(params: {
  organizationId: string;
  embeddingId: string;
  sourceHash: string;
  model: string;
}): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE product_image_embeddings AS target
    SET embedding = source.embedding,
        model = source.model,
        dimensions = source.dimensions,
        "sourceHash" = source."sourceHash",
        status = 'INDEXED'::"EmbeddingStatus",
        "lastError" = NULL,
        "nextAttemptAt" = NULL,
        "indexedAt" = now(),
        "updatedAt" = now()
    FROM (
      SELECT embedding, model, dimensions, "sourceHash"
      FROM product_image_embeddings
      WHERE "organizationId" = ${params.organizationId}
        AND "sourceHash" = ${params.sourceHash}
        AND model = ${params.model}
        AND status = 'INDEXED'::"EmbeddingStatus"
        AND embedding IS NOT NULL
        AND id <> ${params.embeddingId}
      LIMIT 1
    ) AS source
    WHERE target.id = ${params.embeddingId} AND target."organizationId" = ${params.organizationId}
  `;
  return count > 0;
}
