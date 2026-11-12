/*
 * lib/phone.ts
 *
 * Nigerian mobile numbers, in one place. Pure — safe on client and server.
 *
 * Stored as +234XXXXXXXXXX: one spelling, so the same number typed as
 * "0803 123 4567" and "+234 803 123 4567" is the same number. A service that
 * wants the local spelling (EduPay takes 08031234567, ROADMAP 20.2) converts
 * at its own edge with `toLocalNigerianPhone`.
 */

/** Nigerian mobile numbers, as +234XXXXXXXXXX. Null when it isn't one. */
export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?234|0)([789][01]\d{8})$/.exec(digits);
  return match ? `+234${match[1]}` : null;
}

/** 08031234567 for any spelling of a Nigerian mobile number; null otherwise. */
export function toLocalNigerianPhone(raw: string): string | null {
  const normalized = normalizeNigerianPhone(raw);
  return normalized ? `0${normalized.slice(4)}` : null;
}

/** How a stored number is shown back: 0803 123 4567. */
export function formatNigerianPhone(raw: string | null | undefined): string {
  const local = raw ? toLocalNigerianPhone(raw) : null;
  if (!local) return raw ?? '';
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

export const NIGERIAN_PHONE_ERROR = 'Enter a Nigerian mobile number, like 0803 123 4567.';
