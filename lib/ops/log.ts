/*
 * lib/ops/log.ts
 *
 * Structured logs (ROADMAP 13.3): one JSON object per line, so Vercel's log
 * search can filter on any field — `event:"paystack.webhook.failed"`,
 * `level:"error"`, an order reference. Use it for anything worth finding
 * again later; plain console.* is fine for local debugging.
 *
 *   log.error('paystack.webhook.failed', { event: 'charge.success', reference });
 *
 * Never log secrets, tokens, card or bank details, or a customer's address.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    return { error: error.message, errorName: error.name, stack: error.stack?.split('\n').slice(0, 6).join('\n') };
  }
  return error === undefined ? {} : { error: String(error) };
}

function write(level: Level, event: string, fields: Fields = {}, error?: unknown) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields, ...errorFields(error) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields, error?: unknown) => write('warn', event, fields, error),
  error: (event: string, fields?: Fields, error?: unknown) => write('error', event, fields, error),
};
