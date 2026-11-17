import { describe, expect, it } from 'vitest';
import { sitemapXml } from './sitemap';

describe('sitemapXml', () => {
  it('writes each entry as a <url>, escaping the address', () => {
    const xml = sitemapXml([{ url: 'https://shop.example/c/a&b', changeFrequency: 'weekly', priority: 0.7 }]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<url><loc>https://shop.example/c/a&amp;b</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>');
  });

  it('is an empty urlset for a shop with nothing to list', () => {
    expect(sitemapXml([])).toContain('<urlset');
    expect(sitemapXml([])).not.toContain('<url>');
  });
});
