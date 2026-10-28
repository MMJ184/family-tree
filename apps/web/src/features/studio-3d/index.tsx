import { Button, cn, focusRingInset } from '@family-tree/ui';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Box, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { personName, personYears } from '#/lib/display.ts';
import { isDark, usePrefs } from '#/lib/prefs.ts';
import {
  type GlSupport,
  type LabelMode,
  probeWebGL,
  Studio,
  type StudioState,
  type StudioText,
  type ViewPreset,
} from './engine.ts';
import { buildModel, type StudioModel } from './model.ts';
import { NOW } from './palette.ts';
import { SCENES, type SceneKey } from './scenes/types.ts';
import { CameraBar, type StageMenu } from './ui/CameraBar.tsx';
import { isTyping, stageCommand } from './ui/keys.ts';
import { useStageLayout } from './ui/layout.ts';
import { readFlag, writeFlag } from './ui/parts.tsx';
import { SceneRail } from './ui/SceneRail.tsx';
import { Timeline } from './ui/Timeline.tsx';

// The 3D studio view: the accepted three.js prototype (docs/prototypes/tree-3d-studio.html)
// mounted into the tree route. The engine is plain three.js (engine.ts and scenes/); this
// component owns the glass UI around it (camera bar, scene rail, timeline, in ui/), the
// keyboard shortcuts and the WebGL fallback.

