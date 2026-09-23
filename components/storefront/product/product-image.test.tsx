// @vitest-environment jsdom
/*
 * The rule this component exists for: a product with no image must never
 * become <img src="">, which the browser resolves to the current page and
 * downloads again.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';

afterEach(cleanup);
import { ProductImage } from './product-image';

/* next/image needs a Next request context; a plain img is enough to assert
 * what reaches the DOM. */
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} alt={alt} {...rest} />
  ),
}));

describe('ProductImage', () => {
  it('renders the merchant’s image when there is one', () => {
    render(<ProductImage src="https://cdn.example.com/skirt.jpg" alt="Skirt" width={40} height={40} />);
    expect(screen.getByAltText('Skirt').getAttribute('src')).toBe('https://cdn.example.com/skirt.jpg');
  });

  it('renders no img at all when there is no image', () => {
    const { container } = render(<ProductImage src={null} alt="Skirt" name="Skirt" width={40} height={40} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('treats an empty string, and whitespace, as no image', () => {
    for (const src of ['', '   ']) {
      const { container } = render(<ProductImage src={src} alt="Skirt" width={40} height={40} />);
      expect(container.querySelector('img')).toBeNull();
    }
  });

  it('invents nothing, and says nothing loudly', () => {
    /* No stock photo, no "coming soon", and no text shouting on every card:
     * a shop still adding photos should not look broken. */
    const { container } = render(<ProductImage src={null} alt="Ankara Skirt" name="Ankara Skirt" fill />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
