import { cn, focusRing, focusRingInset } from '@family-tree/ui';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  Dna,
  Droplets,
  Hexagon,
  Hourglass,
  Lamp,
  Layers3,
  type LucideIcon,
  Mountain,
  Orbit,
  Sparkles,
  Sprout,
  TrainFront,
  TreeDeciduous,
  TreePalm,
  Trees,
  Waves,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudioState } from '../engine.ts';
import type { StudioModel } from '../model.ts';
import { SCENES, type SceneKey } from '../scenes/types.ts';
import { toolClass } from './parts.tsx';

// The scene rail: bottom start, above the timeline, clear of the camera bar (top) and the person
// panel (end side). On stages with room for it (see ui/layout.ts) a 14rem column; otherwise a strip
// of scene chips above the timeline. Either way it folds into one pill that shows the current scene.
// The engine measures whichever is shown and frames the scene beside it.

const SCENE_ICONS: Record<SceneKey, LucideIcon> = {
  tree: TreeDeciduous,
  bonsai: Sprout,
  helix: Dna,
  lantern: Lamp,
  metro: TrainFront,
  paper: BookOpen,
  terrain: Mountain,
  banyan: Trees,
  delta: Droplets,
  palm: TreePalm,
  galaxy: Orbit,
  river: Waves,
  hour: Hourglass,
  city: Building2,
  mandala: Hexagon,
  sky: Sparkles,
  glass: Layers3,
};

interface SceneRailProps {
  model: StudioModel;
  state: StudioState;
  open: boolean;
  /** The technical stats (frame rate, quality, draw calls) are shown. */
  details: boolean;
  reduced: boolean;
  layout: 'column' | 'strip';
  /** Height limit of the column, px. */
  maxHeight: number;
  /** The person panel covers the rail (narrow stages while someone is selected), so it steps aside. */
  covered: boolean;
  onOpen(open: boolean): void;
  onDetails(open: boolean): void;
  onPick(key: SceneKey): void;
}

