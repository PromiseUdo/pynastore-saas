'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

/** Questions and answers, one open at a time. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible className="divide-y overflow-hidden rounded-2xl border bg-card">
      {items.map((item) => (
        <AccordionItem key={item.q} value={item.q} className="border-b-0 px-5 sm:px-6">
          <AccordionTrigger className="py-5 text-base font-semibold text-foreground hover:no-underline">{item.q}</AccordionTrigger>
          <AccordionContent className="pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
