import { cn } from '@family-tree/ui';
import MindElixir, { type MindElixirInstance, type NodeObj, type Theme } from 'mind-elixir';
import 'mind-elixir/style.css';
import './mindmap.css';
import { Maximize } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { isDark, usePrefs } from '#/lib/prefs.ts';
import { type BuiltMind, familyMind, type MindLabels, type MindMeta, personMind } from './build.ts';

type Mode = 'family' | 'person';

// Branch colours for the main branches (from the accepted prototype).
const PALETTE = [
  '#2f9e91',
  '#c98a2b',
  '#8e72d8',
  '#d0627f',
  '#3e8ed0',
  '#7da23b',
  '#cf7440',
  '#5b6cd8',
  '#c05bb2',
  '#8a96a3',
];

function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (k: string) => s.getPropertyValue(k).trim();
  return {
    name: 'Family',
    type: isDark() ? 'dark' : 'light',
    palette: PALETTE,
    cssVar: {
      '--root-color': v('--ft-primary-foreground'),
      '--root-bgcolor': v('--ft-primary'),
      '--root-border-color': 'transparent',
      '--root-radius': '16px',
      '--main-radius': '12px',
      '--main-color': v('--ft-foreground'),
      '--main-bgcolor': v('--ft-card'),
      '--main-bgcolor-transparent': v('--ft-glass'),
      '--main-border': `1px solid ${v('--ft-border')}`,
      '--color': v('--ft-foreground'),
      '--bgcolor': 'transparent',
      '--selected': v('--ft-primary'),
      '--accent-color': v('--ft-gold'),
      '--panel-color': v('--ft-foreground'),
      '--panel-bgcolor': v('--ft-card'),
      '--panel-border-color': v('--ft-border'),
      '--topic-padding': '4px 8px',
    },
  };
}

/**
 * XMind-style mind map (Mind Elixir, SIDE layout), read-only. "Whole family"
 * branches from the founders through every generation; "Selected person" maps
 * one person's relatives. Branch order is mirrored in Arabic (spec decision #10).
 */
