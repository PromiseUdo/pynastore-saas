'use client';

/*
 * Choose a photo, look at it, search with it.
 *
 * The only client island the visual-search route needs. Everything after the
 * search — the grid, the filters, the chips, the pager — is server-rendered
 * by the same Product Discovery Service the rest of the storefront uses.
 *
 * The photo is shrunk and re-encoded to a small JPEG right here (which also
 * drops its EXIF metadata), then sent to searchByImageAction, which compares
 * it with the store's product photos and answers with a results link. The
 * server keeps the photo's embedding for a day and never the photo itself.
 * The <img> preview is an object URL owned by
 * lib/storefront/stores/visual-search-store.ts, which revokes the previous
 * one every time a new image is chosen.
 *
 * Two inputs, not one: a plain picker, and — on devices that have a camera —
 * `capture="environment"`, which is the browser's own way to open the rear
 * camera (§12). No camera library, no custom viewfinder.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ImageUp, Loader2, RefreshCw, Search, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVisualSearchStore } from '@/lib/storefront/stores/visual-search-store';
/* Imported from the leaf modules, never through a barrel: ./service and
 * ./catalogue read the catalogue, and a barrel would drag them — and the
 * mock provider the UI must not import (§27) — into the client bundle. */
import {
  ImagePrepareError,
  IMAGE_REJECTION_MESSAGES,
  prepareImageForUpload,
  validateImageFile,
} from '@/lib/storefront/visual-search/image';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/storefront/visual-search/types';
import { searchByImageAction } from '@/features/shop-visual-search/actions';

const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',');

interface Chosen {
  /** the shrunk JPEG that will be uploaded */
  upload: Blob;
  url: string;
  fileName: string;
  width: number;
  height: number;
}

