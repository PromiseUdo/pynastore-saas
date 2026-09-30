/*
 * instrumentation.ts
 *
 * Next.js calls onRequestError for every error it catches on the server —
 * rendering, route handlers, server actions, the proxy (ROADMAP 13.3). They
 * go to the platform's own error log (lib/ops/errors.ts), which staff read
 * at /platform/errors.
 *
 * The recorder reaches the database, so it's loaded only on the Node.js
 * runtime, and only when an error actually happens.
 */
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordServerError } = await import('./lib/ops/server-errors');
  await recordServerError(error, request, context);
};
