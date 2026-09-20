/*
 * app/(legal)/layout.tsx
 *
 * Chrome for the public legal pages (/privacy, /terms). These are platform
 * pages, not tenant pages: proxy.ts serves them on the marketing/platform
 * host only (they are listed in PUBLIC_PATHS there), so they load with no
 * session, no organization and no JavaScript interaction — which is what
 * the Meta App Review reviewer opening https://getnotely.io/privacy in a
 * private window needs.
 *
 * Deliberately plain: the same tokens, font and radius as the rest of the
 * app (app/globals.css), and the same wordmark as the sign-in pages.
 */
import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              N
            </span>
            <span className="text-base font-semibold text-foreground">Notely</span>
          </Link>
          <nav aria-label="Legal" className="flex items-center gap-4 text-sm">
            <Link
              href="/privacy"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Notely — operated by Pynacode.</p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
            <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
              Terms of Service
            </Link>
            <a
              href="mailto:pynacode@gmail.com"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
