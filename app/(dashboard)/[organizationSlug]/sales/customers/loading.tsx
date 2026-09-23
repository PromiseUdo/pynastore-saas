import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div>
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      <div className="border-b px-6 py-2.5">
        <Skeleton className="h-8 w-full max-w-2xl" />
      </div>
      <div className="space-y-2 px-6 py-6">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
