// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StateSelect } from '@/components/dashboard/state-select';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe('StateSelect', () => {
  it('shows the placeholder, then finds a state by typing and takes it with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StateSelect id="s" value="" onChange={onChange} />);

    const button = screen.getByRole('button', { name: /choose a state/i });
    await user.click(button);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(30);

    await user.keyboard('riv');
    // Both contain "riv"; the one that starts with it comes first.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Rivers', 'Cross River']);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('Rivers');
  });

  it('can offer "Not set", which clears the state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StateSelect id="s" value="Lagos" onChange={onChange} noneLabel="Not set" />);
    await user.click(screen.getByRole('button', { name: /lagos/i }));
    await user.click(screen.getByRole('option', { name: 'Not set' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
