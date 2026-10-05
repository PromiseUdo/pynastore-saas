/*
 * scripts/mobile/native-project.ts
 *
 * The pure half of the store-app build kit (ROADMAP 16.3): what a store's app
 * build looks like on disk, and the text edits that turn a COPY of the shared
 * native projects into that store's app. No file system, no processes — so
 * every edit is unit-tested (tests/mobile-build.test.ts).
 *
 * Every edit insists that the text it replaces is there. If a Capacitor
 * upgrade reshapes build.gradle or the Xcode project, the build stops with a
 * message naming the file, rather than quietly shipping an app that still
 * calls itself com.mansaas.app.
 */
import { SHARED_APP_ID, isValidAppId } from '../../lib/mobile/app-config';

/* ── the store's build settings (app.json in its folder) ─────────────── */

export interface StoreAppConfig {
  /** the store's handle (Organization.slug) */
  slug: string;
  /** reverse-DNS, as registered in MobileApp — also the app's URL scheme */
  appId: string;
  /** the name under the icon (30 characters at most) */
  name: string;
  /** what shoppers see: 1.0.0 */
  version: string;
  /** the last build number used; every upload to a store needs a higher one */
  buildNumber: number;
  /** the live mobile origin the app loads, e.g. https://m.getnotely.io */
  serverUrl: string;
  /** behind the icon's logo and the splash screen */
  iconBackgroundColor: string;
  splashBackgroundColor: string;
  splashBackgroundColorDark: string;
  /** the merchant's Apple Developer team id (10 characters), for iOS signing */
  appleTeamId: string | null;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;

/** Read and check app.json. Returns every problem at once, so they can all be fixed in one go. */
export function parseStoreAppConfig(raw: unknown): { config: StoreAppConfig } | { errors: string[] } {
  const errors: string[] = [];
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (key: string) => (typeof o[key] === 'string' ? (o[key] as string).trim() : '');

  const slug = str('slug');
  const appId = str('appId').toLowerCase();
  const name = str('name');
  const version = str('version');
  const serverUrl = str('serverUrl').replace(/\/$/, '');
  const buildNumber = o.buildNumber;
  const colour = (key: string, fallback: string) => str(key) || fallback;
  const iconBackgroundColor = colour('iconBackgroundColor', '#ffffff');
  const splashBackgroundColor = colour('splashBackgroundColor', '#ffffff');
  const splashBackgroundColorDark = colour('splashBackgroundColorDark', '#0b0b0c');
  const appleTeamId = str('appleTeamId') || null;

  if (!slug) errors.push('slug is missing.');
  if (!isValidAppId(appId)) errors.push(`appId "${appId}" isn't a reverse-DNS id like com.pynacode.shop.`);
  if (appId === SHARED_APP_ID) errors.push(`appId can't be ${SHARED_APP_ID} — that's the shared app.`);
  if (!name) errors.push('name is missing.');
  if (name.length > 30) errors.push('name is longer than 30 characters; the App Store cuts it off.');
  if (!VERSION.test(version)) errors.push(`version "${version}" should look like 1.0.0.`);
  if (typeof buildNumber !== 'number' || !Number.isInteger(buildNumber) || buildNumber < 0) {
    errors.push('buildNumber should be a whole number (0 before the first build).');
  }
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
  } catch {
    errors.push(`serverUrl "${serverUrl}" isn't a web address.`);
  }
  for (const [key, value] of [
    ['iconBackgroundColor', iconBackgroundColor],
    ['splashBackgroundColor', splashBackgroundColor],
    ['splashBackgroundColorDark', splashBackgroundColorDark],
  ] as const) {
    if (!HEX_COLOUR.test(value)) errors.push(`${key} "${value}" should be a colour like #1a2b3c.`);
  }
  if (appleTeamId && !TEAM_ID.test(appleTeamId)) errors.push(`appleTeamId "${appleTeamId}" should be 10 letters and digits.`);

  if (errors.length) return { errors };
  return {
    config: {
      slug,
      appId,
      name,
      version,
      buildNumber: buildNumber as number,
      serverUrl,
      iconBackgroundColor,
      splashBackgroundColor,
      splashBackgroundColorDark,
      appleTeamId,
    },
  };
}