export function SceneRail({
  model,
  state,
  open,
  details,
  reduced,
  layout,
  maxHeight,
  covered,
  onOpen,
  onDetails,
  onPick,
}: SceneRailProps) {
  const { t } = useTranslation('studio');
  const listId = useId();
  const navRef = useRef<HTMLElement>(null);
  // Keep the current scene in sight in the scrolling list (or the strip), also when the list is resized.
  useEffect(() => {
    const nav = navRef.current;
    if (!open || !nav) return;
    let first = true;
    const reveal = () => {
      const on = nav.querySelector(`[data-scene="${state.scene}"]`);
      if (!on) return;
      const n = nav.getBoundingClientRect();
      const b = on.getBoundingClientRect();
      // The column fades out its last 1.5rem, so an item there counts as hidden.
      const bottom = n.bottom - (layout === 'column' && nav.scrollHeight > nav.clientHeight ? 24 : 0);
      const top = b.top < n.top ? b.top - n.top - 8 : b.bottom > bottom ? b.bottom - bottom : 0;
      const left = b.left < n.left ? b.left - n.left - 8 : b.right > n.right ? b.right - n.right + 8 : 0;
      if (top || left) nav.scrollBy({ top, left, behavior: reduced || first ? 'auto' : 'smooth' });
      first = false;
    };
    reveal();
    const ro = new ResizeObserver(reveal);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [open, state.scene, reduced, layout]);
  const column = layout === 'column';
  // After folding or unfolding, focus moves to the control that undoes it (it mounts in place of the other).
  const refocus = useRef(false);
  const toggleRef = useCallback((el: HTMLButtonElement | null) => {
    if (!el || !refocus.current) return;
    refocus.current = false;
    el.focus({ preventScroll: true });
  }, []);
  const toggle = () => {
    refocus.current = true;
    onOpen(!open);
  };
  const appear = {
    initial: reduced ? false : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.16, ease: 'easeOut' },
  } as const;
  const Current = SCENE_ICONS[state.scene];
  const current = t(`scenes.${state.scene}.name`);

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-[4.75rem] z-10 flex',
        column || !open ? 'start-3' : 'inset-x-3',
        covered && 'invisible',
      )}
    >
      {open ? (
        <motion.div
          key={layout}
          {...appear}
          // The column stops short of the camera bar above it; only the scene list shrinks and
          // scrolls, so the header and footer always show.
          style={{ maxHeight: column ? maxHeight : 'none' }}
          className={cn(
            'glass pointer-events-auto flex gap-1 rounded-2xl p-1.5 shadow-lg',
            column ? 'w-56 flex-col overflow-hidden' : 'w-full min-w-0 items-center',
          )}
        >
          {/* Header on the column; on the strip only the fold button, at the end. */}
          <div className={cn('flex shrink-0 items-center', column ? 'justify-between ps-2.5' : 'order-last')}>
            {column && <h2 className="font-medium text-muted-foreground text-xs">{t('rail.title')}</h2>}
            <button
              ref={toggleRef}
              type="button"
              onClick={toggle}
              aria-expanded
              aria-controls={listId}
              aria-label={t('rail.collapse')}
              title={t('rail.collapse')}
              className={cn(toolClass(), column ? 'size-7 pointer-coarse:size-9' : 'size-10')}
            >
              <ChevronDown aria-hidden />
            </button>
          </div>
          <nav
            ref={navRef}
            id={listId}
            aria-label={t('scenesLabel')}
            className={cn(
              'flex gap-0.5',
              column
                ? 'max-h-[22rem] min-h-0 flex-initial flex-col overflow-y-auto overflow-x-hidden pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] [scrollbar-width:thin]'
                : 'min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]',
            )}
          >
            {SCENES.map((key) => {
              const Icon = SCENE_ICONS[key];
              const on = state.scene === key;
              return (
                <button
                  key={key}
                  type="button"
                  data-scene={key}
                  aria-pressed={on}
                  title={on && key === 'hour' ? t('hourBack') : t(`scenes.${key}.desc`)}
                  onClick={() => onPick(key)}
                  className={cn(
                    'group flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-start transition-colors',
                    column ? 'py-1.5' : 'py-2.5',
                    focusRingInset,
                    on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-accent',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      !on && 'text-muted-foreground transition-colors group-hover:text-foreground',
                    )}
                    aria-hidden
                  />
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate font-semibold text-sm">{t(`scenes.${key}.name`)}</span>
                    {column && (
                      <small
                        className={cn(
                          'truncate text-[11px] [@media(max-height:760px)]:hidden',
                          on ? 'text-primary-foreground/75' : 'text-muted-foreground',
                        )}
                      >
                        {t(`scenes.${key}.desc`)}
                      </small>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
          {column && <RailFooter model={model} state={state} details={details} onDetails={onDetails} />}
        </motion.div>
      ) : (
        <motion.button
          key="closed"
          {...appear}
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={t('rail.expand', { name: current })}
          title={t('rail.expand', { name: current })}
          className={cn(
            'glass pointer-events-auto flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full ps-3 pe-2.5 shadow-lg transition-colors hover:bg-accent',
            focusRing,
          )}
        >
          <Current className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate font-semibold text-sm">{current}</span>
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </motion.button>
      )}
    </div>
  );
}

/** Who is alive in the shown year and the timeline legend; the technical stats fold away under "Details". */
function RailFooter({
  model,
  state,
  details,
  onDetails,
}: {
  model: StudioModel;
  state: StudioState;
  details: boolean;
  onDetails(open: boolean): void;
}) {
  const { t } = useTranslation('studio');
  const statsId = useId();
  const alive = useMemo(
    () => model.people.filter((p) => p.born <= state.year && !(p.died != null && p.died <= state.year)).length,
    [model, state.year],
  );
  const stats: Array<[string, string]> = [
    [t('hud.fps'), t('hud.fpsValue', { n: state.fps })],
    [t('hud.quality'), t(`hud.q${state.quality}`)],
    [t('hud.people'), String(model.n)],
    [t('hud.draws'), String(state.calls)],
  ];
  return (
    <div className="grid shrink-0 gap-1.5 border-border border-t px-2.5 pt-2 pb-0.5 text-muted-foreground text-xs">
      <p className="font-semibold text-foreground tabular-nums">{t('alive', { count: alive, year: state.year })}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        <li className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2 rounded-sm bg-primary" aria-hidden />
          {t('births')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2 rounded-sm bg-muted-foreground/60" aria-hidden />
          {t('deaths')}
        </li>
      </ul>
      <button
        type="button"
        onClick={() => onDetails(!details)}
        aria-expanded={details}
        aria-controls={details ? statsId : undefined}
        className={cn(
          '-ms-1 flex w-fit items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:text-foreground',
          focusRing,
        )}
      >
        {t('hud.details')}
        <ChevronDown className={cn('size-3.5 transition-transform', details && 'rotate-180')} aria-hidden />
      </button>
      {details && (
        <table id={statsId} className="w-full tabular-nums">
          <tbody>
            {stats.map(([label, value]) => (
              <tr key={label}>
                <th scope="row" className="py-px text-start font-normal">
                  {label}
                </th>
                <td className="py-px text-end font-medium text-foreground">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
