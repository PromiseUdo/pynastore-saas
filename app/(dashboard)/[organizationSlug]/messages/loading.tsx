import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2 border-r p-3">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <div className="hidden space-y-3 p-6 lg:block">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="ml-auto h-12 w-1/2" />
          <Skeleton className="h-16 w-3/5" />
        </div>
      </div>
    </div>
  );
}
