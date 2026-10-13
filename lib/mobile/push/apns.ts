/*
 * lib/mobile/push/apns.ts
 *
 * iPhone push straight to Apple (APNs, HTTP/2) — ROADMAP 16.4. Server only.
 *
 * A store's iPhone app belongs to the merchant's Apple team, so it is sent
 * to with THEIR APNs key (.p8): team id + key id + the key, kept sealed on
 * the store's MobileApp.
 *
 * TestFlight and App Store builds use the live service; a build run straight
 * from Xcode registers with Apple's test one (`sandbox`). Which one a phone
 * uses is worked out by ./send.ts on the first send (ROADMAP 18.4).
 */
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import type { PushMessage } from './messages';
import type { SendOutcome } from './fcm';

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  /** the .p8 file's contents */
  key: string;
  /** the app's bundle id */
  topic: string;
}

const tokens = new Map<string, { jwt: string; madeAt: number }>();

/**
 * The provider token Apple wants: ES256, issued by the team, named by key id.
 * Apple refuses one older than an hour and throttles one renewed more often
 * than every 20 minutes, so each is kept for 40.
 */
export async function apnsJwt(credentials: Pick<ApnsCredentials, 'teamId' | 'keyId' | 'key'>, now = Date.now()): Promise<string> {
  const cacheKey = `${credentials.teamId}.${credentials.keyId}`;
  const hit = tokens.get(cacheKey);
  if (hit && now - hit.madeAt < 40 * 60_000) return hit.jwt;

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
    .setIssuer(credentials.teamId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(await importPKCS8(credentials.key, 'ES256'));
  tokens.set(cacheKey, { jwt, madeAt: now });
  return jwt;
}

/** Whether a .p8 key can be read at all — checked before it is stored. */
export async function isUsableApnsKey(key: string): Promise<boolean> {
  try {
    await importPKCS8(key, 'ES256');
    return true;
  } catch {
    return false;
  }
}

export interface ApnsOptions {
  /** the number on the app's icon; 0 clears it */
  badge?: number;
  /** notifications about the same thing replace each other and group together */
  thread?: string;
  /** Apple's test service, for a build run from Xcode */
  sandbox?: boolean;
}

/** Apple caps apns-collapse-id at 64 bytes. */
const collapseId = (thread: string) => thread.slice(0, 64);

/**
 * Send one notification — or, with `message` null, only set the icon's badge.
 * 'bad-token' is the live service refusing a token it doesn't know, which is
 * what a sandbox token looks like to it (./send.ts tries the sandbox then).
 */
export async function sendApns(
  deviceToken: string,
  message: PushMessage | null,
  data: Record<string, string>,
  credentials: ApnsCredentials,
  options: ApnsOptions = {},
): Promise<SendOutcome | 'bad-token'> {
  const jwt = await apnsJwt(credentials);
  const badge = options.badge !== undefined ? { badge: options.badge } : {};
  const aps = message
    ? { alert: { title: message.title, body: message.body }, sound: 'default', ...badge, ...(options.thread ? { 'thread-id': options.thread } : {}) }
    : badge;
  const payload = JSON.stringify({ aps, ...data });

  const { status, reason } = await new Promise<{ status: number; reason: string }>((resolve, reject) => {
    const session = http2.connect(options.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
    session.on('error', reject);
    const request = session.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': credentials.topic,
      'apns-push-type': 'alert',
      // A badge on its own isn't urgent; Apple asks for 5 when nothing is shown.
      'apns-priority': message ? '10' : '5',
      ...(message && options.thread ? { 'apns-collapse-id': collapseId(options.thread) } : {}),
      'content-type': 'application/json',
    });
    let statusCode = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      statusCode = Number(headers[':status']);
    });
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      session.close();
      let why = '';
      try {
        why = (JSON.parse(body) as { reason?: string }).reason ?? '';
      } catch {
        /* an empty body is a success */
      }
      resolve({ status: statusCode, reason: why });
    });
    request.on('error', (error) => {
      session.close();
      reject(error);
    });
    request.setTimeout(10_000, () => {
      request.close();
      session.close();
      reject(new Error('APNs timed out'));
    });
    request.end(payload);
  });

  if (status === 200) return 'sent';
  // Not a token this service knows: perhaps it's the other service's.
  if (reason === 'BadDeviceToken') return 'bad-token';
  // Uninstalled (410), or a token that was never valid for this app.
  if (status === 410 || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'gone';
  console.error(`[push] APNs send failed (${status} ${reason})`);
  return 'failed';
}
