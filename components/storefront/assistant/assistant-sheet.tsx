'use client';

/*
 * The assistant's host: one sheet, mounted once by the storefront providers,
 * opened from wherever the shopper happens to be.
 *
 * There is deliberately NO floating bubble (§16/§26). A launcher appears
 * where it is relevant — on a product, on an empty search, in the bag — and
 * nowhere else, so the assistant never sits on top of the shop.
 *
 * Full width on a phone (a conversation needs the screen), a contained side
 * panel from `sm` up. Focus trapping, restore-on-close and Escape come from
 * the Radix dialog behind <SheetRoot>, which is the same primitive the
 * mini-cart uses.
 */
import { Sparkles } from 'lucide-react';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useAssistantStore } from '@/lib/storefront/stores/assistant-store';
import { AssistantPanel } from './assistant-panel';

export function AssistantSheet() {
  const open = useAssistantStore((s) => s.open);
  const seed = useAssistantStore((s) => s.seed);
  const close = useAssistantStore((s) => s.closePanel);

  if (!seed) return null;

  return (
    <SheetRoot open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="right"
        /* p-0 because the panel owns its own scrolling regions; the sheet is
         * just the frame. */
        className="safe-top w-full p-0 sm:max-w-lg"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-teal" />
            Shopping assistant
          </SheetTitle>
          <SheetDescription>
            {seed.productName
              ? `Answers about the ${seed.productName}, from its listing and reviews.`
              : 'Answers from this store’s products, prices and reviews.'}
          </SheetDescription>
        </SheetHeader>

        <AssistantPanel />
      </SheetContent>
    </SheetRoot>
  );
}
