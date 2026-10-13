'use client';

/*
 * The "Continue with Google / Apple" buttons on the staff sign-in and
 * register pages.
 *
 * On the web each is a form posting to its server action, as before. Inside
 * the business app (ROADMAP 19.2) the providers refuse an embedded WebView,
 * so the same button runs the sign-in in the in-app browser sheet instead
 * (lib/business-app/client.ts) and comes back signed in, on `next`.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inBusinessApp, signInInBusinessApp } from '@/lib/business-app/client';
import type { BusinessSignInProvider } from '@/lib/business-app/paths';

type Action = (formData: FormData) => void | Promise<void>;

export function SignInProviders({
  googleAction,
  appleAction,
  hidden,
  next,
}: {
  googleAction: Action;
  /** null when Sign in with Apple isn't configured: no button */
  appleAction: Action | null;
  /** extra fields the web forms carry (callbackUrl, invite) */
  hidden: Record<string, string | null | undefined>;
  /** the business-host page to land on after an in-app sign-in */
  next: string;
}) {
  const [opening, setOpening] = React.useState<BusinessSignInProvider | null>(null);

  function inApp(provider: BusinessSignInProvider) {
    return (event: React.FormEvent<HTMLFormElement>) => {
      if (!inBusinessApp()) return; // the web: the form posts as usual
      event.preventDefault();
      setOpening(provider);
      // The sheet either brings the app back signed in (a full navigation)
      // or is closed by hand, which leaves this page as it was.
      void signInInBusinessApp(provider, next).finally(() => setOpening(null));
    };
  }

  const fields = Object.entries(hidden).map(([name, value]) =>
    value ? <input key={name} type="hidden" name={name} value={value} /> : null,
  );

  return (
    <div className="space-y-2">
      <form action={googleAction} onSubmit={inApp('google')}>
        {fields}
        <Button type="submit" variant="outline" className="w-full" size="sm" disabled={opening !== null}>
          {opening === 'google' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleIcon />}
          Continue with Google
        </Button>
      </form>
      {appleAction && (
        <form action={appleAction} onSubmit={inApp('apple')}>
          {fields}
          <Button type="submit" variant="outline" className="w-full" size="sm" disabled={opening !== null}>
            {opening === 'apple' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <AppleIcon />}
            Continue with Apple
          </Button>
        </form>
      )}
    </div>
  );
}

/** What a failed Google or Apple round trip says, from the `error` the page was sent back with. */
export function providerErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === 'OAuthAccountNotLinked') return 'That email already has an account. Sign in with your password, then try again.';
  if (error === 'AccessDenied') return 'Sign-in was cancelled.';
  return 'We couldn’t sign you in that way. Please try again, or use your email and password.';
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/** Apple's logo, in the text colour so it reads in light and dark mode. */
function AppleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.59 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.29-.88-2.3-3.5zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.56-1.24z" />
    </svg>
  );
}
