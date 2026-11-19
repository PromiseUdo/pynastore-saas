// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductHighlights } from './product-highlights';

afterEach(cleanup);
const list = (n: number) => Array.from({ length: n }, (_, i) => `Highlight ${i + 1}`);
const visible = () => screen.getAllByRole('listitem');

describe('ProductHighlights', () => {
  it('shows five, and the rest behind Read more / Show less', () => {
    render(<ProductHighlights highlights={list(7)} />);
    expect(visible()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /Read more/ }));
    expect(visible()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: /Show less/ }));
    expect(visible()).toHaveLength(5);
  });

  it('has no button when there are five or fewer', () => {
    render(<ProductHighlights highlights={list(5)} />);
    expect(visible()).toHaveLength(5);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
