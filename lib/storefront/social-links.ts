/*
 * lib/storefront/social-links.ts
 *
 * The shop's own social profiles, shown in the storefront footer (ROADMAP
 * 15.0). Pure and client-safe: the admin form, the save action and the
 * storefront all use these rules, so what a merchant is told is valid is
 * exactly what the footer will show.
 *
 * Every link is optional and only a link the merchant gave is shown. A link
 * must point at THAT platform — an "Instagram" link that opens somewhere else
 * is how a shop's footer gets used to send shoppers to a stranger's page.
 *
 * Merchants paste what they have: a full address, one without https://, or
 * (where the platform uses them) an @handle. WhatsApp is a phone number,
 * because that is what people know theirs as; it becomes a wa.me link.
 */

export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'x',
  'youtube',
  'whatsapp',
  'linkedin',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** platform → normalised https URL, only for links that are set */
export type SocialLinks = Partial<Record<SocialPlatform, string>>;

interface PlatformInfo {
  label: string;
  /** shown in the empty input */
  placeholder: string;
  /** hosts a link may be on, without `www.` */
  hosts: string[];
  /** an @handle becomes a link under this address */
  handleBase?: string;
}

export const SOCIAL_PLATFORM_INFO: Record<SocialPlatform, PlatformInfo> = {
  instagram: {
    label: 'Instagram',
    placeholder: '@yourshop',
    hosts: ['instagram.com'],
    handleBase: 'https://www.instagram.com/',
  },
  facebook: {
    label: 'Facebook',
    placeholder: 'facebook.com/yourshop',
    hosts: ['facebook.com', 'm.facebook.com', 'fb.com'],
  },
  tiktok: {
    label: 'TikTok',
    placeholder: '@yourshop',
    hosts: ['tiktok.com'],
    handleBase: 'https://www.tiktok.com/@',
  },
  x: {
    label: 'X (Twitter)',
    placeholder: '@yourshop',
    hosts: ['x.com', 'twitter.com'],
    handleBase: 'https://x.com/',
  },
  youtube: {
    label: 'YouTube',
    placeholder: 'youtube.com/@yourshop',
    hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'],
  },
  whatsapp: {
    label: 'WhatsApp',
    placeholder: '0801 234 5678',
    hosts: ['wa.me'],
  },
  linkedin: {
    label: 'LinkedIn',
    placeholder: 'linkedin.com/company/yourshop',
    hosts: ['linkedin.com'],
  },
};

export type SocialLinkResult = { ok: true; url: string | null } | { ok: false; error: string };

const HANDLE = /^@?([A-Za-z0-9._]{1,30})$/;

/**
 * What the merchant typed → the link to store, or null when they left it
 * blank. A phone number for WhatsApp; a link (or @handle) for the rest.
 */
export function normalizeSocialLink(platform: SocialPlatform, input: string): SocialLinkResult {
  const value = input.trim();
  if (!value) return { ok: true, url: null };
  const info = SOCIAL_PLATFORM_INFO[platform];

  if (platform === 'whatsapp') return whatsappLink(value);

  if (value.length > 300) return { ok: false, error: 'That link is too long' };

  // "@yourshop", or just "yourshop" — a bare name with no dot can't be a web
  // address, so on a platform with handles it is one.
  if (info.handleBase && (value.startsWith('@') || /^[A-Za-z0-9_]+$/.test(value))) {
    const match = HANDLE.exec(value);
    if (!match) return { ok: false, error: `That doesn’t look like a ${info.label} name` };
    return { ok: true, url: `${info.handleBase}${match[1]}` };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: `Paste the address of your ${info.label} page` };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!info.hosts.includes(host)) {
    return { ok: false, error: `That isn’t a link to ${info.label}` };
  }
  if (url.pathname === '/' || url.pathname === '') {
    return { ok: false, error: `Add the address of your own ${info.label} page, not just ${info.hosts[0]}` };
  }
  url.protocol = 'https:';
  url.username = '';
  url.password = '';
  url.hash = '';
  return { ok: true, url: url.toString() };
}

/*
 * A WhatsApp number in international form, digits only. A Nigerian number
 * written the local way (0801…) gains 234; one written with + or a country
 * code is kept as given. A wa.me link is accepted for whoever already has one.
 */
function whatsappLink(value: string): SocialLinkResult {
  const fromLink = /^(?:https?:\/\/)?(?:www\.)?wa\.me\/(\d+)\/?$/i.exec(value);
  let digits = fromLink ? fromLink[1] : value.replace(/[\s().-]/g, '');
  if (!fromLink) {
    if (!/^\+?\d+$/.test(digits)) return { ok: false, error: 'Enter your WhatsApp number, e.g. 0801 234 5678' };
    digits = digits.replace(/^\+/, '');
    if (/^0\d{10}$/.test(digits)) digits = `234${digits.slice(1)}`;
  }
  if (!/^[1-9]\d{9,14}$/.test(digits)) {
    return { ok: false, error: 'Enter your WhatsApp number, e.g. 0801 234 5678' };
  }
  return { ok: true, url: `https://wa.me/${digits}` };
}

/**
 * Turn what the merchant typed for every platform into links to store, or
 * the first problem per platform.
 */
export function normalizeSocialLinks(
  input: Partial<Record<SocialPlatform, string>>,
): { ok: true; links: SocialLinks } | { ok: false; errors: Partial<Record<SocialPlatform, string>> } {
  const links: SocialLinks = {};
  const errors: Partial<Record<SocialPlatform, string>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const result = normalizeSocialLink(platform, input[platform] ?? '');
    if (!result.ok) errors[platform] = result.error;
    else if (result.url) links[platform] = result.url;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, links };
}

/**
 * What is stored → what may be shown, in a fixed order. Checked on the way
 * out as well as in: a value reaches an `href`, and the check is cheap.
 */
export function readSocialLinks(stored: unknown): { platform: SocialPlatform; label: string; url: string }[] {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  const record = stored as Record<string, unknown>;
  const out: { platform: SocialPlatform; label: string; url: string }[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const value = record[platform];
    if (typeof value !== 'string') continue;
    const result = normalizeSocialLink(platform, value);
    if (result.ok && result.url) out.push({ platform, label: SOCIAL_PLATFORM_INFO[platform].label, url: result.url });
  }
  return out;
}

/** The stored value as the form shows it: the link itself, or blank. */
export function socialLinksForForm(stored: unknown): Record<SocialPlatform, string> {
  const shown = new Map(readSocialLinks(stored).map((link) => [link.platform, link.url]));
  return Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, shown.get(p) ?? ''])) as Record<SocialPlatform, string>;
}
