/*
 * The shop's logo, right in light AND dark mode.
 *
 * Both images are in the page and storefront.css shows the one for the
 * current theme (`data-sf-theme`), so the theme toggle switches them with no
 * flash and no script. With no dark-mode logo, dark mode shows the normal one
 * on a light backing: a dark logo on a transparent background would
 * otherwise vanish into the page, and recolouring a picture would change the
 * merchant's brand.
 */
import { cn } from '@/lib/utils';

export function StoreLogo({
  src,
  darkSrc,
  alt,
  className,
}: {
  src: string;
  darkSrc?: string | null;
  alt: string;
  className?: string;
}) {
  return (
    <span className="sf-logo inline-flex shrink-0" data-has-dark={darkSrc ? '' : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={cn('sf-logo-default', className)} />
      {darkSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={darkSrc} alt={alt} className={cn('sf-logo-dark', className)} />
      )}
    </span>
  );
}
