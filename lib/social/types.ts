/*
 * lib/social/types.ts
 *
 * The platform-agnostic shapes the rest of the app speaks in. Nothing above
 * lib/social/providers/ may mention Pages, IG User IDs, Graph versions or
 * app secrets: the UI and the server actions only ever see the types here.
 *
 * That is what makes TikTok an additive change — a new file under
 * providers/, a new entry in registry.ts, and a new enum member. No page, no
 * action and no service function has to change.
 *
 * TOKEN RULE: no type in this file that a client component can receive
 * carries a token. `SocialAccountRow` and `SocialCandidate` are the two
 * shapes that cross into the browser, and neither has a token field.
 * Tokens live in `ProviderAccount.accessToken`, which is sealed the moment
 * it reaches the database and only ever opened inside a provider.
 */
import type { SocialConnectionStatus, SocialPlatform, SocialPostStatus } from '@/lib/generated/prisma/enums';

export type { SocialConnectionStatus, SocialPlatform, SocialPostStatus };

/* ─── What the browser is allowed to see ────────────────────────────────── */

/**
 * A connected account as the merchant's screen renders it. Deliberately has
 * no token, no organizationId and no app credential.
 */
export interface SocialAccountRow {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  username: string | null;
  avatarUrl: string | null;
  status: SocialConnectionStatus;
  connectedAt: string;
  lastCheckedAt: string | null;
  /** Plain-language reason the connection stopped working, when it has. */
  problem: string | null;
  /** The Facebook Page row an Instagram account hangs off, when it has one. */
  parentConnectionId: string | null;
}

/**
 * One account the merchant may choose to connect, shown on the chooser after
 * the OAuth hop. The token that came with it stays on the server, in the
 * draft row.
 */
export interface SocialCandidate {
  /** Stable within one draft; the platform's own account id. */
  platformAccountId: string;
  platform: SocialPlatform;
  accountName: string;
  username: string | null;
  avatarUrl: string | null;
  /** True when this account is already connected to this store. */
  alreadyConnected: boolean;
  /**
   * Why this account can't be connected, in plain words — e.g. an Instagram
   * account with no linked Page. Null means it can be chosen.
   */
  unavailableReason: string | null;
  /** For an Instagram account: the Page id it publishes through. */
  parentAccountId: string | null;
}

/**
 * One row of post history, as the merchant's screen renders it. No token, no
 * organizationId, no platform credential — the same rule as SocialAccountRow.
 */
export interface SocialPostRow {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  status: SocialPostStatus;
  productName: string | null;
  productUrl: string | null;
  caption: string;
  hashtags: string[];
  imageUrls: string[];
  externalUrl: string | null;
  /** Plain-language reason the last attempt failed. Null when it didn't. */
  problem: string | null;
  attempts: number;
  createdAt: string;
  publishedAt: string | null;
}

/* ─── What only the server sees ─────────────────────────────────────────── */

/**
 * An account plus the credential that operates it, as a provider resolved it
 * from the platform. Never serialised anywhere a browser can reach.
 */
export interface ProviderAccount {
  platform: SocialPlatform;
  platformAccountId: string;
  accountName: string;
  username: string | null;
  avatarUrl: string | null;
  /** The operating token, in the clear. Sealed before it is stored. */
  accessToken: string;
  /** Null when the token has no expiry (the normal Page-token case). */
  tokenExpiresAt: Date | null;
  scopes: string[];
  /** For Instagram: the Page account id whose token publishes for it. */
  parentAccountId: string | null;
  unavailableReason: string | null;
}

/** The candidate list a completed OAuth hop produced, parked in a draft row. */
export interface ProviderAuthResult {
  accounts: ProviderAccount[];
  /** Scopes the merchant actually granted, for the reconnect hint. */
  grantedScopes: string[];
}

/* ─── Publishing ────────────────────────────────────────────────────────── */

/**
 * One post, as a provider receives it. Assembled server-side in
 * lib/social/publish.ts from rows the store owns — the caller never hands a
 * provider a caption, an image or a link that came straight off a form.
 */
