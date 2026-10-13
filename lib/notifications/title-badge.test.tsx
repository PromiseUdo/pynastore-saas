// @vitest-environment jsdom
/*
 * The tab title's count (ROADMAP 18): the larger of the bell's and Messages'
 * counts — never their sum — put back after Next changes the title, and
 * gone when nothing is waiting.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useTitleCount } from './title-badge';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('the tab title', () => {
  it('shows the larger count, and keeps it through a title change', async () => {
    document.title = 'Orders';
    const bell = renderHook(({ n }) => useTitleCount('notifications', n), { initialProps: { n: 2 } });
    renderHook(() => useTitleCount('messages', 3));
    expect(document.title).toBe('(3) Orders');

    document.title = 'Products'; // a navigation
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.title).toBe('(3) Products');

    bell.rerender({ n: 120 });
    expect(document.title).toBe('(99+) Products');
  });

  it('drops the count when nothing is waiting', () => {
    document.title = 'Orders';
    const { rerender, unmount } = renderHook(({ n }) => useTitleCount('notifications', n), { initialProps: { n: 1 } });
    expect(document.title).toBe('(1) Orders');
    rerender({ n: 0 });
    expect(document.title).toBe('Orders');
    unmount();
    expect(document.title).toBe('Orders');
  });
});
