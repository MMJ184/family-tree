import { Button, cn } from '@family-tree/ui';
import { Crosshair, Expand, Moon, Move, Pause, Play, Rotate3d, Shrink, Sun } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudioState } from '../engine.ts';
import type { StudioModel } from '../model.ts';
import { NOW } from '../palette.ts';
import { Divider, toolClass } from './parts.tsx';

// The timeline bar along the bottom: play, births and deaths per year over the year slider, the
// year, then the motion toggles (follow, auto-rotate, move mode) and the presentation pair
// (theme, full screen). The app's top bar is hidden in full screen, so the theme switch lives here too.

interface TimelineProps {
  model: StudioModel;
  min: number;
  state: StudioState;
  dark: boolean;
  full: boolean;
  onYear(y: number): void;
  onPlay(): void;
  onFollow(): void;
  onSpin(): void;
  onPan(): void;
  onTheme(): void;
  onFull(): void;
}

export function Timeline({
  model,
  min,
  state,
  dark,
  full,
  onYear,
  onPlay,
  onFollow,
  onSpin,
  onPan,
  onTheme,
  onFull,
}: TimelineProps) {
  const { t } = useTranslation('studio');
  const tool = (on = false) => cn(toolClass(on), 'size-10 sm:size-9');
  const themeLabel = dark ? t('theme.light') : t('theme.dark');
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
      <section
        aria-label={t('timeline')}
        className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1.5 ps-1.5 pe-2 shadow-lg sm:gap-3 sm:pe-3"
      >
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-full shadow"
          onClick={onPlay}
          aria-label={state.playing ? t('pause') : t('play')}
          title={state.playing ? t('pause') : t('play')}
        >
          {state.playing ? <Pause className="size-4" /> : <Play className="size-4 rtl:-scale-x-100" />}
        </Button>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <History model={model} min={min} dark={dark} />
          <input
            type="range"
            min={min}
            max={NOW}
            step={1}
            value={state.year}
            onChange={(e) => onYear(Number(e.target.value))}
            aria-label={t('year')}
            className="h-1.5 w-full cursor-pointer accent-[var(--ft-primary)]"
          />
        </div>
        <output className="ltr-isolate w-[4.2ch] shrink-0 text-center font-semibold text-xl tabular-nums sm:text-2xl">
          {state.year}
        </output>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={cn(tool(state.follow), 'hidden sm:grid')}
            aria-pressed={state.follow}
            aria-label={t('follow')}
            title={t('follow')}
            onClick={onFollow}
          >
            <Crosshair aria-hidden />
          </button>
          <button
            type="button"
            className={tool(state.spin)}
            aria-pressed={state.spin}
            aria-label={t('spin')}
            title={t('spin')}
            onClick={onSpin}
          >
            <Rotate3d aria-hidden />
          </button>
          <button
            type="button"
            className={tool(state.pan)}
            aria-pressed={state.pan}
            aria-label={t('pan')}
            title={t('pan')}
            onClick={onPan}
          >
            <Move aria-hidden />
          </button>
          {/* Phones keep the app's own theme switch in the top bar and have no full screen. */}
          <Divider className="mx-1 hidden h-5 w-px sm:block" />
          <button
            type="button"
            className={cn(tool(), 'hidden sm:grid')}
            aria-label={themeLabel}
            title={themeLabel}
            onClick={onTheme}
          >
            {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </button>
          <button
            type="button"
            className={cn(tool(full), 'hidden sm:grid')}
            aria-label={full ? t('exitFullscreen') : t('fullscreen')}
            title={full ? t('exitFullscreen') : t('fullscreen')}
            onClick={onFull}
          >
            {full ? <Shrink aria-hidden /> : <Expand aria-hidden />}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Births (up) and deaths (down) per year above the slider. Mirrored in Arabic like the range input. */
function History({ model, min, dark }: { model: StudioModel; min: number; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(devicePixelRatio, 2);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const nb = NOW - min + 1;
      const b = new Array<number>(nb).fill(0);
      const d = new Array<number>(nb).fill(0);
      for (const p of model.people) {
        if (p.born >= min && p.born <= NOW) b[p.born - min] = (b[p.born - min] ?? 0) + 1;
        if (p.died != null && p.died >= min && p.died <= NOW) d[p.died - min] = (d[p.died - min] ?? 0) + 1;
      }
      const mx = Math.max(1, ...b, ...d);
      const cs = getComputedStyle(document.documentElement);
      const births = cs.getPropertyValue('--ft-primary').trim() || (dark ? '#4fd1bd' : '#0f6b63');
      const deaths = cs.getPropertyValue('--ft-muted-foreground').trim() || (dark ? '#a3a3a3' : '#666666');
      const bw = r.width / nb;
      g.clearRect(0, 0, r.width, r.height);
      for (let i = 0; i < nb; i++) {
        const hb = ((b[i] ?? 0) / mx) * (r.height * 0.62);
        const hd = ((d[i] ?? 0) / mx) * (r.height * 0.32);
        g.fillStyle = births;
        g.fillRect(i * bw, r.height * 0.66 - hb, Math.max(1, bw - 0.6), hb);
        g.fillStyle = deaths;
        g.globalAlpha = 0.6;
        g.fillRect(i * bw, r.height * 0.7, Math.max(1, bw - 0.6), hd);
        g.globalAlpha = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [model, min, dark]);
  return <canvas ref={ref} aria-hidden className="block h-6 w-full rtl:-scale-x-100" />;
}
