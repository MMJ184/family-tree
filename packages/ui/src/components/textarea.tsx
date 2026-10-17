import type * as React from 'react';

import { cn, focusRing } from '../lib/utils';

// 16px, like Input: notes, advice and other long clinical free text are read
// back line by line (D5). Same field boundary, focus recipe and red
// `aria-invalid` boundary as Input.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-border',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
