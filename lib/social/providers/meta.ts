/*
 * lib/social/providers/meta.ts
 *
 * Facebook Pages and Instagram professional accounts, over the Graph API.
 *
 * ONE APP, MANY MERCHANTS. META_APP_ID / META_APP_SECRET belong to the
 * MansaaS platform and are configured once, server-side. A merchant never
 * supplies credentials: they authorise this one app against their own Meta
 * account, and what MansaaS keeps is the resulting per-merchant token. The
 * app secret is used only here, only in a server process, and never leaves
 * it — not in a redirect, not in a DTO, not in a log line.
 *
 * The flow implemented here is "Instagram API with Facebook Login"
 * (host graph.facebook.com), which is what lets one authorisation cover both
 * a Page and the Instagram professional account linked to it:
 *
 *   1. dialog/oauth               → merchant grants scopes
 *   2. oauth/access_token         → short-lived user token   (needs secret)
 *   3. fb_exchange_token          → long-lived user token, ~60 days
 *   4. GET /me/accounts           → the Pages they can act on, each with its
 *                                   own Page access token. A Page token
 *                                   derived from a long-lived user token does
 *                                   not expire on a clock, which is why we
 *                                   store the Page token and not the user's.
 *   5. GET /{page}?fields=instagram_business_account
 *                                 → the IG professional account, if linked.
 *                                   It publishes with the PAGE's token.
 *
 * Every call carries `appsecret_proof` (HMAC-SHA256 of the token under the
 * app secret), which Meta uses to reject a token replayed from outside this
 * app. The proof is a hash of the secret, never the secret itself.
 *
 * Scopes requested (Meta docs, Graph v26.0):
 *   pages_show_list            list the merchant's Pages
 *   pages_read_engagement      read Page details + the IG link
 *   pages_manage_posts         publish to the Page feed        (next phase)
 *   instagram_basic            read the IG professional account
 *   instagram_content_publish  publish to Instagram            (next phase)
 *   business_management        Pages held through Business Manager
 *
 * The two publishing scopes are requested now on purpose: asking again later
 * would mean every merchant re-authorising. All six need Advanced Access via
 * Meta App Review before merchants outside the app's own testers can grant
 * them.
 */
import { createHmac } from 'node:crypto';
import type {
  AuthorizationRequest,
  ProviderAccount,
  ProviderAuthResult,
  PublishRequest,
  PublishResult,
  PublishRules,
  SocialErrorKind,
  SocialPlatform,
  SocialProvider,
} from '../types';
import { SocialProviderError } from '../types';

/** Pinned deliberately: Meta versions expire, and a silent bump is a silent breakage. */
export const GRAPH_VERSION = 'v26.0';

const GRAPH_HOST = 'https://graph.facebook.com';
const DIALOG_HOST = 'https://www.facebook.com';
const TIMEOUT_MS = 10_000;

/* Publishing is slower than reading: Instagram fetches every image from our
 * CDN before it answers, so a carousel legitimately takes longer than a
 * read. */
const PUBLISH_TIMEOUT_MS = 30_000;

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const;

function appId(): string | null {
  return process.env.META_APP_ID?.trim() || null;
}

function appSecret(): string | null {
  return process.env.META_APP_SECRET?.trim() || null;
}

/**
 * Proves to Meta that a call comes from this app. Without it, a token that
 * leaked could be used from anywhere; with it, only a caller holding the app
 * secret can spend it.
 */
function appSecretProof(accessToken: string): string {
  const secret = appSecret();
  if (!secret) throw new SocialProviderError('not_configured', 'META_APP_SECRET is not set');
  return createHmac('sha256', secret).update(accessToken).digest('hex');
}

/* ─── Graph plumbing ────────────────────────────────────────────────────── */

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

