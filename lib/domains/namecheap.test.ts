/* Reading the Namecheap account balance (ROADMAP 11.5) — the API is stubbed at fetch. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const env = { user: process.env.NAMECHEAP_API_USER, key: process.env.NAMECHEAP_API_KEY, sandbox: process.env.NAMECHEAP_SANDBOX };
const calls: string[] = [];

beforeAll(() => {
  process.env.NAMECHEAP_API_USER = 'tester';
  process.env.NAMECHEAP_API_KEY = 'key';
  process.env.NAMECHEAP_SANDBOX = 'true';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('ipify')) return new Response(JSON.stringify({ ip: '192.0.2.10' }));
    if (url.includes('namecheap.users.getBalances')) {
      return new Response(
        `<?xml version="1.0" encoding="utf-8"?><ApiResponse Status="OK"><Errors /><CommandResponse Type="namecheap.users.getBalances"><UserGetBalancesResult Currency="USD" AvailableBalance="41.25" AccountBalance="52.00" EarnedAmount="0.00" WithdrawableAmount="0.00" FundsRequiredForAutoRenew="0.00" /></CommandResponse></ApiResponse>`,
      );
    }
    return new Response('<ApiResponse Status="ERROR"><Errors><Error Number="1">Unexpected</Error></Errors></ApiResponse>');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.env.NAMECHEAP_API_USER = env.user;
  process.env.NAMECHEAP_API_KEY = env.key;
  process.env.NAMECHEAP_SANDBOX = env.sandbox;
});

describe('getAccountBalance', () => {
  it('reads what can be spent now, and keeps it for a minute', async () => {
    const { getAccountBalance } = await import('./namecheap');
    const b = await getAccountBalance({ fresh: true });
    expect(b).toMatchObject({ availableUsd: 41.25, accountUsd: 52, currency: 'USD' });
    expect(calls.some((u) => u.includes('api.sandbox.namecheap.com') && u.includes('ClientIp=192.0.2.10'))).toBe(true);

    const before = calls.length;
    await getAccountBalance();
    expect(calls.length).toBe(before);
  });
});
