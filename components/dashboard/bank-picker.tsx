'use client';

/*
 * components/dashboard/bank-picker.tsx
 *
 * Choosing a Nigerian bank from Paystack's list (lib/payments/paystack.ts) —
 * used by "Get paid online" (the settlement account) and by the bank-transfer
 * accounts on Settings → Payments. Paystack lists a couple of hundred banks,
 * which a dropdown can't sensibly hold, so the bank is searched for, and shown
 * once chosen.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { SearchPicker, type SearchResult } from '@/components/ui/search-picker';
import type { PaystackBank } from '@/lib/payments/paystack';

/** Paystack's own name for a bank we stored by name — e.g. an account saved before the move. */
export function bankCodeForName(banks: PaystackBank[], name: string | null | undefined): string {
  if (!name) return '';
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = norm(name);
  return banks.find((b) => norm(b.name) === wanted)?.code ?? '';
}

/**
 * Paystack lists a couple of hundred banks, which a dropdown can't sensibly
 * hold — so the bank is searched for, and shown once chosen.
 */
export function BankPicker({
  banks,
  value,
  onChange,
  disabled,
  invalid,
  savedName,
  id = 'settlement-bank',
}: {
  /** the field's id, for its <Label htmlFor> */
  id?: string;
  banks: PaystackBank[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  savedName: string | null;
}) {
  const chosen = banks.find((b) => b.code === value);
  const onSearch = React.useCallback(
    async (query: string): Promise<SearchResult<PaystackBank>> => {
      const q = query.toLowerCase();
      return { success: true, data: banks.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 20) };
    },
    [banks],
  );

  if (value) {
    return (
      <div
        className={`flex h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm ${invalid ? 'border-destructive' : ''}`}
      >
        <span className="truncate text-foreground">{chosen?.name ?? savedName ?? 'Chosen bank'}</span>
        {!disabled && (
          <Button type="button" variant="ghost" size="sm" className="-mr-2" onClick={() => onChange('')}>
            Change
          </Button>
        )}
      </div>
    );
  }

  return (
    <SearchPicker
      id={id}
      label="Bank"
      placeholder="Search for your bank"
      onSearch={onSearch}
      onPick={(bank) => onChange(bank.code)}
      getKey={(bank) => bank.code}
      renderItem={(bank) => <span className="truncate">{bank.name}</span>}
      emptyHint="No bank by that name. Try part of the name, like “Guaranty”."
      disabled={disabled}
    />
  );
}
