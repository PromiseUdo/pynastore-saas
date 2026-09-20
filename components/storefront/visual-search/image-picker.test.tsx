// @vitest-environment jsdom
/*
 * The upload workflow's states: initial, image selected, reading, error,
 * change, remove, and searching.
 *
 * jsdom has no canvas and no `createImageBitmap`, so the one function that
 * needs them — `prepareImageForUpload` (shrink + re-encode) — is stubbed at
 * the module boundary, and so is the server action. The test asserts the
 * interaction: what is uploaded, where the shopper is sent, what they're told.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImagePicker } from './image-picker';
import { useVisualSearchStore } from '@/lib/storefront/stores/visual-search-store';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

/* Only the canvas work is stubbed; validation is the real thing, so the
 * rejection paths below exercise the code the browser would run. */
const prepareImageForUpload = vi.fn();
vi.mock('@/lib/storefront/visual-search/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storefront/visual-search/image')>();
  return { ...actual, prepareImageForUpload: (file: File) => prepareImageForUpload(file) };
});

const searchByImageAction = vi.fn();
vi.mock('@/features/shop-visual-search/actions', () => ({
  searchByImageAction: (form: FormData) => searchByImageAction(form),
}));

const PREPARED = { blob: new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }), width: 1024, height: 768 };
const QUERY_ID = 'vq_0123456789abcdef0123456789abcdef';

const jpg = (name = 'black-sneaker.jpg', type = 'image/jpeg', bytes = 4096) =>
  new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  prepareImageForUpload.mockResolvedValue(PREPARED);
  searchByImageAction.mockResolvedValue({ ok: true, queryId: QUERY_ID, href: `/search/image?vq=${QUERY_ID}` });
  // jsdom implements neither.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  push.mockReset();
  prepareImageForUpload.mockReset();
  searchByImageAction.mockReset();
  useVisualSearchStore.setState({ preview: null });
  vi.unstubAllGlobals();
});

const fileInput = () =>
  screen.getByLabelText('Choose an image to search with') as HTMLInputElement;

/*
 * `userEvent.upload` honours the input's `accept` and silently drops a file
 * that doesn't match — which would make the rejection tests below assert
 * nothing. A shopper CAN still hand over a .heic (the OS dialog's "All
 * files", or a drag and drop), so these fire the change directly, which is
 * what that looks like to the component.
 */
