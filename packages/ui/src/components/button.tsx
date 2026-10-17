import { cva, type VariantProps } from 'class-variance-authority';
import { Slot as SlotPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn, focusRing } from '../lib/utils';

// `aria-disabled` is the state-based block (a `DisabledReason` tooltip, an
// `IconButton disabledReason`): the button must stay focusable and hoverable
// so the reason can be read, so it gets the disabled LOOK without
// `pointer-events-none` — the caller swallows the click. Real `disabled` (an
// in-flight mutation) keeps `pointer-events-none`.
const buttonVariants = cva(
  cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        // `border-border`, not `border-input`: `--ft-input` is the darker FIELD
        // boundary (≥ 3:1, WCAG 1.4.11), and an outline button is not a field.
        // The two tokens were the same value until that darkening, so this
        // keeps the button exactly as it rendered before.
        //
        // `bg-transparent`, not `bg-background`: in dark mode the page
        // background (#0f1117) is DARKER than the card (#1a1d23) and the
        // popover (#23272f), so a background-filled outline button read as a
        // hole cut in every dark card and dialog (REFINE §2.9, elevation by
        // lightness). The border carries the boundary.
        //
        // `text-foreground` on outline and ghost: a `<Button asChild>` around
        // a `<Link>`/`<a>` otherwise inherits the base-layer
        // `a { color: var(--ft-primary) }` (apps/web/src/styles.css) and turns
        // teal beside its `<button>` siblings. A caller's own text colour
        // (`text-destructive-text`, `text-muted-foreground`) still wins — `cn`
        // is twMerge, and the caller's class comes last.
        outline:
          'border border-border bg-transparent text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? SlotPrimitive.Slot : 'button';
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export type { ButtonProps };
export { Button, buttonVariants };
