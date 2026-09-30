/*
 * lib/security/csp.ts
 *
 * The Content Security Policy (ROADMAP 13.4) — which scripts, images,
 * connections and forms a page may use. Built per request by proxy.ts with a
 * fresh nonce: only scripts carrying that nonce run (Next.js stamps its own
 * automatically; our <Script>s pass it), and with 'strict-dynamic' those may
 * load what they need. An injected <script> has no nonce and doesn't run.
 *
 * The storefront also allows the two measurement tags a merchant can switch
 * on in Settings → Storefront (Google Analytics and the Meta Pixel, Phase 6).
 * A merchant only ever pastes an id there — never a script — so these are
 * the only third-party origins a shop can bring in, and the tags still load
 * only when an id is set (components/storefront/layout/storefront-analytics).
 *
 * CSP_MODE: "enforce" (default) blocks and reports; "report" only reports —
 * the switch to flip if a live page breaks; "off" sends no policy.
 * Violations are reported to /api/csp-report, into the error log.
 */

export type CspMode = 'enforce' | 'report' | 'off';

export function cspMode(): CspMode {
  const mode = process.env.CSP_MODE;
  return mode === 'report' || mode === 'off' ? mode : 'enforce';
}

/** 128 random bits, base64 — unguessable, and new for every request. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const CLOUDINARY_IMAGES = 'https://res.cloudinary.com';
const CLOUDINARY_UPLOADS = 'https://api.cloudinary.com';

/* What the merchant-enabled measurement tags need (storefront only). */
const ANALYTICS = {
  img: ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://www.facebook.com'],
  connect: [
    'https://www.googletagmanager.com',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.facebook.com',
    'https://connect.facebook.net',
  ],
  // Ignored by browsers that honour 'strict-dynamic'; a fallback for those that don't.
  script: ['https://www.googletagmanager.com', 'https://connect.facebook.net'],
};

/*
 * Where a form may send the browser. Chrome also checks the redirects that
 * follow a form post, so the sign-in providers belong here: "Continue with
 * Google" posts to our /api/auth, which redirects to Google.
 */
const FORM_TARGETS = ['https://accounts.google.com', 'https://www.facebook.com', 'https://checkout.paystack.com'];

export function buildCsp(options: { nonce: string; storefront: boolean; dev: boolean; https: boolean }): string {
  const { nonce, storefront, dev, https } = options;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React's development build uses eval for its debugging stacks; production never does.
      ...(dev ? ["'unsafe-eval'"] : []),
      ...(storefront ? ANALYTICS.script : []),
    ],
    // Components set style="" attributes all over (Radix positions popovers that way);
    // inline styles can't run code, so they stay allowed.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', CLOUDINARY_IMAGES, ...(storefront ? ANALYTICS.img : [])],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", CLOUDINARY_UPLOADS, ...(storefront ? ANALYTICS.connect : []), ...(dev ? ['ws:', 'wss:'] : [])],
    'media-src': ["'self'", 'blob:', CLOUDINARY_IMAGES],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", ...FORM_TARGETS],
    'frame-ancestors': ["'none'"],
    'report-uri': ['/api/csp-report'],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  // Upgrading on a plain-http origin (local production testing) would break every asset.
  if (https) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}
