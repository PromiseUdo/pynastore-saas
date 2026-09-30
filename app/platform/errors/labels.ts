/* Plain words for the error log's sources and kinds (AGENTS §6: no raw values on screen). */
export const SOURCE_LABEL: Record<string, string> = {
  server: 'Server',
  client: 'Browser',
  webhook: 'Webhook',
};

const KIND_LABEL: Record<string, string> = {
  render: 'While showing a page',
  route: 'In an API route',
  action: 'In a form or button action',
  proxy: 'While routing a request',
  browser: 'In the page’s script',
  rejection: 'In the page’s script (unhandled)',
  boundary: 'While showing a page',
  caught: 'Handled, kept for a look',
  csp: 'Blocked by the security policy',
  signature: 'Bad signature',
  body: 'Unreadable request',
  processing: 'Couldn’t process an event',
  'meta-error': 'Meta returned an error',
  unexpected: 'Unexpected failure',
};

export function kindLabel(kind: string | null): string {
  if (!kind) return '—';
  return KIND_LABEL[kind] ?? 'Other';
}