/**
 * Android's versionCode must rise with every upload, and stay under
 * 2,100,000,000. The build number alone does that; the version is for people.
 */
export function androidVersionCode(buildNumber: number): number {
  if (buildNumber < 1 || buildNumber > 2_100_000_000) throw new Error(`Build number ${buildNumber} is out of range.`);
  return buildNumber;
}

/** A release build must load the live site over https, never a dev machine. */
export function releaseServerProblem(serverUrl: string): string | null {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:') return `serverUrl must be https:// for a release build (it is ${serverUrl}).`;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith('.localhost')) {
    return `serverUrl points at a development machine (${url.hostname}).`;
  }
  return null;
}

/* ── text edits ─────────────────────────────────────────────────────── */

function replaceRequired(text: string, pattern: RegExp, replacement: string, what: string): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  if (!global.test(text)) throw new Error(`Couldn't find ${what}. Has the native project changed shape?`);
  return text.replace(new RegExp(pattern.source, flags), replacement);
}

/** Escape for an Android string resource (XML, plus Android's own apostrophe/quote rules). */
export function androidStringEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

export function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * android/app/build.gradle: the app id, version, and release signing.
 *
 * `namespace` stays com.mansaas.app on purpose: it is the Java package the
 * code lives in (MainActivity), not the app's identity. The store's identity
 * is `applicationId`. Signing reads the keystore from environment variables
 * the build kit sets, so no password is ever written into the project.
 */
