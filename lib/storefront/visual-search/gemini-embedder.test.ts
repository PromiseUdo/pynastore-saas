/*
 * The Gemini embedder against a scripted fetch — the request it sends and
 * how it reads every kind of answer. Never reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeminiEmbedder } from './gemini-embedder';

const fetchMock = vi.fn();
const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), mimeType: 'image/jpeg' as const };
const reply = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
  vi.stubEnv('GEMINI_EMBEDDING_MODEL', '');
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('gemini embedder', () => {
  it('sends only the image, at 768 dimensions, with the key in a header', async () => {
    fetchMock.mockResolvedValue(reply(200, { embedding: { values: Array.from({ length: 768 }, () => 2) } }));
    await createGeminiEmbedder().embedImage(image);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent');
    expect(String(url)).not.toContain('test-key-not-real');
    expect(init.headers['x-goog-api-key']).toBe('test-key-not-real');

    const body = JSON.parse(init.body);
    expect(body.output_dimensionality).toBe(768);
    expect(body.content.parts).toEqual([
      { inline_data: { mime_type: 'image/jpeg', data: Buffer.from(image.bytes).toString('base64') } },
    ]);
  });

  it('returns a unit-length vector whatever the model returned', async () => {
    fetchMock.mockResolvedValue(reply(200, { embedding: { values: Array.from({ length: 768 }, () => 2) } }));
    const vector = await createGeminiEmbedder().embedImage(image);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 10);
  });

  it('reports a 429 as rate-limited, with Google’s requested wait', async () => {
    fetchMock.mockResolvedValue(
      reply(429, {
        error: { message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] },
      }),
    );
    await expect(createGeminiEmbedder().embedImage(image)).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 17_000 });
  });

  it('tells an outage from a bad request', async () => {
    fetchMock.mockResolvedValueOnce(reply(503, { error: { message: 'down' } }));
    await expect(createGeminiEmbedder().embedImage(image)).rejects.toMatchObject({ kind: 'unavailable' });
    fetchMock.mockResolvedValueOnce(reply(400, { error: { message: 'bad image' } }));
    await expect(createGeminiEmbedder().embedImage(image)).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('refuses a vector of the wrong size rather than storing it', async () => {
    fetchMock.mockResolvedValue(reply(200, { embedding: { values: [0.1, 0.2] } }));
    await expect(createGeminiEmbedder().embedImage(image)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('fails as not configured, without a request, when there is no key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const embedder = createGeminiEmbedder();
    expect(embedder.configured()).toBe(false);
    await expect(embedder.embedImage(image)).rejects.toMatchObject({ kind: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a network failure into "unavailable"', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(createGeminiEmbedder().embedImage(image)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
