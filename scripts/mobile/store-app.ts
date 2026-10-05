/*
 * The store-app build kit (ROADMAP 16.3): makes a store's own Android and iOS
 * app from the shared native projects. Run on the engineer's Mac; the full
 * runbook is docs/MOBILE-BUILD.md.
 *
 *   npm run mobile:app -- init  <slug>   set up the store's folder and signing key
 *   npm run mobile:app -- check <slug>   everything a build needs, without building
 *   npm run mobile:app -- build <slug>   [--platform android|ios|all] [--version 1.2.0]
 *                                        [--debug [--server-url http://LAN-IP:3000]]
 *   npm run mobile:app -- listing <slug> [--reviewer-account] [--no-screenshots]
 *                                        the store-listing pack (ROADMAP 16.4)
 *
 * Each store has a folder under MOBILE_APPS_DIR (default ~/mansaas-store-apps):
 *
 *   {slug}/app.json            the build settings (id, name, version, colours…)
 *   {slug}/logo.png            REQUIRED: square, 1024×1024 or larger
 *   {slug}/icon.png            optional: a finished, full-bleed icon (no transparency)
 *   {slug}/splash.png          optional: 2732×2732 splash (splash-dark.png too)
 *   google-services.json       Android push: from the platform's Firebase project,
 *                              in {slug}/ or once in MOBILE_APPS_DIR (ROADMAP 16.4)
 *   {slug}/signing/            the Android upload key — BACK THIS UP, never commit it
 *   {slug}/work/               a throwaway copy of the native projects, rebuilt each time
 *   {slug}/builds/{v}-{n}/     what gets handed over: .aab, .apk, build.json
 *
 * The shared `android/` and `ios/` projects are never edited: every change is
 * made to the copy in work/ (scripts/mobile/native-project.ts holds the edits).
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  androidVersionCode,
  editAndroidBuildGradle,
  editAndroidStrings,
  editIosInfoPlist,
  editAndroidManifestForPush,
  editIosProject,
  editOfflinePage,
  googleServicesIncludes,
  IOS_PUSH_ENTITLEMENTS,
  parseStoreAppConfig,
  pngInfo,
  releaseServerProblem,
  type StoreAppConfig,
} from './native-project';
import { makeListingPack } from './listing-pack';
import { appIconPngUrl } from '../../lib/mobile/icon';

const REPO = path.resolve(__dirname, '../..');
const APPS_DIR = path.resolve(process.env.MOBILE_APPS_DIR?.trim() || path.join(os.homedir(), 'mansaas-store-apps'));
const KEY_ALIAS = 'upload';

type Platform = 'android' | 'ios';

/* ── small helpers ──────────────────────────────────────────────────── */

class Stop extends Error {}
const stop = (message: string): never => {
  throw new Stop(message);
};
const say = (message = '') => console.log(message);
const warn = (message: string) => console.log(`  ! ${message}`);
const ok = (message: string) => console.log(`  ✓ ${message}`);

