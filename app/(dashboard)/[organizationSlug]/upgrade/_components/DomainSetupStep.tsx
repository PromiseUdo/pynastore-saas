'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { Loader2, Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { searchDomain } from '@/features/domains/actions';
import { formatNaira } from '@/lib/billing/format';
import type { DomainChoiceInput } from '@/lib/billing/checkout';
import { PLATFORM_NAME } from '@/lib/brand';

type DomainOption = 'FREE' | 'EXISTING' | 'REGISTER';

export type DomainSummary = { label: string; priceNgn: number };

type DomainSetupStepProps = {
  orgSlug: string;
  rootDomain: string;
  onContinue: (choice: DomainChoiceInput, summary: DomainSummary) => void;
  onBack: () => void;
  /** false when reached from Settings -> Billing for an org that already has a domain set up — nothing to "keep free" here. */
  showFreeOption?: boolean;
};

export function DomainSetupStep({
  orgSlug,
  rootDomain,
  onContinue,
  onBack,
  showFreeOption = true,
}: DomainSetupStepProps) {
  const [option, setOption] = React.useState<DomainOption>(showFreeOption ? 'FREE' : 'EXISTING');
  const [existingDomain, setExistingDomain] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResult, setSearchResult] = React.useState<
    { domain: string; available: false } | { domain: string; available: true; priceUsd: number; priceNgn: number } | null
  >(null);
  const [selectedDomain, setSelectedDomain] = React.useState<{ domain: string; priceNgn: number } | null>(null);
  const [isSearching, startSearchTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleSearch() {
    if (!searchQuery.trim()) return;
    setError(null);
    setSearchResult(null);
    setSelectedDomain(null);
    startSearchTransition(async () => {
      const result = await searchDomain(searchQuery);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSearchResult(result.data);
    });
  }

  function handleContinue() {
    setError(null);

    if (option === 'FREE') {
      onContinue({ type: 'FREE' }, { label: `${orgSlug}.${rootDomain}`, priceNgn: 0 });
      return;
    }

    if (option === 'EXISTING') {
      const domain = existingDomain.trim();
      if (!domain) {
        setError('Enter the domain you own.');
        return;
      }
      onContinue({ type: 'EXISTING', domain }, { label: domain, priceNgn: 0 });
      return;
    }

    if (!selectedDomain) {
      setError('Search for and select a domain first.');
      return;
    }
    onContinue(
      { type: 'REGISTER', domain: selectedDomain.domain },
      { label: selectedDomain.domain, priceNgn: selectedDomain.priceNgn },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          How would you like to set up your domain?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Custom Domain Support — keep your free workspace domain, connect one you already
          own, or register a new one.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {showFreeOption && (
          <OptionCard
            selected={option === 'FREE'}
            onClick={() => setOption('FREE')}
            title={`Keep my free ${PLATFORM_NAME} domain`}
            description={`${orgSlug}.${rootDomain} · shop-${orgSlug}.${rootDomain}`}
            price="No additional cost"
          />
        )}

        <OptionCard
          selected={option === 'EXISTING'}
          onClick={() => setOption('EXISTING')}
          title="Connect a domain I already own"
          description="We'll reach out with DNS instructions after payment — no domain fee."
          price="No additional cost"
        >
          {option === 'EXISTING' && (
            <Input
              className="mt-3"
              placeholder="yourcompany.com"
              value={existingDomain}
              onChange={(e) => setExistingDomain(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </OptionCard>

        <OptionCard
          selected={option === 'REGISTER'}
          onClick={() => setOption('REGISTER')}
          title="Register a new domain"
          description="Search availability and pricing."
          price={null}
        >
          {option === 'REGISTER' && (
            <div className="mt-3 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-2">
                <Input
                  placeholder="yourcompany.com"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={isSearching} variant="outline" type="button">
                  {isSearching ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                </Button>
              </div>

              {searchResult && !searchResult.available && (
                <p className="text-sm text-muted-foreground">{searchResult.domain} is already taken.</p>
              )}

              {searchResult && searchResult.available && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDomain({ domain: searchResult.domain, priceNgn: searchResult.priceNgn })
                  }
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors',
                    selectedDomain?.domain === searchResult.domain
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {selectedDomain?.domain === searchResult.domain && (
                      <Check className="size-3.5 text-primary" />
                    )}
                    <span className="font-medium text-foreground">{searchResult.domain}</span>
                    <Badge variant="success">Available</Badge>
                  </span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatNaira(searchResult.priceNgn)}/year
                  </span>
                </button>
              )}
            </div>
          )}
        </OptionCard>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleContinue}>Continue</Button>
      </div>
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  title,
  description,
  price,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  price: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className={cn(
        'cursor-pointer rounded-lg border p-4 transition-colors',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {price && (
          <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {price}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
