/*
 * lib/domains/comng.ts
 *
 * Is a .com.ng free? (ROADMAP 22.3.) Asked of the .ng registry's own RDAP
 * service (NiRA, rdap.nic.net.ng): 404 means nobody holds it, 200 means
 * someone does. Anything else — a timeout, an outage — is "couldn't check",
 * and nothing is sold on a guess. QServers registers it by hand afterwards;
 * if someone took it in between, staff mark the order failed and say so.
 */
const RDAP = 'https://rdap.nic.net.ng/domain/';
const TIMEOUT_MS = 8_000;

export type ComNgAvailability = { domain: string; available: boolean } | { domain: string; error: string };

export async function checkComNg(domain: string): Promise<ComNgAvailability> {
  try {
    const res = await fetch(RDAP + encodeURIComponent(domain), {
      headers: { accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.status === 404) return { domain, available: true };
    if (res.ok) return { domain, available: false };
    return { domain, error: `The .ng registry answered ${res.status}.` };
  } catch {
    return { domain, error: 'The .ng registry didn’t answer.' };
  }
}

export async function checkComNgMany(domains: string[]): Promise<ComNgAvailability[]> {
  return Promise.all(domains.map(checkComNg));
}
