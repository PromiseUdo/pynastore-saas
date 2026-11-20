// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const path = vi.hoisted(() => ({ value: '/settings/delivery' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.value }));

import { LapsedGate } from './lapsed-gate';

afterEach(cleanup);
const page = () =>
  render(
    <LapsedGate lapsed closedScreen={<p>Your plan has ended</p>}>
      <p>the page</p>
    </LapsedGate>,
  );

describe('LapsedGate', () => {
  it('closes a page a lapsed workspace can’t use', () => {
    path.value = '/settings/delivery';
    page();
    expect(screen.getByText('Your plan has ended')).toBeTruthy();
  });

  it('opens choosing a plan — the page "Choose a plan" leads to — once the address changes', () => {
    path.value = '/settings/delivery';
    const { rerender } = page();
    path.value = '/upgrade';
    rerender(
      <LapsedGate lapsed closedScreen={<p>Your plan has ended</p>}>
        <p>the page</p>
      </LapsedGate>,
    );
    expect(screen.getByText('the page')).toBeTruthy();
  });

  it('closes nothing while the plan is live', () => {
    path.value = '/settings/delivery';
    render(
      <LapsedGate lapsed={false} closedScreen={<p>Your plan has ended</p>}>
        <p>the page</p>
      </LapsedGate>,
    );
    expect(screen.getByText('the page')).toBeTruthy();
  });
});
