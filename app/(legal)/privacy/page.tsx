/*
 * app/(legal)/privacy/page.tsx
 *
 * The platform's public Privacy Policy. Reachable at https://{PLATFORM_DOMAIN}/privacy
 * (and on the platform host) with no session — see PUBLIC_PATHS in proxy.ts.
 *
 * EVERYTHING HERE DESCRIBES CODE THAT EXISTS. When the app changes, this
 * page changes with it: the third-party list mirrors lib/email.ts (Resend),
 * lib/cloudinary/, lib/payments/paystack.ts, lib/billing/paystack.ts,
 * lib/social/providers/meta.ts, lib/ai/ (Gemini) and auth.ts (Google).
 * Do not add a claim here that no code backs. The platform's name, domain
 * and operator come from lib/brand.ts (ROADMAP 12.2).
 */
import type { Metadata } from 'next';
import { PLATFORM_DOMAIN, PLATFORM_NAME, PLATFORM_OPERATOR, PLATFORM_OPERATOR_REGISTRATION } from '@/lib/brand';
import { CLOSURE_GRACE_DAYS, FINANCIAL_RETENTION_YEARS } from '@/lib/data-rights/policy';
import Link from 'next/link';
import {
  LegalContact,
  LegalDocument,
  LegalList,
  LegalNote,
  LegalSection,
  LegalSubheading,
} from '../_components/legal';

export const metadata: Metadata = {
  title: { absolute: `Privacy Policy | ${PLATFORM_NAME}` },
  description: `${PLATFORM_NAME}’s Privacy Policy explains how we collect, use, protect, and process information when you use the ${PLATFORM_NAME} platform.`,
  alternates: { canonical: `https://${PLATFORM_DOMAIN}/privacy` },
};

