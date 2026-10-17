import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
// The app dedupes `three`, so this is the same copy 3d-force-graph renders with.
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import { applyForces, isHiLink } from './forces.ts';
import type { GLink, GNode } from './model.ts';
import { hasBizAt, isDeadAt } from './model.ts';
import { cardSize, paintCard } from './paint.ts';
import { type GraphHandle, isOn, type ViewCtl } from './types.ts';

// 3D version on three.js (3d-force-graph): the same photo cards, painted once
// onto a canvas texture per node and repainted only when their look changes.

const PAD = 12;

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

  const restyle = () => {
    for (const n of f.graphData().nodes) {
      const c = cards.get(n.id);
      if (!c) continue;
      if (c.key !== lookKey(n)) paint(n, c);
      c.sprite.material.opacity = isOn(ctl, n.id) ? 1 : 0.15;
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
      ctl.hoverId = n ? n.id : null;
      el.style.cursor = n ? 'pointer' : '';
      restyle();
    })
    .onNodeClick((n) => {
      if (n.kind === 'p') ctl.onSelect(n.id);
      else fly(n);
    });
  applyForces(f);

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
    focus(id) {
      const n = f.graphData().nodes.find((x) => x.id === id);
      if (n) fly(n);
    },
    fit(ms = 700) {
      f.zoomToFit(ms, 60);
    },
    resize(w, h) {
      f.width(w).height(h);
    },
    destroy() {
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
