# Notifications on real phones and browsers (ROADMAP 18.7)

Phase 18 is tested in code: the whole suite, a unit test of the service
worker, and an HTTP check of a production build. What only a real device can
prove is below. Run it once on the **live site**, then again after any change
to push keys, the service worker or a store app build.

Localhost won't do. Push services can't reach your machine, and Safari only
offers notifications over HTTPS.

Tick each box. If one fails, the "If not" note says where to look first.

## Before you start

- [ ] **Console → Go-live checklist → Notifications** is all green. It checks
      the browser push keys, the Firebase key, Ably, the retry job and failed
      deliveries.
- [ ] `scripts/check-notification-urls.sh https <your domain> <shop-slug> [--app] [--custom-domain <host>]`
      prints **All good**. It checks the service worker, the install files and
      the store-link files over the internet, from outside.
- [ ] A test shop you can place orders in: pay-on-delivery switched on, and
      one product with a reorder point.
- [ ] Two people: you as the shop's Owner, and a second account to act as the
      shopper (or a private window).
- [ ] **For the store-app rows:** a store app built with push (`npm run mobile:app -- build <slug>`).
      For Android, `FIREBASE_SERVICE_ACCOUNT` is set and the app is in
      Firebase. For iPhone, its APNs key and links are recorded
      (docs/MOBILE-BUILD.md §2.6–2.7), and the iPhone build is installed from
      TestFlight.

## 1. Android phone, Chrome: the admin

- [ ] Sign in to the shop's admin. Open the bell, then **Get alerts on this
      device → Turn on**. Allow when Chrome asks.
- [ ] **Settings → Notifications** shows **On for this browser**.
- [ ] From another device, place a **pay-on-delivery** order. A notification
      arrives: "New order …".
- [ ] Tap it with Chrome closed: the order opens.
- [ ] Tap one with Chrome in the background: the existing tab goes to the
      order, and no second tab opens.
- [ ] The bell's count went up, and opening the notification brought it down.

If not: Go-live → *Browser notifications*. Is the phone in battery saver
(Android delays notifications)? Chrome → Site settings → Notifications for
the shop's address.

## 2. Android phone, Chrome: the storefront

- [ ] As a shopper, place an order on the shop's website and press **Turn on
      notifications** on the confirmation page.
- [ ] In the admin, mark it **shipped**. "Order … is on its way." arrives, and
      tapping it opens the order's page on the shop's own address.
- [ ] Signed in as a shopper: **Account → Notifications → Notifications on
      this device** turns on, and the update also shows in that list.

## 3. iPhone, Safari: the admin, installed

- [ ] Open the admin in Safari, **not** added to the Home Screen.
      **Settings → Notifications** shows the **Add to Home Screen** steps, not
      a button that does nothing.
- [ ] Add it to the Home Screen and open it from there. It opens as an app,
      with the platform's icon.
- [ ] **Turn on alerts**, and allow.
- [ ] Place an order from another device. The notification arrives with the
      app closed, and tapping it opens the order.

If not: iOS 16.4 or newer? Was it opened **from the Home Screen** and not
from Safari?

## 4. Android store app

- [ ] Install the store app's `.apk` (sideloading is fine; Play isn't needed).
- [ ] Place an order in the app and press **Turn on notifications**. Allow.
- [ ] Mark it shipped in the admin. The notification arrives, and tapping it
      with the app **closed** (swiped away) opens the order.
- [ ] Write to the shop in the app's chat, close the chat, and reply from
      Messages in the admin. "The store replied to your message." arrives,
      without the message's words, and tapping it opens the chat.
- [ ] Two quick updates about the same order show as **one** notification,
      not two.
- [ ] Links: tap a link to one of the shop's products in WhatsApp or a text
      message. It opens **in the app** on that product.
- [ ] **Settings → Apps → the app → Open by default** lists the shop's
      addresses as verified.
- [ ] A link to an invoice still opens the browser.

If not: Go-live → *Android app notifications*. Is the app id in Firebase
exactly the store app's? For links: is the upload key's fingerprint recorded
(`check` prints the command)? Was the app installed after the fingerprint was
recorded? Reinstall it.

## 5. iPhone store app (TestFlight)

- [ ] The same as §4: order and chat notifications, taps from a closed app,
      one notification per order.
- [ ] Signed in as a shopper, **Account → Notifications → Notifications on
      this phone** is **On**. An update arrives about an order you never
      pressed "Turn on" for. One "yes" covers all your orders.
- [ ] The app's icon shows the unread count. Opening Account → Notifications
      and pressing **Mark all as read** clears it within a few seconds.
- [ ] Links: open the order email in the Mail app and tap the order link. It
      opens **in the app**.

If not: no APNs key recorded? For links: is the Apple team id recorded, is
**Associated Domains** ticked on the App ID, and was the app built after the
store's domain was connected?

## 6. Desktop Chrome and Safari: platform staff

- [ ] In the console, **Notification settings → Turn on alerts**.
- [ ] Make an error happen (or wait for one), or run a scheduled job that
      fails. A notification arrives, and clicking it opens `/platform/errors`
      or `/platform/jobs`.
- [ ] A new shop signing up shows as "New shop" on the console's bell.

## 7. How it looks

- [ ] The bell and its dropdown, `/notifications`, and Settings →
      Notifications in **light and dark** mode, on a laptop and at phone
      width.
- [ ] The shopper's Account → Notifications at phone width, in both themes.
- [ ] **Turn off** for a category in Settings → Notifications: the next one
      in that category reaches the bell but not the device.

## 8. The daily summary

- [ ] Bring a product to its reorder point, and ask a question on a product
      as a shopper. Both are on the bell at once, with **no** email.
- [ ] The next morning (07:00 UTC), one email lists both. **Console →
      Scheduled jobs → Daily notification summaries** shows the run.

---

When every box is ticked, the go-live checklist's manual step
**Notifications on real phones and browsers** is done: mark ROADMAP 18.7
done.
