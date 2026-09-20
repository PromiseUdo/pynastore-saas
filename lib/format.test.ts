import { describe, expect, it } from 'vitest';
import { enumLabel, formatDate, formatMoney, formatMoneyRange } from './format';

describe('format', () => {
  it('formats naira', () => {
    expect(formatMoney(5000)).toBe('₦5,000');
    expect(formatMoney(5000.5)).toBe('₦5,000.50');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoneyRange(5000, 9000)).toBe('₦5,000 – ₦9,000');
    expect(formatMoneyRange(5000, 5000)).toBe('₦5,000');
  });
  it('formats dates and enums', () => {
    expect(formatDate('2026-05-14T10:00:00Z')).toBe('14 May 2026');
    expect(enumLabel('PARTIALLY_PAID')).toBe('Partially paid');
  });
});
