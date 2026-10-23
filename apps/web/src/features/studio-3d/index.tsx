import { Button, cn } from '@family-tree/ui';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Box,
  Building2,
  Crosshair,
  Dna,
  Droplets,
  Expand,
  Hourglass,
  Lamp,
  Layers3,
  Mountain,
  Move,
  Orbit,
  Pause,
  Play,
  Rotate3d,
  Scan,
  Shrink,
  Sparkles,
  Sprout,
  TrainFront,
  TreeDeciduous,
  TreePalm,
  Trees,
  Waves,
  X,
} from 'lucide-react';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { personName, personYears } from '#/lib/display.ts';
import { isDark, usePrefs } from '#/lib/prefs.ts';
import { type GlSupport, probeWebGL, Studio, type StudioState, type StudioText } from './engine.ts';
import { buildModel, type StudioModel } from './model.ts';
import { NOW } from './palette.ts';
import { SCENES, type SceneKey } from './scenes/types.ts';

// The 3D studio view: the accepted three.js prototype (docs/prototypes/tree-3d-studio.html)
// mounted into the tree route. The engine is plain three.js (engine.ts and scenes/); this
// component owns the glass UI around it (scene rail, timeline) and the WebGL fallback.

const SCENE_ICONS: Record<SceneKey, ComponentType<{ className?: string }>> = {
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
  mandala: Sparkles,
  sky: Sparkles,
  glass: Layers3,
};

const SCENE_KEY = 'ft:studio:scene';

function savedScene(): SceneKey {
  try {
    const v = localStorage.getItem(SCENE_KEY);
    return (SCENES as readonly string[]).includes(v ?? '') ? (v as SceneKey) : 'tree';
  } catch {
    return 'tree';
  }
}

function saveScene(key: SceneKey) {
  try {
    localStorage.setItem(SCENE_KEY, key);
  } catch {
    // per-viewer convenience only
  }
}

