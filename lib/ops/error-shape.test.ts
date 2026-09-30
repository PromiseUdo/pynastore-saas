import { describe, expect, it } from 'vitest';
import { fingerprintOf, isBrowserNoise, isNextControlFlow, normalizeMessage, placeOf, safePath } from './error-shape';

describe('grouping', () => {
  it('treats messages that differ only by ids, numbers or quoted values as one', () => {
    const a = 'Order clx81abcdefghijklmnopqrstu not found after 3 tries for "ada@example.com"';
    const b = 'Order clx92zyxwvutsrqponmlkjihgf not found after 5 tries for "bola@example.com"';
    expect(normalizeMessage(a)).toBe(normalizeMessage(b));
    expect(fingerprintOf('server', '/x', a)).toBe(fingerprintOf('server', '/x', b));
  });

  it('keeps different places and sources apart', () => {
    expect(fingerprintOf('server', '/a', 'Boom')).not.toBe(fingerprintOf('server', '/b', 'Boom'));
    expect(fingerprintOf('server', '/a', 'Boom')).not.toBe(fingerprintOf('client', '/a', 'Boom'));
  });

  it('blanks uuids and long hex', () => {
    expect(normalizeMessage('key 3f2c1a9e-1b2c-4d5e-8f90-123456789abc and deadbeefcafe1234')).toBe('key <id> and <hex>');
  });
});

describe('paths', () => {
  it('drops the query string and hides token-looking segments', () => {
    expect(safePath('/reset-password/Zx8aQ2lT0kP9mWbV4nR7yC1d?email=a@b.c')).toBe('/reset-password/:token');
    expect(safePath('/orders/confirm/abcdefghijklmnopqrstuvwxyz0123')).toBe('/orders/confirm/:token');
    expect(safePath('/products/linen-shirt')).toBe('/products/linen-shirt');
    expect(safePath(null)).toBeNull();
  });

  it('turns a page into a place: every order page is one place', () => {
    expect(placeOf('/sales/orders/clx81abcdefghijklmnopqrstu')).toBe('/sales/orders/:id');
    expect(placeOf('/sales/invoices/42?tab=items')).toBe('/sales/invoices/:id');
  });
});

describe('what isn’t worth keeping', () => {
  it('drops browser noise', () => {
    expect(isBrowserNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isBrowserNoise('TypeError: Failed to fetch')).toBe(true);
    expect(isBrowserNoise('Script error.')).toBe(true);
    expect(isBrowserNoise('x is undefined', 'at foo (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(isBrowserNoise("Cannot read properties of undefined (reading 'price')")).toBe(false);
  });

  it('skips Next.js control flow on the server', () => {
    expect(isNextControlFlow({ message: 'NEXT_REDIRECT', digest: 'NEXT_REDIRECT;replace;/x;307;' })).toBe(true);
    expect(isNextControlFlow({ message: 'NEXT_HTTP_ERROR_FALLBACK;404', digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })).toBe(true);
    expect(isNextControlFlow({ message: 'Database timed out', digest: '1234567' })).toBe(false);
  });
});
