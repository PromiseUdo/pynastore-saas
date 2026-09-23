<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Roadmap

`docs/ROADMAP.md` holds the agreed build plan: the phases, what gap each one closes,
and the design decisions already taken (e.g. walk-in sales go on `Order` with a
`channel` field, campaigns write scheduled price overrides rather than editing
`sellingPrice`). Read the relevant phase before starting work on it, and update its
status there when it ships.

# Admin dashboard UI rules

These rules cover everything under `app/(dashboard)/`, `components/layout/`, `components/dashboard/`, `components/members/` and `components/ui/`. The customer storefront (`app/store/`, `components/storefront/`) has its own look and does **not** follow these rules. Never mix the two: no storefront tokens (`bg-brand`, `font-display`, `.sf-*`) in the admin, and no admin tokens in the storefront.

The goal is a calm, professional tool that a busy shop owner or warehouse clerk understands without training. When a rule and a clever idea conflict, choose the option that is easier to understand.

## 1. Look and feel
- **Theme:** neutral slate surfaces with an indigo `--primary`, Geist Sans, 6px radius, very light shadows. Use the tokens in `app/globals.css` (`bg-card`, `text-muted-foreground`, `border`, `bg-primary`…). Do not hard-code hex or oklch colours in components.
- **Status colours** always come from `<Badge variant>` (`success`/`warning`/`destructive`/`info`, or the workflow variants `draft`/`pending`/`approved`/`completed`/`rejected`/`cancelled`/`processing`/`overdue`). Colour is never the only signal: every badge has a text label.
- Every new surface must work in light **and** dark mode (`.dark` class). Check contrast in both.
- **Type scale:** page title `text-lg font-semibold`; section title `text-sm font-semibold`; body `text-sm`; helper text `text-xs text-muted-foreground`. Put `tabular-nums` on numbers in tables and stat cards.

## 2. Page anatomy (every page looks the same)
1. `PageHeader` from `components/layout/page-header.tsx` shows the title, a one-line description in plain language, and actions on the right. Use at most **one** primary button there; other actions are `outline`/`ghost` buttons or go in a `⋯` menu. Do not build the header by hand.
2. Optional `PageToolbar` holds search, filters and bulk actions.
3. `PageBody` holds the content.
- Detail pages show a back link to the parent list, the record's title, its status badge, and the key facts (customer, totals, dates) in a summary card **above** the line-item tables.
- Module landing pages (`/inventory`, `/sales`, `/procurement`) use `StatCard`/`StatGrid`. Each stat is clickable and leads to the list it counts. Show "needs attention" callouts (low stock, overdue, awaiting approval) with a direct action link.

## 3. Lists and tables
- Use the `components/ui/table.tsx` primitives inside `TableWrapper`, which scrolls horizontally on small screens.
- Any list that can grow beyond about 20 rows needs **search, the most useful filters (usually status), and pagination** (`TablePagination`). Keep filter/search/page state in the URL (`searchParams`) so it survives refresh and can be shared.
- If a row opens a record, the whole row is clickable **and** the identifier is a real `<Link>`, so keyboard users and middle-click still work.
- Right-align numbers and money. Show `—` for empty values, never `null`, `undefined` or blank.
- Every list has three states: **empty** (icon, one sentence explaining what the thing is, and a primary action to create the first one, or a note on what must exist first); **no results** for a search or filter (with a "Clear filters" action); and **error** (a friendly message plus a retry, never a raw error string).

## 4. Forms and dialogs
- Use a `Dialog` for short create/edit forms of 6 fields or fewer. Use a `Sheet` or a full page for long forms, or forms with line items.
- Every input has a visible `Label`. Required fields are marked. Helper text explains unfamiliar terms (e.g. "Reorder point: when stock falls to this number, we'll alert you").
- Validate on submit. Show each error next to its field, and a summary at the top for server errors. Keep what the user typed when an error happens.
- The submit button shows a spinner and is disabled while pending. The button label is a verb that names the result ("Create invoice", not "Submit").
- Sensible defaults: preselect the only or most-used store, default dates to today, set currency from the org.
- Destructive or irreversible actions (void, delete, reject, cancel PO, remove member) always go through `AlertDialog`. It states the consequence in plain words and uses a `destructive` button. Never use `window.confirm`/`alert`.

## 5. Feedback
- Every mutation gives visible feedback: a success toast (sonner, mounted once in the dashboard layout) plus `router.refresh()`, or an inline error. Never fail silently.
- Use `loading.tsx` skeletons (the `Skeleton` component) for route segments that fetch data, so navigation never looks frozen. Use `error.tsx` boundaries for failures.
- Workflow records (PO, invoice, fulfillment, return, cycle count, transfer) show where they are in the lifecycle: a status badge plus a short hint of the next step ("Awaiting approval — an Admin must approve before ordering").

