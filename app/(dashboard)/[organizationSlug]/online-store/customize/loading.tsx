import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="border-b px-6 py-3">
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="max-w-5xl space-y-4 px-6 py-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
