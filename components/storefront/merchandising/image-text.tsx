/*
 * A picture and the merchant's own words (ROADMAP 15.4) — their story, a
 * promise, a launch. Everything here is what they wrote and uploaded: the
 * text is plain (line breaks kept, never HTML), the picture is their own
 * upload, and the button appears only when it has both words and a page on
 * the shop to go to. No picture: the words stand alone, centred.
 *
 * Server component.
 */
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function ImageText({
  heading,
  body,
  imageUrl,
  imageSide,
  buttonLabel,
  buttonHref,
}: {
  heading: string;
  body: string;
  imageUrl: string | null;
  imageSide: 'left' | 'right';
  buttonLabel: string;
  buttonHref: string;
}) {
  const words = (
    <div className={cn(!imageUrl && 'mx-auto max-w-2xl text-center')}>
      <h2 className="font-display text-3xl leading-tight lg:text-4xl">{heading}</h2>
      {body && <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-muted-foreground">{body}</p>}
      {buttonLabel && buttonHref && (
        <Link
          href={buttonHref}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-button,999px)] bg-brand px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
        >
          {buttonLabel}
        </Link>
      )}
    </div>
  );

  if (!imageUrl) return <section className="sf-container sf-section">{words}</section>;

  return (
    <section className="sf-container sf-section">
      <div className="grid items-center gap-8 md:grid-cols-2 lg:gap-14">
        <div
          className={cn(
            'relative aspect-[4/3] overflow-hidden rounded-3xl bg-tile',
            imageSide === 'right' && 'md:order-2',
          )}
        >
          <Image src={imageUrl} alt="" fill sizes="(max-width:768px) 100vw, 50vw" className="object-cover" />
        </div>
        {words}
      </div>
    </section>
  );
}