## 6. Language and formatting
- Write in plain language, for business owners rather than developers. Say "Store" in the UI, not "Warehouse". Never show raw enum values: map `PARTIALLY_PAID` → "Partially paid" through a shared label helper, and don't use `.replace('_',' ')`.
- **Money** always goes through one shared formatter using the org's currency (currently NGN/₦). Never use a bare `toFixed(2)` or hard-code `$`.
- **Dates** go through one shared formatter (e.g. "14 May 2026"; relative time such as "2 hours ago" for activity). Never use a bare `toLocaleDateString()`, which varies between server and client.
- Sentence case for titles, buttons and menu items ("New invoice", not "New Invoice").

## 7. Permissions, plans and navigation
- Hide actions the user can't perform (server checks `hasPermission` and passes `can*` flags down). If a whole page is forbidden, render the shared access-denied state. Don't copy-paste a new one.
- Plan-gated features are **not** hidden in navigation. Show a lock or upgrade hint that explains what the feature does and links to `/upgrade`.
- Every sidebar entry must lead to a real page. Don't add nav items or header controls (search, notifications) that do nothing; build them or leave them out.
- Links are slug-free (hostname-based tenancy; see `proxy.ts`).
- **Hostnames.** Every platform host is one label under `NEXT_PUBLIC_ROOT_DOMAIN`: `{PLATFORM_HOST}` (marketing/auth, `app.` in production), `{slug}.` (admin), `shop-{slug}.` (storefront), `m.` (mobile). Never build one of these by hand — use `getMarketingUrl`/`getAdminUrl`/`getStorefrontUrl` in `lib/tenant/urls.ts`, and `storefrontHostsFor()` in `lib/tenant/resolveHostname.ts` if you need the host itself. A slug is therefore a hostname, so new orgs are checked against `lib/tenant/reserved-slugs.ts`; existing orgs are never renamed.

