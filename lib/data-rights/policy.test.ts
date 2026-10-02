import { describe, expect, it } from 'vitest';
import { closureStage, erasedAt, FINANCIAL_RETENTION_YEARS, restorableUntil, retentionCutoff } from './policy';

describe('retention', () => {
  const closed = new Date('2026-10-01T10:00:00Z');

  it('keeps business records six years', () => {
    expect(FINANCIAL_RETENTION_YEARS).toBe(6);
    expect(retentionCutoff(new Date('2032-10-01T10:00:00Z')).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(erasedAt(closed).toISOString()).toBe('2032-10-01T10:00:00.000Z');
  });

  it('lets a closed workspace be restored for 30 days, then keeps only records, then erases it', () => {
    expect(restorableUntil(closed).toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(closureStage(closed, new Date('2026-10-31T09:59:59Z'))).toBe('restorable');
    expect(closureStage(closed, new Date('2026-10-31T10:00:00Z'))).toBe('records-only');
    expect(closureStage(closed, new Date('2032-10-01T09:59:59Z'))).toBe('records-only');
    expect(closureStage(closed, new Date('2032-10-01T10:00:00Z'))).toBe('due-for-erasure');
  });
});
