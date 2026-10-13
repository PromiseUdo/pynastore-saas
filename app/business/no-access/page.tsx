/*
 * The business host's answer to a link for a shop the person isn't a member
 * of (ROADMAP 19.1). Says nothing about that shop — not even whether it
 * exists — and leads back to their own.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/layout/access-denied';
import { buttonVariants } from '@/components/ui/button-variants';

export const metadata: Metadata = { title: 'No access', robots: { index: false, follow: false } };

export default function BusinessNoAccessPage() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <AccessDenied what="this shop" hint="The link is for a shop you’re not a member of. If you should be, ask its owner to invite you." />
      <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Go to your shop
      </Link>
    </main>
  );
}
