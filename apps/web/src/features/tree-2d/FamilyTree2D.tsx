import '@xyflow/react/dist/style.css';
import './tree-2d.css';

import { generations } from '@family-tree/shared';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type Edge,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { motion } from 'framer-motion';
import { ChevronsUpDown, Crosshair, Loader2 } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { personName, personYears } from '#/lib/display.ts';
import { isDark, usePrefs } from '#/lib/prefs.ts';
import { CARD_H, CARD_W, layoutTree, type Point, UNION_SIZE } from './layout.ts';
import {
  buildModel,
  collapsedAncestors,
  collapsedHidden,
  countDescendants,
  hasBusinessBy,
  hasChildren,
  type TreeModel,
  yearHidden,
} from './model.ts';
import { genderColor, nodeTypes, type TreeFlowNode, type TreeNodeContext, TreeNodeCtx } from './nodes.tsx';

/** Width the person panel takes at the end side (route: w-[22rem] plus end-3). */
const PANEL_PX = 352 + 12;

export function FamilyTree2D(props: TreeViewProps) {
  return (
    <ReactFlowProvider>
      <TreeCanvas {...props} />
    </ReactFlowProvider>
  );
}

interface LayoutState {
  model: TreeModel;
  key: string;
  pos: Map<string, Point>;
}

