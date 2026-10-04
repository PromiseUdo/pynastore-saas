'use client';

/*
 * The side-by-side preview (ROADMAP 15.3): the REAL storefront — same
 * components, same data, the saved draft — in a frame, at desktop, tablet or
 * phone width. Not a screenshot and not a second copy of the storefront.
 *
 * It loads a fresh signed preview link each time (on open, after every save,
 * on "Refresh"), on the shop's platform address — the one place the frame
 * rules let this admin show it (lib/security/csp.ts, proxy.ts). The device
 * widths are real widths, scaled down to fit, so the storefront's own
 * responsive layout is what you see.
 */
import * as React from 'react';
import { Laptop, Loader2, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createDesignPreviewLink } from '@/features/storefront/design';

const DEVICES = [
  { key: 'desktop', label: 'Desktop', width: 1280, icon: Laptop },
  { key: 'tablet', label: 'Tablet', width: 820, icon: Tablet },
  { key: 'phone', label: 'Phone', width: 390, icon: Smartphone },
] as const;
type DeviceKey = (typeof DEVICES)[number]['key'];

export function PreviewPane({ reloadKey, dirty }: { reloadKey: string; dirty: boolean }) {
  const [device, setDevice] = React.useState<DeviceKey>('desktop');
  const [src, setSrc] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [boxWidth, setBoxWidth] = React.useState(0);
  const box = React.useRef<HTMLDivElement>(null);
  const [nonce, setNonce] = React.useState(0);

  /* A new signed link whenever what's saved changes, or on Refresh. */
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    createDesignPreviewLink({ frame: true }).then((result) => {
      if (cancelled) return;
      if (result.success) setSrc(result.data.url);
      else {
        setError(result.error);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  React.useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const width = DEVICES.find((d) => d.key === device)!.width;
  const scale = boxWidth ? Math.min(1, boxWidth / width) : 1;
  const height = 720;

  return (
    <section className="flex flex-col rounded-lg border bg-card" aria-label="Preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Preview</p>
          <p className="text-xs text-muted-foreground">
            {dirty ? 'Save your draft to see your latest changes here.' : 'Your saved draft, as shoppers would see it.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Screen size">
            {DEVICES.map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-pressed={device === key}
                title={label}
                onClick={() => setDevice(key)}
                className={cn('size-8', device === key && 'bg-muted text-foreground')}
              >
                <Icon className="size-4" />
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Refresh the preview"
            title="Refresh"
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      <div ref={box} className="relative overflow-hidden bg-muted/40" style={{ height: height * scale }}>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">We couldn’t load the preview. {error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading the preview" />
              </div>
            )}
            {src && (
              <iframe
                key={src}
                src={src}
                title="Preview of your shop"
                onLoad={() => setLoading(false)}
                className="absolute left-1/2 top-0 origin-top border-0 bg-background"
                style={{ width, height, transform: `translateX(-50%) scale(${scale})` }}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
