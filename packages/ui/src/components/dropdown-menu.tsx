import { Check } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '../lib/utils';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

// One recipe for every selectable row (Item, RadioItem), so a radio choice
// highlights exactly like an action.
const ITEM_CLASSES = cn(
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors',
  // The highlighted item (keyboard or pointer) gets a 1px inset outline
  // in the ring colour on top of the tint: the tint alone is about 1.1:1
  // against the menu — no cue at all for a keyboard user (WCAG 1.4.11).
  // `outline-solid` re-arms the style the base `outline-none` (which
  // hides the browser's own ring) set to none.
  'data-[highlighted]:bg-muted data-[highlighted]:outline-solid data-[highlighted]:outline-1 data-[highlighted]:-outline-offset-1 data-[highlighted]:outline-ring',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
);

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          // `bg-popover`: overlays sit one lightness step above the card in
          // dark mode (background < card < popover), so a menu opened over a
          // card separates from it. Fade only — no zoom or slide (§2.10).
          'z-50 min-w-[12rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn(ITEM_CLASSES, className)} {...props} />;
}

/**
 * One choice in a `DropdownMenuRadioGroup`: Radix renders it as a
 * `menuitemradio` with `aria-checked`, so the state lives in the role and the
 * tick is only a second channel. The tick sits in a fixed 16px slot at the
 * start of the row, so labels line up whether or not they are chosen.
 */
function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(ITEM_CLASSES, className)} {...props}>
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        // The app's one eyebrow recipe (sidebar sections, card headings): 12px
        // is the floor for any label (DESIGN.md), and 0.16em tracking — sized
        // for the old 10px — spread 12px capitals too far.
        'px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border/60', className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
