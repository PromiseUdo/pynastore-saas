// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReadMore } from './read-more';

/* jsdom has no layout: give the copy a height, the page a width, and the
 * specifications box a position. */
function layout({ wide, copyHeight, specsBottom }: { wide: boolean; copyHeight: number; specsBottom: number }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('min-width: 1024px'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => copyHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: 100, bottom: this.id === 'specs' ? specsBottom : 0 } as DOMRect;
  });
}

function renderWithSpecs() {
  return render(
    <>
      <ReadMore matchId="specs">
        <p>Long copy</p>
      </ReadMore>
      <dl id="specs" />
    </>,
  );
}

const copyBox = () => screen.getByText('Long copy').parentElement!.parentElement!;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReadMore', () => {
  it('on a desktop, ends level with the specifications box and offers Read more / Show less', () => {
    layout({ wide: true, copyHeight: 900, specsBottom: 400 });
    renderWithSpecs();
    // Specs end 300px below the copy's top edge.
    expect(copyBox().style.maxHeight).toBe('300px');
    fireEvent.click(screen.getByRole('button', { name: /Read more/ }));
    expect(copyBox().style.maxHeight).toBe('');
    expect(screen.getByRole('button', { name: /Show less/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('just shows copy that is only a little longer than the box', () => {
    layout({ wide: true, copyHeight: 320, specsBottom: 400 });
    renderWithSpecs();
    expect(copyBox().style.maxHeight).toBe('');
    expect(screen.queryByRole('button', { name: /Read more/ })).toBeNull();
  });

  it('on a phone, shows a short preview whatever the specifications do', () => {
    layout({ wide: false, copyHeight: 900, specsBottom: 2000 });
    renderWithSpecs();
    expect(copyBox().style.maxHeight).toBe('160px');
    expect(screen.getByRole('button', { name: /Read more/ })).toBeTruthy();
  });
});