/** Meta's error codes, translated into something the app can act on. */
function classify(status: number, body: GraphErrorBody | null): { kind: SocialErrorKind; code?: string } {
  const code = body?.error?.code;
  const subcode = body?.error?.error_subcode;
  const asString = subcode ? `${code}/${subcode}` : code != null ? String(code) : undefined;

  // 190: the token is no longer usable (expired, password changed, app removed).
  if (code === 190) return { kind: 'token_invalid', code: asString };
  // 10 / 200-299: the app holds a token but not the permission it needs.
  if (code === 10 || (code != null && code >= 200 && code < 300)) {
    return { kind: 'permission_missing', code: asString };
  }
  // 4 / 17 / 32 / 613: throttled.
  if (code === 4 || code === 17 || code === 32 || code === 613) return { kind: 'rate_limited', code: asString };
  if (status === 401 || status === 403) return { kind: 'token_invalid', code: asString };
  return { kind: 'unavailable', code: asString };
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new SocialProviderError('unavailable', timedOut ? 'Meta timed out' : 'Meta unreachable');
  }

  const body = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;

  if (!res.ok || body?.error) {
    const { kind, code } = classify(res.status, body);
    /* The message is for our logs. It can quote Meta's own text, which never
     * contains the app secret — the secret only ever travels as a request
     * parameter, and Meta does not echo parameters back in errors. */
    const detail = body?.error?.message?.slice(0, 300) ?? `HTTP ${res.status}`;
    throw new SocialProviderError(kind, `Meta ${path}: ${detail}`, code);
  }
  if (!body) throw new SocialProviderError('unavailable', `Meta ${path}: empty response`);
  return body as T;
}

/** Authenticated Graph read: token + proof on every call. */
async function graphGetAs<T>(path: string, accessToken: string, params: Record<string, string> = {}): Promise<T> {
  return graphGet<T>(path, {
    ...params,
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken),
  });
}

/**
 * Authenticated Graph write. Parameters go in the POST BODY, not the query
 * string: a caption or an image URL in a URL can end up in an access log or
 * a proxy's history, and the access token would ride along with it.
 */
