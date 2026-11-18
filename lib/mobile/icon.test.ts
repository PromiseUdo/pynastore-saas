import { describe, expect, it } from 'vitest';
import { faviconAppIconPngUrl } from './icon';

describe('faviconAppIconPngUrl', () => {
  it('pads a Cloudinary favicon into a 1024 px square PNG on its own background', () => {
    expect(faviconAppIconPngUrl('https://res.cloudinary.com/x/image/upload/v1/shop/fav.jpg')).toBe(
      'https://res.cloudinary.com/x/image/upload/c_pad,w_700,h_700,b_auto/c_mpad,w_1024,h_1024,b_auto/f_png/v1/shop/fav.jpg',
    );
  });

  it('leaves any other address as it is', () => {
    expect(faviconAppIconPngUrl('https://example.com/favicon.png')).toBe('https://example.com/favicon.png');
  });
});
