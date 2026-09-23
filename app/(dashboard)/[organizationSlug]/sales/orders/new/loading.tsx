import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export default function NewSaleLoading() {
  return (
    <>
      <PageHeader
        title="New sale"
        description="Ring up someone at the counter, or an order taken over the phone."
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
