import Link from 'next/link';
import { FileX } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button-variants';

export default function StorePageNotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <FileX className="size-6 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold text-foreground">This page doesn’t exist</h2>
      <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link href="/settings/pages" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}>
        Back to store pages
      </Link>
    </div>
  );
}
