/*
 * The frame every account form sits in: one narrow card, one heading, one
 * line saying what this page is for, and a way out at the bottom.
 *
 * Kept deliberately plain. This is the only part of the storefront where a
 * shopper has to stop shopping and do admin, and the fastest version of that
 * is the one with nothing extra on it.
 */
import Link from 'next/link';
import * as React from 'react';

export function AuthShell({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="sf-container py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[27rem]">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{intro}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/" className="underline underline-offset-4 hover:text-foreground">
            Keep shopping without an account
          </Link>
        </p>
      </div>
    </div>
  );
}

/** "or" between the Google button and the email form. */
export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden>
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Shown above a form when something went wrong for the form as a whole. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {children}
    </p>
  );
}
