'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

/** Questions and answers, one open at a time. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible className="divide-y border-y">
      {items.map((item) => (
        <AccordionItem key={item.q} value={item.q} className="border-b-0">
          <AccordionTrigger className="py-5 text-[15px] font-medium text-foreground">{item.q}</AccordionTrigger>
          <AccordionContent className="pb-5 pr-8 text-[15px] leading-relaxed">{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
