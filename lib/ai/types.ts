/*
 * lib/ai — the Shopping Discovery Engine seam.
 *
 * NOTHING in this directory calls an LLM. At the time of writing the project
 * has no AI provider, no embeddings and no vector store (checked: no
 * @ai-sdk/openai/anthropic/langchain dependency, no pgvector column). Rather
 * than bolt on a fake assistant, this defines the CONTRACT the real engine
 * will implement and ships a deterministic local parser behind it, so the
 * homepage returns genuinely real catalogue results today.
 *
 * The intended pipeline, unchanged by that substitution:
 *
 *   shopper's words
 *        ↓
 *   intent extraction        ← lib/ai/intent.ts (local today, LLM later)
 *        ↓  ShoppingIntent
 *   product search tool      ← lib/storefront/catalog.ts (the tenant seam)
 *        ↓  real Product[]
 *   ranking / explanation    ← engine, later
 *        ↓
 *   real product cards       ← components/storefront/product/product-card.tsx
 *
 * The hard rule the engine must keep: it may only ever *choose between* and
 * *describe* rows the catalogue returned. Products, prices, stock, specs,
 * brands, discounts and delivery claims are never authored by a model.
 */
import type { ListProductsParams, Product, SortKey } from '@/lib/storefront/types';

/**
 * A shopper's request, reduced to something the catalogue can answer.
 *
 * Deliberately a subset of ListProductsParams plus provenance, so handing it
 * to `listProducts()` is a spread rather than a translation layer.
 */
export interface ShoppingIntent {
  /** free-text remainder after structured constraints were lifted out */
  query?: string;
  categoryPath?: string[];
  brandSlugs?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  /** option-value ids resolved against the store's own option index —
   *  "in size 42", "in black". Never an id a model made up. */
  optionValueIds?: string[];
  sort?: SortKey;
  /** what the parser actually recognised — drives the "we understood…" chips */
  recognised: RecognisedConstraint[];
}

export interface RecognisedConstraint {
  kind: 'budget' | 'category' | 'brand' | 'keyword' | 'sort' | 'option';
  /** human-readable, already formatted for display */
  label: string;
}

export function intentToQuery(intent: ShoppingIntent): ListProductsParams {
  const { recognised: _recognised, ...params } = intent;
  return params;
}

/* ────────────────────────────────────────────────────────────────────────
   Tool surface a future engine is expected to be given.
   These map 1:1 onto functions that already exist in
   lib/storefront/catalog.ts, which is the ONLY place the tenant's catalogue
   is read — so tool calls inherit tenant isolation for free.
   ──────────────────────────────────────────────────────────────────────── */
export interface DiscoveryTools {
  searchProducts(params: ListProductsParams): Promise<Product[]>;
  findSimilarProducts(productId: string, limit?: number): Promise<Product[]>;
  getProductDetails(slug: string): Promise<Product | null>;
  compareProducts(ids: string[]): Promise<Product[]>;
  getCategories(): Promise<{ id: string; name: string; path: string[] }[]>;
  getBrands(): Promise<{ id: string; name: string; slug: string }[]>;
  checkInventory(productId: string): Promise<{ inStock: boolean }>;
  getPriceRange(): Promise<{ min: number; max: number; currency: string }>;
}

/** Shape a future `POST /api/storefront/assistant` would stream back. */
export interface DiscoveryAnswer {
  /** the engine's own words — never contains product facts it invented */
  summary: string;
  intent: ShoppingIntent;
  /** ids only; the app re-reads the rows and renders them itself */
  productIds: string[];
}
