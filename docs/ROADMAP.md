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
Fraunces/Geist pairing is load-bearing. (Revisited in **Phase 15**: fonts come
as part of a curated look, never as a free font picker.)

`robots.ts` is deliberately a route handler, not Next's file convention: that
one only registers at the root of `app/`, and every storefront lives under
/store/{slug} behind a proxy rewrite. A convention that silently never
registers is worse than no file.

Tests: `tests/storefront-appearance.test.ts` (12 — defaults when nothing is
set, hidden slides, a button needing both halves, colour and measurement-id
validation, tenancy).

## Phase 7 — Money, reports and the rest — SUPERSEDED (2026-09-29)

Folded into the go-live phases below so each item is planned in one place:
payouts → **Phase 10** (since rewritten: Paystack settles to merchant
subaccounts, and the platform builds no payout system); tax settings, notifications, product CSV import, staff
account security and the reports hub → **Phase 14**; merchant API → dropped from
what is advertised until it is built (**Phase 12.4**). The list is kept as written
for the reasoning behind each item.

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

## Phase 8 — Stores as a real place — DONE (2026-09-25)

Agreed 2026-09-25. A store today is a row a merchant picks in a dropdown: the list
at `/inventory/warehouses` is the only screen, and it has no detail page at all. Yet
almost everything in the app is already counted per store — `InventoryLevel` (with a
per-store `reorderPoint`, `reorderQty` and shelf `location`), `StockMovement`,
`StockTransfer`, `CycleCount`, `PurchaseOrder`, `Fulfillment`, `Order.warehouseId`
for a counter sale, and `OrderStockAllocation` for an online one. **The data is
there and the screens are missing.** Nothing in this phase needs a new source of
truth; 8.6 is the only part that needs a new table.

**The decision that shapes all of it:** a store's page never re-derives a number
another screen already owns. Store stock comes from `InventoryLevel`, store
movement from the ledger, store sales from `OrderStockAllocation` (online) plus
`Order.warehouseId` (counter) — so the store page and the reports can never
disagree. Where a figure would need a new definition, it is named and stated on
screen (AGENTS §10) rather than quietly invented.

Language, throughout: **Store**, never Warehouse, in anything a merchant reads —
the model stays `Warehouse` (renaming it is a migration with no user-visible gain).

### 8.1 The store page — DONE (2026-09-25)

The gap: you could not open a store. Closes "how much of this product is at this
store" and the stock half of "store performance".

- `/inventory/warehouses/[warehouseId]`, reached by clicking a store card (the
  whole card, with the name as a real `<Link>` — AGENTS §3).
- `PageTabs` in the URL: **Overview | Inventory**. Transfers, Movements, Orders
  and Adjustments are reached from the Overview, pre-filtered, rather than
  rebuilding four tables that already exist elsewhere; the tabs that get their own
  panel are added by the phase that gives them something this store page alone can
  say (Orders in 8.4).
- Overview: products stocked here, units on hand, units held for orders, low
  stock, out of stock, stock value at average cost — each `StatCard` clickable
  through to the list it counts. Then "needs attention" (low stock here, transfers
  waiting to be received here) and the last movements at this store.
- Inventory tab: this store's products with on hand / held / available, the
  threshold in force and where it comes from (this store's own, or the product's),
  and the shelf tag. Search, a stock filter, sorting and pagination, all in the
  URL.
- **Money is only the stock's value at cost in 8.1.** Sales and orders per store
  arrive in 8.5, which is where the definition of "sales at a store" is settled.
  The Overview says so rather than leaving a hole where the figure should be.

**As shipped.** `features/inventory/store-detail.ts` — `getStoreDetail`,
`getStoreInventory`, `getStoreActivity`, `getStoreOpenTransfers`, all four
scoped by `{ id, organizationId }`, so another workspace's store id is a miss
(`Store not found` → `notFound()`), not a leak. Low stock, out of stock, the
threshold in force and the row's value are derived in Node, because the
threshold is per level — this store's `reorderPoint` beats the product's, and
Prisma can't express that; the same reason `listProducts` derives its stock
state. `stock`, `sort`, `q`, `page` and the tab all live in the URL.

Two things worth knowing:

- **"Out of stock" means nothing AVAILABLE**, not an empty shelf: four units
  all held for orders read as out of stock, because none of them can be sold.
  The table shows on hand and held separately so the merchant can see why.
- **A transfer arriving here is this store's news.** The ledger records it
  against the SENDING store with `toWarehouseId` pointing here, so the activity
  list matches on either side and each row says which way it went
  (`incoming` + `otherStoreName`) rather than showing an arrival as a departure.

Archived products are left out everywhere on this page, so a discontinued line
with old stock can't inflate the count of what this store sells.

Extracted on the way: `lib/inventory-labels.ts` (`MOVEMENT_LABEL`,
`MOVEMENT_VARIANT`, `MOVEMENT_SOURCE_LABEL`, `movementReason`, `movementSign`).
The movements list and the inventory landing page each had their own copy of
the ledger's vocabulary — now one (AGENTS §9).

