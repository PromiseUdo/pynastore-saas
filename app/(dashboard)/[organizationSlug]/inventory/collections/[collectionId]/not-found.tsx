import Link from 'next/link';
import { Layers } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';

export default function CollectionNotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <Layers className="size-6 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold text-foreground">This collection doesn’t exist</h2>
      <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link href="/inventory/collections" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}>
        Back to collections
      </Link>
    </div>
  );
}
