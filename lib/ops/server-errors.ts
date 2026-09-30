/*
 * lib/ops/server-errors.ts
 *
 * What instrumentation.ts hands every server error to (ROADMAP 13.3): a
 * page that crashed while rendering, a route handler or server action that
 * threw, the proxy. Next.js's own control flow (notFound, redirect) is
 * skipped — those aren't failures.
 *
 * Errors a caller catches and turns into a friendly message never reach
 * here; use reportCaughtError (./errors.ts) where one still deserves a look.
 */
import { recordError } from './errors';
import { isNextControlFlow } from './error-shape';

type Request = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type Context = { routePath?: string; routeType?: string };

export async function recordServerError(error: unknown, request: Request, context: Context): Promise<void> {
  const err = (error instanceof Error ? error : new Error(String(error))) as Error & { digest?: string };
  if (isNextControlFlow(err)) return;
  const host = request.headers.host;
  await recordError({
    source: 'server',
    where: context.routePath || request.path.split('?')[0] || 'unknown',
    kind: context.routeType ?? null,
    message: err.message,
    stack: err.stack ?? null,
    path: request.path,
    host: Array.isArray(host) ? host[0] : (host ?? null),
    digest: err.digest ?? null,
  });
}
