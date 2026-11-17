# Staging: trying new features before the public sees them

Pynastore runs as two copies:

| | Live | Staging |
|---|---|---|
| Who uses it | Real merchants and shoppers | You, and anyone you invite to test |
| Git branch | `master` | `dev` (plus a preview link per feature branch) |
| Vercel environment | Production | Preview |
| Domain | `pynastore.com` | a second domain, e.g. `pynastore-staging.com` |
| Database | Neon, production branch | Neon, its own `staging` branch |
| Payments | Paystack **live** keys | Paystack **test** keys only |
| Scheduled jobs | Run (Vercel + cron-job.org) | Don't run |

The code knows which copy it is (`lib/deploy-stage.ts`, from Vercel's own
`VERCEL_ENV`). On staging it always:

- **refuses Paystack live keys**, whatever the settings say, so no real money moves;
- **starts every email's subject with "[Staging]"**;
- **tells search engines to stay out** (an `X-Robots-Tag: noindex` header and a closed `robots.txt`);
- **shows a small orange "STAGING · test data only" label** at the top of every page.

Nothing else differs: staging runs exactly the code that will go live.

---

## How a feature reaches the public

1. **Build it on its own branch**, made from `dev`:
   ```
   git checkout dev
   git pull
   git checkout -b feature/loyalty-points
   ```
   Push it. Vercel builds a preview link for that branch, which uses staging's
   settings and database.
2. **When it works, merge it into `dev`.** Staging updates within a few
   minutes. Any new migration is applied to the staging database at that
   moment. A feature branch's own preview never migrates, so give
   migrations their first run through `dev`.
3. **Test it on staging** like a real merchant and shopper would.
4. **Release it:** merge `dev` into `master`. The live site updates and
   applies the same migrations to the live database.
   ```
   git checkout master
   git pull
   git merge dev
   git push
   ```

Anything not ready simply stays on its branch, or on `dev`, until you decide.
Only merge into `master` what you're happy for everyone to have. `dev` can
hold several features at once, so if one of them isn't ready, keep it on its
own branch until it is, rather than merging it into `dev`.

**Database changes need care.** A release applies the migration to the live
database while the old code may still be serving for a minute. So keep
migrations *additive*: new tables, and new columns that are optional or have a
default. Never rename or drop a column in the same release that stops using
it. Stop using it first, and remove it in a later release.

---

## One-time setup

Allow about an hour. Do the steps in order.

### 1. The staging domain

Buy a second domain at Namecheap, e.g. `pynastore-staging.com`, about
$10 a year. Shops on staging then live at the same kinds of address as live:

| What | Live | Staging |
|---|---|---|
| Sign-in, onboarding, console | `app.pynastore.com` | `app.pynastore-staging.com` |
| A shop's admin | `{slug}.pynastore.com` | `{slug}.pynastore-staging.com` |
| A shop's storefront | `shop-{slug}.pynastore.com` | `shop-{slug}.pynastore-staging.com` |
| Business app | `b.pynastore.com` | `b.pynastore-staging.com` |
| Store app host | `m.pynastore.com` | `m.pynastore-staging.com` |

Wherever this guide says `pynastore-staging.com`, use the domain you bought.

### 2. Point the domain at Vercel

Shops need a **wildcard** address (`*.pynastore-staging.com`), and Vercel can
only issue the padlock certificate for a wildcard when it runs the domain's
DNS.

1. In Vercel go to **Project → Settings → Domains → Add**. Add
   `pynastore-staging.com`, then `*.pynastore-staging.com`.
2. Vercel shows two nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`).
   In Namecheap open **Domain List → Manage → Nameservers**, choose **Custom
   DNS**, and enter those two.
3. Back in Vercel, edit each of the two domains: under **Git branch**, choose
   **`dev`**. Both domains now always show the latest `dev` deployment.
4. Wait for both to show **Valid Configuration**. That can take up to an hour
   after the nameserver change.

### 3. A database for staging

In the **Neon console → your project → Branches → Create branch**:

- **Name:** `staging`.
- **Branch from:** your **development** branch, **never** the production
  one. Branching from production would copy real merchants' and shoppers'
  data into staging.

Then open the new branch's **Connect** dialog and copy two addresses:
- the **pooled** one (its host contains `-pooler`) for `DATABASE_URL`;
- the **direct** one (no `-pooler`) for `DIRECT_URL`.

### 4. Staging's settings in Vercel

Go to **Project → Settings → Environment Variables**.

**First, check the live settings aren't shared.** Open each variable and look
at the environments it applies to. Any variable that holds a **live**
value (the database, Paystack keys, `AUTH_URL`, domains) must be ticked for
**Production only**, not Preview. If a live value is also ticked for
Preview, untick Preview before adding the staging one below.

Then add the following for the **Preview** environment only:

| Setting | Staging value |
|---|---|
| `STAGING_DATABASE` | `yes`. This lets `dev` deploys apply migrations to staging's database. |
| `DATABASE_URL` | staging's **pooled** Neon address |
| `DIRECT_URL` | staging's **direct** Neon address |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `pynastore-staging.com` |
| `NEXT_PUBLIC_PLATFORM_HOST` | `app.pynastore-staging.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.pynastore-staging.com` |
| `AUTH_URL` | `https://app.pynastore-staging.com` |
| `NEXT_PUBLIC_BUSINESS_DOMAIN` | `b.pynastore-staging.com` |
| `NEXT_PUBLIC_MOBILE_DOMAIN` | `m.pynastore-staging.com` |
| `META_REDIRECT_URI` | `https://app.pynastore-staging.com/api/social/meta/callback` |
| `AUTH_SECRET` | a **new** random value (`openssl rand -base64 32`) |
| `SOCIAL_TOKEN_KEY` | a **new** random value (`openssl rand -hex 32`) |
| `CRON_SECRET` | a **new** random value. Nothing calls staging's jobs, but some code expects it to be set. |
| `PAYSTACK_SECRET_KEY` | your Paystack **test** secret key (`sk_test_…`) |
| `PAYSTACK_MODE` | `test` |
| `ERROR_LOG` | `on`, so staging's errors appear in **its** console. They're kept apart from live's. |