function run(command: string, args: string[], options: { cwd: string; env?: Record<string, string>; quiet?: boolean }) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) stop(`Couldn't run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.quiet) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    stop(`${command} ${args.join(' ')} failed (exit ${result.status}).`);
  }
  return result.stdout ?? '';
}

function has(command: string, args = ['--version']): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function parseFlags(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) positional.push(arg);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { flags, positional };
}

const storeDir = (slug: string) => path.join(APPS_DIR, slug);
const configPath = (slug: string) => path.join(storeDir(slug), 'app.json');
const signingDir = (slug: string) => path.join(storeDir(slug), 'signing');

function readConfig(slug: string): StoreAppConfig {
  const file = configPath(slug);
  if (!fs.existsSync(file)) stop(`No ${file}. Run: npm run mobile:app -- init ${slug}`);
  const parsed = parseStoreAppConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  if ('errors' in parsed) stop(`${file} needs fixing:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`);
  return (parsed as { config: StoreAppConfig }).config;
}

function writeConfig(config: StoreAppConfig) {
  fs.writeFileSync(configPath(config.slug), `${JSON.stringify(config, null, 2)}\n`);
}

/* ── the database: is this app registered, and is the store ready? ──── */

interface Registration {
  appId: string;
  name: string;
  status: string;
  storeName: string;
  storeStatus: string;
  publishedPages: string[];
  /** an APNs key is recorded, so iPhones can be sent notifications */
  iosPush: boolean;
  /** what the merchant asked for in Settings → Mobile app (ROADMAP 16.2) */
  iconUrl: string | null;
  backgroundColor: string | null;
  host: string;
}

async function readRegistration(slug: string): Promise<Registration | null | 'no-database'> {
  const url = process.env.DATABASE_URL;
  if (!url) return 'no-database';
  const [{ Pool }, { PrismaPg }, { PrismaClient }] = await Promise.all([
    import('pg'),
    import('@prisma/adapter-pg'),
    import('../../lib/generated/prisma/client'),
  ]);
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const store = await prisma.organization.findUnique({
      where: { slug },
      select: {
        name: true,
        status: true,
        mobileApp: {
          select: { appId: true, name: true, status: true, apnsKeySealed: true, iconUrl: true, backgroundColor: true },
        },
        storePages: { where: { isPublished: true }, select: { kind: true } },
      },
    });
    if (!store?.mobileApp) return null;
    const { apnsKeySealed, ...app } = store.mobileApp;
    return {
      ...app,
      iosPush: Boolean(apnsKeySealed),
      iconUrl: app.iconUrl,
      backgroundColor: app.backgroundColor,
      storeName: store.name,
      storeStatus: store.status,
      publishedPages: store.storePages.map((p) => p.kind),
      host: new URL(url).hostname,
    };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

/* ── init ───────────────────────────────────────────────────────────── */

async function init(slug: string, flags: Record<string, string | true>) {
  const dir = storeDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  say(`Store folder: ${dir}`);

  if (fs.existsSync(configPath(slug))) {
    ok('app.json already exists — left as it is.');
  } else {
    const registration = await readRegistration(slug);
    let appId = typeof flags['app-id'] === 'string' ? flags['app-id'] : '';
    let name = typeof flags.name === 'string' ? flags.name : '';
    if (registration && registration !== 'no-database') {
      appId ||= registration.appId;
      name ||= registration.name;
      ok(`Read the registration from the database at ${registration.host}.`);
    } else if (registration === null) {
      warn(`${slug} has no app registered in this database. Register it first:`);
      warn(`  npx tsx prisma/mobile-app.ts register ${slug} <app-id> "<App name>"`);
    }
    if (!appId || !name) stop('Pass --app-id and --name, or run this where DATABASE_URL reaches the registration.');

    const serverUrl =
      (typeof flags['server-url'] === 'string' && flags['server-url']) || process.env.NEXT_PUBLIC_MOBILE_URL?.trim() || '';
    const config = {
      slug,
      appId: appId.toLowerCase(),
      name,
      version: '1.0.0',
      buildNumber: 0,
      serverUrl,
      // The colour the merchant chose, when the order has one.
      iconBackgroundColor: (registration && registration !== 'no-database' && registration.backgroundColor) || '#ffffff',
      splashBackgroundColor: (registration && registration !== 'no-database' && registration.backgroundColor) || '#ffffff',
      splashBackgroundColorDark: '#0b0b0c',
      appleTeamId: null,
    };
    fs.writeFileSync(configPath(slug), `${JSON.stringify(config, null, 2)}\n`);
    ok(`Wrote app.json for ${config.appId} ("${name}").`);
    if (!serverUrl) warn('serverUrl is empty — set it in app.json to the live mobile origin, e.g. https://m.getnotely.io');
  }

  // The merchant's icon, from their order (16.2) — a 1024 PNG made by Cloudinary.
  const logo = path.join(dir, 'logo.png');
  if (!fs.existsSync(logo)) {
    const registration = await readRegistration(slug).catch(() => null);
    if (registration && registration !== 'no-database' && registration.iconUrl) {
      const response = await fetch(appIconPngUrl(registration.iconUrl));
      if (response.ok) {
        fs.writeFileSync(logo, Buffer.from(await response.arrayBuffer()));
        ok("Downloaded the merchant's icon to logo.png.");
      } else warn(`Couldn't download the merchant's icon (${response.status}) — add logo.png yourself.`);
    }
  }

  const config = readConfigLoose(slug);
  ensureUploadKey(slug, config?.name ?? slug);

  say(`
Next:
  1. Put the store's logo at ${path.join(dir, 'logo.png')} (square, 1024×1024 or larger).
     Optional: icon.png (a finished icon, no transparency), splash.png, splash-dark.png.
  2. Check the colours, serverUrl and (for iOS) appleTeamId in app.json.
  3. Back up ${signingDir(slug)} somewhere safe — without it this app can never be updated.
  4. npm run mobile:app -- check ${slug}`);
}

function readConfigLoose(slug: string): { name: string } | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(slug), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The Android upload key. Made once per app and kept forever: every update
 * to the app on Google Play must be signed with it. Google holds the real
 * signing key (Play App Signing); a lost upload key can be reset through
 * Google support, but it takes days — so back the folder up.
 */
function ensureUploadKey(slug: string, appName: string) {
  const dir = signingDir(slug);
  const keystore = path.join(dir, 'upload.keystore');
  const properties = path.join(dir, 'upload.properties');
  if (fs.existsSync(keystore) && fs.existsSync(properties)) {
    ok('Android upload key already exists — kept.');
    return;
  }
  if (fs.existsSync(keystore) || fs.existsSync(properties)) {
    stop(`${dir} has only half of the upload key (the .keystore or the .properties). Restore both from the backup.`);
  }
  if (!has('keytool', ['-help'])) stop('keytool (part of Java) is not installed — see docs/MOBILE-BUILD.md.');

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const password = randomBytes(18).toString('base64url');
  const owner = appName.replace(/[^A-Za-z0-9 ]/g, '').trim() || slug;
  run(
    'keytool',
    [
      '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12', '-alias', KEY_ALIAS,
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-storepass', password, '-keypass', password, '-dname', `CN=${owner}, O=${owner}`,
    ],
    { cwd: dir, quiet: true },
  );
  fs.chmodSync(keystore, 0o600);
  fs.writeFileSync(
    properties,
    `# The Android upload key for this store's app. Back up this whole folder.\n` +
      `storeFile=upload.keystore\nkeyAlias=${KEY_ALIAS}\nstorePassword=${password}\nkeyPassword=${password}\n`,
    { mode: 0o600 },
  );
  ok(`Made the Android upload key in ${dir}.`);
}

