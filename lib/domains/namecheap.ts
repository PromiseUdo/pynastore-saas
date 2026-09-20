/*
 * lib/domains/namecheap.ts
 *
 * Thin client for the Namecheap XML API — search/pricing ONLY. Registration
 * and DNS setup are performed manually by platform admins (see DomainOrder
 * in prisma/schema.prisma), so this file never calls Namecheap's
 * domains.create or dns.* endpoints.
 *
 * Response shapes below were captured from a live call to the sandbox API
 * (namecheap.domains.check, namecheap.users.getPricing), not guessed.
 */
import { XMLParser } from 'fast-xml-parser';

const REPEATABLE_TAGS = new Set(['DomainCheckResult', 'ProductCategory', 'Product', 'Price', 'Error']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (tagName) => REPEATABLE_TAGS.has(tagName),
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function baseUrl(): string {
  return process.env.NAMECHEAP_SANDBOX === 'true'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';
}

/*
 * Namecheap requires the ClientIp param to exactly match the whitelisted IP
 * on the account AND the actual source IP of the HTTP request. A
 * NAMECHEAP_CLIENT_IP hardcoded in .env goes stale the moment the server's
 * public IP changes (routine on residential/dynamic connections), so
 * requests start failing with "Invalid request IP" — the IP in the error is
 * Namecheap's own detection of the real caller, not what we sent. Detect
 * the current outbound IP at request time instead of trusting the env var
 * blindly; fall back to it only if detection fails.
 */
const CLIENT_IP_CACHE_TTL_MS = 5 * 60 * 1000; // public IP rarely changes minute-to-minute
let cachedClientIp: { ip: string; expiresAt: number } | null = null;

async function detectPublicIp(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const { ip } = (await res.json()) as { ip?: string };
    return ip ?? null;
  } catch {
    return null;
  }
}

async function resolveClientIp(): Promise<string> {
  if (cachedClientIp && cachedClientIp.expiresAt > Date.now()) return cachedClientIp.ip;

  const detected = await detectPublicIp();
  const ip = detected ?? process.env.NAMECHEAP_CLIENT_IP;

  if (!ip) {
    throw new Error(
      'Could not determine an outbound IP for the Namecheap API call (detection failed and NAMECHEAP_CLIENT_IP is unset).',
    );
  }

  cachedClientIp = { ip, expiresAt: Date.now() + CLIENT_IP_CACHE_TTL_MS };
  return ip;
}

async function credentials(): Promise<URLSearchParams> {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;

  if (!apiUser || !apiKey) {
    throw new Error('Namecheap API credentials are not configured (NAMECHEAP_API_USER / NAMECHEAP_API_KEY).');
  }

  const userName = process.env.NAMECHEAP_USERNAME ?? apiUser;
  const clientIp = await resolveClientIp();

  return new URLSearchParams({ ApiUser: apiUser, ApiKey: apiKey, UserName: userName, ClientIp: clientIp });
}

async function namecheapRequest(command: string, params: Record<string, string>): Promise<any> {
  const query = await credentials();
  query.set('Command', command);
  for (const [key, value] of Object.entries(params)) query.set(key, value);

  const res = await fetch(`${baseUrl()}?${query.toString()}`);
  const text = await res.text();
  const parsed = parser.parse(text);
  const apiResponse = parsed.ApiResponse;

  if (!apiResponse) {
    throw new Error(`Namecheap API returned an unexpected response for ${command}.`);
  }

  if (apiResponse.Status !== 'OK') {
    const errors = toArray(apiResponse.Errors?.Error);
    const message = errors.map((e: any) => (typeof e === 'object' ? e['#text'] : e)).join('; ');

    if (/invalid request ip/i.test(message)) {
      // Invalidate so the next call re-detects rather than retrying the same bad IP.
      cachedClientIp = null;
      throw new Error(
        `Namecheap rejected this server's IP (${query.get('ClientIp')}). ` +
          `Whitelist it under Profile → Tools → API Access on ${
            process.env.NAMECHEAP_SANDBOX === 'true' ? 'the Namecheap SANDBOX account' : 'namecheap.com'
          }, then retry.`,
      );
    }

    throw new Error(`Namecheap API error (${command}): ${message || 'Unknown error'}`);
  }

  return apiResponse.CommandResponse;
}

