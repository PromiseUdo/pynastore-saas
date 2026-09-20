/*
 * Server-side checks on an image before it costs anything.
 *
 * The browser already validated and shrank the photo (./image.ts), but that
 * is a courtesy, not a control: anything can POST to a server action. So the
 * type is decided here from the file's own first bytes — not from its name
 * or the Content-Type a client claims — and only the two formats the
 * embedding model accepts get through.
 *
 * Pure: no I/O, so it is tested directly.
 */
import type { EmbeddableImage } from './embedding';

/**
 * What an upload may weigh on arrival. The client sends a ≤1024px JPEG
 * (typically 100–400 KB); this leaves headroom under the server-action body
 * limit (1 MB, next.config default) for the rest of the form.
 */
export const MAX_UPLOAD_BYTES = 900 * 1024;

/** Smallest plausible image — anything less is a truncated or empty file. */
const MIN_UPLOAD_BYTES = 100;

export type ImageInputProblem = 'missing' | 'too-large' | 'unsupported-type';

export const IMAGE_INPUT_MESSAGES: Record<ImageInputProblem, string> = {
  missing: 'We didn’t receive an image. Please choose one and try again.',
  'too-large': 'That image is too large. Try a smaller photo.',
  'unsupported-type': 'Please use a JPG or PNG photo.',
};

export function sniffImageType(bytes: Uint8Array): EmbeddableImage['mimeType'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export type CheckedImage = { ok: true; image: EmbeddableImage } | { ok: false; problem: ImageInputProblem };

/** Accepts the `File` a server action receives (or anything with arrayBuffer/size). */
export async function checkUploadedImage(file: unknown): Promise<CheckedImage> {
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('size' in file)) {
    return { ok: false, problem: 'missing' };
  }
  const blob = file as Blob;
  if (blob.size < MIN_UPLOAD_BYTES) return { ok: false, problem: 'missing' };
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, problem: 'too-large' };

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return { ok: false, problem: 'unsupported-type' };
  return { ok: true, image: { bytes, mimeType } };
}
