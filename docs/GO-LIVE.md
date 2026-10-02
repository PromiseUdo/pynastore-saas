# Going live: the outside approvals and live keys

ROADMAP 13.9. This is the work that happens in other companies' dashboards:
Resend, Meta, Paystack, Apple and Google. Do the steps in the order below,
because some outside reviews take days.

**Track progress on Console → Go-live checklist (`/platform/launch`).** It
checks every setting on the live server, without showing any secret, and
lists what only you can confirm. You're done when every check says **Ready**
and you've confirmed the manual steps.

Settings are changed in **Vercel → Project → Settings → Environment
Variables**, for **Production**, and only take effect after a **redeploy**
(Deployments → ⋯ → Redeploy).

| Step | Who waits on whom | Typical wait |
|---|---|---|
| 1. Email domain (Resend) | DNS | minutes to a few hours |
| 2. Social-token key | nobody | 5 minutes |
| 3. Meta App Review | Meta | days to a couple of weeks — **start early** |
| 4. Paystack live | Paystack's business activation | a few working days |
| 5. Tidy up test mode | nobody | 15 minutes |
| 6. App Store and Google Play | Apple and Google review | 1–7 days each |
| 7. Final check | — | 30 minutes |

---

## 1. Email: your sending domain in Resend

Without this, password resets, order updates and staff alerts come from a
domain mail providers don't trust, so they land in spam or don't arrive.

1. In **Resend → Domains → Add domain**, enter the domain the emails should
   come from, e.g. `getnotely.io`.
2. Resend shows a few DNS records (SPF and DKIM, usually TXT and MX). Add each
   one exactly as shown where the domain's DNS is managed, e.g. **Namecheap →
   Domain List → Manage → Advanced DNS**.
3. Also add a DMARC record, which helps delivery: TXT, host `_dmarc`, value
   `v=DMARC1; p=none; rua=mailto:you@getnotely.io`.
4. Back in Resend, press **Verify**. Wait until the domain shows
   **Verified**; DNS can take up to a few hours.
5. In **Resend → API keys**, create a key with **Sending access** for that
   domain.
6. In Vercel (Production), set:
   - `RESEND_API_KEY` = the new key
   - `EMAIL_FROM` = `Notely <hello@getnotely.io>` (any address on the
     verified domain)
7. Redeploy. To test, use "Forgot password" on the live site with your own
   email. The message should arrive in your inbox, not spam.

## 2. The social-token key (keeps Facebook and Instagram connected)

Merchants' Facebook and Instagram access tokens are stored encrypted. Today
the encryption key is derived from `AUTH_SECRET`, so changing `AUTH_SECRET`
would disconnect every merchant. Give the tokens their own key, **keeping
the one in use now**, so nothing gets disconnected:

1. Get the production `AUTH_SECRET`: Vercel → Environment Variables →
   `AUTH_SECRET` → reveal, or run `vercel env pull` to a scratch file.
2. On your machine, in the project folder, run:
   ```sh
   AUTH_SECRET='<the production value>' node scripts/derive-social-token-key.mjs
   ```
   It prints a line of base64. That's the key in use right now.
3. In Vercel (Production), set `SOCIAL_TOKEN_KEY` = that line. Don't save it
   anywhere else.
4. Redeploy. The checklist's **Encryption key for social accounts** should
   say Ready, and connected accounts keep working.

Don't generate a new random key instead: it would make every stored token
unreadable. If no merchant has connected an account yet it wouldn't matter,
but the script is safe either way.

## 3. Meta App Review (Facebook and Instagram posting)

Until Meta approves the app, only people listed as testers on the Meta app can
connect a Page. Start this early; Meta's review is the slowest step.

**Before you submit**, in **developers.facebook.com → your app**:

1. **App settings → Basic:**
   - **Privacy policy URL** `https://getnotely.io/privacy`
   - **Terms of Service URL** `https://getnotely.io/terms`
   - **User data deletion:** choose "Data deletion instructions URL" and
     enter `https://getnotely.io/privacy#your-rights`
   - **App icon** (1024×1024)
   - **Category** (Business)
   - **Contact email**
2. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:**
   add exactly the address the checklist shows under **Meta app settings**,
   `https://app.getnotely.io/api/social/meta/callback`.
3. **Business verification.** Meta requires it for these permissions. In
   **Meta Business Suite → Business settings → Security centre**, verify the
   business behind the app. That's Pynacode, CAC BN 9663547, with a matching
   document, address and phone. This alone can take a few days.
4. **A reviewer login.** On the live site, create a workspace a reviewer can
   use, e.g. `meta-review@getnotely.io`, with a strong password and a few
   products with photos. Meta tests with its own Facebook test Page.

**Request Advanced Access** under **App Review → Permissions and features**
for each of:
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`instagram_basic`, `instagram_content_publish`, `business_management`.

For each one Meta asks how it's used, and wants a **screen recording**. One
recording (2–4 minutes) can cover all six:
1. Sign in to Notely with the reviewer login and open **Social → Connected
   accounts**.
2. Press **Connect**, sign in to Facebook, and choose a Page and its linked
   Instagram account. That shows `pages_show_list`, `business_management`
   and `instagram_basic`.
3. Back in Notely, the Page and Instagram account show as connected (also
   `pages_read_engagement`).
4. **Create post:** choose a product, write the caption, choose the Page,
   **Publish**, then show the post live on the Page (`pages_manage_posts`).