/** Lowercased, protocol/whitespace-stripped. Throws if the result doesn't look like a domain. */
export function normalizeDomain(rawDomain: string): string {
  const domain = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  if (!isValidDomainFormat(domain)) {
    throw new Error(`"${rawDomain}" doesn't look like a valid domain.`);
  }

  return domain;
}

export function isValidDomainFormat(domain: string): boolean {
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

async function checkAvailability(
  domain: string,
): Promise<{ available: boolean; isPremium: boolean; premiumPriceUsd?: number }> {
  const commandResponse = await namecheapRequest('namecheap.domains.check', { DomainList: domain });
  const results = toArray(commandResponse.DomainCheckResult);
  const result = results.find((r: any) => r.Domain?.toLowerCase() === domain) ?? results[0];

  if (!result) {
    throw new Error(`Namecheap returned no availability result for ${domain}.`);
  }

  const available = result.Available === 'true';
  const isPremium = result.IsPremiumName === 'true';
  const premiumPriceUsd = isPremium ? parseFloat(result.PremiumRegistrationPrice) : undefined;

  return { available, isPremium, premiumPriceUsd };
}

const TLD_PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — TLD registration pricing rarely changes
const tldPriceCache = new Map<string, { priceUsd: number; expiresAt: number }>();

async function getTldRegistrationPriceUsd(tld: string): Promise<number> {
  const cached = tldPriceCache.get(tld);
  if (cached && cached.expiresAt > Date.now()) return cached.priceUsd;

  const commandResponse = await namecheapRequest('namecheap.users.getPricing', {
    ProductType: 'DOMAIN',
    ProductCategory: 'REGISTER',
    ProductName: tld,
  });

  // Namecheap's sandbox ignores the ProductCategory filter and returns every
  // category (register/renew/transfer/reactivate) regardless — filter client-side.
  const categories = toArray(commandResponse?.UserGetPricingResult?.ProductType?.ProductCategory);
  const registerCategory = categories.find((c: any) => c.Name?.toLowerCase() === 'register');
  const products = toArray(registerCategory?.Product);
  const product = products.find((p: any) => p.Name?.toLowerCase() === tld.toLowerCase());
  const prices = toArray(product?.Price);
  const oneYear = prices.find((p: any) => p.Duration === '1' && p.DurationType === 'YEAR');

  if (!oneYear) {
    throw new Error(`No 1-year registration price found for the .${tld} TLD.`);
  }

  const priceUsd = parseFloat(oneYear.YourPrice ?? oneYear.Price);
  tldPriceCache.set(tld, { priceUsd, expiresAt: Date.now() + TLD_PRICE_CACHE_TTL_MS });
  return priceUsd;
}

export type DomainSearchResult =
  | { domain: string; available: false }
  | { domain: string; available: true; priceUsd: number };

export async function searchDomain(rawDomain: string): Promise<DomainSearchResult> {
  const domain = normalizeDomain(rawDomain);
  const { available, isPremium, premiumPriceUsd } = await checkAvailability(domain);

  if (!available) return { domain, available: false };

  if (isPremium && premiumPriceUsd) {
    return { domain, available: true, priceUsd: premiumPriceUsd };
  }

  // First label is the domain name, the rest is the TLD (e.g. "acme" + "com",
  // or "acme" + "co.uk"). getTldRegistrationPriceUsd looks it up as one string.
  const tld = domain.split('.').slice(1).join('.');
  const priceUsd = await getTldRegistrationPriceUsd(tld);
  return { domain, available: true, priceUsd };
}