function readUploadKey(slug: string) {
  const dir = signingDir(slug);
  const file = path.join(dir, 'upload.properties');
  if (!fs.existsSync(file)) stop(`No upload key in ${dir}. Run init, or restore the folder from its backup.`);
  const values = Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
  return {
    MANSAAS_UPLOAD_KEYSTORE: path.join(dir, values.storeFile || 'upload.keystore'),
    MANSAAS_UPLOAD_STORE_PASSWORD: values.storePassword,
    MANSAAS_UPLOAD_KEY_ALIAS: values.keyAlias || KEY_ALIAS,
    MANSAAS_UPLOAD_KEY_PASSWORD: values.keyPassword,
  };
}

/* ── push (ROADMAP 16.4) ────────────────────────────────────────────── */

/** The store's own google-services.json, or the platform-wide one, and whether it has this app. */
function googleServicesFor(slug: string, appId: string): { state: 'ok' | 'missing' | 'wrong'; file: string } {
  for (const file of [path.join(storeDir(slug), 'google-services.json'), path.join(APPS_DIR, 'google-services.json')]) {
    if (!fs.existsSync(file)) continue;
    try {
      return { state: googleServicesIncludes(JSON.parse(fs.readFileSync(file, 'utf8')), appId) ? 'ok' : 'wrong', file };
    } catch {
      return { state: 'wrong', file };
    }
  }
  return { state: 'missing', file: '' };
}

/**
 * Android's status-bar icon must be a white silhouette on transparency, or it
 * shows as a grey square. Made from the logo's own shape — so only when the
 * logo has a transparent background.
 */
