/*
 * lib/settings.ts
 *
 * Platform-wide, admin-tunable settings backed by PlatformSetting
 * (key-value). Currently just the USD->NGN rate used to price domain
 * registrations — deliberately NOT a live FX API: you (platform admin) set
 * and update it directly, consistent with domain fulfillment itself being
 * a manual process. Editable later from the admin dashboard via
 * setUsdToNgnRate(); for now, update the row directly (e.g. Prisma Studio).
 */
import { prisma } from '@/lib/prisma';

const USD_TO_NGN_RATE_KEY = 'usd_to_ngn_rate';

/** Only used if no rate has ever been set — logs loudly so it isn't silently relied on. */
const FALLBACK_USD_TO_NGN_RATE = 1600;

export async function getUsdToNgnRate(): Promise<number> {
  const setting = await prisma.platformSetting.findUnique({
    where: { key: USD_TO_NGN_RATE_KEY },
  });

  if (!setting) {
    console.warn(
      `[settings] No "${USD_TO_NGN_RATE_KEY}" PlatformSetting row exists — using fallback rate ${FALLBACK_USD_TO_NGN_RATE}. Set one via setUsdToNgnRate() or directly in the database.`,
    );
    return FALLBACK_USD_TO_NGN_RATE;
  }

  const rate = Number(setting.value);
  if (!Number.isFinite(rate) || rate <= 0) {
    console.warn(
      `[settings] "${USD_TO_NGN_RATE_KEY}" PlatformSetting value "${setting.value}" is not a valid positive number — using fallback rate ${FALLBACK_USD_TO_NGN_RATE}.`,
    );
    return FALLBACK_USD_TO_NGN_RATE;
  }

  return rate;
}

export async function setUsdToNgnRate(rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a positive number.');
  }
  await prisma.platformSetting.upsert({
    where: { key: USD_TO_NGN_RATE_KEY },
    create: { key: USD_TO_NGN_RATE_KEY, value: String(rate) },
    update: { value: String(rate) },
  });
}
