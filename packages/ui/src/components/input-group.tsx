import * as React from 'react';
import { cn } from '../lib/utils';

// The group draws the same focus outline as the Input inside it whenever ANY
// descendant has keyboard focus, so a control living in a slot (a password
// reveal, a unit picker) still lights up the whole field. The group box is
// the Input's box (the slots are absolutely positioned), and `rounded-md`
// matches the Input's radius, so when the Input itself is focused the two
// outlines coincide exactly instead of drawing a square ring over a round one.
const InputGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative rounded-md has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
        className,
      )}
      {...props}
    />
  ),
);
InputGroup.displayName = 'InputGroup';

interface InputGroupSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  side: 'left' | 'right';
}

const InputGroupSlot = React.forwardRef<HTMLDivElement, InputGroupSlotProps>(({ className, side, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('absolute inset-y-0 flex items-center', side === 'left' ? 'start-0 ps-3' : 'end-0 pe-3', className)}
    {...props}
  />
));
InputGroupSlot.displayName = 'InputGroupSlot';

export { InputGroup, InputGroupSlot };
