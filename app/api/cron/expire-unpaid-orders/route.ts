/*
 * GET /api/cron/expire-unpaid-orders
 *
 * Cancels online-payment orders that nobody paid for within the hold window
 * and puts their stock back on sale (lib/storefront/orders/lifecycle.ts).
 *
 * The same sweep already runs lazily — before each new order in a store, and
 * when the merchant opens their orders — so this is for quiet stores, where
 * nobody would otherwise trigger it. Point any scheduler at it every 10–15
 * minutes with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends that
 * header automatically when CRON_SECRET is set).
 */
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { expireUnpaidOrders } from '@/lib/storefront/orders/lifecycle';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);

  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}

export async function GET(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await expireUnpaidOrders({ limit: 200 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron] expire-unpaid-orders failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
