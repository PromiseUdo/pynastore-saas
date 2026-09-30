'use client';

/*
 * components/media/document-uploader.tsx
 *
 * Uploads private documents — a CAC certificate, an ID, a utility bill —
 * straight from the browser to Cloudinary, with parameters signed on the
 * server. The sibling of image-uploader.tsx, which is for public pictures:
 * these files have no public URL, show no thumbnail, and are opened only
 * through a short-lived link the server makes (`onView`).
 */
import * as React from 'react';
import { ExternalLink, FileText, Loader2, RotateCcw, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { SignedUpload } from '@/lib/cloudinary/sign';

export type UploadedDocument = {
  publicId: string;
  format: string;
  bytes: number;
  fileName: string;
};

type Result<T> = { success: true; data: T } | { success: false; error: string };

type Pending = { key: string; name: string; progress: number; error: string | null; file: File };

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function upload(url: string, form: FormData, fileName: string, onProgress: (pct: number) => void) {
  return new Promise<UploadedDocument>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ publicId: body.public_id, format: body.format ?? 'pdf', bytes: body.bytes ?? 0, fileName });
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

type DocumentUploaderProps = {
  id: string;
  value: UploadedDocument[];
  onChange: (documents: UploadedDocument[]) => void;
  getSignature: () => Promise<Result<SignedUpload>>;
  onView: (document: UploadedDocument) => Promise<Result<{ url: string }>>;
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onBusyChange?: (busy: boolean) => void;
};

export function DocumentUploader({
  id,
  value,
  onChange,
  getSignature,
  onView,
  max = 3,
  disabled,
  invalid,
  describedBy,
  onBusyChange,
}: DocumentUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);

  const valueRef = React.useRef(value);
  valueRef.current = value;

  const busy = pending.some((p) => !p.error);
  React.useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  async function send(entries: Pending[]) {
    const signed = await getSignature();
    if (!signed.success) {
      setPending((prev) => prev.map((p) => (entries.some((e) => e.key === p.key) ? { ...p, error: signed.error } : p)));
      return;
    }
    for (const entry of entries) {
      const form = new FormData();
      Object.entries(signed.data.fields).forEach(([k, v]) => form.set(k, v));
      form.set('file', entry.file);
      try {
        const doc = await upload(signed.data.uploadUrl, form, entry.name, (progress) =>
          setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, progress } : p))),
        );
        setPending((prev) => prev.filter((p) => p.key !== entry.key));
        onChange([...valueRef.current, doc]);
      } catch (err) {
        setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, error: (err as Error).message } : p)));
      }
    }
  }

  function addFiles(files: FileList) {
    setNotice(null);
    const room = Math.max(0, max - value.length - pending.length);
    const problems: string[] = [];
    const accepted: Pending[] = [];
    for (const file of Array.from(files)) {
      if (!ACCEPT.includes(file.type)) problems.push(`${file.name}: use a PDF, JPG, PNG or WebP file.`);
      else if (file.size > MAX_BYTES) problems.push(`${file.name}: larger than 10 MB.`);
      else if (accepted.length < room) {
        accepted.push({ key: `${file.name}-${file.size}-${Math.random()}`, name: file.name, progress: 0, error: null, file });
      } else problems.push(`Only ${max} files allowed here — ${file.name} was skipped.`);
    }
    if (problems.length) setNotice(problems.join(' '));
    if (!accepted.length) return;
    setPending((prev) => [...prev, ...accepted]);
    void send(accepted);
  }

  async function view(doc: UploadedDocument) {
    setOpening(doc.publicId);
    // Open the tab now, while the click still counts as the user's, and point it
    // at the signed link once the server has made one.
    // (`noopener` would make window.open return null, so the opener link is
    // cut by hand instead.) Never navigate this tab: the form may be unsaved.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const result = await onView(doc);
    setOpening(null);
    if (result.success) {
      if (tab) tab.location.href = result.data.url;
      else setNotice('Your browser blocked the new tab. Allow pop-ups for this site to view documents.');
    } else {
      tab?.close();
      setNotice(result.error);
    }
  }

  const canAdd = !disabled && value.length + pending.length < max;

  return (
    <div className="space-y-2">
      {(value.length > 0 || pending.length > 0) && (
        <ul className={cn('divide-y rounded-md border', invalid && 'border-destructive')}>
          {value.map((doc) => (
            <li key={doc.publicId} className="flex items-center gap-3 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.format.toUpperCase()} · {formatBytes(doc.bytes)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void view(doc)}
                disabled={opening === doc.publicId}
                aria-label={`Open ${doc.fileName}`}
              >
                {opening === doc.publicId ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                View
              </Button>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${doc.fileName}`}
                  onClick={() => onChange(value.filter((d) => d.publicId !== doc.publicId))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </li>
          ))}
          {pending.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 px-3 py-2">
              {entry.error ? (
                <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{entry.name}</p>
                {entry.error ? (
                  <p className="text-xs text-destructive">{entry.error}</p>
                ) : (
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`Uploading ${entry.name}`}
                    aria-valuenow={entry.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${entry.progress}%` }} />
                  </div>
                )}
              </div>
              {entry.error && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPending((prev) => prev.map((p) => (p.key === entry.key ? { ...p, error: null, progress: 0 } : p)));
                      void send([entry]);
                    }}
                  >
                    <RotateCcw className="size-3.5" /> Retry
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPending((prev) => prev.filter((p) => p.key !== entry.key))}
                  >
                    Dismiss
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div>
          <Button
            id={id}
            type="button"
            variant="outline"
            size="sm"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {value.length ? 'Add another file' : 'Upload a file'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT.join(',')}
            multiple={max > 1}
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