/** Follows the app's theme, including the OS setting while the theme is "auto". */
function useDark(): boolean {
  const theme = usePrefs((s) => s.theme);
  const [dark, setDark] = useState(() => isDark(theme));
  useEffect(() => {
    setDark(isDark(theme));
    if (theme !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(isDark(theme));
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  return dark;
}

/**
 * The studio model, rebuilt only when the family data actually changes. Every API response
 * is a fresh deep copy, so the graph's identity changes on each refetch even when nothing did;
 * comparing a content signature keeps the same model (and the running engine) in that case.
 */
function useStudioModel(graph: TreeViewProps['graph']): StudioModel | null {
  const sig = useMemo(() => JSON.stringify(graph), [graph]);
  const cache = useRef<{ sig: string; model: StudioModel | null } | null>(null);
  if (cache.current?.sig !== sig) cache.current = { sig, model: buildModel(graph) };
  return cache.current.model;
}

function useReducedMotion(): boolean {
  return useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);
}

export function Studio3D({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t, i18n } = useTranslation('studio');
  const lang = i18n.language;
  const dark = useDark();
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const model = useStudioModel(graph);
  const hasModel = model !== null;
  const minYear = useMemo(() => (model ? Math.min(1900, model.minYear - 2) : 1900), [model]);
  const [support, setSupport] = useState<GlSupport>(() => probeWebGL());
  const [forced, setForced] = useState(false);
  const canRun = support === 'ok' || (support === 'weak' && forced);
  const [slowHidden, setSlowHidden] = useState(false);
  const [state, setState] = useState<StudioState>(() => ({
    scene: savedScene(),
    year: year ?? NOW,
    playing: false,
    follow: true,
    spin: !reduced,
    pan: false,
    quality: 2,
    fps: 60,
    calls: 0,
    weak: false,
  }));
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Studio | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const text = useMemo<StudioText>(
    () => ({
      name: (p) => personName(p.person, lang),
      years: (p) => personYears(p.person),
      role: (p) => (p.marriedIn ? t('marriedIn') : t('generation', { n: p.gen + 1 })),
    }),
    [lang, t],
  );
  // Values the engine is created with; later changes go through its setters.
  const latest = useRef({ model, minYear, lang, dark, text, selectedId, year: state.year, scene: state.scene });
  latest.current = { model, minYear, lang, dark, text, selectedId, year: state.year, scene: state.scene };

  // The engine (renderer, WebGL context) lives as long as the stage is shown; data changes
  // are loaded into it in place below.
  useEffect(() => {
    const host = stageRef.current;
    const l = latest.current;
    if (!host || !hasModel || !l.model || !canRun) return;
    let engine: Studio;
    try {
      engine = new Studio({
        container: host,
        model: l.model,
        lang: l.lang,
        dark: l.dark,
        year: l.year,
        minYear: l.minYear,
        scene: l.scene,
        selectedId: l.selectedId,
        reduced,
        text: l.text,
        onSelect: (id) => onSelectRef.current(id),
        onState: (patch) => setState((s) => ({ ...s, ...patch })),
      });
    } catch {
      setSupport('none');
      return;
    }
    engineRef.current = engine;
    // A new engine starts with drag-to-turn, so the Move button must too.
    setState((s) => (s.pan ? { ...s, pan: false } : s));
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [hasModel, canRun, reduced]);

  useEffect(() => {
    if (model) engineRef.current?.loadData(model, minYear);
  }, [model, minYear]);

  useEffect(() => engineRef.current?.select(selectedId), [selectedId]);
  useEffect(() => engineRef.current?.setLang(lang, text), [lang, text]);
  useEffect(() => engineRef.current?.setDark(dark), [dark]);
  const yearProp = useRef(year);
  useEffect(() => {
    if (year === yearProp.current) return;
    yearProp.current = year;
    engineRef.current?.setYear(year ?? NOW);
  }, [year]);
  useEffect(() => saveScene(state.scene), [state.scene]);

  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void wrapRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const open2d = useCallback(() => {
    void navigate({ to: '.', search: (s: Record<string, unknown>) => ({ ...s, view: 'tree' }) } as never);
  }, [navigate]);

  const pickScene = (key: SceneKey) => {
    const e = engineRef.current;
    if (!e) return;
    if (key !== state.scene) e.setScene(key);
    else if (key === 'hour') e.recentreHourglass();
  };

  if (!model) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <p className="glass max-w-sm rounded-2xl p-6 text-center text-muted-foreground shadow-lg">{t('empty')}</p>
      </div>
    );
  }

  if (!canRun) {
    const weak = support === 'weak';
    return (
      <div className="grid h-full place-items-center bg-[image:var(--ft-canvas)] p-6">
        <div className="glass grid max-w-md justify-items-center gap-3 rounded-2xl p-6 text-center shadow-lg">
          <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
            <Box className="size-6" aria-hidden />
          </span>
          <h2 className="font-display text-xl font-bold">{t(weak ? 'weak.title' : 'noGL.title')}</h2>
          <p className="text-sm text-muted-foreground">{t(weak ? 'weak.body' : 'noGL.body')}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button onClick={open2d}>{t('open2d')}</Button>
            {weak && (
              <Button variant="outline" onClick={() => setForced(true)}>
                {t('weak.tryAnyway')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-background">
      <div ref={stageRef} className="absolute inset-0" />

      <SceneRail model={model} state={state} onPick={pickScene} />

      <Timeline
        model={model}
        min={minYear}
        state={state}
        dark={dark}
        full={full}
        onYear={(y) => {
          engineRef.current?.setPlaying(false);
          engineRef.current?.setYear(y);
        }}
        onPlay={() => engineRef.current?.togglePlay()}
        onFollow={() => engineRef.current?.setFollow(!state.follow)}
        onSpin={() => engineRef.current?.setSpin(!state.spin)}
        onPan={() => engineRef.current?.setPan(!state.pan)}
        onFit={() => engineRef.current?.fit()}
        onFull={toggleFull}
      />

      <AnimatePresence>
        {state.weak && !slowHidden && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass absolute inset-x-3 bottom-[5.5rem] z-20 mx-auto flex max-w-lg items-center gap-3 rounded-2xl p-3 text-sm shadow-lg"
            role="status"
          >
            <p className="min-w-0 flex-1">{t('slow')}</p>
            <Button size="sm" onClick={open2d}>
              {t('open2d')}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => setSlowHidden(true)}
              aria-label={t('dismiss')}
            >
              <X className="size-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SceneRail({
  model,
  state,
  onPick,
}: {
  model: StudioModel;
  state: StudioState;
  onPick: (k: SceneKey) => void;
}) {
  const { t } = useTranslation('studio');
  const alive = useMemo(
    () => model.people.filter((p) => p.born <= state.year && !(p.died != null && p.died <= state.year)).length,
    [model, state.year],
  );
  return (
    // Bottom-start, above the timeline: clear of the route toolbar (top) and the person panel (end side).
    <div className="pointer-events-none absolute inset-x-3 bottom-[4.75rem] z-10 flex md:inset-x-auto md:start-3">
      <div className="glass pointer-events-auto flex max-w-full flex-col gap-1 rounded-2xl p-1.5 shadow-lg md:w-56">
        <nav
          aria-label={t('scenesLabel')}
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] md:max-h-[max(9rem,min(23rem,calc(100vh-24rem)))] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:pb-6 md:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)] md:[scrollbar-width:thin]"
        >
          {SCENES.map((key) => {
            const Icon = SCENE_ICONS[key];
            const on = state.scene === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                title={on && key === 'hour' ? t('hourBack') : t(`scenes.${key}.desc`)}
                onClick={() => onPick(key)}
                className={cn(
                  'group flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-start transition-colors',
                  on ? 'bg-primary text-primary-foreground shadow' : 'text-foreground hover:bg-accent',
                )}
              >
                <Icon className={cn('size-4 shrink-0', on ? 'opacity-100' : 'text-primary')} aria-hidden />
                <span className="grid min-w-0 leading-tight">
                  <span className="truncate text-sm font-semibold">{t(`scenes.${key}.name`)}</span>
                  <small
                    className={cn(
                      'hidden truncate text-[11px] md:block [@media(max-height:760px)]:hidden',
                      on ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {t(`scenes.${key}.desc`)}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="hidden gap-0.5 border-t border-border px-2.5 pt-1.5 pb-0.5 text-[11.5px] text-muted-foreground tabular-nums md:grid">
          <div>
            <b className="font-semibold text-foreground">{t('alive', { count: alive, year: state.year })}</b>
          </div>
          <div>
            <b className="font-medium text-foreground">{state.fps}</b> {t('hud.fps')} ·{' '}
            <span className="rounded bg-accent px-1.5 text-accent-foreground">
              {t('hud.quality')}: {t(`hud.q${state.quality}`)}
            </span>
          </div>
          <div>
            <b className="font-medium text-foreground">{model.n}</b> {t('hud.people')} ·{' '}
            <b className="font-medium text-foreground">{state.calls}</b> {t('hud.draws')}
          </div>
          <div className="flex flex-wrap gap-x-3">
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block size-2 rounded-sm bg-primary" aria-hidden />
              {t('births')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block size-2 rounded-sm bg-muted-foreground/60" aria-hidden />
              {t('deaths')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  onFit(): void;
  onFull(): void;
}

function Timeline({
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
  onFit,
  onFull,
}: TimelineProps) {
  const { t } = useTranslation('studio');
  const tool = (on: boolean | undefined) =>
    cn('size-9 shrink-0 rounded-full', on ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground');
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
      <section
        aria-label={t('timeline')}
        className="glass pointer-events-auto flex items-center gap-2 rounded-2xl px-2 py-1.5 shadow-lg sm:gap-3 sm:px-3"
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
          <Button
            size="icon"
            variant="ghost"
            className={cn(tool(state.follow), 'hidden sm:inline-flex')}
            aria-pressed={state.follow}
            aria-label={t('follow')}
            title={t('follow')}
            onClick={onFollow}
          >
            <Crosshair className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={tool(state.spin)}
            aria-pressed={state.spin}
            aria-label={t('spin')}
            title={t('spin')}
            onClick={onSpin}
          >
            <Rotate3d className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={tool(state.pan)}
            aria-pressed={state.pan}
            aria-label={t('pan')}
            title={t('pan')}
            onClick={onPan}
          >
            <Move className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={tool(false)}
            aria-label={t('fit')}
            title={t('fit')}
            onClick={onFit}
          >
            <Scan className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn(tool(full), 'hidden sm:inline-flex')}
            aria-label={full ? t('exitFullscreen') : t('fullscreen')}
            title={full ? t('exitFullscreen') : t('fullscreen')}
            onClick={onFull}
          >
            {full ? <Shrink className="size-4" /> : <Expand className="size-4" />}
          </Button>
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
      const bw = r.width / nb;
      g.clearRect(0, 0, r.width, r.height);
      for (let i = 0; i < nb; i++) {
        const hb = ((b[i] ?? 0) / mx) * (r.height * 0.62);
        const hd = ((d[i] ?? 0) / mx) * (r.height * 0.32);
        g.fillStyle = cs.getPropertyValue('--ft-primary').trim() || (dark ? '#4fd1bd' : '#0f6b63');
        g.fillRect(i * bw, r.height * 0.66 - hb, Math.max(1, bw - 0.6), hb);
        g.fillStyle = cs.getPropertyValue('--ft-muted-foreground').trim() || (dark ? '#9fb0ac' : '#5d6664');
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