export function FamilyMindMap({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t, i18n } = useTranslation('mindmap');
  const lang = i18n.language;
  const rtl = lang === 'ar';
  const theme = usePrefs((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [mode, setMode] = useState<Mode>('family');
  const elRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<MindElixirInstance | null>(null);
  const builtRef = useRef<BuiltMind | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const rtlRef = useRef(rtl);
  rtlRef.current = rtl;

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Mount once.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const me = new MindElixir({
      el,
      direction: MindElixir.SIDE,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      allowUndo: false,
      theme: readTheme(),
    });
    me.init({ nodeData: { id: 'loading', topic: '' } });
    me.bus.addListener('selectNodes', (nodes: NodeObj[]) => {
      const id = (nodes[0]?.metadata as MindMeta | undefined)?.personId;
      if (id && id !== selectedRef.current) setTimeout(() => onSelectRef.current(id), 0);
    });
    meRef.current = me;
    return () => {
      me.destroy();
      meRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: theme and systemDark change the muted colour read from the DOM.
  const labels = useMemo<MindLabels>(() => {
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--ft-muted-foreground').trim();
    return { t: (k, o) => (o ? t(k, o) : t(k)), lang, rtl, mutedColor: muted };
  }, [t, lang, rtl, theme, systemDark]);

  // Only the person map depends on who is selected.
  const personKey = mode === 'person' ? selectedId : null;
  const built = useMemo(
    () =>
      mode === 'family' || !personKey ? familyMind(graph, year, labels) : personMind(graph, personKey, year, labels),
    [mode, personKey, graph, year, labels],
  );

  // Fit when the kind of map changes, not on every year tick.
  const fitKey = `${mode}|${personKey ?? ''}|${lang}`;
  const lastFit = useRef('');
  useEffect(() => {
    const me = meRef.current;
    if (!me) return;
    builtRef.current = built;
    me.refresh({ nodeData: built.root });
    highlight(me, built, selectedRef.current);
    if (lastFit.current !== fitKey) {
      // Wait for layout and web fonts, which change the topic sizes.
      const timer = setTimeout(() => {
        lastFit.current = fitKey;
        const refit = () => {
          if (meRef.current !== me) return;
          const sel = selectedRef.current;
          // The whole-family map zooms to the selected person's branch; the person map is already about them.
          const el = sel && mode === 'family' ? highlight(me, built, sel) : null;
          fitMap(me, !!sel, rtlRef.current, el ? branchTopics(el) : undefined);
        };
        refit();
        void document.fonts?.ready.then(refit);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [built, fitKey, mode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: theme and systemDark are triggers; colours are read from the DOM.
  useEffect(() => {
    const me = meRef.current;
    if (!me) return;
    me.changeTheme(readTheme());
    if (builtRef.current) highlight(me, builtRef.current, selectedRef.current);
  }, [theme, systemDark]);

  // Highlight the selected person and zoom to their branch (parent, spouses, descendants).
  useEffect(() => {
    const me = meRef.current;
    const b = builtRef.current;
    if (!me || !b) return;
    const el = highlight(me, b, selectedId);
    if (el && mode === 'family') fitMap(me, true, rtlRef.current, branchTopics(el));
  }, [selectedId, mode]);

  const pickHint = mode === 'person' && !selectedId;

  return (
    <div className="relative size-full overflow-hidden" style={BG}>
      {/* Mind Elixir forces position: relative on its element, so size it rather than pin it. */}
      <div ref={elRef} className="ft-mindmap size-full" data-rtl={rtl} />

      <div className="glass absolute start-3 top-16 z-10 flex items-center gap-0.5 rounded-full p-1 shadow-lg">
        <fieldset className="flex gap-0.5" aria-label={t('modeLabel')}>
          {(['family', 'person'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
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
          onClick={() => meRef.current && fitMap(meRef.current, !!selectedId, rtl)}
          title={t('fit')}
          aria-label={t('fit')}
          className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
      </div>

      {pickHint && (
        <p className="glass absolute start-3 top-28 z-10 max-w-64 rounded-xl px-3 py-2 text-sm text-muted-foreground shadow-lg">
          {t('pickPerson')}
        </p>
      )}
    </div>
  );
}

/** Marks the selected person's first node; returns it. */
function highlight(me: MindElixirInstance, b: BuiltMind, personId: string | null): HTMLElement | null {
  const root = me.el as HTMLElement | undefined;
  for (const el of root?.querySelectorAll('.ft-selected') ?? []) el.classList.remove('ft-selected');
  const uid = personId ? b.firstNode.get(personId) : undefined;
  if (!uid || !root) return null;
  const el = root.querySelector<HTMLElement>(`[data-nodeid="me${uid}"]`);
  el?.classList.add('ft-selected');
  return el;
}

/**
 * The topics of a person's branch in the map: their own topic and everything
 * under it (spouse branches, children, grandchildren). The parent topic is left
 * out because in a sideways map it usually sits far away, at the root.
 */
function branchTopics(tpc: HTMLElement): Element[] {
  const wrapper = tpc.closest('me-wrapper');
  return wrapper ? [...wrapper.querySelectorAll('me-tpc')] : [tpc];
}

/**
 * Fits the whole map (or just `topics`) between the floating toolbar and the year slider (never above
 * 100%), leaving room for the person panel at the end side when it is open.
 */
function fitMap(me: MindElixirInstance, panelOpen: boolean, rtl: boolean, topics?: Element[]) {
  const full = (me.el as HTMLElement).getBoundingClientRect();
  const panel = panelOpen && full.width >= 768 ? Math.min(352, full.width - 24) + 12 : 0;
  const host = { left: full.left + (rtl ? panel : 0), top: full.top, width: full.width - panel, height: full.height };
  const box = () => {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const e of topics ?? (me.el as HTMLElement).querySelectorAll('me-tpc')) {
      const r = e.getBoundingClientRect();
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };
  let b = box();
  if (!(b.w > 0)) return;
  const top = 110;
  const bottom = 100;
  const k = Math.min(
    topics ? 1.2 : 1,
    me.scaleVal * Math.min((host.width - 48) / b.w, (host.height - top - bottom) / b.h),
  );
  me.scale(Math.max(0.2, k));
  b = box();
  me.move(
    host.left + host.width / 2 - (b.x0 + b.x1) / 2,
    host.top + top + (host.height - top - bottom) / 2 - (b.y0 + b.y1) / 2,
  );
}

// Same soft canvas as the graph view, with a faint dot grid.
const BG = {
  background:
    'radial-gradient(color-mix(in srgb, var(--ft-muted-foreground) 22%, transparent) 1px, transparent 1.2px) 0 0 / 22px 22px, var(--ft-canvas)',
} as const;
