/*
 * The AI Shopping Service — the one entry point the app calls.
 *
 *   route handler ─▶ askShoppingAssistant() ─▶ AIShoppingProvider
 *                                               ├─ gemini  (./gemini-provider.ts)
 *                                               └─ mock    (deterministic, no model)
 *
 * Nothing outside this file names a provider, so adding a real one is:
 * write a module implementing AIShoppingProvider, register it in PROVIDERS,
 * set AI_SHOPPING_PROVIDER. No component, no route and no test changes (§34).
 *
 * Provider credentials are read server-side only (GEMINI_API_KEY, in
 * ./gemini/client.ts) and never under a NEXT_PUBLIC_ name. Nothing
 * provider-shaped is ever imported into a client component (§42).
 */
import { createGeminiShoppingProvider } from './gemini-provider';
import { createMockShoppingProvider } from './mock-provider';
import {
  MAX_HISTORY_TURNS,
  type AIShoppingProvider,
  type AssistantRequest,
  type AssistantResponse,
} from './types';

const PROVIDERS: Record<string, () => AIShoppingProvider> = {
  gemini: createGeminiShoppingProvider,
  mock: createMockShoppingProvider,
};

/**
 * With AI_SHOPPING_PROVIDER unset: Gemini when a key is configured, the mock
 * otherwise. Tests always default to the mock — vitest loads .env, and a
 * suite must never spend a real key's quota by accident.
 */
function defaultProvider(): string {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return 'mock';
  return process.env.GEMINI_API_KEY?.trim() ? 'gemini' : 'mock';
}

let cached: AIShoppingProvider | null = null;

/**
 * The configured provider.
 *
 * Falls back to the mock rather than throwing when the env names something
 * that isn't registered: a mistyped variable should degrade the assistant to
 * its deterministic mode, not take the storefront down. The warning is
 * server-side so the misconfiguration is still visible.
 */
export function getShoppingProvider(): AIShoppingProvider {
  if (cached) return cached;

  const requested = process.env.AI_SHOPPING_PROVIDER?.trim() || defaultProvider();
  const factory = PROVIDERS[requested];
  if (!factory) {
    console.warn(
      `[ai] AI_SHOPPING_PROVIDER="${requested}" is not a registered provider; using "mock".`,
    );
  }
  cached = (factory ?? PROVIDERS.mock)();
  return cached;
}

/** Test seam — lets a suite pin a provider without touching the environment. */
export function setShoppingProvider(provider: AIShoppingProvider | null): void {
  cached = provider;
}

/**
 * Ask the assistant.
 *
 * History is trimmed here rather than at the caller so every provider — and
 * eventually every token bill — inherits the same cap (§36).
 */
export async function askShoppingAssistant(
  request: AssistantRequest,
): Promise<AssistantResponse> {
  const provider = getShoppingProvider();
  return provider.ask({
    ...request,
    history: request.history.slice(-MAX_HISTORY_TURNS),
  });
}
