import type { VariantProps } from 'class-variance-authority';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn, focusRingInset } from '../lib/utils';
import type { toggleVariants } from './toggle';

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: 'default',
  variant: 'default',
});

const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn('flex items-center justify-center gap-1', className)} {...props}>
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));

ToggleGroup.displayName = 'ToggleGroup';

const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);
  const resolvedVariant = context.variant ?? variant ?? 'default';
  const resolvedSize = context.size ?? size ?? 'default';

  // Every ToggleGroup in the app is a segmented control on a `bg-muted/40`
  // track (Clinic Day's status filter is the reference). The old pressed fill,
  // `bg-accent`, is the SAME token as `--ft-muted` in both themes, so on that
  // track the chosen segment measured 1.03:1 (light) and 1.18:1 (dark) against
  // its neighbours — effectively invisible. No fill alone separates on a track
  // this pale, so the pressed segment is carried by several cues at once: a
  // raised card chip with an edge and shadow, full-strength semibold text,
  // against unpressed labels in `text-muted-foreground`. The edge is the FIELD
  // boundary token (`inset-ring-input`, ≥ 3:1 on every surface, contrast.mjs),
  // not the hairline `border`: in dark mode the card chip is darker than the
  // track, and a 1.1:1 hairline left the chosen segment readable only by its
  // text weight (WCAG 1.4.11).
  //
  // Keyboard focus is the INSET outline recipe (`focusRingInset`), drawn
  // inside the segment: the segments sit 2px apart on a padded track, so an
  // outset outline would paint over the neighbouring segment and the track's
  // edge. An outline is a different property from the chip's `inset-ring`
  // (a box-shadow) and is painted above it, so the focus indicator is never
  // replaced by the pressed edge — on the pressed chip it reads as the primary
  // ring over the card (≥ 5.4:1 in both themes, every swatch; checked as
  // "ring on card" in apps/web/scripts/contrast.mjs). The unpressed labels
  // clear 4.5:1 on the track (`bg-muted/40` over the card) after the
  // `--ft-muted-foreground` darkening.
  const baseClasses = cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=on]:inset-ring data-[state=on]:inset-ring-input [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    focusRingInset,
  );

  const variantClasses: Record<string, string> = {
    default: 'bg-transparent rounded-md',
    // `border-border`, as on the outline Button and Toggle: `--ft-input` is
    // now the darker field boundary, and a segment is not a field.
    outline: 'border border-border bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md',
  };

  const sizeClasses: Record<string, string> = {
    default: 'h-9 px-3',
    sm: 'h-8 px-2.5 text-xs',
    lg: 'h-10 px-5',
    icon: 'h-9 w-9',
  };

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        baseClasses,
        variantClasses[resolvedVariant] ?? variantClasses.default,
        sizeClasses[resolvedSize] ?? sizeClasses.default,
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = 'ToggleGroupItem';

export { ToggleGroup, ToggleGroupItem };
