# Data rights and retention

This is what the platform does with personal data when someone asks for a
copy, deletes an account, or closes a store (ROADMAP 13.8, NDPA). The rules
live in `lib/data-rights/`. The privacy page (section 8 and section 11)
restates them, so change both together. The numbers in
`lib/data-rights/policy.ts` were decided on 2026-10-01 and are pending
counsel's confirmation with the rest of the legal wording (10.10).

## The rules

| | |
|---|---|
| Business records (orders, invoices, quotes, payments, refunds, returns, purchase orders, stock history) | kept **6 years** (`FINANCIAL_RETENTION_YEARS`) |
| A closed store can be restored | for **30 days** (`CLOSURE_GRACE_DAYS`) |
| Nightly backups keep deleted data | for up to **30 days** (`db-backup.yml`) |
| A guest's chat with a store (sent without signing in) | removed **12 months** after the last message (`GUEST_CHAT_RETENTION_MONTHS`) |

A running store's own customers and orders, guest orders included, are the
merchant's records. Nothing here erases them while the store is open.

## A shopper's rights (their store account → "Your data")

**Download.** `/account/export` returns a JSON file of everything the store
holds about the account: profile, saved addresses, wishlist, orders with their
items, reviews, questions, and both sides of their chat with the store (the
store's side signed "Store team", as they saw it).

**Delete.** The shopper confirms with their password, or, for a Google-only
account, by typing their email. `deleteShopperAccount` (`lib/data-rights/shopper.ts`)
then acts in two stages.

Removed at once:
- **sign-in:** the password, Google link and every session;
- **what they saved:** addresses and wishlist;
- **what they wrote:** reviews, questions and "helpful" votes (ratings are
  recalculated from what remains), and their chat with the store, the
  store's replies included;
- **the merchant's notes about them:** notes and tags;
- **reachability:** marketing consent, plus the email, phone and address on
  the customer record. The email is free to register again.

Kept until they're 6 years old:
- **past orders and invoices,** with the name and delivery details written
  on them;
- **the customer record's name,** because invoices print it.

After that, the daily retention job anonymises them: the contact and
delivery fields on each order are cleared, and the customer's name becomes
"Deleted customer".

A customer with no orders, invoices or quotes at all is deleted outright.
The merchant's customer page says the account was deleted, and marketing
can't be switched back on for them.

## Chat with a store (ROADMAP 17)

- **Signed-in shoppers:** their conversation belongs to their account. It's
  in their download, and it goes when they delete the account (above).
- **Guests:** a guest has no account to delete it from. The daily
  `data-retention` job removes a guest conversation once nobody has written
  in it for 12 months, counted from the last message.
- **The cookie:** a guest's browser holds a random key, set only when they
  send a message. We store only its sha256.
- **Signing in:** if a guest signs in, their conversation moves to the
  account and follows the account's rules from then on.
- **Closed stores:** the day-30 purge deletes all of a store's
  conversations, guests' and customers' alike.

## Closing a store (Settings → Your data, Owner only)

What `Organization.status = DELETED` means, step by step:

1. **Day 0: closing** (`closeWorkspace`).
   - The Owner types the store's name to confirm.
   - The dashboard and the storefront go offline for everyone; `proxy.ts`
     sends both to the platform's home page.
   - The Paystack subscription is cancelled. If that fails, it's recorded in
     the error log for staff to cancel by hand.
   - A custom domain stops.
   - Social accounts are disconnected and their tokens destroyed.
   - The Owners are emailed the dates below.
2. **Days 0–30: reopening.** Staff can reopen it on request from the
   console (Merchants → Closed → Reopen). Everything comes back, except the
   plan and the social accounts, which the owner sets up again.
3. **Day 30: the purge** (`purgeClosedWorkspace`, run by the daily
   `data-retention` job).
   - **Deleted:** every uploaded file (the store's whole Cloudinary folder,
     verification documents included), store pages and front-page slides,
     social posts and connections, staff memberships and invitations, payout
     and verification records, every chat with shoppers, and every shopper's
     account data and contact details. Customers with no business records are deleted outright.
   - **Kept:** the business records, with the products, stores and customer
     names they refer to.
4. **Year 6: erasure** (`eraseOrganization`, same job). Everything left is
   erased, down to the organization row itself.
   - **How it works:** it reads the foreign keys from Postgres rather than a
     hand-kept list, so new tables are covered automatically.
   - **What it never touches:** shared tables (users, plans, platform
     records), which have no key pointing into a store.

Before closing, the Owner can download the store's customers, products,
orders and invoices as spreadsheets from the same page.

## Tests

- **`tests/data-rights.test.ts`** runs on a throwaway database
  (`npm run test:local`) and builds two full stores through the real
  onboarding, checkout and delivery flows. It then checks:
  - the export, deletion and anonymisation;
  - closing and reopening, and the day-30 purge;
  - erasure, proven by **zero rows of that store left in any table** while
    the other store's rows are identical and the users survive.
- **`lib/data-rights/policy.test.ts`** covers the dates.
- **`tests/chat-data-rights.test.ts`** covers chat:
  - messages in the download;
  - removal on account deletion, both with and without kept orders;
  - the 12-month guest rule, counted from the last message, which never
    touches a signed-in shopper's chat;
  - the day-30 purge.
