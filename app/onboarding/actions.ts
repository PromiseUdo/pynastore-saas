'use server';

/*
 * "Create your shop" (ROADMAP 12.5). The merchant chooses the shop's web
 * address — checked here against every workspace and the reserved list, and
 * never suffixed behind their back — says what they sell and how, and names
 * their first store and where it is. Everything is created together
 * (lib/onboarding/bootstrap.ts), and only once their email is confirmed.
 */
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { bootstrapOrganization } from '@/lib/onboarding/bootstrap';
import { updateCurrentOrganization } from '@/lib/session';
import { getAdminUrl, getStorefrontUrl } from '@/lib/tenant/urls';
import { isEmailVerified, sendVerificationEmail } from '@/lib/email-verification';
import {
  ADDRESS_PROBLEM_MESSAGE,
  addressCandidates,
  addressProblem,
  toShopAddress,
} from '@/lib/onboarding/shop-address';
import { acceptedCategories, isBusinessType, isSalesChannels } from '@/lib/onboarding/business';
import { isNigerianState } from '@/lib/geo/nigeria';
import { cleanCity, STORE_CITY_MAX } from '@/features/inventory/store-place';
import { getSetupProgress } from '@/lib/onboarding/setup-guide';
import { welcomeEmail } from '@/lib/onboarding/emails';
import { sendPlatformNoticeEmail } from '@/lib/email';

export type AddressCheck =
  | { status: 'available'; address: string }
  | { status: 'unavailable'; address: string; message: string; suggestions: string[] };

/** Up to three free addresses near the one asked for. */
async function suggestionsFor(address: string, city?: string | null): Promise<string[]> {
  const candidates = addressCandidates(address || 'my-shop', city);
  const taken = await prisma.organization.findMany({ where: { slug: { in: candidates } }, select: { slug: true } });
  const takenSet = new Set(taken.map((t) => t.slug));
  return candidates.filter((c) => !takenSet.has(c)).slice(0, 3);
}

async function check(rawAddress: string, city?: string | null): Promise<AddressCheck> {
  const address = toShopAddress(rawAddress);
  const problem = addressProblem(address);
  if (problem) {
    return {
      status: 'unavailable',
      address,
      message: ADDRESS_PROBLEM_MESSAGE[problem],
      suggestions: problem === 'reserved' ? await suggestionsFor(address, city) : [],
    };
  }
  const taken = await prisma.organization.findUnique({ where: { slug: address }, select: { id: true } });
  if (taken) {
    return { status: 'unavailable', address, message: ADDRESS_PROBLEM_MESSAGE.taken, suggestions: await suggestionsFor(address, city) };
  }
  return { status: 'available', address };
}

/** As the merchant types: is this address free, and if not, what is? */
export async function checkShopAddress(input: { address: string; city?: string | null }): Promise<AddressCheck | { status: 'error' }> {
  const session = await auth();
  if (!session?.user?.id) return { status: 'error' };
  return check(String(input.address ?? '').slice(0, 100), input.city ? String(input.city).slice(0, 100) : null);
}

export async function resendVerificationEmail(): Promise<{ ok: true; result: 'sent' | 'too-soon' | 'already' } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Sign in again to continue.' };
  const result = await sendVerificationEmail(session.user.id);
  if (result === 'failed') return { ok: false, error: 'We couldn’t send the email just now. Try again in a minute.' };
  return { ok: true, result };
}

export interface CreateShopInput {
  name: string;
  address: string;
  businessType: string;
  salesChannels: string;
  categories: string[];
  storeName: string;
  state: string;
  city: string;
}

export type CreateShopField = keyof Omit<CreateShopInput, 'categories'>;

export type CreateShopResult =
  | { ok: true; adminUrl: string }
  | { ok: false; error: string; fieldErrors?: Partial<Record<CreateShopField, string>>; suggestions?: string[] };

