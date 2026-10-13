# The business app in the stores (ROADMAP 19.3)

What App Store review and Google Play need for the business app
(`com.mansaas.business`, "{PLATFORM_NAME} Business"), and the answers to
give. The app is built in 19.5 and submitted in 19.6. This page is the
source for the listing pack and the review notes. Re-read each store's
current rules before every submission: they change.

---

## 1. No buying in the app

**The rule we rely on.** Apple App Review Guideline **3.1.3(f), Free
Stand-alone Apps:** a free app that's a companion to a paid web tool
needn't use in-app purchase, *provided there is no purchasing inside the
app, or calls to action for purchase outside of the app*. Google Play's
payments policy is read the same way, so both apps behave alike.

**What the app does** (built in 19.3). Recognised by its user-agent marker
(`lib/business-app/request.ts`). A browser on the business host is NOT
affected.

| Where | In a browser | In the app |
|---|---|---|
| `/upgrade` | plans, prices, checkout | "Your plan": the plan, its state and dates, and which feature isn't on it. No prices, no buttons. |
| Settings → Billing | change plan, prices, payment history | the plan, its state and dates; cancelling stays. No prices, no history. |
| Settings → Domain | buy a `.com`, renew, prices | connect a domain you already own (free); "registered until"; no buying, no renewal price |
| Settings → Mobile app | order and renew a store app | an ordered app's progress and "paid until"; nothing to order |
| Locked features (stores, reports, suppliers, activity download…) | the explanation plus "See plans" | the explanation only (`UpgradeLink` renders nothing) |
| Trial, grace and lapsed notices | "Choose a plan…" | the facts and dates only |
| Server actions (checkout, buy or renew a domain, order or pay for a store app, domain search with prices) | as before | refused: "This isn't available in the app." |

**What's allowed and stays:** creating an account, the free no-card trial,
signing in to an existing paid shop, cancelling a plan, and the shop
selling to ITS customers. Those are physical goods paid on the shop's own
website, Guideline 3.1.3(e).

**Tests:** `tests/business-app-store-rules.test.tsx`.

## 2. Account deletion

Guideline **5.1.1(v)**: an app that supports account creation must let the
person delete their account in the app.

- **Where:** Settings → Your account → **Delete my account**. Without a
  shop yet: "Delete my account" at the foot of "Create your shop"
  (`/onboarding/account`).
- **What happens:** `docs/DATA-RIGHTS.md` → "A staff member's own account".
- **Tell the reviewer:** the path above, and that the only Owner of a shop
  is first asked to add another Owner or close the shop (records the law
  requires are kept).

## 3. Signing in

- **Methods:** email and password, Google, and Sign in with Apple
  (Guideline 4.8, required once Google is offered). All three work in the
  app (19.2).
- **Apple's settings:** `.env.example`.

## 4. Reviewer access

Both stores reject an app they can't get into. Before submitting:

1. **Create the demo shop** by signing up in the app itself, with a real
   inbox the team reads. Suggested: `review@{PLATFORM_DOMAIN}`, shop
   "Notely Demo Shop".
2. **Fill it so every main screen has something:**
   - a few products with photos, one with variants;
   - one store with delivery set;
   - pay-on-delivery on;
   - the shop opened;
   - a couple of orders from another phone;
   - one chat;
   - one walk-in sale.
3. **Payments:** don't connect a live Paystack account. Leave online
   payments off (pay on delivery only), so a reviewer can't move money.
4. **Plan:** give it a running plan from the console (Merchants → the shop
   → Plan), so no plan notice is on screen during review.
5. **Notes for the reviewer** (App Store Connect → App Review Information;
   Play → App content → App access):
   - the email and password;
   - "This is the companion app for merchants who run their shop on
     {PLATFORM_NAME}. Plans are not sold in the app.";
   - where to find account deletion (section 2).
6. **Keep it working:** don't delete the demo account, change its password
   or let its plan lapse while a review is open.

## 5. Privacy answers

We don't track (ROADMAP 13.9). There are no ads, analytics or attribution
SDKs. Push uses the platform's own Firebase project (Android) and APNs
(iPhone), for notifications only. Answer as below, and keep it in step
with `app/(legal)/privacy/page.tsx`.

### Apple: App Privacy

**"Do you or your third-party partners collect data from this app?"** Yes.
**Tracking:** No, for every type.

| Data type | Collected | Linked to the person | Used for |
|---|---|---|---|
| Contact info → Name | yes | yes | App functionality |
| Contact info → Email address | yes | yes | App functionality |
| Contact info → Phone number | yes, if entered (shop contact) | yes | App functionality |
| Financial info → Other financial info | yes: the bank account a shop is paid into | yes | App functionality |
| User content → Photos or videos | yes: product photos | yes | App functionality |
| User content → Other user content | yes: products, orders, messages with shoppers | yes | App functionality |
| Identifiers → User ID | yes | yes | App functionality |
| Diagnostics → Crash data | yes: the built-in error log (page and host only) | **no** | App functionality |

**Not collected:** location (a store's address is business data the
merchant types; it isn't the device's location), contacts, browsing
history, search history, purchases, health, sensitive info.

### Google Play: Data safety

- **Collected:** Personal info (name, email, phone), Financial info (other
  financial info: payout bank account), Photos, App activity (other
  user-generated content), App info and performance (crash logs).
- **Shared with third parties:** no. Paystack (payouts) and Cloudinary
  (photos) act as our processors, which Play counts as "not shared". Check
  the current definition.
- **Encrypted in transit:** yes.
- **Deletion:** the person can request deletion in the app (section 2).
  The web deletion link Play asks for is `https://{PLATFORM_HOST}/privacy`
  (section "Your rights" says how).

## 6. "More than a website"

Guideline **4.2, Minimum functionality.** Say in the review notes what the
app does that a website doesn't:
- native push for new orders and chats (19.4);
- the camera for product photos;
- the share sheet for receipts and spreadsheets;
- a badge count;
- links that open the app (19.4–19.5);
- a proper offline screen.

Don't submit before 19.4's native pieces are in.
