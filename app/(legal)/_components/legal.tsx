/*
 * app/(legal)/_components/legal.tsx
 *
 * The shared shape of a legal document: one <article>, numbered <section>s
 * with real <h2>s, and body copy held to a readable measure. Extracted the
 * moment there was a second page (AGENTS.md §9) so /privacy and /terms
 * cannot drift apart typographically.
 *
 * Server components — no state, no client JavaScript. The pages must render
 * fully from the HTML response.
 */
import type { ReactNode } from 'react';

export function LegalDocument({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** Human-readable date, already formatted (e.g. "20 September 2026"). */
  updated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="border-b pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated: {updated}</p>
        {intro ? <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">{intro}</div> : null}
      </header>
      <div className="divide-y">{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  number,
  heading,
  children,
}: {
  id: string;
  number: number;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="py-6">
      <h2 id={`${id}-heading`} className="text-base font-semibold text-foreground">
        {number}. {heading}
      </h2>
      <div className="mt-3 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** A sub-heading inside a section (e.g. one third-party service). */
export function LegalSubheading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="ml-5 list-disc space-y-2 marker:text-muted-foreground/60">{children}</ul>;
}

/** Highlights the one fact a reader most needs — used sparingly. */
export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
  );
}

export function LegalContact() {
  return (
    <a
      href="mailto:pynacode@gmail.com"
      className="font-medium text-foreground underline underline-offset-4"
    >
      pynacode@gmail.com
    </a>
  );
}
