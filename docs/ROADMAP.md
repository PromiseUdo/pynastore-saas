# MansaaS build roadmap

Agreed 2026-09-22, after an audit of the vendor dashboard. Phases are ordered by
dependency, not by appetite — read "Sequencing" before picking one up.

Each phase below is self-contained: it states the gap, the decision already taken,
and the deliverables. Starting a phase should not require re-auditing the codebase.

Status key: `TODO` · `IN PROGRESS` · `DONE (date)`

---

## Phase 0 — Stop the bleeding — DONE (2026-09-22)

Things that were visibly broken or untrue. All shipped 2026-09-22.

- **0.1 Real dashboard home — DONE.** `dashboard/page.tsx` now reads this store's
  own figures through `features/dashboard/overview.ts`: money confirmed today,
  orders placed today, orders waiting to be packed, low stock, plus
  needs-attention callouts (returns, unanswered questions, overdue invoices) and
  the latest eight orders. Every figure is a database count or aggregate, and each
  section follows the member's permissions — `inventory.view` alone shows stock and
  no money. `loading.tsx` and `error.tsx` added.
- **0.2 Settings → General — DONE.** `features/settings/organization.ts` +
  `settings/page.tsx`: business name, logo (Cloudinary, new `organization` upload
  purpose gated on `settings.edit`), contact email/phone/address, the workspace
  currency, and the store's web address shown as read-only with the reason. The
  returns window is NOT here — it was already owned by Settings → Delivery and
  returns, and one field with two editors is one too many.
- **0.3 Currency — DONE.** Added `Organization.currency`; `Invoice`, `Quote` and
  `PurchaseOrder` now default to NGN and take the org's currency at creation
  (`ctx.organization.currency`, now carried on the org context). The four callers
  that hard-coded `'USD'` no longer pass one. Migration
  `20260922100000_org_settings_and_currency` backfills existing rows.
- **0.4 Dead nav and dead controls — DONE.** Removed the `/staff` and `/suppliers`
  nav entries (duplicates of `/settings/members` and `/procurement/suppliers`) and
  `/reports` (Phase 7), and removed the non-functional search box and notification
  bell from the header. Both spots carry a comment pointing at the phase that fills
  them.
- **0.5 `EMAIL_FROM` — DONE.** No more `versetwofit.com` fallback: `sendFrom()`
  logs and the send is skipped when it is unset, which keeps this module's promise
  never to throw. **`EMAIL_FROM` must now be set in every environment or no email
  goes out.**
- **Also done, found on the way:** the platform's own name was still "SafeBase"
  across the auth screens, the invite page, page titles and four email templates.
  Now one constant, `PLATFORM_NAME` in `lib/brand.ts` — deliberately not used on
  the storefront, which carries the merchant's name.

New shared pieces worth reusing: `lib/brand.ts` (`PLATFORM_NAME`),
`lib/currencies.ts` (`SUPPORTED_CURRENCIES` — kept out of the `'use server'` file,
which may only export async functions), `lib/day.ts` (`startOfTodayInLagos`, for
any "today" figure), and `formatRelativeTime` in `lib/format.ts`.

## Phase 1 — Audit log — DONE (2026-09-22)

Shipped 2026-09-22. The data already existed — `createAuditLog` (`lib/audit.ts`)
is called from ~30 server-action files — and had no read surface at all.

- **The page.** `/settings/activity`, filtered by member, area, date range and a
  search on the record id. All of it lives in the URL and becomes Prisma `where`
  clauses; the browser only ever holds the 25 rows it was given. Needs
  `settings.view`. "Nothing has happened yet" and "no activity matches those
  filters" are separate states.
- **The words.** `lib/audit-labels.ts` turns `procurement.po.approved` into
  "Approved a purchase order", from an entity map, a verb map and nine overrides
  for the ones the pattern says badly. `describeAuditAction` returns null for an
  action it has not been taught, and `lib/audit-labels.test.ts` holds **all 86
  action keys the app actually writes** and fails if any of them falls through —
  so a new action cannot reach a merchant's screen as a raw key.
