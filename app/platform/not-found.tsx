/* Deliberately the same plain 404 whether the page is missing or the visitor
 * isn't platform staff — see ./layout.tsx. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">There’s nothing at this address.</p>
    </div>
  );
}
