/*
 * app/(legal)/terms/page.tsx
 *
 * Notely's public Terms of Service. Reachable at https://getnotely.io/terms
 * with no session — see PUBLIC_PATHS in proxy.ts.
 *
 * Facts stated here must hold in the product: plan tiers and NGN pricing
 * come from lib/billing/plans.ts, subscription billing from
 * lib/billing/paystack.ts, storefront payments from lib/payments/squad.ts,
 * and the social integration from lib/social/. Nothing is promised that the
 * app does not do — in particular there is no uptime or support commitment
 * here, because there is none in the product.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalContact, LegalDocument, LegalList, LegalSection } from '../_components/legal';

export const metadata: Metadata = {
  title: { absolute: 'Terms of Service | Notely' },
  description: 'The Terms of Service governing use of the Notely platform.',
  alternates: { canonical: 'https://getnotely.io/terms' },
};

const UPDATED = '20 September 2026';

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Terms of Service"
      updated={UPDATED}
      intro={
        <p>
          These terms are the agreement between you and Pynacode for the use of Notely. Please read them
          before using the service.
        </p>
      }
    >
      <LegalSection id="acceptance" number={1} heading="Acceptance of these terms">
        <p>
          By creating a Notely account, joining an organization on Notely, or otherwise using the service,
          you agree to these terms. If you are agreeing on behalf of a business, you confirm you are
          authorized to bind that business, and “you” means that business. If you do not agree, do not use
          Notely.
        </p>
      </LegalSection>

      <LegalSection id="service" number={2} heading="What Notely is">
        <p>
          Notely is a multi-tenant platform, operated by Pynacode (a business name registered in Nigeria, CAC
          business name registration number 9663547), for running a retail business: inventory, purchasing,
          sales, customers, reporting, and a customer-facing online store hosted on a Notely subdomain or on
          a domain the merchant connects. Optional features include social publishing to a connected Facebook
          Page or Instagram account, AI-assisted search and shopping help, and a mobile app for storefronts.
        </p>
        <p>
          Notely is software. It is not a bank, a payment institution, a shipping company, a tax adviser or a
          legal adviser, and it does not act as the seller of the goods merchants list.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" number={3} heading="Eligibility">
        <p>
          You must be at least 18 years old and legally able to enter into a contract to hold a Notely
          account. You must not use Notely if you are barred from doing so under applicable law or under the
          terms of any of the third-party services Notely relies on.
        </p>
      </LegalSection>

      <LegalSection id="accounts" number={4} heading="Accounts and security">
        <p>
          You must give accurate account details and keep them up to date. You are responsible for everything
          that happens under your account, and for keeping your password and devices secure. Sign-in with
          Google is offered as an alternative to a password; where you use it, your Google account’s security
          protects your Notely account too.
        </p>
        <p>
          Tell us promptly at <LegalContact /> if you believe your account has been used without your
          permission.
        </p>
      </LegalSection>

      <LegalSection id="organizations" number={5} heading="Organizations, stores and staff">
        <p>
          A Notely account can belong to one or more organizations. An organization owns its store’s data,
          its subdomain, and any connected domain.
        </p>
        <LegalList>
          <li>
            The organization’s owner and administrators control who is invited, what role each member holds,
            and what each role can do. Invite only people you intend to give that access.
          </li>
          <li>
            A subdomain is assigned from the name the organization chooses. Some names are reserved and
            cannot be taken. A subdomain, once assigned, is not renamed, because links customers saved must
            keep working.
          </li>
          <li>
            You are responsible for what everyone you invite does with your organization’s data.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="merchant-responsibilities" number={6} heading="Merchant responsibilities">
        <p>
          Notely gives you the tools; the business is yours to run. You are responsible for:
        </p>
        <LegalList>
          <li>The accuracy of what you publish — product descriptions, prices, availability, delivery promises and store pages.</li>
          <li>Fulfilling orders your customers place, and handling their questions, cancellations, returns and refunds.</li>
          <li>Complying with the laws that apply to your business, including consumer protection, product safety, advertising, tax and data-protection rules.</li>
          <li>Your own agreements with your customers, including your own store policies where you publish them.</li>
          <li>Having the rights to everything you upload or publish through Notely.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="store-content" number={7} heading="Store content">
        <p>
          Your store pages, product copy and images are yours to write. Notely does not review them before
          they are published. Content must not be unlawful, deceptive, infringing or otherwise in breach of
          section 9.
        </p>
        <p>
          Some Notely features draft text for you from the facts you have already entered — for example
          social post copy. You remain responsible for reviewing and approving anything you publish, however
          it was drafted.
        </p>
      </LegalSection>

      <LegalSection id="products-and-pricing" number={8} heading="Products, prices, stock and orders">
        <p>
          Prices, stock levels, delivery zones and rates, discount codes and return windows are set by the
          merchant, and are shown to shoppers as the merchant configured them. Notely calculates totals and
          re-checks delivery and discount rules when an order is placed, but it does not guarantee that a
          merchant’s figures are correct.
        </p>
        <p>
          Payments from shoppers are taken by the merchant’s payment provider, currently Squad
          (squadco.com), or by bank transfer to the account details a merchant publishes. Funds flow under
          that provider’s terms; Notely records the transaction result and does not hold merchant funds or
          settle payouts.
        </p>
        <p>
          A contract of sale for goods bought on a merchant’s store is between the shopper and that merchant.
          Notely is not a party to it. Refunds recorded in Notely are records of what a merchant decided to
          do; Notely does not move the money.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" number={9} heading="Acceptable use and prohibited activities">
        <p>You agree not to:</p>
        <LegalList>
          <li>Use Notely for anything unlawful, or to sell goods or services you may not lawfully sell.</li>
          <li>Upload or publish content that infringes someone’s intellectual property, privacy or other rights.</li>
          <li>Upload malware, or anything designed to damage or interfere with the service.</li>
          <li>Attempt to access another organization’s data, or any part of the system you have not been given access to.</li>
          <li>Probe, scan or test the security of the service without our written permission, or bypass rate limits, quotas or plan limits.</li>
          <li>Scrape or bulk-extract data from the service other than through the export features provided.</li>
          <li>Impersonate another person or business, or misrepresent your connection to one.</li>
          <li>Use the service to send unsolicited bulk messages.</li>
          <li>Resell or make the service available to a third party outside your own organization, except as the product intends.</li>
          <li>Use the AI features to generate misleading claims about products, or to represent generated text as independent reviews or endorsements.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="intellectual-property" number={10} heading="Intellectual property">
        <p>
          Notely, including its software, design and the Notely name, belongs to Pynacode and its licensors.
          These terms give you permission to use the service; they transfer no ownership in it. You may not
          copy, modify, reverse-engineer or create derivative works from the service except where the law
          says you may.
        </p>
      </LegalSection>

      <LegalSection id="your-content" number={11} heading="Your content">
        <p>
          Everything you put into Notely stays yours. You grant us a licence to host, store, reproduce,
          transmit and display it strictly to operate the service for you — including serving your product
          images from our image provider, sending emails you trigger, and publishing to a social account you
          have connected.
        </p>
        <p>
          The information a shopper gives to your store is business data you are responsible for. Handle it
          in line with the law that applies to you and with whatever you have told your customers.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" number={12} heading="Third-party services">
        <p>
          Notely depends on services operated by other companies — for database hosting, email delivery,
          image hosting, payments, domain registration, sign-in and AI features. They are listed in our{' '}
          <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">
            Privacy Policy
          </Link>
          . Your use of a feature that depends on one of them is also subject to that company’s own terms.
          Notely is not responsible for their acts, outages or decisions, and a change on their side may
          change or end a feature.
        </p>
      </LegalSection>

      <LegalSection id="social" number={13} heading="Facebook, Instagram and other social integrations">
        <p>
          If you connect a Facebook Page or an Instagram professional account, you confirm that you own it or
          are authorized to act for the business that does.
        </p>
        <LegalList>
          <li>Notely publishes only the posts you compose and submit. Nothing is published automatically.</li>
          <li>You are responsible for what you publish and for complying with Meta’s platform terms, community standards and commerce policies.</li>
          <li>Meta may change, limit or withdraw its APIs and permissions at any time. If it does, some or all of this feature may stop working, and we may change or remove it without liability to you.</li>
          <li>You can disconnect an account at any time from the dashboard, and we will erase the stored access token and ask Meta to revoke access. You can also remove Notely from your Facebook account settings.</li>
          <li>Posts already published to your accounts remain on those platforms; disconnecting does not delete them.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="limits" number={14} heading="Plans, usage limits and integration limits">
        <p>
          Notely is offered on plan tiers, with the features, seat and store limits and prices shown in the
          app at the time you subscribe. Subscription charges are billed in Nigerian Naira through our
          billing provider, on the cycle you select. We may change plans, limits and prices; where a change
          affects an existing paid subscription, we will give reasonable notice before it applies to you.
        </p>
        <p>
          Some features are rate-limited or quota-limited — for example AI-assisted search and social
          publishing — to keep the service usable for everyone and within the limits of the providers behind
          them. Those limits may change. Any programmatic access to Notely, where offered, is subject to the
          limits we set and to these terms.
        </p>
      </LegalSection>

      <LegalSection id="availability" number={15} heading="Service availability and changes">
        <p>
          We work to keep Notely available, but we do not commit to any particular level of uptime,
          performance or support response, and we do not offer a service-level agreement. The service may be
          unavailable for maintenance, for reasons outside our control, or because a service it depends on
          has failed.
        </p>
        <p>
          We may add, change or remove features. Where a change would materially reduce a core feature you
          rely on, we will give reasonable notice where we practically can.
        </p>
      </LegalSection>

      <LegalSection id="suspension" number={16} heading="Suspension and termination">
        <p>
          We may suspend or terminate access to an account or an organization if it breaches these terms, if
          it puts the service or other users at risk, if payment for a paid plan fails and is not resolved,
          or if we are required to by law. Where circumstances allow, we will tell you first and give you a
          chance to put it right.
        </p>
        <p>
          You may stop using Notely at any time. To close an account or an organization, or to ask for its
          data to be deleted, email <LegalContact /> from the address on the account. Deletion of an
          organization removes its store records, and a closed store’s subdomain stops serving. Export
          anything you need first — the reports and lists in the dashboard can be downloaded as spreadsheets.
        </p>
        <p>
          Sections that by their nature should survive termination — content ownership, disclaimers,
          limitation of liability, indemnity and governing law — continue to apply afterwards.
        </p>
      </LegalSection>

      <LegalSection id="privacy" number={17} heading="Data and privacy">
        <p>
          Our{' '}
          <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">
            Privacy Policy
          </Link>{' '}
          explains what information Notely handles and why, and forms part of these terms. In short: we
          process your organization’s business data to run the service for you, we do not sell personal
          information, and each organization’s data is kept separate from every other’s.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" number={18} heading="Disclaimers">
        <p>
          To the fullest extent the law allows, Notely is provided “as is” and “as available”, without
          warranties of any kind, whether express or implied, including any implied warranty of
          merchantability, fitness for a particular purpose or non-infringement.
        </p>
        <p>
          We do not warrant that the service will be uninterrupted or error-free, that defects will be
          corrected, or that figures the service calculates — stock levels, totals, valuations, delivery
          quotes, reports — are free of error. Check anything you rely on for accounting, tax or regulatory
          purposes. Output from AI-assisted features may be wrong; review it before you rely on it or publish
          it.
        </p>
      </LegalSection>

      <LegalSection id="liability" number={19} heading="Limitation of liability">
        <p>
          To the fullest extent the law allows, neither Pynacode nor anyone working with us is liable for
          indirect, incidental, special, consequential or punitive damages, or for lost profits, lost
          revenue, lost sales, lost goodwill or lost or corrupted data, however caused.
        </p>
        <p>
          To the fullest extent the law allows, our total liability arising out of or relating to Notely, in
          aggregate, is limited to the amount you paid us for the service in the three months before the
          event giving rise to the claim; where you have paid us nothing, our liability is limited to the
          resupply of the service.
        </p>
        <p>
          Nothing in these terms excludes liability that cannot lawfully be excluded, including liability for
          fraud.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" number={20} heading="Indemnification">
        <p>
          You agree to indemnify and hold harmless Pynacode and the people who work with it against claims,
          damages, losses and reasonable costs arising from your use of Notely, the content you publish, the
          goods you sell, your breach of these terms, or your breach of the rights of a third party —
          including your own customers.
        </p>
      </LegalSection>

      <LegalSection id="changes" number={21} heading="Changes to these terms">
        <p>
          We may update these terms as the service changes. The current version is always published at this
          address with the “last updated” date at the top. Where a change is material we will take reasonable
          steps to tell you. Continuing to use Notely after a change takes effect means you accept the
          updated terms; if you do not accept them, stop using the service and ask us to close your account.
        </p>
      </LegalSection>

      <LegalSection id="general" number={22} heading="Governing law and general terms">
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria, and the courts of Nigeria
          have jurisdiction over any dispute arising from them, without affecting any right you may have
          under the mandatory law of your own country of residence.
        </p>
        <p>
          If any provision of these terms is held unenforceable, the rest remain in force. Our not enforcing
          a provision is not a waiver of it. You may not transfer your rights under these terms without our
          consent; we may transfer ours as part of a business transfer. These terms, together with the
          Privacy Policy, are the whole agreement between us about Notely.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={23} heading="Contact">
        <p>
          Questions about these terms: email <LegalContact />. Notely is operated by Pynacode (CAC business
          name registration number 9663547), Nigeria.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