## 8. Responsive and accessible
- The admin must work on a tablet and stay usable on a phone. Below `lg`, the sidebar becomes an off-canvas drawer, and page actions wrap instead of overflowing.
- All interactive elements are real `button`/`a` elements with visible focus rings, and icon-only buttons need an `aria-label`. Dialogs trap focus and close on Escape (Radix does this, so don't bypass it).
- Minimum touch target is 32px (36px or more for primary actions on touch layouts).

## 9. Reuse before building
Before writing any new UI, check `components/ui/`, `components/layout/` and `components/dashboard/`. If a pattern appears on a second page (status label map, money cell, empty state, access denied, confirm dialog), extract it into a shared component instead of copying it.

Shared pieces that already exist — use them:
- `lib/format.ts` — `formatMoney`, `formatMoneyRange`, `formatNumber`, `formatDate`, `enumLabel`.
- `components/layout/empty-state.tsx` (`variant="filtered"` when a search hid everything), `components/layout/page-tabs.tsx` (tab selection lives in the URL).
- `components/dashboard/export-csv-button.tsx` + `lib/csv.ts` — every report offers its rows as a spreadsheet, matching the filters on screen.
- `components/ui/toaster.tsx` (mounted in the dashboard layout; call `toast` from `sonner`), `components/ui/switch.tsx`.
- `components/layout/access-denied.tsx`, `components/layout/route-error.tsx` (pass Next's `unstable_retry` from `error.tsx`).
- `components/media/image-uploader.tsx` — all merchant image uploads (signed direct uploads to Cloudinary, see `lib/cloudinary/`). Never accept pasted image links for new features.
- `app/(dashboard)/[organizationSlug]/inventory/_components/CategorySelect.tsx` — any category picker.
- Reference implementations: `inventory/products` (URL-driven list with views/filters/pagination; full-page editor with checklist and sticky save bar) and `inventory/categories` (tree + sheet form).

## 10. Reports
A report states, in one line under the toolbar, what it measures and how it's worked out, and leads with the few figures that matter (`StatCard`) before the table. Say what a number cannot tell you rather than hiding it — the profit report names its sale-date and cost basis. Never present a ratio as a percentage without multiplying it: a field is either named `…Ratio` (0–1) or `…Pct`, and the type says which.

## 11. One catalogue
Inventory products ARE the online store's products. Online-store fields (web address, images, tags, publish state) live on `InventoryItem`; only stores with `Warehouse.sellsOnline` supply online stock. Don't create a separate storefront product model.

Merchandising lives under Inventory: categories (what a product is), collections (why products are grouped — hand-picked or rule-based), brands (who makes it). All three are managed with `inventory.category.manage`. A **web address is never regenerated on rename** — links customers saved must keep working; only a new record gets one generated, and only an explicit edit changes it.

# Social Commerce rules

One Meta app belongs to the PLATFORM (`META_APP_ID`/`META_APP_SECRET`, server-side only). Merchants never supply credentials, never see a token, and never enter an app key: they authorise the one MansaaS app against their own Facebook account, and what we keep is a per-store connection.

**Three pages, one nav** (`components/social/social-nav.tsx`): Connected accounts (`/social`), Create post (`/social/compose`), Post history (`/social/posts`, detail at `/social/posts/[postId]`).

**The seam.** Everything goes `server action → lib/social/service.ts | publish.ts → registry.ts → providers/*`. No Graph call outside `lib/social/providers/`, and no Facebook-specific branch in a page or component — platform differences arrive as `provider.publishRules(platform)`. TikTok is a declared provider that fails closed; see the TODO in `providers/tiktok.ts` before implementing it.

**Tenancy.** Every social function takes `organizationId` as its first argument, from `getOrganizationContext()` — never from a form. A connection, post, product or image id from the browser is only ever used TOGETHER with it (`where: { id, organizationId }`), so another store's id is a miss, not a leak. The OAuth callback is the one place without tenant headers (`/api` is outside the proxy matcher): the org travels in an HMAC-signed state and is re-authorised against a fresh membership read before anything is written.

**Permissions.** `social.view` to see accounts and history; `social.manage` to connect, disconnect, publish, retry or remove. The composer also needs `inventory.view`, since it browses the catalogue. No plan gate — Social Commerce is on every plan.

**Post statuses** are `DRAFT → PUBLISHING → PUBLISHED`, or `FAILED` (retryable back into `PUBLISHING`). Nothing reports `PUBLISHED` without an id from the platform. `PUBLISHING` is claimed with a conditional update and `(organizationId, idempotencyKey)` is unique, so a double-click posts once. A row stuck in `PUBLISHING` is released to `FAILED` after five minutes, opportunistically, when someone loads the history — no cron.

**Failed posts stay.** They keep caption, images and destination so "Try again" is a real retry of that record (`retryPost`), rate-limited by `lib/social/publish-quota.ts`. Only a `DRAFT` or `FAILED` post can be removed, and removing it forgets OUR record — MansaaS never deletes anything from Facebook or Instagram.

**History is queried in the database.** Status, platform, search, date range, product and page live in the URL and become Prisma `where` clauses. Never load a store's history into the browser to filter it there.

**AI copy is a draft, never a publish.** Gemini reaches only `ProductFacts` (`lib/social/product-facts.ts`) — the merchant's own rows — and its output is fact-checked by `lib/ai/social/validate.ts`, which strips any price, discount, stock, delivery or warranty claim those rows don't support. A merchant edits and presses Publish themselves.

**Say what the platform actually does.** An Instagram caption can't hold a clickable link, so we leave the product URL out rather than post a dead one; a Facebook Page post uses one image, because Meta documents single-photo publishing and we don't build on undocumented behaviour. Both are stated in the composer, not hidden.

# Storefront data rules

The customer storefront reads the merchant's real records. These rules keep that safe.

- **One seam.** Pages, components and API routes read the catalogue only through `lib/storefront/catalog.ts`. Never import `lib/storefront/data/*` or `lib/storefront/mock/*` anywhere else.
- **Every read names its store.** Pass `store: { organizationSlug }` when you have it; a storefront page request can otherwise fall back to the `x-org-slug` header the proxy sets. `/api/storefront/*` routes are outside that rewrite, so they MUST take the slug from the caller and pass it down. Serving one merchant's catalogue under another's domain is the one bug this layer may never have.
- **Server only.** `catalog.ts` reaches Prisma. Client components use `lib/storefront/product-helpers.ts` (variant/price helpers) and `lib/storefront/nav-types.ts` (nav shape and links) instead. Run `npx next build` after touching this boundary.
- **Never invent a merchant's content.** No fabricated reviews, ratings, testimonials, Q&A, press, social posts, urgency countdowns or campaign copy. If there's no source for it yet, show nothing and let the page's empty state do the talking. Claims about delivery, returns or payment must restate what the app actually enforces.
- **Reviews are earned, not collected.** A review can only be written by a signed-in shopper with a DELIVERED order containing that product, one per shopper per product, and that gate is re-checked server-side on every write (`lib/storefront/reviews/`). Ratings on products come from published reviews only. A merchant can hide a review (`sales.review.moderate`) — never write, edit or delete one. Don't add a review form anywhere the server hasn't already confirmed the purchase.
- **Questions are answered, not generated.** A signed-in shopper asks from the product page; the question waits in the merchant's inbox (Sales → Questions, `sales.question.answer`) and reaches the storefront only when a human answers it — answering is publishing. A merchant never writes the question, never edits a shopper's words, and may hide a pair rather than delete it. `lib/storefront/questions/` is the seam; the catalogue exposes only the answered ones.
- **What a shopper may see** is decided once, in `lib/storefront/data/from-prisma.ts`: published + active products, active variants, stock only from stores with `sellsOnline`, visible categories, visible collections. Don't re-implement those rules elsewhere.
- Prices are minor units (kobo) on the storefront and major units in the admin; the mapper is the only place that converts.