5. Do the same for Instagram (`instagram_content_publish`).

Wording that works for every permission: *"Merchants on Notely connect their
own Facebook Page and Instagram business account and publish posts about
their own products from their dashboard. We read the list of Pages they
manage so they can choose one, and publish only when they press Publish. We
don't read their followers, messages or insights."*

**After approval:** switch the app from **Development** to **Live** mode,
using the toggle at the top of the app dashboard. Then any merchant can
connect.

## 4. Paystack: live payments

1. **Activate the business** in the Paystack dashboard
   ("Activate your business"): business type and details, CAC registration,
   the director's ID and BVN, and the settlement bank account. Paystack also
   checks the website, so make sure `https://getnotely.io` shows the terms,
   privacy policy and a way to contact you.
2. Once activated, open **Settings → API Keys & Webhooks** and switch to the
   **Live** tab:
   - copy the **Live Secret Key** (`sk_live_…`);
   - set **Live Webhook URL** to the address the checklist shows,
     `https://app.getnotely.io/api/payments/paystack/webhook`.
3. In Vercel (Production), set:
   - `PAYSTACK_SECRET_KEY` = the `sk_live_…` key
   - `PAYSTACK_MODE` = `live`. With a mismatch between the two, the site
     switches payments **off** on purpose.
4. Redeploy.
5. **Move merchants' payout accounts to live.** Each approved business has a
   Paystack payout "subaccount", and the ones made during testing don't exist
   for the live key. Until they're replaced, those shops can't take online
   payments; the site checks this, so no money can go astray. On **Console →
   Go-live checklist → Merchants' payout accounts**, press **Set up payout
   accounts in live mode**. Press again if it says some are left, until the
   check says Ready.
6. **Make one real payment.** On a real shop, order something small and pay
   with a real card. Check:
   - the order shows **Paid**;
   - the checklist's **Paystack webhook** says a **live** event arrived;
   - the money reaches the merchant's bank on Paystack's settlement schedule
     (usually the next working day).

## 5. Tidy up test mode

- **Test webhook.** In Paystack's **Test** tab, remove the webhook URL, or
  point it at a non-production deploy. Test-mode events sent to the live site
  fail its signature check, and would show up as alerts in Console → Errors.
- **Plans paid with test cards.** Any workspace that "paid" with a test card
  shows as **Paying** in Console → Merchants, but no real money changed hands.
  Its plan runs to the end of the period, then lapses into the usual grace
  period. Nothing renews, because test subscriptions don't exist for the live
  key. Tell those merchants (likely just you and testers) to choose a plan
  again. Billing now keeps live and test Paystack plans apart, so new
  subscriptions renew correctly.
- **Squad.** Delete `SQUADCO_PUBLIC_KEY` and `SQUADCO_SECRET_KEY` from Vercel
  and your `.env`. Squad is retired (10.9) and nothing reads them.

## 6. App Store and Google Play

The app is the storefront in a native wrapper (`MOBILE.md`). Its id is
`com.mansaas.app` and its display name **Notely**. Shoppers browse shops on
`m.getnotely.io`.

**You'll need:**
- **Apple:** an Apple Developer account ($99 a year).
- **Google:** a Google Play Console account (one-time $25). Google requires
  new personal accounts to run a closed test with testers before production,
  so an organisation account (with a D-U-N-S number) is quicker.
- **Graphics:** app icon, screenshots of the storefront on a phone, a
  one-line description and a full description.
- **Links:** privacy policy `https://getnotely.io/privacy`; support URL or
  email.

**Privacy answers.** Apple's **App Privacy** and Google's **Data safety**
forms ask what the app collects. This is what it actually does:

| Data | Collected? | Why | Linked to the person? |
|---|---|---|---|
| Name, email, phone, delivery address | Yes, when a shopper makes an account or orders | To place and deliver orders | Yes |
| Purchase history | Yes | Orders and returns | Yes |
| Photos | Only when a shopper searches by photo; the photo goes to Google's AI to find similar products, and what's kept is deleted after 24 hours | Search | No |
| Reviews and questions they write | Yes | Shown on the shop | Yes |
| Crash and error reports | Yes: the page and the error message, nothing that identifies them | Fixing problems | No |
| Payment card details | **No.** Paystack's own page takes them | — | — |
| Location, contacts, browsing across other apps | No | — | — |
| Tracking or advertising | **No.** Merchants' Google Analytics and Meta Pixel run on the website only, never in the app | — | — |

- **Account deletion:** both stores ask whether users can delete their
  account in the app. They can: **Account → Your data → Delete my account**.
  Give that path as the in-app route, and the privacy page as the web link.
- **Apple's review:** Apple sometimes rejects apps that are "just a website"
  (guideline 4.2). In the review notes, say the app is a shopping app for
  Nigerian shops, with accounts, search by photo, wishlists and order
  tracking, and give a test shop and shopper login.

## 7. Final check

1. **Console → Go-live checklist:** every check says **Ready**.
2. **Confirm the manual steps:**
   - Meta approved and the app Live;
   - the Resend domain Verified;
   - a real payment end to end;
   - both app listings approved;
   - counsel's review of the terms and privacy policy, including the 6-year
     and 30-day rules (10.10).
3. **Console → Scheduled jobs:** every job **Working**.
4. **Console → Errors:** nothing new and open.
5. Watch the console for the first few days of real orders.
