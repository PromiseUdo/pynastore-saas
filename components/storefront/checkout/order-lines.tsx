/*
 * The lines of a placed order, and its delivery address as text.
 *
 * Shared by the confirmation page, the account's order detail and the guest
 * lookup, because all three are showing the same record and any difference
 * between them would be a bug waiting to be reported as one.
 *
 * Every line reads from the ORDER, never from the catalogue: the name, the
 * price and the image are what they were when the order was placed. `slug`
 * links back to the product only while it still exists — a delisted product
 * leaves a line that still reads correctly, just without a link.
 */
import Link from 'next/link';
import Image from 'next/image';
import { formatMoney } from '@/lib/storefront/format';
import type { StorefrontOrder } from '@/lib/storefront/orders/types';

export function OrderLines({ order }: { order: StorefrontOrder }) {
  return (
    <ul className="mt-4 divide-y">
      {order.lines.map((line) => (
        <li key={line.id} className="flex items-center gap-3 py-3">
          {line.imageUrl ? (
            <Image
              src={line.imageUrl}
              alt=""
              width={48}
              height={60}
              className="h-[60px] w-12 rounded-lg bg-tile object-cover"
            />
          ) : (
            <div className="h-[60px] w-12 rounded-lg bg-tile" aria-hidden />
          )}

          <div className="min-w-0 flex-1">
            {line.slug ? (
              <Link
                href={`/products/${line.slug}`}
                className="line-clamp-1 text-sm font-medium hover:text-brand"
              >
                {line.name}
              </Link>
            ) : (
              <p className="line-clamp-1 text-sm font-medium">{line.name}</p>
            )}
            {line.variantName && <p className="text-xs text-muted-foreground">{line.variantName}</p>}
            <p className="text-xs text-muted-foreground">Qty {line.quantity}</p>
          </div>

          <p className="shrink-0 text-sm font-semibold tabular-nums">
            {formatMoney(line.totalPrice, order.currency)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The delivery address as lines, skipping the parts that are empty. */
export function orderAddressLines(order: StorefrontOrder): string[] {
  const address = order.shippingAddress;
  const region = [address.city, address.state].filter(Boolean).join(', ');

  return [
    address.fullName,
    address.line1,
    address.line2 ?? '',
    [region, address.postalCode ?? ''].filter(Boolean).join(' '),
    address.country,
    address.phone,
  ].filter((line) => line.trim().length > 0);
}
