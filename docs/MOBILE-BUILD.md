# Building a store's own app

The runbook for the paid "own app" add-on (ROADMAP Phase 16). It takes a store
from "paid for an app" to an Android `.aab`/`.apk` and an iOS build ready for
App Store Connect. How the app works at runtime is in [MOBILE.md](../MOBILE.md).

**What we do and what the merchant does.** We build, sign, test and hand over
the app files, and fix anything a reviewer rejects that's on our side. The
merchant owns the Apple Developer and Google Play accounts and publishes the
app under them. We may help with that, but it's their listing.

**One deployment serves every app.** An app is a thin shell around the live
storefront. Products, prices and the shop's look change without a rebuild.
You rebuild only for a new name or icon, a native change, or Google's yearly
target-version deadline (below).

---

## 1. One-time machine setup

You need a Mac. iOS builds need macOS, and Android builds work there too.

| Tool | How | Check |
|---|---|---|
| Node 22 and the repo | `git clone …`, then `npm install` | `npm run mobile:app` prints usage |
| Java 21 (JDK) | `brew install openjdk@21`, or Android Studio's bundled JDK (`JAVA_HOME`) | `java -version` |
| Android Studio + SDK | Install it and open the repo's `android/` folder once. That writes `android/local.properties` with the SDK path. Or set `ANDROID_HOME`. | `npm run mobile:app -- check <slug> --platform android` |
| Xcode | From the App Store, opened once to accept the licence | `xcodebuild -version` |
| Production database | `DATABASE_URL` set to production in your shell, used to confirm the app is registered. Read-only use. | `check` names the host it looked at |
| Google Chrome | for the listing pack's screenshots (`CHROME_PATH` if it isn't in /Applications) | `npm run mobile:app -- listing <slug> --no-screenshots` works without it |

### Once for the platform: Firebase (Android notifications)

Android order notifications go through **one Firebase project that belongs to
the platform**. Every store's Android app is added to it.

1. Go to <https://console.firebase.google.com>. Create a project (e.g. "Notely
   apps"). Analytics is not needed; turn it off.
2. **Project settings → Service accounts → Generate new private key.** Put the
   JSON in Vercel as `FIREBASE_SERVICE_ACCOUNT` (Production), as-is or base64,
   then redeploy. Without it, Android apps never offer notifications.
3. For each store, add its Android app (§2 below), then download
   **google-services.json** (Project settings → Your apps). Save it as
   `~/mansaas-store-apps/google-services.json`. It holds every app in the
   project, so re-download it after adding each new one. A per-store copy at
   `~/mansaas-store-apps/<slug>/google-services.json` also works.

Each store's files live outside the repo, in `~/mansaas-store-apps/{slug}/`.
Set `MOBILE_APPS_DIR` to put them somewhere else, such as an encrypted volume.

## 2. Before a store's first build

