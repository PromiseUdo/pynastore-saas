/*
 * POST /api/csp-report
 *
 * Where browsers report what the Content Security Policy blocked (ROADMAP
 * 13.4, `report-uri` in lib/security/csp.ts). Each report goes into the
 * error log as a browser error of kind "csp", grouped by what was blocked —
 * so a page the policy breaks shows up in the console, not only in a
 * shopper's devtools. Browser extensions trip the policy constantly; those
 * reports are dropped. Rate limited like /api/client-errors; always 204.
 */
import type { NextRequest } from 'next/server';
import { takeRateLimits } from '@/lib/rate-limit';
import { recordError } from '@/lib/ops/errors';

const MAX_BODY = 16_000;
const nothing = () => new Response(null, { status: 204 });
const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;

type Report = Record<string, unknown>;

/** A blocked URL reduced to its origin ("inline", "eval" and friends kept as they are). */
function blockedWhat(uri: string): string {
  if (!uri || !uri.includes(':')) return uri || 'inline';
  try {
    return new URL(uri).origin;
  } catch {
    return uri.split(/[?#]/)[0].slice(0, 100);
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return nothing();

  let report: Report | undefined;
  try {
    const parsed = JSON.parse(raw) as { 'csp-report'?: Report } | Report[];
    // report-uri sends { "csp-report": {…} }; the Reporting API sends [{ type, body }].
    report = Array.isArray(parsed) ? ((parsed[0]?.body as Report) ?? undefined) : parsed['csp-report'];
  } catch {
    return nothing();
  }
  if (!report) return nothing();

  const str = (...keys: string[]) => {
    for (const k of keys) if (typeof report![k] === 'string') return (report![k] as string).slice(0, 500);
    return '';
  };
  const directive = str('effective-directive', 'effectiveDirective', 'violated-directive', 'violatedDirective').split(' ')[0];
  const blocked = str('blocked-uri', 'blockedURL');
  const sourceFile = str('source-file', 'sourceFile');
  const documentUri = str('document-uri', 'documentURL');
  if (!directive || EXTENSION.test(blocked) || EXTENSION.test(sourceFile)) return nothing();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowed = await takeRateLimits(
    [
      { key: `csp-report:ip:${ip}`, limit: 30, windowMs: 10 * 60_000 },
      { key: 'csp-report:all', limit: 600, windowMs: 60 * 60_000 },
    ],
    { onError: 'deny' },
  );
  if (!allowed.ok) return nothing();

  let path: string | null = null;
  try {
    path = documentUri ? new URL(documentUri).pathname : null;
  } catch {
    path = null;
  }
  const what = blockedWhat(blocked);
  await recordError({
    source: 'client',
    where: `csp:${directive}`,
    kind: 'csp',
    message: `The security policy blocked ${what} (${directive})`,
    stack: sourceFile ? `at ${sourceFile}:${str('line-number', 'lineNumber') || '?'}` : null,
    path,
    host: req.headers.get('host'),
  });
  return nothing();
}
