/*
 * lib/mobile/push/fcm.ts
 *
 * Android push through Firebase Cloud Messaging, HTTP v1 (ROADMAP 16.4).
 * Server only.
 *
 * ONE Firebase project belongs to the platform; every store's Android app is
 * registered in it (docs/MOBILE-BUILD.md), so one service account sends to
 * all of them. The account comes from FIREBASE_SERVICE_ACCOUNT — the JSON
 * key Firebase gives you, as-is or base64-encoded. Without it, Android push
 * is simply off: the app never offers it (lib/mobile/push/watch.ts).
 */
import { SignJWT, importPKCS8 } from 'jose';
import type { PushMessage } from './messages';

export type SendOutcome = 'sent' | 'gone' | 'failed';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function readServiceAccount(raw = process.env.FIREBASE_SERVICE_ACCOUNT): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const json = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return readServiceAccount() !== null;
}

let cached: { token: string; expiresAt: number; email: string } | null = null;

/** Test seam. */
export function resetFcmTokenCache(): void {
  cached = null;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.email === account.client_email && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(account.private_key, 'RS256'));

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, email: account.client_email };
  return body.access_token;
}

export async function sendFcm(token: string, message: PushMessage, data: Record<string, string>): Promise<SendOutcome> {
  const account = readServiceAccount();
  if (!account) return 'failed';

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(account)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data,
        android: { priority: 'HIGH', notification: { sound: 'default' } },
      },
    }),
  });
  if (response.ok) return 'sent';

  // The app was uninstalled or the token rotated: Firebase says so with 404
  // (UNREGISTERED). Anything else is ours or theirs to retry, not the token's.
  const detail = await response.text().catch(() => '');
  if (response.status === 404 || detail.includes('UNREGISTERED')) return 'gone';
  console.error(`[push] FCM send failed (${response.status}): ${detail.slice(0, 300)}`);
  return 'failed';
}
