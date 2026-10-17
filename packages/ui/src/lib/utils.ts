import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The app's one keyboard-focus indicator, for STANDALONE controls (buttons,
 * inputs, triggers, checkboxes, tabs). Compose it with `cn()`:
 *
 *   className={cn('rounded-md px-3 …', focusRing)}
 *
 * Why an outline and not shadcn's `ring-*` box-shadow:
 * - The 2px offset puts the indicator on the SURFACE around the control, not on
 *   the control's own fill. A `ring-ring` with no offset on a primary button
 *   was the button's own colour — 1.00:1, i.e. invisible.
 * - Outlines survive Windows forced-colours mode; box-shadows are dropped.
 * - `--ft-ring` (= the theme primary) is checked against background, card and
 *   popover in both themes and for all six swatches by
 *   `apps/web/scripts/contrast.mjs` (WCAG 2.4.7 / 1.4.11, ≥ 3:1).
 *
 * `outline-solid` is part of the recipe on purpose: Tailwind v4's
 * `outline-2` reads its style from `--tw-outline-style`, which a base
 * `outline-none` on the same element sets to `none` — without it, any element
 * that also carries `outline-none` would silently lose the indicator.
 *
 * Never pair it with `focus-visible:outline-none`, `ring-1` or a half-opacity
 * `ring-ring/50`: each one removes or halves the contrast this exists for.
 */
export const focusRing =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The same indicator drawn INSIDE the element's box: rows, segments of a
 * segmented control, list items, and anything that sits inside an
 * `overflow-hidden` container, where an outset outline would be clipped or
 * would paint over the neighbouring segment.
 */
export const focusRingInset =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
