'use client';

/*
 * The uploaded image, for as long as the tab is open.
 *
 * The search is stored server-side and addressed by a query id in the URL
 * (/search/image?vq=…). The shopper should still see their own photo next to
 * the results, and the photo itself is never stored on the server — so the
 * copy they chose lives here: in memory, in this tab, keyed by the query id
 * whose results it produced.
 *
 * NEVER persisted. Not localStorage, not a cookie, not the URL. A refresh
 * loses the thumbnail and keeps the results, which is the right way round —
 * and closing the tab leaves nothing behind.
 *
 * This store OWNS the object URL. Every path that replaces or clears the
 * preview revokes the previous one, because an un-revoked object URL pins
 * the whole decoded image in memory until the document goes away, and
 * "search again" is a thing shoppers do ten times in a row.
 */
import { create } from 'zustand';

export interface VisualPreview {
  /** the query id these results belong to ('' until the search has run) */
  token: string;
  /** object URL — valid only in this tab, and only until it is replaced */
  url: string;
  fileName: string;
  width: number;
  height: number;
}

interface VisualSearchState {
  preview: VisualPreview | null;
  /** replaces the current preview, revoking the one it displaces */
  setPreview: (preview: VisualPreview) => void;
  clear: () => void;
}

function revoke(preview: VisualPreview | null) {
  if (preview) URL.revokeObjectURL(preview.url);
}

export const useVisualSearchStore = create<VisualSearchState>((set, get) => ({
  preview: null,
  setPreview: (preview) => {
    const current = get().preview;
    if (current?.url !== preview.url) revoke(current);
    set({ preview });
  },
  clear: () => {
    revoke(get().preview);
    set({ preview: null });
  },
}));

/** The preview for a given token, or null — so a results page rendered from
 *  a shared link (where there is no local image) simply shows no thumbnail
 *  rather than someone else's. */
export function useVisualPreview(token: string | undefined): VisualPreview | null {
  return useVisualSearchStore((s) =>
    token && s.preview?.token === token ? s.preview : null,
  );
}
