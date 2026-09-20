'use client';

import * as React from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

const SheetRoot = Dialog.Root;
const SheetTrigger = Dialog.Trigger;
const SheetPortal = Dialog.Portal;
const SheetClose = Dialog.Close;

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof Dialog.Overlay>) {
  return (
    <Dialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  side?: 'right' | 'left';
  /** turn off when the sheet renders its own close control, or it gets two */
  showCloseButton?: boolean;
}) {
  const container = usePortalContainer();
  return (
    <SheetPortal container={container}>
      <SheetOverlay />
      <Dialog.Content
        className={cn(
          'fixed z-50 flex flex-col bg-background shadow-xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          side === 'right' && [
            'inset-y-0 right-0 h-full w-full sm:max-w-140 border-l',
            'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          ],
          side === 'left' && [
            'inset-y-0 left-0 h-full w-full sm:max-w-140 border-r',
            'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          ],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Dialog.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground/70 ring-offset-background transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        )}
      </Dialog.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex shrink-0 flex-col gap-1 border-b px-6 py-4', className)} {...props} />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title className={cn('text-base font-semibold text-foreground', className)} {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

export {
  SheetRoot,
  SheetTrigger,
  SheetPortal,
  SheetOverlay,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
