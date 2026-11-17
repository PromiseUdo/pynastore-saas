/*
 * lib/chat/photo-upload-client.ts — sending a photo in Messages, browser side.
 *
 * Checks the file is a picture of a sensible size, shrinks it (longest side
 * CHAT_PHOTO_MAX_SIDE, JPEG) so a phone photo doesn't take ages on mobile
 * data, then uploads it straight to Cloudinary with fields the server signed.
 * Cloudinary shrinks and converts again on arrival, so a picture the browser
 * can't draw (HEIC outside Safari) is simply sent as it is.
 */
import { CHAT_PHOTO_MAX_BYTES, CHAT_PHOTO_MAX_SIDE, CHAT_PHOTO_TYPES, type ChatPhotoUpload } from './rules';

export interface SignedPhotoUpload {
  uploadUrl: string;
  fields: Record<string, string>;
}

export class PhotoError extends Error {}

/** null when the file can be sent; otherwise why not, in plain words. */
export function photoProblem(file: File): string | null {
  const type = file.type.toLowerCase();
  const heicByName = !type && /\.(heic|heif)$/i.test(file.name);
  if (!heicByName && !(CHAT_PHOTO_TYPES as readonly string[]).includes(type)) return 'Choose a photo (JPEG, PNG, WebP or an iPhone photo).';
  if (file.size > CHAT_PHOTO_MAX_BYTES) return 'That photo is too big. Choose one under 10 MB.';
  return null;
}

/** The photo at most CHAT_PHOTO_MAX_SIDE on its longest side, as JPEG — or the original if it can't be drawn. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, CHAT_PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#ffffff'; // a transparent PNG becomes white, not black, as JPEG
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Shrink and upload one photo with the server's signed fields. */
export async function uploadChatPhoto(file: File, signed: SignedPhotoUpload): Promise<ChatPhotoUpload> {
  const problem = photoProblem(file);
  if (problem) throw new PhotoError(problem);
  const blob = await shrinkPhoto(file);
  const form = new FormData();
  for (const [key, value] of Object.entries(signed.fields)) form.append(key, value);
  form.append('file', blob, file.name.replace(/\.[^.]+$/, '') + '.jpg');
  let response: Response;
  try {
    response = await fetch(signed.uploadUrl, { method: 'POST', body: form });
  } catch {
    throw new PhotoError('The photo didn’t upload. Check your connection and try again.');
  }
  if (!response.ok) throw new PhotoError('The photo didn’t upload. Please try a different photo.');
  const body = (await response.json()) as { secure_url?: string; public_id?: string; width?: number; height?: number };
  if (!body.secure_url || !body.public_id) throw new PhotoError('The photo didn’t upload. Please try again.');
  return { url: body.secure_url, publicId: body.public_id, width: body.width, height: body.height };
}
