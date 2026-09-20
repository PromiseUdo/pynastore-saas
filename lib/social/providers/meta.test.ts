/*
 * The Meta provider.
 *
 * Network calls are stubbed: what matters here is the shape of the flow, not
 * Graph's availability. Three things are worth pinning down —
 *
 *   1. the authorization URL asks for exactly the scopes publishing will
 *      need, so merchants are not asked to authorise twice;
 *   2. the app secret is used but never handed to the browser, and every
 *      authenticated call carries an appsecret_proof;
 *   3. a Page with an Instagram account linked to it produces TWO
 *      connectable accounts, the Instagram one carrying the Page's token,
 *      because that is how Instagram publishing actually works.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { metaProvider, META_SCOPES, GRAPH_VERSION } from './meta';
import { SocialProviderError } from '../types';

const REDIRECT = 'https://app.example.com/api/social/meta/callback';

/** Replies keyed by the Graph path being called. */
function stubGraph(replies: Record<string, unknown>, status = 200) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push(url);
      const match = Object.keys(replies).find((path) => url.pathname.includes(path));
      return {
        ok: status < 400,
        status,
        json: async () => (match ? replies[match] : {}),
      } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env.META_APP_ID = '1234567890';
  process.env.META_APP_SECRET = 'test-app-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configuration', () => {
  it('is configured when the platform credentials are present', () => {
    expect(metaProvider.isConfigured()).toBe(true);
    expect(metaProvider.unavailableReason()).toBeNull();
  });

  it('says so plainly when they are missing', () => {
    delete process.env.META_APP_SECRET;
    expect(metaProvider.isConfigured()).toBe(false);
    expect(metaProvider.unavailableReason()).toContain('aren’t set up');
  });
});

