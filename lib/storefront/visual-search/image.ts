/*
 * The shopper's photo, in their browser, before it is uploaded.
 *
 *   validateImageFile()     — pure. What the picker will even open.
 *   prepareImageForUpload() — browser only (canvas). Re-encodes the photo as
 *                             a JPEG no larger than UPLOAD_EDGE px on its long
 *                             side, which is what the server accepts.
 *
 * Why shrink here: the embedding model needs a few hundred pixels to see what
 * a product is, not a 12-megapixel phone photo. Shrinking first keeps the
 * upload small on a mobile connection and under the server-action body
 * limit, and turns WEBP and PNG screenshots into the format every model
 * accepts. A canvas re-encode also drops the photo's EXIF metadata
 * (location, device) before anything leaves the phone.
 *
 * The server re-checks everything (./image-input.ts); this is for a fast,
 * friendly answer, not for security.
 */
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  type AcceptedImageType,
} from './types';

/* ────────────────────────────── validation ──────────────────────────── */

export type ImageRejection =
  | 'empty'
  | 'unsupported-type'
  | 'too-large'
  | 'unreadable';

/** Copy the shopper actually sees. Every case names the fix, not the fault. */
export const IMAGE_REJECTION_MESSAGES: Record<ImageRejection, string> = {
  empty: 'That file looks empty. Try choosing the photo again.',
  'unsupported-type': 'Please choose a JPG, PNG or WEBP image.',
  'too-large': `That image is over ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB. Try a smaller one.`,
  unreadable: 'We couldn’t read that image. Try a different one.',
};

export type ImageValidation =
  | { ok: true; type: AcceptedImageType }
  | { ok: false; reason: ImageRejection; message: string };

/** The parts of a `File` this check needs — so it is testable without one. */
export interface ImageFileLike {
  name: string;
  type: string;
  size: number;
}

export function validateImageFile(file: ImageFileLike | null | undefined): ImageValidation {
  const reject = (reason: ImageRejection): ImageValidation => ({
    ok: false,
    reason,
    message: IMAGE_REJECTION_MESSAGES[reason],
  });

  if (!file || file.size === 0) return reject('empty');
  // Checked before the type: a 40MB file is the more useful thing to say,
  // and decoding one to find out it is also a TIFF wastes the shopper's time.
  if (file.size > MAX_IMAGE_BYTES) return reject('too-large');

  const type = file.type.toLowerCase().split(';')[0].trim();
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return reject('unsupported-type');
  }
  return { ok: true, type: type as AcceptedImageType };
}


/* ───────────────────────────── preparation ──────────────────────────── */

/** Longest edge sent to the server. Plenty for an embedding; small on the wire. */
export const UPLOAD_EDGE = 1024;
/** Stay under the server's MAX_UPLOAD_BYTES (900 KB) with room to spare. */
const UPLOAD_TARGET_BYTES = 800 * 1024;
const QUALITIES = [0.85, 0.72, 0.6];

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface PrepareImageOptions {
  /** injected in tests; defaults to the browser's own decoder */
  decode?: (file: Blob) => Promise<ImageBitmap>;
}

export class ImagePrepareError extends Error {
  constructor(readonly reason: ImageRejection) {
    super(IMAGE_REJECTION_MESSAGES[reason]);
    this.name = 'ImagePrepareError';
  }
}

/** The size a `w`×`h` image is drawn at so its long edge is at most `edge`. */
export function fitWithin(w: number, h: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Decode, shrink and re-encode as JPEG. Rejects with an ImagePrepareError
 * whose message is shopper-facing, so every failure has one shape.
 */
export async function prepareImageForUpload(file: File, options: PrepareImageOptions = {}): Promise<PreparedImage> {
  const validation = validateImageFile(file);
  if (!validation.ok) throw new ImagePrepareError(validation.reason);

  const decode = options.decode ?? ((blob: Blob) => createImageBitmap(blob));
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new ImagePrepareError('unreadable');
  }

  try {
    if (!bitmap.width || !bitmap.height) throw new ImagePrepareError('unreadable');
    const { width, height } = fitWithin(bitmap.width, bitmap.height, UPLOAD_EDGE);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImagePrepareError('unreadable');
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= UPLOAD_TARGET_BYTES) return { blob, width, height };
    }
    throw new ImagePrepareError('too-large');
  } finally {
    // A bitmap holds a decoded full-size copy of the photo — free it now.
    bitmap.close?.();
  }
}

/* ───────────────────────────── URL params ───────────────────────────── */

/** `/search/image?vq=<query id>` — a stored shopper search. */
export const VISUAL_QUERY_PARAM = 'vq';
/** `/search/image?p=<product id>` — "find similar" from a product page. */
export const VISUAL_SOURCE_PRODUCT_PARAM = 'p';
