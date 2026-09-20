/*
 * The account area reads the session and then the customer, so there is a
 * real wait here on a cold navigation. Showing the shape of the answer
 * beats showing nothing: the page doesn't jump when the content lands.
 */
import { Skeleton } from '@/components/ui/skeleton';

export default function AccountLoading() {
  return (
    <div className="space-y-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-3xl border border-border bg-card p-5 sm:p-6">
          <Skeleton className="h-4 w-32" />
          <div className="mt-5 space-y-3">
            <Skeleton className="h-4 w-full max-w-[18rem]" />
            <Skeleton className="h-4 w-full max-w-[12rem]" />
          </div>
        </div>
      ))}
    </div>
  );
}
