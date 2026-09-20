/*
 * The image-embedding seam.
 *
 *   visual-search/service.ts, indexing.ts
 *        ↓  ImageEmbedder  (this file — no vendor in the interface)
 *   ./gemini-embedder.ts  → Gemini API (gemini-embedding-2)
 *
 * Swapping Gemini for another model is a new ImageEmbedder and a line in
 * `createEmbedder`. What callers may rely on: one image in, one L2-normalised
 * vector of `dimensions` numbers out, and a failure typed well enough to act
 * on (a 429 pauses indexing; anything else is retried later).
 *
 * Note the vectors of two different models are NOT comparable. Every stored
 * vector records its `model`, and search only ever compares vectors from the
 * configured one — changing the model means re-indexing, not mixing.
 *
 * Server-only.
 */
import { GeminiError, geminiConfigured } from '@/lib/ai/assistant/gemini/client';
import { createGeminiEmbedder } from './gemini-embedder';

/** The formats every embedder must accept; the browser converts anything else to JPEG. */
export type EmbeddableMimeType = 'image/jpeg' | 'image/png';

export interface EmbeddableImage {
  bytes: Uint8Array;
  mimeType: EmbeddableMimeType;
}

export interface ImageEmbedder {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  /** false when the embedder has no credentials — callers skip rather than fail */
  configured(): boolean;
  embedImage(image: EmbeddableImage): Promise<number[]>;
}

/** Re-exported so callers can tell a rate limit from an outage without importing a vendor. */
export { GeminiError as EmbeddingError };

export function isRateLimited(error: unknown): error is GeminiError {
  return error instanceof GeminiError && error.kind === 'rate_limited';
}

export function isNotConfigured(error: unknown): boolean {
  return error instanceof GeminiError && error.kind === 'not_configured';
}

let embedder: ImageEmbedder | null = null;

export function getImageEmbedder(): ImageEmbedder {
  embedder ??= createGeminiEmbedder();
  return embedder;
}

/** Test seam — pin a fake embedder without touching the environment or the network. */
export function setImageEmbedder(next: ImageEmbedder | null): void {
  embedder = next;
}

export function embedderConfigured(): boolean {
  return embedder ? embedder.configured() : geminiConfigured();
}

/** Unit length, so cosine similarity is exact whatever the model returned. */
export function normalise(values: number[]): number[] {
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) throw new GeminiError('invalid_response', 'Embedding is empty or zero');
  return values.map((v) => v / norm);
}