function TreeCanvas({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t, i18n } = useTranslation('tree2d');
  const locale = i18n.language;
  const rtl = locale === 'ar';
  const theme = usePrefs((s) => s.theme);
  const dark = isDark(theme);
  const rf = useReactFlow<TreeFlowNode, Edge>();

  const model = useMemo(() => buildModel(graph), [graph]);
  // Collapse state belongs to one family; a large family opens with its deeper branches folded.
  const familyId = graph.family.id;
  const [collapseState, setCollapseState] = useState<{ familyId: string; set: ReadonlySet<string> } | null>(null);
  const collapsed = useMemo(
    () => (collapseState?.familyId === familyId ? collapseState.set : initialCollapsed(model)),
    [collapseState, familyId, model],
  );
  const setCollapsed = useCallback(
    (update: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) =>
      setCollapseState((prev) => {
        const base = prev?.familyId === familyId ? prev.set : initialCollapsed(model);
        return { familyId, set: typeof update === 'function' ? update(base) : update };
      }),
    [familyId, model],
  );
  const layoutKey = useMemo(() => [...collapsed].sort().join(','), [collapsed]);
  const layoutHidden = useMemo(() => collapsedHidden(model, collapsed), [model, collapsed]);
  const visibility = useMemo(() => yearHidden(model, year, layoutHidden), [model, year, layoutHidden]);

  // ---- Layout (async, cached per collapse state) ----
  const [layout, setLayout] = useState<LayoutState | null>(null);
  const layoutCache = useRef<{ model: TreeModel | null; map: Map<string, Map<string, Point>> }>({
    model: null,
    map: new Map(),
  });
  useEffect(() => {
    const cache = layoutCache.current;
    if (cache.model !== model) {
      cache.model = model;
      cache.map = new Map();
    }
    const hit = cache.map.get(layoutKey);
    if (hit) {
      setLayout({ model, key: layoutKey, pos: hit });
      return;
    }
    let cancelled = false;
    layoutTree(model, layoutHidden)
      .then((pos) => {
        cache.map.set(layoutKey, pos);
        if (!cancelled) setLayout({ model, key: layoutKey, pos });
      })
      .catch((err: unknown) => console.error('tree layout failed', err));
    return () => {
      cancelled = true;
    };
  }, [model, layoutKey, layoutHidden]);
  const arranging = !layout || layout.model !== model || layout.key !== layoutKey;

  // ---- Nodes and edges, reusing objects whose content did not change ----
  const nodeCache = useRef(new Map<string, { sig: string; node: TreeFlowNode }>());
  const edgeCache = useRef(new Map<string, { sig: string; edge: Edge }>());
  const cacheModel = useRef<TreeModel | null>(null);
  if (cacheModel.current !== model) {
    cacheModel.current = model;
    nodeCache.current.clear();
    edgeCache.current.clear();
  }

  const nodes = useMemo<TreeFlowNode[]>(() => {
    if (!layout || layout.model !== model) return [];
    const cache = nodeCache.current;
    const out: TreeFlowNode[] = [];
    for (const [id, pt] of layout.pos) {
      const union = model.unionById.get(id);
      const w = union ? UNION_SIZE : CARD_W;
      const x = rtl ? -pt.x - w : pt.x;
      if (union) {
        const hidden = visibility.unions.has(id);
        const ended = union.status === 'DIVORCED';
        const sig = `${x},${pt.y},${hidden},${union.year},${ended}`;
        const prev = cache.get(id);
        if (prev && prev.sig === sig) {
          out.push(prev.node);
          continue;
        }
        const node: TreeFlowNode = {
          id,
          type: 'union',
          position: { x, y: pt.y },
          width: UNION_SIZE,
          height: UNION_SIZE,
          hidden,
          selectable: false,
          focusable: false,
          data: { year: union.year, ended },
        };
        cache.set(id, { sig, node });
        out.push(node);
        continue;
      }
      const person = model.people.get(id);
      if (!person) continue;
      const hidden = visibility.people.has(id);
      const name = personName(person, locale);
      const years = personYears(person);
      const marriedIn = model.marriedIn.has(id);
      const business = hasBusinessBy(model, id, year);
      const canToggle = hasChildren(model, id);
      const isCollapsed = collapsed.has(id);
      const hiddenCount = isCollapsed ? countDescendants(model, id) : 0;
      const selected = id === selectedId;
      const sig = `${x},${pt.y},${hidden},${name},${years},${marriedIn},${business},${canToggle},${isCollapsed},${hiddenCount},${selected}`;
      const prev = cache.get(id);
      if (prev && prev.sig === sig) {
        out.push(prev.node);
        continue;
      }
      const node: TreeFlowNode = {
        id,
        type: 'person',
        position: { x, y: pt.y },
        width: CARD_W,
        height: CARD_H,
        hidden,
        selected,
        ariaLabel: `${name} ${years}`,
        data: { person, name, years, marriedIn, business, canToggle, collapsed: isCollapsed, hiddenCount },
      };
      cache.set(id, { sig, node });
      out.push(node);
    }
    return out;
  }, [layout, model, rtl, visibility, locale, year, collapsed, selectedId]);

  const edges = useMemo<Edge[]>(() => {
    if (!layout || layout.model !== model) return [];
    const cache = edgeCache.current;
    const out: Edge[] = [];
    const push = (id: string, source: string, target: string, spouse: boolean, hidden: boolean, sel: boolean) => {
      const sig = `${hidden},${sel}`;
      const prev = cache.get(id);
      if (prev && prev.sig === sig) {
        out.push(prev.edge);
        return;
      }
      const edge: Edge = {
        id,
        source,
        target,
        type: 'smoothstep',
        pathOptions: { borderRadius: 12 },
        hidden,
        focusable: false,
        selectable: false,
        className: [spouse ? 'ft-edge-spouse' : '', sel ? 'ft-edge-sel' : ''].join(' '),
      } as Edge;
      cache.set(id, { sig, edge });
      out.push(edge);
    };
    for (const u of model.unions) {
      if (!layout.pos.has(u.id)) continue;
      const uHidden = visibility.unions.has(u.id);
      for (const p of [u.a, u.b]) {
        if (p == null || !layout.pos.has(p)) continue;
        push(`${p}>${u.id}`, p, u.id, true, uHidden || visibility.people.has(p), p === selectedId);
      }
      for (const k of u.kids) {
        if (!layout.pos.has(k)) continue;
        push(`${u.id}>${k}`, u.id, k, false, uHidden || visibility.people.has(k), k === selectedId);
      }
    }
    return out;
  }, [layout, model, visibility, selectedId]);

  // ---- Interaction ----
  const toggle = useCallback(
    (pid: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(pid)) next.delete(pid);
        else next.add(pid);
        return next;
      });
    },
    [setCollapsed],
  );

  const ctx = useMemo<TreeNodeContext>(
    () => ({
      onToggle: toggle,
      labels: {
        business: t('badges.business'),
        marriedIn: t('badges.marriedIn'),
        deceased: t('badges.deceased'),
        collapse: t('controls.collapse'),
        expand: t('controls.expand'),
      },
    }),
    [toggle, t],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const centreOn = useCallback(
    (pid: string, duration = 600) => {
      const node = rf.getNode(pid);
      if (!node) return;
      const zoom = Math.max(rf.getZoom(), 0.85);
      const width = containerRef.current?.clientWidth ?? 0;
      // Keep the card clear of the person panel that opens at the end side.
      const shift = width >= 768 ? PANEL_PX / 2 / zoom : 0;
      const cx = node.position.x + CARD_W / 2 + (rtl ? -shift : shift);
      void rf.setCenter(cx, node.position.y + CARD_H / 2, { zoom, duration });
    },
    [rf, rtl],
  );

  // Deferred camera moves, cancelled on unmount so they never touch a torn-down React Flow.
  const frames = useRef(new Set<number>());
  const nextFrame = useCallback((fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames.current.delete(id);
      fn();
    });
    frames.current.add(id);
  }, []);
  useEffect(() => {
    const pending = frames.current;
    return () => {
      for (const id of pending) cancelAnimationFrame(id);
      pending.clear();
    };
  }, []);

  // Centre on the selection whenever it changes (search, clicks, URL), once it is laid out.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      centred.current = null;
      return;
    }
    if (arranging || centred.current === selectedId) return;
    const hiders = collapsedAncestors(model, selectedId, collapsed);
    if (hiders.length) {
      // Search jumped to someone inside a collapsed branch: open it first.
      setCollapsed((prev) => new Set([...prev].filter((c) => !hiders.includes(c))));
      return;
    }
    centred.current = selectedId;
    nextFrame(() => centreOn(selectedId));
  }, [selectedId, arranging, model, collapsed, centreOn, setCollapsed, nextFrame]);

  // Fit the whole tree the first time it is laid out (unless a person is already selected).
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (arranging || fitted.current === familyId) return;
    fitted.current = familyId;
    if (!selectedId) nextFrame(() => void rf.fitView({ padding: 0.12, maxZoom: 1, duration: 0 }));
  }, [arranging, rf, selectedId, familyId, nextFrame]);

  // Mirroring flips x, so re-fit when the language changes.
  const lastRtl = useRef(rtl);
  useEffect(() => {
    if (lastRtl.current === rtl) return;
    lastRtl.current = rtl;
    nextFrame(() => {
      if (selectedId) centreOn(selectedId, 0);
      else void rf.fitView({ padding: 0.12, maxZoom: 1 });
    });
  }, [rtl, rf, selectedId, centreOn, nextFrame]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node-person');
      const pid = el?.dataset.id;
      if (pid) {
        e.preventDefault();
        onSelect(pid);
      }
    },
    [onSelect],
  );

  const visibleCount = useMemo(
    () => graph.people.length - [...visibility.people].filter((id) => model.people.has(id)).length,
    [graph.people.length, visibility.people, model.people],
  );

  const ariaLabelConfig = useMemo(
    () => ({
      'controls.ariaLabel': t('controls.panel'),
      'controls.zoomIn.ariaLabel': t('controls.zoomIn'),
      'controls.zoomOut.ariaLabel': t('controls.zoomOut'),
      'controls.fitView.ariaLabel': t('controls.fit'),
      'minimap.ariaLabel': t('controls.minimap'),
      'node.a11yDescription.default': t('controls.nodeHint'),
      'node.a11yDescription.keyboardDisabled': t('controls.nodeHint'),
    }),
    [t],
  );

  const side = rtl ? 'bottom-right' : 'bottom-left';

  return (
    <div ref={containerRef} className="relative size-full">
      <TreeNodeCtx.Provider value={ctx}>
        <ReactFlow<TreeFlowNode, Edge>
          className="ft-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={dark ? 'dark' : 'light'}
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          minZoom={0.05}
          maxZoom={2}
          zoomOnDoubleClick={false}
          panOnScroll={false}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={ariaLabelConfig}
          onNodeClick={(_, n) => {
            if (n.type === 'person') onSelect(n.id);
          }}
          onPaneClick={() => selectedId && onSelect(null)}
          onKeyDown={onKeyDown}
        >
          <LodClass />
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
          <Controls
            position={side}
            showInteractive={false}
            style={{ marginBottom: 88 }}
            fitViewOptions={{ padding: 0.12, duration: 500 }}
          >
            <ControlButton
              onClick={() => (selectedId ? centreOn(selectedId) : void rf.fitView({ padding: 0.12, duration: 500 }))}
              title={t('controls.focus')}
              aria-label={t('controls.focus')}
            >
              <Crosshair className="ft-lucide" aria-hidden />
            </ControlButton>
            {collapsed.size > 0 && (
              <ControlButton
                onClick={() => setCollapsed(new Set())}
                title={t('controls.expandAll')}
                aria-label={t('controls.expandAll')}
              >
                <ChevronsUpDown className="ft-lucide" aria-hidden />
              </ControlButton>
            )}
          </Controls>
          <MiniMap
            position={side}
            className="max-sm:hidden"
            style={{ marginBottom: 88, width: 168, height: 116, ...(rtl ? { marginRight: 62 } : { marginLeft: 62 }) }}
            pannable
            zoomable
            nodeBorderRadius={6}
            nodeStrokeWidth={0}
            nodeColor={(n) =>
              n.type === 'person'
                ? n.id === selectedId
                  ? 'var(--ft-primary)'
                  : genderColor((n as Extract<TreeFlowNode, { type: 'person' }>).data.person.gender)
                : 'var(--ft-gold)'
            }
          />
        </ReactFlow>
      </TreeNodeCtx.Provider>

      {arranging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass pointer-events-none absolute inset-x-0 top-20 z-[5] mx-auto flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground shadow-lg"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('arranging')}
        </motion.div>
      )}
      {!arranging && visibleCount === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <p className="glass rounded-2xl px-5 py-3 text-sm text-muted-foreground shadow-lg">
            {year != null ? t('emptyYear', { year }) : t('empty')}
          </p>
        </div>
      )}
    </div>
  );
}

