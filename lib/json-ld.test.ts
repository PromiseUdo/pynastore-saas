import { describe, expect, it } from 'vitest';
import { jsonLdHtml } from './json-ld';

describe('jsonLdHtml', () => {
  it('cannot close the script element it is written into', () => {
    const html = jsonLdHtml({ reviewBody: 'Great</script><script>alert(1)</script><a href="x">' });
    expect(html).not.toContain('<');
    expect(html).not.toContain('>');
  });

  it('still parses back to exactly the same data', () => {
    const value = { name: 'Tom & Jerry <Deluxe>', line: 'a\u2028b' };
    expect(JSON.parse(jsonLdHtml(value))).toEqual(value);
  });
});
