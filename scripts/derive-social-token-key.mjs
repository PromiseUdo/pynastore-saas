#!/usr/bin/env node
/*
 * scripts/derive-social-token-key.mjs (ROADMAP 13.9)
 *
 * Prints the key that encrypts merchants' Facebook and Instagram tokens TODAY
 * — derived from AUTH_SECRET, exactly as lib/social/crypto.ts does when
 * SOCIAL_TOKEN_KEY isn't set. Setting SOCIAL_TOKEN_KEY to this value keeps
 * every stored connection readable, while freeing AUTH_SECRET to be rotated
 * later without disconnecting anyone. (A brand-new random key would make
 * every stored token unreadable.)
 *
 *   AUTH_SECRET='<production AUTH_SECRET>' node scripts/derive-social-token-key.mjs
 *
 * Run it on your own machine; the output is a secret — paste it straight into
 * Vercel and don't keep it anywhere else.
 */
import { scryptSync } from 'node:crypto';

const secret = process.env.AUTH_SECRET?.trim();
if (!secret) {
  console.error('Set AUTH_SECRET to the production value first:\n  AUTH_SECRET=\'…\' node scripts/derive-social-token-key.mjs');
  process.exit(1);
}
// Must match lib/social/crypto.ts: same salt, same length, scrypt defaults.
console.log(scryptSync(secret, 'mansaas.social.token.v1', 32).toString('base64'));