const SCENE_KEY = 'ft:studio:scene';
const RAIL_KEY = 'ft:studio:rail';
const DETAILS_KEY = 'ft:studio:details';
/** One press of zoom in moves the camera to this share of its distance; zoom out undoes it. */
const ZOOM_STEP = 0.8;
/** Below this stage width the person panel covers the whole stage (22rem plus insets and a control). */
const PANEL_COVERS = 448;
/** Below this width a rail column and the person panel cannot stand side by side. */
const PANEL_MEETS_COLUMN = 616;

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
  const setTheme = usePrefs((s) => s.setTheme);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const model = useStudioModel(graph);
  const hasModel = model !== null;
  const minYear = useMemo(() => (model ? Math.min(1900, model.minYear - 2) : 1900), [model]);
  const [support, setSupport] = useState<GlSupport>(() => probeWebGL());
  const [forced, setForced] = useState(false);
  const canRun = support === 'ok' || (support === 'weak' && forced);
  const [slowHidden, setSlowHidden] = useState(false);
  const [railOpen, setRailOpen] = useState(() => readFlag(RAIL_KEY, true));
  const [details, setDetails] = useState(() => readFlag(DETAILS_KEY, false));
  const [menu, setMenu] = useState<StageMenu | null>(null);
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
    // The engine reports these once it runs.
    zoom: 0.5,
    labels: 'all',
    rail: true,
  }));
  const wrapRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLFieldSetElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [full, setFull] = useState(false);
  const stage = useStageLayout(wrapRef, barRef, full, canRun && hasModel, lang);
  const engineRef = useRef<Studio | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const menuRef = useRef(menu);
  menuRef.current = menu;
  // On narrow stages the person panel hides the camera bar, and its panels with it.
  const barCovered = selectedId !== null && stage.w < PANEL_COVERS;
  const barCoveredRef = useRef(barCovered);
  barCoveredRef.current = barCovered;

  const text = useMemo<StudioText>(
    () => ({
      name: (p) => personName(p.person, lang),
      years: (p) => personYears(p.person),
      role: (p) => (p.marriedIn ? t('marriedIn') : t('generation', { n: p.gen + 1 })),
    }),
    [lang, t],
  );
  // Values the engine is created with; later changes go through its setters.
  const current = {
    model,
    minYear,
    lang,
    dark,
    text,
    selectedId,
    year: state.year,
    scene: state.scene,
    labels: state.labels,
    rail: railOpen,
  };
  const latest = useRef(current);
  latest.current = current;

  // The engine (renderer, WebGL context) lives as long as the stage is shown; data changes
  // are loaded into it in place below.
  useEffect(() => {
    const host = stageRef.current;
    const l = latest.current;
    const first = l.model;
    if (!host || !hasModel || !first || !canRun) return;
    const start = (scene: SceneKey) =>
      new Studio({
        container: host,
        model: first,
        lang: l.lang,
        dark: l.dark,
        year: l.year,
        minYear: l.minYear,
        scene,
        selectedId: l.selectedId,
        reduced,
        text: l.text,
        onSelect: (id) => onSelectRef.current(id),
        onState: (patch) => setState((s) => ({ ...s, ...patch })),
      });
    let engine: Studio;
    try {
      engine = start(l.scene);
    } catch (e) {
      // A scene that fails to build should not read as "no WebGL": log it and retry on the default scene.
      console.error('3D studio failed to start', e);
      try {
        if (l.scene === 'tree') throw e;
        engine = start('tree');
      } catch {
        setSupport('none');
        return;
      }
    }
    engineRef.current = engine;
    // A new engine starts with its own defaults, so the toggles must too.
    setState((s) =>
      s.pan || s.playing || !s.follow || s.spin === reduced
        ? { ...s, pan: false, playing: false, follow: true, spin: !reduced }
        : s,
    );
    // ...and the viewer's own choices carry over.
    engine.setLabels(l.labels);
    // The engine re-frames by itself when the free area changes (a folded rail included).
    engine.setRail(l.rail);
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
  useEffect(() => {
    writeFlag(RAIL_KEY, railOpen);
    engineRef.current?.setRail(railOpen);
  }, [railOpen]);
  useEffect(() => writeFlag(DETAILS_KEY, details), [details]);

  const cam = useMemo(
    () => ({
      step: (dir: 1 | -1) => engineRef.current?.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      zoom: (z: number) => {
        // Move the slider at once; the engine confirms the value on its next report.
        setState((s) => ({ ...s, zoom: z }));
        engineRef.current?.setZoom(z);
      },
      fitAll: () => engineRef.current?.frameAll(),
      frame: () => engineRef.current?.frameSelection(),
      view: (v: ViewPreset) => engineRef.current?.setView(v),
      labels: (m: LabelMode) => engineRef.current?.setLabels(m),
    }),
    [],
  );

  // Keyboard shortcuts (listed in the help panel). They act while focus is on the stage or one of
  // its controls, or nowhere at all (the studio fills the page), and never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const wrap = wrapRef.current;
      if (!wrap || !engineRef.current || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && target !== document.body && !wrap.contains(target)) return;
      if (isTyping(target)) return;
      const cmd = stageCommand(e);
      // Holding + or − keeps zooming; any other key acts once per press.
      if (!cmd || (e.repeat && cmd.kind !== 'zoom')) return;
      if (cmd.kind === 'clear') {
        if (menuRef.current) setMenu(null);
        else if (selectedRef.current) onSelectRef.current(null);
        else return;
      } else if (cmd.kind === 'help') {
        // The help panel lives in the camera bar: no opening it while the bar is hidden.
        if (barCoveredRef.current) return;
        setMenu((m) => (m === 'help' ? null : 'help'));
      } else if (cmd.kind === 'zoom') cam.step(cmd.dir);
      else if (cmd.kind === 'fitAll') cam.fitAll();
      else if (cmd.kind === 'frame') cam.frame();
      else cam.view(cmd.view);
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cam]);

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
    // A size container: the controls follow the stage's width (@3xl: variants) and height (cqh units),
    // not the window's. Focusable, so clicking the stage gives the keyboard shortcuts a home.
    <section
      ref={wrapRef}
      aria-label={t('stage')}
      aria-describedby={hintId}
      tabIndex={-1}
      className={cn('relative h-full w-full overflow-hidden bg-background [container-type:size]', focusRingInset)}
    >
      <p id={hintId} className="sr-only">
        {t('stageHint')}
      </p>
      <div ref={stageRef} className="absolute inset-0" />

      <CameraBar
        barRef={barRef}
        stageRef={wrapRef}
        top={stage.top}
        popMax={stage.popMax}
        zoom={state.zoom}
        labels={state.labels}
        pan={state.pan}
        selected={selectedId !== null}
        covered={barCovered}
        reduced={reduced}
        menu={menu}
        onMenu={setMenu}
        onZoomStep={cam.step}
        onZoom={cam.zoom}
        onFitAll={cam.fitAll}
        onFrame={cam.frame}
        onView={cam.view}
        onLabels={cam.labels}
      />

      <SceneRail
        model={model}
        state={state}
        open={railOpen}
        details={details}
        reduced={reduced}
        layout={stage.rail}
        maxHeight={stage.railMax}
        covered={
          selectedId !== null && (stage.w < PANEL_COVERS || (stage.rail === 'column' && stage.w < PANEL_MEETS_COLUMN))
        }
        onOpen={setRailOpen}
        onDetails={setDetails}
        onPick={pickScene}
      />

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
        onTheme={() => setTheme(dark ? 'light' : 'dark')}
        onFull={toggleFull}
      />

      <AnimatePresence>
        {state.weak && !slowHidden && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : 8 }}
            className={cn(
              'glass absolute inset-x-3 z-20 mx-auto flex max-w-lg items-center gap-3 rounded-2xl p-3 text-sm shadow-lg',
              // Above the scene strip when it is open there.
              stage.rail === 'strip' && railOpen ? 'bottom-[8.75rem]' : 'bottom-[5.5rem]',
            )}
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
    </section>
  );
}