export interface PublishRequest {
  platform: SocialPlatform;
  /** The account to post to: a Page id or an IG User id. */
  platformAccountId: string;
  /** The operating token, already decrypted. Never logged. */
  accessToken: string;
  /** Caption with the hashtags already appended, exactly as it will appear. */
  message: string;
  /**
   * Public image URLs. Instagram requires at least one and fetches each from
   * a public server; Facebook can post with none.
   */
  imageUrls: string[];
  /** The storefront product link, when the platform can make it clickable. */
  link: string | null;
}

export interface PublishResult {
  /** The platform's id for the post. Absent means it did not publish. */
  externalPostId: string;
  /** A link the merchant can open, when the platform returns one. */
  externalUrl: string | null;
}

/** What a platform will accept, so the composer can say so before publishing. */
export interface PublishRules {
  /** Instagram cannot post without an image; Facebook can. */
  imagesRequired: boolean;
  maxImages: number;
  maxCaptionChars: number;
  /** False when links in the caption aren't clickable (Instagram). */
  supportsLinkInCaption: boolean;
}

/* ─── The provider contract ─────────────────────────────────────────────── */

/**
 * Errors a provider raises. The `kind` is what the UI reacts to; the message
 * is for server logs and is never shown verbatim to a merchant.
 */
export type SocialErrorKind =
  | 'not_configured'
  | 'denied'
  | 'invalid_state'
  | 'token_invalid'
  | 'permission_missing'
  | 'rate_limited'
  | 'unavailable'
  | 'unsupported';

export class SocialProviderError extends Error {
  constructor(
    readonly kind: SocialErrorKind,
    message: string,
    /** The platform's own error subcode, when it sent one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SocialProviderError';
  }
}

/** Where the merchant should be returned to, and under whose identity. */
export interface AuthorizationRequest {
  /** Signed, opaque; carries the tenant across the redirect. See state.ts. */
  state: string;
  /** Absolute callback URL registered with the platform. */
  redirectUri: string;
}

export interface SocialProvider {
  /** The platforms this provider can produce connections for. */
  readonly platforms: readonly SocialPlatform[];
  /** Merchant-facing name, e.g. "Facebook & Instagram". */
  readonly label: string;

  /**
   * False when the platform credentials aren't configured on this
   * deployment. The UI shows the button disabled with an honest reason
   * rather than starting a flow that cannot finish.
   */
  isConfigured(): boolean;

  /** Why it isn't configured/available, for that hint. Null when it is. */
  unavailableReason(): string | null;

  /** The URL to send the merchant to. Throws `not_configured` if it can't. */
  buildAuthorizationUrl(request: AuthorizationRequest): string;

  /**
   * Turns an authorization code into the accounts the merchant may connect.
   * Runs server-side only: this is where the app secret is used.
   */
  exchangeCode(code: string, redirectUri: string): Promise<ProviderAuthResult>;

  /**
   * Confirms a stored token still works, so the list can show an honest
   * status. Returns the problem when it doesn't.
   */
  verifyToken(
    accessToken: string,
    platformAccountId: string,
  ): Promise<{ ok: true } | { ok: false; kind: SocialErrorKind; code?: string }>;

  /**
   * Best-effort removal of MansaaS's access at the platform, called when a
   * merchant disconnects. A failure here must not block the local
   * disconnect — the merchant's intent is recorded either way.
   */
  revoke(accessToken: string, platformAccountId: string): Promise<void>;

  /** What this platform accepts, per destination type. */
  publishRules(platform: SocialPlatform): PublishRules;

  /**
   * Publishes one post and returns the platform's id for it.
   *
   * MUST throw rather than return on any failure: a caller that gets a
   * result marks the post published, so a provider that swallowed an error
   * would be lying to a merchant about their own storefront. A
   * SocialProviderError's `kind` decides whether the merchant sees "try
   * again", "reconnect this account" or "check your permissions".
   */
  publishPost(request: PublishRequest): Promise<PublishResult>;
}

/* ─── Merchant-facing labels ────────────────────────────────────────────── */

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  FACEBOOK_PAGE: 'Facebook Page',
  INSTAGRAM_BUSINESS: 'Instagram',
  TIKTOK: 'TikTok',
};

export const POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
};

export const CONNECTION_STATUS_LABELS: Record<SocialConnectionStatus, string> = {
  ACTIVE: 'Connected',
  EXPIRED: 'Needs reconnecting',
  REVOKED: 'Access removed',
  DISCONNECTED: 'Disconnected',
};