async function makeNotificationIcon(logo: string, resDir: string): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  const { isOpaque } = await sharp(logo).stats();
  if (isOpaque) return false;
  const sizes: Record<string, number> = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
  for (const [density, size] of Object.entries(sizes)) {
    const alpha = await sharp(logo)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .extractChannel(3)
      .toBuffer();
    const dir = path.join(resDir, `drawable-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
      .joinChannel(alpha)
      .png()
      .toFile(path.join(dir, 'ic_stat_notify.png'));
  }
  return true;
}

/* ── check ──────────────────────────────────────────────────────────── */

function androidSdkFound(): boolean {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) return true;
  return fs.existsSync(path.join(REPO, 'android', 'local.properties'));
}

/** Everything a build needs. Returns false if something blocks it; warnings don't. */
async function check(slug: string, platforms: Platform[], options: { debug: boolean }): Promise<boolean> {
  let blocked = false;
  const block = (message: string) => {
    blocked = true;
    console.log(`  ✗ ${message}`);
  };

  say(`Checking ${slug} (${platforms.join(' + ')}${options.debug ? ', debug' : ''})`);
  const config = readConfig(slug);
  ok(`app.json: ${config.appId} "${config.name}" ${config.version}, last build ${config.buildNumber}`);

  if (!options.debug) {
    const problem = releaseServerProblem(config.serverUrl);
    if (problem) block(problem);
    else ok(`Loads ${config.serverUrl}`);
  }

  // The store's images.
  const dir = storeDir(slug);
  const logo = path.join(dir, 'logo.png');
  if (!fs.existsSync(logo)) block(`No logo.png in ${dir}.`);
  else {
    const info = pngInfo(fs.readFileSync(logo));
    if (!info) block('logo.png is not a PNG.');
    else if (info.width !== info.height) block(`logo.png is ${info.width}×${info.height}; it must be square.`);
    else if (info.width < 1024) block(`logo.png is ${info.width}px; it must be at least 1024px.`);
    else ok(`logo.png ${info.width}×${info.height}`);
  }
  const icon = path.join(dir, 'icon.png');
  if (fs.existsSync(icon)) {
    const info = pngInfo(fs.readFileSync(icon));
    if (!info || info.width !== info.height || info.width < 1024) block('icon.png must be a square PNG, 1024px or larger.');
    else if (info.hasAlpha && platforms.includes('ios')) warn('icon.png has transparency — Apple rejects transparent icons. Flatten it, or remove it and let logo.png make the icon.');
    else ok('icon.png');
  }

  // The registration: an unregistered app opens "no longer available".
  try {
    const registration = await readRegistration(slug);
    if (registration === 'no-database') warn("DATABASE_URL isn't set — couldn't confirm the app is registered.");
    else if (!registration) block(`No app is registered for ${slug}. Run: npx tsx prisma/mobile-app.ts register ${slug} ${config.appId} "${config.name}"`);
    else {
      const where = `(database at ${registration.host})`;
      if (registration.appId !== config.appId) block(`The registered app id is ${registration.appId}, but app.json says ${config.appId}. ${where}`);
      else if (registration.status !== 'ACTIVE') block(`The app is registered but ${registration.status} — it would only show "no longer available". ${where}`);
      else ok(`Registered and active ${where}`);
      if (registration.storeStatus !== 'ACTIVE') warn(`${registration.storeName} is ${registration.storeStatus}.`);
      for (const [kind, label] of [['PRIVACY', 'Privacy policy'], ['TERMS', 'Terms']] as const) {
        if (!registration.publishedPages.includes(kind)) {
          (options.debug ? warn : block)(`${label} isn't published in the store's Store pages — Apple and Google need its link in the listing.`);
        }
      }
      if (!registration.publishedPages.includes('CONTACT')) warn('No Contact page published — a support link is required in both stores.');
      if (platforms.includes('ios')) {
        if (registration.iosPush) ok('iPhone notifications: APNs key recorded');
        else warn("No APNs key recorded — the iPhone app won't offer order notifications until it is (docs/MOBILE-BUILD.md §2).");
      }
    }
  } catch (error) {
    warn(`Couldn't read the database: ${(error as Error).message}`);
  }

  // Android push: the platform Firebase project's config, including this app.
  if (platforms.includes('android')) {
    const firebase = googleServicesFor(slug, config.appId);
    if (firebase.state === 'ok') ok(`Android notifications: ${path.relative(APPS_DIR, firebase.file)}`);
    else if (firebase.state === 'missing') warn("No google-services.json — the Android app will be built without order notifications.");
    else block(`${firebase.file} doesn't include ${config.appId}. Add the app in Firebase, then download it again.`);
  }

  // The machine.
  if (platforms.includes('android')) {
    if (!has('java', ['-version'])) block('Java is not installed (JDK 21) — see docs/MOBILE-BUILD.md.');
    else ok('Java');
    if (!androidSdkFound()) block('The Android SDK was not found: set ANDROID_HOME, or open android/ in Android Studio once.');
    else ok('Android SDK');
    if (!options.debug && !fs.existsSync(path.join(signingDir(slug), 'upload.properties'))) {
      block(`No Android upload key in ${signingDir(slug)}. Run init, or restore it from the backup.`);
    } else if (!options.debug) ok('Android upload key');
  }
  if (platforms.includes('ios')) {
    if (process.platform !== 'darwin') block('iOS apps can only be built on a Mac.');
    else if (!has('xcodebuild', ['-version'])) block('Xcode is not installed — see docs/MOBILE-BUILD.md.');
    else ok('Xcode');
    if (!config.appleTeamId) warn("appleTeamId is empty in app.json — Xcode will ask for the merchant's team when you archive.");
  }

  say(blocked ? '\nNot ready — fix the ✗ items above.' : '\nReady to build.');
  return !blocked;
}