Settings to **reuse from live** (tick Preview as well as Production, or copy
them): Cloudinary, Resend, Gemini, Google sign-in, Ably, web push, Freshchat
and the Meta app. Staging's files, emails and messages stay apart from live's
because its database is separate.

Optional, if you want them really separate: a second Cloudinary account, and
a separate Ably app, each with its own keys.

**Never** put live Paystack keys or the live database in Preview.

### 5. Sign-in providers

So that "Continue with Google" works on staging, open the **Google Cloud
console → APIs & Services → Credentials → your OAuth client**. Add these
next to the live ones, and don't remove the live ones:

- **Authorised JavaScript origins:** `https://app.pynastore-staging.com`
- **Authorised redirect URIs:**
  - `https://app.pynastore-staging.com/api/auth/callback/google`
  - `https://app.pynastore-staging.com/api/storefront/auth/google/callback`

For Facebook and Instagram, go to the Meta app → **Facebook Login for
Business → Settings → Valid OAuth Redirect URIs**. Add
`https://app.pynastore-staging.com/api/social/meta/callback`.

### 6. Paystack test webhook

In **Paystack → Settings → API Keys & Webhooks**, with **Test mode** on, set
the **Test Webhook URL** to:

`https://app.pynastore-staging.com/api/payments/paystack/webhook`

The live webhook URL (Live mode) stays pointing at `app.pynastore.com`.

### 7. First deploy

Push anything to `dev`, or press **Redeploy** on the latest `dev`
deployment in Vercel. The build log should say:

`[migrate] Applying pending migrations to the staging database…`

Then open `https://app.pynastore-staging.com`. You should see the orange
**STAGING** label at the top.

### 8. Your console account on staging

Staging's database starts with no accounts. Register at
`https://app.pynastore-staging.com/register` with your own email, then in the
**Neon console → staging branch → SQL Editor** run (with your email):

```sql
UPDATE users SET "isPlatformStaff" = true WHERE email = 'you@example.com';
```

Sign out and back in, then open `https://app.pynastore-staging.com/platform`.
From the console, set plans and prices the way you want to test them.

---

## Day to day

- **Test shops:** create them on staging like a merchant would. Use test
  cards on checkout: `4084 0840 8408 4081`, any future expiry date, CVV `408`,
  PIN `0000`, OTP `123456`.
- **Emails** from staging are real emails with "[Staging]" in front, so use
  addresses you own.
- **Starting over:** in Neon, **Reset from parent** on the `staging` branch
  wipes staging back to a copy of the development branch. Then redeploy `dev`
  so the latest migrations are applied.
- **Scheduled jobs** don't run on staging. To try one, sign in to staging's
  console, go to **Scheduled jobs** and press **Run now**.
- **Store apps (phones):** the store apps and the business app point at the
  live site. Test them against staging only if you build a separate app
  version for it (see `docs/MOBILE-BUILD.md`).

## If something looks wrong

| Symptom | Likely cause |
|---|---|
| No STAGING label on the staging domain | The domain isn't set to branch `dev` (step 2.3), or `VERCEL_ENV` isn't preview |
| Staging shows live shops or orders | Preview is using the live `DATABASE_URL`. Fix step 4 immediately. |
| "This is the staging site: use Paystack test keys" | A live Paystack key is set for Preview. Replace it with the test key. |
| Shop addresses don't load | The wildcard domain isn't valid yet, or the nameservers aren't Vercel's (step 2) |
| New feature's tables missing on staging | `STAGING_DATABASE=yes` or `DIRECT_URL` missing in Preview, or the change was deployed from a feature branch rather than `dev` |
| Google sign-in error on staging | Step 5's addresses aren't added |