export async function createShop(input: CreateShopInput): Promise<CreateShopResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in again to continue.' };
  if (!(await isEmailVerified(userId))) {
    return { ok: false, error: 'Confirm your email first — we sent you a link.' };
  }

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const storeName = String(input.storeName ?? '').trim().replace(/\s+/g, ' ');
  const city = cleanCity(String(input.city ?? ''));
  const state = String(input.state ?? '');
  const fieldErrors: Partial<Record<CreateShopField, string>> = {};

  if (name.length < 2) fieldErrors.name = 'Give your shop a name.';
  else if (name.length > 60) fieldErrors.name = 'Keep the name to 60 characters.';
  if (!isBusinessType(input.businessType)) fieldErrors.businessType = 'Choose what you sell.';
  if (!isSalesChannels(input.salesChannels)) fieldErrors.salesChannels = 'Choose where you sell.';
  if (storeName.length < 2) fieldErrors.storeName = 'Name your store — for example “Main shop” or “Ikeja branch”.';
  else if (storeName.length > 60) fieldErrors.storeName = 'Keep the store name to 60 characters.';
  if (!isNigerianState(state)) fieldErrors.state = 'Choose the state your store is in.';
  if (!city) fieldErrors.city = 'Enter the city or town your store is in.';
  else if (city.length > STORE_CITY_MAX) fieldErrors.city = `Keep the city to ${STORE_CITY_MAX} characters.`;

  const address = await check(String(input.address ?? ''), city);
  if (address.status === 'unavailable') fieldErrors.address = address.message;

  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors,
      suggestions: address.status === 'unavailable' ? address.suggestions : undefined,
    };
  }
  const businessType = input.businessType as Parameters<typeof acceptedCategories>[0];

  let created: Awaited<ReturnType<typeof bootstrapOrganization>>;
  try {
    created = await bootstrapOrganization({
      name,
      slug: address.address,
      ownerUserId: userId,
      firstStore: { name: storeName, state, city: city! },
      businessType,
      salesChannels: input.salesChannels as 'ONLINE' | 'IN_PERSON' | 'BOTH',
      categories: acceptedCategories(businessType, Array.isArray(input.categories) ? input.categories.map(String) : []),
    });
  } catch (error) {
    // Someone took the address between the check and now.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        ok: false,
        error: 'Check the highlighted fields.',
        fieldErrors: { address: ADDRESS_PROBLEM_MESSAGE.taken },
        suggestions: await suggestionsFor(address.address, city),
      };
    }
    console.error('[createShop]', error);
    return { ok: false, error: 'We couldn’t create your shop. Nothing was saved — please try again.' };
  }

  const { organization, start } = created;
  await updateCurrentOrganization(userId, organization.id, organization.slug);
  await sendWelcome(organization.id, organization.slug, organization.name, start);

  return { ok: true, adminUrl: getAdminUrl(organization.slug, '/dashboard') };
}

/** The welcome email, once — best effort: a failed send never undoes the shop. */
async function sendWelcome(
  organizationId: string,
  slug: string,
  shopName: string,
  start: Awaited<ReturnType<typeof bootstrapOrganization>>['start'],
) {
  try {
    const owner = await prisma.membership.findFirst({
      where: { organizationId, role: { isSystem: true, name: 'Owner' } },
      select: { user: { select: { email: true } } },
    });
    if (!owner) return;
    await prisma.onboardingEmail.create({ data: { organizationId, kind: 'welcome' } });
    const progress = await getSetupProgress(organizationId);
    await sendPlatformNoticeEmail({
      to: owner.user.email,
      ...welcomeEmail({
        shopName,
        storefrontUrl: getStorefrontUrl(slug),
        adminUrl: getAdminUrl(slug, '/dashboard'),
        trial: start.kind === 'trial' ? { planName: start.planName, endsAt: start.trialEndsAt } : null,
        firstStep: progress?.next?.title ?? null,
      }),
    });
  } catch (error) {
    console.error('[createShop] welcome email:', error);
  }
}
