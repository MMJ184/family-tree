import { Command as CommandPrimitive, useCommandState } from 'cmdk';
import { Search } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../lib/utils';

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

// 16px, like every other text field (D5): the search term is typed and read
// back. The input draws no outline of its own: it holds focus for as long as
// the popover is open (the caret marks it), and the keyboard's position in the
// list is carried by the active option's outline below (`CommandItem`).
function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center border-b border-border px-3" cmdk-input-wrapper="">
      <Search className="me-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-9 w-full rounded-md bg-transparent py-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  // Rule 5 (CLAUDE.md): 5 rows × 36px, so the 6th is visibly cut off and the
  // scrollbar signals there are more. Baked into the primitive — the same
  // arrangement as `SelectContent` in select.tsx — so it can no longer depend
  // on every future author re-typing `max-h-[180px]` at the call site. `cn` is
  // tailwind-merge, so a call site that genuinely needs a taller list can
  // still pass its own `max-h-*` and win.
  return (
    <CommandPrimitive.List className={cn('max-h-[180px] overflow-x-hidden overflow-y-auto', className)} {...props} />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground" {...props} />;
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn('-mx-1 h-px bg-border', className)} {...props} />;
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        // The active option (`data-selected`, which cmdk moves with the arrow
        // keys and the pointer while DOM focus stays in the input) gets a 1px
        // inset outline in the ring colour on top of the tint — the tint alone
        // is about 1.1:1 against the popover, no cue for a keyboard user
        // (WCAG 1.4.11). `outline-solid` re-arms the style the base
        // `outline-none` set to none.
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected='true']:text-accent-foreground data-[selected='true']:outline-solid data-[selected='true']:outline-1 data-[selected='true']:-outline-offset-1 data-[selected='true']:outline-ring data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  // Re-exported from cmdk so consumers can read the filtered-item count without
  // taking their own direct dependency on cmdk. Only usable INSIDE a <Command>.
  useCommandState,
};
