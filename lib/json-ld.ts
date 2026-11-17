/*
 * lib/json-ld.ts
 *
 * JSON for a <script type="application/ld+json"> block. JSON.stringify alone
 * isn't safe inside <script>: a product name or a shopper's review containing
 * "</script>" would close the block and let the rest of the text become HTML
 * on the page. Escaping <, > and & as \u-sequences keeps the JSON identical
 * for search engines and makes it impossible to leave the script element.
 */
export function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
