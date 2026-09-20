import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-2 border-b px-6 py-2.5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="space-y-2 px-6 py-6">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
