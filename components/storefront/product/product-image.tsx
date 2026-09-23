/*
 * components/storefront/product/product-image.tsx
 *
 * A product image, or an honest gap where one isn't.
 *
 * WHY THIS EXISTS: a product with no image gave `src=""`, which the browser
 * resolves to the current page — so an image-less product quietly asked the
 * browser to download the whole page again, per card, and Next warned about
 * it in the console. Every product image on the storefront went through one
 * of eight copies of `?? ''`, so this is the one place to get it right.
 *
 * The placeholder invents nothing: no stock photo, no "coming soon", no
 * borrowed image from another product (AGENTS: never invent a merchant's
 * content). It is deliberately QUIET — the same neutral tile the card
 * already had, with a faint icon. A loud placeholder on every card reads as
 * "this shop is broken" rather than "this product has no photo yet", and a
 * store still filling in its catalogue should not look worse than it is.
 *
 * Takes the same props as next/image in the two shapes the storefront uses:
 * `fill` inside a positioned box, or explicit width/height.
 */
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Shared = {
  /** the merchant's image, or null/'' when they haven't added one */
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** shown in the placeholder — usually the product name */
  name?: string;
};

type ProductImageProps = Shared & ({ fill: true; width?: never; height?: never } | { fill?: false; width: number; height: number });

export function ProductImage({ src, alt, className, sizes, priority, name, ...size }: ProductImageProps) {
  const trimmed = typeof src === 'string' ? src.trim() : '';

  if (!trimmed) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex items-center justify-center bg-tile text-muted-foreground',
          size.fill ? 'absolute inset-0' : '',
          className,
        )}
        style={size.fill ? undefined : { width: size.width, height: size.height }}
      >
        <ImageIcon className="size-1/4 max-h-8 min-h-4 w-auto opacity-15" aria-hidden />
      </span>
    );
  }

  return size.fill ? (
    <Image src={trimmed} alt={alt} fill sizes={sizes} priority={priority} className={className} />
  ) : (
    <Image
      src={trimmed}
      alt={alt}
      width={size.width}
      height={size.height}
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}
