/*
 * POST /api/client-errors
 *
 * Where browsers report errors (lib/ops/client-report.ts) into the error log
 * (ROADMAP 13.3). Anyone can call it, so it believes nothing: the body is
 * capped and checked, known browser noise is dropped, and it's rate limited
 * per address and in total. It always answers 204 — a caller learns nothing
 * from it.
 */
import type { NextRequest } from 'next/server';
import { takeRateLimits } from '@/lib/rate-limit';
import { recordError } from '@/lib/ops/errors';
import { isBrowserNoise, placeOf } from '@/lib/ops/error-shape';

const MAX_BODY = 16_000;
const KINDS = new Set(['browser', 'rejection', 'boundary']);
const nothing = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return nothing();

  let body: { message?: unknown; stack?: unknown; path?: unknown; kind?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return nothing();
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, 1000) : '';
  const stack = typeof body.stack === 'string' ? body.stack.slice(0, 4000) : null;
  const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path.slice(0, 500) : null;
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'browser';
  if (!message || isBrowserNoise(message, stack)) return nothing();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = await takeRateLimits(
    [
      { key: `client-errors:ip:${ip}`, limit: 30, windowMs: 10 * 60_000 },
      { key: 'client-errors:all', limit: 600, windowMs: 60 * 60_000 },
    ],
    { onError: 'deny' },
  );
  if (!allowed.ok) return nothing();

  await recordError({ source: 'client', where: placeOf(path), kind, message, stack, path, host: req.headers.get('host') });
  return nothing();
}
