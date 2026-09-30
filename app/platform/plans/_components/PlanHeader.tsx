import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** A plan page's header: back to the list, the plan's name, and whether it's on sale. */
export function PlanHeader({
  title,
  description,
  onSale,
  isTrialPlan,
}: {
  title: string;
  description: string;
  onSale?: boolean;
  isTrialPlan?: boolean;
}) {
  return (
    <div className="border-b bg-background px-4 py-4 sm:px-6">
      <Link href="/platform/plans" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" aria-hidden /> Plans and pricing
      </Link>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {onSale !== undefined && <Badge variant={onSale ? 'success' : 'muted'}>{onSale ? 'On sale' : 'Off sale'}</Badge>}
        {isTrialPlan && <Badge variant="info">Free trial plan</Badge>}
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
