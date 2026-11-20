/*
 * Photo scenes for the public site: a real person at the centre, with the
 * product floating around them — the order that just came in, the payment
 * that landed, the count that dropped. People remember a face; the cards
 * say what Pynastore did for her.
 *
 * The photos (public/site-photos/) are web-sized copies; the full-size
 * originals are kept out of git in brand-source/marketing-originals/. They
 * are stock photos of models, not customers, and nothing here says
 * otherwise. The cards are illustrations with made-up figures, so they are
 * aria-hidden; each figure's caption says what the picture shows.
 *
 * Server components: next/image serves each photo at the size the screen
 * needs, in a modern format.
 */
import Image from 'next/image';
import { Check, Landmark, ShoppingBag, Store, TriangleAlert } from 'lucide-react';
import { PLATFORM_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

/* ── a floating card ───────────────────────────────────────────────────── */

type Tone = 'green' | 'sun' | 'plain';

function FloatCard({
  icon: Icon,
  tone = 'plain',
  title,
  detail,
  className,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: Tone;
  title: string;
  detail: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative z-10 flex items-center gap-3 rounded-2xl border bg-card p-3 pr-4 shadow-[0_18px_40px_-16px_rgba(17,33,26,0.4)]',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          tone === 'green' && 'bg-primary text-primary-foreground',
          tone === 'sun' && 'bg-mk-sun text-[#11211a]',
          tone === 'plain' && 'bg-mk-leaf text-primary',
        )}
      >
        <Icon className="size-4" strokeWidth={2.5} />
      </span>
      <div className="text-[11.5px] leading-snug">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/*
 * The cards have no entrance animation of their own: they arrive with the
 * photo. A staggered fade-in left cards frozen half-visible in testing (a
 * browser that stops redrawing mid-animation), and a half-drawn card looks
 * broken — still is safer than clever here.
 */

/* ── the hero: a shop owner, and her shop coming to her phone ──────────── */

export function HeroScene({ className }: { className?: string }) {
  return (
    <figure className={cn('relative', className)}>
      <div
        aria-hidden
        className="absolute -inset-x-4 -bottom-8 top-10 rounded-[2.5rem] bg-mk-leaf sm:-inset-x-8 lg:-right-20 lg:left-6"
      />
      <div className="relative overflow-hidden rounded-[2rem] shadow-[0_30px_60px_-30px_rgba(17,33,26,0.45)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
        <div className="relative aspect-[5/4] sm:aspect-[4/3]">
          <Image
            src="/site-photos/hero.jpg"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 640px, 100vw"
            className="object-cover object-[68%_center]"
          />
        </div>
      </div>

      <FloatCard
        icon={ShoppingBag}
        tone="sun"
        title="New order · ₦18,500"
        detail="Vitamin C serum, from your Instagram post"
        className="absolute left-3 top-4 sm:-left-6 sm:top-8"
      />
      <FloatCard
        icon={Check}
        tone="green"
        title="Payment received · ₦18,500"
        detail="Paid straight to your bank"
        className="absolute right-3 top-[74%] hidden sm:flex lg:-right-8"
      />
      <FloatCard
        icon={TriangleAlert}
        title="Vitamin C serum is running low"
        detail="3 left at Lekki · 14 at Ikeja"
        className="absolute -bottom-6 left-6 hidden sm:flex"
      />
      <figcaption className="sr-only">
        A shop owner among the shelves of her beauty shop, smiling at her phone. Around her: a new order from Instagram, the payment for it
        arriving in her bank, and a warning that one product is running low in one branch.
      </figcaption>
    </figure>
  );
}

/* ── stock: a sale at the counter, and the count that follows it ────────── */

export function CounterScene() {
  const branches = [
    { name: 'Ikeja', n: 10, low: false, sold: true },
    { name: 'Lekki', n: 3, low: true, sold: false },
    { name: 'Abuja', n: 7, low: false, sold: false },
  ];
  return (
    <figure className="relative mx-auto w-full max-w-md pb-16 sm:pb-10">
      <div className="relative ml-auto w-[82%] overflow-hidden rounded-[1.75rem] shadow-[0_24px_50px_-28px_rgba(17,33,26,0.45)]">
        <div className="relative aspect-[4/5]">
          <Image
            src="/site-photos/counter.jpg"
            alt=""
            fill
            sizes="(min-width: 1024px) 380px, 80vw"
            className="object-cover object-top"
          />
        </div>
      </div>

      <FloatCard
        icon={Store}
        tone="green"
        title="Sold at the counter · ₦12,500"
        detail="Shea body butter, Ikeja branch"
        className="absolute left-0 top-6"
      />

      <div
        aria-hidden
        className="absolute bottom-0 left-0 z-10 w-[17rem] rounded-2xl border bg-card p-3.5 shadow-[0_18px_40px_-16px_rgba(17,33,26,0.4)]"
      >
        <p className="text-[11.5px] font-semibold">Shea body butter · stock</p>
        <ul className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
          {branches.map((b) => (
            <li
              key={b.name}
              className={cn(
                'relative rounded-xl border px-1.5 py-1.5',
                b.low ? 'border-mk-sun bg-mk-sun-soft' : 'bg-muted/50',
                b.sold && 'border-primary',
              )}
            >
              <span className="block text-[10.5px] text-muted-foreground">{b.name}</span>
              <span className="font-mk-display text-[17px] font-bold tabular-nums">{b.n}</span>
              {b.sold && (
                <span className="absolute -top-2 right-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">−1</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] text-muted-foreground">Taken off Ikeja’s count as she sold it. Lekki is running low.</p>
      </div>
      <figcaption className="sr-only">
        A shop owner serving a customer at her counter. Beside her: the sale she just made, and the stock count for that product in each of three
        branches, with the branch she sold from one lower and another branch running low.
      </figcaption>
    </figure>
  );
}

/* ── getting paid: a shopper pays, and the money lands in the shop's bank ─ */

export function PaymentScene() {
  return (
    <figure className="relative mx-auto w-full max-w-md pb-6">
      <div className="relative w-[70%] overflow-hidden rounded-[1.75rem] shadow-[0_24px_50px_-28px_rgba(17,33,26,0.45)]">
        <div className="relative aspect-[3/4]">
          <Image
            src="/site-photos/shopper.jpg"
            alt=""
            fill
            sizes="(min-width: 1024px) 320px, 70vw"
            className="object-cover object-[center_25%]"
          />
        </div>
      </div>

      <div
        aria-hidden
        className="absolute bottom-0 right-0 z-10 w-[72%] rounded-2xl border bg-card p-4 shadow-[0_24px_50px_-20px_rgba(17,33,26,0.45)]"
      >
        <p className="flex items-center justify-between text-[12px] font-semibold">
          <span>Paid by card · ₦45,000</span>
          <span className="rounded-full bg-[#e1f2e7] px-2 py-0.5 text-[10.5px] text-[#0b5a3b]">Paid</span>
        </p>
        <dl className="mt-3 space-y-1.5 text-[11.5px]">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Paystack’s fee</dt>
            <dd className="tabular-nums">−₦775</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{PLATFORM_NAME}’s commission</dt>
            <dd className="font-semibold tabular-nums">₦0</dd>
          </div>
          <div className="flex justify-between border-t pt-1.5 text-[13px] font-semibold">
            <dt>You receive</dt>
            <dd className="tabular-nums text-primary">₦44,225</dd>
          </div>
        </dl>
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-muted/70 px-3 py-2 text-[11px]">
          <Landmark className="size-3.5 shrink-0 text-muted-foreground" />
          Straight to your bank account ••4821
        </p>
      </div>
      <figcaption className="sr-only">
        A shopper at home with her phone and bank card, surrounded by shopping bags. Beside her: her card payment, Paystack’s fee, no commission
        to {PLATFORM_NAME}, and what the shop receives in its own bank account.
      </figcaption>
    </figure>
  );
}
