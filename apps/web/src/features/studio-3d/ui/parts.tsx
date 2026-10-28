import { cn, focusRing, focusRingInset } from '@family-tree/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

// Shared pieces of the studio's glass controls: one icon-button recipe, dividers, key caps,
// a popover drawn inside the stage (so it still shows in full screen, where portals to <body>
// are hidden) and per-viewer flags in localStorage.

/** Reads a per-viewer on/off choice; storage can be missing or blocked (private mode, previews). */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // per-viewer convenience only
  }
}

/**
 * The round icon button every studio bar uses. Quiet neutral at rest; a toggle that is on keeps a
 * neutral fill and turns its icon primary. `aria-disabled` dims it but keeps it focusable, so its
 * title still explains why. The caller sets the size.
 */
export function toolClass(on = false) {
  return cn(
    'grid shrink-0 place-items-center rounded-full transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
    on ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    'aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
    focusRing,
  );
}

/** A hairline between groups of controls. */
export function Divider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('shrink-0 bg-border', className)} />;
}

/** A key cap, as in "press F". */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-border bg-background/50 px-1.5 font-sans font-medium text-[11px] text-muted-foreground leading-none">
      {children}
    </kbd>
  );
}

interface StagePopoverProps {
  id: string;
  open: boolean;
  /** Accessible name of the panel. */
  label: string;
  reduced: boolean;
  /** The button that opens it: focus returns there when the panel closes, and pressing it is not an outside press. */
  trigger: RefObject<HTMLButtonElement | null>;
  /** Where focus goes instead when the button is not shown. */
  fallback: RefObject<HTMLElement | null>;
  /** Height limit in px; longer content scrolls inside the panel. */
  maxHeight: number;
  onClose(): void;
  className?: string;
  children: ReactNode;
}

/**
 * A small non-modal panel next to a studio bar. Render it as a sibling of the bar, not inside it:
 * a glass element inside another glass element cannot blur the scene behind both. Its surface is
 * more opaque than the bars, so small text stays readable over the rail and the scene.
 * It closes on Escape, on a press outside it and when keyboard focus leaves it.
 */
export function StagePopover({
  id,
  open,
  label,
  reduced,
  trigger,
  fallback,
  maxHeight,
  onClose,
  className,
  children,
}: StagePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Keyboard users land on the first choice (or on the panel itself when it has none).
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>('button:not([aria-disabled="true"])');
    (first ?? panel)?.focus({ preventScroll: true });
  }, [open]);

  // Closing with focus inside (Escape, or a shortcut key) hands focus back to the button, or to the
  // stage when the button is not shown, instead of dropping it on the page. The closing panel is
  // still in the page here (it fades out).
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || !ref.current?.contains(document.activeElement)) return;
    const button = trigger.current;
    (button?.offsetParent ? button : fallback.current)?.focus({ preventScroll: true });
  }, [open, trigger, fallback]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target && (ref.current?.contains(target) || trigger.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onClose, trigger]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          style={{ maxHeight }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          onBlur={(e) => {
            const next = e.relatedTarget;
            // Moving to an ancestor means a press on something that takes no focus (Safari and Firefox
            // on macOS focus the nearest focusable ancestor, here the stage, instead of the button
            // pressed): presses are handled above, so only keyboard moves close the panel here.
            if (!next || ref.current?.contains(next) || trigger.current?.contains(next)) return;
            if (ref.current && next.contains(ref.current)) return;
            onClose();
          }}
          className={cn(
            'glass absolute z-30 overflow-y-auto overscroll-contain rounded-2xl bg-popover/90 p-1.5 shadow-xl outline-none [scrollbar-width:thin]',
            focusRingInset,
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
