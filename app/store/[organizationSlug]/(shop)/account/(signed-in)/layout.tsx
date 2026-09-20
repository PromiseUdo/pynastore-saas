/*
 * The shell around the signed-in account pages.
 *
 * A route group, so the URLs stay /account and /account/profile while the
 * sign-in and reset pages — which must NOT wear this shell, and which nobody
 * signed in ever sees — stay outside it.
 *
 * The session is checked once, here, rather than in each page: every route
 * under this layout requires an account, and a check repeated per page is a
 * check that eventually gets forgotten on one.
 *
 * THE GREETING IS ONLY ON THE OVERVIEW. "Hi, Ada" is a welcome, and a
 * welcome repeated above "Add an address" is just furniture — on a phone it
 * pushed the actual form most of the way down the first screen. Sub-pages
 * get a small breadcrumb-ish label back to the account instead, and their
 * own <h1> lives in the page, where it belongs.
 */
import { requireShopper } from '@/lib/storefront/account/session';
import { AccountNav, SignOutButton } from '../_components/account-nav';
import { AccountGreeting } from '../_components/account-greeting';

export default async function SignedInAccountLayout({ children }: { children: React.ReactNode }) {
  const shopper = await requireShopper('/account');

  return (
    <div className="sf-container py-6 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <AccountGreeting firstName={shopper.firstName} />

        {/* `minmax(0,1fr)` on BOTH breakpoints: a grid track sized `auto`
          * takes its width from its widest content, which let the nav strip
          * push every account page sideways on a phone. */}
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 sm:mt-7 sm:gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <AccountNav />
          <div className="min-w-0">{children}</div>
        </div>

        {/* Phone: the way out sits after what you came to read, rather than
          * off the end of a horizontal scroll strip. */}
        <div className="mt-8 lg:hidden">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