Tests: `tests/store-detail.test.ts` (12 — the counts, a store override beating
the product's threshold, held stock reading as out of stock, a variant listed
under its product, search by SKU and by shelf, paging past the end, and no path
to another workspace's store).

### 8.2 Managing a store's products from the store side — DONE (2026-09-25)

The gap: assignment only happened one product at a time, from the product form,
so stocking a new shop meant editing every product in the catalogue.

- **"Add products"** on the Inventory tab (and in its empty state): a Sheet —
  line items don't belong in a dialog (AGENTS §4) — that searches the catalogue
  through the shared `SearchPicker`, takes several, and gives each an opening
  quantity and unit cost. Opening stock goes through `recordStockIn` →
  `createStockMovement`, so the ledger, the moving-average cost and the
  low-stock alert behave exactly as they do when a purchase order is received.
- **The only row this file writes by hand is an empty one** (quantity 0). That
  is what "this store carries this product" means, and it moves nothing — so a
  store can list what it stocks before any stock arrives, and the product shows
  up in its list ready to receive some.
- **Per-store settings** — this store's `reorderPoint`, `reorderQty` and shelf
  `location` — in a three-field dialog off the row's `⋯` menu. Only the store's
  OWN override prefills; the product's value shows as the placeholder, so
  pressing Save cannot silently copy the product's number into an override.
  Clearing the field hands the decision back to the product, and the form says
  so in both directions.
- **Removing** goes through an `AlertDialog` that states which of the three
  blockers is in the way — stock on the shelf, something held for an order, or
  history at this store — and only offers the destructive button when it will
  actually work. A product that has ever moved through this store keeps its row
  at zero, because the ledger points at it.

**Decisions worth keeping:**

- **An opening quantity needs `inventory.movement.create`, not just
  `inventory.edit`.** A member who may tidy the catalogue is not automatically a
  member who may declare stock. Without it the sheet hides the quantity fields,
  says why, and still lets them say what the store carries.
- **Adding is idempotent.** A product the store already carries is skipped, not
  reset, so a double-click can't wipe a quantity. The result says how many were
  added, how many arrived with stock, and how many were already there.
- **A closed store takes no new products** — reopen it first.
- A product with options is offered (and refused) as its options, since a
  quantity belongs to a variant, never to the parent.

Extracted on the way: `components/ui/search-picker.tsx` (moved out of
`components/sales/` — the till, the invoice form, the campaign form and now this
sheet all use it) and `variantNameOf` in `features/inventory/shared.ts`.

New audit actions, with labels and the label test updated:
`inventory.warehouse.products_added`, `…stock_settings_updated`,
`…product_removed`.

Tests: `tests/store-products.test.ts` (17 — the picker excluding what the store
already carries, archived products and variant parents; an empty row vs. a
ledger-backed opening quantity; the second add not resetting a quantity; the
movement permission refusing a quantity while still allowing the assignment;
each removal blocker; and no path to another workspace's store or products).

### 8.3 Low stock, per store — DONE (2026-09-25)

The gap: thresholds were per store in the schema, but the merchant only ever met
them org-wide — and the alert email sent them to a report covering every store.

- **"Running low at {store}"** on the Overview: the products this store has
  least of, worst first, each saying what is available, the reorder point in
  force, **whose it is** ("set for this store" / "set on the product"), and this
  store's restock quantity where it has one. It is the same read as the
  Inventory tab (`getStoreInventory`, sorted worst-first), so the panel and the
  tab cannot disagree about what is low here.
- **The `stock=low` and `stock=out` views say what they mean** in one line: that
  "low" uses this store's own reorder point where it has one and the product's
  otherwise, that a product with no reorder point anywhere never appears, and
  that stock held for an order counts as unavailable because it can't be sold
  twice.
- **The alert email goes to the store that ran low**, not to
  `/inventory/reports`: the button opens that store filtered to what is low
  there, and the sentence names whose reorder point fired. The source is read
  from the level inside `maybeSendLowStockAlert`, so none of its four callers
  (stock movements, cycle counts, fulfillment packing, order dispatch) has to
  remember to say — they only pass `warehouseId`, which they all already had.
- **"Order more" leads into the restocking list for that one store.**
  `previewReorderDrafts(warehouseId?)` narrows by store (re-checking it against
  the workspace, so a foreign id narrows to nothing rather than widening), and
  `/procurement/reorder?store=<id>` says which store it is showing with an "All
  stores" way back.

**Decisions worth keeping:**

- **The suggestions page is Pro, so the panel adapts rather than hides**
  (AGENTS §7): with the feature, "Review restocking for {store}"; without it,
  "Order more" → purchase orders, plus one line saying what Pro adds and a link
  to `/upgrade`. A workspace whose member can't see procurement at all gets no
  link, not a dead one.
- A low product with **no preferred supplier stays out of the suggestions** —
  there is nobody to order it from — and the empty state now says that instead
  of pointing at an "Items page" that no longer exists under that name.

Also tidied while in there (both were on the cleanups list): the reorder page
hand-rolled its access-denied block and its header — now `AccessDenied` and
`PageHeader`/`PageBody`.

Tests: `tests/store-low-stock.test.ts` (8 — one product low in one store and
fine in another on the same day, the store's own restock quantity winning over
the computed fallback, suppliers missing, another workspace's store narrowing to
nothing, the email's link and threshold source, and the edge trigger staying
silent when the threshold was already crossed or never set).

### 8.4 Which store an order came off — DONE (2026-09-25)

The gap: `OrderStockAllocation` had recorded the answer since Phase 2 and no
screen showed it. A merchant worked out where the parcel is packed by hand.

- **Order detail** gained "Fulfilled from" beside the payment facts, each store
  a link to its own page. One store is stated plainly; when an order draws on
  two, the units per store are shown AND the Items table grows a "From" column
  ("Lagos × 2, Port Harcourt × 1") — the column only appears for a split order,
  because repeating one store on every line is noise.
- **`fulfilledFrom` and per-line `fromStores`** come from the allocations, newest
  definition of the truth: `storeShares`/`lineShares` in
  `features/sales/orders.ts`. A counter sale falls back to `Order.warehouseId`,
  so a sale rung up before allocations existed still names its shop.
- **A released hold names nobody, and says so.** A cancelled or expired order
  reads "Stock was released back to your stores" rather than still crediting a
  store that gave its units back (`stockReleased`, RELEASED rows excluded from
  every share).
- **A store filter on the orders list** (`?store=`), plus each row naming the
  store(s) that served it under the city. The filter is one clause covering both
  channels: `warehouseId` (rung up there) OR an allocation at that store.
- **An Orders tab on the store page**, `sales.view` only — the tab isn't offered
  without it and a hand-typed `?tab=orders` falls back to the Overview rather
  than an access-denied page inside a store. Oldest first, because that customer
  has waited longest, with a status filter and a "From here — 3 of 4" column
  (`unitsFromStore`), set only when the list was filtered to one store.

**Two things worth knowing:**

- **The search filter moved from `OR` to `AND`.** `listStoreOrders` built its
  text search as `where.OR`, and the new store filter needed an `OR` too — two
  `OR` keys in one object literal silently keep the last, which would have made
  a search ignore the store (or the reverse). Both now sit under `AND`.
- **A picking view is deliberately NOT here.** `Fulfillment` already carries a
  `warehouseId` and its own lifecycle; changing how picking works belongs with
  fulfillment, not with making the existing facts visible.

Tests: `tests/store-orders.test.ts` (10 — a split order naming both stores line
by line and biggest share first, a counter sale naming its shop, a released hold
naming nobody, a store's list covering both channels, default newest vs. the
store tab's oldest, search AND store both applying, another workspace's store
narrowing to nothing while the unfiltered totals stay this workspace's, and the
`sales.view` gate).

### 8.5 What a store sells — DONE (2026-09-25)

The gap: nothing told a merchant whether a store earned its rent.

- **"Sold from here in September"** on the store Overview: sales, orders and
  units, with the counter/website split underneath, and the definition in one
  line above it. A "Compare your stores" link where that report is available.
- **"Which store sells"**, a fourth view on `/inventory/reports/advanced`: every
  store side by side for the period already in that page's URL (`?days=`), with
  each one's share, a CSV export, and the stores that sold nothing still listed
  — "nothing" is the answer a merchant is looking for.
- **`features/sales/store-sales.ts`** owns the figure: `getStoreSales` for one
  store, `getSalesByStore` for the comparison.

**The definition, as built and as stated on screen:**

- A store's sales are the **goods that left its shelf at the price charged** —
  `OrderStockAllocation.quantity × OrderLineItem.unitPrice`. The allocations
  already record which store filled which line (Phase 2), so a split order is
  counted **exactly on each side, not apportioned** — better than the estimate
  this phase was originally written around. A campaign price is included,
  because it is the price actually charged.
- **Delivery and an order-level discount code are excluded**, and the screens
  say so: both belong to the order as a whole, and splitting them between two
  shops would invent a number.
- **Cancelled orders count towards nothing** (`status <> 'CANCELLED'`, the same
  clause Phase 4 settled on for customer metrics), and a **released hold is no
  store's sale**. Returns and refunds are **not** deducted — they are their own
  records against the order — and that is stated rather than implied.
- **An order filled from two stores counts for both**, so the store rows add up
  to the total while the order counts do not. The report says that in a footnote
  instead of letting a merchant find it by adding up.
- **What cannot be credited is shown, not dropped:** orders with no live
  allocation (nothing was ever held, or the hold went back) are reported as an
  unattributed count and value beneath the table, so the rows can be seen not to
  match the day's takings.

**Decisions worth keeping:**

- **One raw query**, parameterised: the figure multiplies a column on the
  allocation by one on the line item and groups by store, which Prisma's
  aggregates cannot express — the same reason Phase 4's customer list uses SQL.
- **Per-store figures are not plan-gated; the cross-store comparison is**, since
  it lives with the existing Pro sales reports. A merchant on any plan can see
  what each store sold by opening that store; the link to the comparison is only
  offered where it leads somewhere (AGENTS §7).
- **This month means the merchant's month.** `startOfMonthInLagos` joins
  `startOfTodayInLagos` in `lib/day.ts`, so a redeploy can't move a store's
  takings between months. `formatMonth` was added to `lib/format.ts` for the
  heading (AGENTS §6 — no ad-hoc date formatting).
- Phase 7's `/reports` hub should move this view; it sits under Inventory today
  only because that is where every other report currently lives.

Tests: `tests/store-sales.test.ts` (10 — the split counted exactly on both
sides, delivery and the discount code left out, cancelled and released counting
for nobody, an exclusive `to`, a store that sold nothing, shares summing to 1,
rows summing to the total while order counts don't, the unattributed line, and
no path to another workspace's takings) and two more in `lib/day.test.ts` for
the month boundary.

### 8.6 Store access for staff — DONE (2026-09-25)

The gap: a Lagos clerk could adjust Port Harcourt's stock. A role said what a
member may do and never where.

- **`MembershipWarehouse`** (migration `20260925120000_membership_warehouses`).
  **NO ROWS MEANS EVERY STORE** — the only default that leaves an existing
  workspace exactly as it was, that covers stores opened later, and that makes
  forgetting to pick stores for a new member harmless instead of locking them
  out of their own shop.
- **`lib/store-access.ts`** is the whole rule: `allowedStoreIds` (null for every
  store), `canUseStore`, `requireStoreAccess`, `storeScopeWhere`. The member's
  stores ride on `getOrganizationContext()` (`membership.warehouseIds`), read in
  the same query as their role, so no action pays for an extra round trip.
- **Enforced on the server, in every door that names a store:** stock movements
  (so stock-in too), transfer dispatch/receive/cancel, cycle count
  create/record/cancel/complete, putaway, 8.2's assignment, per-store settings
  and removal, counter sales, kit assembly, receiving a purchase order,
  fulfillment picking and packing, and editing a store or its "sells online"
  switch. `StoreAccessDeniedError` carries a message that names the store and
  says what to do, and each feature's `toActionError` passes it straight through.
- **Settings → Members** gained a Stores column ("All stores", the names, or "3
  stores") and a dialog per member. "All stores" is a real choice there, not the
  absence of one — it is how a restriction is undone.
- **The pickers offer only what can be written to**: record movement, transfer
  FROM, cycle count, kit assembly and the till. A transfer's TO keeps every
  store, because sending stock to another branch is the point.
- **The stores list marks the rest "View only"** and the store page says "You
  can see this store, but not change its stock" rather than quietly hiding its
  buttons (AGENTS §7).

**Decisions worth keeping:**

- **Reads are NOT scoped.** A clerk seeing that Port Harcourt has three left is
  how they tell a customer where to go, and hiding other stores would make the
  transfer screen unusable. Every list still returns every store, with
  `canWorkHere` on the row.
- **A transfer is gated at the FROM store; receiving at the TO store.** Someone
  with one store can send stock away and cannot receive it back — the other end
  confirms the box arrived, which is also the honest description of what happened.
- **An Owner is never scoped.** `setMemberStores` refuses, and says to change
  their role first: a business that locked its owner out of a store would have
  no way back in.
- **Raising a purchase order is not gated, receiving one is.** Ordering goods
  for another branch is ordinary procurement work; it is the arrival that touches
  someone else's shelf.
- **The migration was written by hand, not by `migrate dev`.** The dev database
  carries an unrelated foreign-key drift on `orders.customerId`, and a generated
  diff would have rewritten that constraint too. `migrate diff` → hand-trimmed
  `migration.sql` → `prisma db execute` → `migrate resolve --applied`, as the
  Phase 3 notes describe. **`prisma db execute` takes no `--schema` flag in this
  version** — it reads `prisma.config.ts`, and passing one makes it print its
  usage and exit non-zero without touching the database.

Tests: `lib/store-access.test.ts` (5 — the empty-means-everything rule from both
ends, including a context with no field at all, which is what an older caller
looks like) and `tests/store-access.test.ts` (10 — an unscoped member working
everywhere as before, a Lagos member refused at Port Harcourt through movements,
stock-in, transfers, counts, putaway, settings, assignment and the online switch,
send-but-not-receive, and reads staying open with `canWorkHere` false).

## Phase 9 — Delivery priced from the store that sends it — DONE (2026-09-28)

Agreed 2026-09-26. Once a merchant has two online stores, delivery is priced as if
every parcel left from the same place. Three facts in the code combine into the
loss:

- `DeliveryZone`, `DeliveryRate` and `PickupLocation` belong to the organization,
  not a store. `lib/storefront/delivery/match.ts` looks only at where the order is
  going. It never asks where it's coming from, and could not anyway, because
  `Warehouse.location` is free text.
- The storefront adds up stock from every `sellsOnline` store into one number
  (`onlineStock` in `lib/storefront/data/from-prisma.ts`), so the shopper never
  sees or picks where an item ships from.
- `reserveOrderStock` (`lib/storefront/orders/stock.ts`) holds each line from the
  **fullest** online store, and it does this *after* `placeOrder` has already priced
  delivery (`lib/storefront/orders/create.ts`). The address plays no part in the
  choice of store.

What that costs the merchant, with a Port Harcourt store and a Lagos store:

- A PH shopper buying a Lagos-only item pays the PH local rate, and the parcel
  crosses the country.
- A PH shopper can be served from Lagos even when **both** stores stock the item,
  because Lagos simply has more units.
- A mixed cart gets one quote and one fee, but the hold silently splits it across
  stores, and can split a single line. That is two dispatches paid for with one fee.
- Every pickup point is offered to everyone, so "Pick up in PH" can be chosen
  while the stock is held in Lagos.
- `freeOver` is checked against the whole cart, so a split order can be free twice
  over.
- The saved default address (sorted first, preselected in `checkout-view.tsx`) only
  ever fills in the delivery quote. It never affects which store serves the order.

**The decisions that shape all of it:**

1. **A delivery price has two ends.** Zones and pickups belong to the store that
   dispatches. Lagos→PH and PH→PH are different rates, each set by the merchant.
   Nothing is calculated from distance, and no courier API is involved.
2. **The store is chosen from the address, not the stock level.** One pure
   planner decides which store sends which lines. The checkout quote and
   `placeOrder` run the same planner, and the stock hold follows *that plan*. If a
   planned store sells out between quote and payment, the order is refused and
   re-quoted (like `invalid-delivery-method`). It never falls back silently to
   another store at the old price.
3. **A mixed cart becomes separate shipments by default.** Each shipment has its
   own store, method, fee and arrival estimate, and the delivery fee is their sum.
   Bringing the goods together in one store first is a merchant option (9.7), never
   the default.
4. **A single-store order looks exactly as it does today.** Shipments only
   appear on screen when there is more than one.

Language: the shopper reads "Ships from Lagos store", never "warehouse" or
"origin".

### 9.1 A store has a place — DONE (2026-09-27)

- **Schema.** `Warehouse.state` and `Warehouse.city`, both nullable. Migration
  `20260926090000_store_place` was hand-written and applied with
  `db execute` + `migrate resolve` (the `orders.customerId` drift again).
  `location` stays as the street address, free text, for people rather than
  matching.
- **The rule, in one place.** `features/inventory/store-place.ts`, pure and
  client-safe, used by both the actions and the dialog:
  - state and city go together (both or neither);
  - the state comes from `NIGERIAN_STATES`, spelled as delivery zones spell it;
  - the city is kept as typed, trimmed and single-spaced (`cleanCity`);
  - it also provides `formatStorePlace` ("Port Harcourt, Rivers").
- **The doors.**
  - `setWarehouseSellsOnline(true)` refuses a store with no place, and says why.
  - `updateWarehouse` refuses to clear the place of a store that sells online.
  - `createWarehouse` and `updateWarehouse` refuse half a place.
- **Stores that already sold online are kept on.** A store selling online with
  no place was **not** switched off by the migration. It can still be renamed or
  edited without a place, but once switched off it can't come back on without
  one. Its list card and store page show a `Needs a location` badge and an
  "Add location" link. 9.2 relies on every online store having a place, so its
  migration should treat any store still missing one as "needs review".
- **Screens.**
  - The store dialog has City or town + State (a select, with "Not set" unless
    the store sells online) and a line saying delivery will be priced from here.
    Required markers appear only when the store sells online.
  - The list card and store header read "City, State · street address".
  - The "Sells online" switch is disabled with the reason, plus an "Add
    location" link, while a store has no place.
- **Fixed on the way.** Clearing a store's address box used to do nothing
  (`updateWarehouse` passed `undefined`, which Prisma treats as "leave it"). The
  field now clears.
- **Audit.** A change of place is recorded as `{ place: { from, to } }` on
  `inventory.warehouse.updated`. Creation records the place it was given.
- **Tests.** `features/inventory/store-place.test.ts` (10, the pure rule).
  `tests/store-place.test.ts` (7, against the database): creating with and
  without a place, refusing half a place or a misspelled state, refusing to
  switch on without a place, refusing to clear an online store's place, the
  store that sold online before places existed, and clearing the address.

### 9.2 Delivery belongs to a store — DONE (2026-09-27)

- **Schema.** New columns: `DeliveryZone.warehouseId`, `PickupLocation.warehouseId`
  (both nullable, `onDelete: SetNull`, indexed) and `Warehouse.deliveryNeedsReview`.
  Migration `20260927090000_delivery_per_store` was hand-written, with its data
  step in PL/pgSQL, and applied with `db execute` + `migrate resolve`.
- **How existing rows were handed out, per business.**
  - Target stores are the open stores that sell online. If there are none, the
    business's only store; otherwise no one.
  - The oldest target store keeps the original zones, so rate ids still resolve
    mid-checkout. Every other target store gets a copy of each zone and rate.
    With more than one target store, all of them are flagged
    `deliveryNeedsReview`.
  - Pickups are physical places and are never copied. One target store takes
    them. With several, a pickup goes to the one store in the same city and
    state; otherwise it's left without a store.
  - Nothing was deleted. A row left without a store is kept but never offered,
    and Settings asks for its store.
  - On the dev database, `pynacode` (two online stores, two zones) came out with
    both stores holding both zones and both flagged. Nothing was left
    unassigned.
- **Which stores supply online stock, defined once.** `ONLINE_SUPPLY_WHERE` in
  `lib/storefront/delivery/supply.ts`: open, selling online, and with its own
  switched-on zone+option or pickup. The one exception is when **no** store can
  deliver yet: then nothing is left out, because checkout is closed anyway and
  marking everything sold out would say something untrue. It's a static Prisma
  filter, used by:
  - the catalogue (`from-prisma.ts` level select);
  - the stock hold (`reserveOrderStock`);
  - the admin's "available online" and per-store "sells online"
    (`features/inventory/products.ts`);
  - the product checklist's online-store count;
  - the store page.
- **Quoting.** `quoteFromSetup` still takes one store's setup. New functions:
  `quoteEachStore`, and `quoteAcrossStores` — **the interim checkout rule until
  9.3.** Stock is still held fullest-first, so the sending store isn't known at
  quote time. Among the stores that deliver to the address, the one whose
  cheapest option costs most prices delivery, with ties going to the older
  store. With one store, or identical copies, this is exactly the old quote.
  Pickups from every store are still offered, until 9.5.
  - `loadDeliverySetup` returns a list of stores (supplying stores only; a
    zone with no store is never read).
  - `quoteDelivery` returns the combined quote, including `store`.
  - `deliveryOverview` names the store ("Delivery to Rivers from Lagos") when
    more than one store delivers.
- **Settings → Delivery.**
  - One section per store that sells online or has delivery set up. Each shows
    its place, a badge (Sells online / Not selling yet / Not selling online /
    Closed), its zones and its pickups.
  - A "Check these prices" callout with **Prices are right**
    (`confirmStoreDelivery`) on stores whose prices were copied.
  - A warning when a store sells online but its stock is left out for lack of
    delivery.
  - A per-store empty state with a per-store **Use a starting setup**
    (`createSuggestedDelivery(warehouseId)`).
  - A "Not linked to a store" section for rows the migration couldn't place.
  - The zone sheet and pickup dialog open with a required **Delivers from** /
    **Stock from** store picker (`StoreSelectField`). A new pickup fills in the
    store's city and state.
  - The overlap refusal is per store: two stores covering Rivers is allowed.
  - A store id from the form is only used together with the org id, so another
    business's store is a "no longer exists" miss.
- **Check an address** shows what each store would charge, and what checkout
  charges, with the interim rule explained in one line.
- **Store page.** Shows a "Not selling yet · Set up delivery" line for an online
  store whose stock is left out, and a "Check prices" line while prices await
  review.
- **Also.** `getStoreFacts` (store pages) counts only zones and pickups that
  have a store. AGENTS.md now says delivery belongs to a store, and where
  online stock comes from.
- **Tests.**
  - `lib/storefront/delivery/match.test.ts`: +6 for multiple stores (each store
    asked; the dearest store priced; a store that doesn't cover the address
    ignored; every store's pickups offered; ties to the older store; nobody
    covering the address).
  - `tests/settings-delivery.test.ts`: +7 against the database (stock left out
    until a store can deliver; the same place covered by two stores; overlap
    only within one store; another business's store refused; per-store preview
    and the dearest store charged; confirming a review; a starting setup per
    store).
  - `tests/helpers/delivery.ts` now gives every online store its own copy, like
    the migration. It must be called after the stores exist, and is safe to
    call again (a store that already has a zone keeps it). Four order suites
    were reordered to do so, and `storefront-orders`' `makeSellableProduct`
    calls it, because a product whose store can't deliver is no longer
    sellable — the rule working as intended.
  - Full run: 560/560 database tests with files run one at a time, plus
    987/987 unit and component tests. The parallel full run shows timeouts
    against Neon that pass when re-run (the known flakiness), so run the
    database suites with `--no-file-parallelism` when judging a change.

### 9.3 The fulfilment planner — DONE (2026-09-27)

- **The planner.** `planOrder(stores, stock, bag, address)` in
  `lib/storefront/delivery/plan.ts` — pure and client-safe. It returns the
  shopper's options, and for each option (server-side only) the plan behind
  it: parcels, each with its store, its lines, its goods subtotal and how it
  travels. Rules, in order:
  1. One store that holds the whole bag and delivers to the address. If
     several do, the cheapest cheapest-option wins, then the shopper's state,
     then the older store.
  2. Otherwise the fewest stores (exact search over combinations, capped at 10
     stores). Whole lines go to the cheapest store in the combination. A line is
     split only when no chosen store holds all of it. Ties go to fewer splits,
     then the lower total delivery, then more stores in the shopper's state,
     then the older stores.
  3. A store that doesn't deliver to the address is never used for delivery.
  4. With no plan there are no delivery options, and a reason: `no-delivery`
     (no store delivers to the address) or `not-in-stock-here` (stores deliver,
     but don't hold the bag). Checkout says the second one in its own words.
- **Free delivery is checked per parcel**, against that parcel's goods.
- **Pickups moved here from 9.5.** A pickup is offered only when its store holds
  the whole bag, and choosing it sends everything from that store. It had to
  land with the planner: the planner now decides where stock is held, and a
  pickup in Port Harcourt holding stock in Lagos was one of the losses Phase 9
  exists to stop.
- **Several parcels, until checkout shows them one by one (9.5).** The shopper
  picks how the biggest parcel travels, and every other parcel goes by its
  store's cheapest option. The combined option:
  - keeps the big parcel's option id;
  - is labelled "Standard · 2 parcels" (the label is copied onto the order);
  - says "Sent in 2 parcels, from Port Harcourt and Lagos";
  - costs the sum of the parcels;
  - promises the slowest parcel's window;
  - carries no `freeOver`, since each parcel has its own threshold.
- **One plan for quote and hold.**
  - `quoteDelivery(slug, address, bag)` loads the stores and their stock for
    the bag (`loadStockFor`, same filter as the catalogue) and runs the planner.
  - `quoteDeliveryAction` now takes the bag's lines (ids and quantities only)
    and re-prices them through `resolveLines`, which is now exported.
  - `placeOrder` plans again from the re-priced bag and charges the chosen
    option's plan. `reserveOrderStock` takes `planned` (built by
    `plannedStockOf`) and holds **exactly** there, with a conditional update per
    store. A planned store that sold out throws, and the order is refused with
    "Stock moved… go back to Delivery" (`invalid-delivery-method`). It never
    falls back to another store.
- **Late payments.** `reReserveOrderStock` re-plans. It holds only if the same
  option still exists at the same fee; otherwise it throws `OutOfStockError`,
  and the existing late-payment path leaves the order cancelled and paid for
  staff — logged as needing a refund. A proper "needs attention" list for these
  belongs with 9.6.
- **The interim "dearest store" rule from 9.2 is gone.** The admin's "Check an
  address" now shows what checkout would do if every store had the items (the
  cheapest store to send from), via `planWithAnyStock`.
- **Tests.**
  - `lib/storefront/delivery/plan.test.ts` (14): a Port Harcourt order from Port
    Harcourt at the local price; a Lagos-only item at the Lagos → Port Harcourt
    price; the same-state tie-break; a store that can't deliver never used; a
    split charging each store's trip, with the biggest parcel's choice, the
    slowest window and per-parcel lines; one line split only when it must be;
    both no-plan reasons; per-parcel free delivery; pickup only where the whole
    bag is; the admin check.
  - `tests/settings-delivery.test.ts`: the Port Harcourt shopper case against
    the database — local item, Lagos-only item, and a mixed bag charged ₦1,500 +
    ₦6,000 with stock held in both stores.

### 9.4 Shipments on the order — DONE (2026-09-27)

- **Schema.** `OrderShipment`: order, store (`warehouseId`, nullable only for
  pre-allocation orders), `kind` (DELIVERY/PICKUP), the copied option
  (`deliveryMethodId`/`Label`), `fee`, `freeOverApplied`, the ETA columns,
  `status` (PENDING/DISPATCHED/DELIVERED/CANCELLED), `trackingNote`,
  `dispatchedAt`/`deliveredAt` and `sortOrder` (biggest parcel first).
  `OrderStockAllocation.shipmentId` is new (SetNull). Migration
  `20260927120000_order_shipments` was hand-written, and applied with
  `db execute` + `migrate resolve`.
- **Writing.** `lib/storefront/orders/shipments.ts` → `writeShipments` writes
  the plan's parcels in the order's transaction. `plannedStockOf(plan,
  shipmentIds)` makes every hold point at its parcel. Each parcel records its
  **own** option and fee (e.g. Local ₦1,500 + Interstate ₦6,000), not the
  combined checkout option. `Order.deliveryFee` stays the total and the
  order-level ETA the slowest parcel's, so payments, receipts and reports are
  unchanged.
- **Parcels move with the order until 9.6.**
  - `markOrderShipped` → DISPATCHED.
  - `markOrderDelivered` → DELIVERED (now one transaction).
  - Cancelling or expiring → CANCELLED.
  - A revived late payment clears the never-sent parcels and writes new ones
    from its new plan.
- **Backfill.** Every online order with a delivery gets one parcel per store its
  stock was held at. The store with the most units comes first and carries the
  order's option and fee. Any other store's parcel carries the same option at
  ₦0 — which is what happened on pre-9.3 split orders, not a guess at a split
  nobody made. Orders with no allocations get one parcel with no store, and
  status is mapped from the order.
  - Dev database: 41/41 online orders got parcels, each order's parcel fees sum
    to its delivery fee, and 2 parcels have no store. One allocation belongs to
    a test fixture order with no delivery option, so it's correctly left
    unlinked.
- **Not in 9.4.** Parcels aren't shown on any screen yet — the order page and
  sending parcels one by one are 9.6, and checkout listing them is 9.5.
- **Tests.**
  - `storefront-order-lifecycle`: a parcel written and holding its stock;
    DISPATCHED on ship; DELIVERED on delivery; CANCELLED on expiry; rewritten
    on a revived late payment; a split line making two parcels, biggest first.
  - `settings-delivery`: the mixed bag writes Local ₦1,500 from Main and
    Interstate ₦6,000 from Lagos, each holding its own item and summing to the
    order's fee; free delivery recorded as `freeOverApplied`.

### 9.5 Checkout — DONE (2026-09-27)

- **A choice per parcel.** A bag split across stores comes back from the quote
  as `parcels` (store name, lines, that store's options). The delivery step
  shows one card per parcel ("Parcel 1 of 2 · From Port Harcourt", naming its
  items), each with its own radio group, and each parcel's cheapest option is
  preselected. A single-parcel bag looks exactly as before.
- **One id for the choice.** Each parcel's option id, in parcel order, joined
  by `+` (`rate_a+rate_b`), so the form field, the checkout store,
  `placeOrderAction` and `Order.deliveryMethodId` keep one string. Pure helpers
  in `lib/storefront/delivery/plan.ts`:
  - `parcelChoiceId` / `parcelChoices` / `defaultParcelChoice`;
  - `combineParcelChoice` — the method charged: the parcels summed, the slowest
    window, labelled "Local + Interstate · 2 parcels", with a per-parcel
    breakdown in `ShippingMethod.parcels`;
  - `resolveDeliveryChoice(quote, id)` — the server's check, which returns the
    method and plan, or null for an id that doesn't fit this quote's parcels.
    `placeOrder` and the late-payment re-hold both use it.
  - The 9.3 stand-in (the shopper chose only the biggest parcel, the others
    went by their cheapest) is gone.
- **Free delivery** is still per parcel, and the combined method carries no
  single `freeOver`.
- **Pickup** ("Or collect everything from one store") sits under the parcels,
  and only where one store holds the whole bag (since 9.3).
- **Browser payload.** `quoteDeliveryAction` sends parcels without store ids.
  The checkout view computes the combined method for the summary with the same
  function the server uses, and hands it to the submit validation.
- **Review step** lists each parcel: store, option, window, price and its items.
- **After the order.** `StorefrontOrder.delivery.parcels` is read from
  `OrderShipment`. The confirmation page lists the parcels when there's more
  than one, and the order emails add "Comes in 2 parcels — from Port Harcourt:
  Local; from Lagos: Interstate."
- **Speed.** `writeShipments` now writes every parcel in one
  `createManyAndReturn`. The order transaction had grown by a round trip per
  parcel, and the lifecycle suite was brushing its 20s timeout.
- **Tests.**
  - `plan.test.ts`: parcels offered biggest first with their own options; the
    cheapest preselected and summed; each parcel chosen on its own and resolved
    to a plan; four malformed or mismatched choice ids refused.
  - `checkout-view.test.tsx`: two parcel cards, both cheapest preselected,
    changing one leaves the other, the summary re-totals, and the review lists
    both parcels with the stored choice `rate_ph_same+rate_lagos`.
  - `settings-delivery`: the mixed bag placed with a per-parcel choice, labelled
    "Local + Interstate · 2 parcels".
  - The lifecycle helper quotes only when the plain option is refused.

### 9.6 Sending and after-sales — DONE (2026-09-27)

- **One parcel at a time.** New lifecycle moves `sendShipment` and
  `deliverShipment` (`lib/storefront/orders/lifecycle.ts`).
  - Sending dispatches **only that parcel's** stock
    (`dispatchOrderStock({ shipmentId })`) and saves an optional
    courier/tracking note.
  - The first parcel out moves a confirmed order to packing; the last one out
    marks the order shipped, and that is when the shopper is emailed.
  - The last parcel to arrive marks the order delivered. For pay on delivery,
    its "every courier has handed over the money" switch records payment.
  - The whole-order "Mark as shipped" / "Mark as delivered" still work and move
    every remaining parcel. With several parcels they read "Send all parcels" /
    "Send the rest" / "Mark all delivered".
- **Store access (8.6) on sending.** `updateStoreShipment` checks the parcel's
  store with `requireStoreAccess`, and the whole-order "ship" checks every store
  still holding a parcel. A Lagos-only member can send Lagos's parcel and
  nothing else. The page shows other stores' parcels as view-only, with the
  reason.
- **"Partially sent".** Derived from the parcels (some sent, some waiting) and
  shown as a badge on the order page, Sales → Orders and the store page's
  Orders tab. The order page's hint names the stores still to send.
- **Cancelling** is refused once any parcel has left: "Part of this order has
  already been sent…".
- **Pay on delivery, per courier.** `collectionSplit` in
  `lib/sales/parcel-collection.ts` (pure): each courier collects its parcel's
  delivery fee plus its share of the rest of the total, in proportion to the
  goods it carries, so a discount is shared out with the goods. It works in
  kobo, and the odd kobo goes to the biggest parcel so the shares always add up
  to the total.
- **The Parcels panel** on the order page shows each parcel: store, option,
  fee (and whether its free-delivery threshold was met), window, items, what
  its courier collects, the tracking note and dates. It has "Send parcel" (with
  a tracking-note dialog) and "Mark delivered".
- **Packing slip per parcel** at `/sales/orders/[id]/parcels/[shipmentId]`,
  built on the shared receipt document. It shows where the parcel goes from and
  to, what's in the box, the delivery for this parcel, and "Courier collects
  ₦X" or "Nothing — already paid".
- **Refunds can include a parcel's delivery.** The return refund dialog has
  "Refund delivery too" tick-boxes, one per parcel with a fee. Ticking adds or
  removes the fee from the amount, and the refund's note records which parcel's
  delivery went back. Refunds stay records, not money movements.
- **Late payments that can't be held (from 9.3).** A new "N cancelled orders
  were paid for and still need refunding" callout on the dashboard
  (`refundsOwed`) links to cancelled orders. The orders list already badged
  them "Refund owed".
- **Audit.** Labels for `sales.order.parcel_send`, `sales.order.parcel_deliver`
  and `settings.delivery.reviewed` (that one had shipped in 9.2 without a
  label).
- **Tests.**
  - `lib/sales/parcel-collection.test.ts` (5).
  - `tests/settings-delivery.test.ts` "sent parcel by parcel" (4): what each
    courier collects adding up to the total; a Lagos-only member refused on
    Main's parcel and on "send all" while sending Lagos's; partially sent with
    only Lagos's stock dispatched; cancelling refused; shipped on the last send,
    delivered and paid on the last delivery.

### 9.7 Bring it together first (optional) — DONE (2026-09-27)

- **The setting.** `Organization.consolidateOrders` (default false, so nobody's
  checkout changed), `consolidationFee` (per store items come from),
  `consolidationLeadMinutes` + `consolidationLeadUnit`. Set in Settings →
  Delivery, on an "Orders from more than one store" card that appears once
  more than one store sells online (`saveConsolidationPolicy`, audited).
- **Planning** (`planOrder(..., consolidation)`). Only for a bag no single store
  holds: a bag one store can fill is still a plain parcel.
  - The gathering store must deliver to the address, and is chosen by fewest
    stores to bring from, then cheapest (its option plus fee × stores), then the
    shopper's state, then the older store.
  - Stock can be gathered from any supplying store, including one that doesn't
    deliver there itself.
  - Each of its options costs the fee per source store on top, and takes the
    extra time on top (said in the larger unit). It's labelled "Standard ·
    brought together", with a line saying where the items come from and no
    single `freeOver`.
  - A pickup point that can gather the bag is offered on the same terms.
  - The parcel records its `sources`.
- **Holds stay honest.** The gathering store holds what it has; the rest is held
  **at the stores that have it**, against the same parcel
  (`plannedStockOf` reads `sources`).
- **Transfers.** A new `StockTransferStatus.REQUESTED`, plus
  `StockTransfer.orderId`/`shipmentId`/`requestedAt`. Migration
  `20260927150000_bring_orders_together`. `lib/storefront/orders/gather.ts`:
  - `requestGatheringTransfers` runs when the order is **confirmed** — paid
    online, transfer confirmed, pay on delivery accepted, or a late payment
    revived. It's idempotent, and nothing is asked of a store for an order
    nobody has committed to.
  - `sendRequestedTransfer` (Transfers screen → "Send now", the source store's
    access checked) releases the order's hold there and takes the units off
    that shelf in one step.
  - `receiveTransfer` → `holdReceivedForOrder` holds the units for the order at
    the gathering store at once.
  - `cancelRequestedTransfers` runs on cancel and expiry; a transfer already on
    its way simply arrives as ordinary stock.
- **The parcel waits.** `sendShipment` and `markOrderShipped` refuse while any
  transfer for it is requested or on its way ("Still waiting for items from
  Lagos to arrive…"). The Parcels panel lists each item being brought, its
  source and status, hides "Send parcel" until everything has arrived, and
  links to Transfers. The Transfers screen shows "Requested", "Waiting for
  Lagos to send it", and a link to the order.
- **Order page fix.** A released hold used to read "stock was released back"
  even when it had travelled on, so `stockReleased` now needs a cancelled order.
- **Tests.**
  - `plan.test.ts` +5: one parcel from the delivering store with the rest
    brought in, the fee, the time, the label and the sources; the fewest-source
    store chosen (a bag one store fills stays plain); a gathered pickup; still
    split with the setting off; gathering from a store that doesn't deliver
    there.
  - `settings-delivery` +2 against the database: the whole path (one parcel at
    Main, ₦1,500 + ₦1,000, the lamp held in Lagos; no transfer until confirmed,
    then REQUESTED; the parcel refused while waiting; sending releases Lagos's
    hold and stock; receiving holds it at Main; the parcel ships both from Main)
    and cancelling cancels an unsent transfer.
  - Speed: a confirmation that has nothing to gather costs one query (a single
    `EXISTS`), and confirming a pay-on-delivery order or a bank transfer isn't
    wrapped in a transaction (the transfer step is idempotent).
  - Two journey tests have longer limits, with the reason in the test: the new
    gather journey (60s) and lifecycle "moves through packing" (45s, two orders
    and every stage). Against the remote dev database they had crept past 20s.

### 9.8 Deliver-to before checkout — DONE (2026-09-28)

- **Where the shopper is.** `useDeliverToStore`
  (`lib/storefront/stores/deliver-to-store.ts`) is kept in this browser, per
  store, and only used to ask for an estimate and to start the checkout
  address. A signed-in shopper with nothing chosen is estimated for their
  default address, looked up on the server, and choosing a place overrides that
  for this browser.
- **The estimate is checkout's own answer for a bag of one.**
  `estimateDelivery` (`lib/storefront/delivery/estimate.ts`) re-prices the
  variant from the catalogue (`resolveLines`) and runs `quoteDelivery`, so it
  names the store the item would really leave from (or be gathered at) and
  that store's cheapest option. It says when there are more options or a
  pickup, and it gives reasons when it can't: `no-delivery` / `pickup-only` /
  `not-in-stock-here` / `unavailable`. `cleanDeliverTo` accepts only a real
  Nigerian state. The server action `estimateDeliveryAction` resolves the place
  (chosen → default address → none).
- **Product page.** `DeliverToEstimate` sits in the buy box, above the delivery
  panel, for the chosen variant (or one in stock until the picker is
  complete).
  - It shows "Deliver to Port Harcourt, Rivers · Change" (with "(your default
    address)" when that's the source) and "Ships from Lagos Store / Interstate ·
    ₦4,500 · 2–4 working days".
  - It always adds "For one of this item. Your exact options and price are
    confirmed at checkout."
  - A guest who hasn't chosen is asked "Where should we deliver?", and nothing
    is sent to the server until they choose.
  - The place picker is a state select plus a city field.
- **Checkout.** A guest's address form starts with the chosen state and city,
  only into empty fields and never over typing or a saved address.
- **AGENTS.md** now says any product-specific delivery figure shown before
  checkout goes through `estimateDelivery`.
- **Follow-up (2026-09-28): no price table.** The product page's "Delivery &
  returns" card listed every store × zone with its price ("Within Port Harcourt
  · Free" above an item shipping from Lagos). That list is gone.
  - The card keeps what holds wherever the shopper is: pickups, the return
    window, pay-before-delivery and the policy link. It renders nothing when
    there's none of that.
  - Before a location is chosen, the Deliver-to box shows one line from
    `deliverySummary` (`store-claims.ts`): "Delivery across Nigeria, from
    ₦2,500. Choose a location to see your price and which store it ships from."
    The box is hidden for a store that delivers nowhere.
  - `DeliveryPromise` options now carry `nationwide`. The utility bar and the
    homepage band had checked the label "Delivery across Nigeria", which
    multi-store labels ("… from Lagos Store") never matched, so they said
    "Delivery to selected areas". Both now check the flag.
  - The assistant keeps its per-location lines (to answer "do you deliver to
    Kano?"), gets `deliveryFrom`, and is told to quote "from" prices and never
    one zone's price for a particular item.
- **Tests.**
  - `deliver-to-estimate.test.tsx` (4): a guest is asked and nothing is sent;
    choosing shows the store and price and remembers the place; signed in means
    the default address, labelled as such; "doesn't deliver" and "collect
    only" said plainly.
  - `checkout-view.test.tsx` +1: the prefill.
  - `settings-delivery` +1 against the database: the tote from Main at ₦1,500,
    the Lagos-only lamp from Lagos at ₦6,000 to Port Harcourt and ₦2,000 to
    Kano, an unknown item unavailable, and only real states accepted.

**Tests:** the planner (one store, split cart, tie-break, a store that can't
deliver, no plan at all, free-over per shipment). Also: `placeOrder` refuses when
a planned store sold out after the quote, the migration (one-store and multi-store
orgs), and a store with no delivery setup leaving online stock.

---

# Go-live

Audited 2026-09-29. Phases 0–9 built the product a merchant uses; what stands
between it and real merchants is the business around it — how a merchant gets
paid, how the platform is run, and what production needs. Phases 10–14 are
ordered by what blocks taking real money first. See "Sequencing" for the order.

## What's next — build order (updated 2026-09-29)

**Phase 10 is done** except refunds (10.7, paused for the wallet partnership)
and the legal wording (10.10, with counsel). Online payments work end to end in
Paystack test mode. What stands between that and a merchant who can sign up,
set up, get paid and use their own domain is below, **in the order to build
it**.

**12.1 is done (2026-09-29)** — plans live in the database, with three
billing cycles, a no-card trial at signup, and lapsing with grace.

**11.0, the console shell (sidebar + overview), is done (2026-09-29).**

**11.7, plans and pricing in the console, is done (2026-09-29)** — plans,
prices, features, limits, the trial, grace and the exchange rate are edited
at `/platform/plans` and `/platform/settings`.

**11.2 merchants and 11.4 suspend/restore are done (2026-09-29).**

**12.5 onboarding is done (2026-09-29)**, except the spreadsheet import.

**14.2 product CSV import is done (2026-09-30)**, and the setup guide offers it.

**12.6 custom domains and 11.5's staff queue are done (2026-09-30).**

**11.6, payment problems in the console, is done (2026-09-30).**

**12.2 is done with the working name Notely (2026-09-30).**

**12.3, the public site and pricing, is done (2026-09-30).**

**12.4, nothing half-there on screen, is done (2026-09-30).** Phase 12 is
complete except what's noted in its sections.

**13.1, scheduled jobs, is done (2026-09-30)** — cron-job.org calls the
15-minute jobs while on Vercel Hobby (docs/SCHEDULED-JOBS.md).

**13.2, shared rate limits (in Postgres), is done (2026-09-30).**

**13.3, seeing failures (built-in error log, /api/health, webhook alerts), is
done (2026-09-30).**

**13.4, security headers (nonce CSP, HSTS and friends), is done (2026-09-30).**

**13.6, the database (drift fixed, direct/pooled addresses, deploy-time
migrations, nightly verified backups), is done (2026-09-30)** — the owner
still separates development from production (docs/DATABASE.md).

**13.7, CI (whole suite on its own database, every push), is done (2026-10-01).**

**13.8, data rights (download, delete, close, 6-year retention enforced daily),
is done (2026-10-01).**

**13.9's code is done (2026-10-01): go-live checklist, mode-aware payouts and
billing plans, the social-key script, no tracking in the app. The outside
steps are the owner's — docs/GO-LIVE.md.**

**START HERE: the owner works through docs/GO-LIVE.md (and 10.10 with
counsel); then Phase 14. 13.5 is after launch.**

**Phase 15 (storefront customisation) was agreed 2026-10-02.** 15.0 goes
before the first live merchant — it removes a false "10% off" promise and a
newsletter form that saves nothing from every storefront. 15.1 onward runs
alongside Phase 14, in order.

**In order:**

| # | What | Why now |
|---|---|---|
| 1 | ~~**12.1** Plans, cycles, trial, lapsing~~ | DONE 2026-09-29. |
| 2 | ~~**11.7** Plans and pricing in the console~~ | DONE 2026-09-29. |
| 3 | ~~**11.2** Merchant list and **11.4** suspend/restore~~ | DONE 2026-09-29. |
| 4 | ~~**12.5** Onboarding~~ and ~~**14.2** CSV import~~ | DONE 2026-09-29/30. |
| 5 | ~~**12.6** Custom domains, with **11.5**'s staff queue~~ | DONE 2026-09-30. |
| 6 | ~~**11.6** Payments, disputes and payout problems in the console~~ | DONE 2026-09-30. |
| 7 | ~~**12.2** One name, **12.3** public site and pricing, **12.4** clean-ups~~ | DONE 2026-09-30. |

**In parallel, before the first live merchant:** Phase 13 — scheduled jobs
(13.1), shared rate limits (13.2), error monitoring (13.3), security headers
(13.4), database drift and backups (13.6), CI (13.7), data rights (13.8), live
keys and approvals (13.9).

**Launch gates that aren't code:**
- 10.10's terms and privacy, reviewed by counsel;
- Paystack's written answers (10.13), above all who pays a lost chargeback;
- `PAYSTACK_MODE=live` and the webhook URL set;
- the brand name decided (12.2);
- 12.5's proposed choices confirmed.

**After launch:** Phase 14, and 13.5 (automating domains through Namecheap's
API).

## Phase 10 — Money reaches the merchant (Paystack subaccounts) — DONE (2026-09-29), except 10.7 (paused) and 10.10 (legal review)

Rewritten 2026-09-29 after the payment architecture was decided (10.1). The
earlier draft's "Option A / Option B" choice is closed.

**The gap, as the code stands today:**

- Every store's online payments go into **one platform Squad account**.
  `lib/payments/squad.ts` is the client, it reads `SQUADCO_SECRET_KEY`, and
  `lib/storefront/checkout/payment-service.ts` holds the flow. Nothing moves
  the money on to the merchant: there is no settlement, balance or payout.
- **Refunds are records only.** `OrderRefund` is written by
  `lib/storefront/orders/returns.ts` (`refundReturn`, `refundCancelledOrder`),
  whose header says "the app moves none". The refund dialog, the order hint in
  `lib/sales/order-labels.ts` and `emails/store-order-alert.tsx` tell the
  merchant to refund "from your Squad dashboard", which a merchant does not
  have — the account is the platform's.
- **The terms say the opposite of the code.** `app/(legal)/terms/page.tsx`
  says payments are taken by "the merchant's payment provider" and that the
  platform "does not hold merchant funds or settle payouts".

**No merchant takes live online payments until this phase is done.**

**What already exists and is kept:**

- **The payment flow in `payment-service.ts`.** Every "Pay now" is its own
  `OrderPayment` attempt with its own reference. There are three ways in — the
  browser callback, the webhook, and the confirmation page as a safety net —
  and all of them lead to one check, `reconcilePayment`. That check:
  - asks the provider's verify endpoint, server to server, whether the
    attempt was paid;
  - compares the amount and currency, recording a difference as `MISMATCH`;
  - claims the attempt with a conditional update, so the order is settled
    exactly once;
  - revives an order whose payment arrived after its hold expired
    (`reviveTimedOutOrder`), or leaves it cancelled and paid as "refund owed".

  **This is provider-neutral in design and stays.** Only the provider calls
  inside it change.
- **The phone-app return** (`nativeApp` on `OrderPayment`, the deep-link page
  in the callback route, `lib/storefront/payments/open-payment-page.ts`).
- **Refund arithmetic.** `refundableAmount` and `paymentStatusAfterRefund` in
  `lib/storefront/orders/policy.ts`, plus the per-parcel delivery-fee refunds
  from 9.6.
- **The expiry cron.** `lib/storefront/orders/lifecycle.ts` checks unpaid
  online orders with the provider before cancelling them.
- **Paystack itself, already integrated for subscription billing.**
  - `lib/billing/paystack.ts` has `paystackFetch`, `initializeTransaction`,
    `verifyTransaction` and `verifyWebhookSignature`, and reads
    `PAYSTACK_SECRET_KEY`.
  - `app/api/billing/paystack/webhook` and `…/callback` are the routes.
  - `applySuccessfulCharge` ignores a reference that isn't a
    `BillingTransaction`.
- **Bank accounts shown for bank-transfer checkout.** `MerchantBankAccount`
  (`features/settings/bank-accounts.ts`, Settings → Payments). The account name
  is resolved by lookup, currently through Squad's `/payout/account/lookup`.

### 10.1 Payment and settlement architecture — DECIDED (2026-09-29)

**The decision:**

- The platform's **existing Paystack account** is the only payment
  integration for storefront orders, the same account that already takes
  subscription billing.
- **Merchants never connect a Paystack account of their own, never paste an
  API key, and are never asked for one.** No merchant-supplied credential is
  stored anywhere, the same rule Social Commerce keeps for Meta.
- Each merchant gets a **Paystack subaccount** under the platform's
  integration, **only after our merchant verification (10.8) is approved** —
  never before, and never for a merchant we have rejected. The subaccount
  carries the merchant's settlement bank account.
- A shopper's payment is initialised on the platform integration **against
  the merchant's subaccount**, and settles through Paystack to the merchant's
  settlement account.
- **No commission on sales.** The platform earns only the plan subscription
  (Settings → Billing, `lib/billing/`). The platform's share of every
  storefront payment is **zero**: no percentage, no flat charge, no setting to
  create one. The subaccount is created with a zero platform share, and the
  transaction carries none.
- **The merchant pays Paystack's processing fee, and nothing else.** In
  Paystack's terms the subaccount is the fee bearer; confirm the parameter name
  and value. The platform must never end up absorbing the fee.
- **Verify** that Paystack settles the whole amount, less its fee, to a
  subaccount whose platform share is zero with the subaccount bearing the fee,
  and that no amount lands in the platform's balance.
- **Verification documents are stored in Cloudinary**, as private, access-
  controlled assets — not the public image delivery used for products (10.8).
- **The platform keeps no merchant balance, no wallet, no payout ledger and no
  payout run**, and does not use Paystack's Transfer API to pay merchants.
  MansaaS keeps order, payment, refund and reconciliation records. It never
  represents merchant money as a balance it holds.

```
Shopper → storefront checkout → Paystack (platform integration)
                                   ├── amount − Paystack fee → merchant's settlement account (subaccount)
                                   └── platform share: none (no commission; the platform earns subscriptions only)
```

**Rejected, and not to be reintroduced:**

- the Squad settlement architecture;
- the platform collecting funds and paying merchants out (ledger, wallet,
  Transfer API payouts);
- "connect your own Paystack", or anything else that has merchants supply
  Paystack keys.

**Why:** settling each merchant's share directly through Paystack is intended to
avoid the platform receiving merchant funds into its own account and paying them
out later. It also keeps the terms' promise that the platform does not settle
payouts close to true. How this arrangement is characterised under Nigerian
payment regulation is **not** decided here: confirm it with qualified legal and
regulatory advice before launch (10.10).

**Multi-vendor carts: there are none today, and none are designed here.**
- Every order belongs to exactly one organization: the cart is persisted per
  store slug (`lib/storefront/stores/storage.ts`), and `placeOrder` takes one
  organization.
- Stores inside one organization are the **same merchant** with one settlement
  account, so a split across stores (Phase 9 parcels) is not a money split.
- Every Phase 10 payment is therefore **one merchant subaccount, with no
  platform share**.
- Paystack's multi-split (several subaccounts on one transaction) is only
  needed if a single checkout ever spans several merchants, or a merchant
  settles different stores to different accounts. Both are out of scope.
- The code **refuses** to build a split naming more than one merchant
  subaccount rather than half-supporting it. If a cross-merchant cart is ever
  built, it gets its own phase, starting with verifying multi-split against
  that cart's shape.

**Verify before coding — desk check DONE 2026-09-29; test-mode checks and
Paystack's written answers still OPEN.** Results are in 10.13. The two
findings that changed the design: `bearer: "subaccount"` is mandatory, since
without it Paystack charges the fee to the platform; and every transaction
sends `transaction_charge: 0`. Refund and dispute liability on subaccount
transactions is unresolved. Refunds are paused (10.7), but the chargeback half
still matters. The items checked were:
- subaccount creation and update (`/subaccount`, the `subaccount_code` it
  returns);
- the subaccount fields on `/transaction/initialize` (`subaccount`, a zero
  `transaction_charge` / percentage, `bearer`), and the `/split` objects only
  for the record, since multi-split isn't built;
- settlement timing and how settlement is reported;
- bank listing and resolution (`/bank`, `/bank/resolve`);
- refunds (`/refund`) on a subaccount transaction;
- dispute/chargeback endpoints and events;
- the webhook events for each.

**Platform prerequisites (operations, not code):**
- the platform Paystack business account is fully activated for live
  payments;
- subaccounts are enabled on it;
- Paystack has confirmed in writing any limits on refunds and disputes for
  subaccount transactions.

### 10.2 Merchant payment onboarding — DONE (2026-09-29)

**As shipped.**
- **"Get paid online"** is a full page at `/settings/payments/online`, with a
  status card at the top of Settings → Payments.
- **Status.** The card shows one of: Not set up / Not submitted / Checking
  your details / Needs changes / Approved / Ready / Needs attention, each with
  a sentence saying what happens next. It also shows steps done and the
  masked settlement account.
- **What the page asks for:**
  - **Business type:** registered company, registered business name, or
    individual/sole trader.
  - **Business name.**
  - **CAC details** — the RC/BN number (normalised to `RC1234567` /
    `BN1234567`), the registered name and the certificate — for registered
    businesses only.
  - **ID:** its type and the document, from the owner or a director.
  - **Proof of address.**
  - **Settlement account:** the bank is searched from Paystack's list
    (282 banks in test mode); the account name is resolved by Paystack.
  - **Payments contact**, prefilled from Settings → General and the member's
    own name.
- **What's missing** is shown beside the form: a live checklist, computed by
  the same rules the server applies (`lib/payments/payment-setup.ts`).
- **Save and submit.** "Save and finish later" saves a draft, which may be
  incomplete but may not be wrong. "Submit for review" requires everything
  and sets `verificationStatus: PENDING` + `setupStatus:
  AWAITING_VERIFICATION`. **Nothing is sent to Paystack**; the subaccount
  waits for approval (10.3).
- **While under review** the page is read-only, with "Take back to make
  changes" (withdraw → `UNVERIFIED`). Once approved it stays read-only;
  changing the account is 10.3.
- **Schema:** `MerchantPaymentAccount` (one per org, including the empty 10.3
  columns `setupStatus`, `paystackSubaccountCode`, `setupError`),
  `MerchantVerificationDocument`, and five enums. Migration
  `20260929120000_merchant_payment_accounts`, hand-trimmed of the
  `orders.customerId` drift and applied with `db execute` +
  `migrate resolve`.
- **Paystack client:** one server-only client, `lib/payments/paystack.ts`
  (`paystackFetch`, `listNigerianBanks` cached 12h, `resolveAccountName`).
  Subscription billing now uses the same `paystackFetch` rather than its own.
- **Private documents (10.8's storage, built here).** Uploads are signed as
  Cloudinary `type: private` into `mansaas/{org}/verification`, with PDF, JPG,
  PNG and WebP accepted, up to 10 MB and 3 files per kind. They are opened
  only through `privateDownloadUrl`, a signed link that lasts 5 minutes.
  - Before saving, a document is checked to be in this org's folder
    (`isOrgDocument`) and in an accepted format.
  - A document the merchant removes is deleted from Cloudinary too.
  - The uploader is `components/media/document-uploader.tsx`, a sibling of the
    image uploader.
- **Permissions:** `settings.view` to see; `settings.edit` to change, upload,
  or open a document. No new permission, so no role backfill.
- **Audit:** `settings.payment_setup.saved` / `.submitted` / `.withdrawn`, with
  labels.
- **Tests:**
  - `tests/settings-payment-setup.test.ts` (12):
    - prefill;
    - Paystack lookup, and an outage not read as a wrong account;
    - a draft may be partial but not wrong;
    - submit names every missing field;
    - another org's document and an `.exe` refused;
    - the account name comes from Paystack, not the browser, and a smuggled
      key is dropped;
    - locked while in review;
    - signed document link, and refused for another org;
    - withdraw, then change to an individual, which drops CAC and deletes
      removed files from storage;
    - view-only members can't change anything;
    - tenancy.
  - `lib/payments/payment-setup.test.ts` (7).
  - `lib/cloudinary/sign.test.ts` +3: private signing, the folder check, the
    download link.

**Not in 10.2, and where it goes:**
- Platform staff reviewing submissions: 11.3.
- Emailing the merchant the result: with 11.3.
- ~~The bank-transfer accounts on the same page still use Squad's account
  lookup and NIP codes: 10.9.~~ Done in 10.9.
- Cloudinary's private delivery was built from its documented API and unit
  tested, but **has not yet been exercised against the real Cloudinary
  account**. Upload one file and open it once, before 11.3 relies on it.

**The original spec, kept for reference:**


**The merchant's side.** Settings → Payments gains an "Accept online payments"
card, above the existing bank-transfer accounts. It shows:
- a checklist of what is still missing;
- the current state in plain words ("Not set up", "Checking your details",
  "Ready — shoppers can pay online", "Needs attention", with the reason);
- one primary action: "Set up online payments".

The rest of the dashboard only links to that card; it never collects any of
this itself. The flow:

1. **Business details:** business or trading name, and the type of business —
   registered company, business name, or individual/sole trader.
2. **Settlement account:**
   - the merchant picks a bank from Paystack's own bank list (not the NIP-coded
     `lib/payments/nigerian-banks.ts`, see 10.9) and types an account number;
   - the account name is **resolved by Paystack and shown for the merchant to
     confirm**, never typed. This is the same pattern `resolveAccountName`
     already follows for transfer accounts.
3. **Contact:** a primary contact name, email and phone for payment matters,
   prefilled from Settings → General (`supportEmail`, `supportPhone`) where set.
4. **Verification details** that our own checks need (10.8). Which fields
   these are depends on the type of business.
5. **Review and submit.** Submitting sends the details for **our**
   verification (10.8); no subaccount exists yet. The merchant sees "Checking
   your details" and is told what happens next. Once platform staff approve
   (11.3), the subaccount is created (10.3) and the merchant is emailed that
   online payments are on — or what went wrong.

**Two field lists, kept apart on purpose.** Implementation starts by writing
both down from Paystack's current documentation and from whatever our
compliance advice requires. No field is hard-coded from assumption.

- **A. What Paystack needs to create and maintain the subaccount.** Expected
  to include the business name, settlement bank and account number, the
  platform's percentage (zero), and optional contact fields — confirm the exact
  required and optional fields. This is the only data sent to Paystack.
- **B. What our own merchant verification needs** (10.8). Candidates:
  - CAC registration (RC/BN number, registered name) for a company or a
    registered business name;
  - identity details for an individual or sole trader;
  - proof of address, where required.

  This data stays with us unless Paystack or a regulator requires it. The two
  lists may overlap, but neither is inferred from the other.

**Rules:**
- Only `settings.edit` members (or a new `payments.manage`, decided in
  implementation — check `lib/permissions.ts` first) may start or change
  payment setup. Every step is audited, with labels added to
  `lib/audit-labels.ts`.
- No field asks for, or accepts, an API key, a secret, or a password for any
  provider account.
- Whatever the merchant typed survives a failed step (AGENTS §4).

### 10.3 Subaccount lifecycle — DONE (2026-09-29), except changing the settlement account

**As shipped.**
- **One place creates subaccounts:** `provisionSubaccount` in
  `lib/payments/subaccounts.ts`.
  - Approving in the console (11.3) calls it. The approval stands whatever
    Paystack answers.
  - It refuses anything not `VERIFIED`, whoever calls it.
- **Exactly once, in four layers:**
  - a conditional claim (`→ CREATING`) before Paystack is called;
  - a claim older than 5 minutes may be taken over;
  - a retry first searches Paystack for a subaccount carrying this org's id in
    its metadata, and adopts it;
  - `paystackSubaccountCode` is unique.

  This matters because **Paystack itself creates a second subaccount for the
  same bank account without complaint** (test mode, 2026-09-29).
- **What Paystack receives:** `percentage_charge: 0`, the settlement bank
  code and account, the business name, the payments contact, a description
  naming the shop, and `metadata: { organizationId, platform: 'mansaas' }`.
- **On success:** the code, `setupStatus` `ACTIVE` (or `DISABLED` if Paystack
  says it's inactive), Paystack's `is_verified` cached as `paystackIsVerified`,
  and `paystackSyncedAt`. New columns, migration
  `20260929170000_subaccount_sync`.
- **Failures:** `ACTION_REQUIRED` with a `setupError` in words.
  - A 4xx says Paystack refused, and why.
  - A timeout or 5xx says we don't know whether it was created, so the retry
    looks first.

  The merchant sees "Needs attention". Staff see the reason and a
  **Try again** button in the console's new **Payouts** panel, alongside
  **Check with Paystack**.
- **No webhooks, so we re-read** (`syncSubaccount`): on Settings → Payments,
  on Get paid online and on the console case page, when our copy is over 10
  minutes old, or forced from the console.
  - Paystack `active: false` → `DISABLED`, which turns off online payments
    (the readiness rule, 10.8).
  - A code Paystack no longer knows → `DISABLED`.
  - Switched back on → `ACTIVE`.
- **The approval email** now says either that payouts are set up, or that
  they're still being set up (`payoutsReady`).
- **Test mode:** the setup form tells a developer that Paystack checks only 3
  real accounts a day, and to use Zenith Bank + `0000000000`.
- **Audit:** `platform.payouts.subaccount_created` / `_adopted` / `_failed`,
  with labels. They show in the case history, and as the platform on the
  merchant's log.
- **Tests:**
  - `tests/subaccounts.test.ts` (8): not-verified refused; created once with a
    zero share and the org in its metadata, and payments become possible;
    racing approvals create one; a refusal needs attention, then a retry
    creates; a timeout that DID create is adopted on retry, not duplicated; a
    dead claim taken over but a fresh one not; no settlement account refused;
    sync off → on → gone.
  - `tests/platform-verification.test.ts`: approval now creates the
    subaccount and makes the shop ready.
  - **An end-to-end run against Paystack test mode** of the real code: create
    → second call no-op → found by metadata → fetched → "lost" and adopted on
    retry → deactivated on Paystack → synced to `DISABLED`. The throwaway org
    was deleted and the test subaccounts deactivated.

**Not built: changing the settlement account after approval.** Today an
approved setup is read-only, so there is no half-built path.
- Designing it means deciding whether a change pauses online payments while
  it's re-checked. A request that goes back to `PENDING` would do that under
  the readiness rule.
- The alternative is a separate change request that keeps the current account
  paying until the new one is approved.
- Build it with an Owner email and a re-authentication step, as below.
  **Open decision.**

**The original spec, kept for reference:**


**Where it lives.** Store the Paystack link on the organization, because the
merchant is the organization; stores inside it share it (10.1). This can be
columns on `Organization` or a small one-to-one `MerchantPaymentAccount` table.
Pick the table if it keeps provider fields out of `Organization`, the same
reason `Subscription` is its own table. Either way it holds:

- `paystackSubaccountCode` (unique, nullable);
- the settlement bank's Paystack code, the bank name, the account number
  **stored masked for display plus what Paystack needs**, and the resolved
  account name;
- no commission field: the platform share is always zero and the merchant
  always bears Paystack's fee (10.1), so both are constants in code, not
  stored state;
- `setupStatus`: `NOT_STARTED | AWAITING_VERIFICATION | CREATING | ACTIVE |
  ACTION_REQUIRED | DISABLED`.
  This is **our** record of how far setup got. Paystack's own state for the
  subaccount (e.g. `active`) is read from Paystack and cached with a
  `lastSyncedAt`, not re-invented. Add a column only for a state Paystack
  doesn't expose.
- `lastError` (a readable reason) and timestamps.

**Creating the subaccount:**
- **Triggered by approval, not by the merchant.** Approving a merchant in the
  platform console (11.3) sets our verification to `VERIFIED` and, in the same
  step, creates the subaccount through a new server-only Paystack module
  (10.11). Submitting the onboarding form never calls Paystack. The creating
  function refuses any organization whose verification isn't `VERIFIED`, so no
  other caller can create a subaccount early.
- **Idempotent and exactly once.** Claim the row with a conditional update
  (`AWAITING_VERIFICATION|ACTION_REQUIRED → CREATING`) before calling
  Paystack, as `SocialPost` claims `PUBLISHING`.
- A unique `paystackSubaccountCode`, plus a per-organization unique row,
  makes a second subaccount impossible to record.
- A retry after a timeout first **looks the merchant up on Paystack** (by our
  stored code, or by listing and matching the business name, account number and
  metadata carrying our organization id — confirm what Paystack lets us search
  on) and **adopts** an existing subaccount instead of creating another.

**When creation fails:**
- `ACTION_REQUIRED` with the reason in words. Our verification stays
  `VERIFIED` — the merchant was approved; it is the Paystack step that failed.
  Platform staff can retry from 11.6, and the merchant sees what, if anything,
  they must change. Online payment stays off; offline selling is untouched.
- A platform outage is logged and shown as "try again shortly", **never** as
  "your account details are wrong" — the distinction `lookupAccountName`
  already draws.

**Changing the settlement account:**
- Re-resolve the new account. Whether a change needs re-verification by
  platform staff before it reaches Paystack is decided with 10.8's review
  rules; a change of account **name** (a different person or business) always
  does. Then update the **existing** subaccount. Never create a second one.
- Requires a recent re-authentication or confirmation step, and is audited
  with the old and new masked account.
- Emails every Owner, as with other security-sensitive changes.
- While Paystack confirms the change, keep taking payments on the old details
  only if Paystack's behaviour allows that; otherwise pause online payment and
  say so. Verify which.

**Disabled or rejected subaccounts:** if Paystack exposes an inactive or
rejected state, sync it (webhook if there is one, otherwise on load and in the
reconcile path), set `DISABLED` or `ACTION_REQUIRED`, and turn online payment
off at checkout at once.

**Merchants who haven't finished setup:**
- The storefront simply doesn't offer online payment. Pay on delivery and
  bank transfer still work if configured.
- The dashboard's needs-attention callouts gain "Online payments aren't set
  up", with a link.

**Secrets:** `PAYSTACK_SECRET_KEY` is read only in server modules. Nothing about
a subaccount that is sent to the browser includes a secret, and the subaccount
code is never accepted *from* the browser (10.4).

### 10.4 Payment initialisation and settlement to the subaccount — DONE (2026-09-29)

**As shipped.**
- **Checkout offers "Pay online" (id `paystack`) first, and only to a shop
  that passes the readiness rule.** `getStoreCheckoutConfig` adds
  `ONLINE_PAYMENT_METHOD` when `onlinePaymentsReady(slug)` is true. The base
  config now lists only pay on delivery, and bank transfer is still added per
  store. This is the **10.8 checkout gate**, now wired.
- **Other places that follow the same rule:**
  - the footer's payment line, which names Paystack only when it's offered;
  - the homepage's "Pay your way" promise, which says "Pay on delivery" for a
    shop that can't take online payments;
  - Settings → Payments' "Pay online" row, "On" only when setup is Ready.
- **Starting a payment** (`startOrderPayment`):
  - it refuses (`unavailable`) unless the shop is ready and has a subaccount;
  - everything comes from the database: `Order.totalAmount` in kobo, the
    currency, the shop's own `paystackSubaccountCode`;
  - `initializeSplitTransaction` fixes `bearer: "subaccount"` and
    `transaction_charge: 0` in code, not as parameters;
  - the metadata carries `purpose`, `organizationId`, `orderId`,
    `orderReference` and `attemptId`;
  - the attempt stores `provider: 'paystack'` and the `subaccountCode` it was
    sent to.
- **The provider seam** (`verifyWithProvider` in `payment-service.ts`):
  - the provider is read from the ATTEMPT: `paystack` → `verifyPaystackTransaction`;
    `squad` → the legacy Squad verify;
  - `reconcilePayment` keeps every rule it had, and adds that a Paystack
    payment to another subaccount, or to none, or with any platform share, is
    `MISMATCH`, never paid;
  - on success it stores Paystack's own split, from `fees_split`, as
    `merchantAmount` / `platformAmount` / `feeAmount` on `OrderPayment`
    (migration `20260929190000_order_payment_split`), and `gatewayRef` =
    Paystack's transaction id.
- **The return route** `/api/payments/paystack/callback`. The logic moved to
  `lib/storefront/payments/payment-return.ts`, shared with the Squad callback,
  which now just delegates. It copes with Paystack appending `trxref` and
  `reference`.
- **Unpaid-order expiry** covers both `paystack` and legacy `squad` orders
  (`ONLINE_PAYMENT_METHODS`), each checked with its own provider first.
- **Copy:**
  - Squad is gone from the checkout, storefront, emails and admin wording;
  - `PAYMENT_METHOD_LABEL` gains `paystack: 'Online (Paystack)'` and keeps
    `squad` for old orders;
  - the refund hints say to send the money back from the merchant's own bank,
    because online payments settle there, and Paystack refunds are paused
    (10.7).
- **Verified in Paystack test mode:**
  - our `initializeSplitTransaction` + `verifyPaystackTransaction` against the
    real API. For ₦12,345.00 the verify reports `split { merchant: 1205982,
    platform: 0, fee: 28518 }` (kobo) and the subaccount code;
  - an unknown reference → null.
- **Tests:**
  - `tests/storefront-payments.test.ts` rewritten (20), against a fake
    Paystack at `fetch`:
    - the method offered only to a ready shop;
    - kobo, subaccount, bearer, zero charge and metadata sent;
    - a not-ready shop refused before calling Paystack;
    - Paystack unreachable;
    - paid once, with Paystack's split stored;
    - `ongoing` stays pending;
    - wrong amount, currency, subaccount, or a platform share → mismatch;
    - an abandoned payment can be retried; no second charge;
    - the callback's stored return address, appended query and phone-app
      deep link;
    - legacy Squad attempts still verified with Squad (and never Paystack),
      through the old return route and webhook.
  - `tests/storefront-order-lifecycle.test.ts` (23) moved to Paystack.
  - Component and unit tests updated for the per-store method.

**Not in 10.4:**
- **The Paystack webhook (10.5).** Payments settle through the return route
  and the confirmation page's re-check for now. A shopper who closes the tab
  on Paystack's page is still caught by the expiry job's check before the
  order is cancelled.
- **The merchant's payments view (10.6).**

**The original spec, kept for reference:**


**One provider seam.**
- Turn the Squad-specific calls in `payment-service.ts` into a
  `PaymentProvider` interface with three operations: `initiate`, `verify` and
  `refund`, the last added only when 10.7 resumes (paused).
- A Paystack implementation serves new orders; a read-only Squad
  implementation serves `verify` for historical attempts only (10.9).
- `reconcilePayment`, `startOrderPayment` and `reconcileOpenAttempts` keep their
  shape and rules. They pick the provider from `OrderPayment.provider`, not
  from configuration, so a Squad attempt is always checked against Squad.
- Share the HTTP client with `lib/billing/paystack.ts` (move `paystackFetch` to
  one server-only module both import) rather than writing a second one.

**Initialising.** `startOrderPayment` builds everything **on the server, from
the database**:
- the amount is `Order.totalAmount` in kobo, as `toMinor` does today;
- the currency is the order's;
- the subaccount is the order's organization's `paystackSubaccountCode`;
- `bearer: "subaccount"` on every transaction — **mandatory**: without it
  Paystack charges the fee to the platform (10.13) — and `transaction_charge: 0`
  on every transaction, so the platform's share is zero whatever the
  subaccount's `percentage_charge` turns out to mean (10.13).

It passes our attempt reference and a callback to the storefront's own origin,
plus `metadata` carrying `organizationId`, `orderId`, `orderReference`,
`attemptId` and `purpose: "storefront-order"`. It refuses (`unavailable`) if the
organization's payment setup isn't `ACTIVE`, and it sends exactly one
subaccount — no multi-split in this phase (10.1).

**What the merchant receives:**
- **Order total − Paystack's fee.** There is no platform deduction (10.1).
- The fee and its rounding are Paystack's. Record Paystack's reported fee and
  settled amount (below) and show those, never our own estimate of the fee.

**One merchant's money can never reach another merchant.**
- The subaccount comes from the order's own `organizationId`, and the order is
  loaded with `{ id, organizationId, channel: 'ONLINE' }`, as now.
- No subaccount, amount, charge or organization id is ever taken from the
  browser.
- A test sets two merchants side by side and asserts that each order's
  initialise call names only its own subaccount.

**What each attempt records.** Keep `OrderPayment` and add the following.
Everything existing stays; `provider` becomes `'paystack'` for new rows.
- `subaccountCode`, as sent;
- the fee bearer as sent (always the subaccount);
- after verification, from Paystack's own answer:
  - the provider's transaction id and reference (`gatewayRef` can hold one);
  - the fees;
  - the settled breakdown — the merchant amount and the fee, as Paystack
    reports them. A non-zero platform amount is an error, flagged for 11.6;
  - `providerPayload`.

  That is what 10.6 shows, and it is Paystack's record, not our arithmetic.

**Reconciliation chain.** Every confirmed payment must be traceable:

```
Order (+ OrderLineItem) → OrderPayment → Paystack transaction/reference
      → organization → Paystack subaccount → settlement data
```

A confirmed Paystack transaction that matches no attempt, or an attempt whose
verified subaccount differs from what was sent, is flagged for the platform
console (11.6). It is never dropped and never auto-applied.

**Not built:** any internal ledger, balance, or "amount owed to merchant" column.

### 10.5 Verification and webhooks — DONE (2026-09-29)

**As shipped.**
- **One webhook for the whole integration:** `lib/payments/paystack-webhook.ts`,
  served at **`/api/payments/paystack/webhook`** and at the older
  `/api/billing/paystack/webhook`, which now delegates to the same handler.
  Whichever URL Paystack's dashboard names, nothing is missed.
  **Action for launch: set the dashboard's webhook URL to
  `https://{PLATFORM_HOST}/api/payments/paystack/webhook`**, for both test and
  live mode.
- **Signature:** `verifyPaystackSignature` (in `lib/payments/paystack.ts`) is a
  constant-time compare of the hex HMAC-SHA512 of the raw body. Billing's old
  `===` compare now delegates to it. A bad signature is a 401 and touches
  nothing; a signed non-JSON body is a 400.
- **Routing** (`routePaystackEvent`):
  - `charge.success` whose reference is an `OrderPayment` → `reconcilePayment`.
    It verifies with Paystack itself; the body is never believed.
  - Every other `charge.success`, and `subscription.*` / `invoice.*` →
    `handleBillingEvent` (`lib/billing/webhook-events.ts`: the old billing
    route's switch, moved there unchanged).
  - `charge.dispute.*` → `recordDispute`.
  - `refund.*` → acknowledged and logged only, since refunds are paused
    (10.7).
  - Anything else → acknowledged.

  It always answers 200 once signed, as both earlier webhooks did.
- **Chargebacks:**
  - A new `PaymentDispute` table (migration
    `20260929210000_payment_disputes`) holds one row per Paystack dispute id,
    matched to our payment by the transaction reference. A dispute on
    anything else is logged and left alone.
  - It stores the status, resolution, category, amount (kobo → major), due
    date, resolved date and Paystack's payload.
  - An event older than the one recorded is ignored, because webhooks arrive
    out of order.
  - **Told on the way in and on the way out:** an email
    (`emails/payment-dispute.tsx`) to the shop's order handlers and Owner plus
    `PLATFORM_ADMIN_EMAIL`, since disputes reach the platform's account.
    Reminders update the row quietly.
  - Audited as `platform.payments.dispute_opened / _updated / _resolved`.
  - **On the order page:** a "Chargeback" panel with a plain-language status
    (`lib/sales/dispute-labels.ts`), the amount, the date and the response
    deadline, or the outcome once settled.
  - **On the dashboard:** a "needs attention" line while one is open, linking
    straight to the order when there's one.
  - Nothing claims whose money a lost dispute comes from — that question is
    still open with Paystack (10.13).
- **Abandoned payments:** unchanged. The expiry job checks each unpaid online
  order with its provider before cancelling it.
- **Tests:** `tests/paystack-webhook.test.ts` (10):
  - the signature, including a tampered body, the wrong key, short and
    missing values;
  - unsigned or wrongly signed deliveries refused with nothing touched;
  - non-JSON refused;
  - a body claiming success while Paystack says failed stays unpaid;
  - one payment delivered three times through both URLs → paid once, and
    never routed to billing;
  - other charges and subscription events reach billing, through either URL;
  - refund events acknowledged with no effect;
  - the full chargeback path — recorded against the order and payment, owner
    and platform emailed once, a duplicate is a no-op, a reminder updates
    quietly, an older event is ignored, resolution recorded and emailed;
  - a dispute on a payment that isn't ours is left alone.

**Not in 10.5:**
- **Answering a dispute** — uploading evidence, accepting. This waits on
  Paystack's answer to question 2 (who can respond on a subaccount
  transaction).
- **The platform console's disputes list** (11.6).

**The original spec, kept for reference:**


**The lifecycle:**
1. initialise;
2. the shopper pays on Paystack's page;
3. the browser returns through the callback **and/or** Paystack sends a
   webhook;
4. the server verifies with Paystack (`/transaction/verify/:reference`);
5. `reconcilePayment` settles the attempt and the order once.

Its existing rules carry over unchanged:
- **only a server-side verify makes an order paid**; the callback's query
  string and the webhook body mean nothing more than "go and check this
  reference";
- a wrong amount or currency is `MISMATCH`;
- a duplicate delivery finds the attempt already claimed and does nothing;
- a verify failure is `'error'` and retried by the next door, never read as
  unpaid.

The verify must also confirm that **the transaction settled to the subaccount
this attempt sent**. A mismatch is treated like an amount mismatch.

**One webhook URL for the whole integration.**
- Paystack sends every event on the platform account to the one configured
  URL (confirm this), so storefront events will arrive alongside subscription
  billing's.
- Build one route that verifies `x-paystack-signature` against the raw body
  **in constant time**. `lib/billing/paystack.ts` compares with `===` today;
  fix that here.
- The route dispatches by what the reference belongs to:
  - a `BillingTransaction` → `applySuccessfulCharge`, as now;
  - an `OrderPayment` → `reconcilePayment`;
  - neither → logged and acknowledged.
- `metadata.purpose` is a hint for logging only; the database lookup decides.
- Either keep `/api/billing/paystack/webhook` as that route, or move it to a
  neutral `/api/payments/paystack/webhook` and repoint the dashboard setting in
  the same release.
- It always answers 200 once the signature is good, like both existing
  webhooks.

**Events to handle** (names to confirm):
- `charge.success` → reconcile;
- failed and abandoned charges → the attempt becomes `FAILED`/`ABANDONED` by
  the same verify;
- refund events → none while 10.7 is paused (they are acknowledged and logged);
- dispute events → below;
- any subaccount status event → 10.3.

**Abandoned attempts.** The existing expiry cron already re-checks unpaid
orders with the provider before cancelling them (`lifecycle.ts`), so a payment
that went through unheard settles instead. Keep that, going through the
provider seam.

**Chargebacks and disputes.** If Paystack exposes them on subaccount transactions,
store each dispute against its `OrderPayment` (amount, status, deadline,
provider id), show it on the order and in 10.6, and notify Owners. Whether a
dispute debits the subaccount or the platform is **to verify**; don't assume.

**Never trusted from the client:** amount, currency, organization, subaccount,
fee bearer, payment status, or "success" from a redirect.

### 10.6 The merchant's payments view — DONE (2026-09-29)

**As shipped.**
- **Sales → Payments** (`/sales/payments`, a new sidebar entry under Sales,
  `sales.view`, the Sales module like Orders). Every successful online
  payment, newest first.
- **Each row:** the date, the order (linked; the whole row opens it), the
  customer, **Customer paid**, **Paystack fee**, **You receive** and the
  Paystack reference.
  - Badges for a chargeback (its plain-language status), refunds recorded,
    and a Squad-era payment.
  - Figures are Paystack's own, from `fees_split` on the verified transaction
    (10.4) — never our arithmetic. A Squad-era payment shows "—" for fee and
    net, because Squad reported no split.
- **No platform fee column and no balance.** The line above the figures says:
  - the amounts are Paystack's;
  - Paystack pays into the masked settlement account on its own schedule;
  - MansaaS holds nothing and takes no cut;
  - the page can't show when each payment reached the bank, because Paystack
    reports no per-subaccount settlement (10.13) — the bank statement can.
- **Headline figures** for the filtered set: customers paid (with the count),
  Paystack fees, and what the merchant receives "before any refunds you send
  back".
- **Filters in the URL:**
  - period: 7, 30 (the default) or 90 days, or all time;
  - every payment, or only those with a chargeback;
  - search by order number, attempt reference, Paystack reference, email or
    customer surname;
  - pagination, with a page past the end clamped.

  The three states: no online payments yet (with "Set up online payments" if
  payouts aren't set up), no results for the filters, and the route's error
  boundary.
- **CSV:** every payment the filters match (capped at 5,000) through
  `ExportCsvButton`'s `fetchRows`.
- **On the order page:** "Paystack's split" — what went to the bank,
  Paystack's fee and its reference — under the payment method.
- **Code:** `features/sales/payments.ts` (`listOnlinePayments`,
  `exportOnlinePayments`).
- **Tests:** `tests/sales-payments.test.ts` (10):
  - only this store's successful payments, the Squad-era row without a split,
    refunds and a chargeback per row;
  - totals over the whole filtered set;
  - period filters, and an unknown period falling back to 30 days;
  - the chargeback view;
  - search by order, Paystack reference and email;
  - never another business's payment;
  - the masked settlement account;
  - page clamping;
  - the export returning every match;
  - `sales.view` required.

**Not in 10.6:**
- **Settlement dates per payment.** Paystack's API reports none per
  subaccount; revisit if Paystack's answer to 10.13 question 4 says
  otherwise.
- **Refunds through Paystack**, paused (10.7). Recorded manual refunds show
  as a badge.

**The original spec, kept for reference:**


This replaces the earlier "Payouts" page, which assumed the platform held the
money. The merchant is shown **what Paystack did**, never a balance MansaaS
owes them.

**Sales → Payments** (or a tab on Settings → Payments; decide against AGENTS §2)
lists online payments, filtered in the URL and paginated (AGENTS §3), with a CSV
export (`ExportCsvButton`). Each row shows:
- the order reference, linked, and the date;
- **Customer paid** — the transaction amount;
- **Paystack fee** — always shown, since the merchant bears it;
- **You receive** — the amount after Paystack's fee, as Paystack reported it;

There is **no platform fee column**: MansaaS takes nothing from a sale, and the
line above the table says so ("MansaaS doesn't take a cut of your sales — the
only deduction is Paystack's fee").
- the Paystack reference;
- the settlement status and date where Paystack exposes them, otherwise "—";
- the destination account, masked ("GTBank ••••4821");
- refunds and disputes against it.

A line above the table says what it measures and where the figures come from
(AGENTS §10): amounts are as reported by Paystack; money settles from Paystack
to the account shown; MansaaS doesn't hold it.

**Wording rule:** no "balance", "wallet", "withdraw" or "owed by MansaaS"
anywhere. Settlement timing and status come from Paystack's settlement data if
it offers it per subaccount — verify what exists. Where Paystack says nothing,
the screen says "Paystack settles to your account on its schedule" rather than
estimating.

The order detail page shows the same breakdown for that order's payment.

### 10.7 Refunds — PAUSED (2026-09-29)

**Paused. Don't build any of 10.7 until this note is lifted.** The platform is
in talks with a third-party wallet provider. The expected model is:
- a merchant initiates a refund;
- the money goes to the **customer's wallet on the storefront**, not to their
  bank account or card.

That would replace the Paystack refund flow below. The provider isn't chosen
and the terms aren't agreed, so nothing about wallets is designed here yet.
When the talks conclude, this section is rewritten around the chosen provider.

**While paused:**
- **No new refund work anywhere:**
  - no Paystack `/refund` calls;
  - no refund statuses or `OrderRefund` schema changes;
  - no refund webhooks (10.5);
  - no refund columns beyond what is already recorded (10.6);
  - no counter-sale refunds (14.7);
  - no refund acceptance tests (10.12).
- **What is already built is left exactly as it is.** The returns flow and
  "record a refund" (`lib/storefront/orders/returns.ts`,
  `features/sales/order-returns.ts`) keep recording money the merchant sends
  back themselves. Whether that stays switched on meanwhile is a product call,
  not decided here.
- **The copy that points merchants at "your Squad dashboard"** (the refund
  dialog, `lib/sales/order-labels.ts`, `emails/store-order-alert.tsx`) must
  still stop naming Squad once 10.9 retires it, and should say "send the money
  back yourself and record it here". That is a copy change, not refund work.
- **The "paid after cancellation — refund owed" orders (9.3/9.6) will still
  happen** once payments move to Paystack. Until a refund path exists, the
  merchant sends that money back themselves, as today.

The design below is kept as a record of the Paystack-refund approach and of
what the checks in 10.13 found. **It is not a plan to build.**

- **An `OrderRefund` row is not proof that money moved.** For an order paid
  online through Paystack:
  - "Refund" creates the refund in a **pending** state;
  - it calls Paystack's refund endpoint for the order's successful attempt,
    with the amount, which allows a partial refund;
  - it stores Paystack's refund id and reference;
  - the refund becomes **refunded only when Paystack confirms it** (webhook or
    verify, per its documented behaviour);
  - a failed refund is shown as failed, with a retry, and leaves the order's
    payment status unchanged.
- **Schema.** `OrderRefund` gains:
  - `method` (`PAYSTACK | MANUAL`);
  - `status` (`PENDING | PROCESSING | NEEDS_ATTENTION | REFUNDED | FAILED`),
    following Paystack's refund statuses (10.13). `NEEDS_ATTENTION` asks the
    merchant for the customer's bank details and retries through
    `/refund/retry_with_customer_details/{id}`;
  - `provider`, `providerRefundId`, `providerReference`;
  - `paymentId`, pointing at the `OrderPayment`;
  - a `failureReason`;
  - an `idempotencyKey`, unique per organization.

  Existing rows backfill to `MANUAL` + `REFUNDED`, because that is what they
  recorded.
- **Payment status.** `paymentStatusAfterRefund` and `refundableAmount` count
  only `REFUNDED` rows toward what has gone back. What they count toward what
  can still be refunded is `REFUNDED` **plus in-flight**, so two refunds can't
  both take the last naira. The existing guard against that (the header of
  `returns.ts`) carries over.
- **No double refunds:**
  - a unique idempotency key per request;
  - a conditional claim on the return/order;
  - a pre-flight check that the Paystack transaction isn't already fully
    refunded;
  - "already refunded" answered by Paystack recorded as such, not as an
    error.
- **Full and partial:**
  - returns, cancelled-but-paid orders (the "refund owed" callout from 9.3/9.6
    and `refundsOwed` on the dashboard), and per-parcel delivery fees (9.6)
    all go through the same call;
  - the late-payment "refund owed" orders get a real **Refund now**.
- **Subaccount transactions — BLOCKED on Paystack's written answer (10.13,
  questions 1–3); a third-party guide says the main account pays.** From Paystack's docs, and from
  Paystack support if the docs don't answer it, establish:
  - that a refund on a subaccount transaction is debited from the
    **merchant's** settlement, never the platform's balance — the platform has
    no share in the sale to refund from;
  - what happens when the merchant's money has already settled (a debit on a
    later settlement? a negative balance?), and what happens if the merchant
    has no later sales;
  - whether Paystack's fee is returned on a refund, or stays a cost to the
    merchant;
  - whether partial refunds on subaccount transactions are supported.

  Record the answers in 10.13. Until then, the refund dialog must not claim
  whose money it comes from.
- **Manual refunds stay manual.**
  - Pay on delivery, bank transfer and counter-sale refunds remain
    merchant-sent money that is recorded, with `method = MANUAL`, recorded
    straight as `REFUNDED` exactly as today.
  - The dialog says the merchant sends this one themselves.
  - Squad-paid historical orders are also `MANUAL` (10.9).
- **Fix the copy that is wrong today.** The refund dialog (`HOW_TO_REFUND`),
  the order hint in `lib/sales/order-labels.ts` and
  `emails/store-order-alert.tsx` send merchants to "your Squad dashboard".
  Online refunds now happen from the order page.

### 10.8 Merchant verification — DONE (2026-09-29), except the checkout gate

**As shipped** (together with 11.1 and 11.3, which carry out the review):
- **The data and private document storage** shipped in 10.2.
- **The rule, `onlinePaymentReadiness`** (`lib/payments/payment-setup.ts`,
  loaded by `getOnlinePaymentReadiness` in `lib/payments/online-readiness.ts`):
  online payment only when OUR status is `VERIFIED`, the subaccount is
  `ACTIVE`, and the org is `ACTIVE`. Otherwise it names the first blocker:
  `not_submitted | in_review | rejected | payouts_not_ready | suspended`.
- **The review:**
  - `approveVerification` / `rejectVerification` in
    `features/platform/verification.ts`, each claimed on
    `verificationStatus: PENDING`, so a case is decided once. Two staff
    pressing together, or a merchant who withdrew meanwhile, get "not waiting
    any more".
  - Approval leaves `setupStatus` at `AWAITING_VERIFICATION`: the subaccount
    is 10.3's, and the hook is marked in the code.
  - Sending back needs a reason of 10–500 characters, stores it, and resets
    `setupStatus` to `NOT_STARTED`.
- **The merchant is emailed either way** (`emails/payment-verification-result.tsx`,
  sent to the payments contact). The approval email says honestly that payouts
  still need setting up.
- **Dashboard:** a "needs attention" line appears for members with
  `settings.edit`, but only for blockers the merchant can act on:
  `not_submitted` and `rejected`. "In review" and "payouts not ready" are ours
  to finish, so they stay on the payments page.
- **Tests:** `onlinePaymentReadiness` (+1 in
  `lib/payments/payment-setup.test.ts`) and `tests/platform-verification.test.ts`
  (7).

**Not yet wired: checkout.** Checkout doesn't call the readiness rule yet,
because the "Pay online" method is still Squad. Gating Squad on Paystack's
readiness would switch off online payment in every store for a provider it
doesn't use. **10.4 wires it** into `lib/storefront/checkout/store-config.ts`,
the payment step and `startOrderPayment`, in the same change that moves
checkout to Paystack.

**The original spec, kept for reference:**


**Two different states, never merged:**

1. **Our verification** — has MansaaS checked this merchant? It is stored on
   the organization (or the 10.3 table) as `UNVERIFIED | PENDING | VERIFIED |
   REJECTED`, plus a reviewer, a date and a rejection reason the merchant sees.
   It is reviewed in the platform console (11.3).
2. **Paystack's state** — does a working subaccount exist, and is it active
   (10.3)? It comes from Paystack.

`VERIFIED` never implies that Paystack has approved anything, and an active
subaccount never implies that we have verified the merchant.

**What is checked** is list B from 10.2, confirmed from compliance advice and
Paystack's requirements. Candidates:
- the business name;
- CAC registration where the business is registered;
- identity details for an individual or sole trader;
- the resolved settlement account name, matched against the business or
  person;
- contact details.

**Documents are stored in Cloudinary — privately.** Today every upload goes
through `lib/cloudinary/sign.ts`, signed as `image/upload` (public delivery)
into `mansaas/{organizationId}/{purpose}`, with image formats only. Documents
need their own path through it:
- a new purpose (e.g. `verification`) that signs uploads with Cloudinary's
  **authenticated or private delivery type**, so no public URL exists — verify
  which type fits and that signed URLs can be made short-lived;
- the formats a merchant will actually send (PDF plus images), with a size
  limit; confirm how Cloudinary handles PDFs under the chosen delivery type;
- **viewing only through a server action** that checks the viewer — platform
  staff reviewing (11.3), or the merchant's own members with the payments
  permission — and returns a short-lived signed URL. The stored record keeps
  the `publicId`, never a URL a browser could reuse;
- the same ownership check `isOwnedAsset` makes for images, so a request can't
  attach another organization's asset;
- a stated retention period, and what happens to documents when a merchant
  closes their workspace (13.8).

AGENTS §9 routes all merchant *image* uploads through
`components/media/image-uploader.tsx`; documents get a sibling document
uploader rather than bending that one.

**The order is fixed: verification first, then the subaccount** (10.1). A
merchant goes `UNVERIFIED → PENDING` on submitting, then `VERIFIED` or
`REJECTED` on review. Only `VERIFIED` triggers subaccount creation (10.3). A
`REJECTED` merchant gets no subaccount and can correct and resubmit.

**Online payment is offered at checkout only when all three hold:**
- our status is `VERIFIED`;
- the subaccount is `ACTIVE`;
- the organization isn't `SUSPENDED` (11.4).

`VERIFIED` alone is not enough: the subaccount step can still fail (10.3).
Enforce the rule in one
server-side function used by `lib/storefront/checkout/store-config.ts`, the
payment step and `startOrderPayment`. The storefront just doesn't list the
method; the dashboard says exactly what is missing.

**Offline selling is unaffected**, consistent with the product today: the
till, invoices, bank transfer to the merchant's published account, and pay on
delivery.

### 10.9 Retiring Squad — DONE (2026-09-29)

**As shipped.**
- **Removed outright** rather than kept verify-only:
  - `lib/payments/squad.ts`;
  - `/api/payments/squad/callback` and `/api/payments/squad/webhook`;
  - `lib/payments/nigerian-banks.ts`, the NIP-coded bank list.

  The plan was to keep verification while any Squad attempt could still be
  pending. On the dev database the newest pending one was 3 days old (the
  hold window is 60 minutes), all on test orders; nothing is live, so nothing
  could still complete.
- **History is intact.** No row was deleted or changed.
  - `OrderPayment.provider = 'squad'` and `Order.paymentMethod = 'squad'`
    stay, labelled "Online (Squad)".
  - They show on Sales → Payments (fee and net as "—") and in exports.
  - A Squad-era attempt still PENDING is answered `'unverifiable'` by
    `reconcilePayment`, without any network call, never guessed paid or
    unpaid. The expiry job still cancels its order after the window.
- **Bank-transfer accounts** (Settings → Payments):
  - they now use Paystack's bank list and `/bank/resolve`, like the
    settlement account;
  - the bank picker was extracted to `components/dashboard/bank-picker.tsx`
    and shared by both forms;
  - an account saved under the old list is matched by name (`bankCodeForName`),
    or chosen again when editing, with a hint saying so;
  - the test-mode hint appears here too.
- **Fixed on the way:** the checkout's payment step still keyed its card icon
  to `squad`, so "Pay online" had lost its icon since 10.4.
- **Copy:**
  - the privacy page's processor list now names Paystack for both
    subscriptions and storefront payments, including the payout details it
    receives;
  - the terms' payment paragraph has only the provider's NAME corrected, with
    a comment that the paragraph is 10.10's;
  - `MOBILE.md` and the schema comments updated.
- **Tests:**
  - `storefront-payments` now proves a Squad-era attempt is `'unverifiable'`
    with no fetch and the order unchanged;
  - `settings-bank-accounts` mocks Paystack instead of Squad, and adds "a
    bank Paystack doesn't list is refused".

**The original spec, kept for reference:**


**Historical data stays. Nothing is deleted or rewritten to simplify the new
code.**

- **Stays as history:**
  - `OrderPayment` rows with `provider = 'squad'`;
  - `Order.paymentMethod = 'squad'`;
  - their `providerPayload`, `gatewayRef` and `verifiedAt`;
  - every `OrderRefund`.

  They remain readable on the order page, in reports and in exports.
  `PAYMENT_METHOD_LABEL` (`lib/sales/order-labels.ts`) keeps `squad: 'Online (Squad)'` for old orders.
- **Removed from new orders:**
  - the `'squad'` checkout method (`CHECKOUT_PAYMENT_METHODS` in
    `lib/storefront/mock/checkout.ts`, and the `'squad'` value of the
    `provider` union in `lib/storefront/checkout/types.ts`);
  - `SQUAD_PROVIDER` checks in `payment-service.ts`, `lifecycle.ts` and
    `features/shop-orders/actions.ts`. These become "paid online through a
    provider", not a string comparison against one provider.
- **Code:**
  - `lib/payments/squad.ts` shrinks to what is needed to **verify** old
    references while any Squad attempt could still be pending. Once none are
    open (they expire within the unpaid-order window), `initiateTransaction`
    goes.
  - The Squad account-name lookup is replaced by Paystack's bank resolution
    for both the settlement account (10.2) and the bank-transfer accounts in
    `features/settings/bank-accounts.ts`.
- **Bank codes.**
  - `lib/payments/nigerian-banks.ts` is keyed by NIP codes for Squad.
    Paystack uses its own bank codes from its bank list, so replace it with
    Paystack's list (fetched and cached server-side, or a checked-in snapshot
    — decide).
  - `MerchantBankAccount` stores `bankName` but **no code**, so existing
    transfer accounts keep working as display data. Resolving them again is
    only needed if they become settlement accounts.
- **Routes:**
  - `/api/payments/squad/callback` and `/api/payments/squad/webhook` stay
    until the dashboard no longer points at them and no Squad attempt is
    open. Then they are removed, in a release that says so.
  - New: the Paystack callback for storefront orders, and the shared webhook
    (10.5).
- **Environment:** `SQUADCO_SECRET_KEY`, `SQUADCO_PUBLIC_KEY` (unused in code
  today) and `SQUADCO_BASE_URL` become obsolete once the routes go (10.11).
- **Tests:**
  - `tests/storefront-payments.test.ts` (18 cases, with a Squad fetch mock) is
    rewritten against a Paystack mock, keeping every rule it asserts;
  - one case keeps a historical Squad attempt verifying through the legacy
    path;
  - `tests/settings-bank-accounts.test.ts` and `checkout-view.test.tsx` follow;
  - `tests/storefront-order-lifecycle.test.ts` covers expiry through the
    provider seam.
- **Copy and pages that name Squad:**
  - the storefront trust lines (`lib/storefront/store-claims.ts`, the catalogue
    feature list in `lib/storefront/catalog.ts`, `site-footer.tsx`);
  - the checkout payment step and confirmation page;
  - `open-payment-page.ts` and `pay-now-button.tsx` comments;
  - Settings → Payments;
  - the privacy page's processor list.

  Each must say Paystack, or nothing provider-specific.
- **No schema change removes a Squad column or row.** Migrations here only
  add. The `orders.customerId` drift note in Phase 8.6 applies to how they are
  applied.

### 10.10 Terms, privacy and merchant agreement — TODO

This is engineering's list of what the legal documents must accurately cover.
The wording itself is for counsel, not for this file.

- **Terms** (`app/(legal)/terms/page.tsx`). The payments paragraph currently
  says payments go through "the merchant's payment provider, currently Squad"
  and that the platform "does not hold merchant funds or settle payouts". It
  must describe:
  - the platform's role, Paystack's role and the merchant's role;
  - how shopper payments are processed through the platform's Paystack
    integration;
  - that merchant settlement goes through a Paystack subaccount to the
    merchant's account;
  - that the platform charges **no commission on sales** — its only charge is
    the plan subscription — and that the merchant bears Paystack's processing
    fee;
  - refunds: say only what the product does while 10.7 is paused (the
    merchant returns money themselves), and revisit once the wallet partner is
    agreed;
  - chargebacks and disputes;
  - merchant verification;
  - when online payment may be paused or disabled (incomplete setup,
    verification rejected, subaccount disabled, suspension);
  - any marketplace or platform terms Paystack requires us to pass on.
- **Privacy** (`app/(legal)/privacy/page.tsx`):
  - replace Squad in the processor list with Paystack;
  - list what verification and bank data is collected, why, where it is
    stored, how long it is kept, and what is shared with Paystack.
- **Merchant agreement.** Decide whether the payment terms merchants accept at
  onboarding (10.2) are a section of the terms or a separate agreement they
  explicitly accept, recorded with version and time.
- **Legal review of the final wording is a launch gate**, as is the regulatory
  question flagged in 10.1.

### 10.11 Environment and configuration — DONE (2026-09-29)

**As shipped.**
- **`PAYSTACK_SECRET_KEY`** is the only Paystack credential: server-side, and
  shared by billing, subaccounts, checkout and the webhook, whose signature is
  an HMAC with this same key (confirmed; there's no separate webhook secret).
- **`PAYSTACK_MODE`** (`live` | `test`) — new, deliberately standardised
  here. When it disagrees with the key's prefix, `paystackConfigProblem()`
  names the problem, **nothing talks to Paystack**
  (`isPaystackConfigured()` is false and `paystackFetch` throws), and no
  webhook verifies. This stops a test key left on the live site from marking
  real orders paid with test cards, and a live key on staging from moving
  real money. Unset, the key decides, as locally.
  **Set `PAYSTACK_MODE=live` in production.**
- **Removed from `.env.example`:** the Squad section (`SQUADCO_SECRET_KEY`,
  `SQUADCO_PUBLIC_KEY`, `SQUADCO_BASE_URL`), and
  `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, which nothing read — the redirect flow
  needs no public key.
- **Documented in `.env.example`:** the dashboard webhook URL
  (`/api/payments/paystack/webhook`); that callbacks need no dashboard entry;
  and the test-mode realities (3 real resolves a day; Zenith `057` +
  `0000000000`).
- **Local `.env` files** still holding `SQUADCO_*` keys are harmless — nothing
  reads them — and can be deleted by hand.
- **Tests:** `lib/payments/paystack.test.ts` (4): the key decides when no mode
  is set; a mismatch in either direction refuses; an unknown mode value
  refuses; a validly signed webhook is refused while misconfigured.

**The original spec, kept for reference:**


- **Existing and reused:** `PAYSTACK_SECRET_KEY` (server-only, already read by
  `lib/billing/paystack.ts`). The Paystack webhook signature is an HMAC with
  this same key, so no separate webhook secret exists to configure — confirm.
- **Existing, check before relying on it:** `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` is
  in `.env.example` but nothing in `app/`, `lib/`, `features/` or `components/`
  reads it. Only keep it if a client-side Paystack step (e.g. inline popup) is
  deliberately chosen; the redirect flow needs no public key.
- **No commission configuration.** There is no commission (10.1), so there is
  no rate to store in env, `PlatformSetting` or the console.
- **The fee bearer is not configuration.** It is always the merchant (10.1),
  so it is a constant in the Paystack module, not a setting.
- **Cloudinary** needs no new variables for documents; the existing
  `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` and server-side key/secret read by
  `lib/cloudinary/config.ts` serve the private delivery type too — confirm.
- **Test vs live** follows the key, as the Squad client does for its
  sandbox. Live mode must refuse to start a payment with a test key.
- **Dashboard configuration:** in the Paystack dashboard, point the webhook URL
  at the shared route (10.5). The callback is per transaction and needs no
  dashboard entry — confirm.
- **Removed** after 10.9: `SQUADCO_SECRET_KEY`, `SQUADCO_PUBLIC_KEY`,
  `SQUADCO_BASE_URL` and the Squad section of `.env.example`.
- No Paystack secret, subaccount secret, or merchant credential is ever in a
  `NEXT_PUBLIC_` variable, a client bundle, a log line or an audit entry.

### 10.12 Tests and acceptance criteria — TODO

Database tests run with `--no-file-parallelism` (the Neon note in 9.2). The
Paystack API is mocked at `fetch`, as `storefront-payments.test.ts` mocks Squad
today. A manual pass in Paystack **test mode** with a real test subaccount is
also required before switching to live.

**Merchant onboarding:**
- a merchant can complete payment setup, and the account name shown is the one
  Paystack resolved;
- the subaccount is created **exactly once**; a double submit and a retry
  after a timeout both leave one subaccount, and the retry adopts it;
- invalid bank details are refused next to the field; a Paystack outage reads
  as "try again", not "wrong details";
- changing the settlement account updates the same subaccount and is audited;
- incomplete setup, `PENDING` or `REJECTED` verification, or a disabled
  subaccount each keep online payment off at checkout and on `startOrderPayment`;
- **no subaccount exists before approval**: submitting the form makes no
  Paystack call, and the creating function refuses a merchant who isn't
  `VERIFIED`;
- approving a merchant creates the subaccount once; a failed creation leaves
  them `VERIFIED` + `ACTION_REQUIRED` and can be retried without a duplicate;
- verification documents have no public URL: fetching the stored asset
  without a signed URL fails; a member of another organization and a member
  without the payments permission can't get a signed URL; platform staff can.

**Paying (one merchant per order):**
- the shopper can pay, and the initialise call carries the server-computed
  amount, the order's own subaccount, the merchant as fee bearer, and no
  platform charge;
- the merchant receives total − Paystack's fee, as Paystack reports it, and
  the platform's share is zero; a non-zero platform amount is flagged;
- two merchants side by side: each order names only its own subaccount;
- the webhook is idempotent: a repeated or racing callback and webhook
  settles once;
- the order becomes paid only after a server-side verify; a forged callback or
  replayed webhook body alone changes nothing;
- an amount, currency or subaccount mismatch is `MISMATCH`, not paid;
- a late payment still revives, or leaves "refund owed", as today;
- a split naming more than one merchant subaccount is refused (10.1).

**Multi-merchant (guard only, since no such cart exists):**
- a cart or order can't span two organizations;
- no code path builds a multi-split. If one is ever built, its own phase adds
  the criteria: each merchant receives only its share; the platform receives
  nothing; references stay traceable; partial failure is
  handled; and the behaviour matches Paystack's supported multi-split.

**Refunds — PAUSED with 10.7; not part of Phase 10's acceptance:**
- a full refund works;
- a partial refund works, if 10.7's verification confirms support;
- a double refund is prevented, both from the same click and across two tabs;
- the refund reaches `REFUNDED` only on Paystack's confirmation, with its
  reference stored;
- a failed refund leaves the order's payment status unchanged and offers a
  retry;
- manual refunds still record straight to `REFUNDED`.

**Security:**
- merchants are never asked for, and can't submit, a Paystack key;
- Paystack secrets stay server-side — a bundle check for the key names, and
  no secret in logs;
- the client can't choose a subaccount, a fee bearer, a platform charge, an
  amount or an organization — the action signatures don't accept them;
- webhook signatures are verified in constant time against the raw body, and
  a bad signature is 401;
- no payment status is ever taken from the browser.

**Reconciliation:**
- for every `SUCCESS` attempt, the chain in 10.4 resolves end to end;
- an unmatched Paystack transaction is surfaced for 11.6, never dropped.

**No confirmed payment is ever unattributed.**

**Historical data:**
- a Squad-paid order still shows, exports and refunds manually;
- no migration deletes or alters Squad rows.

### 10.13 Implementation notes — fill in as built

**The architecture, in one paragraph.** MansaaS does not operate a merchant
wallet or a merchant payout system. Paystack processes shopper payments on the
platform's integration and settles each one to the merchant's subaccount and
settlement account, less Paystack's fee, which the merchant bears. MansaaS takes
no commission on sales; it earns only the plan subscription. MansaaS keeps order,
payment,
refund, dispute and reconciliation records, and never represents merchant funds
as a balance the platform holds.

**Verified Paystack behaviour — desk check, 2026-09-29.** Paystack's docs
site refuses automated requests (HTTP 403), so this was checked against two
sources Paystack publishes itself:

- **PaystackOSS/openapi** — `dist/paystack.yaml` and `dist/marketplace.yaml`,
  last commit 2026-06-09;
- **PaystackOSS/doc-code-snippets** — the request and payload examples the docs
  pages render.

It was also checked against one Paystack support article,
support.paystack.com/en/articles/2132802 ("Transaction splits").

Each item is marked:

- **Confirmed** — both official sources agree.
- **Conflict** — official sources disagree, or an official and a third-party
  source disagree.
- **Unconfirmed** — no official source says; ask Paystack support or test in
  test mode.

**No payment code is written against a Conflict or an Unconfirmed item until it
is resolved.** The test-mode checks are listed under "Before 10.3 is coded"
below.

- **Test mode, checked against the real API on 2026-09-29** (these supersede
  anything below they contradict):
  - `POST /subaccount` accepts the bank code as **`settlement_bank` or
    `bank_code`** — both returned 201. The Conflict below is resolved; we send
    `settlement_bank`.
  - The response: `subaccount_code`, `settlement_bank` as the bank's NAME,
    `percentage_charge: 0` as sent, `active: true`, `is_verified: false`,
    `settlement_schedule: "AUTO"`, `account_name` as resolved. `metadata`,
    sent as a JSON string, comes back **as an object**.
  - **Paystack creates a second subaccount for the same bank account without
    complaint.** Duplicate prevention is entirely ours (10.3).
  - `PUT /subaccount/{code} { active: false }` deactivates; `GET` reflects it.
  - `GET /subaccount` pages with `meta.pageCount`, and `metadata` is an object
    there too.
  - **Test-mode limits:** `/bank/resolve` allows 3 real-bank lookups a day
    ("Use test bank codes 001"). Code `001` resolves `0000000000` as
    "TEST ACCOUNT", but a subaccount **can't** be created with `001`.
    **Zenith (`057`) + `0000000000`** both resolves (as "Test") and creates a
    subaccount. Use that pair when testing.
  - An account Paystack can't resolve fails creation with 400 "Account
    details are invalid", including the docs' own example account in test
    mode.
- **Subaccount creation and update:**
  - **Confirmed:**
    - `POST /subaccount` requires `business_name`, a bank code,
      `account_number` and `percentage_charge`. Optional fields are
      `description`, `primary_contact_email` / `_name` / `_phone`, and
      `metadata` (a stringified JSON string, not an object).
    - `PUT /subaccount/{code}` takes the same fields plus `active`, so a
      subaccount can be deactivated.
    - `GET /subaccount` lists with `perPage`, `page` and an `active` filter.
      **There is no search by business name or metadata**, so 10.3's "look the
      merchant up before creating again" must page through the list and
      match on `metadata`. Better still, never lose the code: store it in the
      same transaction as the claim, and treat a timeout as "fetch and match"
      before any retry.
    - The response carries `subaccount_code` (`ACCT_…`), `account_name`
      (resolved by Paystack), `settlement_bank` (as a bank name),
      `is_verified`, `active` and `settlement_schedule` (`"AUTO"` in the
      example).
  - **Conflict:** the API reference names the bank field `settlement_bank`,
    while the docs guide's snippet sends `bank_code`. Test which one the API
    accepts.
  - **Unconfirmed:** what `is_verified` means (Paystack's own check of the
    account?), and what the `settlement_schedule` values are and whether they
    can be set. 10.3 caches `is_verified` and `active` as Paystack's state and
    doesn't reinterpret them.
- **Transaction parameters for "the merchant gets everything, less the fee":**
  - **Confirmed:**
    - `POST /transaction/initialize` takes `subaccount`, `transaction_charge`
      ("A flat fee to charge the subaccount for a transaction. This overrides
      the split percentage set when the subaccount was created") and `bearer`
      (`account` | `subaccount`), plus `reference`, `callback_url`, `metadata`
      (an object), `channels` and `currency`.
    - The docs guide's own "bearer" snippet sends
      `subaccount` + `bearer: "subaccount"`.
  - **Confirmed, and it changes the design:** the support article says that
    with a single subaccount, "the transaction fee is automatically charged to
    the main account". **Leaving `bearer` out means the platform pays every
    shop's Paystack fee.** `bearer: "subaccount"` is mandatory on every
    storefront transaction, and a test asserts it.
  - **Conflict — critical:** which side `percentage_charge` pays.
    - The docs guide describes it as the main account's cut.
    - A widely read third-party guide (mctaba.com) treats it as the
      subaccount's share, which would make 0 send everything to the platform.
    - The API reference's own description of the field is a copy-paste error
      ("Customer's phone number").

    **Design consequence:** don't rely on `percentage_charge` alone. Create the
    subaccount with `percentage_charge: 0` **and** send
    `transaction_charge: 0` on every transaction. That is the flat amount
    taken *from the subaccount*, and it overrides the percentage whatever the
    percentage means.
  - **Unconfirmed:** that an explicit `transaction_charge: 0` is honoured
    rather than ignored as "not set". Resolve with a test-mode transaction
    before 10.4 ships, and keep the reconcile check (a non-zero platform share
    becomes `MISMATCH`, 10.4) as the permanent guard.
  - **Unconfirmed:** the verify response has `subaccount`, `split`, `fees`,
    `fees_split` and `requested_amount` fields, but the spec leaves `subaccount`
    and `split` untyped and `fees_split` null. Which field reports the
    subaccount's settled share must be read from a real test-mode
    transaction.
- **Multi-split (`/split`)** (for the record, not built): split groups have a
  `type` (`percentage` | `flat`), `subaccounts` with shares, and a
  `bearer_type` (`subaccount` | `account` | `all-proportional` | `all`).
  Transactions take a `split_code` or an inline `split` object. Confirmed from
  the spec.
- **Settlement:**
  - **Confirmed:** `GET /settlement` (paged) and
    `GET /settlement/{id}/transactions` exist.
  - **Unconfirmed:**
    - whether settlements can be listed per subaccount — the spec shows no
      `subaccount` filter;
    - settlement timing per subaccount.

    10.6 shows settlement status only if a per-subaccount source is found;
    otherwise it says Paystack settles on its own schedule (as 10.6 already
    allows).
- **Refunds:**
  - **Confirmed:**
    - `POST /refund` takes `transaction` (the reference) and an optional
      `amount`, which "cannot be more than the original transaction amount".
      **Partial refunds are supported.** It also takes `customer_note` and
      `merchant_note`.
    - A new refund comes back `"pending"`, with `expected_at`,
      `deducted_amount` and `fully_deducted`.
    - Statuses and webhook events: `refund.pending`, `refund.processing`,
      `refund.processed`, `refund.failed` and **`refund.needs-attention`**.
      The last one is retried through
      `POST /refund/retry_with_customer_details/{id}` with the customer's
      bank details.
    - Refund events carry `transaction_reference` and `refund_reference`.

    For 10.7, this confirms the lifecycle:
    - `PROCESSING` covers pending and processing;
    - `REFUNDED` is set only on `processed`;
    - `FAILED` covers failed;
    - add **`NEEDS_ATTENTION`**, which asks the merchant for the customer's
      bank details.
  - **Conflict / unconfirmed — parked while 10.7 is paused:** who pays for a refund on a
    subaccount transaction.
    - The third-party guide states that the refund comes from the **main
      account's balance** and that "the subaccount's share is not automatically
      clawed back". After settlement, it is taken from the main account's next
      settlement.
    - The `deducted_amount` / `fully_deducted` fields fit a balance being
      debited, but don't say whose.
    - No official source was found either way.

    **If the third-party guide is right, every Paystack refund is paid by the
    platform, which earns nothing from the sale (10.1).** Get Paystack's
    written answer before 10.7 is built.
    - If the platform's balance is debited, 10.7 changes. Either online
      refunds become merchant-sent and recorded (like transfers today), or
      Paystack offers a way to debit the subaccount.
    - Record the answer here and in 10.10's terms.
- **Disputes and chargebacks:**
  - **Confirmed:**
    - the events are `charge.dispute.create`, `charge.dispute.remind` and
      `charge.dispute.resolve`;
    - the payload carries `refund_amount`, `status`
      (`awaiting-merchant-feedback` | `awaiting-bank-feedback` | `pending` |
      `resolved`), `resolution` (`merchant-accepted` | `declined`), `dueAt`,
      `category` (e.g. `chargeback`), `messages` and the full `transaction`
      (with its `reference`, so it can be matched to an `OrderPayment`);
    - the API has `GET /dispute`, `GET /dispute/{id}`,
      `PUT /dispute/{id}/resolve` and `POST /dispute/{id}/evidence`.
  - **Unconfirmed — and still live, since chargebacks happen whether or not we
    offer refunds:** whose balance a lost dispute on a subaccount transaction
    is taken from. Ask Paystack (question 1 below).
- **Webhooks:**
  - **Confirmed:**
    - `x-paystack-signature` is a hex HMAC-SHA512 of the raw body, keyed with
      the secret key. Paystack's own snippet compares with `==`; ours uses a
      constant-time compare (10.5).
    - Events arrive as `{ event, data }`.
  - **Confirmed:** there are **no subaccount events** in Paystack's event
    list. Subaccount state (`active`, `is_verified`) is synced by fetching
    `GET /subaccount/{code}` — on the merchant's payment settings page load,
    on each payment start, and from the platform console — not by webhook.
  - **Unconfirmed:** that an integration has exactly one webhook URL.
    **No longer matters:** both `/api/payments/paystack/webhook` and
    `/api/billing/paystack/webhook` serve the same shared handler (10.5), so
    whichever one the dashboard names receives everything.
- **Banks:**
  - **Confirmed:**
    - `GET /bank?currency=NGN` lists Paystack's bank codes (the codes the
      subaccount takes; the docs example uses "058").
    - **`include_nip_sort_code=true` also returns each bank's NIP code**, so
      the NIP-coded `lib/payments/nigerian-banks.ts` can be mapped to Paystack
      codes rather than retyped (10.9).
    - `GET /bank/resolve?account_number&bank_code` resolves the account name
      and replaces Squad's lookup.
- **Merchant verification requirements Paystack imposes on subaccounts:**
  **Answered from Paystack's own dashboard (2026-09-29, seen by the owner).**
  The dashboard's "create subaccount" form asks only for: currency (NGN), bank,
  account number, subaccount name (prefilled with the resolved account name),
  an optional alias, and the transaction split ("your share %" / "subaccount
  gets %"). So **Paystack asks for no KYC on a subaccount**, and CAC, ID and
  proof of address are purely OUR verification (10.2 list B, 10.8). The split
  labelled "your share" also suggests `percentage_charge` is the MAIN
  account's share, which resolves the Conflict above in favour of the docs
  guide. Still send `transaction_charge: 0`, and confirm with the test-mode
  check. The old note follows:
  **Unconfirmed (superseded).** The create call needs only the fields above; the support
  article says nothing more. Ask Paystack whether a subaccount needs KYC of
  its own, and what `is_verified` gates.
- **Cloudinary private delivery for documents:** not yet checked. Check it
  before 10.8's upload work.

**Before 10.3 is coded — the test-mode checks** (needs the platform's Paystack
**test** secret key, and a short manual session):

1. Create a subaccount sending `settlement_bank`, and again sending
   `bank_code`. Record which one works.
2. Initialise ₦10,000 with `subaccount`, `transaction_charge: 0` and
   `bearer: "subaccount"`, and pay it with a test card. From the verify
   response and the dashboard, record:
   - the subaccount's share;
   - the main account's share (**must be 0**);
   - who paid the fee;
   - which response fields carry each.
3. Repeat step 2 without `transaction_charge`, with `percentage_charge: 0` on
   the subaccount, to settle what `percentage_charge` means.
4. ~~Refund part of the transaction from step 2, and record which balance
   Paystack debits.~~ Paused with 10.7.

**Questions to put to Paystack support, in writing** (they block 10.10's
chargeback wording and the launch):

1. On a subaccount transaction where the main account's share is zero and the
   subaccount bears the fee, whose balance pays a **lost chargeback**, before
   and after the subaccount has been settled? This still matters with refunds
   paused: chargebacks are raised by the customer's bank, not by us.
2. Can a chargeback loss be debited from the subaccount's future settlements
   instead?
3. Does a subaccount need its own KYC, and what does `is_verified` mean?
4. Can settlements be listed or reported per subaccount?

The earlier questions on refund liability are **parked with 10.7**. Quarterly
billing was dropped in favour of the intervals Paystack does list (12.1).

## Phase 11 — Platform console — TODO

The gap: there is no platform-side admin at all — no super-admin role, no screen,
and `OrganizationStatus.SUSPENDED` exists in the schema but nothing enforces it.
Custom domain orders end in an email to `PLATFORM_ADMIN_EMAIL` and are finished by
hand in the database.

- **11.0 Console shell — DONE (2026-09-29).** Added before 11.7 so the
  console's later pages have a frame to go into.
  - `components/platform/console-shell.tsx`: a sidebar grouped by job
    (Overview; *Merchants* → Verification), with the staff member's name and
    sign-out at its foot. Below `lg` a top bar opens the same navigation in a
    `Sheet` drawer (focus trapped, closes on Escape and after navigating). It
    borrows the admin's tokens and sidebar colours, not the merchant sidebar,
    which is built around a workspace.
  - Verification shows a count of submissions waiting beside it.
  - **Only pages that exist are listed** (AGENTS §7). Each console phase adds
    its own entry to `NAV` in that file: 11.7 *Billing* → Plans and pricing;
    11.2/11.4 *Merchants* → Merchants; 11.5 *Operations* → Domain queue;
    11.6 *Billing* → Payments.
  - `/platform` is now an **Overview** (`features/platform/overview.ts`)
    instead of a redirect: a "needs attention" callout for verification
    (with the oldest submission's age and a "Review now" link), and active
    workspaces by plan state (paying, trial, grace, closed, and "no
    subscription" for pre-12.1 test data), new this week and suspended. The
    states use the same rule as the merchant's dashboard, but looking never
    records a lapse. The workspace figures gain links when 11.2's merchant
    list exists.
  - Test: `tests/platform-overview.test.ts` (staff only; each state counted
    once; suspended counted apart; the pending count; no lapse recorded).

- **11.1 Access — DONE (2026-09-29).**
  - `User.isPlatformStaff` (migration `20260929150000_platform_staff`) is
    granted and revoked only by `npx tsx prisma/platform-staff.ts
    grant|revoke <email>` (and `list`), never from a screen.
  - It is read fresh from the database on every request
    (`lib/platform-staff.ts`), so revoking works at once. A test covers this.
  - The console is `/platform` on the platform host: `proxy.ts` adds it to
    `AUTH_ONLY_PREFIXES`, so a session is required, and `app/platform/layout.tsx`
    answers non-staff with a plain 404.
  - `platform` is now a reserved shop address. No existing shop used it.
  - Platform decisions are written to the MERCHANT's audit log with the
    staff member's id. `features/settings/activity.ts` shows `platform.*`
    entries as the platform, never as a stranger's name and personal email.
  - No impersonation, as planned.
  - **To use it:** sign up normally, then run the grant command for that
    email.

  The original plan: A platform-staff flag on `User` (not a `Role` — roles belong to
  one organization) and its own host or path, outside every tenant. Every
  platform action is written to the audit log with the staff member's id. No
  "log in as the merchant" in the first version, because impersonation needs its
  own consent and audit design.
- **11.2 Merchants — DONE (2026-09-29).** As shipped:
  - `/platform/merchants` (sidebar → *Merchants*): every workspace newest
    first, with tabs All / Active / Suspended (counts), a plan-state filter
    (Paying, Free trial, In grace, Closed, No subscription) and search by
    name, web address or any member's email — all in the URL, paginated
    (25). Columns: merchant (web address, owner email, "Suspended" badge),
    plan state + plan name, online-payments verification, stores, orders
    this month (every channel, less cancelled), online takings this month
    (successful `OrderPayment`s by `verifiedAt`, before Paystack's fee),
    joined. A line under the toolbar says what the two figures count.
  - `/platform/merchants/[organizationId]`: back link, name, Active /
    Suspended and plan-state badges, "Payment details" (→ the verification
    case) and Suspend / Restore. A summary (shop link, dashboard address,
    plan with price and next date, verification, joined, customer contact),
    figures (stores, products, orders this month, takings this month, orders
    all time), members, billing history (`BillingTransaction`, 50 newest),
    domain orders, and the suspension history.
  - The plan state is `resolveAccess` (12.1), not a column, so the list
    reads the cheap columns for every matching workspace, filters by state,
    then loads stores/orders/takings/owners for the one page shown
    (`features/platform/merchants.ts`). Fine to thousands of workspaces;
    past that it wants a stored state. Nothing here records a lapse.
  - The Overview's workspace figures now open this list, filtered to what
    they count, and it gained a *Suspended* figure.
- **11.3 Verification queue — DONE (2026-09-29).**
  - `/platform/verification`: tabs for Waiting / Sent back / Approved / All,
    with counts; waiting cases oldest first. Search by business name, shop
    name or web address. Filters live in the URL and are paginated.
  - `/platform/verification/[organizationId]`:
    - the business facts and documents, each opened through a 5-minute signed
      link that only works under the business it belongs to;
    - the settlement account with the Paystack-resolved name;
    - the payments contact and the history;
    - Approve (AlertDialog, which warns if a document is missing) and Send back
      (a reason dialog).
  - **Not built:** telling platform staff that a new submission arrived — for
    now someone checks the queue. An email to `PLATFORM_ADMIN_EMAIL` on submit
    is the obvious next step.

  The original plan: Review 10.8 submissions (our verification, not
  Paystack's subaccount state), viewing documents through short-lived signed
  URLs only: approve, or reject with a reason the merchant sees. **Approving
  creates the merchant's Paystack subaccount** (10.3), and the result — active,
  or the Paystack error — shows on the same screen.
- **11.4 Suspend and restore — DONE (2026-09-29).** As shipped:
  - **Enforced in `proxy.ts`**, for every page, server action and data
    request: `getOrgStatus(slug)` (`lib/tenant/org-status.ts`, cached 15 s per
    slug per instance; custom domains and the mobile `/s/{slug}` path read
    it in their own lookup) —
    - a suspended **admin** is rewritten to `/unavailable/workspace`. A
      member sees the workspace name, the date, the reason staff wrote, that
      nothing is deleted, who to write to (`PLATFORM_SUPPORT_EMAIL`, falling
      back to `PLATFORM_ADMIN_EMAIL`), their other workspaces, and sign out.
      A signed-in non-member sees only "This workspace is unavailable";
    - a suspended **storefront** is rewritten to its root, where the layout
      renders "{shop} is unavailable" and nothing else — a POST (server
      action) lands there too and fails. Shoppers aren't told why;
    - `DELETED` redirects to the platform, as an unknown shop does.
    The data layer's own `status: 'ACTIVE'` filters (org context, catalogue,
    `placeOrder` → `store-unavailable`) cover the seconds before the cache
    turns over. Checked over HTTP against a production build: a suspended
    shop's root and deep links, a POST, the member and non-member admin
    pages, and a normal shop unaffected.
  - `Organization.suspendedAt` + `suspensionReason` (migration
    `20260930140000_organization_suspension`), cleared on restore.
  - **Suspend** needs a reason (10–1,000 characters) the merchant will read,
    in an AlertDialog that states the consequence; **Restore** has its own.
    Each is a conditional update (a double click or two staff can't
    double-apply), writes `platform.organization.suspended` / `.restored`
    to the **merchant's** AuditLog (they see it in Settings → Activity) with
    the reason, and emails the owners (`emails/workspace-suspension.tsx`,
    reply-to the support address).
  - The signed-in `/` redirect falls back to a suspended workspace rather
    than onboarding, so a suspended owner lands on the explanation, not on
    "create a shop". The workspace switcher hides deleted workspaces.
  - `unavailable` is a reserved slug.
  - **Not done, deliberately:** suspension doesn't cancel the plan — Paystack
    keeps renewing a monthly plan while suspended (the dialog says so).
    Decide whether a long suspension should pause billing. `DELETED`'s
    retention is 13.8.
  - Tests: `tests/platform-merchants.test.ts` (staff only; search by name,
    email, web address; figures; plan filter; detail; reason required;
    suspend → status, cache, audit, email, `placeOrder` refused, listed as
    suspended, history; double-suspend refused; restore → cleared, audit,
    email; double-restore refused) and `lib/tenant/reserved-slugs.test.ts`.
- **11.5 Domain orders — DONE (2026-09-30).** As shipped:
  - **`/platform/domains`** (console sidebar → *Operations* → Domains, with
    a waiting count): tabs Waiting / Done / Failed / All; waiting work
    oldest first with "Nh left" / "Nh overdue" against 24 hours, counted
    from `DomainOrder.readyAt` (payment confirmed, or a connected domain's
    records found). Only paid (or free connect) work appears — an order
    whose checkout was never paid doesn't.
  - **Renewals due**: registered domains expiring within 14 days or
    expired-but-renewable, marked "Paid — renew at Namecheap" or "Not
    renewed by merchant". **Namecheap balance** (added 2026-09-30): read
    **live** from Namecheap's API (`namecheap.users.getBalances`, read-only,
    cached a minute — `getAccountBalance` in `lib/domains/namecheap.ts`),
    next to **what the waiting work will cost** (the quoted `usdPrice` of
    paid registrations and renewals not yet done at Namecheap), with a
    "top up at least $X" warning when it isn't enough. If Namecheap can't be
    reached (credentials, or the server's IP not whitelisted), the reason is
    shown and the last hand-entered figure stands in (audited in
    `PlatformAuditLog`).
  - **`/platform/domains/[orderId]`**: the checklist for its kind
    (`STEPS_FOR`/`STEP_INFO` in `lib/domains/rules.ts` — register: register
    at Namecheap with the merchant as registrant + record expiry, DNS, add
    both hostnames at the host, check https; connect: DNS (auto-ticked by
    the merchant's check; "Check DNS now"), host, https; renew: renew +
    record the new expiry), the registrant (business name and payments
    contact from 10.2, else the owner), the DNS records with copy buttons,
    and **Mark live / Mark renewed** (refused until every step is ticked;
    routes the shop, stores the expiry, emails the owners and payments
    contact), **Mark failed** (a reason the merchant sees, emailed), and
    **Record refund** (amount ≤ paid + Paystack reference, for a failed paid
    order — refunds are done in Paystack's dashboard). Each decision is on
    the merchant's AuditLog (`platform.domain.*`).
  - The `PLATFORM_ADMIN_EMAIL` alert stays as the nudge and now links to
    the queue; a morning digest of renewals due goes there too (below).

  The original brief: A queue of paid domain work, oldest first, each with the
  **time left against the 24-hour promise**. The kinds of work:
  - **register** a new domain;
  - **connect** a domain the merchant already owns;
  - **renew** an expiring one.

  Each order opens a checklist of the exact steps for its kind: register at
  Namecheap with the merchant as registrant; set the DNS records; add both
  hostnames at the host so the certificate is issued; check that
  `https://` loads. Staff record the Namecheap expiry date as they go.
  - **Mark live** sets the shop's storefront domain (12.6: the apex and
    `www`, one canonical), stores the expiry date, and emails the merchant.
  - **Mark failed** records a reason the merchant sees. A registration that
    can't be done after payment is refunded by staff in Paystack's dashboard
    (platform billing money — not the paused storefront refunds, 10.7), and
    the refund is recorded on the order.
  - **Every morning, a list of domains** expiring within 14 days that the
    merchant has renewed but staff haven't yet renewed at Namecheap, and
    those the merchant hasn't renewed.
  - Staff see the Namecheap account's balance as a reminder to keep it
    funded. It is entered by hand, since there's no API until 13.5.
  - Replaces today's email to `PLATFORM_ADMIN_EMAIL` as the only record,
    though the email stays as the alert.
- **11.6 Payments — DONE (2026-09-30).** As shipped: **Console →
  Operations → Payments** (`/platform/payments`, `features/platform/payments.ts`),
  badge = everything needing a human (not stuck payments, which are mostly
  abandoned checkouts), and the Overview's "Needs attention" lists each kind
  with a link. Tabs, each with a line saying what it is:
  - **Mismatched**: `OrderPayment` `MISMATCH` — Paystack says paid but for a
    different amount/currency, to a different subaccount, or with a
    platform share — showing asked-for vs reported. **Mark reviewed** with a
    note (`reviewedAt/ById/Note`; the money and order don't change).
  - **Unmatched**: new `UnmatchedPayment` — the webhook now records a
    `charge.success` whose reference is neither a storefront attempt nor a
    subscription checkout, and isn't a renewal (Paystack sends renewals with
    the plan), and any dispute on a reference we never issued; one row per
    (kind, reference); the shop is named when the subaccount is ours.
    **Mark dealt with** with a note. Nothing is credited.
  - **Disputes**: open `PaymentDispute`s, soonest deadline first
    (responses happen in Paystack's dashboard).
  - **Payout setup**: `ACTION_REQUIRED` / `DISABLED` accounts with Paystack's
    reason, **Retry creating subaccount** and **Check with Paystack** (the
    verification queue's actions), and a link to the case.
  - **Stuck**: attempts still `PENDING` past the one-hour hold, last 30
    days. **Check with Paystack** (one, or all on the page) —
    `recheckPaymentForStaff`: settles exactly as the webhook would, and an
    attempt Paystack has NO record of, past the hold, is closed
    `ABANDONED`; one Paystack knows about is never closed.
  - Migration `20260930200000_payment_review`. Tests:
    `tests/platform-payments.test.ts` (unknown charge recorded once, renewal
    left to billing, dispute on nothing recorded; staff only; each list;
    stuck → paid / abandoned / left inside the hold; review and dealt-with
    notes); `tests/paystack-webhook.test.ts` updated.
  - Still no refund queue (10.7 paused) and no payout runs (Paystack settles).

  The original brief: Stuck payments (attempts that never confirmed),
  Paystack transactions that matched no attempt or the wrong subaccount (10.4),
  open disputes (10.5) — refunds are paused (10.7) — and
  subaccounts in `ACTION_REQUIRED` or `DISABLED` (10.3), with a "Retry
  creating subaccount" action. There are no payout runs to show — Paystack
  settles to merchants (10.1).
- **11.7 Plans and pricing — DONE (2026-09-29).** As shipped:
  - **Plans and pricing** (`/platform/plans`): the catalogue in merchants'
    order, with each cycle's price and discount, features, limits,
    workspaces on the plan, on sale or not, "Popular" and "Free trial plan"
    badges; up/down buttons reorder (the whole list is renumbered, so ties
    can't stall a move). "Recent changes" below lists the console's audit
    trail.
  - **The editor** (`/platform/plans/new`, `/platform/plans/[planId]`):
    details, price (monthly + 6-month and yearly discounts, with a table of
    what each cycle costs and works out to per month, before saving),
    features (built ones only, from `FEATURES`), limits (a number or
    unlimited). A new plan **starts off sale**; its key is made from the name
    once and never changes. At most one plan is "Popular" — marking one
    unmarks the rest.
  - **Rules enforced on the server** (`features/platform/plans.ts`,
    validation shared with the editor in `lib/billing/plan-edit.ts`):
    - a price change says it reaches new subscriptions and plan changes;
      current subscribers keep `Subscription.amount` and their Paystack plan;
    - removing a feature from a plan with workspaces returns
      `needsConfirmation` until the editor's AlertDialog (naming the count and
      the features) confirms; they lose it on their next request;
    - "Take off sale" (AlertDialog) keeps subscribers renewing; the free
      trial's plan can't be taken off sale or deleted;
    - **delete** exists only for a plan never subscribed to or charged — a
      mistake, not a retirement.
  - **Billing settings** (`/platform/settings`,
    `features/platform/billing-settings.ts`): trial length (0 = no trial) and
    plan (on-sale plans only), grace days (0–365), and naira per US dollar
    with a "$10 domain costs ₦…" preview. The screen says a trial change
    applies to new workspaces and a grace change to plans that end from now
    on. Saved together; one audit entry with only what changed.
  - **Audit:** a new `PlatformAuditLog` table (migration
    `20260930120000_platform_audit_log`) for changes that belong to no one
    merchant — `AuditLog` needs an organization. Written in the same
    transaction as the change, with `{ before, after }` (or `changes` and,
    on a reprice, every cycle's price before and after). Labels in
    `lib/platform-audit.ts`.
  - The console sidebar gained a *Billing* group: Plans and pricing, Billing
    settings.
  - Tests: `lib/billing/plan-edit.test.ts` (validation, prices, diffs, keys)
    and `tests/platform-plans.test.ts` (staff only; create off sale with
    prices and audit; field errors; reprice leaves a subscriber's amount;
    feature removal needs confirmation then applies; one Popular; reorder;
    on/off sale and the trial plan guard; delete only unused; settings saved
    with a changes-only audit; range and on-sale checks). It restores the
    shared catalogue and settings afterwards.
  - Save transactions get a 20-second timeout: against Neon a save is ~8
    sequential round trips, past Prisma's 5-second default.

  The original brief:
  - create, rename, reorder, highlight, hide or retire plans;
  - set the monthly price, and the twice-yearly and yearly discounts, with the
    resulting price per cycle shown before saving;
  - tick which features (from the code registry, built ones only) and set
    which limits each plan includes;
  - set the **free trial**: its length in days, and which plan it gives (12.1);
  - set the **grace period**: how many days a lapsed workspace's storefront
    keeps taking orders — 10 by default, and 0 is allowed (12.1). The screen
    says a change applies to subscriptions that lapse after it.

  The rules:
  - Saving a price change says it applies to new subscriptions and plan
    changes, not to current subscribers (12.1).
  - Removing a feature from a plan shows how many workspaces lose it, and asks
    for confirmation.
  - Every change is written to the audit log with before and after.
  - Only platform staff can reach it.

## Phase 12 — Ready for a first merchant — DONE (2026-09-30), see each part

The gap: things a new merchant would hit in their first hour.

- **12.1 Plans, prices and billing cycles — DONE (2026-09-29).** As shipped
  (the decisions and the design it follows are kept below):
  - **The catalogue is in the database.** `BillingPlan` (key, name, tagline,
    monthly price, highlighted, sort order, `isOnSale`, `maxSeats`,
    `maxWarehouses`), `BillingPlanPrice` (a row per plan and cycle: discount %
    and the resulting amount) and `BillingPlanFeature`. Seeded by migration
    `20260930090000_plan_catalogue`: **Starter ₦5,000/month** (10 members,
    1 store), **Pro ₦45,000** (highlighted), **Enterprise ₦150,000**; every
    plan **10% off every 6 months, 17% off yearly**. `api.access` is not sold.
    `Organization.plan` and the `OrganizationPlan` enum are gone;
    `Subscription.planId` points at the catalogue, and
    `BillingTransaction` keeps `planId` + `planName` as a snapshot.
  - **Rules in code, rows in the database.** `lib/billing/plans.ts` (pure):
    `FEATURES`/`FEATURE_INFO` (label, description, built), `LIMIT_INFO`,
    `CYCLES` (months, label, Paystack interval), `cyclePrice`, `periodEnd`
    (a month-end start ends on the shorter month's last day), `NO_PLAN`.
    `lib/billing/catalogue.ts` reads the rows: `listPlansForSale`,
    `priceForCheckout` (on-sale plans only, priced on the server),
    `loadEffectivePlan` (cached per request).
  - **Access is one pure rule**, `lib/billing/access.ts`: `trial | active |
    grace | lapsed | none`. A renewing plan gets 3 days for Paystack's renewal
    to arrive; a cancelled or past-due one ends with its paid period.
    `entitlementsFor(orgId)` applies it and **records the lapse the first
    time it's seen** (`lapsedAt` + `graceEndsAt`, a claimed `updateMany`), so
    the grace setting at that moment is fixed for that merchant. Grace counts
    from when access ended, not from when someone looked.
  - **Trial at signup, no card.** `startWorkspaceSubscription`
    (`lib/billing/trial.ts`) runs inside `bootstrapOrganization`: a
    `TRIALING` subscription on the trial plan for the trial days. An owner who
    already had a trial on any workspace gets none: the new workspace starts
    `INCOMPLETE`, lapsed, with no grace (nothing to lapse from). Defaults, in
    `PlatformSetting` via `getBillingSettings()` until 11.7 adds the screen:
    **14-day trial of Pro, 10 days' grace**.
  - **Lapsed means:** the storefront layout shows "{shop} is closed for now"
    (not an error), and `placeOrder` refuses with `store-closed` — the check
    that counts. The dashboard shows `PlanEndedPage` for everything except
    Settings → Billing, `/upgrade` and existing orders (`isOpenWhileLapsed`;
    `/sales/orders/new` stays closed). `proxy.ts` passes the admin path as
    `x-admin-path` for this. During a trial or grace a banner (`PlanNotice`)
    gives the days left, with "Choose a plan" one click away for anyone who
    can manage billing. The sidebar badge and workspace switcher show the plan
    ("Pro · Trial", "Plan ended").
  - **Paying reopens at once.** `applySuccessfulCharge` sets the plan, its
    cycle and price, and clears any lapse; a renewal does the same. On a plan
    change the previous Paystack subscription is disabled after the new one is
    created, and its code is forgotten first so its "disabled" webhook can't
    cancel the new plan. `subscription.disable` now only marks the
    subscription cancelled — there is no fall back to a plan.
  - **Paystack plans are keyed by (plan, cycle, amount)** in
    `BillingPlanCode`: a new price creates a new Paystack plan; existing
    subscribers keep renewing at theirs. A retired plan (`isOnSale: false`)
    can't be bought but keeps its subscribers.
  - **Screens:** `/upgrade` shows the cycles on sale (Monthly / Every 6
    months / Yearly, "Save N%"), the monthly equivalent, the built features
    and the limits, all from the catalogue; "Current plan" only for the plan
    and cycle actually being paid for. Settings → Billing names the plan and
    what it means now (trial end, grace deadline, renewal date and amount),
    and cancel appears only for a paid plan.
  - **Tests:** `lib/billing/access.test.ts` (states, tolerance, grace 0,
    recorded deadline, what stays open, cycle prices, period ends, labels) and
    `tests/billing-plans.test.ts` (trial at signup and none for a second
    workspace, lapse recorded once, shop selling through grace then refusing
    orders, payment reopening, a removed feature closing on the next request,
    a new price → a new Paystack plan, a retired plan keeping subscribers).
    `tests/helpers/plans.ts` gives test workspaces a plan (`givePlan`) and
    removes billing rows (`dropBilling`; billing rows don't cascade).
  - **Dev data:** workspaces without a subscription (old Free test orgs)
    resolve to `none` — not locked, no features. `pynacode`'s Enterprise
    period ended on 2026-09-02, so it is **lapsed**; buy a plan with a
    Paystack test card to reopen it.
  - **Left for 11.7:** editing plans, prices, features, trial and grace in the
    console. The domain step in `/upgrade` is unchanged until 12.6.

  **The original decision and design:**

  **The decisions:**
  - **There is no free plan.** Every workspace is on a paid plan.
  - Plans bill **monthly, twice-yearly (every 6 months) or yearly** — the
    intervals Paystack's plan API offers (`monthly`, `biannually`,
    `annually`). Quarterly was dropped on 2026-09-29 because Paystack lists no
    such interval. Twice-yearly and yearly each carry a discount on the monthly
    price.
  - The cheapest plan starts at **₦5,000 per month**.
  - **Everything is configurable by platform staff in the platform console**
    (11.7): the plans, their names and prices, each cycle's discount, which
    features each plan includes, and its limits.
  - The platform's only income is these subscriptions — no commission on sales
    (10.1).

  **What the code does today, and why it must change:**
  - Plans are a Prisma enum, `OrganizationPlan` (`FREE | STARTER | PRO |
    ENTERPRISE`), used on `Organization.plan`, `Subscription.plan`,
    `BillingPlanCode` and `BillingTransaction`.
  - Prices, features and limits are TypeScript constants in `PLANS`
    (`lib/billing/plans.ts`), so none of it can be edited from a console.
  - `BillingCycle` is `MONTHLY | YEARLY` only. The yearly price is hard-coded as
    ten months (`getYearlyPrice`).
  - **Free is load-bearing:**
    - it is the column default;
    - a lapsed subscription falls back to it — lazily in
      `getOrganizationEntitlements`, and on `subscription.disable` in the
      Paystack webhook;
    - `/upgrade`, `PricingCards`, Settings → Billing and `cancelSubscription`
      all branch on `'FREE'`.

  **The build:**
  - **Plans move into the database.**
    - `BillingPlan`: key, name, tagline, monthly price, highlighted, sort
      order, active or retired.
    - The price per cycle, either as a row per plan and cycle or as columns.
      Each cycle holds its discount percentage and the resulting amount, shown
      to the merchant as the price and as "save N%".
    - Its features: the plan↔feature rows.
    - Its limits: seats and stores.
    - `Organization`, `Subscription` and `BillingTransaction` point at a plan
      id instead of the enum.
    - `BillingTransaction` also keeps a snapshot of the plan name, cycle and
      amount charged, so history reads correctly after a plan is renamed or
      repriced.
  - **Feature keys stay in code.** A feature is something the code gates on, so
    `FEATURES` remains the registry. The console only chooses which plans
    include which features; it cannot invent one. Each registry entry has a
    label, a one-line description for the pricing page, and whether it is
    **built** — `API_ACCESS` and TikTok are not (12.4), and the console won't
    let an unbuilt feature be sold. Limit keys work the same way. `maxProjects`
    goes with the Projects page.
  - **Gating keeps its call sites.** About 50 files use `hasFeature`,
    `requireFeature`, `getPlanLimit` or the `FEATURES` keys. They keep the same
    functions; only the source changes:
    - `getOrganizationEntitlements` loads the org's plan, features and limits
      once per request (it is already `cache`d);
    - `planHasFeature` and `getPlanLimit` read that instead of `PLANS`;
    - `PLAN_ORDER` / `isPlanAtLeast` become the plan's sort order.
  - **Twice-yearly.** Add a six-month cycle to `BillingCycle` (e.g.
    `BIANNUAL`), mapped to Paystack's `biannually` plan interval, as `YEARLY`
    maps to `annually` in `ensurePaystackPlan`. The period end is +6 months, in
    both `apply-charge.ts` and the renewal branch of the Paystack webhook,
    which today treats anything not `YEARLY` as a month. The screens call it
    "Every 6 months", never "biannual", which people read both ways.
  - **Price changes and Paystack plans.**
    - `ensurePaystackPlan` caches one Paystack plan per (plan, cycle) in
      `BillingPlanCode`. Once a price can change, that key is wrong: cache per
      (plan, cycle, amount) and create a new Paystack plan when the amount
      changes.
    - **Existing subscribers keep their price until they change plan or
      cycle.** Changing a price in the console must say so. Verify whether
      Paystack can move existing subscriptions to a new amount, and don't use
      that without a deliberate decision to reprice everyone.
  - **Retiring a plan.** A plan with subscribers can be hidden from sale but
    not deleted. Its subscribers renew on it until they change plan.
  - **No free plan means "no plan" is a real state.** Decided 2026-09-29:
    - **Free trial at signup.** A new workspace starts on a trial of a paid
      plan for a number of days.
      - Both the **trial length** and **which plan the trial gives** are set in
        the console (11.7).
      - The code has no trial today, so this needs a `TRIALING` subscription
        status with `trialEndsAt`.
      - One trial per workspace, and a workspace created only to restart a
        trial is not given another. Decide how that is detected; the owner's
        user account is the obvious key.
      - The dashboard shows the days left, and "Choose a plan" is always one
        click away.
      - **No card is taken to start a trial.** The merchant pays when they
        choose a plan, through the existing Paystack checkout.
    - **Lapsing.** A subscription lapses when:
      - it was cancelled and its period has ended;
      - renewals keep failing (`PAST_DUE`, after Paystack's retries — verify
        when Paystack gives up);
      - a trial ends without a plan being bought.

      Then **the storefront keeps taking orders for a grace period, 10 days by
      default**:
      - the grace period is set in the console (11.7), and **0 is allowed**,
        meaning the storefront closes the moment the subscription lapses;
      - it is one platform-wide number, read at the moment of lapse and stored
        on the subscription (`graceEndsAt`), so changing the setting later
        doesn't move a merchant's deadline;
      - after it, the storefront shows a closed page — not an error — and
        takes no orders. Nothing is deleted, and buying a plan reopens it at
        once;
      - all of this replaces today's silent fall back to `'FREE'`, in
        `getOrganizationEntitlements` and in the `subscription.disable` branch
        of the Paystack webhook.
    - **The admin while lapsed:**
      - during grace, everything works, under a banner giving the days left;
      - after grace, the admin opens only to billing, and to reading and
        finishing orders already placed — dispatch, delivery, refunds —
        because those customers have paid;
      - it never locks the owner out of paying.

      Suspension (11.4) is separate, set by platform staff, and closes both
      the admin and the storefront.
    - **Existing workspaces on `FREE` are test data** and will be deleted before
      launch. **No migration or fallback is built for them.** Once they're gone,
      `FREE` is removed from the schema outright.
  - **Screens that read the catalogue:** `/upgrade` (`PricingCards`,
    `CheckoutSummaryStep`, `UpgradeWizard`), Settings → Billing, the public
    pricing page (12.3), and onboarding. Each shows the three cycles (monthly,
    every 6 months, yearly), with the saving named against paying monthly. None hard-codes a plan name, a price
    or "Free".
  - **Tests:**
    - each cycle's price and period end;
    - a console price change leaving current subscribers' charge unchanged and
      creating a new Paystack plan;
    - a feature removed from a plan closing its pages on the next request;
    - a retired plan still renewing;
    - a new workspace starting a trial of the console's plan and length, and
      a second workspace by the same owner not getting another;
    - a lapsed workspace's storefront taking orders until `graceEndsAt` and
      refusing them after, with grace 0 closing it immediately;
    - changing the grace setting not moving an existing `graceEndsAt`;
    - buying a plan reopening the storefront at once;
    - no code path that yields `'FREE'`.
- **12.2 One name — DONE (2026-09-30), with a working name.** **Notely** at
  `getnotely.io`, chosen by the owner "for now" while the final name is still
  being decided — so the point of the work is that renaming again is one edit.
  As shipped:
  - `lib/brand.ts`: `PLATFORM_NAME = 'Notely'`, `PLATFORM_DOMAIN`,
    `PLATFORM_OPERATOR` ("Pynacode") and its CAC registration line. Every
    surface people read takes the name from there: page titles, auth and
    onboarding screens, the console, platform emails, the social-commerce
    and payments wording that used to say "MansaaS" in the text, and the
    Terms and Privacy Policy (≈80 hard-coded mentions, now the constants;
    their canonical URLs too). AGENTS.md now says never to type the name.
  - The mobile app's **display name** is Notely (Capacitor config, Android
    strings, iOS `CFBundleDisplayName`, the offline page); its **id stays
    `com.mansaas.app`**.
  - **Deliberately not renamed** — identifiers nobody reads, where a change
    would break live data: browser storage keys (`mansaas:sf:…`, saved bags
    and consent), token issuers/audiences and the social-token key salt
    (would sign people out / make stored tokens unreadable), the Cloudinary
    folder (`mansaas/{org}/…`, existing images and ownership checks),
    billing references (`mansaas_…`), the subaccount metadata, the npm
    package name and the app id. Listed in `lib/brand.ts`.
  - New Paystack plan objects are named "Notely …"; existing ones keep their
    old name in Paystack's dashboard (they're keyed by price and reused).
  - **When the final name is chosen:** change `lib/brand.ts`, the four native
    display-name spots (see MOBILE.md), the legal pages' "Last updated"
    date, and the production hosts/env; nothing else.
- **12.3 A public front door — DONE (2026-09-30).** As shipped:
  - **`app/(marketing)/`** with its own header (Features, How it works,
    Pricing, Questions; Sign in; Start free trial; a menu on phones) and
    footer. `/` is the landing page; signed-in visitors are still sent to
    their shop by proxy.ts. `/pricing` is added to `PUBLIC_PATHS`.
  - **Landing page**: hero with the dashboard drawn in HTML
    (`components/marketing/product-visuals.tsx` — the product's own tokens
    and badges, a sample fabric shop, figures marked as illustration);
    where you can sell; three feature rows (stock by branch, the online shop
    that knows where it ships from, payments straight to your bank with a
    worked example); the rest of the day-to-day; how it works (the real
    onboarding steps); a pricing band; questions; a last call to action.
  - **Every changeable number is read, not typed**: trial length and plan,
    the cheapest monthly price and grace days come from the catalogue and
    billing settings (`lib/marketing/offer.ts`), re-read every 10 minutes,
    with number-free wording if the database can't be read. No
    testimonials, customer counts or logos — none we could stand behind yet.
    "Recommended", not "most popular".
  - **Pricing** (`/pricing`): the three cycles with the saving and the
    monthly equivalent, plan cards and a comparison table (built features
    only), billing questions (card through Paystack; renews at the price
    signed up at; change or cancel any time; grace; domains).
  - Sign-up (`/register`) says "Start your free trial", and the auth and
    onboarding screens use the site's wordmark. **Fixed:** the live sign-up
    (`app/(auth)/register/actions.ts`) never sent the 12.5 confirmation
    email — it went from an unused `features/auth/actions.ts`, now deleted.
  - `PLATFORM_CONTACT_EMAIL` added to `lib/brand.ts` (footer and legal pages).
  - Checked in a real browser (desktop and phone, production build).
- **12.4 Nothing half-there on screen — DONE (2026-09-30).** The two-systems
  question was settled on 2026-09-30: **keep both** — the invoice pair is how a
  business dispatches and takes back goods sold on account (B2B), which online
  orders don't cover — and **merge the screens**. As shipped:
  - **Projects removed.** The page and its sidebar entry are gone, and so is the
    Project Manager system role. `project.*`, `task.*` and
    `inventory.requisition.*` permissions are hidden by `isBuiltPermission`
    (`lib/permissions.ts`), which the roles matrix (`lib/permission-labels.ts`)
    and new-workspace bootstrap both use. The `Project` tables stay, so no data
    is dropped. `maxProjects` had already gone when plans moved to the database
    (12.1).
  - **One "to send" list.** Sales → Fulfillment
    (`features/sales/work-lists.ts` → `listToSend`) merges online-order parcels
    (`OrderShipment`, "open" by the same rule `sendShipment` enforces: pending
    parcel, order confirmed/processing, paid or pay-on-delivery) with invoice
    fulfilments (open = not shipped or cancelled). There are tabs for To send
    (n), Sent and All, a source filter, search and pagination, all in the URL.
    Each row wears a source badge and opens its own record: the order page, or
    the invoice fulfilment.
  - **One returns list.** Sales → Returns (`listAllReturns`) works the same way:
    "Waiting on you (n)" (order returns requested/approved, invoice returns
    requested) and "All returns". The old `?view=invoices` link still works and
    maps to `source=invoice`.
  - **Transfer hold is real config.** `UNPAID_ORDER_HOLD_MINUTES` and
    `TRANSFER_HOLD_HOURS` live in `lib/storefront/orders/holds.ts`. Nothing
    outside the mock layer imports `lib/storefront/mock/checkout` for them now.
  - **API access and TikTok:** checked, not advertised. Pricing lists only
    `built` features, and TikTok is offered in neither the composer, the
    history filter nor on connect. No change was needed.
  - **Invoices → Overdue.** `?view=overdue` filters in the database with the
    same rule as the overview count (sent or part-paid, due date past). The
    Sales overview tile and the list's "n invoices are overdue" line both link
    to it, and an empty Overdue view says so and offers "Show all invoices".
  - Tests: `tests/sales-work-lists.test.ts` covers the merge, open/done, the
    source filter, search, another store's records being a miss, and the
    overdue rule.
- **12.5 Merchant onboarding, from sign-up to first sale — DONE (2026-09-29),
  except product CSV import (14.2), which follows as its own step.** The
  *proposed* choices were confirmed on 2026-09-29: new shops start closed;
  the form asks what they sell AND where; reminders run from a daily cron
  route; CSV import straight after. As shipped:
  - **Email first.** `signUp` sends a confirm link (`lib/email-verification.ts`:
    SHA-256 of a 256-bit token in `VerificationToken`, 48 h, single use,
    60-second resend cooldown). `/verify-email/[token]` confirms on a button
    press — not on page load — so a mail scanner can't use the link up.
    `/onboarding` shows "Confirm your email" (resend, sign out) until then,
    and `createShop` re-checks. Google sign-in marks the address verified
    (`events.signIn`), and so does accepting an invitation sent to it.
    Invited staff get no link.
  - **Create your shop** (`app/onboarding`): shop name; **web address**
    prefilled from the name, checked as they type against every workspace
    and `reserved-slugs.ts`, with up to three free suggestions (city first)
    when taken or reserved — never suffixed; the real shop and dashboard
    hosts from `lib/tenant/urls.ts`, and a line that it can't change later;
    **what they sell** (`lib/onboarding/business.ts`, with starter
    categories they may tick — only ticked ones are created) and **where**
    (online / in person / both); **first store** name, state and city; the
    trial it comes with (or "you'll choose a plan" for a repeat owner).
    `bootstrapOrganization` (moved to `lib/onboarding/bootstrap.ts`) creates
    the org (closed), roles, owner, store with its place, categories and the
    subscription in one transaction. A welcome email follows. The unused
    `features/org` `createOrganization` (which suffixed silently) is gone.
  - **The setup guide** (`lib/onboarding/setup-steps.ts` pure,
    `setup-guide.ts` reads the records, batched): store place → sells
    online → delivery (`HAS_LIVE_DELIVERY_WHERE`) → a published product in
    stock at an `ONLINE_SUPPLY_WHERE` store → payment (online payments
    active or a bank account — recommended, not required, since pay on
    delivery always works) → Open your shop; optional: logo, store pages,
    own web address. In-person shops see their product and payment steps
    first. Pinned on the dashboard for Owners/Admins until complete or
    hidden; always at **Settings → Setup guide**. Each step links to its
    screen; without the permission, "An owner or admin can do this".
  - **Opening** (`Organization.storefrontOpen`, existing shops default open;
    migration `20260930160000_merchant_onboarding`): a closed shop shows
    "{shop} is opening soon" (or "closed for now" if it has opened before),
    its catalogue reads empty (`lib/storefront/opening.ts`, used by the one
    catalogue seam), it's out of robots/sitemap/metadata, and `placeOrder`
    refuses `store-not-open`. The merchant's **team** sees the real shop
    with a preview banner (the root-domain session reaches the storefront).
    "Open your shop" (AlertDialog, with a preview link) is refused on the
    server until every required step is done; "Close shop" in Settings.
    Both are audited (`settings.storefront.opened` / `.closed`).
    Order of closed states: suspended (11.4) → plan ended (12.1) → not open.
  - **Reminders** (`lib/onboarding/reminders.ts`,
    `/api/cron/onboarding-reminders`, `vercel.json` daily at 08:00 UTC):
    setup on trial days 3 and 7 while not open (listing what's left), trial
    ending in 3 days and 1 day. Each claimed once in `OnboardingEmail`
    before sending; a failed send releases it.
  - **Platform:** the merchant list has a "Shop setup" column (Open, or
    "Not open · 2 of 4" with the next step) and the merchant page lists the
    steps.
  - Fixed on the way: the storefront sitemap passed the shop to
    `listProducts` outside `store`, so it relied on the proxy header.
  - **Not built:** "Import from a spreadsheet" (14.2, next). The domain step
    links to Settings → Billing until 12.6.
  - Tests: `lib/onboarding/onboarding.test.ts` (addresses, categories, step
    order and readiness, reminder timing, email wording) and
    `tests/onboarding.test.ts` (link single-use/expiry/cooldown; unverified
    refused; taken/reserved refused with suggestions, never suffixed; the
    shop created whole and closed; nothing created when a step fails; each
    step done/undone with the records; closed shop empty to shoppers but
    not the team, no sitemap, no order; open refused until ready then
    allowed and audited, close; guide only for owners/admins; reminders
    once each).

  The original proposal:

  **The gap.** The whole of onboarding today is one field:
  - `signUp` (`features/auth/actions.ts`) creates the user and signs them in,
    with no email verification.
  - `/onboarding` asks only for an "Organization name". `bootstrapOrganization`
    (`lib/onboarding.ts`) then creates the org, its system roles and the Owner
    membership, and drops the merchant on an empty dashboard.

  Everything after that is left for the merchant to discover across six
  screens, in an order the code depends on but never states. To take a first
  online order, a merchant must, unprompted:
  1. **create a store** — none is created at onboarding, yet stock,
     `sellsOnline`, delivery and the till all hang off one;
  2. **give it a city and state** (9.1), or it can't sell online;
  3. **switch on "Sells online"**;
  4. **set up delivery for that store** (9.2), or its stock is left out of the
     catalogue;
  5. **add a product** with a price, a photo and stock at that store, then
     publish it;
  6. **set up a way to be paid** — Phase 10's verification and subaccount,
     and/or a bank account for transfers.

  The code also has these faults:
  - **The web address is chosen for them, badly, and forever.**
    `createOrganizationAction` turns the name into the slug and, if it's
    taken, silently appends a random suffix (`acme-x7k2`). That slug becomes
    the admin host and `shop-{slug}` — the storefront's address — and an
    existing org is never renamed (AGENTS §7). The merchant never gets to
    choose it.
  - **The onboarding page is out of date.**
    - Its preview says `app.safebase.com/{slug}` — the old name, and a
      path-based address the platform doesn't use; the real one is
      `getStorefrontUrl`.
    - Its logo is a hard-coded "S", and its placeholder is "Acme
      Manufacturing Ltd" for a platform aimed at shops.
    - Phase 0 renamed the platform everywhere except here.
  - **The storefront is public from the first second.** `shop-{slug}` answers,
    appears in its own sitemap and can be indexed while it has no products,
    no delivery and no way to pay. No setting says "not open yet".
  - **Nothing welcomes the merchant or tells them what to do next.** There is
    no welcome email, no setup guide on the dashboard, and the dashboard's
    empty states assume an established shop. The per-product checklist in the
    product editor is the only guidance of its kind.

  **The build:**
  - **Sign-up** (with 12.3's public front door):
    - verify the owner's email before the workspace is created — moved here
      from 14.5, because a workspace, a trial and a subaccount shouldn't hang
      off an unconfirmed address;
    - Google sign-up stays available.
  - **Create your shop** — replacing the single field, in one short form:
    - **Shop name.**
    - **Web address, chosen by the merchant.** Prefilled from the name, and
      checked live against existing orgs and `reserved-slugs.ts`. When the
      address is taken, the form says so and suggests alternatives; it never
      appends a suffix silently. The preview shows the real storefront and
      admin addresses from `lib/tenant/urls.ts`. A line says the address
      can't be changed later, because links customers save must keep working.
    - **What they sell**, and whether they sell in person, online or both
      (*proposed*). Used only to choose which setup steps to show first, and
      to seed suggested categories the merchant can accept or skip. It never
      creates products or storefront content (Storefront data rules: never
      invent a merchant's content).
    - **Their first store**: name, city and state (the 9.1 place), created in
      the same transaction as the org, so the merchant never meets "create a
      store first".
    - The currency stays NGN (Settings → General).
    - The trial (12.1) starts here, and the form says how many days and on
      which plan.
  - **The setup guide on the dashboard** — a "Get your shop ready" checklist
    pinned above the dashboard until done or dismissed, then reachable from
    Settings:
    - **Each step is derived, never ticked by hand.** It reads the real
      records — store place, `sellsOnline`, delivery per store
      (`ONLINE_SUPPLY_WHERE`), a published product with stock online,
      payment setup (10.2/10.8) or a bank account, logo, store pages — so it
      can't claim something is done that isn't. Same principle as the product
      checklist.
    - **Each step links to the one screen that does it**, and says in one
      line why it matters ("Shoppers can't check out until your store can
      deliver or offer pickup").
    - The order follows the dependencies above. Steps are optional where the
      product allows it (a logo, store pages, social).
    - Only members with the relevant permission see a step as actionable;
      others see who can do it.
    - One function computes it, and the dashboard and the storefront's "not
      open yet" state both read that same function.
  - **Opening the storefront** (*proposed*):
    - A new storefront starts **not open**: it shows the shop's name and
      "Opening soon", lists nothing, is left out of sitemap and robots, and
      takes no orders.
    - The merchant opens it with an "Open your shop" button, which is offered
      once the required steps are done. The button says what shoppers will
      see, and a preview link lets the merchant look first.
    - It can be closed again later, e.g. for a holiday.
    - This is a new `Organization` setting. Closing is separate from the
      lapsed-subscription closure (12.1) and suspension (11.4); the
      storefront says the right thing for each.
  - **"Use your own web address"** is an optional guide step, after the
    required ones. It links to Settings → Domain (12.6), explains in one line
    what it gives ("Customers find you at yourshop.com"), and during the trial
    shows what's available then (12.6 decides). It's never a required step and
    never part of paying for a plan.
  - **Getting products in.** The guide's product step offers "Add a product"
    and "Import from a spreadsheet". **Product CSV import (14.2) moves before
    launch for this reason**: a shop arriving with 300 products won't type
    them in.
  - **Emails:**
    - a welcome email on shop creation, in the platform's name, with the
      storefront and admin addresses and the first step;
    - a reminder if setup stalls (*proposed*: day 3 and day 7 of the trial,
      only while steps remain);
    - trial reminders before the trial ends (12.1).
  - **Invited staff** already have their own path (`/invite/[token]`). They
    skip shop creation and land on the dashboard without the setup guide
    unless they're an Owner or Admin.
  - **Platform view:** 11.2's merchant list shows setup progress per merchant,
    so platform staff can see who is stuck and on which step.

  **Tests:**
  - an address that is taken or reserved is refused with suggestions, never
    suffixed;
  - the org, its first store with its place, the roles, the Owner membership
    and the trial are created together or not at all;
  - each guide step reflects the real records, and becomes done or undone as
    they change;
  - a not-open storefront lists nothing, takes no order, and is left out of
    the sitemap;
  - "Open your shop" is refused while a required step is missing;
  - an invited member never sees shop creation.

- **12.6 Custom domains — fulfilled manually — DONE (2026-09-30).** The two
  open proposals were confirmed on 2026-09-30: **`www` is canonical** (the
  bare domain redirects to it), and **connecting an existing domain is
  allowed during the trial**. As shipped:
  - **Data** (migration `20260930180000_shop_domains`): `ShopDomain` (one
    per shop: hostname, canonical www host, REGISTERED | CONNECTED,
    PENDING | LIVE | EXPIRED | DISCONNECTED | FAILED, registrar expiry,
    DNS-check state), `DomainReminder` (each reminder once per expiry
    cycle), and `DomainOrder` gains `RENEW`, `readyAt`, the four step
    timestamps, the recorded expiry, `failureReason` and refund fields.
    `Organization.customStoreDomain` (the www host) is still the one routing
    lookup, set and cleared only by `lib/domains/shop-domain.ts`.
  - **Routing** (`proxy.ts`, `resolveTenant`): a merchant's domain serves the
    **storefront only** — `customAdminDomain` is no longer resolved, so a
    dashboard never opens on it. The bare domain 308s to `www`; the
    platform's `shop-{slug}` address 308s to the live custom domain (the
    mobile origin is left alone). Checked over HTTP against a production
    build. `getStorefrontUrl(slug, path, customDomain?)` and the server's
    `storefrontUrlFor(slug)` give the custom address only while it's live;
    the storefront's metadata/canonical, sitemap, robots, product JSON-LD,
    invoice links and the admin's "view shop" links use it.
  - **Settings → Domain** (`/settings/domain`; sidebar, the setup guide's
    optional step, a link card on Billing — the Billing card and the
    `/upgrade` domain step are gone, so upgrading is plan → pay):
    - **Get a new domain**: `.com` search (other endings explained), up to
      4 available alternatives when taken, "₦X for the first year · renews
      at ₦Y a year · usually ready within 24 hours" (renewal price from
      Namecheap's renew pricing), a confirm dialog, then Paystack. Locked
      with "See plans" on the trial; the server refuses too. Re-quoted and
      re-checked (`.com`, not held by another shop) before charging.
    - **Connect a domain you own** (free, trial allowed): the A and CNAME
      records with copy buttons, short guides (Namecheap, GoDaddy,
      Whogohost, Cloudflare), and **Check my domain** (our DNS lookup, per
      record, plain words); once right it becomes an `EXISTING` work order.
    - A **timeline** (Paid/Records found → Registering → Connecting → Live)
      that follows staff's ticks, with an apology past 24 hours.
    - **Live**: the address; for registered domains the expiry, the renew-by
      date, the renewal price and **Renew** (a billing charge → `RENEW`
      order); banners from 30 days before the deadline, past the deadline,
      in grace (renew restores), in redemption (contact us; the platform
      never pays the fee). **Remove this domain** (AlertDialog) takes it out
      of routing at once.
    - A dashboard "needs attention" line from 30 days before the deadline.
  - **Daily job** (`lib/domains/lifecycle.ts`, `/api/cron/domain-lifecycle`,
    07:00 UTC in `vercel.json`): expires lapsed registrations (out of
    routing, shop back on its platform address); reminders to the owner and
    payments contact 30/14/7/3/1 days before the deadline, on expiry day,
    and weekly in grace — none once renewal is paid; the staff digest.
  - `CUSTOM_DOMAIN_CNAME_TARGET` / `CUSTOM_DOMAIN_APEX_IP` set the records
    merchants add (Vercel's by default).
  - Tests: `lib/domains/rules.test.ts` (names, www, suggestions, records,
    deadline/stages, reminder schedule, timeline/overdue, email wording) and
    `tests/shop-domains.test.ts` (connect on the trial while buying is
    refused; another shop can't claim it; queued only once DNS is right;
    staff checklist gates Mark live; apex→www redirect, storefront-only,
    `storefrontUrlFor`; remove stops routing; buying charges the quoted price
    and only joins the queue once paid; expiry recorded; reminders once,
    none after renewal is paid, double renewal refused; expiry takes it out
    of routing; failed with reason and a recorded refund; staff only);
    `tests/tenant-resolution.test.ts` updated for storefront-only.
  - **Not built:** paying the redemption (recovery) fee online — shown as
    "contact us"; Namecheap's grace/redemption lengths are the typical 30 +
    30 days, still to confirm; automation through Namecheap's API is 13.5.
    Local dev can't route a custom domain (unknown hosts are the mobile
    origin there).

  The original decision and design:

  **Decided:**
  - **Registration and set-up are done by hand** by the platform team, within
    24 hours of payment (11.5's queue). Automation through Namecheap's API is
    after launch (13.5).
  - **Renewal is the merchant's to pay.** The platform reminds them as expiry
    nears; the merchant sees the expiry date on the platform and renews there;
    the platform team renews at Namecheap. They never see how it's done.
  - **Not renewed means the custom domain stops working.** The shop stays
    reachable on its platform address (`shop-{slug}.…`) — only the custom
    address goes.
  - **Confirmed by the owner, 2026-09-29:**
    - the domain opens **the storefront only**, and the dashboard stays on the
      platform address;
    - **buying a domain needs a paid plan**;
    - **the merchant is recorded as the domain's owner** (registrant);
    - **`.com` only** at launch;
    - the renewal deadline and reminders follow common registrar practice
      (below).

  **What's there today, and why it changes:**
  - A domain is chosen as a step of the plan upgrade (`/upgrade`: plan →
    domain → pay) or from a card on Settings → Billing. Payment is one Paystack
    charge on the platform's billing account (`lib/billing/checkout.ts`),
    priced from Namecheap's dollar price at an exchange rate stored in platform
    settings. Then an email goes to `PLATFORM_ADMIN_EMAIL`, and a person edits
    the database.
  - What's wrong with it for a merchant:
    - asked at the moment of paying for a plan, where every extra decision
      loses people;
    - hidden under Billing, when an address is part of the shop's identity;
    - "we'll reach out" and then silence;
    - the first-year price only, with no renewal price, no expiry date, no
      renewal at all;
    - nothing decides which address the domain serves;
    - the Billing card shows "Active" only when a *dashboard* domain is set.

  **Where a merchant meets it:**
  - **Settings → Domain**, a page of its own. It is not in Billing, and not a
    step of upgrading: remove the domain step from `/upgrade` and the card from
    Settings → Billing, which links here instead.
  - **An optional step in 12.5's setup guide:** "Use your own web address".

  **What the domain serves (decided): the storefront only.**
  - `pncollections.com` and `www.pncollections.com` both open the shop; one
    is canonical (*proposed*: `www.`), and the other redirects to it.
  - The old `shop-{slug}.…` address permanently redirects to the canonical
    one, so saved links keep working and search engines see one shop.
  - **The dashboard stays on `{slug}.{PLATFORM}`.** Staff sign-in cookies are
    scoped to the platform's domain (`auth.config.ts`), so a dashboard on the
    merchant's domain would loop at sign-in. Shoppers never see the dashboard
    address.
  - `customAdminDomain` stops being offered.
  - Every link we generate uses the canonical address once the domain is
    live: `getStorefrontUrl`, emails (some already use `customStoreDomain`),
    "view store", social posts, the sitemap and the canonical tag.

  **Buying a new domain** (Settings → Domain → "Get a new domain"):
  1. **Search**, `.com` only (decided), using the existing Namecheap
     availability check. When a name is taken, suggest close `.com`
     alternatives (with or without a hyphen, with "ng", "shop" or "store"
     added). Any other ending typed in is explained ("We offer .com addresses
     only for now"), not refused silently.
  2. **An honest price, in naira only:**
     - "₦X for the first year · renews at ₦Y a year" — the renewal price from
       Namecheap's pricing, renew category;
     - what's included (the padlock, the `www.` version);
     - "Usually ready within 24 hours".
  3. **Pay** through the existing billing checkout, domain-only (the
     `purchaseDomain` path). The server quotes again before charging, as it
     does today.
  4. **A status timeline on the page:** Paid → Registering your domain →
     Connecting it to your shop → Live. Each step moves as staff tick it in
     11.5, and there's an email when it's live. If it's past 24 hours, it
     says so and apologises, rather than going quiet.
  5. **If it can't be done** (the name was taken in between, Namecheap
     refuses), the page says why and that the money is being returned.
     Staff refund it and record it (11.5).

  **Connecting a domain the merchant already owns** (free):
  - The page shows the exact records to add at their registrar, with copy
    buttons and short guides for common registrars. A **"Check my domain"**
    button looks the DNS up from our side and says what's missing, in plain
    words.
  - Once the records are right it becomes a work order in 11.5 (staff add the
    hostnames at the host so the certificate is issued), and shows the same
    timeline.
  - There's no expiry or renewal on our side: their registrar handles that.
    We only warn if the DNS stops pointing at us.

  **Expiry and renewal (registered domains only):**
  - The domain page always shows the **expiry date**, the **renewal price**
    and a **Renew** button. The date is the one staff recorded from Namecheap.
  - **The renewal deadline is 7 days before Namecheap's expiry** (decided,
    following common practice for manually fulfilled renewals), so staff
    always have a week to renew after the merchant pays.
  - **Reminders** (decided, following common registrar practice) by email to
    the Owner and the payments contact:
    - 30, 14, 7, 3 and 1 day(s) before the deadline;
    - on the expiry day;
    - once a week during the grace period.

    Also a banner on the domain page, and a dashboard "needs attention" line
    from 30 days out. Reminders stop the moment it's renewed.
  - **Renewing** is a billing charge like buying. It creates a renew work
    order in 11.5, which staff complete at Namecheap and then record the new
    expiry date.
  - **Past the deadline, the merchant can still renew until Namecheap's
    expiry**, with a clear "renew now or your address stops working on {date}".
  - **After expiry:**
    - the custom domain is taken out of routing (status `EXPIRED`), and the
      shop is served on its platform address again;
    - the page says what happened and whether it can still be recovered. For a
      `.com` there are three stages (Namecheap's current lengths and fees to
      be confirmed):
      - **grace period** (about 30 days): renewal at the normal price still
        restores it;
      - **redemption** (about 30 days more): the registry deletes it, and
        getting it back costs Namecheap's redemption fee — tens of dollars —
        on top of the renewal;
      - then the name is released and anyone can register it.
    - **Decided default:** the merchant can renew during grace at the normal
      price; during redemption they're shown the recovery cost and can pay it
      (staff do the recovery at Namecheap); **the platform never pays it on
      their behalf**. After release, the name is gone;
    - links we generate go back to the platform address.

  **The trial and plans:**
  - **Buying a new domain needs a paid plan** (decided). During the trial the
    option is shown locked, explaining why and linking to the plans
    (AGENTS §7).
  - Connecting an existing domain during the trial (*proposed*) — free for
    us, and a shop on its own address converts better. Not yet confirmed.
  - When a subscription lapses (12.1), the custom domain follows the shop: it
    shows the same closed page after grace.

  **Who owns it (decided):** the merchant is recorded as registrant when
  staff register it, using the business name and payments contact from 10.2.
  If they leave the platform, they can ask for the domain to be transferred to
  them.

  **Data:**
  - `DomainOrder` gains the kind `RENEW`, a `CONNECT` flow for existing
    domains, and fulfilment steps with timestamps (for the timeline).
  - A **per-shop domain record** holds:
    - the hostname and canonical host;
    - the status (`PENDING`, `LIVE`, `EXPIRING`, `EXPIRED`, `DISCONNECTED`);
    - whether it was registered through us or connected by the merchant;
    - the registrar expiry date and the renewal deadline.
  - `Organization.customStoreDomain` stays the routing lookup
    (`resolveTenant.ts`) and is set and cleared from that record, so routing
    stays one indexed query.
  - The dollar-to-naira rate moves from a hidden platform setting to the
    console (11.7).

  **Tests:**
  - a purchase creates one paid order and a "Registering" timeline, and the
    price shown equals the price charged;
  - the apex and `www` both route to the storefront and one redirects to the
    other; the old `shop-` address redirects to the canonical one;
    `getStorefrontUrl` returns the custom address only while the domain is
    live;
  - a dashboard request never resolves on a merchant's domain;
  - a renewal before the deadline creates a renew order; reminders go out on
    the days chosen and stop once renewed;
  - an expired domain stops routing while the platform address keeps
    working;
  - during the trial, connecting is allowed and buying is refused with the
    reason;
  - another shop can't claim a domain already connected or ordered.

  **Still open:**
  - which is canonical, `www` or the apex (*proposed*: `www`);
  - connecting an existing domain during the trial (*proposed*: yes).

  **Decided on 2026-09-29:** storefront only; a paid plan to buy; the
  merchant as registrant; `.com` only; the 7-day renewal deadline; the
  reminder schedule; the platform never pays a redemption fee.

## Phase 13 — Production hardening — TODO

The gap: what a live, multi-instance deployment needs that local development
never showed.

- **13.1 Scheduled jobs — DONE (2026-09-30).** Decided 2026-09-30: the
  project is on **Vercel Hobby**, which only allows daily cron jobs (and fails a
  deploy asking for more), so the two 15-minute jobs are called by
  **cron-job.org** until the move to Pro, when they go into `vercel.json`
  instead. Setup is in `docs/SCHEDULED-JOBS.md`. As shipped:
  - **One registry**, `lib/cron/jobs.ts`: each job's title, plain description,
    schedule, `everyMinutes`, its work, and a `describe()` that turns its
    result into words. Every `app/api/cron/*` route is now three lines around
    `cronRoute(key)` (`lib/cron/route.ts`: the constant-time bearer check,
    then 500 on failure so the scheduler sees it too).
  - **Every run is recorded** (`CronRun`, kept 30 days) by `runCronJob`
    (`lib/cron/run.ts`), whichever scheduler started it, or when staff press
    **Run now**.
  - **Alerts** go to `PLATFORM_ADMIN_EMAIL`:
    - a failed scheduled run emails at most every 6 hours while the job stays
      broken, and once more when it works again (`CronAlert`);
    - a failed manual run doesn't email;
    - a job nobody is calling fails nothing, so after every run the OTHER jobs
      are checked, and one that is late (three missed beats; a day plus two
      hours for daily jobs) gets a "hasn't run" email. A job that has never
      run counts as late only once its window has passed since the first
      recorded run of any job, so a newly deployed daily job isn't reported
      before its first morning. The
      Vercel jobs watch the cron-job.org ones, and the other way round. The
      rules are in `lib/cron/health.ts`.
  - **Console → Scheduled jobs** (`/platform/jobs`): each job's state (Working
    / Running / Failing / Not running / Hasn't run yet), when it last ran and
    last worked, its last error, and Run now (refused while a copy is still
    running). Recent runs can be filtered by job in the URL. It warns when
    `CRON_SECRET` or `PLATFORM_ADMIN_EMAIL` is unset. The overview and the
    sidebar count jobs that are failing or late.
  - Tests: `lib/cron/health.test.ts`, and `tests/cron-runs.test.ts` (a fake
    registry: recording, throttled alerts, recovery, overdue detection).
    `tests/cron-runs.test.ts` also checks that registry, routes and
    `vercel.json` agree, and that `vercel.json` stays daily-only while on
    Hobby.
- **13.2 Shared rate limits — DONE (2026-09-30).** The shared store is
  **Postgres**, not Redis: no new service, account or bill, and one round
  trip per check. As shipped:
  - **Table and function.** `rate_limit_buckets` (fixed windows) plus the SQL
    function `rate_limit_take(keys, limits, windows, blocked_by)`. It takes a
    whole chain of buckets in one round trip, stopping at the first full one:
    earlier buckets stay counted, later ones are untouched, exactly like the
    old `a && b && c` chains. Each bucket is one atomic upsert, so concurrent
    requests can't both take the last unit (tested: 12 racing for 5 get 5).
  - **`lib/rate-limit.ts`:** `checkRateLimit` keeps its arguments but is now
    `async`. `takeRateLimits` (chains, optionally `blockedBy` a cool-down),
    `requestLimitRetryAfter`, `coolDown` and `clearRateLimit` are added.
    Expired rows are swept now and then.
  - **Gemini cool-downs are shared too.** After a 429, the assistant, social
    copy and image-embedding pauses were module variables, so each instance
    kept knocking. They are now rows the budgets are `blockedBy`.
  - **If the database can't be reached:** request limits let the request
    through (it would fail on its next query anyway), and model budgets
    refuse, so the caller gives its no-AI answer.
  - **Every call site now awaits** (sign-in, password reset, checkout,
    discount codes, order lookup, aftercare, questions, reviews, bank
    lookups, and the social, assistant, discovery, recommendation and
    visual-search quotas). Keys and limits are unchanged.
  - **Tests:** under vitest the counters stay in memory unless
    `RATE_LIMIT_STORE=database`, so unit tests need no database.
    `tests/rate-limit.test.ts` runs the SQL function itself: windows, the
    race, chains, cool-downs, and failing open or closed.
- **13.3 Seeing failures — DONE (2026-09-30).** Decided 2026-09-30: a
  **built-in** error log rather than Sentry, so there is no new account or
  cost; the trade-off is less precise browser stack traces (minified). As
  shipped (details in `docs/MONITORING.md`):
  - **The error log** (`ErrorGroup` / `ErrorEvent`, `lib/ops/errors.ts`):
    - server errors come from `instrumentation.ts` → `onRequestError`, skipping
      `notFound`/`redirect`;
    - browser errors come from `instrumentation-client.ts` (uncaught errors and
      rejections), and from all 68 `error.tsx` boundaries via `RouteError` /
      `useReportError`, through `POST /api/client-errors` (capped, noise
      dropped, rate limited);
    - webhook failures come from `lib/ops/webhooks.ts`.
    - Grouped by source + place + message with ids blanked. Paths are scrubbed
      of query strings and tokens. Events are kept 14 days. Only the live site
      records (`VERCEL_ENV=production`, or `ERROR_LOG=on`).
  - **Alerts** (`lib/ops/alerts.ts`, which the scheduled jobs use too;
    `cron_alerts` became `ops_alerts`), to `PLATFORM_ADMIN_EMAIL`:
    - a new server or webhook error (at most 10 an hour);
    - a resolved error that comes back;
    - a spike;
    - a webhook failing 3 times in 30 minutes, and working again after.
  - **Webhooks.** The Paystack webhook reports bad signatures, unreadable
    bodies and processing failures; it still answers 200 on a processing
    failure, deliberately (see the docs). The Meta callback reports refused
    exchanges and unexpected failures, but not a merchant cancelling or
    unticking permissions. Squad is retired.
  - **`GET /api/health`:** 200/503 on database reachability, `no-store`.
    Uptime is monitored from cron-job.org every 15 minutes, not more often,
    so the Neon database isn't kept awake around the clock.
  - **Structured logs:** `lib/ops/log.ts` (JSON lines), used by the error
    log, cron and webhooks. Older `console.*` calls were left as they are.
  - **Console → Errors** (`/platform/errors`): Open / Resolved / All,
    source filter, search, pagination. The detail page shows the counts, the
    latest stack, the digest and recent occurrences, with Mark resolved /
    Reopen. The overview and sidebar count open errors seen in the last 24
    hours.
  - **Tests:** `lib/ops/error-shape.test.ts` and `tests/error-log.test.ts`.
- **13.4 Security headers — DONE (2026-09-30).** As shipped:
  - **Content Security Policy with a per-request nonce**
    (`lib/security/csp.ts`, set by `proxy.ts`). Every page already rendered
    per request, so nonces cost nothing extra. `script-src 'self' 'nonce-…'
    'strict-dynamic'`: Next stamps its own scripts, and an injected
    `<script>` or inline event handler doesn't run (checked in Chrome by
    injecting both into a real page).
    - `style-src` keeps `'unsafe-inline'`, because components set `style=""`
      attributes.
    - Images come from self, data/blob and Cloudinary; connections from self
      and Cloudinary uploads.
    - `form-action` covers Google sign-in, Facebook and Paystack.
    - `frame-src` and `object-src` are `'none'`; `frame-ancestors 'none'`.
    - `upgrade-insecure-requests` is sent on https only.
  - **Merchant analytics.** Only the storefront (shop hosts, custom domains,
    the mobile origin) also allows Google Analytics and the Meta Pixel, the
    two tags a merchant can switch on by pasting an id (Phase 6). Their
    `<Script>`s now carry the nonce. No other third-party script can run.
  - **Every pass-through in the proxy forwards the request headers**, so the
    nonce reaches rendering. Any new return in `proxy.ts` must do the same:
    a bare `NextResponse.next()` would leave that page's scripts without a
    nonce and blocked.
  - **Violation reports** go to `POST /api/csp-report`, into the error log as
    browser errors of kind "csp" (extensions dropped, rate limited).
    `CSP_MODE=report` is the switch if a live page breaks; `off` removes the
    policy.
  - **Other headers** (`next.config.ts`): HSTS for two years with
    subdomains (not preload), `X-Frame-Options: DENY`, `nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy
    turning off camera, mic, geolocation, USB, payment and topics (photo
    search uses the file picker, which it doesn't affect), and
    `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
  - **Demo image hosts** (`picsum.photos`, `i.pravatar.cc`) are only in
    `images.remotePatterns` for `next dev`, where the opt-in fixture
    catalogue can use them; a production build never proxies them.
  - **Tests:** `lib/security/csp.test.ts`, and the report endpoint in
    `tests/error-log.test.ts`.
- **13.5 Custom domains, automated — AFTER LAUNCH (moved 2026-09-29).** Launch
  is manual (12.6 / 11.5). Afterwards, "staff approve, the app does the
  clicking", through Namecheap's API — the commands below are to be verified
  against Namecheap's current docs first, as Paystack's were:
  - `namecheap.domains.create` registers, with the merchant as registrant, and
    is paid from the platform's Namecheap balance;
  - `namecheap.domains.dns.setHosts` points the domain at the platform;
  - `namecheap.domains.getInfo` / `getList` read expiry dates daily, so they
    are never typed by hand;
  - `namecheap.domains.renew` renews the moment the merchant pays, which
    removes the risk of a paid renewal staff forgot;
  - `namecheap.users.getPricing` (renew category) gives renewal prices.

  **Prerequisites:** Namecheap API access (it has account-balance or spending
  thresholds), a **whitelisted fixed outbound IP** (`NAMECHEAP_CLIENT_IP`;
  serverless hosting has none by default), and a funded balance with a
  low-balance alert. Also: DNS checking and certificate issuance through the
  hosting provider's domains API for domains merchants connect themselves.
  11.5's manual queue remains the fallback.
- **13.6 Database — DONE (2026-09-30).** The owner has since pointed local
  development at its own Neon branch (2026-10-01); Vercel Preview,
  `DIRECT_URL` on Production and the backup secrets are theirs to confirm
  (`docs/DATABASE.md`). As shipped:
  - **The drift, found and fixed.** There were two causes, not one:
    - **A renamed migration.** `20260916191000_order_confirmation_token` was
      applied, then renamed to `…192000…` and applied again. Its old name
      stayed in `_prisma_migrations`, which is what made `migrate dev`
      demand a reset. The stale row was deleted (the database already had
      everything the folder creates).
    - **`orders.customerId`.** The database and the history said RESTRICT;
      the schema said nothing, so Prisma assumed SET NULL. The schema now
      states `onDelete: Restrict`: nothing deletes customers, and it's the
      safer rule. 13.8 decides shopper deletion.
    - **Now all three agree.** `migrate diff` of live database vs schema:
      no difference. A replay of the whole history into an empty Postgres 17
      + pgvector: an empty migration. `migrate dev --create-only`: an empty
      migration, no reset.
  - **Two addresses** (`prisma.config.ts`): the app keeps the pooled
    `DATABASE_URL`, and the CLI uses `DIRECT_URL` (plus
    `SHADOW_DATABASE_URL` for `migrate dev`). Migrations through the pooler
    left an advisory lock stuck on a pooled connection since 19:35; it was
    found in `pg_locks` and ended.
  - **Deploy-time migrations:** `npm run vercel-build` →
    `scripts/db/migrate-on-deploy.mjs` runs `prisma migrate deploy` on
    production deploys only, and only when `DIRECT_URL` is set.
  - **Pooling:** `lib/prisma.ts` keeps 5 connections per instance on Vercel
    (10 elsewhere, `DATABASE_POOL_MAX` overrides) through Neon's pooler, and
    warns in production if `DATABASE_URL` isn't the pooled address.
  - **Backups**, in two layers:
    - Neon's own point-in-time history (restore to a branch at a past time);
    - `.github/workflows/db-backup.yml`: every night it dumps the database
      and counts every table's rows **in the same snapshot**
      (`pg_export_snapshot`), encrypts the result (AES-256,
      `BACKUP_PASSPHRASE`), restores it into a scratch Postgres and checks
      every count, and keeps the artifact 30 days.
    - Scripts: `scripts/db/{backup,restore}.sh`.
  - **Restore rehearsed on 2026-09-30** against the live database: 96
    tables and 1,816 rows identical, with vectors and SQL functions intact;
    the wrong passphrase fails. The first rehearsal caught a real flaw:
    counts taken after the dump raced a scheduled-job write. That's why the
    counts now share the dump's snapshot.
  - **Owner to do:** create the Neon `development` branch and `shadow`
    database, and point the local `.env` and Vercel Preview at them; add
    `DIRECT_URL` to Vercel Production; add the two backup secrets to GitHub
    and run the workflow once.
- **13.7 CI — DONE (2026-10-01).** As shipped (`docs/CI.md`):
  - **`.github/workflows/ci.yml`, on every push and pull request:**
    - `npm ci`;
    - `tsc --noEmit`;
    - `prisma migrate deploy` into an empty database;
    - a drift check (`migrate diff … --exit-code`, which fails when
      `schema.prisma` changed without a migration; tested);
    - the **whole** test suite;
    - `next build`.
  - **CI's own database.** A throwaway Postgres 17 + pgvector service built
    from the migrations, never Neon. On it the full suite (150 files, 1,802
    tests) takes about a minute, so the database suites run on every push
    rather than "before a release" as planned; that plan existed only
    because of Neon's latency.
  - **`.env.ci`:** committed placeholders for every setting the code reads
    at load time. Tests mock all outside services. `.gitignore` lets
    `.env.example` and `.env.ci` through.
  - **Run it locally:** `npm run test:local` (`scripts/test-local.sh`,
    Docker) runs the same way. `npm run typecheck` and `npm run db:drift`
    are added too.
  - **Checked by running every workflow step** on a fresh database with only
    `.env.ci`, the local `.env` set aside: all green.
  - **Not done:** CI doesn't block a Vercel deploy. Require the check on
    `master` if the GitHub plan allows.
- **13.8 Data rights (NDPA) — DONE (2026-10-01).** Decided 2026-10-01:
  - business records are kept **6 years**;
  - a deleted shopper is erased except what the law needs;
  - a closed workspace has a **30-day** undo.

  The numbers live in `lib/data-rights/policy.ts`, pending counsel with 10.10.
  As shipped (`docs/DATA-RIGHTS.md`):
  - **Shoppers:** store account → "Your data".
    - **Download:** `/account/export`, JSON.
    - **Delete:** confirmed by password, or by typing the email for Google-only
      accounts. It removes sign-in, sessions, addresses, wishlist, reviews,
      questions, votes, notes and tags, marketing consent, and the contact
      details on the customer record.
    - **What stays:** orders and invoices keep their name and delivery
      details until 6 years old.
    - **No records at all:** the customer is deleted outright.
    - **Merchant side:** the customer page says the account was deleted, and
      marketing can't be switched back on.
  - **Merchants:** Settings → Your data (Owner only).
    - **Download:** customers, products, orders and invoices as CSV.
    - **Close the workspace:** type its name to confirm. This is what
      `DELETED` means, step by step:
      - **day 0:** offline everywhere, Paystack subscription disabled
        (alerted if that fails), custom domain stopped, social tokens
        destroyed, Owners emailed the dates;
      - **days 0–30:** staff can reopen it (console → Merchants → Closed);
      - **day 30:** files (the whole Cloudinary folder), store content,
        staff access, payout and verification records, and all shopper
        account and contact data deleted; business records kept;
      - **year 6:** `eraseOrganization` deletes everything.
  - **`eraseOrganization`** walks Postgres's own foreign-key graph, so it
    needs no hand-kept table list. Proven in `tests/data-rights.test.ts`:
    zero rows of the store left in any table, another full store
    identical, users intact.
  - **Daily `data-retention` job** (vercel.json, 03:00 UTC) runs the purge,
    the erasure and the 6-year anonymisation of deleted shoppers' orders. A
    running shop's own records are never touched.
  - **The privacy page** (sections 8 and 11, updated 1 October 2026) now
    states exactly this, instead of "no self-service deletion".
  - **Found and fixed while testing in a real browser:**
    - **Storefront sign-in showed the platform's home page.** Under `next
      dev`/`next start`, a storefront sign-in (and any server-action
      redirect) rendered the platform's home page under the shop's address:
      Next fetches the redirect target from `localhost`, and Node's fetch
      drops the Host. `proxy.ts` now takes `x-forwarded-host` when the Host
      is loopback. Vercel was most likely unaffected.
    - **A closed workspace looped redirects.** The home redirect now reads
      the remembered workspace's status fresh, since the proxy's status
      cache can't be cleared by the closing action.
- **13.9 Outside approvals and live keys — CODE DONE (2026-10-01); the
  outside steps are the owner's, in `docs/GO-LIVE.md`.** What the code needed
  for a safe switch to live, and how to track the rest:
  - **Console → Go-live checklist** (`/platform/launch`, `lib/ops/go-live.ts`):
    - **What it checks** on the server, never showing a secret: Paystack key
      and mode, the webhook (the last event Paystack delivered and its
      mode), payout accounts, the sending address, `SOCIAL_TOKEN_KEY`, the
      Meta settings and redirect URI, `AUTH_SECRET`, `DIRECT_URL`,
      `CRON_SECRET`, `PLATFORM_ADMIN_EMAIL` and Cloudinary;
    - **What it lists to confirm by hand:** Meta review, the Resend domain,
      a real payment, both store listings and counsel.
  - **Payout subaccounts are mode-aware.** A test-mode subaccount doesn't
    exist for a live key. `MerchantPaymentAccount.paystackSubaccountMode` is
    recorded; one from the other mode is never charged through (readiness
    and checkout both check), never synced (that would wrongly switch the
    shop off), and is replaced on the next provision. A legacy code with no
    mode counts as test. Staff move them all with one button on the
    checklist.
  - **Billing plan codes are mode-aware too** (`BillingPlanCode.mode`).
    Without it, the first live subscription would have reused a test plan,
    and recurring billing would have failed silently after the first
    payment.
  - **`scripts/derive-social-token-key.mjs`** prints the key `AUTH_SECRET`
    derives today, so `SOCIAL_TOKEN_KEY` can be set without disconnecting
    anyone. A test proves a token sealed before the switch still opens
    after it, with `AUTH_SECRET` rotated.
  - **No tracking in the mobile app.** Merchants' Google Analytics and Meta
    Pixel tags no longer load in the app; the website keeps them. So the
    App Store and Play answers can truthfully say "no tracking", and the app
    needs no tracking-permission prompt.
  - **`docs/GO-LIVE.md`** covers, step by step: Resend domain and DNS, the
    social key, Meta App Review (settings, business verification, the six
    permissions, a recording script, the live-mode toggle), Paystack
    activation and live keys, the payout move and a real payment, tidying up
    test mode, both store listings with the privacy answers, and a final
    check.

## Phase 14 — Running the business day to day — TODO

The rest of the former Phase 7, plus gaps found in the 2026-09-29 audit. Not
launch blockers, but a merchant will feel each within weeks.

- **14.1 Tax settings** per org: VAT registered or not, rate, inclusive or
  exclusive, VAT number on invoices and receipts. Replaces the hard-coded
  `VAT_RATE` (7.5% inclusive) in `lib/storefront/pricing.ts` and the env flag in
  `lib/storefront/checkout/config.ts`. Many small shops are not VAT-registered and
  should not show VAT at all.
- **14.2 Product CSV import — DONE (2026-09-30), moved before launch by 12.5.**
  As shipped:
  - **Inventory → Products → Import** (`/inventory/products/import`; also
    from the products empty state and the setup guide's product step,
    "Import from a spreadsheet"). Needs `inventory.create`; stock columns
    need `inventory.movement.create` and access to each store (8.6).
  - **Format** (`lib/inventory/product-import.ts`, pure): one row per thing
    sold. Name + SKU required; variants are rows sharing a Name (or a
    Product SKU), with Option 1–3 name/value; Price, Compare-at price, Cost
    price, Barcode, Unit, Description, Category (an existing one, by path
    "Women > Tops" or unique name), Brand (existing), Reorder point; one
    "Stock: <store>" column per store. Headings match case-insensitively
    with common aliases; comma, semicolon or tab separated; quoted fields,
    BOM and CRLF handled; up to 500 rows / 1 MB. The downloadable template
    has the headings only (a stock column per store the member may stock) —
    **no example rows**, since an example imported by mistake becomes a
    product; the page shows the pattern instead.
  - **Preview first** (`previewProductImport`, writes nothing): per product,
    Ready or Will be skipped with every problem by row number, notes for an
    unmatched category/brand (imported without it) or a missing price;
    totals of products, variants, stock lines and skips. File-level
    problems — an unknown store, stock the member may not record, a store
    they can't use, duplicate or missing headings — block the whole import.
  - **Import** (`importProducts`) re-checks everything, then creates each
    ready product through `createProduct` (same rules, audit and image
    indexing as by hand) as a **draft**, since photos can't be imported, and
    records opening stock as `IN` movements through `createStockMovement`
    (the ledger, average cost from Cost price). A product whose SKU already
    exists is skipped — updating by import isn't built. A variant product
    without a Product SKU gets one from its name. One
    `inventory.item.imported` audit entry summarises the run.
  - Tests: `lib/inventory/product-import.test.ts` (parser, columns, amounts,
    grouping, row errors, limits, template) and `tests/product-import.test.ts`
    (preview writes nothing; file-level stops for unknown store / no stock
    permission / store access / no create permission; import creates drafts
    with variants, category, brand, stock levels and ledger entries with
    cost; existing SKUs skipped on a second run).
  - **Not built:** updating existing products by import, importing images
    by URL (AGENTS: merchant images are uploaded, never linked).
- **14.3 Notifications.** A `Notification` model, the header bell (removed in 0.4),
  and per-member email preferences. New-order and low-stock emails already send
  but are neither visible in the app nor configurable.
- **14.4 SMS/WhatsApp order updates** for shoppers, alongside email, with the
  same message set as `emails/storefront-order-update.tsx`. Opt-in, and sent
  only for events the order actually went through.
- **14.5 Staff account security.** Own profile and password change (owner
  email verification at sign-up moved to 12.5), 2FA, and "sign out everywhere" (`User.sessionVersion`
  already exists).
- **14.6 Reports hub** at `/reports`: revenue by day and channel, top products,
  top customers, discount and campaign performance, and 8.5's "Which store
  sells" moved here from Inventory.
- **14.7 Returns for counter sales — PAUSED with 10.7** (Phase 2's known gap):
  an in-store return and refund against a `WALK_IN` order, putting stock back
  on that store's shelf. Revisit with the wallet decision.

**Still deferred, with their reasons unchanged:** email campaigns (Phase 5 — needs
unsubscribe, suppression and bounce handling first), paying an invoice online
(Phase 3 — revisit once Phase 10 has settled how money moves), and the merchant
API (12.4).

---

## Phase 15 — Make my store look like me (storefront customisation) — DONE (2026-10-02)

Agreed 2026-10-02, from a "visual storefront builder" proposal checked against
the code and cut down. **The principle: fewer decisions, each making a bigger
and safer difference.** Two clicks (a look and a colour) give a shop its own
identity; nothing lets a merchant break their store, invent content or add
code. This is a curated set of choices, not a website builder.

**The gap.** Phase 6 gave merchants slides, a brand colour, SEO and tracking,
but every shop is still the same page: one font pairing, one button shape, one
card, and a homepage whose sections, order and headings are fixed in
`app/store/[organizationSlug]/(shop)/page.tsx`. Some of those fixed words are
claims the app can't back ("Fresh in this week across every department"), and
the newsletter is fake (below).

**What exists and is reused, not rebuilt:**
- **Tokens.** The whole storefront is themed by `[data-storefront]` variables
  in `storefront.css` (`--brand`, `--radius`, `--font-sf-display`; button
  shapes in one rule). One token layer moves every surface.
- **One product card.** `components/storefront/product/product-card.tsx` is
  shared by grids, carousels, search, image search, recommendations and the
  wishlist, so a card style is a token/variant there, not a new component.
- **Sources.** Sections read products only through `lib/storefront/catalog.ts`
  and `recommendProducts` (`lib/storefront/recommendations/service.ts`). The
  builder names a source; it never ranks or picks products itself.
- **Team preview.** `lib/storefront/opening.ts` already lets an active member
  see a closed shop on the storefront host (the session cookie is on the root
  domain). Draft preview uses the same check. A custom domain doesn't get the
  cookie, so preview always runs on `shop-{slug}`.
- **Destination picker** (slides, campaign announcements) for every section
  button, so no link can point at a page the shop hasn't got.
- **Campaign announcements** stay the one way to shout about a sale. There is
  no separate "promo banner" section.

**Decisions taken (2026-10-02):**
- **One look, then a colour.** The merchant picks one of five looks —
  **Classic** (today's storefront), **Minimal**, **Editorial**, **Bold**,
  **Playful** — and the look sets every token: fonts, type scale, spacing,
  grid density, corners, buttons, cards, image treatment. Then their brand
  colour (`storefrontAccent`, unchanged, still wins over the look's own). A
  collapsed **Fine-tune** offers three overrides at most: corners, font
  pairing, product card. There are no separate layout, typography, button or
  image-treatment pickers: six independent choices is ~10,000 combinations,
  most of them clashing, all of them needing testing.
- **No mobile area and no mobile layouts.** Each section variant decides its
  own small-screen behaviour. The preview has a desktop/tablet/phone toggle.
- **Classic is the absence of a design.** A shop with no saved design gets a
  Classic configuration built on the fly by a pure function from what it
  already has (slides, accent, featured categories). No data migration, no
  backfill, nothing written until the merchant saves: on the day this ships
  every shop looks exactly as it did the day before.
- **Draft and Publish cover design, not content.** The look, colour,
  fine-tune, which homepage sections show and in what order, section
  variants, header and footer layout wait for Publish. Products, slides,
  store pages, categories, collections and campaigns save immediately, as
  today. One sentence for merchants: "Design changes wait for Publish."
- **Sections redefined.** Testimonials → **"What customers say"**, published
  verified reviews only (AGENTS: never invent a merchant's content). Custom
  content → **Image + text**, the merchant's own picture, heading, paragraph
  and button, no HTML. Video waits for an upload path (merchant media is
  uploaded, never linked). Promo banner → campaign announcements.
- **Newsletter removed**, not rebuilt (15.0).
- **Where it lives.** A full-page editor, **Online store → Customize**, in
  the sidebar, replacing the look-and-slides half of Settings → Storefront.
  Tagline, share image and tracking stay in Settings (they're listing and
  measurement, not design).
- **Its own permission, `storefront.design`**, to edit and publish the
  design, so a marketer can change the look without full settings access.
  Reading the editor needs it too; `settings.edit` no longer covers slides.
  Owner resolves to it automatically (`lib/organization.ts`); run
  `prisma/sync-system-role-permissions.ts` so stored Owner/Admin roles get it;
  other existing custom roles don't have it until someone grants it in
  Settings → Roles.
- **Not built, on purpose:** custom CSS, raw HTML, scripts, pixel or
  free-form positioning, separate component trees per look, an AI designer.
  Starting templates come from the `businessType` asked at onboarding, which
  is "suggest a look" without AI.

### 15.0 Honest defaults and quick wins — DONE (2026-10-02)

Small, and **before the first live merchant**: the first item was a false
claim on every storefront.

**As shipped:**
- Newsletter gone: `newsletter-band.tsx` and `newsletter-signup.tsx` deleted,
  the band off the homepage, the form out of the footer, the unused
  `newsletterDismissed` UI state removed.
- Claims removed from fixed copy: "Trending right now / Ordered by what's
  actually selling" → "Popular right now"; "Fresh in this week" gone; the
  category band's "**Eight** departments" (whatever the count) and the
  promises band's "no hoops … if something isn't right" (shown even with no
  returns window) reworded to claim nothing.
- `Organization.storefrontSocialLinks` (JSON, platform → https URL) and
  `storefrontDarkByDefault` (migration `20261002120000_storefront_social_links`).
- `lib/storefront/social-links.ts` (pure): per-platform host allow-list,
  `@handle`/bare-name → link for Instagram, TikTok and X, WhatsApp from a
  phone number (0801… → 234…) or a wa.me link, credentials and fragments
  dropped. Checked on save (field errors in Settings → General, nothing saved
  if any fails) and again on the way out (`readSocialLinks`).
- `StorefrontLook` gained `contact`, `social`, `darkByDefault`; the footer's
  brand column shows contact (mailto/tel links) and a "follow" row of text
  links (lucide 1.16 has no brand icons), each only when set.
- "Open in dark mode" switch in Settings → Storefront. `parseTheme(cookie,
  merchantDefault)`: a shopper's `light` or `dark` cookie always wins.
- Favicon and apple-touch icon from the logo through Cloudinary (64/180px);
  no logo, no icon tag.
- Tests: `lib/storefront/social-links.test.ts` (12: forms accepted, wrong
  host/`javascript:`/bare domain refused, WhatsApp numbers, read-side
  filtering, theme precedence) and 7 more in `tests/storefront-appearance.test.ts`
  (shown only when set, a bad link saves nothing, cleared to null, stored bad
  link dropped on read, permission, tenancy, dark default untouched by other
  saves).

**As planned:**

- **Remove the newsletter.** `components/storefront/layout/newsletter-signup.tsx`
  is a dummy that thanks the shopper ("check your inbox to confirm") and saves
  nothing, and `newsletter-band.tsx` promises "10% off your first order" that
  no discount gives. Remove the band from the homepage and the form from
  `site-footer.tsx`, and delete both components.
- **Replace the fixed claim headings** on the homepage bands with ones that
  are true for any shop ("New arrivals", "Popular right now") until 15.2 lets
  the merchant write their own.
- **Social links** on `Organization`: Instagram, Facebook, TikTok, X,
  YouTube, WhatsApp, LinkedIn. Validated per platform (a URL on that
  platform's host; WhatsApp as a phone number), stored only when set, shown
  in the footer only when set. Edited in Settings → General beside contact.
- **Contact in the footer.** The support email, phone and address already
  collected in Settings → General, shown where filled in.
- **Favicon** from the logo by default; no separate upload until a merchant
  asks.
- **Merchant default light/dark.** Used only when the shopper has no
  `sf-theme-{slug}` cookie; a shopper's own choice always wins. Light and
  dark only — "follow the device" can't be server-rendered without a flash.

### 15.1 Looks, with draft and publish — DONE (2026-10-02)

**As shipped:**
- **Online store → Customize** (`/online-store/customize`, sidebar "Online
  store"), two URL tabs: **Look** and **Front page slides**. Settings →
  Storefront keeps only the tagline, share picture and tracking, plus a
  pointer to Customize. Everything on the new page needs the new
  **`storefront.design`** permission ("Online store" in Settings → Roles);
  slides moved to `features/storefront/slides.ts` under it (their audit
  action names are unchanged, so history reads on). **Run
  `npx tsx prisma/sync-system-role-permissions.ts`** after deploying so stored
  Owner/Admin roles get it; custom roles need it granted.
- **`StorefrontDesign`** (one row per org: `draft`, `published`,
  `draftSavedAt`/`ById`, `publishedAt`/`ById`; migration
  `20261002140000_storefront_design`). The version lives INSIDE each JSON
  document (`version: 1`), so draft and published can be upgraded
  independently; `parseDesign` runs upgrades then a strict zod schema
  (unknown keys refused) and returns null for anything unreadable, which
  renders Classic. No row = Classic from `storefrontAccent` +
  `storefrontDarkByDefault` (now read-only legacy columns).
- **Publish** (`publishDesign(draftSavedAt)`) is one conditional
  `updateMany` keyed on the draft the merchant saw: a draft re-saved in
  another tab is refused ("reload"), never published unseen. Clears the
  draft; audited `storefront.design.published` with the choices. Discard is
  audited too; draft saves are not (no shopper sees a draft).
- **Looks** in `lib/storefront/design/looks.ts` (names, defaults, the light
  background each colour is checked against) and `storefront.css` (palettes
  for light mode only — dark mode is the one shared dark palette in every
  look; rhythm per look). Fine-tune is `data-sf-corners|fonts|cards`.
  **Corners** reach ~130 existing `rounded-*` classes without edits:
  Tailwind compiles rounded-md/xl/2xl from `--radius` (+ fixed offsets) and
  rounded-3xl from `--radius-3xl`, so those are re-pointed; Square sets
  `--radius` below zero on purpose. The handful of `rounded-[Nrem]` became
  `calc(Nrem*var(--sf-radius-scale,1))`, so Classic is pixel-identical.
  **Cards**: `sf-card`, `sf-card-media`, `sf-card-add` hooks on the one
  ProductCard; Minimal hides the add button, Framed boxes the card.
  **Fonts**: Playfair Display and Nunito via `next/font` with
  `preload: false` (verified: only Geist, Geist Mono and Fraunces are
  preloaded); Modern uses Geist. Body text stays Geist in every look.
- **Colour** (`lib/storefront/design/colour.ts`): refused unless white or
  near-black text reaches 4.5:1 on it AND it reaches 3:1 on the look's
  background; the refusal offers the nearest darker shade that passes
  ("Use #… instead"). Text on it is chosen automatically. **Dark mode uses
  the nearest LIGHTER shade that reaches 3:1 on the dark background** — the
  first draft dropped the merchant colour in dark mode, which would have
  hidden most real brand reds and blues. All of it reaches the page only as
  `--merchant-brand*` custom properties that each palette falls back from
  (`lib/storefront/design/tokens.ts`).
- **Preview** is a signed link, not the login cookie, because a shop with
  its own domain is 308'd there and the root-domain session never arrives:
  `createDesignPreviewLink` → `{store}/design-preview?token=…` (HMAC over
  AUTH_SECRET with its own purpose string, bound to member + shop, 1 hour)
  → httpOnly cookie on that host → `/`. The root layout re-checks the member
  (active, this shop, Owner or `storefront.design`) on every request before
  rendering the draft, with a "Draft preview — Exit preview" bar. Verified
  against a running build: member sees the draft, shopper the published
  look, the cookie does nothing on another shop, a forged link sets nothing.
- **Editor**: five look cards (a sketch in the look's own palette, drawn
  from looks.ts data), colour picker + hex box checked as you type, dark
  switch, Fine-tune folded away (each "The look's own (…)" by default);
  sticky bar with Undo changes / Save draft / Preview / Publish (Publish
  saves unsaved edits first), Discard draft behind an AlertDialog,
  unsaved-changes warning. The Preview tab is opened on the click, before
  any await, so pop-up blockers allow it.
- Closing a workspace purges its design (`lib/data-rights/workspace.ts`).
- Tests: `lib/storefront/design/design.test.ts` (15: contrast, text on
  colour, dark shade, suggestion passes, every look's own colour passes,
  strict parse/unknown version/extra keys, Classic from legacy, tokens) and
  `tests/storefront-design.test.ts` (12: Classic with nothing written,
  draft invisible until published, atomic publish + audit, stale draft
  refused, discard leaves live alone, rules refused, unreadable stored
  design renders Classic, `storefront.design` required — settings.edit
  isn't enough, preview link and member re-check incl. suspended member and
  other shop, forged/expired tokens, tenancy).

**Not done in 15.1, on purpose:** per-look dark palettes (one shared dark),
a heading type scale per look (fonts, palette, corners, cards and rhythm
carry the difference), the side-by-side iframe preview (15.3).

**As planned:**

- **`StorefrontDesign`**, one row per organization: `draft` and `published`
  JSON, `version`, `publishedAt`, `publishedById`. Both validated by one zod
  schema (`lib/storefront/design/schema.ts`), versioned explicitly — a later
  shape is a new version with a tested upgrade function, never shape-sniffing.
  An invalid or unknown stored value renders Classic rather than failing.
- **Publish is one update** that copies a validated draft into `published`,
  with an audit entry (`storefront.design.published`). Nothing is partly
  published. Validation re-checks every referenced id against the org.
- **Looks as token sets** in `storefront.css`, keyed by `data-sf-look` on the
  storefront root. Classic is today's values, unchanged.
- **Fonts** via `next/font`, about four pairings, `preload: false` for every
  face but the default, so a shop downloads only its own.
- **Contrast.** Text on brand-coloured surfaces is computed from the colour,
  and a colour that can't reach 4.5:1 either way is refused with a reason.
- **The editor (Appearance tab):** looks as visual cards rendered with the
  real tokens, colour, collapsed Fine-tune; Save draft, Preview, Publish;
  unsaved-changes warning; "Discard draft" behind an `AlertDialog`.
- **Preview** opens the storefront in a new tab with a "Draft — not live"
  banner, for active members with `storefront.design` only.

### 15.2 A homepage made of sections — DONE (2026-10-02)

**As shipped:**
- **Sections live in the design** (draft/published, so arranging the front
  page will wait for Publish like the rest of the design). The design
  document is now **v2**: `sections` (null = the Classic front page), with
  the first real upgrade step, v1 → v2 (`sections: null`). No migration —
  it's inside the JSON.
- `lib/storefront/sections/schema.ts` (pure, for the 15.3 editor): a strict
  discriminated union of the nine section types the page already had —
  hero, shopping-missions, recommended, recently-viewed, products
  (variant carousel|grid, title, source), price-explorer,
  deal-of-the-day, category-showcase, service-features. List rules: the
  hero is always first and enabled (it mounts the discovery tools and the
  assistant, and the mission/budget tiles publish to it), one hero, unique
  ids, at most 24. `classicSections()` is today's page in today's order.
- **Sources**: bestselling, newest, tag, collection, category, brand —
  resolved by `getSectionProducts` in `catalog.ts` (the seam), so a band
  can only show what the shop sells. Bestselling/newest reuse the exact
  picks the homepage always made (same fallback, same sizes). Personalised
  and recently viewed are their own section types, since the
  Recommendation Service and the browser decide those. A deleted, hidden,
  emptied or foreign reference returns null and the section is left out.
- **The registry**: `components/storefront/home/homepage-sections.tsx` —
  one `define('type', { load, render })` per type; `satisfies
  Record<SectionType, unknown>` makes a missing entry a compile error.
  Shared reads (currency, price bands, look, tree) are fetched once per
  page. Two passes so "Recommended for you" excludes what the product bands
  already show, as before. The page itself is 10 lines.
- **One design decision per request**: `getRequestDesign` (catalog.ts →
  `lib/storefront/design/request.ts`, React-cached) is read by both the root
  layout and the homepage, so a preview can't show a draft look with
  published sections or the reverse.
- **Acceptance, done for real**: the built app rendered three seeded shops
  before and after the change — visible HTML identical (0 differing lines
  of ~1,090 after stripping scripts, nonces and chunk hashes), and the
  recommendations' exclude list identical. A published arrangement
  (reordered, a tag band, a deleted-collection band, a hidden band) renders
  as configured with the dead band silently absent.
- Tests: `lib/storefront/sections/sections.test.ts` (10: Classic order and
  validity, hero rules, duplicates, limit, unknown types/extra keys/bad
  variants, sources, v1→v2 upgrade, invalid sections drop the design) and
  `tests/storefront-sections.test.ts` (9, real catalogue: legacy bands pick
  the same products, each source and its link, hidden/empty/deleted/foreign
  give no band, published vs draft sections, broken stored sections →
  Classic).

**As planned:**

No visible change: it moves the homepage onto the structure 15.3 edits.

- **Section registry** (`lib/storefront/sections/`): per type its name,
  allowed variants, zod settings schema, default, and server renderer. The
  homepage maps the configured list through the registry — no switch in the
  page.
- **Sources:** collection, category, brand, tag, bestselling, newest, for
  you, recently viewed — each a call into `catalog.ts` or
  `recommendProducts`. A deleted or hidden reference drops the section (or
  the item), never errors.
- **Classic, rebuilt as sections,** renders the same page as today: the
  acceptance test.
- The discovery hero/strip and the assistant behave as in Phase 6 whatever
  the section order.

### 15.3 The homepage editor — DONE (2026-10-02)

**As shipped:**
- **Online store → Customize** now has three URL tabs: **Look**, **Front
  page**, **Slides**. All three stay mounted (closed ones hidden), and each
  editor resets its baseline on *when* something was saved, not on object
  identity — so switching tabs never throws away unsaved edits, and a save
  on one tab doesn't wipe unsaved edits on the other.
- **Front page tab** (`HomepageEditor.tsx`): the section list with show/hide
  switch, up/down buttons (drag-and-drop as a shortcut only), inline edit
  of a product band (heading, "Products from" — best sellers, newest, a
  tag, a collection, a category path, a brand — and Scrolling row/Grid),
  "Add a section" (a product band, or any one-of section not on the page),
  Remove and "Start over" (back to Classic) behind AlertDialogs. The top
  section shows "Always first" and has no controls. Save draft / Publish /
  Undo changes in a sticky bar; Publish saves first.
- **One draft, two owners.** `saveHomepageDraft(sections)` replaces only the
  sections, starting from the draft, else what's live, else Classic; the
  Look tab's `saveDesignDraft` now sends no sections and the server keeps
  whatever is saved. Publish still puts the whole draft live in one update.
- **References are checked** on save and again on publish
  (`checkReferences`): every collection, category and brand a band names
  must be this shop's and visible. A collection hidden after the draft was
  saved blocks the publish with the band's name ("“Picks” shows a
  collection that no longer exists or is hidden").
- **Side-by-side preview** (`PreviewPane.tsx`, large screens; smaller ones
  get "Preview in a new tab"): the real storefront in an iframe at true
  desktop (1280) / tablet (820) / phone (390) width, scaled to fit; a fresh
  signed link on open, after every save, and on Refresh; says so when there
  are unsaved changes. Only loads while the tab is open.
- **Framing, narrowly** (`lib/security/csp.ts`, `proxy.ts`,
  `next.config.ts`): an admin page may frame only its own shop's platform
  storefront origin (`frame-src`); a storefront request is framable only
  while a design preview is open — the `/design-preview` link or a page
  carrying the preview cookie — and only by that shop's own admin origin
  (`frame-ancestors`). Everything else keeps `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` (now a `missing`-conditioned header rule, since
  XFO can't name an origin). The frame always uses the PLATFORM address
  (`createDesignPreviewLink({ frame: true })`), and the proxy no longer
  308s a preview request on it to the shop's custom domain — the admin's
  session and the frame rules only work there. Gotcha found on a live
  build: the proxy runs again on its own rewrite
  (`/store/{slug}/design-preview`), so the preview-path test matches both
  forms.
- **Verified on a running build**: admin `frame-src` = its own storefront
  only; preview link → 303 + cookie + `frame-ancestors` = that admin, no
  XFO; a page with the cookie → 200 on the platform address, same
  ancestors; without it → 308 to the custom domain with XFO DENY; another
  shop → `frame-ancestors 'none'`. **Not verified in a real browser**: the
  editor screens themselves and the iframe rendering (no browser in the
  build environment) — worth one click-through before relying on it.
- Tests: `lib/security/csp.test.ts` (+1: frames nothing unless given one
  origin) and `tests/storefront-design.test.ts` (+7: front page and look
  save independently, an arrangement starts from the live look, foreign /
  hidden / missing references refused, publish refused after a collection
  is hidden, list rules, permission, the frame link uses the platform
  address even with a custom domain).

**As planned:**

- A list of sections: show/hide, move up/down buttons (drag as a shortcut,
  never the only way), edit heading and subheading, choose the source, add
  from a short menu, remove behind an `AlertDialog`.
- **Side-by-side preview**: the real storefront in an iframe at
  desktop/tablet/phone widths. This needs a narrow CSP exception — today
  `frame-ancestors 'none'` (`lib/security/csp.ts`) and `X-Frame-Options:
  DENY` (`next.config.ts`) forbid all framing. Only the draft-preview route,
  and only the org's own admin host as ancestor.

### 15.4 Section variants and new sections — DONE (2026-10-02)

**As shipped:**
- **Layouts**: hero `full` (words over the picture, as before) | `split`
  (words beside the picture, on the slide's aligned side, in theme colours
  — no wash, light/dark text no longer applies); product band `carousel` |
  `grid` | `feature` (one large product beside the next four,
  `product-feature.tsx`); categories `tiles` (as before) | `circles` |
  `list` (names only, for shops without category pictures).
- **New sections**: **Image and text** (heading required, up to 600
  characters of plain text with line breaks kept, optional picture —
  Cloudinary URL in the schema, uploaded by THIS shop checked on save and
  publish via `isOrgAsset` — picture left/right, optional button with both
  halves, linked only to a page on the shop through the same destination
  picker as slides; nothing pre-written, a new one starts with an empty
  heading); **Brands** (`getBrandShowcase`: only brands with something on
  sale, alphabetical, name when there's no logo); **What customers say**
  (`getStoreReviews`: recent PUBLISHED 4- and 5-star reviews of products
  the shop still sells, newest first, with the product — and the section
  says "Recent 4- and 5-star reviews from customers whose orders were
  delivered", so it never implies every review is glowing; hidden with
  none).
- **No design version bump.** New fields on existing section types carry a
  `.default()` equal to how they rendered before (`variant: 'full'`,
  `'tiles'`), so every stored document still parses and looks the same —
  rule written into `lib/storefront/sections/schema.ts`. Verified on a
  running build: both seeded Classic homepages identical to the 15.2
  baseline (0 differing lines).
- **Editor**: an Edit button on the hero (slide layout — explains it only
  applies with slides), product bands (+ "One large, then a grid"),
  categories (layout) and image-and-text (heading, words with a character
  count, picture uploader, picture side, button words + "Goes to" picker);
  list summaries say each layout; save blocks on a missing heading, a
  half-button or an upload still running.
- A showcase shop using every new layout and section was rendered on a
  running build and each appeared as configured, with a disabled section
  absent.
- Tests: `sections.test.ts` (+6: old documents get the old layouts, unknown
  layouts refused, image-and-text plain values only, button only to a shop
  page with both halves — `//evil`, `https:`, `javascript:` refused —
  picture only from the image host, brands/reviews) ·
  `storefront-sections.test.ts` (+3: reviews — only published ≥4 of this
  shop with the product; hidden, 3-star and foreign excluded; empty shop
  → none; brands only with products on sale) · `storefront-design.test.ts`
  (+2: own upload saved, another shop's refused).

**Not built, on purpose:** video (no upload path yet), testimonials typed
by the merchant (only verified reviews), a merchant-chosen minimum rating
(fixed at 4 and stated on the page), deleting an image-and-text picture
from Cloudinary when it's replaced in a draft (the draft may not be
published; orphans are left rather than risking a live picture).

**As planned:**

- Hero: full image, split. Products: grid, carousel, one large plus a grid.
  Categories: tiles, circles, list.
- New: **Image + text**, **Brands**, **What customers say** (published
  verified reviews; hidden when there are none).

### 15.5 Header and footer — DONE (2026-10-02)

**As shipped:**
- **In the design**, so they wait for Publish with everything else:
  `header: { layout: 'standard' | 'centered' | 'search' }` (default
  standard) and `footer: { columns } | null` (null = the Classic footer).
  Added inside v2 with defaults equal to the old header/footer — older
  documents parse and look the same, no version bump.
- **Header layouts** (`site-header.tsx`, one set of controls in the same
  order in every layout): **standard** (as before, markup unchanged apart
  from a `data-sf-header-layout` attribute); **centred** (name or logo in
  the middle, menu + search button on the left, bag and account on the
  right; search through the overlay); **large search** (the search box is
  shown from the first pixel on every page, and phones get their own
  full-width search row).
- **Footer** (`lib/storefront/design/footer.ts`, pure `arrangeFooter`):
  the four worked-out columns — Shop, Your account, Help, About us — can
  be reordered or hidden but are still built from the shop's own data and
  never retyped; Help and About only exist when a page for them is
  published, whatever the setting. Plus **one column of the merchant's
  own**: a heading and up to 6 links, each to a page on the shop through
  the destination picker (`shopPath` in the schema — `//`, `https:`,
  `javascript:` refused). The name, contact details and social links stay
  first and are edited in Settings → General.
- **Customize** gained a fourth tab, **Header & footer** (`ChromeEditor`):
  header layouts as cards, the footer columns with show/hide and
  earlier/later buttons, "Add your own column", its heading and links
  editor, Remove behind an AlertDialog, and the same side-by-side preview,
  Save draft / Publish bar and unsaved-edit protection as the other tabs.
  `saveChromeDraft` saves only header + footer; the Look tab's save now
  keeps sections, header and footer as saved (`sameLook` compares only the
  look).
- **Verified on a running build**: both Classic shops identical to the
  15.2 baseline except the new attribute; a centred shop rendered its
  footer as About us · Good to know (its own links) · Shop, with the
  account column hidden and Help absent for want of a published page, and
  the contact column still first; a large-search shop showed the desktop
  box from the start on the homepage and its phone row.
- Tests: `lib/storefront/design/footer.test.ts` (8: Classic order, the
  shop's order and hiding, Help/About only with pages, own column placement
  and rules, old documents get the old header/footer, header layouts,
  footer refusals, `sameLook`) and `tests/storefront-design.test.ts` (+3:
  header/footer saved independently of look and front page, live on
  publish, off-shop link and permission refused).

**As planned:**

- Three header layouts: standard, centred logo, large search.
- Footer columns reordered or hidden, plus one column of the merchant's own
  links (destination picker). Derived content (payment note, page links,
  contact, social) stays the default and is never retyped.

### 15.6 Starting looks — DONE (2026-10-02)

**As shipped:**
- `lib/storefront/design/starting-looks.ts` (pure): four starting looks —
  **Fashion and beauty** (Editorial, centred header, split hero, New
  arrivals as a feature band, category tiles, popular, for you, reviews),
  **Electronics and gadgets** (Bold, large search, deal of the day, best
  sellers grid, category circles, brands, just in, budget, reviews),
  **Groceries and everyday** (Playful, large search, category circles,
  deal, On offer from the `sale` tag, popular grid, missions) and
  **Classic** (the standard front page). Every business type asked at
  sign-up maps to one (beauty → fashion, health → grocery, home/books/other
  → Classic); unknown or none → Classic.
- **No invented content.** A starting look holds only choices from the
  editor's fixed lists and bands that name a source; no image-and-text
  (that's the merchant's words), and a band with nothing in it isn't shown.
- **Applying one** (`applyStartingLookToDraft`, Look tab → "Start from a
  ready-made look", the business's own marked "Suggested for your shop",
  confirmed in an AlertDialog): replaces the DRAFT's look, front page and
  header and clears Fine-tune; keeps the brand colour, light/dark, footer
  and slides. A kept colour that wouldn't stand out on the new look is set
  aside and the merchant is told which, rather than the apply failing.
  Live shop untouched until Publish. The Look tab takes the new baseline
  even over unsaved edits there (the merchant confirmed the replacement).
- **New shops** start on the suggested look: `bootstrapOrganization`
  writes it as the PUBLISHED design in the same transaction (the shop is
  closed until the merchant opens it, so nobody sees it early). Classic
  writes nothing — no design is Classic.
- Bug caught by its own test: the business-type lookup used `in`, so
  `"__proto__"` matched an inherited property; now `Object.hasOwn`, like
  `isBusinessType`.
- **Verified on a running build**: a shop on each non-Classic starting look
  rendered its look, header layout and sections in order, with sections
  whose source was empty (reviews) absent.
- Tests: `starting-looks.test.ts` (7: each is a valid design, what it
  brings and clears, what it keeps, no merchant words, Classic is the
  standard page, every business type has one, unknown/none/`__proto__` →
  Classic) · `storefront-design.test.ts` (+4: suggestion from the business
  type, applied to the draft only keeping colour/dark/footer, an unsuitable
  colour set aside and named, unknown id and permission refused) ·
  `onboarding.test.ts` (a new fashion shop is created with the Editorial
  starting look published, no draft).

**As planned:**

- A look plus a section set per business type (fashion, electronics,
  grocery, general). Applied to the draft, previewed, then published. A new
  shop starts with the one for the `businessType` it gave at onboarding.

**Follow-up (2026-10-03): which starting look is in use.** The design now
records `startingLook` (set when one is applied, and for new shops at
creation; kept by every tab's save). `startingLookStatus` (pure) compares
what a starting look decides — look, Fine-tune, header, front page, never
colour/dark/footer — with that record, key-order independently, and says
whether it's been changed since; a design with no record is matched
against all of them (so a standard shop reads as Classic, a hand-arranged
one as "your own design"). The Look tab shows "On your shop now: …" and
"In your draft: …", outlines the card in use, badges it "On your shop" /
"In your draft" (with "· changed"), and its button reads "In use"
(disabled), "Reset to this look" or "Start from this". Seen in a real
browser: signed in headlessly with puppeteer and screenshotted the section.
Tests: +6 status cases, plus the record surviving a Look save and being
set on new shops.

### 15.7 Looks that look different — DONE (2026-10-02)

Found by rendering every look in a real browser (puppeteer + Chrome against
a running build): the looks worked, but read as too alike. Three fixes:

- **Corners reach every pill-shaped control.** 135 `rounded-full` pills in
  69 storefront files — buttons, chips, search bars, "View all", status
  labels — now use `rounded-[var(--sf-radius-button,999px)]`, so Square and
  Soft looks are square/soft throughout. True circles (icon buttons, dots)
  and the tiny count badges stay round.
- **Each look has its own dark palette** (Minimal graphite, Editorial
  espresso with a terracotta accent, Bold true black with a lighter blue,
  Playful deep plum with lavender); before, dark mode was Classic's for
  every look. Product tiles stay light. `LookInfo.darkBackground` per look:
  a merchant colour is lifted against THAT look's dark background. All
  default pairs AA (body text 15:1+, muted 7:1+).
- **Minimal and Editorial are distinct from Classic**: Minimal crisp white
  with cool greys and lighter, tighter headings (600, −0.035em); Editorial
  warm paper (#f3ede2), ink-brown text, an oxblood accent (#8a3324) as its
  own colour, lighter serif headings (500).
- **Classic is untouched**: its screenshots are byte-identical before and
  after, light and dark.

**Later, only if merchants ask:** a navigation builder (category-derived
menus stay the default), video, AI-suggested changes that produce validated
configuration for the merchant to approve, community sections. The registry
leaves room for each.

**Tests, every part:** tenant isolation on read, write, preview and publish;
`storefront.design` on every action; invalid configuration refused on save and
rendered as Classic if stored; publish atomic and audited; Classic matches
today's output; contrast refusal; `npm run test:local` and `next build`.

---

## Sequencing

**Phase 2 before Phases 4 and 7.** If walk-in sales land on `Order` with a `channel`
field, customer metrics and every report count both channels for free. If they get
their own model, two sets of numbers need reconciling forever — a decision that is
cheap now and very expensive in six months.

**Phase 4 before Phase 5.** Email campaigns need segments and a consent field.

**Phase 1 any time** — it depends on nothing and the data is already being written.

**Phase 8 in order, and 8.6 last.** 8.1 builds the page the other five hang off,
and every one of 8.2–8.5 puts something on it. 8.6 changes what existing actions
accept, so it lands once those actions have stopped moving — and it is the only
part with a migration.

**Phase 9 in order: 9.1 → 9.5 stop the loss, 9.6 is needed to run it.** 9.1–9.3 alone
(planner prefers one store, fees summed across stores) already stop most of the
leakage before the shipment screen exists. 9.7 and 9.8 are improvements and can wait.

**Go-live: 10.1 before everything; 13 before the first live merchant; 12 before
the public launch; 14 after it.** The current build order is **"What's next"**
at the top of the Go-live section (updated 2026-09-29); the notes below are the
reasoning behind it.

- **Phase 10 first.** 10.1 is decided (Paystack subaccounts and split
  settlement), but the Paystack behaviour it lists must be verified before
  10.3–10.6 are coded, and the regulatory question goes to legal advice in
  parallel. Inside the phase: 10.11 and the provider seam from 10.4 → 10.2/10.3
  (onboarding and subaccounts) → 10.4/10.5 (paying) → 10.6 (the payments view)
  → 10.9 (retiring Squad). **10.7 (refunds) is paused** pending the wallet
  partnership and is not a launch gate. Nothing that takes online payment from
  a real shopper ships before 10.3, 10.5 and 10.8, or before 10.10's legal
  review.
- **Parts of 11 before Phase 10 goes live.** A subaccount is only created when
  platform staff approve a merchant, so 11.1 (access) and 11.3 (verification
  queue) must ship with Phase 10; the rest of Phase 11 can follow.
- **12.5 before the public launch, with 14.2 (CSV import) pulled forward into
  it.** The trial (12.1) starts inside onboarding, and the setup guide's
  payment step needs 10.2 (done), so 12.5 lands after 12.1.
- **12.6 (custom domains) after 12.5, with 11.5.** Its entry point is an
  optional step in 12.5's guide, its prices need 11.7's exchange rate, and it
  is fulfilled by hand through 11.5's queue. Automation (13.5) is after launch.
- **12.1 and 11.7 before the first paying merchant.** With no free plan, nobody
  can use the platform without a plan to buy. The catalogue (12.1) and the
  console that edits it (11.7) land together. Seeding the catalogue from
  today's `PLANS` lets 12.1 ship first, with 11.7 following before prices need
  to change.
- **The rest of 11 alongside 10.** Suspending a store (11.4) must exist before
  a store can take money.
- **12 and 13 in parallel with 10/11.** They touch different code. 12.2 is
  small, and 12.1 unblocks onboarding anyone at all; 13.1 (scheduled jobs) and 13.2
  (shared rate limits) are required the moment there is more than one instance.
- **14 after launch,** in the order merchants ask for it. 14.1 (tax) and 14.2
  (import) are the likeliest first.
- **Phase 15 in order.** 15.0 before the first live merchant (it removes
  false claims). 15.1 builds the draft/publish record every later part saves
  into; 15.2 must render today's homepage unchanged before 15.3 lets anyone
  edit it; 15.4–15.6 each add to the registry and the editor and can swap
  places.

## Smaller cleanups — DONE (2026-09-25)

The four from the audit, plus everything of the same kind found while doing them.
All display-layer or query-shape work; no behaviour a merchant chose was changed.

- **Access denied, once.** Fifteen pages hand-rolled their own block; all now use
  `components/layout/access-denied.tsx` (AGENTS §9) — sales, quotes, invoices,
  returns, fulfillment, procurement, purchase orders, suppliers, supplier
  performance, roles and the cycle-count detail page.
- **Money through one formatter** (AGENTS §6). Bare `toFixed(2)` is gone from the
  admin: quotes (list, detail, create), purchase orders (list, detail, create),
  the payment dialog and the supplier report — each now `formatMoney` with the
  document's own currency where it has one. Two local copies of `formatMoney`
  (the sales landing page and the supplier report) are deleted. The only
  `toFixed` left in the app is the storefront's JSON-LD, where a machine reads
  `"1234.00"` and that is the correct output.
- **Dates through one formatter.** `toLocaleDateString()` — which drifts between
  server and client — is gone from quotes, invoices, fulfillment, purchase
  orders, the supplier report, billing and the invitations table.
- **No raw enums on screen.** `.replace('_', ' ')` and bare `{status}` are gone
  from purchase orders, fulfillment, quotes, invoices, suppliers and billing;
  they use `enumLabel`, so `PARTIALLY_RECEIVED` reads "Partially received".
- **The sales landing page** is now `PageHeader` + `StatGrid` with clickable
  stats (AGENTS §2), and its figures come from the new
  `features/sales/overview.ts` — four counts and one aggregate in the database.
  It used to load every quote, every invoice and every customer to work out four
  numbers, which grew with the business and put every customer's email into the
  page source. "Unpaid" is invoiced minus paid on invoices still owed; "overdue"
  is the same rule the invoice list uses; a merged customer is counted once.
- **The supplier plan gate, fixed the other way round.** The detail page IS a
  performance report, so the `REPORTS_ADVANCED` gate was right — the bug was a
  clickable row that bounced a non-Pro merchant to `/upgrade` with no
  explanation. Rows now lead there only when the plan includes it, and the list
  says in one line what the report shows and where the plans are (AGENTS §7).
  The suppliers page also gained `PageHeader`/`PageBody` and a real
  `EmptyState`.

Tests: `tests/sales-overview.test.ts` (2 — the four figures, including a merged
customer counted once and an invoice with no due date never being late).

**Noted, not built:** the invoices list has no overdue filter, so the landing
page's "Overdue invoices" tile links to the list plainly rather than carrying a
`?status=overdue` nothing reads. Worth adding with Phase 7's reports work.
