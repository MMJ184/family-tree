import * as React from 'react';

import { cn, focusRing } from '../lib/utils';

// `text-base` (16px): typed values are read back by the person entering them
// (D5 — inputs and long clinical free text are 16px; tables and meta stay
// dense). `border-input` is the FIELD boundary, darkened to ≥ 3:1 against
// every surface (WCAG 1.4.11, checked in apps/web/scripts/contrast.mjs).
// `aria-invalid` turns the boundary red by itself (D6), so no caller has to
// remember `border-destructive-border` next to its error text.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-border',
          focusRing,
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
