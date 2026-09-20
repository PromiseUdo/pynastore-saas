'use client';

/*
 * One saved address, with the three things you can do to it.
 *
 * Delete goes through an AlertDialog that names the address and says the
 * removal is permanent — an address is easy to delete and tedious to retype,
 * so the confirm earns its interruption. "Make default" is a plain form
 * post: it changes something, so it must not be a link.
 */
import Link from 'next/link';
import { Star, Trash2 } from 'lucide-react';
import {
  AlertDialogRoot,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { Address } from '@/lib/storefront/types';
import { deleteAddressAction, setDefaultAddressAction } from '@/features/shop-account/address-actions';

export function AddressCard({ address }: { address: Address }) {
  const lines = [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(', '),
    [address.country, address.postalCode].filter(Boolean).join(' '),
  ].filter((line): line is string => Boolean(line && line.trim()));

  return (
    <article className="flex h-full flex-col rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{address.fullName}</h3>
        {address.isDefault && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
            <Star className="size-3 fill-current text-brand" aria-hidden />
            Default
          </span>
        )}
      </div>

      <address className="mt-2 not-italic text-sm text-muted-foreground">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
        <span className="mt-1 block">{address.phone}</span>
      </address>

      <div className="mt-4 flex flex-wrap items-center gap-2 pt-1">
        <Link
          href={`/account/addresses/${address.id}`}
          className="h-10 rounded-full border border-border px-4 text-sm font-medium leading-10 transition-colors hover:border-brand hover:text-brand"
        >
          Edit
        </Link>

        {!address.isDefault && (
          <form action={setDefaultAddressAction}>
            <input type="hidden" name="id" value={address.id} />
            <button
              type="submit"
              className="h-10 rounded-full border border-border px-4 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
            >
              Make default
            </button>
          </form>
        )}

        <AlertDialogRoot>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label={`Delete the address for ${address.fullName}`}
              className="ml-auto flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this address?</AlertDialogTitle>
              <AlertDialogDescription>
                {address.fullName}, {address.line1}
                {address.city ? `, ${address.city}` : ''} will be removed from your address book.
                You can always add it again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <form action={deleteAddressAction}>
                <input type="hidden" name="id" value={address.id} />
                <AlertDialogAction type="submit">Delete address</AlertDialogAction>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      </div>
    </article>
  );
}
