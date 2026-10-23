import { branchOf } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import { Maximize, Move } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { usePrefs } from '#/lib/prefs.ts';
import { createGraph2D } from './graph2d.ts';
import { buildStore, type GraphStore, visibleData } from './model.ts';
import { readPalette, setPhotoListener } from './paint.ts';
import type { GraphHandle, ViewCtl } from './types.ts';

type Mode = '2d' | '3d';

/**
 * Obsidian-style force graph of the family: photo cards linked by parent-child
 * (solid), marriage (dashed gold) and business (dotted) links. 2D on canvas
 * (force-graph), 3D on three.js (3d-force-graph).
 */
export function FamilyGraphView({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t, i18n } = useTranslation('graph');
  const lang = i18n.language;
  const theme = usePrefs((s) => s.theme);
  const [mode, setMode] = useState<Mode>('2d');
  const [pan, setPan] = useState(false);
  const [handle, setHandle] = useState<GraphHandle | null>(null);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const boxRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const handleRef = useRef<GraphHandle | null>(null);
  handleRef.current = handle;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const prevStore = useRef<GraphStore | null>(null);
  const store = useMemo(() => {
    const s = buildStore(graph, prevStore.current);
    prevStore.current = s;
    return s;
  }, [graph]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const ctlRef = useRef<ViewCtl | null>(null);
  ctlRef.current ??= {
    pal: readPalette(),
    lang,
    year,
    selectedId,
    hoverId: null,
    store,
    labels: { marriedIn: t('marriedIn'), since: t('since') },
    nb: new Map(),
    rev: 0,
    onSelect: (id) => onSelectRef.current(id),
    onSettled: () => {
      // Re-fit (the whole graph, or the selected person's branch) once the layout has spread out, unless the viewer took over.
      if (userMoved.current) return;
      const id = selectedRef.current;
      if (id) handleRef.current?.focus(id, branchOf(graphRef.current, id));
      else handleRef.current?.fit(600);
    },
  };
  const ctl = ctlRef.current;

  // System theme changes matter when the app follows the OS ("auto").
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Mount the graph for the current mode; 3D is loaded on demand.
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let cancelled = false;
    let h: GraphHandle | null = null;
    userMoved.current = false;
    const took = () => {
      userMoved.current = true;
    };
    el.addEventListener('pointerdown', took);
    el.addEventListener('wheel', took, { passive: true });
    const start = (make: (el: HTMLElement, ctl: ViewCtl) => GraphHandle) => {
      if (cancelled) return;
      try {
        h = make(el, ctl);
      } catch {
        toast.error(tRef.current('noWebgl'));
        setMode('2d');
        return;
      }
      const r = el.getBoundingClientRect();
      h.resize(r.width, r.height);
      setHandle(h);
    };
    if (mode === '2d') start(createGraph2D);
    else
      import('./graph3d.ts').then(
        (m) => start(m.createGraph3D),
        () => {
          toast.error(tRef.current('noWebgl'));
          setMode('2d');
        },
      );
    const ro = new ResizeObserver(([e]) => e && h?.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    // Fit once the layout has settled, or fly to the selected person.
    const timer = setTimeout(
      () => {
        const id = selectedRef.current;
        if (id) h?.focus(id, branchOf(graphRef.current, id));
        else h?.fit();
      },
      mode === '2d' ? 1600 : 1800,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ro.disconnect();
      el.removeEventListener('pointerdown', took);
      el.removeEventListener('wheel', took);
      h?.destroy();
      setHandle(null);
    };
  }, [mode, ctl]);

  // Data for the chosen year. A new instance or a rebuilt store always gets a full reload.
  const sent = useRef<{ handle: GraphHandle | null; store: GraphStore | null }>({ handle: null, store: null });
  useEffect(() => {
    if (!handle) return;
    const d = visibleData(store, year);
    ctl.store = store;
    ctl.year = year;
    ctl.nb = d.nb;
    const newStore = sent.current.handle === handle && sent.current.store !== store;
    handle.setData(d, sent.current.handle !== handle || sent.current.store !== store);
    sent.current = { handle, store };
    handle.refresh();
    if (!newStore) return;
    // Another family (or edited data): fit again once it has spread out.
    userMoved.current = false;
    const timer = setTimeout(() => {
      const id = selectedRef.current;
      if (id) handle.focus(id, branchOf(graphRef.current, id));
      else handle.fit();
    }, 1600);
    return () => clearTimeout(timer);
  }, [handle, store, year, ctl]);

  // Colours and language.
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme and systemDark are triggers; the palette is read from the DOM.
  useEffect(() => {
    ctl.pal = readPalette();
    ctl.lang = lang;
    ctl.labels = { marriedIn: t('marriedIn'), since: t('since') };
    handle?.refresh();
  }, [handle, theme, systemDark, lang, t, ctl]);

  // Repaint cached 3D textures once web fonts and photos have loaded.
  useEffect(() => {
    let alive = true;
    const bump = () => {
      if (!alive) return;
      ctl.rev += 1;
      handle?.refresh();
    };
    void document.fonts?.ready.then(bump);
    setPhotoListener(bump);
    return () => {
      alive = false;
      setPhotoListener(null);
    };
  }, [handle, ctl]);

  // 3D drag mode: turn (default) or move.
  useEffect(() => {
    handle?.setPan?.(pan);
  }, [handle, pan]);

  // Selection: highlight and fly to the person.
  useEffect(() => {
    ctl.selectedId = selectedId;
    if (!handle) return;
    handle.refresh();
    if (selectedId) handle.focus(selectedId, branchOf(graphRef.current, selectedId));
  }, [handle, selectedId, ctl]);

  return (
    <div className="relative size-full overflow-hidden" style={BG}>
      <div ref={boxRef} className="absolute inset-0" />

      <div className="glass absolute start-3 top-16 z-10 flex items-center gap-0.5 rounded-full p-1 shadow-lg">
        <fieldset className="flex gap-0.5" aria-label={t('modeLabel')}>
          {(['2d', '3d'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              title={t(`modeHint.${m}`)}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                mode === m
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </fieldset>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => handle?.fit(500)}
          title={t('fit')}
          aria-label={t('fit')}
          className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
        {mode === '3d' && (
          <button
            type="button"
            aria-pressed={pan}
            onClick={() => setPan((v) => !v)}
            title={t('pan')}
            aria-label={t('pan')}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-colors',
              pan
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Move className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <ul className="glass pointer-events-none absolute start-3 bottom-24 z-10 hidden gap-3 rounded-full px-3 py-1.5 text-xs text-muted-foreground shadow-lg sm:flex">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-muted-foreground/60" aria-hidden />
          {t('legend.parentChild')}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed border-gold" aria-hidden />
          {t('legend.marriage')}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dotted border-gold/70" aria-hidden />
          {t('legend.business')}
        </li>
      </ul>
    </div>
  );
}

// Soft canvas gradient with a faint dot grid, like the prototype's stage.
const BG = {
  background:
    'radial-gradient(color-mix(in srgb, var(--ft-muted-foreground) 22%, transparent) 1px, transparent 1.2px) 0 0 / 22px 22px, var(--ft-canvas)',
} as const;
