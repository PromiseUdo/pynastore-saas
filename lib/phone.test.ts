import { describe, expect, it } from 'vitest';
import { formatNigerianPhone, normalizeNigerianPhone, toLocalNigerianPhone } from './phone';

describe('Nigerian phone numbers', () => {
  it('stores every spelling of the same number the same way', () => {
    for (const typed of ['08031234567', '0803 123 4567', '+234 803 123 4567', '2348031234567', '(0803) 123-4567']) {
      expect(normalizeNigerianPhone(typed)).toBe('+2348031234567');
    }
  });

  it('refuses what isn’t a Nigerian mobile number', () => {
    for (const typed of ['12345', '0603 123 4567', '+44 7700 900123', '0803123456', '']) {
      expect(normalizeNigerianPhone(typed)).toBeNull();
    }
  });

  it('gives the local spelling', () => {
    expect(toLocalNigerianPhone('+2348031234567')).toBe('08031234567');
    expect(toLocalNigerianPhone('nonsense')).toBeNull();
  });

  it('shows a stored number in groups, and anything else as it is', () => {
    expect(formatNigerianPhone('+2348031234567')).toBe('0803 123 4567');
    expect(formatNigerianPhone('+44 7700 900123')).toBe('+44 7700 900123');
    expect(formatNigerianPhone(null)).toBe('');
  });
});
