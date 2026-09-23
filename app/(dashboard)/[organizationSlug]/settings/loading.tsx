import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </div>
      <div className="max-w-3xl space-y-6 px-6 py-6">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
