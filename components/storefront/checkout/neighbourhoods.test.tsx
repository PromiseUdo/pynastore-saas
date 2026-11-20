// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const lookup = vi.hoisted(() => vi.fn(async (_input: { state: string; lga: string }) => [] as string[]));
vi.mock('@/features/shop-orders/actions', () => ({ deliveryNeighbourhoodsAction: (input: { state: string; lga: string }) => lookup(input) }));

import { NeighbourhoodField, forgetNeighbourhoods, useNeighbourhoods } from './neighbourhoods';

function Harness({ state, lga }: { state: string; lga: string }) {
  const { areas } = useNeighbourhoods(state, lga);
  return areas.length ? <NeighbourhoodField id="area" lga={lga} areas={areas} defaultValue="" /> : <p>no question</p>;
}

beforeEach(() => {
  forgetNeighbourhoods();
  lookup.mockReset();
});
afterEach(cleanup);

describe('Which part of …? (25.2)', () => {
  it('asks only where the shop prices by neighbourhood, from its own list, with “somewhere else”', async () => {
    lookup.mockResolvedValue(['Bode Thomas', 'Aguda']);
    render(<Harness state="Lagos" lga="Surulere" />);
    const select = (await screen.findByLabelText('Which part of Surulere?')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Bode Thomas', 'Aguda', 'Somewhere else in Surulere']);
    expect(lookup).toHaveBeenCalledWith({ state: 'Lagos', lga: 'Surulere' });
  });

  it('doesn’t ask where the shop prices the whole LGA', async () => {
    lookup.mockResolvedValue([]);
    render(<Harness state="Lagos" lga="Ikeja" />);
    expect(await screen.findByText('no question')).toBeTruthy();
    expect(screen.queryByLabelText(/Which part of/)).toBeNull();
  });

  it('asks the server once per LGA for the visit', async () => {
    lookup.mockResolvedValue(['Bode Thomas']);
    const { unmount } = render(<Harness state="Lagos" lga="Surulere" />);
    await screen.findByLabelText('Which part of Surulere?');
    unmount();
    render(<Harness state="Lagos" lga="Surulere" />);
    await screen.findByLabelText('Which part of Surulere?');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
