/*
 * /notifications/native-push — notifications on this phone, in the business
 * app (ROADMAP 19.4). POST { token } turns them on, DELETE { token } stops
 * them. The person comes from the session and the app from the user agent;
 * the phone is theirs, for every shop they're in (lib/business-app/push.ts).
 */
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { businessPushReady, linkBusinessPhone, unlinkBusinessPhone } from '@/lib/business-app/push';
import { readWebPushBody, sameOrigin } from '@/lib/notifications/web-push-route';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function prepare(request: Request): Promise<{ userId: string; token: string } | Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: 'Sign in again.' }, 401);
  if (!businessPushReady(request.headers.get('user-agent'))) return json({ error: 'Phone notifications aren’t available here.' }, 404);
  if (!sameOrigin(request)) return json({ error: 'Not from this site.' }, 403);
  const body = await readWebPushBody(request);
  if (body instanceof Response) return body;
  const token = typeof body.token === 'string' && body.token.length <= 4096 ? body.token : null;
  if (!token) return json({ error: 'Invalid request.' }, 400);
  if (!(await checkRateLimit(`nativepush:staff:${userId}`, 20, 10 * 60_000))) return json({ error: 'Too many requests.' }, 429);
  return { userId, token };
}

export async function POST(request: Request) {
  const ready = await prepare(request);
  if (ready instanceof Response) return ready;
  const device = await linkBusinessPhone({ userId: ready.userId, deviceToken: ready.token, userAgent: request.headers.get('user-agent') });
  return device ? json({ ok: true }) : json({ error: 'That isn’t a phone notification token.' }, 400);
}

export async function DELETE(request: Request) {
  const ready = await prepare(request);
  if (ready instanceof Response) return ready;
  return json({ ok: await unlinkBusinessPhone({ userId: ready.userId, deviceToken: ready.token }) });
}
