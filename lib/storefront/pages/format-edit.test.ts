import { describe, expect, it } from 'vitest';
import { changedRange, insertLink, toggleBold, toggleLines } from './format-edit';
import { formattedToPlain, parsePageBody } from './format';

const sel = (value: string, edit: { start: number; end: number }) => value.slice(edit.start, edit.end);

describe('toggleBold', () => {
  it('wraps the selection and keeps it selected', () => {
    const edit = toggleBold('Soft cotton tee', 5, 11);
    expect(edit.value).toBe('Soft **cotton** tee');
    expect(sel(edit.value, edit)).toBe('cotton');
  });

  it('takes bold off again, from inside or around the marks', () => {
    const inside = toggleBold('Soft **cotton** tee', 7, 13);
    expect(inside.value).toBe('Soft cotton tee');
    const around = toggleBold('Soft **cotton** tee', 5, 15);
    expect(around.value).toBe('Soft cotton tee');
  });

  it('leaves spaces outside the marks so the bold still works', () => {
    const edit = toggleBold('Soft cotton tee', 4, 12);
    expect(edit.value).toBe('Soft **cotton** tee');
    expect(parsePageBody(edit.value)[0]).toMatchObject({ type: 'paragraph' });
  });

  it('offers a placeholder to type over when nothing is selected', () => {
    const edit = toggleBold('Hi ', 3, 3);
    expect(edit.value).toBe('Hi **bold text**');
    expect(sel(edit.value, edit)).toBe('bold text');
  });
});

describe('toggleLines', () => {
  const text = 'Intro\nFirst\nSecond\nOutro';

  it('turns every selected line into a bulleted item', () => {
    const edit = toggleLines(text, 7, 15, 'bullet');
    expect(edit.value).toBe('Intro\n- First\n- Second\nOutro');
    expect(parsePageBody(edit.value).some((b) => b.type === 'list' && !b.ordered && b.items.length === 2)).toBe(true);
  });

  it('numbers lines in order and swaps bullets for numbers', () => {
    const edit = toggleLines('Intro\n- First\n- Second', 7, 22, 'numbered');
    expect(edit.value).toBe('Intro\n1. First\n2. Second');
  });

  it('takes the mark off when every line already has it', () => {
    const edit = toggleLines('- First\n- Second', 0, 16, 'bullet');
    expect(edit.value).toBe('First\nSecond');
  });

  it('makes the cursor line a heading and keeps the cursor in its words', () => {
    const edit = toggleLines('How to use\nApply daily', 4, 4, 'heading');
    expect(edit.value).toBe('## How to use\nApply daily');
    expect(edit.start).toBe(7);
  });

  it('gives an empty line its mark so there is somewhere to type', () => {
    const edit = toggleLines('Intro\n', 6, 6, 'bullet');
    expect(edit.value).toBe('Intro\n- ');
    expect(edit.start).toBe(8);
  });

  it('does not reach into the next line when the selection ends at a line break', () => {
    const edit = toggleLines('One\nTwo', 0, 4, 'bullet');
    expect(edit.value).toBe('- One\nTwo');
  });
});

describe('insertLink', () => {
  it('links the selected words and selects the address to paste over', () => {
    const edit = insertLink('See our size guide today', 8, 18);
    expect(edit.value).toBe('See our [size guide](https://) today');
    expect(sel(edit.value, edit)).toBe('https://');
  });
});

describe('changedRange', () => {
  it('finds only the stretch that changed', () => {
    for (const [before, after] of [
      ['Soft cotton tee', 'Soft **cotton** tee'],
      ['abc', 'abXc'],
      ['- One\n- Two', 'One\nTwo'],
    ]) {
      const r = changedRange(before, after);
      expect(before.slice(0, r.from) + r.text + before.slice(r.to)).toBe(after);
    }
    expect(changedRange('abc', 'abXc')).toEqual({ from: 2, to: 2, text: 'X' });
  });
});

describe('formattedToPlain', () => {
  it('drops the marks and keeps the words', () => {
    expect(formattedToPlain('## How to use\nApply **twice** daily.\n\n- Gentle\n- [Vegan](https://x.com)')).toBe(
      'How to use\n\nApply twice daily.\n\n- Gentle\n- Vegan',
    );
  });
});
