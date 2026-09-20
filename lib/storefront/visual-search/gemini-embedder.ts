/*
 * Gemini image embeddings over plain fetch (no SDK), like the assistant's
 * client in lib/ai/assistant/gemini/client.ts — same key, same header, same
 * error type.
 *
 *   POST /v1beta/models/{model}:embedContent
 *   { content: { parts: [{ inline_data: { mime_type, data } }] },
 *     output_dimensionality: 768 }
 *   → { embedding: { values: number[] } }
 *
 * The image is embedded on its own — no text prompt beside it — so a shopper
 * photo and a product photo land in the same space and are compared as
 * images. The key rides in the `x-goog-api-key` header, never the URL, and
 * never leaves the server (GEMINI_API_KEY has no NEXT_PUBLIC_ twin).
 */
import { GeminiError } from '@/lib/ai/assistant/gemini/client';
import { visualSearchConfig } from './config';
import { normalise, type EmbeddableImage, type ImageEmbedder } from './embedding';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15_000;

export function createGeminiEmbedder(): ImageEmbedder {
  const { model, dimensions } = visualSearchConfig();

  return {
    id: 'gemini',
    model,
    dimensions,
    configured: () => Boolean(process.env.GEMINI_API_KEY?.trim()),

    async embedImage(image: EmbeddableImage) {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) throw new GeminiError('not_configured', 'GEMINI_API_KEY is not set');

      let res: Response;
      try {
        res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:embedContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            content: {
              parts: [{ inline_data: { mime_type: image.mimeType, data: Buffer.from(image.bytes).toString('base64') } }],
            },
            output_dimensionality: dimensions,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: 'no-store',
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new GeminiError(timedOut ? 'timeout' : 'unavailable', timedOut ? 'Gemini embedding timed out' : 'Gemini unreachable');
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : '';
        if (res.status === 429) {
          throw new GeminiError('rate_limited', `Gemini 429 ${detail}`, 429, retryAfterMs(res, body));
        }
        throw new GeminiError(res.status >= 500 ? 'unavailable' : 'rejected', `Gemini ${res.status} ${detail}`, res.status);
      }

      const body = await res.json().catch(() => null);
      const values: unknown = body?.embedding?.values;
      if (!Array.isArray(values) || values.length !== dimensions || !values.every((v) => typeof v === 'number')) {
        throw new GeminiError('invalid_response', `Expected ${dimensions} numbers, got ${Array.isArray(values) ? values.length : typeof values}`);
      }
      return normalise(values as number[]);
    },
  };
}

function retryAfterMs(res: Response, body: unknown): number | undefined {
  const details = (body as { error?: { details?: { '@type'?: string; retryDelay?: string }[] } })?.error?.details;
  const retryInfo = details?.find((d) => d['@type']?.endsWith('RetryInfo'));
  const seconds = retryInfo?.retryDelay ? parseFloat(retryInfo.retryDelay) : Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}
