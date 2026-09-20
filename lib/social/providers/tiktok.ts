/*
 * lib/social/providers/tiktok.ts
 *
 * TikTok, declared but not yet live.
 *
 * This file exists so TikTok is a real member of the provider registry
 * rather than a note in a roadmap: the platform enum has it, the registry
 * returns it, and the connect screen renders it with an honest "not
 * available yet" instead of pretending it isn't coming.
 *
 * NOTHING HERE CALLS TIKTOK, AND NOTHING HERE PRETENDS TO PUBLISH. Every
 * method fails closed with `unsupported`. `publishRules` is the one
 * exception — it returns real numbers rather than throwing, because the
 * composer asks for rules while drawing the form and a throw there would
 * break a screen that is only trying to say "you can't post here yet".
 *
 * The application does not require TIKTOK_* variables to run; their absence
 * is the normal state and is reported as such.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TODO — what implementing TikTok actually requires
 * ────────────────────────────────────────────────────────────────────────
 *
 * 1. OAUTH (TikTok Login Kit, not Meta's flow)
 *    - Register the app in the TikTok for Developers portal; it issues a
 *      client key and client secret (TIKTOK_CLIENT_KEY /
 *      TIKTOK_CLIENT_SECRET), the platform-level pair — per-vendor
 *      credentials are as wrong here as they are for Meta.
 *    - Authorization endpoint differs from Meta's: TikTok uses its own
 *      /v2/auth/authorize/ with `client_key` (not `client_id`), a
 *      space-or-comma separated `scope`, `response_type=code`, a `state`,
 *      and a redirect URI registered in the portal (TIKTOK_REDIRECT_URI).
 *    - Token exchange at /v2/oauth/token/ returns BOTH an access token
 *      (short-lived, ~24h) and a REFRESH token. This is the first real
 *      difference from Meta: our Page tokens don't expire, TikTok's do.
 *      `SocialConnection.tokenExpiresAt` already exists for this, but a
 *      refresh path does not — it will need a scheduled or lazy refresh
 *      before a connection goes stale, and a place to store the refresh
 *      token (add an encrypted `refreshTokenCipher` column; do NOT reuse
 *      `accessTokenCipher`).
 *
 * 2. CONTENT POSTING API
 *    - Publishing is not one call. TikTok's Content Posting API initialises
 *      an upload, takes the media by PULL_FROM_URL or a chunked FILE_UPLOAD,
 *      and then reports status asynchronously — so `publishPost` cannot
 *      return an id synchronously the way Meta's does. Expect to add a
 *      PUBLISHING → poll → PUBLISHED transition, which `SocialPostStatus`
 *      already models, plus a status-check call.
 *    - Scopes: `video.publish` for direct posting, `video.upload` for the
 *      upload-to-drafts flow, plus `user.info.basic` to name the account.
 *
 * 3. DIRECT POSTING vs UPLOAD (DRAFT) — this is a product decision, not just
 *    a technical one.
 *    - Direct Post publishes straight to the account. It requires passing
 *      TikTok's audit for the `video.publish` scope, and unaudited apps are
 *      restricted to posting only to private accounts.
 *    - Upload-to-draft sends the video to the creator's TikTok inbox, where
 *      they finish and post it themselves. Much easier to get approved, and
 *      arguably the better fit for a merchant tool — but it means MansaaS
 *      can never report "published", only "sent to your TikTok drafts".
 *      `SocialPostStatus` would need a state for that; don't reuse
 *      PUBLISHED, which would be a lie.
 *
 * 4. AUDIT / REVIEW
 *    - TikTok requires app review for the posting scopes, and an additional
 *      URL-ownership verification for any domain used with PULL_FROM_URL —
 *      our Cloudinary URLs would need that domain verified before TikTok
 *      will fetch from it.
 *
 * 5. CONTENT SHAPE
 *    - TikTok is video-first. Photo posts exist but the merchant catalogue
 *      gives us still images, so a useful integration likely needs either
 *      photo-mode posting or a generated slideshow. Decide this BEFORE
 *      building: it changes what the composer has to collect.
 */
import type { PublishRules, SocialProvider } from '../types';
import { SocialProviderError } from '../types';

function notYet(): never {
  throw new SocialProviderError('unsupported', 'TikTok publishing is not enabled on this installation');
}

export const tiktokProvider: SocialProvider = {
  platforms: ['TIKTOK'] as const,
  label: 'TikTok',

  isConfigured(): boolean {
    /* Deliberately not reading TIKTOK_CLIENT_KEY: having the credentials
     * would not make this provider work, and returning true on their
     * presence alone would offer merchants a button that cannot finish. */
    return false;
  },

  unavailableReason(): string | null {
    return 'TikTok isn’t available yet. We’ll turn it on once TikTok approves MansaaS for posting.';
  },

  /* Answers, rather than throwing, so a screen can render the row greyed
   * out. The numbers are TikTok's documented caption limit and the
   * single-video shape; they are not used to publish anything today. */
  publishRules(): PublishRules {
    return { imagesRequired: true, maxImages: 1, maxCaptionChars: 2_200, supportsLinkInCaption: false };
  },

  buildAuthorizationUrl: notYet,
  exchangeCode: notYet,
  verifyToken: notYet,
  revoke: notYet,
  publishPost: notYet,
};
