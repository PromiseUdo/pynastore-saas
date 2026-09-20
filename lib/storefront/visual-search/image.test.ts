/*
 * The upload's checks, both ends:
 *   • the browser's — what the picker opens, and how big it draws the photo;
 *   • the server's — the bytes themselves decide the type, whatever the
 *     file claims to be, and only formats the embedding model takes pass.
 */
import { describe, expect, it } from 'vitest';
import { fitWithin, UPLOAD_EDGE, validateImageFile } from './image';
import { checkUploadedImage, MAX_UPLOAD_BYTES, sniffImageType } from './image-input';
import { MAX_IMAGE_BYTES } from './types';

const file = (name: string, type: string, size = 1024) => ({ name, type, size });

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bytes = (head: number[], size = 2048) => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};
const blob = (data: Uint8Array, type = 'image/jpeg') => new Blob([data as BlobPart], { type });

describe('image validation', () => {
  it('accepts JPG, PNG and WEBP', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateImageFile(file('photo', type)).ok).toBe(true);
    }
  });

  it('accepts a type carrying a charset parameter', () => {
    expect(validateImageFile(file('p.jpg', 'image/jpeg; charset=binary')).ok).toBe(true);
  });

  it('rejects an unsupported type with a message naming the fix', () => {
    const result = validateImageFile(file('scan.heic', 'image/heic'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-type');
    expect(result.message).toMatch(/JPG, PNG or WEBP/);
  });

  it('rejects a PDF and a text file', () => {
    expect(validateImageFile(file('spec.pdf', 'application/pdf')).ok).toBe(false);
    expect(validateImageFile(file('notes.txt', 'text/plain')).ok).toBe(false);
  });

  it('rejects an oversized image', () => {
    const result = validateImageFile(file('huge.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('rejects an empty file and a missing one', () => {
    expect(validateImageFile(file('x.jpg', 'image/jpeg', 0))).toMatchObject({ reason: 'empty' });
    expect(validateImageFile(null)).toMatchObject({ reason: 'empty' });
    expect(validateImageFile(undefined)).toMatchObject({ reason: 'empty' });
  });

  it('reports size before type, so the useful problem is named first', () => {
    const result = validateImageFile(file('huge.heic', 'image/heic', MAX_IMAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });
});


describe('shrinking before upload', () => {
  it('fits the long edge within the upload size, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024, UPLOAD_EDGE)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(1000, 3000, UPLOAD_EDGE)).toEqual({ width: 341, height: 1024 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(640, 480, UPLOAD_EDGE)).toEqual({ width: 640, height: 480 });
  });
});

describe('server-side upload check', () => {
  it('reads the type from the bytes', () => {
    expect(sniffImageType(bytes(JPEG_HEAD))).toBe('image/jpeg');
    expect(sniffImageType(bytes(PNG_HEAD))).toBe('image/png');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('accepts a JPEG and a PNG', async () => {
    expect(await checkUploadedImage(blob(bytes(JPEG_HEAD)))).toMatchObject({ ok: true, image: { mimeType: 'image/jpeg' } });
    expect(await checkUploadedImage(blob(bytes(PNG_HEAD), 'image/png'))).toMatchObject({ ok: true, image: { mimeType: 'image/png' } });
  });

  it('believes the bytes, not the claimed type: a script called image/jpeg is refused', async () => {
    const lie = blob(new TextEncoder().encode('<script>alert(1)</script>'.repeat(10)), 'image/jpeg');
    expect(await checkUploadedImage(lie)).toEqual({ ok: false, problem: 'unsupported-type' });
  });

  it('refuses WEBP on the server — the browser converts it to JPEG first', async () => {
    const webp = new Uint8Array(2048);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(await checkUploadedImage(blob(webp, 'image/webp'))).toEqual({ ok: false, problem: 'unsupported-type' });
  });

  it('refuses a missing, empty or oversized upload', async () => {
    expect(await checkUploadedImage(null)).toEqual({ ok: false, problem: 'missing' });
    expect(await checkUploadedImage('not a file')).toEqual({ ok: false, problem: 'missing' });
    expect(await checkUploadedImage(blob(new Uint8Array(10)))).toEqual({ ok: false, problem: 'missing' });
    expect(await checkUploadedImage(blob(bytes(JPEG_HEAD, MAX_UPLOAD_BYTES + 1)))).toEqual({ ok: false, problem: 'too-large' });
  });
});
