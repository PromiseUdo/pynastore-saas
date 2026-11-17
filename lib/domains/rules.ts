/*
 * lib/domains/rules.ts
 *
 * The rules for a shop's own domain (ROADMAP 12.6). Pure and client-safe.
 *
 *   - Buying: `.com`, and `.com.ng` (ROADMAP 22.3) when its naira prices are
 *     set. A bare name takes the ending the merchant picked; any other ending
 *     is explained, not silently refused. `.com` is registered at Namecheap,
 *     `.com.ng` by hand at QServers (decided 2026-11-17).
 *   - Connecting: any domain the merchant owns, given as the domain itself
 *     (yourshop.com, yourshop.com.ng), not a sub-address.
 *   - The shop answers on the domain and its www; www is canonical (decided
 *     2026-09-30) and the bare domain redirects to it.
 *   - A registered domain's renewal deadline is 7 days before the registrar's
 *     expiry (decided), so staff always have a week to renew after the
 *     merchant pays. Reminders follow common registrar practice.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Two-part endings a domain can sit directly under (yourshop.com.ng). */
const TWO_PART_SUFFIXES = new Set(['com.ng', 'org.ng', 'net.ng', 'edu.ng', 'gov.ng', 'co.uk', 'org.uk', 'co.za', 'com.gh', 'co.ke']);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercased, without protocol, path, port or a leading www. */
export function cleanHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

export type DomainParse = { ok: true; domain: string } | { ok: false; error: string };

/** A name to buy: `.com` only. */
export function comDomain(input: string): DomainParse {
  const host = cleanHost(input);
  if (!host) return { ok: false, error: 'Type the name you’d like, e.g. adafabrics.' };
  const labels = host.split('.');
  if (labels.length === 1) labels.push('com');
  if (labels.length > 2 || labels[1] !== 'com') {
    return { ok: false, error: 'We offer .com addresses only for now. Try the same name ending in .com.' };
  }
  if (!LABEL.test(labels[0])) {
    return { ok: false, error: 'Use letters, numbers and hyphens only, not starting or ending with a hyphen.' };
  }
  return { ok: true, domain: labels.join('.') };
}

/** The endings we register, and where. */
export const BUY_ENDINGS = ['com', 'com.ng'] as const;
export type BuyEnding = (typeof BUY_ENDINGS)[number];

export function endingOf(domain: string): BuyEnding | null {
  if (domain.endsWith('.com.ng')) return 'com.ng';
  if (domain.endsWith('.com')) return 'com';
  return null;
}

/** Who registers it: Namecheap through its API for .com; .com.ng by hand at QServers. */
export function registrarFor(domain: string): 'Namecheap' | 'QServers' {
  return endingOf(domain) === 'com.ng' ? 'QServers' : 'Namecheap';
}

/**
 * A name to buy: `.com` or `.com.ng`. A bare name ("adafabrics") takes
 * `ending`; `allowed` is what's on sale right now.
 */
export function buyableDomain(input: string, ending: BuyEnding, allowed: readonly BuyEnding[] = BUY_ENDINGS): DomainParse {
  const host = cleanHost(input);
  if (!host) return { ok: false, error: 'Type the name you’d like, e.g. adafabrics.' };
  const typed = host.includes('.') ? endingOf(host) : ending;
  const name = host.includes('.') && typed ? host.slice(0, -(typed.length + 1)) : host;
  if (!typed || !allowed.includes(typed) || name.includes('.')) {
    const offered = allowed.map((e) => `.${e}`).join(' or ');
    return { ok: false, error: `We offer ${offered} addresses. Try the same name ending in ${offered}.` };
  }
  if (!LABEL.test(name)) {
    return { ok: false, error: 'Use letters, numbers and hyphens only, not starting or ending with a hyphen.' };
  }
  return { ok: true, domain: `${name}.${typed}` };
}

/** A domain the merchant owns, to connect: the domain itself, any ending. */
export function ownedDomain(input: string): DomainParse {
  const host = cleanHost(input);
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels[labels.length - 1])) {
    return { ok: false, error: 'Enter your domain, like yourshop.com.' };
  }
  const suffix = labels.slice(-2).join('.');
  const apexLength = TWO_PART_SUFFIXES.has(suffix) ? 3 : 2;
  if (labels.length !== apexLength) {
    return {
      ok: false,
      error: `Enter the domain itself, like ${labels.slice(-apexLength).join('.')} — your shop will use it and its www address.`,
    };
  }
  return { ok: true, domain: host };
}

