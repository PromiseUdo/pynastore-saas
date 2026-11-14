/*
 * lib/dashboard/headline.ts
 *
 * The home page's one-line greeting (dashboard recommendation 6): good
 * morning, afternoon or evening by the clock in Lagos, the member's first
 * name, then today in one sentence — or, for a member who can't see sales,
 * the shop's name. Pure.
 */
import { formatMoney, formatNumber } from '@/lib/format';
import type { WeekFigures } from '@/features/dashboard/overview';

/** "Good morning" by the clock in Lagos, where the shops are. */
export function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(now));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * "Good morning, Ada. Today so far: ₦15,000 from 3 orders." — the greeting,
 * then today in one sentence for a member who sees sales, or the shop's name
 * for one who doesn't.
 */
export function headline(firstName: string | null, week: WeekFigures | null, currency: string, shopName: string, now: Date): string {
  const hello = `${greeting(now)}${firstName ? `, ${firstName}` : ''}.`;
  if (!week) return `${hello} Here’s what needs you at ${shopName}.`;
  if (week.todayOrders === 0) return `${hello} No orders yet today.`;
  return `${hello} Today so far: ${formatMoney(week.todaySales, currency)} from ${formatNumber(week.todayOrders)} order${week.todayOrders === 1 ? '' : 's'}.`;
}

