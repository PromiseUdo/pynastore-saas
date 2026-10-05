/*
 * The listing pack (ROADMAP 16.4): everything the merchant needs to fill in
 * their App Store and Google Play listings, made from the store's real
 * records. Run through the build kit:
 *
 *   npm run mobile:app -- listing <slug> [--reviewer-account] [--no-screenshots]
 *
 * Writes {slug}/listing/:
 *   LISTING.md                  links, a DRAFT description, privacy and data-safety
 *                               answers, age rating, review notes
 *   screenshots/iphone-6.9/     1290×2796  (App Store, required)
 *   screenshots/ipad-13/        2064×2752  (App Store, required: the app runs on iPad)
 *   screenshots/android-phone/  1080×1920  (Google Play)
 *   graphics/play-icon-512.png, graphics/play-feature-graphic.png (Google Play)
 *
 * Nothing here is invented about the merchant. The description is a draft
 * that states what the app does, for the merchant to rewrite; every privacy
 * answer restates what the platform actually collects in the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PLATFORM_DOMAIN, PLATFORM_NAME } from '../../lib/brand';
import type { StoreAppConfig } from './native-project';

const CONSENT_KEY = 'mansaas:sf:cookie-consent';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface StoreFacts {
  name: string;
  slug: string;
  website: string;
  supportEmail: string | null;
  pages: { kind: string; url: string }[];
  reviewer: { email: string; password: string } | null;
}

async function withPrisma<T>(work: (prisma: import('../../lib/generated/prisma/client').PrismaClient) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (production) — the pack is made from the store’s records.');
  const [{ Pool }, { PrismaPg }, { PrismaClient }] = await Promise.all([
    import('pg'),
    import('@prisma/adapter-pg'),
    import('../../lib/generated/prisma/client'),
  ]);
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

/** The store's public web address: its own domain, or shop-{slug} beside the mobile origin. */
export function storeWebsite(config: Pick<StoreAppConfig, 'slug' | 'serverUrl'>, customDomain: string | null): string {
  if (customDomain) return `https://${customDomain}`;
  const host = new URL(config.serverUrl).hostname.split('.').slice(1).join('.');
  return `https://shop-${config.slug}.${host}`;
}

async function readFacts(config: StoreAppConfig, reviewerAccount: boolean): Promise<StoreFacts> {
  return withPrisma(async (prisma) => {
    const store = await prisma.organization.findUnique({
      where: { slug: config.slug },
      select: {
        id: true,
        name: true,
        supportEmail: true,
        customStoreDomain: true,
        storePages: { where: { isPublished: true }, select: { kind: true, slug: true } },
      },
    });
    if (!store) throw new Error(`No store with the slug "${config.slug}".`);
    const website = storeWebsite(config, store.customStoreDomain);

    /* A sign-in for the reviewers, if asked for. It is a real customer
     * record in the merchant's store, named so nobody mistakes it, and
     * re-running this resets its password. */
    let reviewer: StoreFacts['reviewer'] = null;
    if (reviewerAccount) {
      const { hash } = await import('bcryptjs');
      const email = `app-review+${config.slug}@${PLATFORM_DOMAIN}`;
      const password = randomBytes(9).toString('base64url');
      const passwordHash = await hash(password, 12);
      const existing = await prisma.customer.findFirst({ where: { organizationId: store.id, email }, select: { id: true } });
      if (existing) await prisma.customer.update({ where: { id: existing.id }, data: { passwordHash, status: 'ACTIVE' } });
      else await prisma.customer.create({ data: { organizationId: store.id, name: 'App store review', email, passwordHash } });
      reviewer = { email, password };
    }

    return {
      name: store.name,
      slug: config.slug,
      website,
      supportEmail: store.supportEmail,
      pages: store.storePages.map((p) => ({ kind: p.kind, url: `${website}/pages/${p.slug}` })),
      reviewer,
    };
  });
}