/** The host shoppers are sent to. */
export const canonicalHostFor = (domain: string) => `www.${domain}`;

/** Close alternatives with the same ending when a name is taken, best first. */
export function domainSuggestions(domain: string): string[] {
  const ending = endingOf(domain) ?? 'com';
  const name = domain.slice(0, -(ending.length + 1));
  const plain = name.replace(/-/g, '');
  const ng = ending === 'com' ? [`${name}ng`, `${name}-ng`] : [];
  const raw = [name.includes('-') ? plain : '', ...ng, `${name}shop`, `${name}-shop`, `${name}store`, `shop${plain}`, `get${plain}`]
    .filter(Boolean)
    .map((n) => `${n}.${ending}`);
  return [...new Set(raw)].filter((d) => d !== domain && buyableDomain(d, ending).ok).slice(0, 6);
}

/** Close `.com` alternatives when a name is taken, best first. */
export const comSuggestions = (domain: string) => domainSuggestions(domain);

/* ─── Renewal ────────────────────────────────────────────────────────────── */

export const RENEWAL_DEADLINE_DAYS = 7;
/** Typical .com periods after expiry — Namecheap's own figures to be confirmed (12.6). */
export const GRACE_DAYS = 30;
export const REDEMPTION_DAYS = 30;

export function renewalDeadline(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() - RENEWAL_DEADLINE_DAYS * DAY);
}

export type RenewalStage =
  /** more than 30 days before the deadline */
  | 'ok'
  /** within 30 days of the deadline */
  | 'renew_soon'
  /** past the deadline, before expiry — still works, renew now */
  | 'past_deadline'
  /** expired: renewal at the normal price still restores it */
  | 'grace'
  /** the registry deleted it; recovering costs a redemption fee */
  | 'redemption'
  /** released: anyone may register it */
  | 'released';

export function renewalStage(expiresAt: Date, now: Date): RenewalStage {
  const t = now.getTime();
  const expiry = expiresAt.getTime();
  const deadline = renewalDeadline(expiresAt).getTime();
  if (t >= expiry + (GRACE_DAYS + REDEMPTION_DAYS) * DAY) return 'released';
  if (t >= expiry + GRACE_DAYS * DAY) return 'redemption';
  if (t >= expiry) return 'grace';
  if (t >= deadline) return 'past_deadline';
  if (t >= deadline - 30 * DAY) return 'renew_soon';
  return 'ok';
}

/** Days before the deadline a reminder goes (common registrar practice, decided). */
export const REMINDER_DAYS = [30, 14, 7, 3, 1] as const;

/**
 * The renewal reminder due now, if any — a key that includes the expiry it's
 * for, so each renewal cycle has its own set and each is sent once:
 *   before_30 … before_1 (days to the renewal deadline), expired (the expiry
 *   day), grace_w1 … grace_w4 (weekly while it can still be renewed).
 */
export function reminderDue(expiresAt: Date, now: Date): string | null {
  const cycle = expiresAt.toISOString().slice(0, 10);
  const t = now.getTime();
  const expiry = expiresAt.getTime();
  if (t >= expiry) {
    const days = Math.floor((t - expiry) / DAY);
    if (days === 0) return `expired:${cycle}`;
    const week = Math.floor(days / 7);
    return week >= 1 && days < GRACE_DAYS ? `grace_w${week}:${cycle}` : null;
  }
  const toDeadline = Math.ceil((renewalDeadline(expiresAt).getTime() - t) / DAY);
  // The nearest threshold not yet passed: a missed day still gets its reminder.
  const due = [...REMINDER_DAYS].reverse().find((d) => toDeadline <= d);
  if (due !== undefined) return `before_${due}:${cycle}`;
  return null;
}

/* ─── Connecting: the DNS records ───────────────────────────────────────── */

export interface DnsTargets {
  /** where www points (a CNAME) */
  cname: string;
  /** where the bare domain points (an A record) */
  apexIp: string;
}

