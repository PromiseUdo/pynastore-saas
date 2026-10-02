import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-3 px-6 py-6">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
