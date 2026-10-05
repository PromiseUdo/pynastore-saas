/*
 * Keep the record of a store's own phone app (ROADMAP 16.1) until 16.2 gives
 * it screens in the platform console.
 *
 * A store's app opens its store only once it is registered here: an app
 * built with an id nobody registered shows "This app is no longer available".
 * `lapse` does the same to a registered app whose add-on wasn't renewed, and
 * `restore` undoes it. The app id is permanent once the app is published in a
 * store — Apple and Google treat a new id as a different app.
 *
 * Once the merchant's listings are approved (ROADMAP 16.4), record them so
 * the store's website can offer the app ("Get our app" banner, /app page):
 *   npx tsx prisma/mobile-app.ts listed  <store-slug> --app-store-id 123456789
 *   npx tsx prisma/mobile-app.ts listed  <store-slug> --google-play
 *   npx tsx prisma/mobile-app.ts unlisted <store-slug> --app-store | --google-play
 *   npx tsx prisma/mobile-app.ts website <store-slug> on|off   (the merchant's choice)
 *
 * iPhone notifications need the merchant's APNs key (from THEIR Apple team).
 * It is sealed with SOCIAL_TOKEN_KEY, so run this with production's value set:
 *   npx tsx prisma/mobile-app.ts apns <store-slug> --team-id ABCDE12345 --key-id XYZ123ABCD --key AuthKey_XYZ123ABCD.p8
 *
 * Usage:
 *   npx tsx prisma/mobile-app.ts register <store-slug> <app-id> "<App name>"
 *   npx tsx prisma/mobile-app.ts lapse    <store-slug>
 *   npx tsx prisma/mobile-app.ts restore  <store-slug>
 *   npx tsx prisma/mobile-app.ts list
 *
 * e.g. npx tsx prisma/mobile-app.ts register pynacode com.pynacode.shop "Pynastore"
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { SHARED_APP_ID, isValidAppId } from '../lib/mobile/app-config';
import { isAppStoreId } from '../lib/mobile/listing-rules';
import { isUsableApnsKey } from '../lib/mobile/push/apns';
import { seal } from '../lib/social/crypto';
import fs from 'node:fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const USAGE = [
  'Usage:',
  '  npx tsx prisma/mobile-app.ts register <store-slug> <app-id> "<App name>"',
  '  npx tsx prisma/mobile-app.ts lapse|restore <store-slug>',
  '  npx tsx prisma/mobile-app.ts listed <store-slug> --app-store-id <digits> | --google-play',
  '  npx tsx prisma/mobile-app.ts unlisted <store-slug> --app-store | --google-play',
  '  npx tsx prisma/mobile-app.ts website <store-slug> on|off',
  '  npx tsx prisma/mobile-app.ts apns <store-slug> --team-id <10 chars> --key-id <10 chars> --key <AuthKey.p8>',
  '  npx tsx prisma/mobile-app.ts list',
].join('\n');

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const [command, slugArg, appIdArg, ...nameParts] = process.argv.slice(2);

  if (command === 'list') {
    const apps = await prisma.mobileApp.findMany({
      select: {
        appId: true,
        name: true,
        status: true,
        appStoreId: true,
        onGooglePlay: true,
        promoteOnWebsite: true,
        organization: { select: { slug: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (apps.length === 0) console.log('No store apps registered.');
    for (const a of apps) {
      const where = [a.appStoreId ? `App Store ${a.appStoreId}` : null, a.onGooglePlay ? 'Google Play' : null]
        .filter(Boolean)
        .join(' + ');
      console.log(
        `${a.organization.slug}  ${a.appId}  "${a.name}"  ${a.status}  ${where || 'not listed yet'}` +
          `${a.promoteOnWebsite ? '' : '  (hidden on website)'}`,
      );
    }
    return;
  }

  if (!['register', 'lapse', 'restore', 'listed', 'unlisted', 'website', 'apns'].includes(command) || !slugArg) return fail(USAGE);

  const slug = slugArg.trim().toLowerCase();
  const store = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, mobileApp: { select: { appId: true, status: true } } },
  });
  if (!store) return fail(`No store with the slug "${slug}".`);

  if (command === 'register') {
    const appId = (appIdArg ?? '').trim().toLowerCase();
    const name = nameParts.join(' ').trim();
    if (!appId || !name) return fail(USAGE);
    if (!isValidAppId(appId)) return fail(`"${appId}" isn't a valid app id. Use reverse-DNS, e.g. com.pynacode.shop.`);
    if (appId === SHARED_APP_ID) return fail(`${SHARED_APP_ID} is the shared app's id; a store's app needs its own.`);
    if (name.length > 30) return fail('Keep the app name to 30 characters or fewer — the App Store cuts it off after that.');

    const taken = await prisma.mobileApp.findUnique({ where: { appId }, select: { organizationId: true } });
    if (taken && taken.organizationId !== store.id) return fail(`${appId} already belongs to another store.`);

    if (store.mobileApp && store.mobileApp.appId !== appId) {
      return fail(
        `${store.name} already has the app ${store.mobileApp.appId}. An app's id can't change once it's ` +
          'published; if that one was never published, remove it in the database first.',
      );
    }

    await prisma.mobileApp.upsert({
      where: { organizationId: store.id },
      create: { organizationId: store.id, appId, name },
      update: { name },
    });
    console.log(`${store.name}'s app is registered: ${appId} ("${name}"). It opens straight into the store.`);
    return;
  }

  if (!store.mobileApp) return fail(`${store.name} has no app registered.`);

  if (command === 'listed' || command === 'unlisted') {
    const flags = process.argv.slice(4);
    const value = (flag: string) => {
      const i = flags.indexOf(flag);
      return i >= 0 ? flags[i + 1] : undefined;
    };
    const data: { appStoreId?: string | null; onGooglePlay?: boolean } = {};
    if (command === 'listed') {
      const id = value('--app-store-id');
      if (id !== undefined) {
        if (!isAppStoreId(id)) return fail('--app-store-id is the number in the App Store link: apps.apple.com/app/id<this>.');
        data.appStoreId = id;
      }
      if (flags.includes('--google-play')) data.onGooglePlay = true;
    } else {
      if (flags.includes('--app-store')) data.appStoreId = null;
      if (flags.includes('--google-play')) data.onGooglePlay = false;
    }
    if (Object.keys(data).length === 0) return fail(USAGE);
    await prisma.mobileApp.update({ where: { organizationId: store.id }, data });
    console.log(`${store.name}'s app listing is recorded. The website offers it wherever it's listed.`);
    return;
  }

  if (command === 'apns') {
    const flags = process.argv.slice(4);
    const value = (flag: string) => {
      const i = flags.indexOf(flag);
      return i >= 0 ? flags[i + 1] : undefined;
    };
    const teamId = value('--team-id') ?? '';
    const keyId = value('--key-id') ?? '';
    const keyFile = value('--key') ?? '';
    if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId) || !keyFile) return fail(USAGE);
    if (!process.env.SOCIAL_TOKEN_KEY?.trim()) {
      return fail('Set SOCIAL_TOKEN_KEY to production\'s value first — the key is sealed with it, and only that value opens it on the live site.');
    }
    if (!fs.existsSync(keyFile)) return fail(`No file at ${keyFile}.`);
    const key = fs.readFileSync(keyFile, 'utf8').trim();
    if (!(await isUsableApnsKey(key))) return fail(`${keyFile} isn't an APNs key (.p8) — download it again from the Apple Developer site.`);

    await prisma.mobileApp.update({
      where: { organizationId: store.id },
      data: { apnsTeamId: teamId, apnsKeyId: keyId, apnsKeySealed: seal(key) },
    });
    console.log(`${store.name}'s iPhone app can now be sent order notifications. You can delete ${keyFile} from this machine.`);
    return;
  }

  if (command === 'website') {
    const choice = appIdArg;
    if (choice !== 'on' && choice !== 'off') return fail(USAGE);
    await prisma.mobileApp.update({ where: { organizationId: store.id }, data: { promoteOnWebsite: choice === 'on' } });
    console.log(
      choice === 'on'
        ? `${store.name}'s website offers the app (once it's listed).`
        : `${store.name}'s website no longer mentions the app.`,
    );
    return;
  }

  const status = command === 'lapse' ? 'LAPSED' : 'ACTIVE';
  if (store.mobileApp.status === status) {
    console.log(`${store.name}'s app is already ${status === 'LAPSED' ? 'lapsed' : 'active'}. Nothing changed.`);
    return;
  }
  await prisma.mobileApp.update({ where: { organizationId: store.id }, data: { status } });
  console.log(
    status === 'LAPSED'
      ? `${store.name}'s app now shows "no longer available", with a link to the store's website.`
      : `${store.name}'s app opens the store again.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
