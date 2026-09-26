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
