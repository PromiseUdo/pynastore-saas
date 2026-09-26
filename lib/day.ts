/*
 * lib/day.ts
 *
 * Where a business day starts.
 *
 * "Today" belongs to the merchant, not to whichever region the app happens
 * to be deployed in — using the server's own midnight would move a store's
 * takings between days on a redeploy.
 *
 * Africa/Lagos is UTC+01:00 and has never observed daylight saving, so the
 * offset is a constant rather than something to look up. The day this returns
 * matches the one lib/format.ts prints, which also fixes the zone.
 */
const LAGOS_OFFSET_MINUTES = 60;

/** Midnight in Lagos, as an instant. */
export function startOfTodayInLagos(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + LAGOS_OFFSET_MINUTES * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MINUTES * 60_000);
}

/** Midnight on the first of the current month, in Lagos, as an instant. */
export function startOfMonthInLagos(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + LAGOS_OFFSET_MINUTES * 60_000);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - LAGOS_OFFSET_MINUTES * 60_000);
}
