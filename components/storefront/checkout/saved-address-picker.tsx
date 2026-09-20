'use client';

/*
 * "Deliver to" — the saved addresses a signed-in shopper can choose from.
 *
 * This is the payoff for having an account: the common case becomes reading
 * one card and pressing Continue, instead of filling in eight fields on a
 * phone. So the default address is preselected and the form below it stays
 * hidden until someone actually wants a different address.
 *
 * Real radio inputs, not clickable divs: arrow keys move between options,
 * the labels are labels, and the group announces itself as one choice.
 */
import type { Address } from '@/lib/storefront/types';

export const USE_NEW_ADDRESS = '__new__';

export function SavedAddressPicker({
  addresses,
  selectedId,
  onSelect,
}: {
  addresses: Address[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[0.8125rem] font-semibold">Deliver to</legend>

      <div className="mt-3 space-y-2.5">
        {addresses.map((address) => {
          const checked = selectedId === address.id;
          return (
            <label
              key={address.id}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                checked ? 'border-brand bg-secondary/40' : 'border-border bg-card hover:border-brand/40'
              }`}
            >
              <input
                type="radio"
                name="saved-address"
                value={address.id}
                checked={checked}
                onChange={() => onSelect(address.id)}
                className="mt-1 size-4.5 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {address.fullName}
                  {address.isDefault && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Default
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                </span>
                <span className="block text-muted-foreground">
                  {[address.city, address.state].filter(Boolean).join(', ')}
                </span>
                <span className="block text-muted-foreground">{address.phone}</span>
              </span>
            </label>
          );
        })}

        <label
          className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors ${
            selectedId === USE_NEW_ADDRESS
              ? 'border-brand bg-secondary/40'
              : 'border-border bg-card hover:border-brand/40'
          }`}
        >
          <input
            type="radio"
            name="saved-address"
            value={USE_NEW_ADDRESS}
            checked={selectedId === USE_NEW_ADDRESS}
            onChange={() => onSelect(USE_NEW_ADDRESS)}
            className="size-4.5 shrink-0 accent-[var(--brand)]"
          />
          <span className="text-sm font-medium">Deliver somewhere else</span>
        </label>
      </div>
    </fieldset>
  );
}