/* ── build ──────────────────────────────────────────────────────────── */

const SKIP = new Set(['.gradle', 'build', 'Pods', 'DerivedData', 'xcuserdata', '.idea', 'capacitor-cordova-android-plugins', 'output']);

function copyProject(from: string, to: string) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(from, source);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.some((part) => SKIP.has(part))) return false;
      // Web assets Capacitor copies in on sync — never the shared app's.
      if (rel === path.join('app', 'src', 'main', 'assets', 'public') || rel === path.join('App', 'App', 'public')) return false;
      return true;
    },
  });
}

function edit(file: string, change: (text: string) => string) {
  fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')));
}

function sha256(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitCommit(): string | null {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fileStem(config: StoreAppConfig) {
  return config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || config.slug;
}

async function build(slug: string, platforms: Platform[], flags: Record<string, string | true>) {
  const debug = flags.debug === true;
  if (typeof flags['server-url'] === 'string' && !debug) {
    stop('--server-url is only for --debug builds. A release build loads the serverUrl in app.json.');
  }

  // A new version for people, if asked; the build number always rises.
  const stored = readConfig(slug);
  if (typeof flags.version === 'string') {
    const next = parseStoreAppConfig({ ...stored, version: flags.version });
    if ('errors' in next) stop(next.errors.join('\n'));
    stored.version = flags.version;
  }
  const config: StoreAppConfig = {
    ...stored,
    buildNumber: stored.buildNumber + 1,
    serverUrl: typeof flags['server-url'] === 'string' ? flags['server-url'] : stored.serverUrl,
  };

  if (!(await check(slug, platforms, { debug }))) process.exit(1);

  const dir = storeDir(slug);
  const work = path.join(dir, 'work');
  say(`\nBuilding ${config.name} ${config.version} (${config.buildNumber}) in ${work}`);

  // 1. A fresh copy of the native projects, beside the repo's node_modules.
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  for (const file of ['package.json', 'capacitor.config.ts']) fs.copyFileSync(path.join(REPO, file), path.join(work, file));
  fs.cpSync(path.join(REPO, 'mobile'), path.join(work, 'mobile'), { recursive: true });
  edit(path.join(work, 'mobile/www/offline.html'), (text) =>
    editOfflinePage(text, { name: config.name, serverUrl: config.serverUrl }),
  );
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(work, 'node_modules'), 'dir');
  for (const platform of platforms) copyProject(path.join(REPO, platform), path.join(work, platform));
  if (platforms.includes('android') && fs.existsSync(path.join(REPO, 'android', 'local.properties'))) {
    fs.copyFileSync(path.join(REPO, 'android', 'local.properties'), path.join(work, 'android', 'local.properties'));
  }
  ok('Copied the native projects');

  // 2. Capacitor: the app id, name, user-agent marker and the site it loads.
  const firebase = platforms.includes('android') ? googleServicesFor(slug, config.appId) : null;
  const androidPush = firebase?.state === 'ok';
  const capEnv = {
    MOBILE_APP_ID: config.appId,
    MOBILE_APP_NAME: config.name,
    // The build says it can receive push only when it really can (16.4).
    MOBILE_APP_PUSH_ANDROID: androidPush ? '1' : '',
    MOBILE_APP_PUSH_IOS: '1',
    NEXT_PUBLIC_MOBILE_URL: debug ? '' : config.serverUrl,
    CAP_SERVER_URL: debug ? config.serverUrl : '',
  };
  const bin = (name: string) => path.join(REPO, 'node_modules', '.bin', name);
  for (const platform of platforms) run(bin('cap'), ['sync', platform], { cwd: work, env: capEnv });

  // 3. The store's identity in the native projects.
  if (platforms.includes('android')) {
    edit(path.join(work, 'android/app/build.gradle'), (text) =>
      editAndroidBuildGradle(text, {
        appId: config.appId,
        versionCode: androidVersionCode(config.buildNumber),
        versionName: config.version,
        sign: !debug,
      }),
    );
    edit(path.join(work, 'android/app/src/main/res/values/strings.xml'), (text) =>
      editAndroidStrings(text, { appId: config.appId, name: config.name }),
    );
    if (androidPush) {
      fs.copyFileSync(firebase!.file, path.join(work, 'android/app/google-services.json'));
      const smallIcon = await makeNotificationIcon(path.join(dir, 'logo.png'), path.join(work, 'android/app/src/main/res'));
      if (!smallIcon) warn("logo.png has no transparent background, so Android's status-bar icon will be a plain square.");
      edit(path.join(work, 'android/app/src/main/AndroidManifest.xml'), (text) => editAndroidManifestForPush(text, { smallIcon }));
      ok('Android: order notifications included');
    }
  }
  if (platforms.includes('ios')) {
    edit(path.join(work, 'ios/App/App.xcodeproj/project.pbxproj'), (text) =>
      editIosProject(text, {
        appId: config.appId,
        version: config.version,
        buildNumber: config.buildNumber,
        teamId: config.appleTeamId,
        entitlements: 'App/App.entitlements',
      }),
    );
    fs.writeFileSync(path.join(work, 'ios/App/App/App.entitlements'), IOS_PUSH_ENTITLEMENTS);
    edit(path.join(work, 'ios/App/App/Info.plist'), (text) => editIosInfoPlist(text, { appId: config.appId, name: config.name }));
  }
  ok('Set the app id, name, version and deep-link scheme');

  // 4. Icons and splash screens from the store's images.
  const assets = path.join(work, 'assets');
  fs.mkdirSync(assets);
  fs.copyFileSync(path.join(dir, 'logo.png'), path.join(assets, 'logo.png'));
  for (const [from, to] of [['icon.png', 'icon-only.png'], ['splash.png', 'splash.png'], ['splash-dark.png', 'splash-dark.png']]) {
    if (fs.existsSync(path.join(dir, from))) fs.copyFileSync(path.join(dir, from), path.join(assets, to));
  }
  run(
    bin('capacitor-assets'),
    [
      'generate',
      ...platforms.map((p) => `--${p}`),
      '--assetPath', 'assets',
      '--iconBackgroundColor', config.iconBackgroundColor,
      '--iconBackgroundColorDark', config.iconBackgroundColor,
      '--splashBackgroundColor', config.splashBackgroundColor,
      '--splashBackgroundColorDark', config.splashBackgroundColorDark,
    ],
    { cwd: work },
  );
  ok('Made the icons and splash screens');

  // 5. Build.
  const out = path.join(dir, 'builds', `${config.version}-${config.buildNumber}${debug ? '-debug' : ''}`);
  fs.mkdirSync(out, { recursive: true });
  const stem = `${fileStem(config)}-${config.version}-${config.buildNumber}`;
  const delivered: Record<string, string> = {};

  if (platforms.includes('android')) {
    const android = path.join(work, 'android');
    if (debug) {
      run('./gradlew', ['assembleDebug'], { cwd: android });
      const apk = path.join(out, `${stem}-debug.apk`);
      fs.copyFileSync(path.join(android, 'app/build/outputs/apk/debug/app-debug.apk'), apk);
      delivered[path.basename(apk)] = sha256(apk);
    } else {
      run('./gradlew', ['bundleRelease', 'assembleRelease'], { cwd: android, env: readUploadKey(slug) });
      const aab = path.join(out, `${stem}.aab`);
      const apk = path.join(out, `${stem}.apk`);
      fs.copyFileSync(path.join(android, 'app/build/outputs/bundle/release/app-release.aab'), aab);
      fs.copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), apk);
      delivered[path.basename(aab)] = sha256(aab);
      delivered[path.basename(apk)] = sha256(apk);
    }
    ok('Built Android');
  }

  fs.writeFileSync(
    path.join(out, 'build.json'),
    `${JSON.stringify(
      {
        slug: config.slug,
        appId: config.appId,
        name: config.name,
        version: config.version,
        buildNumber: config.buildNumber,
        serverUrl: config.serverUrl,
        debug,
        platforms,
        commit: gitCommit(),
        builtAt: new Date().toISOString(),
        files: delivered,
      },
      null,
      2,
    )}\n`,
  );

  // Only a release build spends the build number.
  if (!debug) writeConfig({ ...stored, buildNumber: config.buildNumber });

  say(`\nDone. Files in ${out}`);
  for (const file of Object.keys(delivered)) say(`  ${file}`);
  if (platforms.includes('android') && !debug) {
    say('  .aab → upload to Google Play (the merchant\'s account). .apk → install directly on a phone to test, or share.');
  }
  if (platforms.includes('ios')) {
    say(`
iOS: the project is ready at ${path.join(work, 'ios/App/App.xcodeproj')}
  open "${path.join(work, 'ios/App/App.xcodeproj')}"
  In Xcode: pick the merchant's team (Signing & Capabilities), then Product → Archive
  → Distribute App → App Store Connect. See docs/MOBILE-BUILD.md.`);
  }
}

