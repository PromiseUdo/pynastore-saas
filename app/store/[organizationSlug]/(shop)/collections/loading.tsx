/* Matches the index layout — heading block, then a 3-up card grid — so the
 * page does not jump when the real content lands. */
export default function Loading() {
  return (
    <div className="sf-container py-6 lg:py-10">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-5 h-9 w-64 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
      <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[4/3] animate-pulse rounded-[1.25rem] bg-muted" />
            <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
