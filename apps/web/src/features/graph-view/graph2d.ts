import ForceGraph from 'force-graph';
import { applyForces, isHiLink } from './forces.ts';
import type { GLink, GNode } from './model.ts';
import { CARD, cardSize, paintCard, paintDot, withAlpha } from './paint.ts';
import { type GraphHandle, isOn, panelShift, VIEW_BOTTOM, VIEW_TOP, type ViewCtl } from './types.ts';

// 2D Obsidian-style graph on canvas (force-graph). Cards turn into round
// portraits when zoomed far out so 2,000 people stay smooth.

/** Below this on-screen card width, draw portraits only. */
const LOD_PX = 38;
const DOT_R = 10;
const CARD_W = CARD.p[0];
/** Portrait radius in graph units, never smaller than ~4px on screen. */
const dotR = (k: number) => Math.max(DOT_R, 4 / k);
/** Padding around a fitted branch, and the closest a small branch zooms in. */
const FIT_PAD = 24;
const FOCUS_MAX_ZOOM = 3;

export function createGraph2D(el: HTMLElement, ctl: ViewCtl): GraphHandle {
  const lod = (k: number) => CARD_W * k < LOD_PX;
  const f = new ForceGraph<GNode, GLink>(el)
    .backgroundColor('rgba(0,0,0,0)')
    .nodeId('id')
    .nodeLabel(() => '')
    .nodeCanvasObject((n, ctx, k) => {
      const on = isOn(ctl, n.id);
      if (lod(k)) paintDot(ctx, n, n.x ?? 0, n.y ?? 0, dotR(k), ctl, on);
      else paintCard(ctx, n, n.x ?? 0, n.y ?? 0, ctl, on);
    })
    .nodePointerAreaPaint((n, color, ctx, k) => {
      ctx.fillStyle = color;
      if (lod(k)) {
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, dotR(k) + 2 / k, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const [w, h] = cardSize(n);
        ctx.fillRect((n.x ?? 0) - w / 2, (n.y ?? 0) - h / 2, w, h);
      }
    })
    .linkColor((l) => {
      if (isHiLink(l, ctl.hoverId)) return ctl.pal.primary;
      const a = ctl.hoverId ? 0.1 : l.kind === 'pc' ? 0.45 : 0.75;
      return withAlpha(l.kind === 'pc' ? ctl.pal.muted : ctl.pal.gold, a);
    })
    .linkWidth((l) => (isHiLink(l, ctl.hoverId) ? 1.8 : l.kind === 'sp' ? 1.2 : 0.8))
    .linkLineDash((l) => (l.kind === 'sp' ? [5, 3] : l.kind === 'bz' ? [1.5, 2.5] : null))
    .autoPauseRedraw(false)
    .cooldownTime(7000)
    .d3VelocityDecay(0.32)
    .onEngineStop(() => ctl.onSettled())
    .onNodeHover((n) => {
      const id = inside && n ? n.id : null;
      ctl.hoverId = id;
      el.style.cursor = id ? 'pointer' : '';
    })
    .onNodeClick((n) => {
      if (n.kind === 'p') ctl.onSelect(n.id);
      else focusNode(n);
    });
  applyForces(f);
  // Hover counts only while the pointer is over the graph: no hover change is reported when the
  // pointer leaves for a panel on top, which would leave the rest of the graph dimmed.
  let inside = false;
  const onEnter = () => {
    inside = true;
  };
  const onLeave = () => {
    inside = false;
    ctl.hoverId = null;
    el.style.cursor = '';
  };
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);

  let sig = '';
  const focusNode = (n: GNode) => {
    if (n.x === undefined || n.y === undefined) return;
    const k = Math.max(f.zoom(), 2.5);
    const shift = panelShift(f.width()) / k;
    const rtl = ctl.lang === 'ar';
    f.centerAt(n.x + (rtl ? -shift : shift), n.y, 600);
    f.zoom(k, 600);
  };

  return {
    setData(d, force) {
      if (!force && d.sig === sig) return;
      sig = d.sig;
      f.graphData({ nodes: d.nodes, links: d.links });
    },
    refresh() {
      // The canvas redraws every frame; nothing to rebuild.
    },
    focus(_id, branch) {
      // Fit the bounding box of the branch's cards into the area clear of toolbars and the panel.
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const n of f.graphData().nodes) {
        if (!branch.has(n.id) || n.x === undefined || n.y === undefined) continue;
        const [w, h] = cardSize(n);
        x0 = Math.min(x0, n.x - w / 2);
        x1 = Math.max(x1, n.x + w / 2);
        y0 = Math.min(y0, n.y - h / 2);
        y1 = Math.max(y1, n.y + h / 2);
      }
      if (!Number.isFinite(x0)) return;
      const shift = panelShift(f.width());
      const freeW = f.width() - 2 * shift - 2 * FIT_PAD;
      const freeH = f.height() - VIEW_TOP - VIEW_BOTTOM - 2 * FIT_PAD;
      const k = Math.min(FOCUS_MAX_ZOOM, Math.max(0.05, Math.min(freeW / (x1 - x0), freeH / (y1 - y0))));
      // Screen centre sits half a panel towards the panel, and between the toolbars vertically.
      const rtl = ctl.lang === 'ar';
      const cx = (x0 + x1) / 2 + ((rtl ? -1 : 1) * shift) / k;
      const cy = (y0 + y1) / 2 - (VIEW_TOP - VIEW_BOTTOM) / 2 / k;
      f.centerAt(cx, cy, 600);
      f.zoom(k, 600);
    },
    fit(ms = 700) {
      f.zoomToFit(ms, 110);
    },
    resize(w, h) {
      f.width(w).height(h);
    },
    destroy() {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      f._destructor();
      el.replaceChildren();
    },
  };
}
