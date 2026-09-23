/*
 * The wash between a merchant's photo and their words.
 *
 * It was a left-to-right gradient whatever the alignment, so centred and
 * right-aligned headlines sat over the clear end of it and became
 * unreadable over a busy photo. It has to run from the side the words are on.
 */
import { describe, expect, it } from 'vitest';
import { scrim } from './hero-carousel';

describe('scrim', () => {
  it('runs left-to-right for words on the left', () => {
    expect(scrim('dark', 'left')).toContain('bg-gradient-to-r');
  });

  it('runs the other way for words on the right', () => {
    expect(scrim('dark', 'right')).toContain('bg-gradient-to-l');
    expect(scrim('light', 'right')).toContain('bg-gradient-to-l');
  });

  it('uses an even shade for centred words — there is no side to run from', () => {
    expect(scrim('dark', 'center')).toBe('bg-black/50');
    expect(scrim('light', 'center')).toBe('bg-white/60');
  });

  it('darkens behind light text and lightens behind dark text', () => {
    expect(scrim('dark', 'left')).toContain('from-black');
    expect(scrim('light', 'left')).toContain('from-white');
  });
});
