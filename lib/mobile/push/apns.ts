/*
 * lib/mobile/push/apns.ts
 *
 * iPhone push straight to Apple (APNs, HTTP/2) — ROADMAP 16.4. Server only.
 *
 * A store's iPhone app belongs to the merchant's Apple team, so it is sent
 * to with THEIR APNs key (.p8): team id + key id + the key, kept sealed on
 * the store's MobileApp. Production APNs only — TestFlight and App Store
 * builds use it; an app run straight from Xcode doesn't get notifications.
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

export async function sendApns(
  deviceToken: string,
  message: PushMessage,
  data: Record<string, string>,
  credentials: ApnsCredentials,
): Promise<SendOutcome> {
  const jwt = await apnsJwt(credentials);
  const payload = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' }, ...data });

  const { status, reason } = await new Promise<{ status: number; reason: string }>((resolve, reject) => {
    const session = http2.connect('https://api.push.apple.com');
    session.on('error', reject);
    const request = session.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': credentials.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
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
  // Uninstalled (410), or a token that was never valid for this app.
  if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') {
    return 'gone';
  }
  console.error(`[push] APNs send failed (${status} ${reason})`);
  return 'failed';
}
