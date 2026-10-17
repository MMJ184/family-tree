import ForceGraph from 'force-graph';
import { applyForces, isHiLink } from './forces.ts';
import type { GLink, GNode } from './model.ts';
import { CARD, cardSize, paintCard, paintDot, withAlpha } from './paint.ts';
import { type GraphHandle, isOn, panelShift, type ViewCtl } from './types.ts';

// 2D Obsidian-style graph on canvas (force-graph). Cards turn into round
// portraits when zoomed far out so 2,000 people stay smooth.

/** Below this on-screen card width, draw portraits only. */
const LOD_PX = 38;
const DOT_R = 10;
const CARD_W = CARD.p[0];
/** Portrait radius in graph units, never smaller than ~4px on screen. */
const dotR = (k: number) => Math.max(DOT_R, 4 / k);

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
      ctl.hoverId = n ? n.id : null;
      el.style.cursor = n ? 'pointer' : '';
    })
    .onNodeClick((n) => {
      if (n.kind === 'p') ctl.onSelect(n.id);
      else focusNode(n);
    });
  applyForces(f);

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
    focus(id) {
      const n = f.graphData().nodes.find((x) => x.id === id);
      if (n) focusNode(n);
    },
    fit(ms = 700) {
      f.zoomToFit(ms, 110);
    },
    resize(w, h) {
      f.width(w).height(h);
    },
    destroy() {
      f._destructor();
      el.replaceChildren();
    },
  };
}
