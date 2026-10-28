import { BufferGeometry, CanvasTexture, type Curve, Float32BufferAttribute, Vector3 } from 'three';
import { type StudioModel, type StudioPerson, spouseIndex } from '../model.ts';

// Banyan geometry: tapered tubes that remember their centre line, so the shader can
// thicken a prop-root into a trunk as the years pass, plus the banyan leaf texture.

export interface WoodBuilder {
  pos: number[];
  nor: number[];
  /** Centre line point for each vertex (thickening). */
  ctr: number[];
  /** 0..1 along the tube (growth), arc length in world units (bark pattern), around (0..1). */
  t: number[];
  s: number[];
  u: number[];
  birth: number[];
  grow: number[];
  /** Thickness the tube starts at, as a share of its final radius. */
  thin: number[];
  col: number[];
  key: string[];
  idx: number[];
}

export const woodBuilder = (): WoodBuilder => ({
  pos: [],
  nor: [],
  ctr: [],
  t: [],
  s: [],
  u: [],
  birth: [],
  grow: [],
  thin: [],
  col: [],
  key: [],
  idx: [],
});

export interface WoodOpts {
  birth: number;
  grow: number;
  key: string;
  thin?: number;
  /** Radius multiplier along the tube (flares, knots). */
  shape?: (t: number) => number;
  col?: [number, number, number];
}

const FN = new Vector3(1, 0, 0);
const FB = new Vector3(0, 0, 1);

/** Tapered tube along a curve (r0 at t = 0, r1 at t = 1). */
export function wood(
  B: WoodBuilder,
  curve: Curve<Vector3>,
  r0: number,
  r1: number,
  segs: number,
  radial: number,
  o: WoodOpts,
) {
  const frames = curve.computeFrenetFrames(segs, false);
  const len = curve.getLength();
  const base = B.pos.length / 3;
  const P = new Vector3();
  const n = new Vector3();
  const col = o.col ?? [1, 1, 1];
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    curve.getPointAt(tt, P);
    const r = (r0 + (r1 - r0) * tt ** 0.85) * (o.shape ? o.shape(tt) : 1);
    const N = frames.normals[i] ?? FN;
    const Bn = frames.binormals[i] ?? FB;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(v)).addScaledVector(Bn, Math.sin(v)).normalize();
      B.pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      B.nor.push(n.x, n.y, n.z);
      B.ctr.push(P.x, P.y, P.z);
      B.t.push(tt);
      B.s.push(tt * len);
      B.u.push(j / radial);
      B.birth.push(o.birth);
      B.grow.push(o.grow);
      B.thin.push(o.thin ?? 0.4);
      B.col.push(col[0], col[1], col[2]);
      B.key.push(o.key);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j;
      const b = a + radial + 1;
      B.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
}

/** Geometry whose `aHi` the engine drives from the lineage (userData.keys). */
export function bakeWood(B: WoodBuilder): BufferGeometry {
  const g = new BufferGeometry();
  const f = (a: number[], k: number) => new Float32BufferAttribute(a, k);
  g.setAttribute('position', f(B.pos, 3));
  g.setAttribute('normal', f(B.nor, 3));
  g.setAttribute('aC', f(B.ctr, 3));
  g.setAttribute('aT', f(B.t, 1));
  g.setAttribute('aS', f(B.s, 1));
  g.setAttribute('aU', f(B.u, 1));
  g.setAttribute('aBirth', f(B.birth, 1));
  g.setAttribute('aGrow', f(B.grow, 1));
  g.setAttribute('aThin', f(B.thin, 1));
  g.setAttribute('aCol', f(B.col, 3));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

/** Broad, leathery banyan leaf (ovate, blunt tip) with a pale midrib and veins in the green channel. */
export function leafTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 94);
    g.bezierCurveTo(4, 78, 0, 30, 18, 10);
    g.bezierCurveTo(26, 2, 38, 2, 46, 10);
    g.bezierCurveTo(64, 30, 60, 78, 32, 94);
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(160,160,160,1)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(32, 92);
    g.lineTo(32, 8);
    g.stroke();
    g.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) {
      const y = 80 - k * 15;
      g.beginPath();
      g.moveTo(32, y);
      g.quadraticCurveTo(20, y - 6, 10, y - 14);
      g.moveTo(32, y);
      g.quadraticCurveTo(44, y - 6, 54, y - 14);
      g.stroke();
    }
  }
  return new CanvasTexture(c);
}

export interface BanyanLayout {
  /** Where each person hangs, left-to-right (the scene mirrors x for Arabic). */
  X: Float32Array;
  Y: Float32Array;
  Z: Float32Array;
  /** Underside of the canopy, rows' vertical step, the lowest hanging height. */
  Hc: number;
  row: number;
  low: number;
  /** Half width and depth of the family's footprint (the canopy covers it with a margin). */
  hw: number;
  hd: number;
  /** Large families hang in rings round the trunk instead of rows; the outer ring's radius. */
  ring: boolean;
  Rmax: number;
}

/** Slot of the k-th spouse relative to the partner: alternating sides, first spouse after the partner. */
const slotOf = (k: number) => (k % 2 ? -1 : 1) * (1 + Math.floor(k / 2));

/**
 * The family hangs from the banyan like its aerial roots: the founder just under the canopy,
 * each generation a row lower, children spread under their parents (a tidy top-down tree with
 * room for spouses beside their partners, each household centred on its slots). Neighbours in a
 * row hang at alternating lengths so the row can be tight; a large family's rows wrap right round
 * the trunk as rings, with the founder and his partners in front of the trunk (`front`). Pure maths.
 */
