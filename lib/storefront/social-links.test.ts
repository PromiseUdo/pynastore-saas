import { describe, expect, it } from 'vitest';
import { normalizeSocialLink, normalizeSocialLinks, readSocialLinks, socialLinksForForm } from './social-links';
import { parseTheme } from './theme';

describe('normalizeSocialLink', () => {
  it('takes a link as pasted, with or without https://, and keeps it on https', () => {
    expect(normalizeSocialLink('facebook', 'facebook.com/looktest')).toEqual({
      ok: true,
      url: 'https://facebook.com/looktest',
    });
    expect(normalizeSocialLink('youtube', 'http://www.youtube.com/@looktest#about')).toEqual({
      ok: true,
      url: 'https://www.youtube.com/@looktest',
    });
  });

  it('turns an @handle, or a bare name, into a link where the platform has handles', () => {
    expect(normalizeSocialLink('instagram', '@look.test')).toEqual({ ok: true, url: 'https://www.instagram.com/look.test' });
    expect(normalizeSocialLink('tiktok', 'looktest')).toEqual({ ok: true, url: 'https://www.tiktok.com/@looktest' });
    expect(normalizeSocialLink('x', '@looktest')).toEqual({ ok: true, url: 'https://x.com/looktest' });
    // Facebook has no handle form, so a bare word isn't a page.
    expect(normalizeSocialLink('facebook', 'looktest').ok).toBe(false);
  });

  it('refuses a link to somewhere other than the platform it is labelled with', () => {
    expect(normalizeSocialLink('instagram', 'https://instagram.com.evil.example/x').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://evil.example/instagram.com').ok).toBe(false);
    expect(normalizeSocialLink('linkedin', 'javascript:alert(1)').ok).toBe(false);
    expect(normalizeSocialLink('x', 'https://x.com').ok).toBe(false);
  });

  it('drops credentials smuggled into a link', () => {
    expect(normalizeSocialLink('linkedin', 'https://user:pw@linkedin.com/company/looktest')).toEqual({
      ok: true,
      url: 'https://linkedin.com/company/looktest',
    });
  });

  it('reads a WhatsApp number the way people write theirs', () => {
    expect(normalizeSocialLink('whatsapp', '0801 234 5678')).toEqual({ ok: true, url: 'https://wa.me/2348012345678' });
    expect(normalizeSocialLink('whatsapp', '+234 (801) 234-5678')).toEqual({ ok: true, url: 'https://wa.me/2348012345678' });
    expect(normalizeSocialLink('whatsapp', 'https://wa.me/447700900123')).toEqual({ ok: true, url: 'https://wa.me/447700900123' });
    expect(normalizeSocialLink('whatsapp', 'call me').ok).toBe(false);
    expect(normalizeSocialLink('whatsapp', '12345').ok).toBe(false);
  });

  it('treats an empty box as not set', () => {
    expect(normalizeSocialLink('instagram', '   ')).toEqual({ ok: true, url: null });
  });
});

describe('normalizeSocialLinks', () => {
  it('keeps only the platforms that were filled in', () => {
    expect(normalizeSocialLinks({ instagram: '@a', facebook: '' })).toEqual({
      ok: true,
      links: { instagram: 'https://www.instagram.com/a' },
    });
  });

  it('reports every platform with a problem', () => {
    const result = normalizeSocialLinks({ instagram: 'https://example.com/a', whatsapp: 'nope', x: '@fine' });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['instagram', 'whatsapp']);
  });
});

describe('readSocialLinks', () => {
  it('shows stored links in a fixed order, and nothing that fails the rules', () => {
    expect(
      readSocialLinks({
        linkedin: 'https://linkedin.com/company/a',
        instagram: 'https://www.instagram.com/a',
        facebook: 'https://evil.example/',
        tiktok: 42,
      }).map((link) => link.platform),
    ).toEqual(['instagram', 'linkedin']);
  });

  it('copes with nothing stored, or something that isn’t a record', () => {
    expect(readSocialLinks(null)).toEqual([]);
    expect(readSocialLinks(['https://www.instagram.com/a'])).toEqual([]);
    expect(socialLinksForForm(null).instagram).toBe('');
  });
});

describe('parseTheme', () => {
  it('lets the shopper’s own choice win over the merchant’s default', () => {
    expect(parseTheme('light', 'dark')).toBe('light');
    expect(parseTheme('dark', 'light')).toBe('dark');
  });

  it('falls back to the merchant’s default, then light', () => {
    expect(parseTheme(undefined, 'dark')).toBe('dark');
    expect(parseTheme('garbage', 'dark')).toBe('dark');
    expect(parseTheme(undefined)).toBe('light');
  });
});