/* ── listing (ROADMAP 16.4) ─────────────────────────────────────────── */

async function listing(slug: string, flags: Record<string, string | true>) {
  const config = readConfig(slug);
  const problem = releaseServerProblem(config.serverUrl);
  if (problem) stop(problem);
  const registration = await readRegistration(slug);
  if (registration === 'no-database' || !registration) stop('The app must be registered, and DATABASE_URL must reach it (production).');

  say(`Making the listing pack for ${config.name}…`);
  const pack = await makeListingPack({
    config,
    storeDir: storeDir(slug),
    reviewerAccount: flags['reviewer-account'] === true,
    screenshots: flags['no-screenshots'] !== true,
    push: {
      android: googleServicesFor(slug, config.appId).state === 'ok',
      ios: (registration as Registration).iosPush,
    },
  });
  ok(`LISTING.md, graphics${flags['no-screenshots'] === true ? '' : ` and ${pack.screenshots} screenshots`} in ${pack.dir}`);
  if (pack.reviewer) {
    ok(`Reviewer sign-in: ${pack.reviewer.email} / ${pack.reviewer.password} (also in LISTING.md)`);
    warn('Delete that customer from the store once both apps are approved.');
  }
  say('\nGive the merchant the listing folder. Read LISTING.md with them: the description is only a draft.');
}

/* ── main ───────────────────────────────────────────────────────────── */

function platformsFrom(flag: string | true | undefined): Platform[] {
  if (flag === undefined || flag === 'all') return process.platform === 'darwin' ? ['android', 'ios'] : ['android'];
  if (flag === 'android' || flag === 'ios') return [flag];
  return stop('--platform must be android, ios or all.');
}

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const [command, rawSlug] = positional;
  const slug = (rawSlug ?? '').trim().toLowerCase();
  const usage =
    'Usage: npm run mobile:app -- init|check|build|listing <store-slug> [--platform android|ios|all] [--version 1.0.0] [--debug] [--server-url URL] [--reviewer-account] [--no-screenshots]';

  if (!slug || !['init', 'check', 'build', 'listing'].includes(command)) stop(usage);
  if (command === 'init') return init(slug, flags);
  if (command === 'listing') return listing(slug, flags);
  if (command === 'check') {
    const ready = await check(slug, platformsFrom(flags.platform), { debug: flags.debug === true });
    if (!ready) process.exitCode = 1;
    return;
  }
  return build(slug, platformsFrom(flags.platform), flags);
}

main().catch((error) => {
  console.error(error instanceof Stop ? `\n${error.message}` : error);
  process.exitCode = 1;
});
