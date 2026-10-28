import { type RefObject, useLayoutEffect, useState } from 'react';

// Where the studio's controls go on the current stage, measured rather than assumed: the route's
// floating toolbar wraps the person search (and the branch-scope chip) onto more rows on narrow
// stages and in Arabic, and short stages (phones held sideways, small windows) leave little height.

/** The timeline (3.375rem plus its 0.75rem inset) and the gap above it, px from the stage bottom. */
const TIMELINE = 76;
/** Gap below the route toolbar and between stacked controls, px. */
const GAP = 10;
/** The rail becomes a column only with room for its header, a few scenes and its footer beside the scene. */
const COLUMN_MIN_HEIGHT = 220;
const COLUMN_MIN_WIDTH = 600;
/** Before the first measurement: the route toolbar's single row. */
const DEFAULT_TOP = 64;

export interface StageLayout {
  /** Stage size, px. */
  w: number;
  h: number;
  /** Top of the camera bar, px from the stage top. */
  top: number;
  /** The scene rail: a column on the start side, or a strip above the timeline. */
  rail: 'column' | 'strip';
  /** Height limit of the rail column, px. */
  railMax: number;
  /** Height limit of the camera bar's panels, px. */
  popMax: number;
}

/**
 * Measures the stage and the route toolbar items above the camera bar. `bar` is the bar itself (its
 * width and height decide which toolbar items it must clear); `ready` re-runs the measuring once the
 * stage is in the page.
 */
export function useStageLayout(
  stage: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
  full: boolean,
  ready: boolean,
  lang: string,
): StageLayout {
  const [layout, setLayout] = useState<StageLayout>({
    w: 0,
    h: 0,
    top: DEFAULT_TOP,
    rail: 'column',
    railMax: 480,
    popMax: 480,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: lang is a trigger: the toolbar re-wraps when the language changes.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !ready) return;
    // The route's toolbar: the view switcher's row (a sibling of the stage in the route).
    const toolbar = el.parentElement?.querySelector('[role="tablist"]')?.parentElement ?? null;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const s = el.getBoundingClientRect();
      const b = bar.current?.getBoundingClientRect();
      let top = full ? 12 : DEFAULT_TOP;
      if (!full && toolbar && b) {
        // Clear every toolbar item that sits above the bar's horizontal span.
        let bottom = 0;
        for (const item of toolbar.children) {
          const r = item.getBoundingClientRect();
          if (!r.width || !r.height || r.right <= b.left || r.left >= b.right) continue;
          bottom = Math.max(bottom, r.bottom - s.top);
        }
        if (bottom > 0) top = Math.round(bottom + GAP);
      }
      const below = top + (b?.height ?? 42) + GAP;
      const railMax = Math.round(s.height - below - TIMELINE);
      const next: StageLayout = {
        w: Math.round(s.width),
        h: Math.round(s.height),
        top,
        rail: s.width >= COLUMN_MIN_WIDTH && railMax >= COLUMN_MIN_HEIGHT ? 'column' : 'strip',
        railMax,
        popMax: Math.max(120, railMax + 4),
      };
      setLayout((cur) =>
        cur.w === next.w &&
        cur.h === next.h &&
        cur.top === next.top &&
        cur.rail === next.rail &&
        cur.railMax === next.railMax
          ? cur
          : next,
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    if (bar.current) ro.observe(bar.current);
    if (toolbar) ro.observe(toolbar);
    // The branch-scope chip comes and goes inside the toolbar.
    const mo = new MutationObserver(schedule);
    if (toolbar) mo.observe(toolbar, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [stage, bar, full, ready, lang]);

  return layout;
}
