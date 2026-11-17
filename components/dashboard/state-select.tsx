'use client';

/*
 * Choose one of Nigeria's states (and the FCT), searchable — 37 names are too
 * many to scroll through in a plain dropdown. Value is the state's name, as
 * stored everywhere else ('' when none is chosen).
 */
import * as React from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { NIGERIAN_STATES } from '@/lib/geo/nigeria';

const STATE_OPTIONS: SearchableOption[] = NIGERIAN_STATES.map((s) => ({ value: s, label: s }));

export function StateSelect({
  id,
  value,
  onChange,
  placeholder = 'Choose a state',
  noneLabel,
  invalid,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** offer an explicit "no state" choice with this label, e.g. "Not set" */
  noneLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const options = React.useMemo(
    () => (noneLabel ? [{ value: null, label: noneLabel }, ...STATE_OPTIONS] : STATE_OPTIONS),
    [noneLabel],
  );
  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      placeholder={placeholder}
      noun="states"
      invalid={invalid}
      disabled={disabled}
    />
  );
}