**The order comes from the console.** The merchant asks for the app in
**Settings → Mobile app**, with its name, icon, colour, one line about the shop,
and Android and/or iPhone. They pay there; the price is set in the console's
**Billing settings → Store apps**. Paid apps wait in the console under
**Store apps → To build**, and staff get an email. The order page has:
- the app id (check it before building — it's permanent once published);
- the icon, as a 1024 px PNG;
- the kit's commands, ready to copy;
- the steps: **Start building**, **Mark delivered** (version, build number,
  a link to the Android files, a note), **Save listings** (App Store id,
  Google Play). Saving a listing makes the app live, emails the merchant,
  and lets their website offer it.

`init` reads the order: it downloads the icon to `logo.png` and takes the
colour, so nothing has to be copied by hand. The terminal commands below
(`prisma/mobile-app.ts register`, `listed`, …) still work. They're for apps
made before the console existed, or for fixing a record by hand.

Renewals look after themselves. The setup fee covers the first year; then
the merchant is reminded 30, 7 and 1 day(s) before each year ends and renews
on the same page. Unpaid, the app keeps working for the grace days set in
Billing settings, then shows "no longer available" until it's renewed
(`/api/cron/mobile-app-renewals`, daily).

### What the engineer still checks

1. **The add-on is paid.** Until the console screens exist (16.2), confirm the
   payment with whoever took it.
2. **Choose the app id.** Reverse-DNS, lowercase, letters and digits, e.g.
   `com.pynacode.shop`. **It is permanent once published.** Apple and Google
   treat a new id as a different app, and installed copies would never update.
3. **Register it** against production:
   ```
   npx tsx prisma/mobile-app.ts register <slug> <app-id> "<App name>"
   ```
   An app that isn't registered opens "This app is no longer available".
4. **From the merchant:**
   - a square **logo** PNG, 1024×1024 or larger (transparent background is fine);
   - the **app name** (30 characters at most) and the brand colour behind the logo;
   - **Store pages published:** Privacy policy and Terms (the build refuses
     without them), and Contact (strongly advised). Both stores ask for these links;
   - **for iOS:** their Apple Developer **Team ID** (Membership details,
     10 characters). They also add you in App Store Connect → Users and Access,
     as **App Manager** with **Access to Certificates, Identifiers & Profiles**.
     Only their own certificate can sign their app;
   - **for Google Play:** they create the app in their Play Console and invite
     you (Users and permissions), or they upload the file themselves.
5. **Android notifications:** in the platform's Firebase project, choose
   **Add app → Android**, package name = the app id, nickname = the store's
   name. Download google-services.json again (§1).
6. **iPhone notifications:** the merchant (or you, on their team) creates an
   **APNs key**: developer.apple.com → Certificates, Identifiers & Profiles →
   **Keys → +**, tick **Apple Push Notifications service (APNs)**, then
   download `AuthKey_<KEYID>.p8`. It can be downloaded only once. Record it
   against production with production's `SOCIAL_TOKEN_KEY` set, because the
   key is encrypted with it:
   ```
   export SOCIAL_TOKEN_KEY="…production value…"
   npx tsx prisma/mobile-app.ts apns <slug> --team-id <TEAMID> --key-id <KEYID> --key ~/Downloads/AuthKey_<KEYID>.p8
   ```
   Then delete the `.p8` file from your machine. One key works for all of
   the merchant's apps.

## 3. Build

```
npm run mobile:app -- init  <slug>          # once: folder, app.json, Android upload key
#   → put logo.png (and optionally icon.png, splash.png, splash-dark.png) in the folder
#   → set colours / appleTeamId in app.json
npm run mobile:app -- check <slug>          # everything a build needs, nothing built
npm run mobile:app -- build <slug>          # Android + iOS
npm run mobile:app -- build <slug> --platform android
npm run mobile:app -- build <slug> --version 1.1.0      # a new version for shoppers
```

**What `build` does:**
- copies the shared `android/` and `ios/` projects into `{slug}/work/`. The
  repo's copies are never edited;
- writes in the app id, name, version, build number, deep-link scheme and
  Apple team (`scripts/mobile/native-project.ts`);
- makes every icon and splash size from `logo.png`
  (`@capacitor/assets`). A finished `icon.png` or `splash.png`, if present,
  replaces the generated one;
- builds and signs Android. The files go to `{slug}/builds/{version}-{n}/`
  with a `build.json`, which records the commit, the checksums and the server
  URL. Hand those files over;
- leaves the iOS project ready in `{slug}/work/ios/App/App.xcodeproj`, with
  push notifications switched on (`App.entitlements`);
- **notifications:** with a google-services.json that includes the app, the
  Android build can receive order notifications. Its status-bar icon is a
  white silhouette made from `logo.png`, so give it a transparent background.
  Without that file, the build works but never offers notifications.

The **build number** rises by one with every release build and is stored in
`app.json`. Both stores refuse a number they've already seen, so never lower it.

### `app.json`

| Field | Meaning |
|---|---|
| `appId`, `name` | as registered (step 2) |
| `version` | what shoppers see, `1.0.0`; change it with `--version` |
| `buildNumber` | the last one used; the kit raises it |
| `serverUrl` | the live mobile origin, `https://m.getnotely.io`; release builds must be https |
| `iconBackgroundColor`, `splashBackgroundColor`, `splashBackgroundColorDark` | behind the logo |
| `appleTeamId` | the merchant's team, or `null` to choose it in Xcode |

### iOS: archive and upload

1. In the merchant's developer account, register the **App ID**
   (Certificates, Identifiers & Profiles → Identifiers → `+`, bundle id =
   the app id). In App Store Connect, create the app (**My Apps → `+` → New App**)
   with that bundle id.
2. `open ~/mansaas-store-apps/<slug>/work/ios/App/App.xcodeproj`
3. Under Signing & Capabilities, check that the team is the merchant's and that
   "Automatically manage signing" is on.
4. Pick **Any iOS Device (arm64)**, then **Product → Archive → Distribute App →
   App Store Connect → Upload**.
5. The build appears in TestFlight after processing. Install it on a phone and
   run the checklist below.

## 4. The listing pack

```
npm run mobile:app -- listing <slug> --reviewer-account
```

This writes `~/mansaas-store-apps/<slug>/listing/`:
- **`LISTING.md`:**
  - every link both stores ask for (privacy, terms, support, account deletion);
  - a **draft** description for the merchant to rewrite;
  - the Apple App Privacy and Google Data safety answers, based on what the
    app actually collects;
  - age rating guidance;
  - review notes;
- **screenshots** at the sizes App Store Connect and Google Play require
  (iPhone 6.9", iPad 13", Android phone), taken from the live store as the
  app shows it;
- the **Google Play icon (512×512) and feature graphic (1024×500)**.

`--reviewer-account` creates a customer called "App store review" in the
merchant's store, with a sign-in for Apple's and Google's reviewers. Running
it again resets the password. Delete that customer once both apps are
approved. Re-run without it, after the merchant changes their store's look,
to refresh the screenshots.

## 5. Test on a real phone before handing over

**Android:** install the `.apk` with `adb install <file>.apk`, or send it to
the phone and open it. **iOS:** use TestFlight.

- [ ] The icon and name under it are the store's.
- [ ] It opens straight into the store: no store picker, no Notely screens.
- [ ] Browsing, search, product pages and the cart work.
- [ ] **Payment:** start checkout and the payment page opens in a sheet. Closing
      it returns to the order. A completed payment comes back to *this* app,
      not the shared one or the browser.
- [ ] **Continue with Google** opens a sheet and comes back signed in.
      Email sign-in works.
- [ ] Android back button: goes back, and leaves the app from the store's home.
- [ ] A link to another store does not open it.
- [ ] Splash and status bar look right in light and dark mode.
- [ ] Account → Privacy → delete account works. Both stores require it.
- [ ] The product page's **Share** button opens the phone's share sheet.
- [ ] With the phone in airplane mode, the app shows "Can't reach … right
      now". **Try again** returns to the store once the phone is back online.
- [ ] **Notifications** (if set up): place an order and press **Turn on
      notifications**. Then mark the order shipped in the dashboard. The
      notification arrives, and tapping it opens the order. iPhone needs a
      TestFlight build, because an app run from Xcode uses Apple's test
      service.

To test against your own machine first, make a debug build that loads your
dev server over the network:
```
npm run dev:mobile
npm run mobile:app -- build <slug> --platform android --debug --server-url http://<your-LAN-IP>:3000
```
The app must be registered in **your dev database** for that. Debug builds
don't use up a build number.

## 6. Hand over

- **Google Play:** the `.aab`. New apps use Play App Signing by default:
  Google holds the app's signing key and our key only *uploads*. If you
  upload for the merchant, do it from their Play Console.
- **Direct install:** the `.apk` can go to the merchant to share as they like.
  Shoppers must allow "install unknown apps".
- **iOS:** the build is already in their App Store Connect (step 3).
- **What the merchant still has to do:**
  - fill in the store listings: description, screenshots, the privacy and
    data-safety answers, age rating;
  - submit the app for review.

  A new *personal* Google Play account has to run a 12-tester, 14-day closed
  test before it can publish. A business account skips that but needs a
  D-U-N-S number.

## 7. Keeping it running

- **Back up `{slug}/signing/` and `app.json` as soon as `init` makes them.**
  Keep them in the company password manager or an encrypted drive. Never put
  them in git, email or chat. Without the upload key, an Android update can't
  be uploaded until Google support resets it, which takes days.
- **Yearly rebuild.** Google Play requires apps to target an Android version
  from within the last year. Update Capacitor and the shared projects, then
  rebuild every store's app with `--version` raised.
- **Once the listings are approved,** record them. The store's website then
  offers the app: a banner on phones, "Get our app" in the footer, and a
  `/app` page with a QR code for computers.
  ```
  npx tsx prisma/mobile-app.ts listed <slug> --app-store-id 1234567890   # the number in apps.apple.com/app/id…
  npx tsx prisma/mobile-app.ts listed <slug> --google-play
  npx tsx prisma/mobile-app.ts website <slug> off                        # if the merchant doesn't want it
  ```
- **Add-on not renewed:** `npx tsx prisma/mobile-app.ts lapse <slug>`. The app
  then shows "no longer available" with a link to the store's website.
  `restore <slug>` undoes it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Couldn't find … Has the native project changed shape?` | A Capacitor upgrade changed a file the kit edits. Update `scripts/mobile/native-project.ts` and `tests/mobile-build.test.ts`, which read the real files. |
| The app shows "This app is no longer available" | Not registered, LAPSED, or registered under a different app id than the build used (`check` compares them). |
| The app shows the store picker | It was built without the kit (no `MansaasApp/` marker), so it's the shared app. |
| Gradle: "Unsupported class file major version" | Wrong Java. Use JDK 21 (`JAVA_HOME`). |
| No "Turn on notifications" on the order page | Android: `FIREBASE_SERVICE_ACCOUNT` isn't set in production, or the build had no google-services.json with this app. iPhone: no APNs key recorded (§2.6). |
| Android notification icon is a grey square | `logo.png` has no transparent background. Use one that does and rebuild. |
| Xcode: "No profiles for '…' were found" | You're not on the merchant's team with certificate access, or the App ID isn't registered (step 3.1). |
