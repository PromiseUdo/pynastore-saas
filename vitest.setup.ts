import 'dotenv/config';

/*
 * jsdom gaps that Radix primitives depend on.
 *
 * Radix measures its own elements (`@radix-ui/react-use-size`) and jsdom
 * ships no ResizeObserver, so a component test that renders a radio group,
 * a select or a navigation menu throws on mount for a reason that has
 * nothing to do with what is being tested. Stubbed here rather than in each
 * test file so the next jsdom test doesn't rediscover it.
 *
 * Guarded on `window`: most suites in this repo run in the `node`
 * environment (see vitest.config.ts) and opt into jsdom with a
 * `@vitest-environment jsdom` pragma.
 */
if (typeof window !== 'undefined') {
  /* Reached through an index rather than `window.ResizeObserver`: the DOM
   * lib types say the property exists, so an `in` guard narrows `window` to
   * `never` and the assignment stops type-checking — while at runtime jsdom
   * genuinely doesn't provide it. */
  const globalWindow = window as unknown as Record<string, unknown>;
  if (!globalWindow.ResizeObserver) {
    globalWindow.ResizeObserver = class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  /* jsdom implements neither, and Radix calls them when a popup opens. */
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
}
