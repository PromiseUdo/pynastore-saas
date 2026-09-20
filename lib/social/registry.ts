/*
 * lib/social/registry.ts
 *
 * Platform → provider. The single place that knows which implementation
 * serves which platform, so adding one is one entry here plus one file under
 * providers/.
 *
 * `providerKey` is the unit a merchant authorises: one Meta hop yields both
 * a Facebook Page and its Instagram account, so those two platforms share a
 * provider and a connect button.
 */
import type { SocialPlatform, SocialProvider } from './types';
import { SocialProviderError } from './types';
import { metaProvider } from './providers/meta';
import { tiktokProvider } from './providers/tiktok';

/** What the connect buttons are keyed by — one per authorisation flow. */
export type ProviderKey = 'meta' | 'tiktok';

const PROVIDERS: Record<ProviderKey, SocialProvider> = {
  meta: metaProvider,
  tiktok: tiktokProvider,
};

/** The platform a provider's OAuth flow is recorded against in state/drafts. */
const PRIMARY_PLATFORM: Record<ProviderKey, SocialPlatform> = {
  meta: 'FACEBOOK_PAGE',
  tiktok: 'TIKTOK',
};

const OWNER: Record<SocialPlatform, ProviderKey> = {
  FACEBOOK_PAGE: 'meta',
  INSTAGRAM_BUSINESS: 'meta',
  TIKTOK: 'tiktok',
};

export function isProviderKey(value: string): value is ProviderKey {
  return value === 'meta' || value === 'tiktok';
}

export function getProvider(key: ProviderKey): SocialProvider {
  const provider = PROVIDERS[key];
  if (!provider) throw new SocialProviderError('unsupported', `No provider for "${key}"`);
  return provider;
}

/** The provider that operates a given platform's connections. */
export function getProviderForPlatform(platform: SocialPlatform): SocialProvider {
  return getProvider(OWNER[platform]);
}

export function primaryPlatform(key: ProviderKey): SocialPlatform {
  return PRIMARY_PLATFORM[key];
}

/** What the connect screen lists: every provider, configured or not. */
export function listProviders(): { key: ProviderKey; label: string; configured: boolean; reason: string | null }[] {
  return (Object.keys(PROVIDERS) as ProviderKey[]).map((key) => {
    const provider = PROVIDERS[key];
    return {
      key,
      label: provider.label,
      configured: provider.isConfigured(),
      reason: provider.unavailableReason(),
    };
  });
}
