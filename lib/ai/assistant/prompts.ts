/*
 * Suggested opening prompts, per surface.
 *
 * Deliberately short lists (§23): four is enough to show what the assistant
 * is for. A wall of chips reads as a menu the shopper has to study, which is
 * the opposite of "just say what you need".
 *
 * These are PHRASINGS, not answers — every one of them goes through the same
 * classifier and the same catalogue read as typed text, so none of them can
 * promise something the store doesn't have. Surface-specific because the
 * useful question on a product page ("is this worth it?") is meaningless on
 * the homepage, and vice versa.
 *
 * Pure data: no imports, safe in client components.
 */
import type { AssistantSurface } from '@/lib/storefront/stores/assistant-store';

const PROMPTS: Record<AssistantSurface, string[]> = {
  home: [
    'Find something for me',
    'Show me popular products',
    'Find a gift',
    'Help me choose',
  ],
  product: [
    'Is this worth the price?',
    'What’s the sizing like?',
    'Are there cheaper alternatives?',
    'Compare with similar products',
  ],
  search: [
    'Show me something cheaper',
    'Which has the best rating?',
    'Show me similar products',
  ],
  category: [
    'Show me the best rated ones',
    'Show me something cheaper',
    'Help me choose',
  ],
  cart: [
    'Help me choose another item',
    'Show me popular products',
    'What’s the return policy?',
  ],
};

export function quickPromptsFor(surface: AssistantSurface): string[] {
  return PROMPTS[surface] ?? PROMPTS.home;
}

/** The line above the prompts, framed for where the shopper is. */
export function openingLineFor(surface: AssistantSurface, subject?: string): string {
  switch (surface) {
    case 'product':
      return subject
        ? `Ask me anything about the ${subject} — I answer from its listing, reviews and the store's own policies.`
        : 'Ask me anything about this product.';
    case 'search':
      return 'Tell me what you’re actually after and I’ll search the store properly.';
    case 'category':
      return 'Describe what you need from this department and I’ll narrow it down.';
    case 'cart':
      return 'Need something to go with what’s in your bag? Tell me what you’re after.';
    default:
      return 'Describe what you need — what it’s for, roughly what you want to spend — and I’ll search this store for it.';
  }
}