async function graphPostAs<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams({
    ...params,
    access_token: accessToken,
    appsecret_proof: appSecretProof(accessToken),
  });

  let res: Response;
  try {
    res = await fetch(`${GRAPH_HOST}/${GRAPH_VERSION}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new SocialProviderError('unavailable', timedOut ? 'Meta timed out' : 'Meta unreachable');
  }

  const parsed = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;

  if (!res.ok || parsed?.error) {
    const { kind, code } = classify(res.status, parsed);
    throw new SocialProviderError(kind, `Meta ${path}: ${parsed?.error?.message?.slice(0, 300) ?? `HTTP ${res.status}`}`, code);
  }
  if (!parsed) throw new SocialProviderError('unavailable', `Meta ${path}: empty response`);
  return parsed as T;
}

/**
 * A link to the published post, when Meta will give us one. Best effort by
 * design: the post IS published by the time this runs, so a failure here
 * must never turn a successful publish into a failed one.
 */
async function permalinkFor(id: string, accessToken: string, field: 'permalink' | 'permalink_url'): Promise<string | null> {
  try {
    const data = await graphGetAs<Record<string, string>>(id, accessToken, { fields: field });
    return data[field] ?? null;
  } catch {
    return null;
  }
}

/* ─── Graph response shapes ─────────────────────────────────────────────── */

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface PagesResponse {
  data?: {
    id: string;
    name: string;
    access_token?: string;
    username?: string;
    tasks?: string[];
    picture?: { data?: { url?: string } };
    instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
  }[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface PermissionsResponse {
  data?: { permission: string; status: string }[];
}

/* ─── Publishing ────────────────────────────────────────────────────────── */

/**
 * A photo post, or a text/link post when there is no photo.
 *
 * Two documented endpoints, each returning its own id shape:
 *   POST /{page-id}/photos  {url, caption}      → { id, post_id }
 *   POST /{page-id}/feed    {message, link}     → { id }
 *
 * The photo call's `post_id` is the thing a person can open — `id` is the
 * photo object — so that is what we keep when it's there.
 */
async function publishToFacebookPage({
  platformAccountId,
  accessToken,
  message,
  imageUrls,
  link,
}: PublishRequest): Promise<PublishResult> {
  if (imageUrls.length > 0) {
    const created = await graphPostAs<{ id: string; post_id?: string }>(
      `${platformAccountId}/photos`,
      accessToken,
      { url: imageUrls[0], caption: message },
    );
    const postId = created.post_id ?? created.id;
    return { externalPostId: postId, externalUrl: await permalinkFor(postId, accessToken, 'permalink_url') };
  }

  const created = await graphPostAs<{ id: string }>(`${platformAccountId}/feed`, accessToken, {
    message,
    ...(link ? { link } : {}),
  });
  return { externalPostId: created.id, externalUrl: await permalinkFor(created.id, accessToken, 'permalink_url') };
}

/**
 * Instagram's two-step publish, which is three steps for a carousel:
 *
 *   single:    POST /{ig-id}/media {image_url, caption} → creation_id
 *   carousel:  POST /{ig-id}/media {image_url, is_carousel_item:true} per image
 *              POST /{ig-id}/media {media_type:CAROUSEL, children, caption}
 *   then:      POST /{ig-id}/media_publish {creation_id}
 *
 * Instagram fetches each image from the URL we pass ("cURLs your image using
 * the passed in URL so it must be on a public server"), which is why the
 * images must be the Cloudinary URLs the storefront already serves and not
 * anything private.
 *
 * A container that is created but never published costs nothing and expires
 * on Meta's side, so a failure between the steps leaves no half-post — which
 * is what lets the caller treat any throw here as "not published".
 */
async function publishToInstagram({
  platformAccountId,
  accessToken,
  message,
  imageUrls,
}: PublishRequest): Promise<PublishResult> {
  if (imageUrls.length === 0) {
    throw new SocialProviderError('denied', 'Instagram needs at least one image');
  }

  let creationId: string;

  if (imageUrls.length === 1) {
    const container = await graphPostAs<{ id: string }>(`${platformAccountId}/media`, accessToken, {
      image_url: imageUrls[0],
      caption: message,
    });
    creationId = container.id;
  } else {
    const children: string[] = [];
    for (const imageUrl of imageUrls) {
      const child = await graphPostAs<{ id: string }>(`${platformAccountId}/media`, accessToken, {
        image_url: imageUrl,
        is_carousel_item: 'true',
      });
      children.push(child.id);
    }
    const container = await graphPostAs<{ id: string }>(`${platformAccountId}/media`, accessToken, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: message,
    });
    creationId = container.id;
  }

  const published = await graphPostAs<{ id: string }>(`${platformAccountId}/media_publish`, accessToken, {
    creation_id: creationId,
  });

  return { externalPostId: published.id, externalUrl: await permalinkFor(published.id, accessToken, 'permalink') };
}

/* ─── The provider ──────────────────────────────────────────────────────── */

export const metaProvider: SocialProvider = {
  platforms: ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS'] as const,
  label: 'Facebook & Instagram',

  isConfigured(): boolean {
    return Boolean(appId() && appSecret());
  },

  unavailableReason(): string | null {
    if (!appId() || !appSecret()) {
      return 'Facebook and Instagram aren’t set up on this MansaaS installation yet.';
    }
    return null;
  },

  buildAuthorizationUrl({ state, redirectUri }: AuthorizationRequest): string {
    const id = appId();
    if (!id) throw new SocialProviderError('not_configured', 'META_APP_ID is not set');

    const url = new URL(`${DIALOG_HOST}/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', META_SCOPES.join(','));
    return url.toString();
  },

  async exchangeCode(code: string, redirectUri: string): Promise<ProviderAuthResult> {
    const id = appId();
    const secret = appSecret();
    if (!id || !secret) throw new SocialProviderError('not_configured', 'Meta app credentials are not set');

    // 2. Code → short-lived user token. The app secret is in this request,
    //    which is exactly why it can only happen server-side.
    const short = await graphGet<TokenResponse>('oauth/access_token', {
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      code,
    });

    // 3. Short-lived → long-lived (~60 days). Page tokens derived from it
    //    are the ones that don't expire, so this step matters.
    const long = await graphGet<TokenResponse>('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: id,
      client_secret: secret,
      fb_exchange_token: short.access_token,
    });

    const userToken = long.access_token;

    const granted = await graphGetAs<PermissionsResponse>('me/permissions', userToken);
    const grantedScopes = (granted.data ?? [])
      .filter((entry) => entry.status === 'granted')
      .map((entry) => entry.permission);

    if (!grantedScopes.includes('pages_show_list')) {
      throw new SocialProviderError(
        'permission_missing',
        'The merchant did not grant pages_show_list, so no Page can be listed',
      );
    }

    // 4 + 5. Pages, each with its Page token, and the IG account linked to
    //        it — asked for in one call so a merchant with several Pages
    //        doesn't pay a round trip per Page.
    const pages = await graphGetAs<PagesResponse>('me/accounts', userToken, {
      fields:
        'id,name,username,access_token,tasks,picture{url},' +
        'instagram_business_account{id,username,name,profile_picture_url}',
      limit: '100',
    });

    const accounts: ProviderAccount[] = [];

    for (const page of pages.data ?? []) {
      /* A Page token is only returned when the merchant can actually act on
       * that Page. Without one there is nothing to store, so the Page is
       * offered with the reason spelled out rather than silently dropped. */
      if (!page.access_token) {
        accounts.push({
          platform: 'FACEBOOK_PAGE',
          platformAccountId: page.id,
          accountName: page.name,
          username: page.username ?? null,
          avatarUrl: page.picture?.data?.url ?? null,
          accessToken: '',
          tokenExpiresAt: null,
          scopes: grantedScopes,
          parentAccountId: null,
          unavailableReason: 'You need a Page role that allows posting before this Page can be connected.',
        });
        continue;
      }

      const canPublish = !page.tasks || page.tasks.includes('CREATE_CONTENT') || page.tasks.includes('MANAGE');

      accounts.push({
        platform: 'FACEBOOK_PAGE',
        platformAccountId: page.id,
        accountName: page.name,
        username: page.username ?? null,
        avatarUrl: page.picture?.data?.url ?? null,
        accessToken: page.access_token,
        tokenExpiresAt: null, // long-lived Page tokens carry no expiry
        scopes: grantedScopes,
        parentAccountId: null,
        unavailableReason: canPublish
          ? null
          : 'Your role on this Page doesn’t allow posting, so MansaaS can’t publish to it.',
      });

      const ig = page.instagram_business_account;
      if (ig?.id) {
        /* Instagram publishes on the linked PAGE's token — there is no
         * separate IG credential in this flow. Storing the Page token here
         * too keeps every connection self-contained, so publishing never has
         * to go looking for its parent's row mid-request. */
        accounts.push({
          platform: 'INSTAGRAM_BUSINESS',
          platformAccountId: ig.id,
          accountName: ig.name ?? ig.username ?? page.name,
          username: ig.username ?? null,
          avatarUrl: ig.profile_picture_url ?? null,
          accessToken: page.access_token,
          tokenExpiresAt: null,
          scopes: grantedScopes,
          parentAccountId: page.id,
          unavailableReason: grantedScopes.includes('instagram_basic')
            ? null
            : 'Instagram access wasn’t granted. Reconnect and allow Instagram to use this account.',
        });
      }
    }

    return { accounts, grantedScopes };
  },

  async verifyToken(accessToken, platformAccountId) {
    try {
      await graphGetAs<{ id: string }>(platformAccountId, accessToken, { fields: 'id' });
      return { ok: true };
    } catch (error) {
      if (error instanceof SocialProviderError) return { ok: false, kind: error.kind, code: error.code };
      return { ok: false, kind: 'unavailable' };
    }
  },

  publishRules(platform: SocialPlatform): PublishRules {
    if (platform === 'INSTAGRAM_BUSINESS') {
      return {
        /* Instagram has no text-only post: every publish starts from a media
         * container built around an image. */
        imagesRequired: true,
        /* Meta: "Carousels are limited to 10 images, videos, or a mix." */
        maxImages: 10,
        maxCaptionChars: 2_200,
        /* A link in an Instagram caption is plain text — not tappable. The
         * composer says so rather than letting a merchant post a dead link. */
        supportsLinkInCaption: false,
      };
    }
    return {
      imagesRequired: false,
      /* One. Meta's Pages Posts guide documents publishing a single photo to
       * /{page-id}/photos; the multi-photo (attached_media) flow is not
       * documented there, and this integration does not build on undocumented
       * behaviour. The composer tells the merchant the first image is used. */
      maxImages: 1,
      maxCaptionChars: 63_206,
      supportsLinkInCaption: true,
    };
  },

  async publishPost(request: PublishRequest): Promise<PublishResult> {
    return request.platform === 'INSTAGRAM_BUSINESS'
      ? publishToInstagram(request)
      : publishToFacebookPage(request);
  },

  async revoke(accessToken, platformAccountId) {
    /* DELETE /{id}/permissions drops this app's access for that account.
     * Best effort by contract: the local disconnect has already been decided
     * and must not depend on Meta answering. */
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${platformAccountId}/permissions`);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('appsecret_proof', appSecretProof(accessToken));
    await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  },
};
