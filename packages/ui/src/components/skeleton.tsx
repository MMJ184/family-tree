import { cn } from '../lib/utils';

// The pulse is decorative, so it stops for anyone whose OS asks for reduced
// motion (`motion-reduce:animate-none`; the global guard in
// apps/web/src/styles.css would also stop it). The bare `animate-pulse` class
// stays on purpose rather than becoming `motion-safe:animate-pulse`: it is the
// hook that dozens of unit tests and the screenshot tool use to find a
// loading placeholder (`.animate-pulse`), and `motion-safe:animate-pulse` is a
// different class token that `.animate-pulse` does not match.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} {...props} />;
}

export { Skeleton };