export function listingMarkdown(config: StoreAppConfig, facts: StoreFacts, push: { android: boolean; ios: boolean }): string {
  const page = (kind: string) => facts.pages.find((p) => p.kind === kind)?.url ?? null;
  const missing = '— not published yet (Store pages)';
  const anyPush = push.android || push.ios;

  return `# ${config.name} — store listing pack

Made ${new Date().toISOString().slice(0, 10)} for **${facts.name}** (${config.appId}, version ${config.version}).
Everything below comes from the store's records and what the app really does.
**The merchant writes or approves the final words**; nothing here is a claim
they haven't made.

## Links both stores ask for

| | |
|---|---|
| Website / marketing URL | ${facts.website} |
| Support URL | ${page('CONTACT') ?? facts.website} |
| Support email | ${facts.supportEmail ?? '— not set (Settings → Business details)'} |
| Privacy policy URL | ${page('PRIVACY') ?? missing} |
| Terms URL | ${page('TERMS') ?? missing} |
| Account deletion (Google Play asks for a web link) | ${facts.website}/account/privacy — signed-in shoppers delete their account there; in the app it's Account → Privacy |

## Name and category

- **App name:** ${config.name}
- **Category:** Shopping
- **Price:** Free

## Description — DRAFT for the merchant to rewrite

> ${config.name} is ${facts.name}'s own shopping app. Browse everything ${facts.name}
> sells, save what you like, check out securely, and follow your orders${anyPush ? ' — with a notification when there\'s news about them' : ''}.

Add, in the merchant's words: what they sell, who for, where they deliver.
Don't promise discounts, delivery times or returns the store doesn't offer in
its Store pages.

## Age rating

Answer from what the store sells. For a shop with no restricted goods (no
alcohol, tobacco, weapons, gambling, adult content) every question is **No /
None**, and the app has no user-to-user chat. Shoppers can write product
reviews and questions, which the merchant moderates.

## Apple — App Privacy

- **Data used to track you:** None. The app has no advertising or analytics
  tracking (the website's analytics tags are not loaded in the app).
- **Data linked to the shopper**, all for *App Functionality*:
  - Contact Info — name, email address, phone number, physical address (orders and delivery)
  - Purchases — purchase history (their orders)
  - Identifiers — user ID (their account at this store, if they make one)
  - User Content — product reviews and questions they choose to write
- **Data not linked to the shopper:** Diagnostics — error reports, without
  personal details, for *App Functionality*.
- **Payment card details** are typed into Paystack's own secure page, opened
  over the app; the app never sees them. Apple asks apps to declare data that
  partners collect through them, so the cautious answer is also to declare
  Financial Info → Payment Info, linked, for *App Functionality*.
${push.ios ? `- **Notifications:** only after the shopper presses "Turn on notifications" on an
  order; the device's push token is kept for 60 days to send updates about
  that order, and for nothing else.
` : ''}
## Google Play — Data safety

- **Collected:** Personal info (name, email, phone, address); Financial info
  (purchase history); App activity (other user-generated content: reviews
  and questions); App info and performance (diagnostics)${push.android ? '; Device or other IDs (the push token, only after the shopper turns on order notifications)' : ''}.
  Purpose for all: **App functionality** (and Account management for the account).
- **Shared:** No. Payment processing by Paystack is a service provider acting
  for the store, which Google's form does not count as sharing.
- **Encrypted in transit:** Yes (HTTPS only).
- **Shoppers can ask for deletion:** Yes — in the app (Account → Privacy) and
  on the web (link above).

## Review notes (paste into App Review / the Play Console)

> This is the shopping app of ${facts.name}, an online shop built on ${PLATFORM_NAME}.
> ${facts.reviewer ? `To see a signed-in account: Account → Sign in, email **${facts.reviewer.email}**, password **${facts.reviewer.password}**.` : 'Browsing and checkout work without an account; an account can be created in the app (Account → Create an account).'}
> Checkout opens Paystack's secure payment page in an in-app browser; there is no need to complete a payment.
> Account deletion: Account → Privacy → Delete my account.
${anyPush ? '> Notifications are only offered after placing an order, to send updates about that order.\n' : ''}
## Screenshots and graphics

- \`screenshots/iphone-6.9/\` — App Store, iPhone 6.9" (1290×2796)
- \`screenshots/ipad-13/\` — App Store, iPad 13" (2064×2752)
- \`screenshots/android-phone/\` — Google Play, phone (1080×1920)
- \`graphics/play-icon-512.png\` — Google Play app icon
- \`graphics/play-feature-graphic.png\` — Google Play feature graphic (1024×500)

Taken from the live store as the app shows it. Retake after the merchant
changes their look: \`npm run mobile:app -- listing ${config.slug}\`.
`;
}

