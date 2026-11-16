import { cn } from '@/lib/utils';

/** The opening of a section on the public site: a short label, the headline, and one line of explanation. */
export function SectionIntro({
  label,
  title,
  body,
  align = 'left',
  className,
  id,
}: {
  label?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {label && (
        <p className={cn('flex items-center gap-2 text-[13px] font-semibold text-primary', align === 'center' && 'justify-center')}>
          <span aria-hidden className="h-px w-5 bg-primary" />
          {label}
        </p>
      )}
      <h2 id={id} className="text-balance mt-3 font-mk-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.6rem]">
        {title}
      </h2>
      {body && <p className="text-pretty mt-4 text-[17px] leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}

/** A saffron highlighter stroke under a few words of a headline (`.mk-mark` in app/globals.css). */
export function Marked({ children }: { children: React.ReactNode }) {
  return <span className="mk-mark">{children}</span>;
}
