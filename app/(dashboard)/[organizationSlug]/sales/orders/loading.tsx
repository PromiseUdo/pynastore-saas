import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrdersLoading() {
  return (
    <>
      <PageHeader
        title="Orders"
        description="Everything you've sold — online and over the counter."
      />
      <PageBody>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      </PageBody>
    </>
  );
}
