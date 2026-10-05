/*
 * The store-app build kit's edits (ROADMAP 16.3), run against the REAL
 * committed native projects — so a Capacitor upgrade that reshapes one of
 * them fails here, not in a merchant's app that still calls itself
 * com.mansaas.app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  androidStringEscape,
  androidVersionCode,
  editAndroidBuildGradle,
  editAndroidStrings,
  editIosInfoPlist,
  editAndroidManifestForPush,
  editIosProject,
  editOfflinePage,
  googleServicesIncludes,
  parseStoreAppConfig,
  pngInfo,
  releaseServerProblem,
} from '@/scripts/mobile/native-project';
import { listingMarkdown, storeWebsite } from '@/scripts/mobile/listing-pack';

const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const GRADLE = read('android/app/build.gradle');
const STRINGS = read('android/app/src/main/res/values/strings.xml');
const PBXPROJ = read('ios/App/App.xcodeproj/project.pbxproj');
const PLIST = read('ios/App/App/Info.plist');

const VALID = {
  slug: 'pynacode',
  appId: 'com.pynacode.shop',
  name: 'Pynastore',
  version: '1.0.0',
  buildNumber: 0,
  serverUrl: 'https://m.getnotely.io',
};

describe('app.json', () => {
  it('accepts a complete config and fills the colours', () => {
    const parsed = parseStoreAppConfig(VALID);
    expect(parsed).toEqual({
      config: {
        ...VALID,
        iconBackgroundColor: '#ffffff',
        splashBackgroundColor: '#ffffff',
        splashBackgroundColorDark: '#0b0b0c',
        appleTeamId: null,
      },
    });
  });

  it('lists every problem at once', () => {
    const parsed = parseStoreAppConfig({
      ...VALID,
      appId: 'com.mansaas.app',
      name: 'A name far too long for the App Store',
      version: '1.0',
      buildNumber: -1,
      iconBackgroundColor: 'white',
      appleTeamId: 'abc',
    });
    expect('errors' in parsed && parsed.errors).toHaveLength(6);
  });

  it('keeps release builds on the live https site', () => {
    expect(releaseServerProblem('https://m.getnotely.io')).toBeNull();
    expect(releaseServerProblem('http://m.getnotely.io')).toMatch(/https/);
    expect(releaseServerProblem('https://192.168.1.20:3000')).toMatch(/development/);
    expect(releaseServerProblem('https://m.app.localhost:3000')).toMatch(/development/);
  });

  it('uses the build number as the Android version code', () => {
    expect(androidVersionCode(7)).toBe(7);
    expect(() => androidVersionCode(0)).toThrow();
  });
});

describe('Android', () => {
  it('sets the app id and version, leaving the code namespace alone', () => {
    const out = editAndroidBuildGradle(GRADLE, { appId: 'com.pynacode.shop', versionCode: 4, versionName: '1.2.0', sign: false });
    expect(out).toContain('applicationId "com.pynacode.shop"');
    expect(out).toContain('versionCode 4');
    expect(out).toContain('versionName "1.2.0"');
    expect(out).toContain('namespace = "com.mansaas.app"');
    expect(out).not.toContain('signingConfigs');
  });

  it('signs release builds from environment variables, never a written password', () => {
    const out = editAndroidBuildGradle(GRADLE, { appId: 'com.pynacode.shop', versionCode: 1, versionName: '1.0.0', sign: true });
    expect(out).toContain("storeFile file(System.getenv('MANSAAS_UPLOAD_KEYSTORE'))");
    expect(out.match(/signingConfig signingConfigs\.release/g)).toHaveLength(1);
    // ...on the release build type, not debug.
    const release = out.slice(out.indexOf('release {', out.indexOf('buildTypes')));
    expect(release.indexOf('signingConfig signingConfigs.release')).toBeLessThan(release.indexOf('}'));
  });

  it('names the app and registers its own deep-link scheme', () => {
    const out = editAndroidStrings(STRINGS, { appId: 'com.pynacode.shop', name: "Ada's Shop & Co" });
    expect(out).toContain(`<string name="app_name">Ada\\'s Shop &amp; Co</string>`);
    expect(out).toContain('<string name="custom_url_scheme">com.pynacode.shop</string>');
    expect(out).toContain('<string name="package_name">com.pynacode.shop</string>');
    expect(out).not.toContain('com.mansaas.app');
  });

  it('escapes names for Android string resources', () => {
    expect(androidStringEscape(`He said "hi" <b>`)).toBe('He said \\"hi\\" &lt;b&gt;');
  });

  it('stops loudly if the project has changed shape', () => {
    expect(() => editAndroidStrings('<resources/>', { appId: 'com.a.b', name: 'A' })).toThrow(/app_name/);
  });
});

describe('iOS', () => {
  it('sets the bundle id, version, build and team in every configuration', () => {
    const out = editIosProject(PBXPROJ, { appId: 'com.pynacode.shop', version: '1.2.0', buildNumber: 4, teamId: 'ABCDE12345' });
    expect(out).not.toContain('com.mansaas.app');
    expect(out.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.pynacode\.shop;/g)).toHaveLength(2);
    expect(out.match(/MARKETING_VERSION = 1\.2\.0;/g)).toHaveLength(2);
    expect(out.match(/CURRENT_PROJECT_VERSION = 4;/g)).toHaveLength(2);
    expect(out.match(/DEVELOPMENT_TEAM = ABCDE12345;/g)).toHaveLength(2);
  });

  it('leaves the team for Xcode to ask when there is none', () => {
    const out = editIosProject(PBXPROJ, { appId: 'com.pynacode.shop', version: '1.0.0', buildNumber: 1, teamId: null });
    expect(out).not.toContain('DEVELOPMENT_TEAM');
  });

  it('names the app and registers its scheme', () => {
    const out = editIosInfoPlist(PLIST, { appId: 'com.pynacode.shop', name: 'Ada & Co' });
    expect(out).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Ada &amp; Co<\/string>/);
    expect(out).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>com\.pynacode\.shop<\/string>/);
    expect(out).not.toMatch(/<string>com\.mansaas\.app<\/string>/);
  });
});

describe('push in the native projects (16.4)', () => {
  const MANIFEST = read('android/app/src/main/AndroidManifest.xml');

  it("asks for Android's notification permission and names the status-bar icon", () => {
    const out = editAndroidManifestForPush(MANIFEST, { smallIcon: true });
    expect(out).toContain('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
    expect(out).toContain('android:resource="@drawable/ic_stat_notify"');
    expect(out.indexOf('ic_stat_notify')).toBeLessThan(out.indexOf('</application>'));
    expect(editAndroidManifestForPush(MANIFEST, { smallIcon: false })).not.toContain('ic_stat_notify');
  });

  it("only uses a Firebase config that includes this app", () => {
    const json = { client: [{ client_info: { android_client_info: { package_name: 'com.pynacode.shop' } } }] };
    expect(googleServicesIncludes(json, 'com.pynacode.shop')).toBe(true);
    expect(googleServicesIncludes(json, 'com.other.shop')).toBe(false);
    expect(googleServicesIncludes({}, 'com.pynacode.shop')).toBe(false);
  });

  it('gives the iOS app its entitlements file in every configuration', () => {
    const out = editIosProject(PBXPROJ, { appId: 'com.a.b', version: '1.0.0', buildNumber: 1, teamId: null, entitlements: 'App/App.entitlements' });
    expect(out.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
  });
});

describe('the listing pack (16.4)', () => {
  const config = {
    slug: 'pynacode', appId: 'com.pynacode.shop', name: 'Pynastore', version: '1.0.0', buildNumber: 3,
    serverUrl: 'https://m.getnotely.io', iconBackgroundColor: '#ffffff', splashBackgroundColor: '#ffffff',
    splashBackgroundColorDark: '#0b0b0c', appleTeamId: null,
  };
  const facts = {
    name: 'Pynacode', slug: 'pynacode', website: 'https://shop-pynacode.getnotely.io', supportEmail: null,
    pages: [{ kind: 'PRIVACY', url: 'https://shop-pynacode.getnotely.io/pages/privacy' }], reviewer: null,
  };

  it("uses the store's own web address", () => {
    expect(storeWebsite(config, null)).toBe('https://shop-pynacode.getnotely.io');
    expect(storeWebsite(config, 'www.pynastore.com')).toBe('https://www.pynastore.com');
  });

  it('links what exists, flags what does not, and mentions push only when the app has it', () => {
    const without = listingMarkdown(config, facts, { android: false, ios: false });
    expect(without).toContain('https://shop-pynacode.getnotely.io/pages/privacy');
    expect(without).toMatch(/Terms URL \| — not published yet/);
    expect(without).not.toMatch(/notification/i);
    const withPush = listingMarkdown(config, facts, { android: true, ios: true });
    expect(withPush).toContain('Device or other IDs');
    expect(withPush).toContain('Turn on notifications');
  });
});

describe('the offline screen', () => {
  it("is stamped with the store's name and the address to retry", () => {
    const out = editOfflinePage(read('mobile/www/offline.html'), { name: 'Ada & Co', serverUrl: 'https://m.getnotely.io' });
    expect(out).toContain('<meta name="app-name" content="Ada &amp; Co" />');
    expect(out).toContain('<meta name="app-server-url" content="https://m.getnotely.io" />');
    expect(out).not.toContain('__APP_');
  });
});

describe('images', () => {
  it('reads a PNG header', () => {
    const header = new Uint8Array(26);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(header.buffer);
    view.setUint32(16, 1024);
    view.setUint32(20, 1024);
    header[25] = 6;
    expect(pngInfo(header)).toEqual({ width: 1024, height: 1024, hasAlpha: true });
    header[25] = 2;
    expect(pngInfo(header)?.hasAlpha).toBe(false);
    expect(pngInfo(new Uint8Array(30))).toBeNull();
  });
});