export function banyanLayout(M: StudioModel, disc: number, big: boolean, front = 0): BanyanLayout {
  const n = M.n;
  const root = M.root;
  const maxGen = Math.max(1, M.maxGen);
  const spOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) spOf.set(p.anchor, [...(spOf.get(p.anchor) ?? []), p]);
  // Spouses in wedding order.
  for (const list of spOf.values()) list.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  const slots = (p: StudioPerson) => 1 + (spOf.get(p.id)?.length ?? 0);
  /** Shift (in slots) that centres a household on its slots. */
  const shiftOf = (p: StudioPerson) => {
    const k = spOf.get(p.id)?.length ?? 0;
    let lo = 0;
    let hi = 0;
    for (let j = 0; j < k; j++) {
      lo = Math.min(lo, slotOf(j));
      hi = Math.max(hi, slotOf(j));
    }
    return -(lo + hi) / 2;
  };
  const sx = disc * (big ? 0.82 : 0.9);
  const ext = new Map<string, number>();
  const extent = (id: string): number => {
    const p = M.get(id);
    const e = Math.max(
      slots(p) * sx,
      p.kids.reduce((s, k) => s + extent(k), 0),
    );
    ext.set(id, e);
    return e;
  };
  const width = extent(root.id);
  const u = new Float32Array(n);
  const place = (id: string, a0: number, a1: number) => {
    const p = M.get(id);
    u[p.idx] = (a0 + a1) / 2 + shiftOf(p) * sx;
    let a = a0 + (a1 - a0 - p.kids.reduce((s, k) => s + (ext.get(k) ?? 0), 0)) / 2;
    for (const k of p.kids) {
      const w = ext.get(k) ?? 0;
      place(k, a, a + w);
      a += w;
    }
  };
  place(root.id, -width / 2, width / 2);
  const kOf = (p: StudioPerson) => Math.max(0, (spOf.get(p.anchor ?? '') ?? [p]).indexOf(p));
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = M.get(p.anchor ?? root.id);
    u[p.idx] = (u[a.idx] ?? 0) + slotOf(kOf(p)) * sx;
  }
  // Rows: neighbours alternate between a short and a long hang so a tight row never touches. On a
  // ring the alternation starts after the widest gap, so the seam has the most room.
  const row = disc * 2.25;
  const stagger = disc * 0.95;
  const top = disc * 1.6;
  const ring = big;
  // Angle on the rings: one free slot is left at the seam where the two ends of the family meet.
  const turn = (x: number) => ((x + width / 2) / (width + sx)) * Math.PI * 2 + Math.PI * 0.5;
  const rows: StudioPerson[][] = Array.from({ length: maxGen + 1 }, () => []);
  for (const p of M.people) rows[Math.min(maxGen, p.gen)]?.push(p);
  const drop = new Float32Array(n);
  for (const r of rows) {
    r.sort((a, b) => (u[a.idx] ?? 0) - (u[b.idx] ?? 0));
    let start = 0;
    if (ring && r.length > 1) {
      let widest = -1;
      for (let i = 0; i < r.length; i++) {
        const a = u[(r[i] as StudioPerson).idx] ?? 0;
        const b =
          i + 1 < r.length
            ? (u[(r[i + 1] as StudioPerson).idx] ?? 0)
            : (u[(r[0] as StudioPerson).idx] ?? 0) + width + sx;
        if (b - a > widest) {
          widest = b - a;
          start = (i + 1) % r.length;
        }
      }
    }
    r.forEach((p, k) => {
      const kk = (k - start + r.length) % r.length;
      drop[p.idx] = top + p.gen * row + (kk % 2) * stagger + (p.mi ? disc * 0.12 : 0);
    });
  }
  const low = top + maxGen * row + stagger;
  // A large family's canopy rides high, so the camera can look down on its rings from under the leaves.
  const Rmax = ring ? Math.max(disc * 8, width / (Math.PI * 2)) : 0;
  const Hc = low + Math.max(disc * 3.2, Rmax * 0.5);
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);
  const radiusOf = (g: number) => Rmax * Math.max(0.12, Math.min(1, g / maxGen)) ** 0.85;
  let hw = 0;
  let hd = disc * 2;
  for (const p of M.people) {
    const i = p.idx;
    const x = u[i] ?? 0;
    if (ring) {
      const anchor = p.mi ? M.get(p.anchor ?? root.id) : p;
      if (anchor === root) {
        // The founder hangs in front of the trunk, his partners beside him (first on his right).
        X[i] = p.mi ? slotOf(kOf(p)) * disc * 1.25 : 0;
        Z[i] = front - (p.mi ? disc * 0.15 : 0);
      } else {
        const r = radiusOf(anchor.gen);
        // Spouses keep a set world distance from their partner along the ring (inner rings are tighter).
        const th = turn(u[anchor.idx] ?? 0) + (p.mi ? (slotOf(kOf(p)) * sx) / Math.max(r, 1e-3) : 0);
        X[i] = Math.cos(th) * r;
        Z[i] = Math.sin(th) * r;
      }
    } else {
      // Each first-generation line gets its own depth, so the roots read as separate strands, and each
      // generation hangs a little nearer the viewer, so the rows stay apart when seen from above.
      let line = p;
      while (line.gen > 1 && (line.mi ? line.anchor : line.parent))
        line = M.get((line.mi ? line.anchor : line.parent) ?? root.id);
      const lane = line.gen === 0 ? 0 : ((line.idx * 7) % 3) - 1;
      X[i] = x;
      Z[i] = lane * disc * 0.9 + p.gen * disc * 1.4;
    }
    Y[i] = Hc - (drop[i] ?? 0);
    hw = Math.max(hw, Math.abs(X[i] ?? 0));
    hd = Math.max(hd, Math.abs(Z[i] ?? 0));
  }
  return { X, Y, Z, Hc, row, low, hw, hd, ring, Rmax };
}
