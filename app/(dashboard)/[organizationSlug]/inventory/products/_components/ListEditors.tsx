'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function HighlightsEditor({
  value,
  onChange,
  max = 8,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Highlight ${i + 1}`}
            placeholder="e.g. 100% organic cotton"
            value={item}
            maxLength={120}
            disabled={disabled}
            onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
          />
          {!disabled && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove highlight ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="text-muted-foreground" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && value.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ''])}>
          <Plus className="size-3.5" />
          Add highlight
        </Button>
      )}
    </div>
  );
}

export type Spec = { label: string; value: string };

export function SpecsEditor({ value, onChange, disabled }: { value: Spec[]; onChange: (value: Spec[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="hidden grid-cols-[1fr_1.5fr_auto] gap-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Name</span>
          <span>Value</span>
          <span className="w-7" />
        </div>
      )}
      {value.map((spec, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
          <Input
            aria-label={`Specification ${i + 1} name`}
            placeholder="e.g. Material"
            value={spec.label}
            maxLength={60}
            disabled={disabled}
            onChange={(e) => onChange(value.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)))}
          />
          <Input
            aria-label={`Specification ${i + 1} value`}
            placeholder="e.g. Solid oak"
            value={spec.value}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange(value.map((s, j) => (j === i ? { ...s, value: e.target.value } : s)))}
          />
          {!disabled ? (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove specification ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 className="text-muted-foreground" />
            </Button>
          ) : (
            <span className="w-7" />
          )}
        </div>
      ))}
      {!disabled && value.length < 30 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { label: '', value: '' }])}>
          <Plus className="size-3.5" />
          Add specification
        </Button>
      )}
    </div>
  );
}
