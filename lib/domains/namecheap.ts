/*
 * lib/domains/namecheap.ts
 *
 * Thin client for the Namecheap XML API — search, pricing and the account
 * balance: READ-ONLY. Registration and DNS setup are performed manually by
 * platform staff (the queue in the console, ROADMAP 11.5), so this file never
 * calls Namecheap's domains.create or dns.* endpoints — automating those is
 * ROADMAP 13.5.
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

type Availability = { domain: string; available: boolean; isPremium: boolean; premiumPriceUsd?: number; premiumRenewUsd?: number };

/** Up to 50 names in one call (Namecheap's DomainList). */
async function checkAvailabilityMany(domains: string[]): Promise<Availability[]> {
  if (domains.length === 0) return [];
  const commandResponse = await namecheapRequest('namecheap.domains.check', { DomainList: domains.slice(0, 50).join(',') });
  const results = toArray(commandResponse.DomainCheckResult);
  return domains.map((domain) => {
    const r = results.find((x: any) => x.Domain?.toLowerCase() === domain);
    if (!r) return { domain, available: false, isPremium: false };
    const isPremium = r.IsPremiumName === 'true';
    return {
      domain,
      available: r.Available === 'true',
      isPremium,
      premiumPriceUsd: isPremium ? parseFloat(r.PremiumRegistrationPrice) : undefined,
      premiumRenewUsd: isPremium ? parseFloat(r.PremiumRenewalPrice) : undefined,
    };
  });
}

const TLD_PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — TLD pricing rarely changes
const tldPriceCache = new Map<string, { priceUsd: number; expiresAt: number }>();

/** One year's price for a TLD — to register, or to renew (12.6 shows both). */
export async function getTldPriceUsd(tld: string, category: 'register' | 'renew'): Promise<number> {
  const key = `${category}:${tld}`;
  const cached = tldPriceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.priceUsd;

  const commandResponse = await namecheapRequest('namecheap.users.getPricing', {
    ProductType: 'DOMAIN',
    ProductCategory: category.toUpperCase(),
    ProductName: tld,
  });

  // Namecheap's sandbox ignores the ProductCategory filter and returns every
  // category (register/renew/transfer/reactivate) regardless — filter client-side.
  const categories = toArray(commandResponse?.UserGetPricingResult?.ProductType?.ProductCategory);
  const wanted = categories.find((c: any) => c.Name?.toLowerCase() === category);
  const products = toArray(wanted?.Product);
  const product = products.find((p: any) => p.Name?.toLowerCase() === tld.toLowerCase());
  const prices = toArray(product?.Price);
  const oneYear = prices.find((p: any) => p.Duration === '1' && p.DurationType === 'YEAR');

  if (!oneYear) {
    throw new Error(`No 1-year ${category} price found for the .${tld} TLD.`);
  }

  const priceUsd = parseFloat(oneYear.YourPrice ?? oneYear.Price);
  tldPriceCache.set(key, { priceUsd, expiresAt: Date.now() + TLD_PRICE_CACHE_TTL_MS });
  return priceUsd;
}

export type DomainSearchResult =
  | { domain: string; available: false }
  | { domain: string; available: true; priceUsd: number; renewUsd: number };

/** Whether one name is free, and what it costs to register and to renew. */
export async function searchDomain(rawDomain: string): Promise<DomainSearchResult> {
  const domain = normalizeDomain(rawDomain);
  return (await searchDomains([domain]))[0];
}

/** Several names at once — the one asked for and its alternatives. */
export async function searchDomains(domains: string[]): Promise<DomainSearchResult[]> {
  const checked = await checkAvailabilityMany(domains.map((d) => normalizeDomain(d)));
  const out: DomainSearchResult[] = [];
  for (const a of checked) {
    if (!a.available) {
      out.push({ domain: a.domain, available: false });
      continue;
    }
    // First label is the name, the rest is the TLD ("acme" + "com", or "acme" + "co.uk").
    const tld = a.domain.split('.').slice(1).join('.');
    const [register, renew] = await Promise.all([getTldPriceUsd(tld, 'register'), getTldPriceUsd(tld, 'renew')]);
    out.push({
      domain: a.domain,
      available: true,
      priceUsd: a.isPremium && a.premiumPriceUsd ? a.premiumPriceUsd : register,
      renewUsd: a.isPremium && a.premiumRenewUsd ? a.premiumRenewUsd : renew,
    });
  }
  return out;
}

export interface NamecheapBalance {
  /** what can be spent now on registrations and renewals */
  availableUsd: number;
  /** the total, including amounts held for pending orders */
  accountUsd: number;
  currency: string;
  fetchedAt: Date;
}

const BALANCE_CACHE_TTL_MS = 60 * 1000;
let cachedBalance: NamecheapBalance | null = null;

/**
 * The platform's Namecheap account balance (namecheap.users.getBalances) —
 * what pays for the domains staff register and renew (ROADMAP 11.5). Read
 * only; kept for a minute so reloading the queue doesn't call it each time.
 */
export async function getAccountBalance(options: { fresh?: boolean } = {}): Promise<NamecheapBalance> {
  if (!options.fresh && cachedBalance && Date.now() - cachedBalance.fetchedAt.getTime() < BALANCE_CACHE_TTL_MS) {
    return cachedBalance;
  }
  const commandResponse = await namecheapRequest('namecheap.users.getBalances', {});
  const result = commandResponse?.UserGetBalancesResult;
  const available = parseFloat(result?.AvailableBalance);
  const account = parseFloat(result?.AccountBalance);
  if (!Number.isFinite(available)) {
    throw new Error('Namecheap returned no balance.');
  }
  cachedBalance = {
    availableUsd: available,
    accountUsd: Number.isFinite(account) ? account : available,
    currency: String(result?.Currency ?? 'USD'),
    fetchedAt: new Date(),
  };
  return cachedBalance;
}