- **The download.** `exportActivity` returns every row the filters match (capped
  at 5000), not the page on screen. It ships `FEATURES.AUDIT_LOG_EXPORT`, which
  was sold on Pro with zero call sites. The plan is re-checked on the server, and
  non-Pro sees a "Download on Pro" button linking to `/upgrade` rather than
  nothing (AGENTS §7).
- **Per member.** Settings → Members gained an "Activity" action per row, linking
  to `/settings/activity?member=<id>` — one filtered page rather than a member
  detail page that does not otherwise exist.
- **Also done, found on the way:** removing a member had **no confirmation at
  all**, though AGENTS §4 names it. It now goes through an `AlertDialog` that says
  what happens. The joined date on that table also went through a bare
  `toLocaleDateString('en-US')`, which drifts between server and client — now
  `formatDate`.

`ExportCsvButton` gained a `fetchRows` shape for server-paginated lists, alongside
the existing `rows` one. Reuse it for any list whose CSV should be more than the
visible page.

Tests: `tests/activity-log.test.ts` (tenancy, the permission gate, the plan gate,
and that searching for another store's record id returns nothing) and
`lib/audit-labels.test.ts`.

## Phase 2 — Unify the sales channel (walk-in sales) — DONE (2026-09-22)

Shipped 2026-09-22. A counter sale is now an `Order` like any other.

- **Schema.** `Order.channel` (`ONLINE | WALK_IN | PHONE`), plus `warehouseId`
  (which store's shelf it came off) and `soldByUserId` (who rang it up).
  `customerId`, `confirmationToken`, the contact columns, the seven `ship*` and
  the five `delivery*` columns are nullable — **null, never blank**, so a
  counter sale can't render as a half-empty delivery address. Migration
  `20260922160000_order_channel_walk_in` backfilled all existing rows to
  `ONLINE` before relaxing anything.
- **The till.** `/sales/orders/new` + `features/sales/counter-sale.ts`. Search
  by name, SKU or barcode; the box keeps focus and clears after each pick, so a
  barcode scanner works without touching the mouse. Optional per-line price
  override (haggling is normal), whole-sale discount, and cash / card /
  transfer / paying-later.
- **The customer.** The till searches existing customers by name, phone or
  email — including a shopper who has only ever bought online — and shows how
  many orders they already have. Typing a name instead CREATES the customer
  record, so the next visit is already there and Phase 4's metrics count these
  orders. An existing record is matched on **phone only, never on name**: two
  people called Ada Obi are two people. An anonymous cash sale creates nobody,
  because a "Walk-in customer" row collecting every anonymous sale would be
  worse than nothing.
- **Stock.** `reserveOrderStock` gained a `warehouseId` so a counter sale draws
  from the one store the customer is standing in — **whether or not it sells
  online** — then dispatches in the same transaction, because the goods have
  already gone. Same conditional update, so two tills can't sell the last one.
- **Receipt.** `/sales/orders/[orderId]/receipt`: narrow, black on white, no
  chrome, `print:hidden` button. Everything on it is already recorded against
  the order.
- **Lists.** The order list now filters by channel, status and search **in the
  database**, with pagination — it used to take the newest 200 and filter them
  in the browser, which stopped being the truth at order 201. The dashboard's
  "Orders today" tile splits by channel when more than one is in play.
- **Permission.** New `sales.order.create`, held by Owner/Admin, Sales
  Representative and Warehouse Manager. **Existing custom roles do not have it
  until someone grants it** in Settings → Roles.

**The seam that keeps this contained:** every query in
`lib/storefront/orders/read.ts` filters `channel: 'ONLINE'`, so a shopper's
account, track-order and the confirmation page cannot surface an in-store
purchase — and those files' non-null assumptions stay true. Online payment
(`payment-service.ts`) is likewise online-only: a counter sale can never be
pushed through a checkout link.

`recordDeliveryPayment` now also settles a counter sale that was "paying
later" — same act, money handed over in person — while an order awaiting an
ONLINE payment still can't be marked paid by a button.

Tests: `tests/counter-sale.test.ts` (13 cases — stock leaves the right store,
a refused sale leaves no order behind, tenancy, and that a counter sale never
reaches the storefront even when attached to a real customer).

**Known gap:** a counter sale can't yet be returned. `OrderReturn` is the
shopper-initiated storefront flow; an in-store return needs its own path and
belongs with Phase 3's receipts or Phase 4.

## Phase 3 — Finish invoices and receipts — DONE (2026-09-22)

Shipped 2026-09-22. An invoice could previously be issued but never reach
anyone: no email, no customer-facing page, nothing to link to.

- **Sending.** `sendInvoice` issues a draft on the way out and emails it;
  "Issue without sending" stays for a merchant who wants the stock committed
  first. Re-sending never mints a second link — the customer may have
  bookmarked the first. An invoice whose customer has no email address says so
  instead of failing somewhere in the mail layer.
- **The link.** `Invoice.publicToken`, 256 bits, minted on the first send —
  the invoice number counts upwards, so it can never be what opens the page.
  `lib/storefront/invoices/read.ts` matches the token TOGETHER with the store,
  and a draft, a voided invoice and a wrong token all answer identically, so
  the page can't be used to discover which invoices exist.
- **The customer's copy.** `/invoice/{token}` on the storefront host, outside
  the (shop) group — someone opening a bill isn't shopping. One printable
  column: what it's for, what it comes to, what has been paid, and the
  merchant's bank details with the invoice number as the reference. The bank
  details disappear once it's settled.
- **Reminders.** A "Send reminder" button that counts the days overdue.
  Deliberately a button, not a schedule: an automatic dunning sequence is the
  merchant's relationship with their customer, not ours to run for them.
- **Receipts.** `components/sales/receipt-document.tsx` — the counter-sale
  receipt and the new paid-invoice receipt are the same document with
  different facts at the top, so there is one implementation. An invoice with
  nothing recorded against it has no receipt at all, rather than one claiming
  money changed hands.
- **Branding.** `emails/invoice.tsx` carries the merchant's own logo and name
  and never mentions the platform, like the other customer-facing emails.
- **Also fixed on the way:** the invoice detail page formatted money with bare
  `toFixed(2)` and printed its status through `.replace('_', ' ')` — both
  named in AGENTS §6.

**Deferred, with the reason: paying an invoice online.** `OrderPayment` is
hard-tied to `orderId`, and the whole settlement path — `startOrderPayment`,
`reconcileOpenAttempts`, the Squad webhook — is order-shaped, ending in
"confirm the order and re-reserve its stock". Wiring invoices through it means
a second settlement path, and a payment link that settles only sometimes is a
money bug. The invoice instead carries the merchant's bank details, which is
how these are actually paid here, and the merchant records the payment. Revisit
with Phase 7's payouts work, where the money side is being looked at anyway.

- **The create form.** Was a dialog whose button said "Create draft" — which
  named the resulting STATUS, not what the click did, while actually writing a
  real numbered invoice. It is now a page (AGENTS §4: line items don't belong
  in a dialog) with two buttons that each name their own result, **Create and
  send** and **Save as draft**, and a line under them saying exactly what each
  one does. Line items and customers are searched
  (`features/sales/lookup.ts` + `components/sales/search-picker.tsx`) instead
  of being `<Select>`s holding the whole catalogue — the list page no longer
  ships every customer, store and product to the browser to fill dropdowns.
  The till uses the same picker, so both screens behave identically: type to
  search, ↑ ↓ to choose, Enter to take, and a scanned barcode with one exact
  match is taken without a keystroke.
- **Also fixed:** the invoices list formatted money with `toFixed(2)`, dates
  with `toLocaleDateString()` and statuses with `.replace('_', ' ')`, and built
  its header by hand instead of using `PageHeader`. It now leads with what the
  merchant came to find out — what's outstanding, and how many days late each
  overdue invoice is.

Tests: `tests/invoice-sending.test.ts` (12 cases — token-only access, tenancy,
draft/void/wrong-token answering alike, no-email refusal, reminder rules, and
that the invoice number cannot open the page).

## Phase 4 — Customer management — DONE (2026-09-22)

Shipped 2026-09-22. The list showed a name, a contact and a count of quotes
and invoices — true, and no use.

- **The detail page.** `/sales/customers/[customerId]`: what they're worth
  across the top, then what they buy most, every order (both channels),
  reviews and questions they've left, with contact, addresses, labels, notes
  and consent down the side.
- **Metrics.** Orders, lifetime spend, average order, first and last order,
  return rate, outstanding invoices. **Cancelled orders count towards
  nothing** — somebody changing their mind is not custom — and the list and
  the detail page share that rule so they can't disagree. The return rate is
  `returnRatio` (0–1, AGENTS §10) and is **null, not 0%**, for someone who has
  never ordered.
- **Segments** as URL filters: repeat, gone quiet (no order in
  `INACTIVE_AFTER_DAYS`), new this month, has returns, never ordered, agreed
  to marketing. Each says in one line what it counts.
- **One raw SQL query** behind the list, on purpose: the figures are
  aggregates over orders and the list sorts and filters BY them, which Prisma
  cannot express — the alternative was loading every customer and every order
  into Node. Parameterised throughout.
- **Merging.** Duplicates are suggested by phone, then email, then exact name,
  and say which. Merging moves orders, invoices, quotes, reviews, questions,
  addresses and wishlist in one transaction, keeps both sets of notes
  (labelled), and fills a gap in the survivor's phone without overwriting it.
  The merged record is **not deleted**: it stays pointing at the survivor,
  excluded from every list and search. Matching is never by name alone —
  two people called Ada Obi are two people.
- **Consent.** `marketingConsent` + `consentUpdatedAt` on Customer, the
  prerequisite Phase 5 needs. A merchant records what the customer told them;
  the date is stamped because "when did they agree" is the question that gets
  asked.
- **Search, pagination and CSV export** on the list, all filter-aware.

Tests: `tests/customer-insights.test.ts` (18 cases — cancelled orders excluded
from the money, list and detail agreeing, each segment narrowing correctly, an
unrecognised segment widening rather than emptying, merge moving everything and
counting it once, and no path to another workspace's customers).

## Phase 5 — Marketing and campaigns — PARTLY DONE (2026-09-22)

Campaigns shipped 2026-09-22. **Email campaigns are NOT built** — see the
bottom of this section.

- **`Campaign`** — name, window, mechanic (percent or amount off), and targets
  (products, collections, categories, or the whole store). A category takes
  its descendants with it, because "Fashion" on sale and "Fashion → Skirts" at
  full price is a bug to a shop owner whatever the data model says.
- **Scheduled price overrides, as decided.** Scheduling resolves the targets
  and writes one `CampaignPrice` row per product, snapshotting what it was
  selling for. **`InventoryItem.sellingPrice` is never touched** — so ending a
  sale restores nothing because nothing was overwritten, the strike-through a
  shopper sees is what the shop was actually charging, and a later price edit
  can't move a live sale price. There is a test asserting `sellingPrice` is
  unchanged after a sale runs and ends.
- **ACTIVE and ENDED are not stored.** A campaign is live when the clock is
  inside its window. Nothing has to be flipped on time, so nothing can fail to
  — the failure mode of a stored flag is a sale that stays on, which costs a
  real shop real money. `lib/marketing/campaign-rules.ts` derives the rest.
- **The storefront shows AND charges it**, because both come from the same
  catalogue: `loadLiveCampaignPrices` feeds `loadCatalogueFromDb`, and
  checkout re-resolves its lines through that same catalogue. There is no
  second implementation to disagree.
- **Overlapping sales: the cheaper wins.** Any other rule means showing one
  price and charging another, or letting creation order decide what someone
  pays.
- **Preview before commit.** The create form lists every price that will
  change, with old beside new, before anything is committed — and leaves out
  products the discount wouldn't actually change rather than listing them
  under a sale banner at their usual price.
- **Performance is computed, not stamped**: orders placed inside the window
  containing something the campaign priced. `discountGiven` is the gap between
  the snapshotted original price and what was actually charged — the real cost
  of the sale, which nothing else in the app could tell a merchant.
- **`DiscountCode.campaignId` and `SocialPost.campaignId`** link codes and
  posts to the campaign they belong to, so Social Commerce becomes a
  campaign's distribution arm. Both are optional — not every discount or post
  is part of a campaign.

- **Announcing it.** A campaign can carry a bar above the header (optionally
  scrolling) or a pop-up shown once per shopper, in the merchant's own words
  and colours. It exists because the discount is rarely the whole message —
  "orders for sale items ship from the 27th" is the sort of thing a merchant
  needs to say alongside a sale and had nowhere to say. **Empty text turns it
  off whatever the style says**: a shop with nothing to announce announces
  nothing, and no sentence is ever written for them. The bar cannot outlast
  the sale, because it is read from the same live-campaign window as the
  prices. Links are restricted to a store path or https, colours to `#rrggbb`,
  and the marquee stops entirely under `prefers-reduced-motion`.

**Deliberately NOT built, with reasons:**

*BOGO, bundles and free delivery.* These are cart rules, not prices: they
depend on what else is in the basket, so they cannot be resolved to a price
list ahead of time. They belong with the checkout engine, next to delivery
quoting and discount codes, not with a price override.

*Email campaigns.* This is a subsystem, not a screen: a sending pipeline,
per-recipient unsubscribe tokens, a suppression list, bounce handling and open
tracking. Consent (`Customer.marketingConsent`) only landed in Phase 4, so
there is not yet a base to send to. Sending marketing email without working
unsubscribe and suppression is a legal problem, not a rough edge — so it is
better left visibly missing than half-present. It is the natural next phase,
and the segments and consent it needs are now in place.

Tests: `lib/marketing/campaign-rules.test.ts` (11 — windows, rounding, the
overlap rule) and `tests/campaigns.test.ts` (15 — sellingPrice untouched,
category descendants, the storefront price before/during/after, tenancy).

## Phase 6 — Storefront content and appearance — PARTLY DONE (2026-09-23)

Shipped 2026-09-23. Every store opened the same way because
`getHomepageSections` returned an empty hero with no table behind it.

- **Front page slides.** `StorefrontHeroSlide` + Settings → Storefront:
  eyebrow, headline, subtitle, picture, button, alignment, light/dark text,
  show/hide and ordering, with a live preview beside the form. One slide is a
  still panel; several rotate, pause on hover and focus, and stop under
  `prefers-reduced-motion`. A slide with no picture is a plain panel; nothing
  is borrowed to fill it.
- **Slides REPLACE the discovery hero** rather than stacking above it. Two
  full-width openings in a row is two answers to "what is this shop", and the
  second reads as leftover furniture. All four ways in survive: the header
  carries its search box from the first pixel instead of waiting for the hero
  to scroll away, "Search by image" moved INTO that search box (so it is now
  on every page, not just the homepage), the assistant became a floating
  helper, and `<DiscoveryStrip>` carries guided narrowing underneath the
  slides.
- **`DiscoveryStrip` is not optional furniture.** The shopping-mission and
  budget tiles publish a request to the discovery store, and `DiscoveryHero`
  was the only thing listening — without a listener, tapping one did nothing
  at all. The fetch, its rate-limit handling, the supersede guard and the
  scroll-and-focus behaviour are now one hook (`useDiscoveryRun`) shared by
  both surfaces, rather than two copies free to drift.
- **Colours on a slide are fixed, not theme tokens.** "Light text" means
  white, whatever else is going on; `text-foreground` flips to near-white
  when a shopper puts the storefront in dark mode, which made "dark text"
  invisible. The wash behind the words runs from whichever side the words sit
  on (`scrim()`, tested) — a left-to-right gradient left centred and
  right-aligned headlines over its clear end.
- **Brand colour.** `storefrontAccent` sets the `--brand` token the whole
  storefront already reads, so every `bg-brand` follows. Empty keeps the
  storefront's own.
- **SEO, which was entirely absent.** `sitemap.xml` built from the catalogue
  seam (so it lists only what a shopper may see) and `robots.txt`, both per
  store. Per-store meta description, canonical, OpenGraph and Twitter cards
  from a merchant-written tagline and share image, falling back to their logo.
- **Tracking.** Google Analytics and Meta pixel ids, validated on the way in,
  and **no third-party script loads at all unless a merchant has pasted one
  in** — not a disabled one, not a stub.
- **A slide's button uses the same destination picker as a campaign
  announcement**, so it can't point at a page the shop hasn't got.

**Already covered, not rebuilt:** featured collections and categories, and
their order, are managed where they live — the collection form and the
category sheet both have `isFeatured` and `sortOrder`.

**NOT built:** promo banner bands on the homepage. Phase 5's campaign
announcement (a bar or a pop-up, in the merchant's words and colours) now
covers "tell customers about the sale", and a second banner system would be a
second place to say the same thing. Font choice is also out — a type token
set is a design-system decision, not a settings field, and the storefront's
Fraunces/Geist pairing is load-bearing.

`robots.ts` is deliberately a route handler, not Next's file convention: that
one only registers at the root of `app/`, and every storefront lives under
/store/{slug} behind a proxy rewrite. A convention that silently never
registers is worse than no file.

Tests: `tests/storefront-appearance.test.ts` (12 — defaults when nothing is
set, hidden slides, a button needing both halves, colour and measurement-id
validation, tenancy).

## Phase 7 — Money, reports and the rest — TODO

- **Payouts / settlement.** What the merchant is owed, what has been paid, reconciled
  to orders. Payments settle through the platform Squad account and
  `MerchantBankAccount` is only "shown at checkout" for transfers — there is no
  money-out view at all. **Move this earlier if real payments are live.**
- **Business reports hub** at `/reports` (the dead nav item): revenue by day and
  channel, top products, top customers, discount and campaign performance. Today all
  analytics live under Inventory (`features/inventory/reports.ts`), which is the wrong
  place for a shop owner to look for sales.
- **Tax settings** per org: VAT registration, rate, inclusive/exclusive, VAT number on
  invoices — replacing the hardcoded `VAT_RATE` in `lib/storefront/pricing.ts` and the
  env flag in `lib/storefront/checkout/config.ts`.
- **Notifications**: a `Notification` model (none exists), the bell, and per-member
  email preferences. Low-stock and new-order emails already send but are neither
  visible nor configurable.
- **Product CSV import** — export exists everywhere, import nowhere, so there is no
  migration path onto the platform.
- **Staff account security**: own profile and password, 2FA, session revocation
  (`User.sessionVersion` already exists for the last one).
- **Merchant API and API keys** — ships `FEATURES.API_ACCESS`, sold on paid plans with
  zero call sites today.

---

## Sequencing

**Phase 2 before Phases 4 and 7.** If walk-in sales land on `Order` with a `channel`
field, customer metrics and every report count both channels for free. If they get
their own model, two sets of numbers need reconciling forever — a decision that is
cheap now and very expensive in six months.

**Phase 4 before Phase 5.** Email campaigns need segments and a consent field.

**Phase 1 any time** — it depends on nothing and the data is already being written.

## Smaller cleanups found during the audit

- `app/(dashboard)/[organizationSlug]/sales/page.tsx` defines its own `formatMoney`
  instead of using `lib/format.ts` (AGENTS §6).
- That page and `sales/customers/page.tsx` hand-roll an access-denied block instead of
  using `components/layout/access-denied.tsx` (AGENTS §9).
- `procurement/suppliers/[supplierId]/page.tsx` gates a supplier detail page behind
  `FEATURES.REPORTS_ADVANCED` — looks like a copy-paste from the reports page.
- The sales landing page counts by loading every quote, invoice and customer into
  memory.