function choose(file: File) {
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('21. visual search — choosing an image', () => {
  it('starts with upload and camera actions, and no preview', () => {
    render(<ImagePicker />);
    expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /take a photo/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /search this image/i })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('labels both inputs and offers the camera one a capture hint', () => {
    render(<ImagePicker />);
    expect(fileInput().accept).toBe('image/jpeg,image/png,image/webp');
    const camera = screen.getByLabelText('Take a photo to search with');
    expect(camera.getAttribute('capture')).toBe('environment');
  });

  it('shows the image, its name and its dimensions once one is chosen', async () => {
    render(<ImagePicker />);
    const user = userEvent.setup();
    await user.upload(fileInput(), jpg());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /search this image/i })).toBeTruthy();
    });
    expect(screen.getByText('black-sneaker.jpg')).toBeTruthy();
    // The size that will actually be uploaded, after shrinking.
    expect(screen.getByText('1024 × 768 pixels')).toBeTruthy();

    const preview = screen.getByRole('img') as HTMLImageElement;
    expect(preview.src).toBe('blob:preview');
    // Meaningful alt text, not "image".
    expect(preview.alt).toContain('black-sneaker.jpg');
  });

  it('publishes the preview so the results page can show it', async () => {
    render(<ImagePicker />);
    await userEvent.setup().upload(fileInput(), jpg());

    await waitFor(() => {
      expect(useVisualSearchStore.getState().preview?.url).toBe('blob:preview');
    });
    expect(useVisualSearchStore.getState().preview?.fileName).toBe('black-sneaker.jpg');
  });

  it('uploads only the shrunk JPEG — no store, no other fields — and goes to the results', async () => {
    render(<ImagePicker />);
    const user = userEvent.setup();
    await user.upload(fileInput(), jpg());

    await waitFor(() => screen.getByRole('button', { name: /search this image/i }));
    await user.click(screen.getByRole('button', { name: /search this image/i }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const form = searchByImageAction.mock.calls[0][0] as FormData;
    expect([...form.keys()]).toEqual(['image']);
    expect((form.get('image') as File).size).toBe(PREPARED.blob.size);
    expect(push.mock.calls[0][0]).toBe(`/search/image?vq=${QUERY_ID}`);
    // The preview is keyed to these results, so the results page can show it.
    expect(useVisualSearchStore.getState().preview?.token).toBe(QUERY_ID);
  });

  it('shows the server’s message and stays put when the search can’t run', async () => {
    searchByImageAction.mockResolvedValue({
      ok: false,
      message: 'You’re searching a little fast. Give it a moment and try again.',
    });
    render(<ImagePicker />);
    const user = userEvent.setup();
    await user.upload(fileInput(), jpg());
    await waitFor(() => screen.getByRole('button', { name: /search this image/i }));
    await user.click(screen.getByRole('button', { name: /search this image/i }));

    expect(await screen.findByText(/searching a little fast/i)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    // Still there to try again.
    expect(screen.getByRole('button', { name: /search this image/i })).toBeTruthy();
  });

  it('removes the image and revokes its object URL', async () => {
    render(<ImagePicker />);
    const user = userEvent.setup();
    await user.upload(fileInput(), jpg());

    await waitFor(() => screen.getByRole('button', { name: /^remove$/i }));
    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy();
    expect(useVisualSearchStore.getState().preview).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('replaces the previous image, and its object URL, on change', async () => {
    render(<ImagePicker />);
    const user = userEvent.setup();
    await user.upload(fileInput(), jpg());
    await waitFor(() => screen.getByText('black-sneaker.jpg'));

    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValue('blob:second');
    await user.upload(fileInput(), jpg('brown-boot.jpg'));

    await waitFor(() => expect(screen.getByText('brown-boot.jpg')).toBeTruthy());
    expect(screen.queryByText('black-sneaker.jpg')).toBeNull();
    // The displaced URL is released rather than leaked.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});

describe('22. visual search — rejected images', () => {
  it('explains an unsupported format and stays on the initial state', async () => {
    render(<ImagePicker />);
    choose(jpg('scan.heic', 'image/heic'));

    expect(await screen.findByText(/Please choose a JPG, PNG or WEBP image/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /search this image/i })).toBeNull();
    expect(prepareImageForUpload).not.toHaveBeenCalled();
  });

  it('explains an oversized image', async () => {
    render(<ImagePicker />);
    const huge = new File([''], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(huge, 'size', { value: 13 * 1024 * 1024 });
    await userEvent.setup().upload(fileInput(), huge);

    expect(await screen.findByText(/over 12MB/i)).toBeTruthy();
  });

  it('explains a corrupted image that cannot be decoded', async () => {
    const { ImagePrepareError } = await import('@/lib/storefront/visual-search/image');
    prepareImageForUpload.mockRejectedValue(new ImagePrepareError('unreadable'));

    render(<ImagePicker />);
    await userEvent.setup().upload(fileInput(), jpg('broken.png', 'image/png'));

    expect(await screen.findByText(/couldn’t read that image/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /search this image/i })).toBeNull();
  });

  it('announces errors politely rather than only showing them', async () => {
    render(<ImagePicker />);
    choose(jpg('scan.heic', 'image/heic'));

    const message = await screen.findByText(/Please choose a JPG, PNG or WEBP image/i);
    expect(message.getAttribute('role')).toBe('status');
    expect(message.getAttribute('aria-live')).toBe('polite');
  });

  it('clears a previous error once a valid image is chosen', async () => {
    render(<ImagePicker />);
    choose(jpg('scan.heic', 'image/heic'));
    await screen.findByText(/Please choose a JPG, PNG or WEBP image/i);

    choose(jpg());
    await waitFor(() => screen.getByRole('button', { name: /search this image/i }));
    expect(screen.queryByText(/Please choose a JPG, PNG or WEBP image/i)).toBeNull();
  });
});