const DEVICES = [
  { dir: 'iphone-6.9', width: 430, height: 932, scale: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  { dir: 'ipad-13', width: 1032, height: 1376, scale: 2, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  { dir: 'android-phone', width: 360, height: 640, scale: 3, ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36' },
] as const;

async function takeScreenshots(config: StoreAppConfig, outDir: string): Promise<number> {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} — install it, or set CHROME_PATH.`);
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const base = config.serverUrl.replace(/\/$/, '');
  let taken = 0;
  try {
    for (const device of DEVICES) {
      const page = await browser.newPage();
      // The app's own user agent, so the server serves this store as the app sees it.
      await page.setUserAgent(`${device.ua} MansaasApp/${config.appId}`);
      await page.setViewport({ width: device.width, height: device.height, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument((key: string) => {
        try {
          localStorage.setItem(key, 'essential');
        } catch {
          /* fine */
        }
      }, CONSENT_KEY);

      const targets = ['/', `/s/${config.slug}/products`, `/s/${config.slug}/collections`];
      await page.goto(`${base}${targets[1]}`, { waitUntil: 'networkidle2', timeout: 60_000 });
      // The storefront's links are slug-free (/products/x); the app serves them as this store.
      const product = await page.evaluate(() => {
        const link = document.querySelector<HTMLAnchorElement>('a[href*="/products/"]');
        return link ? new URL(link.href).pathname : null;
      });
      if (product) targets.splice(2, 0, product);

      const dir = path.join(outDir, device.dir);
      fs.mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const target of targets) {
        const response = await page.goto(`${base}${target}`, { waitUntil: 'networkidle2', timeout: 60_000 });
        if (!response || response.status() >= 400) continue;
        await new Promise((resolve) => setTimeout(resolve, 800));
        await page.screenshot({ path: path.join(dir, `${++n}.png`) as `${string}.png` });
        taken += 1;
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return taken;
}

async function makeGraphics(config: StoreAppConfig, storeDir: string, outDir: string) {
  const sharp = (await import('sharp')).default;
  const logo = path.join(storeDir, 'logo.png');
  fs.mkdirSync(outDir, { recursive: true });

  const icon = await sharp(logo).resize(410, 410, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: config.iconBackgroundColor } })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(path.join(outDir, 'play-icon-512.png'));

  const mark = await sharp(logo).resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: 1024, height: 500, channels: 4, background: config.splashBackgroundColor } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(path.join(outDir, 'play-feature-graphic.png'));
}

export async function makeListingPack(input: {
  config: StoreAppConfig;
  storeDir: string;
  reviewerAccount: boolean;
  screenshots: boolean;
  push: { android: boolean; ios: boolean };
}): Promise<{ dir: string; screenshots: number; reviewer: StoreFacts['reviewer'] }> {
  const dir = path.join(input.storeDir, 'listing');
  fs.mkdirSync(dir, { recursive: true });

  const facts = await readFacts(input.config, input.reviewerAccount);
  fs.writeFileSync(path.join(dir, 'LISTING.md'), listingMarkdown(input.config, facts, input.push));
  await makeGraphics(input.config, input.storeDir, path.join(dir, 'graphics'));

  let screenshots = 0;
  if (input.screenshots) {
    fs.rmSync(path.join(dir, 'screenshots'), { recursive: true, force: true });
    screenshots = await takeScreenshots(input.config, path.join(dir, 'screenshots'));
  }
  return { dir, screenshots, reviewer: facts.reviewer };
}
