import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useUiLabels } from '../lib/labels';
import { useReturnFocus } from '../lib/return-focus';
import { cn, focusRing } from '../lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

function SheetOverlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

type SheetSide = 'top' | 'right' | 'bottom' | 'left' | 'start' | 'end';

// The slide is spatial information (where the panel came from and where it
// goes back to), so it stays — but only for people who have not asked their
// OS for reduced motion (`motion-safe:`); everyone else gets the panel in
// place at once. The edge is `border-border` explicitly: a bare `border-l` in
// Tailwind v4 is `currentColor`, i.e. a full-strength foreground line.
const sheetSideClasses: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 border-b border-border motion-safe:data-[state=closed]:slide-out-to-top motion-safe:data-[state=open]:slide-in-from-top',
  bottom:
    'inset-x-0 bottom-0 border-t border-border motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:slide-in-from-bottom',
  left: 'inset-y-0 left-0 h-full w-72 border-r border-border motion-safe:data-[state=closed]:slide-out-to-left motion-safe:data-[state=open]:slide-in-from-left',
  right:
    'inset-y-0 right-0 h-full w-80 border-l border-border motion-safe:data-[state=closed]:slide-out-to-right motion-safe:data-[state=open]:slide-in-from-right',
  // Logical sides follow the document direction, so a panel on the reading
  // end in English (right) moves to the left in Arabic.
  start:
    'inset-y-0 start-0 h-full w-72 border-e border-border motion-safe:data-[state=closed]:slide-out-to-start motion-safe:data-[state=open]:slide-in-from-start',
  end: 'inset-y-0 end-0 h-full w-96 max-w-full border-s border-border motion-safe:data-[state=closed]:slide-out-to-end motion-safe:data-[state=open]:slide-in-from-end',
};

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
}

function SheetContent({
  side = 'end',
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  // Focus back to the opener on close, Trigger or not (see useReturnFocus).
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  const labels = useUiLabels();
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={returnFocus.onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        className={cn(
          // `bg-popover`: a sheet is an overlay, one lightness step above the
          // card in dark mode (see dialog.tsx). The slide itself needs
          // `animate-in`/`animate-out` — the side classes only set where it
          // slides from — and both are `motion-safe:` only. 200 ms in, 150 ms
          // out: quick enough not to hold up the desk.
          'fixed z-50 flex flex-col gap-0 bg-popover text-popover-foreground shadow-lg ease-in-out motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:duration-200',
          sheetSideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            // Full-strength muted text, not `opacity-70` (2.76:1).
            'absolute end-4 top-4 rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none',
            focusRing,
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{labels.close}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b border-border px-6 py-4', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-base font-semibold text-foreground', className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetPortal, SheetTitle, SheetTrigger };
