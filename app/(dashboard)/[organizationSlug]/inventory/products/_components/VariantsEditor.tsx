'use client';

import * as React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SwitchRoot } from '@/components/ui/switch';
import { FieldError } from '@/components/ui/form-field';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { cloudinaryImage } from '@/lib/cloudinary/url';
import { formatNumber } from '@/lib/format';
import { MAX_OPTIONS, MAX_VARIANTS, guessOptionKind, type OptionKind } from '@/features/inventory/product-rules';
import type { UploadedImage } from '@/components/media/image-uploader';
import { newKey, syncVariants, variantComboCount, type OptionDraft, type VariantDraft } from './product-form-state';

const KIND_LABELS: Record<OptionKind, string> = { color: 'Colour swatches', size: 'Sizes', select: 'Other' };
const NO_IMAGE = '__none__';

type VariantsEditorProps = {
  options: OptionDraft[];
  variants: VariantDraft[];
  parentSku: string;
  basePrice: string;
  images: UploadedImage[];
  errors: { options?: string; variants?: string };
  disabled?: boolean;
  showStock: boolean;
  onChange: (options: OptionDraft[], variants: VariantDraft[]) => void;
};

function ValueInput({ onAdd, disabled, placeholder }: { onAdd: (labels: string[]) => void; disabled?: boolean; placeholder: string }) {
  const [text, setText] = React.useState('');
  function commit() {
    const labels = text.split(',').map((t) => t.trim()).filter(Boolean);
    if (labels.length) onAdd(labels);
    setText('');
  }
  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      className="h-7 min-w-32 flex-1 border-dashed text-xs"
      onChange={(e) => {
        if (e.target.value.includes(',')) {
          const labels = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
          if (labels.length) onAdd(labels);
          setText('');
        } else setText(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
    />
  );
}

export function VariantsEditor({ options, variants, parentSku, basePrice, images, errors, disabled, showStock, onChange }: VariantsEditorProps) {
  const [bulkPrice, setBulkPrice] = React.useState('');

  function setOptions(next: OptionDraft[]) {
    onChange(next, syncVariants(next, variants, parentSku));
  }

  function patchOption(key: string, patch: Partial<OptionDraft>) {
    setOptions(options.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  }

  function patchVariant(key: string, patch: Partial<VariantDraft>) {
    onChange(
      options,
      variants.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    );
  }

  const comboCount = variantComboCount(options);
  const enabledCount = variants.filter((v) => v.enabled).length;
  const swatchFor = (valueKey: string) => options.flatMap((o) => (o.kind === 'color' ? o.values : [])).find((v) => v.key === valueKey)?.swatch;

  return (
    <div className="space-y-5">
      {/* ── Options ─────────────────────────────────────────── */}
      <div className="space-y-3">
        {options.map((option, index) => (
          <div key={option.key} className="rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`opt-${option.key}`}>Option {index + 1}</Label>
                <Input
                  id={`opt-${option.key}`}
                  list="option-name-suggestions"
                  placeholder="e.g. Size"
                  value={option.name}
                  disabled={disabled}
                  onChange={(e) => {
                    const name = e.target.value;
                    // Pick a kind from the name until the user chooses one themselves.
                    const kind = option.values.length === 0 ? guessOptionKind(name) : option.kind;
                    patchOption(option.key, { name, kind });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`kind-${option.key}`}>Shown as</Label>
                <SelectRoot value={option.kind} onValueChange={(v) => patchOption(option.key, { kind: v as OptionKind })} disabled={disabled}>
                  <SelectTrigger id={`kind-${option.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABELS) as OptionKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </div>
              {!disabled && (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove option ${option.name || index + 1}`}
                    onClick={() => setOptions(options.filter((o) => o.key !== option.key))}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                    <span className="sm:sr-only">Remove</span>
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-foreground">Values</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {option.values.map((value) => (
                  <span key={value.key} className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/50 pl-1.5 pr-1 text-xs">
                    {option.kind === 'color' && (
                      <label className="relative flex size-4 cursor-pointer overflow-hidden rounded-full border" title="Pick the swatch colour">
                        <span className="size-full" style={{ background: value.swatch ?? 'transparent' }} />
                        <input
                          type="color"
                          aria-label={`Swatch colour for ${value.label}`}
                          className="absolute inset-0 cursor-pointer opacity-0"
                          value={value.swatch ?? '#888888'}
                          disabled={disabled}
                          onChange={(e) =>
                            patchOption(option.key, { values: option.values.map((v) => (v.key === value.key ? { ...v, swatch: e.target.value } : v)) })
                          }
                        />
                      </label>
                    )}
                    <input
                      aria-label={`Rename ${value.label}`}
                      value={value.label}
                      disabled={disabled}
                      size={Math.max(2, value.label.length)}
                      className="bg-transparent outline-none"
                      onChange={(e) =>
                        patchOption(option.key, { values: option.values.map((v) => (v.key === value.key ? { ...v, label: e.target.value } : v)) })
                      }
                    />
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Remove ${value.label}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => patchOption(option.key, { values: option.values.filter((v) => v.key !== value.key) })}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
                {!disabled && (
                  <ValueInput
                    placeholder={option.values.length ? 'Add another…' : option.kind === 'size' ? 'e.g. S, M, L' : option.kind === 'color' ? 'e.g. Black, White' : 'Type a value, press Enter'}
                    onAdd={(labels) => {
                      const existing = new Set(option.values.map((v) => v.label.toLowerCase()));
                      const fresh = labels.filter((l) => !existing.has(l.toLowerCase()));
                      patchOption(option.key, { values: [...option.values, ...fresh.map((label) => ({ key: newKey(), label }))] });
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        ))}

        <datalist id="option-name-suggestions">
          {['Colour', 'Size', 'Material', 'Style', 'Storage', 'Weight'].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        {!disabled && options.length < MAX_OPTIONS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOptions([...options, { key: newKey(), name: '', kind: 'select', values: [] }])}
          >
            <Plus className="size-3.5" />
            {options.length ? 'Add another option' : 'Add an option, like size or colour'}
          </Button>
        )}
        {errors.options && <FieldError>{errors.options}</FieldError>}
        {comboCount > MAX_VARIANTS && !errors.options && (
          <FieldError>That makes {comboCount} combinations — only the first {MAX_VARIANTS} are shown. Remove some values.</FieldError>
        )}
      </div>

      {/* ── Variants table ─────────────────────────────────── */}
      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {enabledCount} of {variants.length} variant{variants.length === 1 ? '' : 's'} on sale
            </p>
            {!disabled && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(options, variants.map((v) => ({ ...v, enabled: true })))}>
                  Turn all on
                </Button>
                <div className="flex items-center gap-1">
                  <Input
                    aria-label="Price for every variant"
                    placeholder="Price for all"
                    inputMode="decimal"
                    className="h-7 w-28 text-xs"
                    value={bulkPrice}
                    onChange={(e) => setBulkPrice(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!bulkPrice.trim()}
                    onClick={() => {
                      onChange(options, variants.map((v) => ({ ...v, sellingPrice: bulkPrice.trim() })));
                      setBulkPrice('');
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </div>

          <TableWrapper>
            <Table dense>
              <TableHead>
                <TableRow>
                  <TableColumnHeader className="w-12">
                    <span className="sr-only">On sale</span>
                  </TableColumnHeader>
                  <TableColumnHeader>Variant</TableColumnHeader>
                  <TableColumnHeader>Price</TableColumnHeader>
                  <TableColumnHeader>Was</TableColumnHeader>
                  <TableColumnHeader>SKU</TableColumnHeader>
                  <TableColumnHeader>Barcode</TableColumnHeader>
                  {images.length > 0 && <TableColumnHeader>Image</TableColumnHeader>}
                  {showStock && <TableColumnHeader align="right">Available</TableColumnHeader>}
                </TableRow>
              </TableHead>
              <TableBody>
                {variants.map((v) => {
                  const label = Object.values(v.attributes).join(' / ');
                  return (
                    <TableRow key={v.key} className={cn(!v.enabled && 'bg-muted/30')}>
                      <TableCell>
                        <SwitchRoot
                          checked={v.enabled}
                          disabled={disabled}
                          aria-label={`Sell ${label}`}
                          onCheckedChange={(checked) => patchVariant(v.key, { enabled: checked })}
                        />
                      </TableCell>
                      <TableCell className={cn('whitespace-nowrap font-medium', !v.enabled && 'text-muted-foreground')}>
                        <span className="inline-flex items-center gap-1.5">
                          {v.valueKeys.map((k) => swatchFor(k)).filter(Boolean).map((sw, i) => (
                            <span key={i} className="size-3 rounded-full border" style={{ background: sw }} />
                          ))}
                          {label}
                        </span>
                        {v.id && !v.enabled && <span className="block text-[11px] font-normal text-muted-foreground">Removed on save</span>}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Price for ${label}`}
                          inputMode="decimal"
                          className="h-7 w-24 text-xs"
                          placeholder={basePrice || '0'}
                          value={v.sellingPrice}
                          disabled={disabled || !v.enabled}
                          onChange={(e) => patchVariant(v.key, { sellingPrice: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Was price for ${label}`}
                          inputMode="decimal"
                          className="h-7 w-24 text-xs"
                          value={v.compareAtPrice}
                          disabled={disabled || !v.enabled}
                          onChange={(e) => patchVariant(v.key, { compareAtPrice: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`SKU for ${label}`}
                          className="h-7 w-36 font-mono text-xs"
                          value={v.sku}
                          disabled={disabled || !v.enabled}
                          onChange={(e) => patchVariant(v.key, { sku: e.target.value, skuTouched: true })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Barcode for ${label}`}
                          className="h-7 w-32 text-xs"
                          value={v.barcode}
                          disabled={disabled || !v.enabled}
                          onChange={(e) => patchVariant(v.key, { barcode: e.target.value })}
                        />
                      </TableCell>
                      {images.length > 0 && (
                        <TableCell>
                          <SelectRoot
                            value={v.imageUrl && images.some((i) => i.url === v.imageUrl) ? v.imageUrl : NO_IMAGE}
                            onValueChange={(url) => patchVariant(v.key, { imageUrl: url === NO_IMAGE ? null : url })}
                            disabled={disabled || !v.enabled}
                          >
                            <SelectTrigger aria-label={`Image for ${label}`} className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_IMAGE}>Main image</SelectItem>
                              {images.map((img, i) => (
                                <SelectItem key={img.url} value={img.url}>
                                  <span className="inline-flex items-center gap-2">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary thumbnail */}
                                    <img src={cloudinaryImage(img.url, { width: 40, height: 40 })} alt="" className="size-5 rounded object-cover" />
                                    Image {i + 1}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </SelectRoot>
                        </TableCell>
                      )}
                      {showStock && (
                        <TableCell align="right" muted className="tabular-nums">
                          {v.available === undefined ? 'New' : formatNumber(v.available)}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrapper>
          {errors.variants ? (
            <FieldError>{errors.variants}</FieldError>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave a price empty to use the product’s price. Turn off combinations you don’t sell.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
