/*
 * POST /api/storefront/chat/photo-upload — permission for a shopper's browser
 * to upload one photo for Messages straight to Cloudinary.
 *
 * Body: { org? }. Answers the signed fields for this shop's chat folder
 * (lib/cloudinary/sign.ts — JPEG out, longest side 1600, photos only). Nothing
 * is saved here: the photo only becomes part of the conversation when the
 * message naming it is sent, and the send route checks it then. Refused when
 * the shop isn't taking messages, and limited per connection, so it can't be
 * used as free image hosting. JSON only, like the send route.
 */
import { NextResponse } from 'next/server';
import { chatStoreFromRequest } from '@/lib/chat/storefront';
import { chatAvailability } from '@/lib/chat/service';
import { checkRateLimit } from '@/lib/rate-limit';
import { requestIdentity } from '@/lib/storefront/request-identity';
import { signChatPhotoUpload } from '@/lib/cloudinary/sign';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** A shopper sending photos of what they want: plenty for that, nowhere near hosting. */
const PHOTOS_PER_HOUR = 20;

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415, headers: NO_STORE });
  }
  let claimedOrg: string | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object' && typeof (parsed as { org?: unknown }).org === 'string') claimedOrg = (parsed as { org: string }).org;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }

  const found = await chatStoreFromRequest(request, claimedOrg);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  const { store, settings } = found;

  const availability = await chatAvailability(store.organizationId, settings);
  if (!availability.open) {
    return NextResponse.json({ error: 'This store isn’t taking messages right now.' }, { status: 409, headers: NO_STORE });
  }

  const { ip } = requestIdentity(request, store.slug);
  if (!(await checkRateLimit(`chat-photo:${store.slug}:${ip}`, PHOTOS_PER_HOUR, 60 * 60 * 1000))) {
    return NextResponse.json({ error: 'You’ve sent a lot of photos. Please wait a while before sending more.' }, { status: 429, headers: NO_STORE });
  }

  try {
    return NextResponse.json({ upload: signChatPhotoUpload(store.organizationId) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Photos can’t be sent right now.' }, { status: 503, headers: NO_STORE });
  }
}
