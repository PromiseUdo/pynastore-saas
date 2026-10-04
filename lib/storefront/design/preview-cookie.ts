/*
 * The name of the design-preview cookie (ROADMAP 15.1/15.3), on its own so
 * proxy.ts can recognise a preview request without loading the database
 * code in ./preview.ts. Holding the cookie grants nothing by itself.
 */
export const PREVIEW_COOKIE = 'sf-design-preview';
