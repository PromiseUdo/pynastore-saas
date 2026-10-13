'use client';

/*
 * lib/business-app/share.ts
 *
 * Handing something to the phone's share sheet from the business app
 * (ROADMAP 19.4) — "Save to Files", WhatsApp, email, a printer. A WebView
 * ignores a download link, and merchants send receipts on WhatsApp anyway.
 */

const cancelled = (error: unknown) => /cancel/i.test(error instanceof Error ? error.message : String(error));

/** Write a file to the app's cache and offer it. Resolves false only when it failed (not when cancelled). */
export async function shareFile(filename: string, contents: string): Promise<boolean> {
  try {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const written = await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [written.uri] });
    return true;
  } catch (error) {
    return cancelled(error);
  }
}

/** Offer words — a receipt, say — and optionally a link, through the share sheet. */
export async function shareContent(input: { title: string; text?: string; url?: string }): Promise<boolean> {
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: input.title, text: input.text, url: input.url, dialogTitle: input.title });
    return true;
  } catch (error) {
    return cancelled(error);
  }
}