export interface DnsRecord {
  type: 'A' | 'CNAME';
  /** as registrars write it: "@" for the domain itself */
  name: '@' | 'www';
  value: string;
}

export function dnsRecordsFor(targets: DnsTargets): DnsRecord[] {
  return [
    { type: 'A', name: '@', value: targets.apexIp },
    { type: 'CNAME', name: 'www', value: targets.cname },
  ];
}

/* ─── The timeline a merchant sees ──────────────────────────────────────── */

export const PROMISE_HOURS = 24;

export type TimelineStep = { key: 'paid' | 'registering' | 'connecting' | 'live'; label: string; at: Date | null };

export function orderTimeline(order: {
  type: 'EXISTING' | 'REGISTER' | 'RENEW' | 'FREE';
  /** the plan's free .com.ng (22.3): nothing was paid */
  isFree?: boolean;
  readyAt: Date | null;
  stepRegisteredAt: Date | null;
  stepDnsAt: Date | null;
  stepHostAt: Date | null;
  fulfilledAt: Date | null;
}): TimelineStep[] {
  if (order.type === 'RENEW') {
    return [
      { key: 'paid', label: 'Paid', at: order.readyAt },
      { key: 'registering', label: 'Renewing with the registrar', at: order.stepRegisteredAt },
      { key: 'live', label: 'Renewed', at: order.fulfilledAt },
    ];
  }
  const connecting = order.stepHostAt ?? order.stepDnsAt;
  return [
    { key: 'paid', label: order.type === 'EXISTING' ? 'Records found' : order.isFree ? 'Chosen — free with your plan' : 'Paid', at: order.readyAt },
    ...(order.type === 'REGISTER' ? [{ key: 'registering' as const, label: 'Registering your domain', at: order.stepRegisteredAt }] : []),
    { key: 'connecting', label: 'Connecting it to your shop', at: connecting },
    { key: 'live', label: 'Live', at: order.fulfilledAt },
  ];
}

/** Past the 24-hour promise and not done. */
export function isOverdue(readyAt: Date | null, done: boolean, now: Date): boolean {
  return Boolean(readyAt) && !done && now.getTime() - readyAt!.getTime() > PROMISE_HOURS * 3600_000;
}

/* ─── The staff checklist (11.5) ────────────────────────────────────────── */

export type DomainStep = 'registered' | 'dns' | 'host' | 'checked';

/** The checklist for each kind of work, in order. */
export const STEPS_FOR: Record<'REGISTER' | 'EXISTING' | 'RENEW', DomainStep[]> = {
  REGISTER: ['registered', 'dns', 'host', 'checked'],
  EXISTING: ['dns', 'host', 'checked'],
  RENEW: ['registered'],
};

/** The checklist's words for one order — naming the registrar its domain is registered at. */
export function stepInfo(kind: 'REGISTER' | 'EXISTING' | 'RENEW', domain: string | null): Record<DomainStep, string> {
  const registrar = domain ? registrarFor(domain) : 'Namecheap';
  const words = STEP_INFO[kind];
  return Object.fromEntries(
    (Object.keys(words) as DomainStep[]).map((k) => [k, words[k].replace(/Namecheap/g, registrar)]),
  ) as Record<DomainStep, string>;
}

export const STEP_INFO: Record<'REGISTER' | 'EXISTING' | 'RENEW', Record<DomainStep, string>> = {
  REGISTER: {
    registered: 'Register it at Namecheap for 1 year, with the merchant as registrant (details below), and record the expiry date',
    dns: 'Set the DNS records below in Namecheap',
    host: 'Add the domain and its www at the host, so the padlock certificate is issued',
    checked: 'Open https://www.… and check the shop loads with a padlock',
  },
  EXISTING: {
    registered: '',
    dns: 'The merchant’s DNS records point at us (checked when they pressed “Check my domain” — check again below)',
    host: 'Add the domain and its www at the host, so the padlock certificate is issued',
    checked: 'Open https://www.… and check the shop loads with a padlock',
  },
  RENEW: {
    registered: 'Renew it at Namecheap for 1 year and record the new expiry date',
    dns: '',
    host: '',
    checked: '',
  },
};