export function editAndroidBuildGradle(
  gradle: string,
  input: { appId: string; versionCode: number; versionName: string; sign: boolean },
): string {
  let out = replaceRequired(gradle, /applicationId\s+"[^"]+"/, `applicationId "${input.appId}"`, 'applicationId in build.gradle');
  out = replaceRequired(out, /versionCode\s+\d+/, `versionCode ${input.versionCode}`, 'versionCode in build.gradle');
  out = replaceRequired(out, /versionName\s+"[^"]+"/, `versionName "${input.versionName}"`, 'versionName in build.gradle');

  if (input.sign) {
    out = replaceRequired(
      out,
      /\n(\s*)buildTypes\s*\{/,
      `
$1signingConfigs {
$1    release {
$1        storeFile file(System.getenv('MANSAAS_UPLOAD_KEYSTORE'))
$1        storePassword System.getenv('MANSAAS_UPLOAD_STORE_PASSWORD')
$1        keyAlias System.getenv('MANSAAS_UPLOAD_KEY_ALIAS')
$1        keyPassword System.getenv('MANSAAS_UPLOAD_KEY_PASSWORD')
$1    }
$1}
$1buildTypes {`,
      'buildTypes in build.gradle',
    );
    out = replaceRequired(
      out,
      /(\n\s*release\s*\{\n)(\s*)(manifestPlaceholders)/,
      `$1$2signingConfig signingConfigs.release\n$2$3`,
      'the release build type in build.gradle',
    );
  }
  return out;
}

/** android/app/src/main/res/values/strings.xml: the name and the deep-link scheme. */
export function editAndroidStrings(xml: string, input: { appId: string; name: string }): string {
  const name = androidStringEscape(input.name);
  let out = replaceRequired(xml, /(<string name="app_name">)[^<]*(<\/string>)/, `$1${name}$2`, 'app_name in strings.xml');
  out = replaceRequired(out, /(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${name}$2`, 'title_activity_main in strings.xml');
  out = replaceRequired(out, /(<string name="package_name">)[^<]*(<\/string>)/, `$1${input.appId}$2`, 'package_name in strings.xml');
  out = replaceRequired(out, /(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${input.appId}$2`, 'custom_url_scheme in strings.xml');
  return out;
}

/** ios/App/App.xcodeproj/project.pbxproj: bundle id, version, build, and the merchant's team. */
export function editIosProject(
  pbxproj: string,
  input: { appId: string; version: string; buildNumber: number; teamId: string | null; entitlements?: string | null },
): string {
  let out = replaceRequired(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/, `PRODUCT_BUNDLE_IDENTIFIER = ${input.appId};`, 'PRODUCT_BUNDLE_IDENTIFIER in the Xcode project');
  out = replaceRequired(out, /MARKETING_VERSION = [^;]+;/, `MARKETING_VERSION = ${input.version};`, 'MARKETING_VERSION in the Xcode project');
  out = replaceRequired(out, /CURRENT_PROJECT_VERSION = [^;]+;/, `CURRENT_PROJECT_VERSION = ${input.buildNumber};`, 'CURRENT_PROJECT_VERSION in the Xcode project');
  if (input.entitlements) {
    out = out.replace(/\n\s*CODE_SIGN_ENTITLEMENTS = [^;]+;/g, '');
    out = replaceRequired(out, /(\n(\s*)CODE_SIGN_STYLE = Automatic;)/, `$1\n$2CODE_SIGN_ENTITLEMENTS = ${input.entitlements};`, 'CODE_SIGN_STYLE in the Xcode project');
  }
  if (input.teamId) {
    out = out.replace(/\n\s*DEVELOPMENT_TEAM = [^;]+;/g, '');
    out = replaceRequired(out, /(\n(\s*)CODE_SIGN_STYLE = Automatic;)/, `$1\n$2DEVELOPMENT_TEAM = ${input.teamId};`, 'CODE_SIGN_STYLE in the Xcode project');
  }
  return out;
}

/**
 * The app's entitlements: push notifications (ROADMAP 16.4). "development"
 * is what Xcode expects in the file; exporting for the App Store or
 * TestFlight switches it to production by itself.
 */
export const IOS_PUSH_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
</dict>
</plist>
`;

/**
 * AndroidManifest.xml for push (ROADMAP 16.4): the Android 13+ notification
 * permission, and — when the build made one from the store's logo — the small
 * white icon Android shows in the status bar (otherwise a grey square).
 */
export function editAndroidManifestForPush(xml: string, input: { smallIcon: boolean }): string {
  let out = replaceRequired(
    xml,
    /(\n(\s*)<uses-permission android:name="android\.permission\.INTERNET" \/>)/,
    `$1\n$2<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`,
    'the INTERNET permission in AndroidManifest.xml',
  );
  if (input.smallIcon) {
    out = replaceRequired(
      out,
      /(\n(\s*)<\/application>)/,
      `\n$2    <meta-data\n$2        android:name="com.google.firebase.messaging.default_notification_icon"\n$2        android:resource="@drawable/ic_stat_notify" />$1`,
      '</application> in AndroidManifest.xml',
    );
  }
  return out;
}

/** Whether a google-services.json (from the platform's Firebase project) includes this app. */
export function googleServicesIncludes(json: unknown, appId: string): boolean {
  const clients = (json as { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] })?.client;
  return Array.isArray(clients) && clients.some((c) => c?.client_info?.android_client_info?.package_name === appId);
}

/** ios/App/App/Info.plist: the name under the icon and the deep-link scheme. */
export function editIosInfoPlist(plist: string, input: { appId: string; name: string }): string {
  let out = replaceRequired(
    plist,
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${xmlEscape(input.name)}$2`,
    'CFBundleDisplayName in Info.plist',
  );
  out = replaceRequired(
    out,
    /(<key>CFBundleURLName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${input.appId}$2`,
    'CFBundleURLName in Info.plist',
  );
  out = replaceRequired(
    out,
    /(<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>)[^<]*(<\/string>)/,
    `$1${input.appId}$2`,
    'CFBundleURLSchemes in Info.plist',
  );
  return out;
}

/** mobile/www/offline.html: the store's name and the address "Try again" returns to. */
export function editOfflinePage(html: string, input: { name: string; serverUrl: string }): string {
  let out = replaceRequired(html, /__APP_NAME__/, xmlEscape(input.name), 'the app name placeholder in offline.html');
  out = replaceRequired(out, /__APP_SERVER_URL__/, xmlEscape(input.serverUrl), 'the server placeholder in offline.html');
  return out;
}

/* ── images ─────────────────────────────────────────────────────────── */

/** A PNG's size and whether it has transparency, from its header. Null if it isn't a PNG. */
export function pngInfo(bytes: Uint8Array): { width: number; height: number; hasAlpha: boolean } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colourType = bytes[25];
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    // 4 = grey + alpha, 6 = RGBA
    hasAlpha: colourType === 4 || colourType === 6,
  };
}