export function ImagePicker({
  /** compact form for the results page's "search another image" */
  variant = 'full',
  autoFocus = false,
}: {
  variant?: 'full' | 'compact';
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const setPreview = useVisualSearchStore((s) => s.setPreview);
  const clearPreview = useVisualSearchStore((s) => s.clear);

  const [chosen, setChosen] = React.useState<Chosen | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'reading' | 'searching' | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const fileInput = React.useRef<HTMLInputElement>(null);
  const cameraInput = React.useRef<HTMLInputElement>(null);
  const searchButton = React.useRef<HTMLButtonElement>(null);

  /*
   * The object URL belongs to the store, which revokes it when it is
   * replaced. Clearing on unmount as well would revoke the URL the results
   * page is about to display — the navigation IS an unmount — so this
   * component only ever clears it in response to "remove".
   */
  const accept = React.useCallback(
    async (file: File | undefined | null) => {
      setError(null);

      const validation = validateImageFile(file);
      if (!file || !validation.ok) {
        setError(validation.ok ? IMAGE_REJECTION_MESSAGES.empty : validation.message);
        return;
      }

      setBusy('reading');
      try {
        const prepared = await prepareImageForUpload(file);
        const chosenImage: Chosen = {
          upload: prepared.blob,
          // The preview is the shrunk copy too: it is what will be searched.
          url: URL.createObjectURL(prepared.blob),
          fileName: file.name,
          width: prepared.width,
          height: prepared.height,
        };
        // Not keyed to a search yet — the query id arrives with the results.
        setPreview({ ...chosenImage, token: '' });
        setChosen(chosenImage);
        // Move focus to the action the shopper is now expected to take.
        requestAnimationFrame(() => searchButton.current?.focus());
      } catch (cause) {
        setError(
          cause instanceof ImagePrepareError
            ? cause.message
            : IMAGE_REJECTION_MESSAGES.unreadable,
        );
      } finally {
        setBusy(null);
      }
    },
    [setPreview],
  );

  const remove = () => {
    clearPreview();
    setChosen(null);
    setError(null);
    // Without this the same file picked twice in a row fires no change event.
    if (fileInput.current) fileInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
  };

  const search = async () => {
    if (!chosen || busy) return;
    setBusy('searching');
    setError(null);

    const form = new FormData();
    form.append('image', chosen.upload, 'search.jpg');
    let result: Awaited<ReturnType<typeof searchByImageAction>>;
    try {
      result = await searchByImageAction(form);
    } catch {
      result = { ok: false, message: 'We couldn’t reach the store. Check your connection and try again.' };
    }

    if (!result.ok) {
      setError(result.message);
      setBusy(null);
      return;
    }
    // Key the in-tab preview to these results, so the results page shows it.
    setPreview({ ...chosen, token: result.queryId });
    router.push(result.href);
  };

  const compact = variant === 'compact';

  return (
    <div
      className={cn(
        'rounded-3xl border border-border bg-card text-left',
        compact ? 'p-4 sm:p-5' : 'p-5 sm:p-7',
      )}
    >
      <div className={cn('grid gap-5', !compact && 'sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-start')}>
        {/* ── the drop zone / preview ─────────────────────────────────── */}
        <div>
          <label
            htmlFor="vs-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void accept(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed bg-tile text-center transition-colors',
              compact ? 'aspect-[4/3]' : 'aspect-square',
              dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-brand',
            )}
          >
            {chosen ? (
              /* eslint-disable-next-line @next/next/no-img-element -- an
                 object URL is a blob in this tab; next/image would only add
                 an optimiser round trip it cannot perform. */
              <img
                src={chosen.url}
                alt={`The image you chose${chosen.fileName ? `: ${chosen.fileName}` : ''}`}
                className="size-full object-cover"
              />
            ) : busy === 'reading' ? (
              <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Upload aria-hidden className="size-6 text-muted-foreground" />
                <span className="px-4 text-xs font-medium text-muted-foreground">
                  Drop an image here, or tap to choose one
                </span>
              </>
            )}
          </label>

          {/* Named with aria-label rather than a second <label>: the drop
            * zone above is already this input's label, and two of them
            * concatenate into one confusing accessible name. */}
          <input
            ref={fileInput}
            id="vs-file"
            type="file"
            accept={ACCEPT_ATTR}
            aria-label="Choose an image to search with"
            className="sr-only"
            autoFocus={autoFocus}
            onChange={(e) => void accept(e.target.files?.[0])}
          />
          {/* The rear camera, via the browser — no library, no viewfinder. */}
          <input
            ref={cameraInput}
            id="vs-camera"
            type="file"
            accept={ACCEPT_ATTR}
            capture="environment"
            aria-label="Take a photo to search with"
            className="sr-only"
            onChange={(e) => void accept(e.target.files?.[0])}
          />
        </div>

        {/* ── the actions ─────────────────────────────────────────────── */}
        <div className={cn(!compact && 'sm:pt-1')}>
          {!compact && (
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal"
              >
                <ImageUp className="size-4.5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Search with an image</h2>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG or WEBP · up to 12MB
                </p>
              </div>
            </div>
          )}

          {chosen ? (
            <div className={cn(!compact && 'mt-5')}>
              <p className="truncate text-sm font-medium" title={chosen.fileName}>
                {chosen.fileName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {chosen.width} × {chosen.height} pixels
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  ref={searchButton}
                  type="button"
                  onClick={() => void search()}
                  disabled={busy === 'searching'}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70"
                >
                  {busy === 'searching' ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Search aria-hidden className="size-4" />
                  )}
                  Search this image
                </button>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand"
                >
                  <RefreshCw aria-hidden className="size-4" />
                  Change image
                </button>
                <button
                  type="button"
                  onClick={remove}
                  className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X aria-hidden className="size-4" />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className={cn('flex flex-wrap gap-2', !compact && 'mt-5')}>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy === 'reading'}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover disabled:opacity-70"
              >
                <Upload aria-hidden className="size-4" />
                Upload image
              </button>
              {/* Offered on every device: a desktop browser without a camera
                * simply opens the file picker, which is a harmless outcome. */}
              <button
                type="button"
                onClick={() => cameraInput.current?.click()}
                disabled={busy === 'reading'}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold transition-colors hover:border-brand disabled:opacity-70"
              >
                <Camera aria-hidden className="size-4" />
                Take a photo
              </button>
            </div>
          )}

          {/* Announced, not just shown: the shopper may have been reading the
            * file dialog, not this panel, when it failed. */}
          <p
            role="status"
            aria-live="polite"
            className={cn('mt-3 text-sm', error ? 'text-destructive' : 'sr-only')}
          >
            {error ??
              (busy === 'reading'
                ? 'Reading your image…'
                : busy === 'searching'
                  ? 'Searching the store…'
                  : chosen
                    ? 'Image ready. Choose “Search this image”.'
                    : '')}
          </p>

          {!compact && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              We send a small copy of your photo to compare it with this
              store’s product photos. The photo isn’t stored — only a
              numeric summary of it, deleted after a day.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
