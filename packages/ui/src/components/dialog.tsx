import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useUiLabels } from '../lib/labels';
import { useReturnFocus } from '../lib/return-focus';
import { cn, focusRing } from '../lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

function DialogOverlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
}

function DialogContent({
  className,
  children,
  hideClose,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  // Focus back to the opener on close, Trigger or not (see useReturnFocus).
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  const labels = useUiLabels();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={returnFocus.onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        className={cn(
          // `bg-popover`: in dark mode an overlay sits one lightness step above
          // the card (#0f1117 < #1a1d23 < #23272f), so a dialog opened over a
          // card reads as raised; it keeps its border too. `rounded-xl` is the
          // overlay radius (cards are rounded-lg, panels rounded-md).
          'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl',
          'max-h-[85vh] overflow-y-auto',
          // Fade only — no zoom or slide on a data screen (REFINE §2.10).
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              // Full-strength muted text, not `opacity-70` (2.76:1): the X is
              // the only visible way out of a dialog for a pointer user.
              'absolute end-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground',
              focusRing,
            )}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{labels.close}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border px-6 py-4', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-border px-6 py-4', className)} {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-base font-semibold text-foreground', className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-0.5 text-sm text-muted-foreground', className)} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
