// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectField, pluralRegion } from './checkout-fields';

const STATES = ['Cross River', 'Lagos', 'Rivers'].map((s) => ({ value: s, label: s }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pointer(fine: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: fine && q === '(pointer: fine)',
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('SelectField with search', () => {
  it('on a computer, picking from the searchable list fills the real field and fires its change', async () => {
    pointer(true);
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <SelectField id="st" name="state" label="State" placeholder="Choose a state" options={STATES} searchNoun="states" onChange={onChange} defaultValue="" />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'State' }));
    await user.keyboard('riv{Enter}');

    const select = container.querySelector('select')!;
    expect(select.value).toBe('Rivers');
    expect(onChange).toHaveBeenCalled();
    expect(new FormData(container.querySelector('form')!).get('state')).toBe('Rivers');
    expect(screen.getByRole('button', { name: 'State' }).textContent).toContain('Rivers');
    // The hidden native field is out of the Tab order.
    expect(select.tabIndex).toBe(-1);
  });

  it('on a touch screen, the label still belongs to the native picker', () => {
    pointer(false);
    render(<SelectField id="st" label="State" options={STATES} searchNoun="states" defaultValue="Lagos" />);
    expect((screen.getByLabelText('State') as HTMLSelectElement).value).toBe('Lagos');
  });
});

describe('pluralRegion', () => {
  it('says states, regions and counties', () => {
    expect(pluralRegion('State')).toBe('states');
    expect(pluralRegion('Region')).toBe('regions');
    expect(pluralRegion('County')).toBe('counties');
  });
});