const UPDATED = '1 October 2026';

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated={UPDATED}
      intro={
        <p>
          This policy explains what information {PLATFORM_NAME} handles, why, and who else sees it. It applies to the
          {PLATFORM_NAME} platform at {PLATFORM_DOMAIN}, the merchant dashboards and online stores we host on our
          subdomains and on merchants’ own connected domains, and the {PLATFORM_NAME} mobile app.
        </p>
      }
    >
      <LegalSection id="introduction" number={1} heading="Introduction">
        <p>
          {PLATFORM_NAME} is a multi-tenant platform for running a retail business: inventory, purchasing, sales,
          customers, and an online store. {PLATFORM_NAME} is operated by {PLATFORM_OPERATOR}, a business name registered in
          Nigeria ({PLATFORM_OPERATOR_REGISTRATION}). In this policy, “{PLATFORM_NAME}”, “we” and “us”
          mean {PLATFORM_OPERATOR} acting as the operator of {PLATFORM_NAME}.
        </p>
        <p>
          “Merchant” means a business that has a {PLATFORM_NAME} account, together with the staff members it invites.
          “Shopper” means a customer who buys from a merchant’s online store. Both are covered here, but not
          in the same way — see the next section.
        </p>
        <p>
          This page is a description of how the product actually works. It is not legal advice, and it does
          not claim compliance with any particular data-protection regime.
        </p>
      </LegalSection>

      <LegalSection id="roles" number={2} heading="Merchants, shoppers, and who is responsible for what">
        <p>
          {PLATFORM_NAME} holds two different kinds of information, and it matters which one is being discussed.
        </p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">Information about merchants.</strong> The account
            and organization details of the businesses and staff who use {PLATFORM_NAME}. We decide how this is used,
            within this policy.
          </li>
          <li>
            <strong className="font-medium text-foreground">Information merchants put into {PLATFORM_NAME}.</strong>{' '}
            Their products, suppliers, customer records, orders, and the shopper accounts created on their
            online stores. This is the merchant’s business data. We process it to run the platform for them
            and on their instructions — we do not use it for our own purposes.
          </li>
        </LegalList>
        <p>
          A shopper’s account exists on one merchant’s store only. Signing in at one store does not sign a
          shopper in at another, and one merchant can never see another merchant’s records. If you are a
          shopper with a question about how a particular store uses your details, that store is the right
          place to ask first; you can also contact us at <LegalContact />.
        </p>
      </LegalSection>

      <LegalSection id="information-we-collect" number={3} heading="Information we collect">
        <LegalSubheading>Merchant account information</LegalSubheading>
        <LegalList>
          <li>Name and email address.</li>
          <li>
            A password, stored only as a bcrypt hash — never in a readable form. Accounts created with Google
            have no password at all.
          </li>
          <li>
            If you sign in with Google: your Google account’s basic profile — name, email address, profile
            picture and Google’s stable account identifier.
          </li>
          <li>Which organizations you belong to, your role, and invitations you sent or accepted.</li>
        </LegalList>

        <LegalSubheading>Organization and store information</LegalSubheading>
        <LegalList>
          <li>Business name, the subdomain chosen for the store, and any custom domain connected to it.</li>
          <li>Store settings: delivery zones and rates, pickup locations, store pages, discount codes.</li>
          <li>
            Bank account details a merchant chooses to show shoppers for bank-transfer payments (bank name,
            account name, account number).
          </li>
          <li>Subscription plan, billing cycle, and the transaction records behind it.</li>
        </LegalList>

        <LegalSubheading>Business records merchants enter</LegalSubheading>
        <LegalList>
          <li>Products, variants, categories, collections, brands, stock levels and stock movements.</li>
          <li>Suppliers, purchase orders, quotes, invoices, fulfilments, returns and refunds.</li>
          <li>
            Customer records: name, email address, phone number, delivery addresses and any notes the
            merchant adds.
          </li>
          <li>
            Orders: items, quantities, prices, delivery or pickup choice, order status, and the payment
            reference and status reported by the payment provider.
          </li>
          <li>An activity log of significant actions taken inside a store — what changed, by whom, and when.</li>
        </LegalList>

        <LegalSubheading>Shopper account information</LegalSubheading>
        <LegalList>
          <li>Name, email address and (where given) phone number.</li>
          <li>A password hash, or a link to a Google account where the shopper signed in with Google.</li>
          <li>Saved delivery addresses, wishlist items, order history.</li>
          <li>
            Product reviews. A review can only be written by a signed-in shopper who has a delivered order
            containing that product, and merchants can hide a review but cannot write or edit one.
          </li>
        </LegalList>

        <LegalSubheading>Images and files</LegalSubheading>
        <LegalList>
          <li>
            Product and store images merchants upload. These are uploaded directly to Cloudinary and served
            publicly from there.
          </li>
          <li>
            A photo a shopper uses for visual search. The photo is not stored: it is sent to Google’s
            embedding API, and only the resulting numeric vector is kept, with an expiry, so repeat searches
            are fast.
          </li>
        </LegalList>

        <LegalSubheading>Social media account information</LegalSubheading>
        <p>
          Only when a merchant connects one — see section 5 for the detail. In short: the Facebook Page or
          Instagram professional account’s identifier, name, username and profile picture, the permissions
          Meta granted, an encrypted access token, and a record of the posts published through {PLATFORM_NAME}.
        </p>

        <LegalSubheading>Technical information</LegalSubheading>
        <LegalList>
          <li>
            IP address and browser user-agent, as they arrive with every web request. We use the IP address
            in memory to rate-limit sensitive actions such as password reset, sign-in and AI-assisted search;
            it is not kept as a profile of you.
          </li>
          <li>
            Session cookies and similar browser storage — see section 7.
          </li>
          <li>
            Messages a shopper types into the shopping assistant or the search box, which are sent to Google
            for interpretation and are not retained by us as a search history.
          </li>
        </LegalList>

        <LegalSubheading>Communications</LegalSubheading>
        <p>
          If you email us, we keep that correspondence so we can answer it and follow up.
        </p>

        <LegalNote>
          {PLATFORM_NAME} never receives or stores full card numbers. Card payments happen on the payment provider’s
          own hosted page; what comes back to {PLATFORM_NAME} is a reference, an amount, a status and the payment
          channel.
        </LegalNote>
      </LegalSection>

      <LegalSection id="how-we-use-information" number={4} heading="How we use information">
        <LegalList>
          <li>To provide the platform: creating accounts and organizations, and running the dashboard, the online store and the mobile app.</li>
          <li>To authenticate you, keep you signed in, and let you reset a forgotten password.</li>
          <li>To run a merchant’s business records — products, stock, purchasing, customers, orders, deliveries, returns and reporting.</li>
          <li>To take payments: subscription charges for {PLATFORM_NAME}, and shopper payments on a merchant’s store.</li>
          <li>To provide the integrations a merchant switches on, including publishing to a connected Facebook Page or Instagram account exactly when the merchant asks.</li>
          <li>To provide search and shopping assistance, including visual search and the grounded shopping assistant, which answer only from the merchant’s own catalogue.</li>
          <li>To send service messages: invitations, password resets, email-change confirmations, order updates, and low-stock alerts.</li>
          <li>To keep the service secure: rate limiting, abuse and fraud prevention, and the in-store activity log.</li>
          <li>To answer support requests.</li>
          <li>To fix faults and improve how the product works.</li>
        </LegalList>
        <p>
          We do not sell personal information, and we do not use merchants’ business data or shoppers’
          details to serve advertising.
        </p>
      </LegalSection>

      <LegalSection id="social-integrations" number={5} heading="Social media integrations (Facebook and Instagram)">
        <p>
          A merchant may connect a Facebook Page and the Instagram professional account linked to it, so that
          products in {PLATFORM_NAME} can be published as posts. The integration is optional and off until a merchant
          turns it on.
        </p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">The merchant starts it.</strong> A merchant with
            permission clicks Connect in the {PLATFORM_NAME} dashboard and is taken to Meta’s own authorization
            screen, where they choose what to grant. {PLATFORM_NAME} never asks for, sees or stores a merchant’s
            Facebook password.
          </li>
          <li>
            <strong className="font-medium text-foreground">What we receive.</strong> The list of Pages the
            merchant can act on, each Page’s identifier, name, username and picture, the Instagram
            professional account linked to a Page where there is one, an access token for the selected
            accounts, and the permissions Meta reports as granted.
          </li>
          <li>
            <strong className="font-medium text-foreground">How tokens are stored.</strong> Access tokens are
            encrypted at rest with AES-256-GCM using a key held only by our servers, and are used only from
            our servers. Every call to Meta is signed with a proof derived from our app secret, which is
            never sent to a browser.
          </li>
          <li>
            <strong className="font-medium text-foreground">What we do with the connection.</strong> Read the
            connected accounts so the merchant can pick a destination, check whether the token still works,
            and publish the specific posts the merchant composes and submits. Nothing is published
            automatically.
          </li>
          <li>
            <strong className="font-medium text-foreground">Post records.</strong> For each post we keep the
            caption, hashtags, the product image URLs used, the destination account name, the platform’s post
            identifier and link, and whether it succeeded — so the merchant has a history and a failure can
            be retried and explained.
          </li>
          <li>
            <strong className="font-medium text-foreground">Disconnecting.</strong> A merchant can disconnect
            an account at any time from Social → Connections in the dashboard. On disconnect we erase the
            stored token immediately, mark the connection disconnected, remove any Instagram account that
            published through that Page, and ask Meta to revoke the permission. A merchant can also remove
            {PLATFORM_NAME} from their Facebook account settings.
          </li>
        </LegalList>
        <p>
          {PLATFORM_NAME} is a separate service from Meta and is not endorsed by it. What Meta does with the
          information it holds about you is governed by Meta’s own policies.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" number={6} heading="Third-party services we use">
        <p>These are the services that process information on {PLATFORM_NAME}’s behalf, and what each one receives.</p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">Neon (PostgreSQL hosting).</strong> Hosts the
            database, so all stored information described above sits there.
          </li>
          <li>
            <strong className="font-medium text-foreground">Google (Sign in with Google).</strong> When you
            choose it, Google confirms your identity and sends us your basic profile. We do not receive your
            Google password.
          </li>
          <li>
            <strong className="font-medium text-foreground">Google (Gemini API).</strong> Receives the text
            of a shopper’s assistant question or search phrase to work out what is being asked, and the bytes
            of a visual-search photo to turn it into a numeric vector. Answers are then produced from the
            merchant’s own catalogue, not from the model’s general knowledge. Merchant-authored social post
            copy is drafted the same way, from facts the merchant already entered.
          </li>
          <li>
            <strong className="font-medium text-foreground">Meta (Facebook and Instagram Graph API).</strong>{' '}
            Only for merchants who connect an account — see section 5. Receives the posts a merchant asks us
            to publish and the images in them.
          </li>
          <li>
            <strong className="font-medium text-foreground">Cloudinary.</strong> Stores and serves uploaded
            product and store images. Uploads go from the browser straight to Cloudinary using a signature we
            generate.
          </li>
          <li>
            <strong className="font-medium text-foreground">Resend.</strong> Delivers our transactional email
            — invitations, password resets, email-change confirmations, order updates and stock alerts.
            Receives the recipient’s email address and the message.
          </li>
          <li>
            {/* ROADMAP 10.9 made this list factual again (Squad no longer processes anything).
              * The full payments wording — merchant settlement, verification data — is 10.10's,
              * for legal review. */}
            <strong className="font-medium text-foreground">Paystack (paystack.com).</strong> Takes payment for
            {PLATFORM_NAME} subscriptions and shopper payments on merchant storefronts. Card details are entered on
            Paystack’s hosted page and never reach {PLATFORM_NAME}; we receive the transaction reference, amount, status,
            channel and fees. For a merchant who sets up online payments, Paystack receives the business name,
            the settlement bank account and a payments contact, so it can pay them out.
          </li>
          <li>
            <strong className="font-medium text-foreground">Namecheap.</strong> Used when a merchant orders a
            custom domain through {PLATFORM_NAME}. Receives the domain details needed to check availability and
            register or connect it.
          </li>
        </LegalList>
        <p>
          {PLATFORM_NAME} does not use third-party advertising networks, and does not run analytics or tracking
          scripts from other companies on its pages.
        </p>
      </LegalSection>

      <LegalSection id="cookies" number={7} heading="Cookies and browser storage">
        <p>
          {PLATFORM_NAME} uses only what it needs to keep you signed in and to remember choices you have made. There
          are no advertising or cross-site tracking cookies.
        </p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">Staff session cookie.</strong> Set when you sign
            in to {PLATFORM_NAME}. It is scoped to our root domain so one sign-in covers your dashboard across your
            store’s subdomain, and it carries a signed token rather than your details.
          </li>
          <li>
            <strong className="font-medium text-foreground">Shopper session cookie.</strong> Set when a
            shopper signs in to a store. It is scoped to that store’s own hostname and named per store, so a
            session at one merchant means nothing at another. It lasts up to 30 days, and a password reset
            invalidates it immediately.
          </li>
          <li>
            <strong className="font-medium text-foreground">Preference cookies.</strong> Small cookies such
            as a store’s light/dark theme choice.
          </li>
          <li>
            <strong className="font-medium text-foreground">Browser storage.</strong> A shopper’s cart and
            the dismissal of a store’s cookie notice are kept in the browser’s own local storage on their
            device — they are not sent to us as cookies.
          </li>
        </LegalList>
        <p>
          You can clear or block cookies in your browser. Blocking the session cookies will mean you cannot
          stay signed in.
        </p>
      </LegalSection>

      <LegalSection id="retention" number={8} heading="How long we keep information">
        <p>
          We keep information for as long as the account or record it belongs to exists, because the product
          is a business record system: a merchant’s stock history, orders and invoices are exactly the things
          they need to be able to look back on. The exceptions, and what happens when something is deleted:
        </p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">Business records</strong> — orders, invoices, quotes,
            payments, refunds and returns — are kept for {FINANCIAL_RETENTION_YEARS} years, because the law requires
            businesses to keep records of their sales for that long, even after a shopper deletes their account or a
            merchant closes their store.
          </li>
          <li>
            <strong className="font-medium text-foreground">A deleted shopper account.</strong> Removed straight away:
            the sign-in, saved addresses, wishlist, reviews, questions, marketing consent and contact details on the
            store’s customer record. The name and delivery details written on past orders and invoices stay until
            those records are {FINANCIAL_RETENTION_YEARS} years old, then they are removed too.
          </li>
          <li>
            <strong className="font-medium text-foreground">A closed store.</strong> It goes offline at once and can be
            restored on request for {CLOSURE_GRACE_DAYS} days. After that we delete its files and photos, store pages,
            staff access, payout details and every shopper’s account and contact details; its business records are
            kept until {FINANCIAL_RETENTION_YEARS} years after closing, and then the whole store is erased.
          </li>
          <li>
            Short-lived items expire on their own — password reset tokens, email-change confirmations,
            invitations, the parked list of social accounts between authorization and selection, and
            visual-search vectors.
          </li>
          <li>
            A disconnected social connection keeps its record (account name, status, history) but its access
            token is erased at the moment of disconnection.
          </li>
          <li>
            Deleted information leaves our live systems at once. Our encrypted nightly backups keep it for up to
            30 days after that, then it is gone from them too.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="security" number={9} heading="Security">
        <p>We take reasonable measures to protect information, including:</p>
        <LegalList>
          <li>Passwords stored only as bcrypt hashes.</li>
          <li>Social access tokens encrypted at rest with AES-256-GCM, decryptable only on our servers.</li>
          <li>Signed, expiring session tokens, with a version counter that invalidates every existing session on a password reset.</li>
          <li>Encrypted connections (HTTPS) between your browser and {PLATFORM_NAME}, and between {PLATFORM_NAME} and the services in section 6.</li>
          <li>Strict separation between merchants: every query is scoped to one organization, and that separation is covered by automated tests.</li>
          <li>Role-based permissions, so staff only reach what their role allows.</li>
          <li>Secrets such as API keys and app secrets held server-side and never sent to a browser.</li>
        </LegalList>
        <p>
          No service can promise that transmission or storage is perfectly secure. If we become aware of a
          breach affecting your information, we will act on it and tell affected users where it is
          appropriate to do so.
        </p>
      </LegalSection>

      <LegalSection id="sharing" number={10} heading="When we share information">
        <p>We share information in these situations, and no others:</p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">With the service providers in section 6</strong>,
            for the purposes described there.
          </li>
          <li>
            <strong className="font-medium text-foreground">With the merchant whose store you use.</strong> A
            shopper’s account, orders, addresses and reviews are visible to that merchant’s staff — that is
            how the merchant fulfils the order.
          </li>
          <li>
            <strong className="font-medium text-foreground">With an integration a merchant has authorized</strong>,
            such as a connected Facebook Page or Instagram account, limited to what that integration does.
          </li>
          <li>
            <strong className="font-medium text-foreground">Where the law requires it</strong>, or in
            response to a valid request from a public authority.
          </li>
          <li>
            <strong className="font-medium text-foreground">To protect the service</strong> — to investigate
            fraud or abuse, or to establish or defend legal claims.
          </li>
          <li>
            <strong className="font-medium text-foreground">In a business transfer</strong>, if {PLATFORM_NAME} or its
            assets are ever acquired, in which case this policy continues to apply to the information
            transferred until it is replaced by a notice to you.
          </li>
        </LegalList>
        <p>We do not sell personal information and we do not share it for third-party advertising.</p>
      </LegalSection>

      <LegalSection id="your-rights" number={11} heading="Your choices and your rights">
        <p>Depending on where you live, you may have rights over your information. In practice:</p>
        <LegalList>
          <li>
            <strong className="font-medium text-foreground">Access and correction.</strong> Merchants and
            staff can view and change their name, email and store details in the dashboard. Shoppers can
            update their name, email and delivery addresses in their store account.
          </li>
          <li>
            <strong className="font-medium text-foreground">Disconnecting integrations.</strong> A merchant
            can disconnect a Facebook Page or Instagram account at any time from the dashboard, which erases
            the stored token and asks Meta to revoke access.
          </li>
          <li>
            <strong className="font-medium text-foreground">A copy of your data.</strong> A shopper can download
            everything a store holds about their account from “Your data” in their store account. A store owner can
            download the store’s customers, products, orders and invoices from Settings → Your data.
          </li>
          <li>
            <strong className="font-medium text-foreground">Deletion.</strong> A shopper can delete their account from
            “Your data” in their store account, and a store owner can close their store from Settings → Your data —
            section 8 says exactly what each removes and what the law requires us to keep. To delete a {PLATFORM_NAME}{' '}
            sign-in itself, email <LegalContact /> from the address on the account; we will verify that you own it, act
            on the request, and confirm when it is done.
          </li>
          <li>
            <strong className="font-medium text-foreground">Withdrawing consent.</strong> Where we rely on
            your consent — for example for a social connection — you can withdraw it by disconnecting or by
            contacting us. Withdrawing consent does not undo what was already done with it.
          </li>
          <li>
            <strong className="font-medium text-foreground">Objecting or complaining.</strong> Write to{' '}
            <LegalContact /> and we will respond.
          </li>
        </LegalList>
        <p>
          Service emails such as password resets and order updates are part of running the account and are
          not marketing; we do not send marketing email from {PLATFORM_NAME} to merchants’ shoppers.
        </p>
      </LegalSection>

      <LegalSection id="children" number={12} heading="Children’s privacy">
        <p>
          {PLATFORM_NAME} is a tool for running a business and is not directed at children. {PLATFORM_NAME} accounts are for
          people aged 18 or over. Storefront accounts are not intended for anyone under 13, and we do not
          knowingly collect information from a child under 13. If you believe a child has given us
          information, email <LegalContact /> and we will remove it.
        </p>
      </LegalSection>

      <LegalSection id="international" number={13} heading="International transfers">
        <p>
          {PLATFORM_NAME} is operated from Nigeria, and the services in section 6 are operated by companies outside
          Nigeria. Our database is currently hosted in the European Union (Neon, Frankfurt region), and
          providers such as Google, Meta, Cloudinary and Resend process data in the countries where they
          operate. Using {PLATFORM_NAME} therefore involves your information being transferred to and stored in
          countries other than your own.
        </p>
      </LegalSection>

      <LegalSection id="changes" number={14} heading="Changes to this policy">
        <p>
          We may update this policy as the product changes. The current version is always published at this
          address, with the “last updated” date at the top. If a change materially affects how we handle your
          information, we will take reasonable steps to tell you — for example by email or a notice in the
          dashboard. Continuing to use {PLATFORM_NAME} after a change means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={15} heading="Contact us">
        <p>
          For any question about this policy, or to make a request about your information, email{' '}
          <LegalContact />. {PLATFORM_NAME} is operated by {PLATFORM_OPERATOR} ({PLATFORM_OPERATOR_REGISTRATION}),
          Nigeria.
        </p>
        <p>
          See also our{' '}
          <Link href="/terms" className="font-medium text-foreground underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
