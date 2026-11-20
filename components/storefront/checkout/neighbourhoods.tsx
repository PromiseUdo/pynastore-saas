'use client';

/*
 * "Which part of Surulere?" (ROADMAP 25.2) — asked only when this shop prices
 * by neighbourhood inside the shopper's LGA, from the shop's own list, so the
 * name always matches its delivery zones. "Somewhere else in …" (the empty
 * value) is always there: nobody has to pick a neighbourhood that isn't
 * theirs, and they get the shop's price for the rest of the LGA.
 *
 * The list is asked for once per state and LGA, and remembered for the visit.
 */
import * as React from 'react';
import { deliveryNeighbourhoodsAction } from '@/features/shop-orders/actions';
import { SelectField } from './checkout-fields';

const asked = new Map<string, Promise<string[]>>();

/** `loaded`: the list for this state and LGA has arrived (until then `areas` is empty). */
export function useNeighbourhoods(state: string, lga: string): { areas: string[]; loaded: boolean } {
  const key = state && lga ? `${state}|${lga}` : '';
  const [list, setList] = React.useState<{ key: string; areas: string[] }>({ key: '', areas: [] });

  React.useEffect(() => {
    if (!key) return;
    let current = true;
    if (!asked.has(key)) asked.set(key, deliveryNeighbourhoodsAction({ state, lga }).catch(() => []));
    void asked.get(key)!.then((areas) => {
      if (current) setList({ key, areas });
    });
    return () => {
      current = false;
    };
  }, [key, state, lga]);

  return list.key === key ? { areas: list.areas, loaded: true } : { areas: [], loaded: !key };
}

type NeighbourhoodFieldProps = Omit<React.ComponentProps<typeof SelectField>, 'label' | 'options' | 'placeholder'> & {
  lga: string;
  areas: string[];
};

/** The question itself; render it only when `areas` isn't empty. */
export function NeighbourhoodField({ lga, areas, ...props }: NeighbourhoodFieldProps) {
  return (
    <SelectField
      label={`Which part of ${lga}?`}
      options={[...areas.map((area) => ({ value: area, label: area })), { value: '', label: `Somewhere else in ${lga}` }]}
      hint="This shop’s delivery price depends on your neighbourhood."
      {...props}
    />
  );
}

/** Test seam: forget remembered lists. */
export function forgetNeighbourhoods() {
  asked.clear();
}
