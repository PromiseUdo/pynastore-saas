'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, RotateCcw, Star, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { getImageUploadSignature } from '@/features/media/actions';
import type { UploadPurpose } from '@/lib/cloudinary/sign';

export type UploadedImage = {
  url: string;
  publicId: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
};

type Pending = { key: string; name: string; progress: number; error: string | null; file: File };

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

type ImageUploaderProps = {
  purpose: UploadPurpose;
  value: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  /** 1 = single-image mode (replace on upload) */
  max?: number;
  disabled?: boolean;
  /** shown in the empty drop zone */
  hint?: string;
  /** called while any upload is in flight, so a form can block saving */
  onBusyChange?: (busy: boolean) => void;
};

function uploadWithProgress(url: string, form: FormData, onProgress: (pct: number) => void) {
  return new Promise<UploadedImage>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ url: body.secure_url, publicId: body.public_id, width: body.width, height: body.height, alt: '' });
        } else {
          reject(new Error(body?.error?.message?.includes('format') ? 'That file type isn’t supported.' : 'Upload failed. Try again.'));
        }
      } catch {
        reject(new Error('Upload failed. Try again.'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(form);
  });
}

export function ImageUploader({ purpose, value, onChange, max = 12, disabled, hint, onBusyChange }: ImageUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const single = max === 1;

  // Latest value for async completions, so parallel uploads don't overwrite each other.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  const busy = pending.some((p) => !p.error);
  React.useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  async function upload(entries: Pending[]) {
    const signed = await getImageUploadSignature(purpose);
    if (!signed.success) {
      setPending((prev) => prev.map((p) => (entries.some((e) => e.key === p.key) ? { ...p, error: signed.error } : p)));
      return;
    }
    // Upload in parallel, but add results in the order the files were chosen,
    // so the first file picked becomes the main image.
    const results = await Promise.all(
      entries.map(async (entry) => {
        const form = new FormData();
        Object.entries(signed.data.fields).forEach(([k, v]) => form.set(k, v));
        form.set('file', entry.file);
        try {
          return await uploadWithProgress(signed.data.uploadUrl, form, (progress) =>
            setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, progress } : p))),
          );
        } catch (err) {
          setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, error: (err as Error).message } : p)));
          return null;
        }
      }),
    );
    const uploaded = results.filter((r): r is UploadedImage => r !== null);
    const done = new Set(entries.filter((_, i) => results[i] !== null).map((e) => e.key));
    setPending((prev) => prev.filter((p) => !done.has(p.key)));
    if (uploaded.length) onChange(single ? [uploaded[uploaded.length - 1]] : [...valueRef.current, ...uploaded]);
  }

  function addFiles(files: FileList | File[]) {
    setNotice(null);
    const list = Array.from(files);
    const room = single ? 1 : Math.max(0, max - value.length - pending.length);
    const problems: string[] = [];
    const accepted: Pending[] = [];
    for (const file of list) {
      if (!ACCEPT.includes(file.type)) {
        problems.push(`${file.name}: use JPG, PNG, WebP, AVIF or GIF.`);
      } else if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: larger than 10 MB.`);
      } else if (accepted.length < room) {
        accepted.push({ key: `${file.name}-${file.size}-${Math.random()}`, name: file.name, progress: 0, error: null, file });
      } else {
        problems.push(`Only ${max} image${max === 1 ? '' : 's'} allowed — ${file.name} was skipped.`);
      }
    }
    if (problems.length) setNotice(problems.join(' '));
    if (!accepted.length) return;
    setPending((prev) => [...prev, ...accepted]);
    void upload(accepted);
  }

  function retry(entry: Pending) {
    setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, error: null, progress: 0 } : p)));
    void upload([entry]);
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  const canAddMore = single || value.length + pending.length < max;

  return (
    <div className="space-y-3">
      {(value.length > 0 || pending.length > 0) && (
        <ul className={cn('grid gap-3', single ? 'grid-cols-1 sm:max-w-xs' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
          {value.map((image, index) => (
            <li key={image.publicId} className="group overflow-hidden rounded-lg border bg-card">
              <div className="relative aspect-square bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing */}
                <img
                  src={cloudinaryImage(image.url, { width: 400, height: 400 })}
                  alt={image.alt || ''}
                  className="size-full object-cover"
                />
                {!single && index === 0 && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium text-foreground shadow-xs">
                    <Star className="size-3" /> Main image
                  </span>
                )}
                {!disabled && (
                  <div className="absolute inset-x-2 bottom-2 flex justify-between gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    {!single ? (
                      <div className="flex gap-1">
                        <Button type="button" size="icon-xs" variant="secondary" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, index - 1)}>
                          <ArrowLeft />
                        </Button>
                        <Button type="button" size="icon-xs" variant="secondary" aria-label="Move later" disabled={index === value.length - 1} onClick={() => move(index, index + 1)}>
                          <ArrowRight />
                        </Button>
                        {index !== 0 && (
                          <Button type="button" size="icon-xs" variant="secondary" aria-label="Make this the main image" title="Make main image" onClick={() => move(index, 0)}>
                            <Star />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span />
                    )}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="secondary"
                      aria-label="Remove image"
                      onClick={() => onChange(value.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
              {!single && (
                <Input
                  aria-label={`Describe image ${index + 1}`}
                  placeholder="Describe the image"
                  value={image.alt ?? ''}
                  disabled={disabled}
                  onChange={(e) => onChange(value.map((img, i) => (i === index ? { ...img, alt: e.target.value } : img)))}
                  className="h-8 rounded-none border-0 border-t text-xs focus-visible:ring-0"
                />
              )}
            </li>
          ))}

          {pending.map((entry) => (
            <li key={entry.key} className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center">
              {entry.error ? (
                <>
                  <TriangleAlert className="size-5 text-destructive" />
                  <p className="line-clamp-2 text-xs text-destructive">{entry.error}</p>
                  <div className="flex gap-1">
                    <Button type="button" size="xs" variant="outline" onClick={() => retry(entry)}>
                      <RotateCcw /> Retry
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => setPending((prev) => prev.filter((p) => p.key !== entry.key))}>
                      Dismiss
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  <p className="w-full truncate text-xs text-muted-foreground">{entry.name}</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={entry.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${entry.progress}%` }} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAddMore && !disabled && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'bg-muted/30',
          )}
        >
          <ImagePlus className="size-5 text-muted-foreground" />
          <p className="text-sm text-foreground">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => inputRef.current?.click()}>
              {single && value.length ? 'Replace image' : 'Choose images'}
            </button>{' '}
            or drag them here
          </p>
          <p className="text-xs text-muted-foreground">{hint ?? 'JPG, PNG, WebP or GIF, up to 10 MB each.'}</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT.join(',')}
            multiple={!single}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {notice && (
        <p role="alert" className="text-xs text-destructive">
          {notice}
        </p>
      )}
    </div>
  );
}
