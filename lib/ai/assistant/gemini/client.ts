/*
 * The Gemini API, over plain fetch.
 *
 * No SDK: the assistant needs one endpoint (models.generateContent) with a
 * JSON response schema, and a hand-rolled call keeps the dependency tree and
 * the cold start small. Server-only — it reads GEMINI_API_KEY, which is never
 * given a NEXT_PUBLIC_ name and never leaves this process. The key travels in
 * the `x-goog-api-key` header, not the URL, so it can't end up in an access
 * log.
 *
 * Every failure becomes a GeminiError with a `kind` the provider can act on
 * (rate limited → cool down; anything else → answer without the model). The
 * message is for server logs only: it never reaches a shopper.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/*
 * gemini-3.5-flash-lite: on the free tier, the fastest and cheapest of the
 * current models, no announced shutdown date, and "minimal" thinking by
 * default — right for reading intent out of one sentence, where latency
 * matters more than depth. Override with GEMINI_MODEL (e.g. gemini-2.5-flash-lite).
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const DEFAULT_TIMEOUT_MS = 8_000;

export type GeminiErrorKind =
  | 'not_configured'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected'
  | 'timeout'
  | 'invalid_response';

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly status?: number,
    /** from Google's RetryInfo / Retry-After, when it sent one */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export interface GenerateJsonOptions {
  system: string;
  prompt: string;
  /** OpenAPI-subset schema, as generationConfig.responseSchema takes it */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** One structured generation. Returns the parsed JSON; validating it is the caller's job. */
export async function generateJson({
  system,
  prompt,
  schema,
  maxOutputTokens = 512,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: GenerateJsonOptions): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiError('not_configured', 'GEMINI_API_KEY is not set');

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new GeminiError(timedOut ? 'timeout' : 'unavailable', timedOut ? 'Gemini timed out' : 'Gemini unreachable');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : '';
    if (res.status === 429) {
      throw new GeminiError('rate_limited', `Gemini 429 ${detail}`, 429, retryAfterMs(res, body));
    }
    throw new GeminiError(
      res.status >= 500 ? 'unavailable' : 'rejected',
      `Gemini ${res.status} ${detail}`,
      res.status,
    );
  }

  const data = await res.json().catch(() => null);
  const candidate = data?.candidates?.[0];
  const text: string | undefined = candidate?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    .join('');

  if (!text) {
    const reason = data?.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'empty';
    throw new GeminiError('invalid_response', `Gemini returned no text (${reason})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError('invalid_response', `Gemini returned non-JSON (${candidate?.finishReason ?? 'unknown'})`);
  }
}

/** Google puts the wait in a RetryInfo detail ("13s"); fall back to the header. */
function retryAfterMs(res: Response, body: unknown): number | undefined {
  const details = (body as { error?: { details?: { '@type'?: string; retryDelay?: string }[] } })?.error?.details;
  const retryInfo = details?.find((d) => d['@type']?.endsWith('RetryInfo'));
  const seconds = retryInfo?.retryDelay ? parseFloat(retryInfo.retryDelay) : Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}
