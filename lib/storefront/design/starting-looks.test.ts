import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, type BusinessType } from '@/lib/onboarding/business';
import { DesignSchema, classicDesign } from './schema';
import { STARTING_LOOKS, STARTING_LOOK_IDS, applyStartingLook, startingLookFor, startingLookStatus } from './starting-looks';
import { classicSections } from '../sections/schema';

const from = classicDesign({ accent: '#b42318', darkByDefault: true });
const withFooter = {
  ...from,
  corners: 'square' as const,
  fonts: 'friendly' as const,
  footer: { columns: [{ key: 'shop' as const, enabled: true }] },
};

describe('starting looks', () => {
  it('are each a valid design, with a valid front page', () => {
    for (const id of STARTING_LOOK_IDS) {
      const { version: _v, ...input } = applyStartingLook(id, from);
      const parsed = DesignSchema.safeParse({ ...input, version: 2 });
      expect(parsed.success, `${id}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`).toBe(true);
    }
  });

  it('bring their look, front page and header, and clear Fine-tune that belonged to the old look', () => {
    const applied = applyStartingLook('electronics', withFooter);
    expect(applied).toMatchObject({ look: 'bold', header: { layout: 'search' }, corners: null, fonts: null, cards: null });
    expect(applied.sections?.[0]).toMatchObject({ type: 'hero' });
    expect(applied.sections?.some((s) => s.type === 'brands')).toBe(true);
  });

  it('keep the shop’s colour, light/dark and footer', () => {
    const applied = applyStartingLook('fashion', withFooter);
    expect(applied).toMatchObject({ brandColour: '#b42318', darkByDefault: true, footer: withFooter.footer });
  });

  it('write no words of their own beyond naming what a band shows', () => {
    for (const id of STARTING_LOOK_IDS) {
      for (const section of STARTING_LOOKS[id].sections() ?? []) {
        expect(section.type).not.toBe('image-text'); // that's the merchant's words, never ours
      }
    }
  });

  it('Classic is the standard front page — no arrangement of its own', () => {
    expect(applyStartingLook('general', from)).toMatchObject({ look: 'classic', sections: null, header: { layout: 'standard' } });
  });
});

describe('startingLookFor', () => {
  it('suggests one for every business type asked at sign-up', () => {
    for (const type of Object.keys(BUSINESS_TYPES) as BusinessType[]) {
      expect(STARTING_LOOK_IDS).toContain(startingLookFor(type));
    }
    expect(startingLookFor('fashion')).toBe('fashion');
    expect(startingLookFor('beauty')).toBe('fashion');
    expect(startingLookFor('electronics')).toBe('electronics');
    expect(startingLookFor('groceries')).toBe('grocery');
  });

  it('falls back to Classic when we don’t know, or were told nothing', () => {
    expect(startingLookFor(null)).toBe('general');
    expect(startingLookFor('jewellery')).toBe('general');
    expect(startingLookFor('__proto__')).toBe('general');
  });
});

describe('startingLookStatus — telling the merchant which one is in use', () => {
  it('reads a standard shop with nothing recorded as Classic, untouched', () => {
    expect(startingLookStatus(classicDesign({ accent: null, darkByDefault: false }))).toEqual({ id: 'general', changed: false });
  });

  it('remembers the starting look applied, and says when it has been changed since', () => {
    const applied = applyStartingLook('fashion', from);
    expect(applied.startingLook).toBe('fashion');
    expect(startingLookStatus(applied)).toEqual({ id: 'fashion', changed: false });
    expect(startingLookStatus({ ...applied, look: 'bold' })).toEqual({ id: 'fashion', changed: true });
    expect(startingLookStatus({ ...applied, header: { layout: 'standard' } })).toEqual({ id: 'fashion', changed: true });
    expect(startingLookStatus({ ...applied, sections: [...(applied.sections ?? [])].reverse() })).toEqual({ id: 'fashion', changed: true });
  });

  it('ignores what a starting look never touches — colour, light/dark, footer', () => {
    const applied = applyStartingLook('grocery', from);
    expect(startingLookStatus({ ...applied, brandColour: '#0f5132', darkByDefault: false, footer: { columns: [] } })).toEqual({ id: 'grocery', changed: false });
  });

  it('still recognises it after the stored copy has been read back (keys in another order)', () => {
    const { version: _v, ...input } = applyStartingLook('electronics', from);
    const roundTripped = DesignSchema.parse(JSON.parse(JSON.stringify({ ...input, version: 2 })));
    expect(startingLookStatus(roundTripped)).toEqual({ id: 'electronics', changed: false });
  });

  it('treats the standard front page written out the same as no arrangement', () => {
    const written = { ...classicDesign({ accent: null, darkByDefault: false }), sections: classicSections() };
    expect(startingLookStatus(written)).toEqual({ id: 'general', changed: false });
  });

  it('calls a hand-arranged design with nothing recorded the shop’s own', () => {
    const own = { ...classicDesign({ accent: null, darkByDefault: false }), look: 'minimal' as const };
    expect(startingLookStatus(own)).toBeNull();
  });
});
