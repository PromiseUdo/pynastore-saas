/*
 * The <h1> for an account sub-page.
 *
 * The shell greets you on the overview only, so every other page states what
 * it is — for a screen reader jumping by heading as much as for anyone
 * scanning the top of a phone screen.
 */
export function AccountHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{children}</h1>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
