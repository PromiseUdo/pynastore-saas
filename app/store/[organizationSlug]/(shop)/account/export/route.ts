/*
 * GET /account/export — the signed-in shopper's own data, as a JSON file
 * (ROADMAP 13.8). Only ever the account the session cookie proves; see
 * lib/data-rights/shopper.ts for what's in it.
 */
import { getShopper } from '@/lib/storefront/account/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { exportShopperData } from '@/lib/data-rights/shopper';

export const dynamic = 'force-dynamic';

export async function GET() {
  const shopper = await getShopper();
  if (!shopper) return new Response('Sign in to download your data.', { status: 401 });
  if (!(await checkRateLimit(`export-account:${shopper.id}`, 10, 60 * 60 * 1000))) {
    return new Response('You’ve downloaded your data several times already. Try again in an hour.', { status: 429 });
  }
  const data = await exportShopperData(shopper.organizationId, shopper.id);
  if (!data) return new Response('Not found.', { status: 404 });

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="my-data-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
