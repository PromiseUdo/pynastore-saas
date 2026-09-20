import { Lock } from 'lucide-react';

/** Full-page state for a route the member's role can't open. */
export function AccessDenied({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-4" />
      </div>
      <h2 className="mt-3 text-base font-semibold text-foreground">You don’t have access to {what}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Ask an owner or admin in your organization to update your role if you need it.
      </p>
    </div>
  );
}
