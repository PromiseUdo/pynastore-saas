import { Skeleton } from '@/components/ui/skeleton';

/** While a notification list loads (the admin's and the console's). */
export function NotificationListSkeleton() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="border-b px-6 py-2.5">
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="space-y-2 px-6 py-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
