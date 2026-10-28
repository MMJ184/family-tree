import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
// The app dedupes `three`, so this is the same copy 3d-force-graph renders with.
import { CanvasTexture, MathUtils, type PerspectiveCamera, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { setDragMode } from '#/lib/orbit.ts';
import { applyForces, isHiLink } from './forces.ts';
import type { GLink, GNode } from './model.ts';
import { hasBizAt, isDeadAt } from './model.ts';
import { cardSize, paintCard } from './paint.ts';
import { type GraphHandle, isOn, panelShift, VIEW_BOTTOM, VIEW_TOP, type ViewCtl } from './types.ts';

// 3D version on three.js (3d-force-graph): the same photo cards, painted once
// onto a canvas texture per node and repainted only when their look changes.

const PAD = 12;
/** Extra room around a fitted branch. */
const FIT_MARGIN = 1.1;
/** Closest a branch fit may bring the camera (the distance `fly` keeps from one card). */
const MIN_DIST = 420;

interface Card {
  sprite: Sprite;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  key: string;
}

export function createGraph3D(el: HTMLElement, ctl: ViewCtl): GraphHandle {
  const cards = new Map<string, Card>();
  // Big families get lower-resolution textures to keep GPU memory in check.
  let res = 3;
  /** The pointer is over the graph (see onEnter/onLeave). */
  let inside = false;
  /** The branch focus() last framed: its cards never fade for standing near the camera. */
  let focused: ReadonlySet<string> = new Set();

  const freeCard = (c: Card) => {
    c.tex.dispose();
    c.sprite.material.dispose();
    c.canvas.width = c.canvas.height = 0;
  };

  const lookKey = (n: GNode) =>
    [
      ctl.rev,
      ctl.lang,
      ctl.pal.card,
      ctl.pal.fg,
      ctl.selectedId === n.id ? 1 : 0,
      ctl.hoverId === n.id ? 1 : 0,
      n.kind === 'p' && isDeadAt(n, ctl.year) ? 1 : 0,
      n.kind === 'p' && hasBizAt(ctl.store, n.id, ctl.year) ? 1 : 0,
    ].join('|');

  const paint = (n: GNode, c: Card) => {
    const [w, h] = cardSize(n);
    const g = c.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.canvas.width, c.canvas.height);
    g.scale(c.canvas.width / (w + PAD), c.canvas.height / (h + PAD));
    paintCard(g, n, (w + PAD) / 2, (h + PAD) / 2, ctl, true);
    c.tex.needsUpdate = true;
    c.key = lookKey(n);
  };

  const makeCard = (n: GNode): Sprite => {
    const [w, h] = cardSize(n);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((w + PAD) * res);
    canvas.height = Math.round((h + PAD) * res);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set((w + PAD) * 1.1, (h + PAD) * 1.1, 1);
    const card: Card = { sprite, canvas, tex, key: '' };
    paint(n, card);
    sprite.material.opacity = isOn(ctl, n.id) ? 1 : 0.15;
    // The library re-creates node objects on some data changes: free the card being replaced.
    const old = cards.get(n.id);
    if (old) freeCard(old);
    cards.set(n.id, card);
    return sprite;
  };

  /**
   * Hover dimming, times a fade for cards far in front of the point the camera looks at, so a
   * card that happens to sit just before the lens never veils the branch being looked at.
   */
  const opacity = (n: GNode) => {
    const base = isOn(ctl, n.id) ? 1 : 0.15;
    if (focused.has(n.id) || n.id === ctl.selectedId) return base;
    const p = f.camera().position;
    const t = (f.controls() as OrbitControls).target;
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const dz = t.z - p.z;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    const ahead = (((n.x ?? 0) - p.x) * dx + ((n.y ?? 0) - p.y) * dy + ((n.z ?? 0) - p.z) * dz) / len2;
    return base * MathUtils.smoothstep(ahead, 0.2, 0.55);
  };

  const fade = () => {
    for (const n of f.graphData().nodes) {
      const c = cards.get(n.id);
      if (c) c.sprite.material.opacity = opacity(n);
    }
  };

  const restyle = () => {
    for (const n of f.graphData().nodes) {
      const c = cards.get(n.id);
      if (!c) continue;
      if (c.key !== lookKey(n)) paint(n, c);
      c.sprite.material.opacity = opacity(n);
    }
    f.linkColor(f.linkColor()).linkWidth(f.linkWidth());
  };

  const linkColor = (l: GLink) => {
    if (isHiLink(l, ctl.hoverId)) return ctl.pal.primary;
    return l.kind === 'pc' ? ctl.pal.muted : ctl.pal.gold;
  };

  const f = (new ForceGraph3D(el, { controlType: 'orbit' }) as unknown as ForceGraph3DInstance<GNode, GLink>)
    .backgroundColor('rgba(0,0,0,0)')
    .showNavInfo(false)
    .nodeId('id')
    .nodeLabel(() => '')
    .nodeThreeObject(makeCard)
    .linkColor(linkColor)
    .linkOpacity(0.5)
    .linkWidth((l) => (isHiLink(l, ctl.hoverId) ? 1 : l.kind === 'sp' ? 0.6 : 0))
    .cooldownTime(7000)
    .d3VelocityDecay(0.32)
    .onEngineStop(() => ctl.onSettled())
    .onNodeHover((n) => {
      const id = inside && n ? n.id : null;
      if (id === ctl.hoverId) return;
      ctl.hoverId = id;
      el.style.cursor = id ? 'pointer' : '';
      restyle();
    })
    .onNodeClick((n) => {
      if (n.kind === 'p') ctl.onSelect(n.id);
      else fly(n);
    });
  applyForces(f);
  // Hover counts only while the pointer is over the graph. The library keeps ray-testing its last
  // pointer position (it starts just off the top-left corner) even after the pointer has left for
  // a panel on top, which would hover some card there and dim all the others.
  const onEnter = () => {
    inside = true;
  };
  const onLeave = () => {
    inside = false;
    if (!ctl.hoverId) return;
    ctl.hoverId = null;
    el.style.cursor = '';
    restyle();
  };
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  const controls = f.controls() as OrbitControls;
  controls.addEventListener('change', fade);

  const fly = (n: GNode) => {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const z = n.z ?? 0;
    const r = 1 + 420 / (Math.hypot(x, y, z) || 1);
    f.cameraPosition({ x: x * r, y: y * r, z: z * r }, { x, y, z }, 900);
  };

  let sig = '';
  return {
    setData(d, force) {
      if (!force && d.sig === sig) {
        restyle();
        return;
      }
      sig = d.sig;
      res = d.nodes.length > 250 ? 2 : 3;
      const shown = new Set(d.nodes.map((n) => n.id));
      for (const [id, c] of cards)
        if (!shown.has(id)) {
          freeCard(c);
          cards.delete(id);
        }
      f.graphData({ nodes: d.nodes, links: d.links });
      restyle();
    },
    refresh: restyle,
    focus(id, branch) {
      const nodes = f.graphData().nodes.filter((n) => branch.has(n.id) && n.x !== undefined);
      if (!nodes.length) {
        const n = f.graphData().nodes.find((x) => x.id === id);
        if (n) fly(n);
        return;
      }
      // Work in the camera's own axes (right, up, back), which the flight keeps: each card is
      // measured where it will be seen, so cards nearer the camera get the extra room they need.
      const cam = f.camera() as PerspectiveCamera;
      const m = cam.matrixWorld.elements;
      const R = [m[0] ?? 1, m[1] ?? 0, m[2] ?? 0] as const;
      const U = [m[4] ?? 0, m[5] ?? 1, m[6] ?? 0] as const;
      const B = [m[8] ?? 0, m[9] ?? 0, m[10] ?? 1] as const;
      const pts = nodes.map((n) => {
        const [cw, ch] = cardSize(n);
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const z = n.z ?? 0;
        return {
          x: R[0] * x + R[1] * y + R[2] * z,
          y: U[0] * x + U[1] * y + U[2] * z,
          z: B[0] * x + B[1] * y + B[2] * z,
          // Half the sprite's size (makeCard scales it by 1.1).
          hw: ((cw + PAD) * 1.1) / 2,
          hh: ((ch + PAD) * 1.1) / 2,
        };
      });
      // The orbit target goes to the middle of the branch's depth.
      let z0 = Number.POSITIVE_INFINITY;
      let z1 = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
      const cz = (z0 + z1) / 2;
      // The free area (clear of the toolbars and the person panel) is off-centre on the screen, so each of its
      // four edges gets its own tangent from the camera's axis (the projection stays centred).
      const w = f.width();
      const h = f.height();
      const fpx = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
      const panel = 2 * panelShift(w);
      const rtl = ctl.lang === 'ar';
      const tl = (w / 2 - (rtl ? panel : 0)) / fpx / FIT_MARGIN;
      const tr = (w / 2 - (rtl ? 0 : panel)) / fpx / FIT_MARGIN;
      const tu = (h / 2 - VIEW_TOP) / fpx / FIT_MARGIN;
      const td = (h / 2 - VIEW_BOTTOM) / fpx / FIT_MARGIN;
      // Each card edge must stay inside its side of the frustum: with the camera at (X, Y) across and Zc
      // along B, a left edge needs X − tl·Zc ≤ x − hw − tl·z, a right edge X + tr·Zc ≥ x + hw + tr·z,
      // and the same for bottom and top. The tightest pairs give the closest camera.
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      let bot = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      for (const p of pts) {
        lo = Math.min(lo, p.x - p.hw - tl * p.z);
        hi = Math.max(hi, p.x + p.hw + tr * p.z);
        bot = Math.min(bot, p.y - p.hh - td * p.z);
        top = Math.max(top, p.y + p.hh + tu * p.z);
      }
      // Not so close that a stray card in front fills the screen (same distance as flying to one card).
      const zc = Math.max((hi - lo) / (tl + tr), (top - bot) / (tu + td), cz + MIN_DIST);
      // Any spare room is shared evenly on both sides.
      const sx = (lo + tl * zc + (hi - tr * zc)) / 2;
      const sy = (bot + td * zc + (top - tu * zc)) / 2;
      const at = (b: number) => ({
        x: R[0] * sx + U[0] * sy + B[0] * b,
        y: R[1] * sx + U[1] * sy + B[1] * b,
        z: R[2] * sx + U[2] * sy + B[2] * b,
      });
      focused = branch;
      f.cameraPosition(at(zc), at(cz), 900);
    },
    fit(ms = 700) {
      f.zoomToFit(ms, 60);
    },
    setPan(on) {
      setDragMode(f.controls() as OrbitControls, on);
    },
    resize(w, h) {
      f.width(w).height(h);
    },
    destroy() {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      controls.removeEventListener('change', fade);
      const renderer = f.renderer();
      f._destructor();
      for (const c of cards.values()) freeCard(c);
      cards.clear();
      renderer.dispose();
      // Release the WebGL context now instead of waiting for GC (browsers cap live contexts).
      renderer.forceContextLoss();
      el.replaceChildren();
    },
  };
}
