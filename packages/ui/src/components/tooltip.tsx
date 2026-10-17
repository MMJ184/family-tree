import { Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '../lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * REFINE §2.1. Neutral inverse (`bg-foreground text-background`) in both
 * themes rather than the primary: a tooltip is never a call to action, and the
 * old `bg-primary` at 12px measured 2.43:1. 14px, normal weight, wraps at
 * `max-w-xs` and never truncates (`break-words` keeps a long code or number
 * inside the bubble rather than clipping it). Fade only.
 *
 * Defaults callers rarely need to override: `side="top"` (Radix's default),
 * `sideOffset={4}`, `collisionPadding={8}`. Inside a scroll container pass
 * `hideWhenDetached` so a bubble does not float over a row that has scrolled
 * out of view.
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        'z-50 max-w-xs break-words rounded-md bg-foreground px-2.5 py-1.5 text-sm font-normal leading-snug text-pretty text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
