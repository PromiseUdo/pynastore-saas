import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RatingStars({
  value,
  count,
  size = 14,
  showValue = false,
  className,
}: {
  value: number;
  count?: number;
  size?: number;
  showValue?: boolean;
  className?: string;
}) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={`Rated ${value} out of 5`}>
      <span className="relative inline-flex" style={{ width: size * 5, height: size }}>
        <span className="absolute inset-0 flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} style={{ width: size, height: size }} className="text-muted-foreground/30" strokeWidth={1.5} />
          ))}
        </span>
        <span
          className="absolute inset-0 flex overflow-hidden"
          style={{ width: `${(rounded / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              style={{ width: size, height: size }}
              className="shrink-0 fill-rating text-rating"
              strokeWidth={1.5}
            />
          ))}
        </span>
      </span>
      {showValue && <span className="text-xs font-medium text-foreground">{value.toFixed(1)}</span>}
      {count != null && <span className="text-xs text-muted-foreground">({count})</span>}
    </span>
  );
}
