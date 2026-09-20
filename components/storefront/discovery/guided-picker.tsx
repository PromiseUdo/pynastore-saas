'use client';

/*
 * "Help me choose" — a guided narrowing flow, deliberately NOT a chat window.
 *
 * Three questions, each of which maps onto a real catalogue parameter:
 *
 *   department → ListProductsParams.categoryPath
 *   priority   → ListProductsParams.sort
 *   budget     → ListProductsParams.maxPrice / minPrice
 *
 * That is the whole point: every answer narrows an actual query, so the
 * options it produces are real rows rather than a model's suggestions. The
 * "priority" step offers orderings the catalogue can genuinely honour (price,
 * rating, popularity, recency) instead of attributes like "battery life" that
 * no product field backs — offering those would mean inventing the data.
 *
 * When the AI engine lands it can pre-fill or replace these steps; the
 * submitted shape is the same ShoppingIntent the parser produces.
 */
import * as React from 'react';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortKey } from '@/lib/storefront/types';
import type { PriceBandOption, RootCategoryOption } from './types';

const PRIORITIES: { id: SortKey; label: string; blurb: string }[] = [
  { id: 'bestselling', label: 'Most popular', blurb: 'What others are buying' },
  { id: 'rating', label: 'Best reviewed', blurb: 'Highest rated first' },
  { id: 'price-asc', label: 'Best value', blurb: 'Lowest price first' },
  { id: 'newest', label: 'Newest', blurb: 'Just landed' },
];

export interface GuidedSelection {
  categoryPath?: string[];
  sort?: SortKey;
  minPrice?: number;
  maxPrice?: number;
  /** for the results heading, e.g. "Electronics · Best value" */
  summary: string;
}

export function GuidedPicker({
  categories,
  priceBands,
  onSubmit,
  onCancel,
}: {
  categories: RootCategoryOption[];
  priceBands: PriceBandOption[];
  onSubmit: (selection: GuidedSelection) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = React.useState(0);
  const [category, setCategory] = React.useState<RootCategoryOption | null>(null);
  const [priority, setPriority] = React.useState<(typeof PRIORITIES)[number] | null>(null);
  const [band, setBand] = React.useState<PriceBandOption | null>(null);

  // Budget is optional, so the flow can finish from step 2 onwards.
  const steps = ['Department', 'What matters', 'Budget'];

  const submit = (chosenBand: PriceBandOption | null) => {
    onSubmit({
      categoryPath: category?.path,
      sort: priority?.id,
      minPrice: chosenBand?.minPrice,
      maxPrice: chosenBand?.maxPrice,
      summary: [category?.name, priority?.label, chosenBand?.label]
        .filter(Boolean)
        .join(' · '),
    });
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 text-left lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-full bg-highlight text-highlight-foreground"
          >
            <Sparkles className="size-4.5" />
          </span>
          <div>
            <h3 className="text-base font-bold">Help me choose</h3>
            <p className="text-xs text-muted-foreground">
              Three questions, then real options from this store.
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 text-sm font-semibold underline underline-offset-4 hover:text-teal"
        >
          Close
        </button>
      </div>

      {/* progress */}
      <ol className="mt-6 flex items-center gap-2" aria-label="Progress">
        {steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i < step ? 'bg-teal' : i === step ? 'bg-brand' : 'bg-border',
              )}
            />
            <span className="sr-only">
              {label} {i === step ? '(current)' : i < step ? '(done)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {step === 0 && (
          <Question title="Which department?">
            {categories.map((c) => (
              <Choice
                key={c.id}
                selected={category?.id === c.id}
                onClick={() => {
                  setCategory(c);
                  setStep(1);
                }}
              >
                {c.name}
                <span className="ml-1.5 text-xs text-muted-foreground">{c.productCount}</span>
              </Choice>
            ))}
          </Question>
        )}

        {step === 1 && (
          <Question title="What matters most?">
            {PRIORITIES.map((p) => (
              <Choice
                key={p.id}
                selected={priority?.id === p.id}
                onClick={() => {
                  setPriority(p);
                  setStep(2);
                }}
              >
                <span className="flex flex-col items-start">
                  <span>{p.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">{p.blurb}</span>
                </span>
              </Choice>
            ))}
          </Question>
        )}

        {step === 2 && (
          <Question title="What's your budget?">
            {priceBands.map((b) => (
              <Choice
                key={b.id}
                selected={band?.id === b.id}
                onClick={() => {
                  setBand(b);
                  submit(b);
                }}
              >
                {b.label}
              </Choice>
            ))}
            <Choice selected={false} onClick={() => submit(null)}>
              No preference
            </Choice>
          </Question>
        )}
      </div>

      <div className="mt-7 flex items-center justify-between gap-4 border-t border-border pt-5">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-teal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        {/* Skipping straight to results is always allowed — a shopper who only
          * wanted to pick a department shouldn't be held hostage by step 3. */}
        {step > 0 && (
          <button
            onClick={() => submit(band)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            <Check className="size-4" />
            Show me options
          </button>
        )}
      </div>
    </div>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-4 text-lg font-bold">{title}</legend>
      <div className="flex flex-wrap gap-2.5">{children}</div>
    </fieldset>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors',
        selected
          ? 'border-brand bg-brand text-primary-foreground'
          : 'border-border hover:border-brand hover:bg-secondary',
      )}
    >
      {children}
    </button>
  );
}