/** Families above this size open with branches folded below the generation that keeps the view readable. */
const FOLD_ABOVE = 150;

function initialCollapsed(model: TreeModel): ReadonlySet<string> {
  if (model.people.size <= FOLD_ABOVE) return new Set();
  const gen = generations(
    {
      parentChild: [...model.parentUnion].flatMap(([kid, u]) =>
        [u.a, u.b]
          .filter((p): p is string => p != null)
          .map((p) => ({ id: '', parentId: p, childId: kid, type: 'BIOLOGICAL' as const })),
      ),
      marriages: model.unions
        .filter((u) => u.b != null)
        .map((u) => ({
          id: u.id,
          personAId: u.a,
          personBId: u.b as string,
          status: 'MARRIED' as const,
          startDate: null,
          endDate: null,
        })),
    },
    [...model.people.keys()],
  );
  const perGen = new Map<number, number>();
  for (const g of gen.values()) perGen.set(g, (perGen.get(g) ?? 0) + 1);
  let depth = 0;
  let shown = perGen.get(0) ?? 0;
  while (perGen.has(depth + 1) && shown + (perGen.get(depth + 1) ?? 0) <= FOLD_ABOVE / 2) {
    depth += 1;
    shown += perGen.get(depth) ?? 0;
  }
  const out = new Set<string>();
  for (const [pid, g] of gen) if (g === depth && hasChildren(model, pid)) out.add(pid);
  return out;
}

/** Adds .ft-lod-low to the canvas when zoomed far out, so cards hide their small print (CSS only, no re-render). */
function LodClass() {
  const low = useStore((s) => s.transform[2] < 0.45);
  const domNode = useStore((s) => s.domNode);
  useEffect(() => {
    domNode?.classList.toggle('ft-lod-low', low);
  }, [low, domNode]);
  return null;
}
