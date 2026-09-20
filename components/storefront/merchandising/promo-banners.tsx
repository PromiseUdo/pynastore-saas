import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PromoBanner } from '@/lib/storefront/types';

export function PromoBanners({ banners }: { banners: PromoBanner[] }) {
  const large = banners.find((b) => b.size === 'lg') ?? banners[0];
  const small = banners.filter((b) => b.id !== large?.id).slice(0, 2);
  if (!large) return null;

  return (
    <section className="sf-container py-10 lg:py-14">
      <div className="grid gap-4 lg:grid-cols-2">
        <Banner banner={large} className="min-h-[320px] lg:min-h-[420px]" heading="text-3xl lg:text-4xl" />
        <div className="grid gap-4">
          {small.map((b) => (
            <Banner key={b.id} banner={b} className="min-h-[200px]" heading="text-2xl" />
          ))}
        </div>
      </div>
    </section>
  );
}

function Banner({
  banner,
  className,
  heading,
}: {
  banner: PromoBanner;
  className?: string;
  heading: string;
}) {
  return (
    <Link
      href={banner.ctaHref}
      className={cn('group relative flex flex-col justify-end overflow-hidden rounded-2xl p-6 lg:p-8', className)}
    >
      <Image
        src={banner.imageUrl}
        alt=""
        fill
        sizes="(max-width:1024px) 100vw, 50vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent" />
      <div className="relative text-white">
        <p className={cn('font-display font-semibold leading-tight', heading)}>{banner.title}</p>
        <p className="mt-1 text-sm text-white/85">{banner.subtitle}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 group-hover:underline">
          {banner.ctaLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