describe('buildAuthorizationUrl', () => {
  it('asks for the Page and Instagram scopes publishing will need', () => {
    const url = new URL(metaProvider.buildAuthorizationUrl({ state: 'signed-state', redirectUri: REDIRECT }));
    const scopes = url.searchParams.get('scope')!.split(',');

    expect(url.host).toBe('www.facebook.com');
    expect(url.pathname).toBe(`/${GRAPH_VERSION}/dialog/oauth`);
    expect(scopes).toEqual([...META_SCOPES]);
    expect(scopes).toContain('pages_manage_posts');
    expect(scopes).toContain('instagram_content_publish');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('never puts the app secret in the URL the browser follows', () => {
    const url = metaProvider.buildAuthorizationUrl({ state: 's', redirectUri: REDIRECT });
    expect(url).toContain('client_id=1234567890');
    expect(url).not.toContain('test-app-secret');
  });

  it('refuses to build a URL with no app configured', () => {
    delete process.env.META_APP_ID;
    expect(() => metaProvider.buildAuthorizationUrl({ state: 's', redirectUri: REDIRECT })).toThrow(
      SocialProviderError,
    );
  });
});

describe('exchangeCode', () => {
  const PAGES = {
    data: [
      {
        id: 'page_1',
        name: 'Acme Store',
        username: 'acmestore',
        access_token: 'PAGE_TOKEN_1',
        tasks: ['CREATE_CONTENT', 'MANAGE'],
        picture: { data: { url: 'https://cdn.example.com/a.jpg' } },
        instagram_business_account: { id: 'ig_1', username: 'acme', name: 'Acme' },
      },
    ],
  };

  const PERMISSIONS = {
    data: [
      { permission: 'pages_show_list', status: 'granted' },
      { permission: 'pages_manage_posts', status: 'granted' },
      { permission: 'instagram_basic', status: 'granted' },
      { permission: 'instagram_content_publish', status: 'declined' },
    ],
  };

  it('returns the Page and its Instagram account, both on the Page token', async () => {
    stubGraph({
      'oauth/access_token': { access_token: 'USER_TOKEN', expires_in: 5184000 },
      'me/permissions': PERMISSIONS,
      'me/accounts': PAGES,
    });

    const result = await metaProvider.exchangeCode('auth-code', REDIRECT);

    expect(result.accounts).toHaveLength(2);

    const page = result.accounts.find((a) => a.platform === 'FACEBOOK_PAGE')!;
    expect(page).toMatchObject({
      platformAccountId: 'page_1',
      accountName: 'Acme Store',
      username: 'acmestore',
      accessToken: 'PAGE_TOKEN_1',
      tokenExpiresAt: null, // long-lived Page tokens don't expire on a clock
      unavailableReason: null,
    });

    const instagram = result.accounts.find((a) => a.platform === 'INSTAGRAM_BUSINESS')!;
    expect(instagram).toMatchObject({
      platformAccountId: 'ig_1',
      username: 'acme',
      accessToken: 'PAGE_TOKEN_1', // Instagram publishes on the Page's token
      parentAccountId: 'page_1',
      unavailableReason: null,
    });

    expect(result.grantedScopes).not.toContain('instagram_content_publish');
  });

  it('exchanges for a long-lived token and proves every authenticated call', async () => {
    const calls = stubGraph({
      'oauth/access_token': { access_token: 'USER_TOKEN' },
      'me/permissions': PERMISSIONS,
      'me/accounts': PAGES,
    });

    await metaProvider.exchangeCode('auth-code', REDIRECT);

    const paths = calls.map((url) => url.pathname);
    expect(paths.filter((p) => p.includes('oauth/access_token'))).toHaveLength(2);
    expect(calls.some((url) => url.searchParams.get('grant_type') === 'fb_exchange_token')).toBe(true);

    for (const url of calls) {
      if (url.searchParams.has('access_token') && !url.searchParams.has('client_secret')) {
        expect(url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it('offers a Page the merchant cannot post to, with the reason', async () => {
    stubGraph({
      'oauth/access_token': { access_token: 'USER_TOKEN' },
      'me/permissions': PERMISSIONS,
      'me/accounts': {
        data: [{ id: 'page_2', name: 'Someone Else’s Page', tasks: ['ANALYZE'] }],
      },
    });

    const result = await metaProvider.exchangeCode('auth-code', REDIRECT);
    expect(result.accounts[0].unavailableReason).toContain('Page role');
    expect(result.accounts[0].accessToken).toBe('');
  });

  it('fails clearly when the merchant did not grant pages_show_list', async () => {
    stubGraph({
      'oauth/access_token': { access_token: 'USER_TOKEN' },
      'me/permissions': { data: [{ permission: 'public_profile', status: 'granted' }] },
    });

    await expect(metaProvider.exchangeCode('auth-code', REDIRECT)).rejects.toMatchObject({
      kind: 'permission_missing',
    });
  });

  it('classifies an invalid token as token_invalid, not a generic outage', async () => {
    stubGraph({ 'oauth/access_token': { error: { message: 'Session expired', code: 190 } } }, 400);
    await expect(metaProvider.exchangeCode('auth-code', REDIRECT)).rejects.toMatchObject({ kind: 'token_invalid' });
  });

  it('classifies throttling as rate_limited', async () => {
    stubGraph({ 'oauth/access_token': { error: { message: 'Too many calls', code: 4 } } }, 400);
    await expect(metaProvider.exchangeCode('auth-code', REDIRECT)).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});

describe('verifyToken', () => {
  it('reports a working token', async () => {
    stubGraph({ page_1: { id: 'page_1' } });
    expect(await metaProvider.verifyToken('PAGE_TOKEN_1', 'page_1')).toEqual({ ok: true });
  });

  it('reports a revoked token with its subcode', async () => {
    stubGraph({ page_1: { error: { message: 'Invalid token', code: 190, error_subcode: 458 } } }, 400);
    expect(await metaProvider.verifyToken('PAGE_TOKEN_1', 'page_1')).toEqual({
      ok: false,
      kind: 'token_invalid',
      code: '190/458',
    });
  });
});

describe('publishRules', () => {
  it('describes Instagram as image-only with a dead link in captions', () => {
    const rules = metaProvider.publishRules('INSTAGRAM_BUSINESS');
    expect(rules.imagesRequired).toBe(true);
    expect(rules.maxImages).toBe(10);
    expect(rules.supportsLinkInCaption).toBe(false);
  });

  it('describes a Facebook Page as text-capable, one image, clickable link', () => {
    const rules = metaProvider.publishRules('FACEBOOK_PAGE');
    expect(rules.imagesRequired).toBe(false);
    expect(rules.maxImages).toBe(1);
    expect(rules.supportsLinkInCaption).toBe(true);
  });
});

/** Reads a stubbed POST call's body back as parameters. */
function bodyOf(call: [URL | string, { body?: BodyInit }]): URLSearchParams {
  return new URLSearchParams(String(call[1].body));
}

function stubPost(replies: Record<string, unknown>, status = 200) {
  const calls: [URL | string, { method?: string; body?: BodyInit }][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init: { method?: string; body?: BodyInit } = {}) => {
      calls.push([input, init]);
      const path = input instanceof URL ? input.pathname : String(input);
      const match = Object.keys(replies).find((key) => path.includes(key));
      return {
        ok: status < 400,
        status,
        json: async () => (match ? replies[match] : {}),
      } as Response;
    }),
  );
  return calls;
}

describe('publishing to a Facebook Page', () => {
  const REQUEST = {
    platform: 'FACEBOOK_PAGE' as const,
    platformAccountId: 'page_1',
    accessToken: 'PAGE_TOKEN',
    message: 'A lovely wrap dress.',
    imageUrls: ['https://cdn.example.com/1.jpg'],
    link: 'https://shop.example.com/products/dress',
  };

  it('posts a photo and returns the readable post id, not the photo id', async () => {
    const calls = stubPost({
      '/photos': { id: 'photo_1', post_id: 'page_1_post_1' },
      page_1_post_1: { permalink_url: 'https://facebook.com/page_1/posts/1' },
    });

    const result = await metaProvider.publishPost(REQUEST);

    expect(result.externalPostId).toBe('page_1_post_1');
    expect(result.externalUrl).toBe('https://facebook.com/page_1/posts/1');

    const publish = calls.find(([input]) => String(input).includes('/photos'))!;
    expect(publish[1].method).toBe('POST');
    // The caption and the token travel in the BODY, never in a loggable URL.
    expect(String(publish[0])).not.toContain('PAGE_TOKEN');
    expect(bodyOf(publish).get('url')).toBe('https://cdn.example.com/1.jpg');
    expect(bodyOf(publish).get('caption')).toBe('A lovely wrap dress.');
    expect(bodyOf(publish).get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('posts to the feed with a link when there is no image', async () => {
    const calls = stubPost({ '/feed': { id: 'page_1_post_2' } });

    await metaProvider.publishPost({ ...REQUEST, imageUrls: [] });

    const publish = calls.find(([input]) => String(input).includes('/feed'))!;
    expect(bodyOf(publish).get('message')).toBe('A lovely wrap dress.');
    expect(bodyOf(publish).get('link')).toBe('https://shop.example.com/products/dress');
  });

  it('still succeeds when the permalink lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const path = String(input);
        if (path.includes('/photos')) {
          return { ok: true, status: 200, json: async () => ({ id: 'p', post_id: 'page_1_post_3' }) } as Response;
        }
        return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) } as Response;
      }),
    );

    const result = await metaProvider.publishPost(REQUEST);
    expect(result.externalPostId).toBe('page_1_post_3');
    expect(result.externalUrl).toBeNull();
  });

  it('throws rather than reporting success when Meta refuses', async () => {
    stubPost({ '/photos': { error: { message: 'Permissions error', code: 200 } } }, 403);

    await expect(metaProvider.publishPost(REQUEST)).rejects.toMatchObject({ kind: 'permission_missing' });
  });
});

describe('publishing to Instagram', () => {
  const REQUEST = {
    platform: 'INSTAGRAM_BUSINESS' as const,
    platformAccountId: 'ig_1',
    accessToken: 'PAGE_TOKEN',
    message: 'A lovely wrap dress. #ankara',
    imageUrls: ['https://cdn.example.com/1.jpg'],
    link: null,
  };

  it('creates a container then publishes it', async () => {
    const calls = stubPost({
      '/media_publish': { id: 'ig_media_1' },
      '/media': { id: 'container_1' },
      ig_media_1: { permalink: 'https://instagram.com/p/abc' },
    });

    const result = await metaProvider.publishPost(REQUEST);

    expect(result.externalPostId).toBe('ig_media_1');
    expect(result.externalUrl).toBe('https://instagram.com/p/abc');

    const container = calls.find(([input]) => String(input).endsWith('ig_1/media'))!;
    expect(bodyOf(container).get('image_url')).toBe('https://cdn.example.com/1.jpg');
    expect(bodyOf(container).get('caption')).toBe('A lovely wrap dress. #ankara');

    const publish = calls.find(([input]) => String(input).includes('/media_publish'))!;
    expect(bodyOf(publish).get('creation_id')).toBe('container_1');
  });

  it('builds a carousel from several images', async () => {
    let container = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string, init: { body?: BodyInit } = {}) => {
        const path = String(input);
        if (path.includes('/media_publish')) {
          return { ok: true, status: 200, json: async () => ({ id: 'ig_media_2' }) } as Response;
        }
        if (path.endsWith('ig_1/media')) {
          const body = new URLSearchParams(String(init.body));
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: body.get('media_type') === 'CAROUSEL' ? 'carousel_1' : `child_${++container}` }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ permalink: 'https://instagram.com/p/xyz' }) } as Response;
      }),
    );

    const result = await metaProvider.publishPost({
      ...REQUEST,
      imageUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
    });

    expect(result.externalPostId).toBe('ig_media_2');
    expect(container).toBe(2);
  });

  it('refuses to publish with no image at all', async () => {
    const calls = stubPost({});
    await expect(metaProvider.publishPost({ ...REQUEST, imageUrls: [] })).rejects.toMatchObject({ kind: 'denied' });
    expect(calls).toHaveLength(0);
  });

  it('does not publish when the container fails', async () => {
    const calls = stubPost({ '/media': { error: { message: 'Bad image', code: 9004 } } }, 400);

    await expect(metaProvider.publishPost(REQUEST)).rejects.toBeInstanceOf(SocialProviderError);
    // Nothing reached media_publish, so nothing half-posted.
    expect(calls.some(([input]) => String(input).includes('/media_publish'))).toBe(false);
  });
});
