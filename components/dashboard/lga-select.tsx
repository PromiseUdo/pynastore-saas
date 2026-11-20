'use client';

/*
 * Choose one of a state's LGAs (ROADMAP 25.1), searchable by the LGA or a
 * well-known place in it. Value is the LGA's name as lib/geo/nigeria-lgas.ts
 * spells it ('' when none is chosen); empty and disabled until there's a state.
 */
import * as React from 'react';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { lgaOptions } from '@/lib/geo/nigeria-lgas';

export function LgaSelect({
  id,
  state,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id?: string;
  state: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const options = React.useMemo(() => lgaOptions(state), [state]);
  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      placeholder={state ? 'Choose an LGA' : 'Choose a state first'}
      noun="LGAs"
      invalid={invalid}
      disabled={disabled || !state}
    />
  );
}
