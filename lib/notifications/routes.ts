/*
 * lib/notifications/routes.ts
 *
 * What the bell's two routes answer (ROADMAP 18.2), shared by the admin
 * (/notifications/feed, /notifications/realtime-token on a shop's host) and
 * the platform console (/platform/notifications/…). Each route decides the
 * READER from the session and hands it here; nothing in the body can widen
 * whose list it is.
 *
 * Route handlers, not server actions, on purpose: the bell polls, and Next
 * runs a page's server actions one at a time (ROADMAP 17.2). JSON only, so
 * another site can't post to them without a CORS preflight they never answer.
 *
 * Feed body (all optional):
 *   read     a notification id → marked read (opening it)
 *   readAll  true → everything marked read
 *   latest   true → the newest few come back with the count (the open dropdown)
 */
import { listenTokenRequest, ablyConfigured } from '@/lib/realtime/ably';
import { latestNotifications, markAllNotificationsRead, markNotificationRead, unreadCount, type Reader } from './inbox';
import { listChannelName } from './realtime';
import type { BellFeed } from './view';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const sentJson = (request: Request) => request.headers.get('content-type')?.startsWith('application/json') ?? false;

export async function bellFeedResponse(request: Request, reader: Reader): Promise<Response> {
  if (!sentJson(request)) return json({ error: 'Send JSON.' }, 415);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // An empty body is a count-only poll.
  }

  if (body.readAll === true) await markAllNotificationsRead(reader);
  else if (typeof body.read === 'string' && body.read.length <= 64) await markNotificationRead(reader, body.read);

  const answer: BellFeed = body.latest === true ? await latestNotifications(reader) : { unread: await unreadCount(reader) };
  return json(answer);
}

export async function bellTokenResponse(request: Request, reader: Reader): Promise<Response> {
  if (!sentJson(request)) return json({ error: 'Send JSON.' }, 415);
  if (!ablyConfigured()) return json({ error: 'Real-time updates are off.' }, 503);
  const channel = listChannelName(reader);
  const tokenRequest = await listenTokenRequest([channel]);
  if (!tokenRequest) return json({ error: 'Real-time updates are off.' }, 503);
  return json({ tokenRequest, channel });
}
