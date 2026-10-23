import type { StudioModel, StudioPerson } from '../model.ts';
import { isRoot } from './types.ts';

// Bonsai layout: small subtrees become foliage pads (wide, flat clouds of portraits) placed in a
// dome above the trunk; ancestors of several pads stay on the bare branches between pad and trunk.
// All coordinates are left-to-right; the scene mirrors x for Arabic.

/** A grid cell of a pad: a portrait slot (id) or an empty slot that only carries foliage. */
export interface PadCell {
  x: number;
  y: number;
  z: number;
  id: string | null;
}

export interface Pad {
  members: StudioPerson[];
  roots: string[];
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  cells: PadCell[];
}

export interface BonsaiLayout {
  X: Float32Array;
  Y: Float32Array;
  Z: Float32Array;
  pads: Pad[];
  /** Crown radius; the founder sits at (0, Cy, Cz). */
  R: number;
  Cy: number;
  Cz: number;
}

const ASPECT = 1.7; // pads are wide, flat clouds
const AX = 1.35;
const AY = 0.8;
const SPAN = Math.PI + 0.5;

export function bonsaiLayout(M: StudioModel, S: number, big: boolean, rnd: () => number): BonsaiLayout {
  const n = M.n;
  const root = M.root;
  const spOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) spOf.set(p.anchor, [...(spOf.get(p.anchor) ?? []), p]);

  // Angular order around the crown, weighted so spouses get room
  const wt = new Map<string, number>();
  const wOf = (id: string): number => {
    const p = M.get(id);
    const w = Math.max(
      1 + 0.8 * (spOf.get(id)?.length ?? 0),
      p.kids.reduce((s, k) => s + wOf(k), 0),
    );
    wt.set(id, w);
    return w;
  };
  wOf(root.id);
  const ang = new Map<string, number>();
  const assign = (id: string, a0: number, a1: number) => {
    ang.set(id, (a0 + a1) / 2);
    const p = M.get(id);
    const tot = p.kids.reduce((s, k) => s + (wt.get(k) ?? 1), 0) || 1;
    let a = a0;
    for (const k of p.kids) {
      const w = ((a1 - a0) * (wt.get(k) ?? 1)) / tot;
      assign(k, a, a + w);
      a += w;
    }
  };
  assign(root.id, 0, 1);
  const angOf = (p: StudioPerson) => ang.get(p.mi ? (p.anchor ?? p.id) : p.id) ?? p.ang;

  // Split the tree: subtrees up to PMAX people become pads, bigger ones stay as structure
  const cnt = new Map<string, number>();
  const cOf = (id: string): number => {
    const p = M.get(id);
    const c = 1 + (spOf.get(id)?.length ?? 0) + p.kids.reduce((s, k) => s + cOf(k), 0);
    cnt.set(id, c);
    return c;
  };
  cOf(root.id);
  const PMAX = Math.max(big ? 14 : 4, Math.ceil(n / (big ? 14 : 8)));
  const pads: Pad[] = [];
  const padParent: string[] = [];
  const struct: StudioPerson[] = [];
  const structParent = new Map<string, string>();
  const collect = (id: string, out: StudioPerson[]) => {
    const p = M.get(id);
    out.push(p);
    for (const s of spOf.get(id) ?? []) out.push(s);
    for (const k of p.kids) collect(k, out);
  };
  const mkPad = (roots: string[], parent: string) => {
    const members: StudioPerson[] = [];
    for (const r of roots) collect(r, members);
    const rx = Math.max(S * 0.95, Math.sqrt((members.length * S * S * 1.15 * ASPECT) / Math.PI));
    pads.push({ members, roots, x: 0, y: 0, z: 0, rx, ry: rx / ASPECT, cells: [] });
    padParent.push(parent);
  };
  const visit = (id: string) => {
    struct.push(M.get(id));
    let cur: string[] = [];
    let sum = 0;
    const flush = () => {
      if (cur.length) mkPad(cur, id);
      cur = [];
      sum = 0;
    };
    for (const k of M.get(id).kids) {
      const c = cnt.get(k) ?? 1;
      if (c > PMAX) {
        flush();
        structParent.set(k, id);
        visit(k);
        continue;
      }
      if (sum + c > PMAX) flush();
      cur.push(k);
      sum += c;
    }
    flush();
  };
  visit(root.id);

  // Slots inside each pad: rows of a hex-like grid clipped to the ellipse
  const slots = pads.map((pad) => {
    let sc = 1;
    for (let tries = 0; tries < 40; tries++) {
      const rx = pad.rx * sc;
      const ry = Math.max(S * 0.5, pad.ry * sc);
      const pts: Array<[number, number]> = [];
      const dy = S * 0.86;
      const rows = Math.floor(ry / dy);
      for (let r = -rows; r <= rows; r++) {
        const y = r * dy;
        const half = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) - S * 0.15;
        if (half < 0) continue;
        const k = Math.floor((half * 2) / S);
        for (let i = 0; i <= k; i++) pts.push([-(k * S) / 2 + i * S, y]);
      }
      if (pts.length >= pad.members.length) {
        pad.rx = rx;
        pad.ry = ry;
        return pts;
      }
      sc *= 1.06;
    }
    return [] as Array<[number, number]>;
  });

  // Crown size from the pads' area, then pack the pads in a dome around the founder
  const area = pads.reduce((s, p) => s + Math.PI * p.rx * p.ry, 0);
  const R = Math.max(7.5, Math.sqrt(area / 0.5 / (0.5 * SPAN * AX * AY)));
  const Cy = 0.72 * R;
  const Cz = 0.1 * R;
  const lowY = Cy - R * 0.12;
  const hole = R * 0.24 + S;
  const maxG = Math.max(1, ...pads.map((p) => M.get(p.roots[0] ?? root.id).gen));
  const phOf = pads.map((p) => {
    const a = p.roots.reduce((s, r) => s + (ang.get(r) ?? 0.5), 0) / Math.max(1, p.roots.length);
    return (a - 0.5) * SPAN;
  });
  pads.forEach((p, i) => {
    const g = M.get(p.roots[0] ?? root.id).gen;
    const d = R * (0.45 + 0.5 * (g / maxG));
    const ph = phOf[i] ?? 0;
    p.x = Math.sin(ph) * d * AX;
    p.y = Cy + Math.cos(ph) * d * AY;
  });
  const gap = S * (big ? 0.9 : 0.7);
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < pads.length; i++) {
      const a = pads[i];
      if (!a) continue;
      for (let j = i + 1; j < pads.length; j++) {
        const b = pads[j];
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = (b.y - a.y) * ASPECT;
        const d = Math.hypot(dx, dy) || 1e-3;
        const min = a.rx + b.rx + gap;
        if (d >= min) continue;
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d / ASPECT) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d / ASPECT) * push;
      }
    }
    pads.forEach((p, i) => {
      // keep the pad on its own bearing, pull it in to keep the crown compact, keep the trunk clear
      const ph = phOf[i] ?? 0;
      const vx = p.x / AX;
      const vy = (p.y - Cy) / AY;
      const dist = Math.hypot(vx, vy);
      const tx = Math.sin(ph) * dist * AX;
      const ty = Cy + Math.cos(ph) * dist * AY;
      p.x += (tx - p.x) * 0.06;
      p.y += (ty - p.y) * 0.06;
      // pulled in harder vertically: a broad, low crown like a classic bonsai
      const k = it < 300 ? 1 : 0;
      p.x *= 1 - 0.012 * k;
      p.y = Cy + (p.y - Cy) * (1 - 0.03 * k);
      const hx = p.x;
      const hy = (p.y - Cy) * ASPECT;
      const hd = Math.hypot(hx, hy) || 1e-3;
      const hmin = hole + p.rx;
      if (hd < hmin) {
        p.x = (hx / hd) * hmin;
        p.y = Cy + (hy / hd / ASPECT) * hmin;
      }
      p.y = Math.max(p.y, lowY + p.ry);
    });
  }

  // Depth: pads alternate front and back like a styled tree, and the crown leans to the viewer
  const zPat = [0.55, -0.5, 0.2, -0.75, 0.4, -0.25, 0.7, -0.6, 0.05];
  const order = pads.map((_, i) => i).sort((a, b) => (phOf[a] ?? 0) - (phOf[b] ?? 0));
  order.forEach((pi, k) => {
    const p = pads[pi];
    if (p) p.z = Cz + (zPat[k % zPat.length] ?? 0) * R * 0.22 - (Math.hypot(p.x, p.y - Cy) / R) ** 2 * R * 0.08;
  });

  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);

  // Fill each pad: the oldest generation enters on the trunk side, younger rows fan outwards
  pads.forEach((pad, pi) => {
    const pts = slots[pi] ?? [];
    let ux = -pad.x;
    let uy = (Cy - pad.y) * ASPECT;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const ex = ux * pad.rx * 0.9;
    const ey = (uy * pad.rx * 0.9) / ASPECT;
    const sorted: PadCell[] = pts
      .map(([x, y]) => ({ x, y, d: Math.hypot(x - ex, y - ey) }))
      .sort((a, b) => a.d - b.d)
      .map(({ x, y }) => ({ x, y, z: 0, id: null }));
    const mem = [...pad.members].sort((a, b) => a.gen - b.gen || angOf(a) - angOf(b) || Number(a.mi) - Number(b.mi));
    // signed angle seen from the entry point, looking away from the trunk
    const turn = (c: PadCell) => {
      const vx = c.x - ex;
      const vy = c.y - ey;
      return Math.atan2(-ux * vy + uy * vx, -ux * vx - uy * vy);
    };
    let at = 0;
    while (at < mem.length) {
      const g = mem[at]?.gen ?? 0;
      let end = at;
      while (end < mem.length && mem[end]?.gen === g) end++;
      const band = sorted.slice(at, end).sort((a, b) => turn(b) - turn(a));
      band.forEach((c, k) => {
        c.id = mem[at + k]?.id ?? null;
      });
      at = end;
    }
    for (const c of sorted) {
      const cush = Math.max(0, 1 - (c.x / pad.rx) ** 2 - (c.y / pad.ry) ** 2);
      c.x += pad.x;
      c.y += pad.y;
      c.z = pad.z + cush * S * 0.45;
      if (!c.id) continue;
      const i = M.get(c.id).idx;
      X[i] = c.x;
      Y[i] = c.y;
      Z[i] = c.z;
    }
    pad.cells = sorted;
  });

  // Structure: each ancestor sits part-way from its own parent towards the pads it carries
  const sum = new Map<string, { x: number; y: number; z: number; w: number }>();
  const add = (id: string, x: number, y: number, z: number, w: number) => {
    const s = sum.get(id) ?? { x: 0, y: 0, z: 0, w: 0 };
    s.x += x * w;
    s.y += y * w;
    s.z += z * w;
    s.w += w;
    sum.set(id, s);
  };
  pads.forEach((p, i) => {
    let id: string | undefined = padParent[i];
    const w = p.members.length;
    while (id) {
      add(id, p.x, p.y, p.z, w);
      id = structParent.get(id);
    }
  });
  for (const p of struct) {
    const i = p.idx;
    if (isRoot(p)) {
      X[i] = 0;
      Y[i] = Cy;
      Z[i] = Cz;
      continue;
    }
    const par = M.get(structParent.get(p.id) ?? root.id);
    const s = sum.get(p.id);
    const tx = s?.w ? s.x / s.w : 0;
    const ty = s?.w ? s.y / s.w : Cy;
    const tz = s?.w ? s.z / s.w : Cz;
    X[i] = (X[par.idx] ?? 0) + (tx - (X[par.idx] ?? 0)) * 0.42;
    Y[i] = (Y[par.idx] ?? Cy) + (ty - (Y[par.idx] ?? Cy)) * 0.42;
    Z[i] = (Z[par.idx] ?? Cz) + (tz - (Z[par.idx] ?? Cz)) * 0.42;
  }
  for (const p of struct) {
    (spOf.get(p.id) ?? []).forEach((s, k) => {
      const side = k % 2 ? -1 : 1;
      X[s.idx] = (X[p.idx] ?? 0) + side * S * (1 + Math.floor(k / 2));
      Y[s.idx] = (Y[p.idx] ?? Cy) - S * 0.1;
      Z[s.idx] = (Z[p.idx] ?? Cz) - S * 0.1;
    });
  }

  // Final touch: nudge any portraits that still overlap (structure next to a pad)
  const inPad = new Uint8Array(n);
  for (const pad of pads) for (const p of pad.members) inPad[p.idx] = 1;
  for (let it = 0; it < 30; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (inPad[i]) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = (X[i] ?? 0) - (X[j] ?? 0);
        const dy = (Y[i] ?? 0) - (Y[j] ?? 0);
        const d = Math.hypot(dx, dy);
        if (d >= S || isRoot(M.people[i] as StudioPerson)) continue;
        const k = d < 1e-4 ? 1 : (S - d) / d;
        X[i] = (X[i] ?? 0) + (d < 1e-4 ? rnd() - 0.5 : dx * k);
        Y[i] = (Y[i] ?? 0) + (d < 1e-4 ? rnd() - 0.5 : dy * k);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { X, Y, Z, pads, R, Cy, Cz };
}
