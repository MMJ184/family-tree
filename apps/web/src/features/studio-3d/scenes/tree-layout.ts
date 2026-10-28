import { PerspectiveCamera, Vector3 } from 'three';
import { type StudioModel, type StudioPerson, spouseIndex } from '../model.ts';
import { rng } from '../palette.ts';
import { fitView } from './tree-gl.ts';

// Living Tree layout: a Ghaf that grows upward like a classic family tree. The founder sits at the
// top of the trunk where the crown starts; every generation sits a step higher on a ring that
// opens out like a vase (a radial tidy tree, so a line of descent keeps its own sector), so the
// limbs rise from each parent and fan out as they climb. A crowded generation splits into tiers
// at alternating heights. A household (a person and their spouses) is centred in its own sector,
// the spouses beside their partner on the same tier. Pure maths, left-to-right; the scene mirrors x.

export interface GhafLayout {
  X: Float32Array;
  Y: Float32Array;
  Z: Float32Array;
  /** Ring radius, base height and tier count per generation (index = gen). */
  ring: number[];
  height: number[];
  rows: number[];
  /** Angle of each person on the crown (radians). */
  ang: Float32Array;
  /** Height of the crotch (top of the trunk, where the founder sits), the crown's outer radius, the highest portrait. */
  T: number;
  Rmax: number;
  top: number;
  /** Generation step (height between generations). */
  H: number;
  /** Each person's reach from the trunk's axis before the crown's lean. */
  reach: Float32Array;
  /** Seed of this family's tree (from the founder's id): the same family always grows the same tree. */
  seed: number;
}

export interface GhafOpts {
  /** Distance between neighbours on a ring. */
  S: number;
  /** Height between generations, as a share of S. */
  rise: number;
  /** How much wider each generation's ring is than the one below, as a share of S. */
  flare: number;
  /** Trunk height as a share of the crown's height. */
  trunk: number;
  /** Angle (x-z plane, left-to-right layout) from the crown's centre towards the default camera. */
  face: number;
  /** How irregular the tree grows: 0 is a regular vase, 1 a natural old tree (default 1). */
  wild?: number;
  /** Elevation of the default view (radians); the layout keeps portraits apart as seen from there. */
  el?: number;
  /** Visible portrait diameter (default S / 1.55). */
  disc?: number;
}

/** Stable 32-bit hash of a string (FNV-1a), to seed a person's or a family's randomness. */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const TAU = Math.PI * 2;

/** Slot of the k-th spouse relative to the partner: alternating sides, first spouse after the partner. */
const slotOf = (k: number) => (k % 2 ? -1 : 1) * (1 + Math.floor(k / 2));

export function ghafLayout(M: StudioModel, o: GhafOpts): GhafLayout {
  const { S } = o;
  const n = M.n;
  const root = M.root;
  const maxGen = Math.max(1, M.maxGen);
  let H = S * o.rise;
  const spOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) spOf.set(p.anchor, [...(spOf.get(p.anchor) ?? []), p]);
  // Spouses in wedding order.
  for (const list of spOf.values()) list.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  const slots = (p: StudioPerson) => 1 + (p === root ? 0 : (spOf.get(p.id)?.length ?? 0));
  /** Shift that centres a household's slots on its sector (in slots). */
  const shiftOf = (p: StudioPerson) => {
    const k = p === root ? 0 : (spOf.get(p.id)?.length ?? 0);
    let lo = 0;
    let hi = 0;
    for (let j = 0; j < k; j++) {
      lo = Math.min(lo, slotOf(j));
      hi = Math.max(hi, slotOf(j));
    }
    return -(lo + hi) / 2;
  };

  // The founder's partners stand in a line across him as seen from the default camera: first on his
  // right, then his left, further out in turn. Never in front of him (they would hide him).
  const lat = S * 0.95;

  // Rings open out generation by generation (fast at first, then the crown's shoulder), each wide
  // enough for its people; a crowded generation splits into tiers at alternating heights.
  const perGen: number[] = new Array(maxGen + 1).fill(0);
  for (const p of M.people) if (!p.mi) perGen[p.gen] = (perGen[p.gen] ?? 0) + slots(p);
  const ring: number[] = [0];
  const rows: number[] = [1];
  for (let g = 1; g <= maxGen; g++) {
    const prev = ring[g - 1] ?? 0;
    // Ring 1 stays narrow: the founder's partners stand a full step below it, beside him.
    const base = g === 1 ? S * o.flare * 1.2 : prev + S * o.flare * Math.max(0.55, 1 - 0.1 * (g - 1));
    let rw = 1;
    let r = base;
    for (; rw <= 4; rw++) {
      const need = ((perGen[g] ?? 0) * S) / (TAU * 0.86 * rw);
      r = Math.max(base, need);
      if (need <= base * 1.1 || rw === 4) break;
    }
    ring.push(r);
    rows.push(rw);
  }
  // Tidy radial packing: a subtree needs the larger of its own arc and its children's arcs. A single
  // person on a tiered ring needs 1/tiers of a slot (neighbours alternate tiers); a household needs
  // all its slots on its own tier.
  const own = (p: StudioPerson) => {
    if (p === root) return 0;
    const rw = rows[p.gen] ?? 1;
    const k = slots(p);
    return ((k > 1 ? k : 1 / rw) * S) / Math.max(1e-3, ring[p.gen] ?? 1);
  };
  const ext = new Map<string, number>();
  const extent = (id: string): number => {
    const p = M.get(id);
    const e = Math.max(
      own(p),
      p.kids.reduce((s, k) => s + extent(k), 0),
    );
    ext.set(id, e);
    return e;
  };
  for (let tries = 0; tries < 40; tries++) {
    const total = extent(root.id);
    if (total <= TAU * 0.96) break;
    const k = Math.min(1.2, total / (TAU * 0.96));
    for (let g = 1; g <= maxGen; g++) ring[g] = (ring[g] ?? 0) * k;
  }
  // Sector centres. Share the slack evenly between siblings so small branches do not crowd and big ones do not sprawl.
  const mid = new Float32Array(n);
  const assign = (id: string, a0: number, a1: number) => {
    const p = M.get(id);
    mid[p.idx] = (a0 + a1) / 2;
    const need = p.kids.reduce((s, k) => s + (ext.get(k) ?? 0), 0);
    const slack = Math.max(0, a1 - a0 - need) / Math.max(1, p.kids.length);
    let a = a0;
    for (const k of p.kids) {
      const w = (ext.get(k) ?? 0) + slack;
      assign(k, a, a + w);
      a += w;
    }
  };
  assign(root.id, -Math.PI, Math.PI);

  // Heights: the trunk carries the founder; each generation climbs a step higher. A wide family climbs
  // in bigger steps, so its crown keeps the upright vase shape instead of spreading flat.
  const Rmax = ring[maxGen] ?? 10;
  H = Math.max(H, (Rmax * 1.1) / maxGen);
  const T = Math.max(S * 2, maxGen * H * o.trunk);
  const height: number[] = [T + S * 0.3];
  for (let g = 1; g <= maxGen; g++) height.push(T + S * 0.3 + g * H);

  // Tiers alternate along the ring; the sequence starts after the widest gap, so the seam where two
  // neighbours share a tier has the most room.
  const tierOf = new Map<string, number>();
  for (let g = 1; g <= maxGen; g++) {
    const rw = rows[g] ?? 1;
    if (rw < 2) continue;
    const onRing = M.people.filter((p) => !p.mi && p.gen === g).sort((a, b) => (mid[a.idx] ?? 0) - (mid[b.idx] ?? 0));
    const len = onRing.length;
    let start = 0;
    let widest = -1;
    for (let i = 0; i < len; i++) {
      const a = mid[(onRing[i] as StudioPerson).idx] ?? 0;
      const b =
        i + 1 < len
          ? (mid[(onRing[i + 1] as StudioPerson).idx] ?? 0)
          : (mid[(onRing[0] as StudioPerson).idx] ?? 0) + TAU;
      if (b - a > widest) {
        widest = b - a;
        start = (i + 1) % len;
      }
    }
    onRing.forEach((p, i) => {
      tierOf.set(p.id, ((i - start + len) % len) % rw);
    });
  }
  /** Height offset of a tier: the tiers of a generation span a little under half a step. */
  const tierY = (p: StudioPerson) => {
    const rw = rows[p.gen] ?? 1;
    return rw < 2 ? 0 : ((tierOf.get(p.id) ?? 0) / (rw - 1) - 0.5) * H * 0.46;
  };

  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const Z = new Float32Array(n);
  const ang = new Float32Array(n);
  /** Radius of each person on their ring (before the lean), for spouses beside them. */
  const rad = new Float32Array(n);

  // Growth follows age, like a real tree: among siblings the eldest sits lowest and reaches furthest,
  // each younger one a little higher and shorter; across a generation the same holds by birth year
  // (both capped near a quarter of a step). Seeded noise (stable per family and person) and an uneven
  // crown outline sit on top; a child always sits clearly above its parent.
  const wild = o.wild ?? 1;
  const seed = hashId(root.id);
  const fr = rng(seed);
  const ph1 = fr() * TAU;
  const ph2 = fr() * TAU;
  // The crown's outline is uneven from one line of descent to the next (siblings share their line's).
  const outline = (a: number) => 1 + (0.07 * Math.sin(a + ph1) + 0.04 * Math.sin(2 * a + ph2)) * wild;
  const lineAng = new Map<string, number>();
  const lineOf = (p: StudioPerson) => {
    let q = p;
    while (q.parent && q.gen > 1) q = M.get(q.parent);
    return q;
  };
  const genSpan = new Map<number, [number, number]>();
  for (const p of M.people) {
    if (p.mi) continue;
    const r = genSpan.get(p.gen) ?? [p.born, p.born];
    genSpan.set(p.gen, [Math.min(r[0], p.born), Math.max(r[1], p.born)]);
  }
  /** Age in the family's eyes: 1 for the eldest (of the siblings and of the generation), -1 for the youngest. */
  const ageOf = (p: StudioPerson) => {
    const [lo, hi] = genSpan.get(p.gen) ?? [p.born, p.born];
    const uGen = hi > lo ? (p.born - lo) / (hi - lo) : 0.5;
    const sibs = p.parent ? M.get(p.parent).kids.filter((k) => !M.get(k).virt) : [p.id];
    const rank = Math.max(0, sibs.indexOf(p.id));
    const uSib = sibs.length > 1 ? rank / (sibs.length - 1) : 0.5;
    return (0.5 - (0.55 * uGen + 0.45 * uSib)) * 2;
  };
  const order = M.people.filter((p) => !p.mi).sort((a, b) => a.gen - b.gen);
  let top = T;
  for (const p of order) {
    const pr = rng(seed ^ hashId(p.id));
    const rw = rows[p.gen] ?? 1;
    const base = p === root ? 0 : (ring[p.gen] ?? 0);
    const stepR = Math.max(S, base - (ring[p.gen - 1] ?? 0));
    const age = p === root ? 0 : ageOf(p);
    // Angle: up to a sixth of a slot either way, so neighbours keep their order.
    const a0 = (mid[p.idx] ?? 0) + (base > 0 ? (shiftOf(p) * S) / base : 0);
    const a = a0 + (base > 0 ? ((pr() - 0.5) * 0.33 * S * wild) / base : 0);
    if (p.gen === 1 || p.parent === root.id) lineAng.set(p.id, a);
    const la = p === root ? a : (lineAng.get(lineOf(p).id) ?? a);
    const r = p === root ? 0 : base * outline(la) + age * 0.25 * stepR + (pr() - 0.5) * 0.06 * stepR * wild;
    // Height: elders lower, the young higher (less on a tiered ring, whose tiers already alternate).
    const amp = rw > 1 ? 0.12 : 0.25;
    let y =
      p === root ? (height[0] ?? T) : (height[p.gen] ?? T) + tierY(p) - age * amp * H + (pr() - 0.5) * 0.1 * H * wild;
    const par = p.parent ? M.get(p.parent) : null;
    if (par && !p.virt) y = Math.max(y, (Y[par.idx] ?? T) + H * 0.55);
    ang[p.idx] = a;
    const rr = Math.max(0, r);
    rad[p.idx] = rr;
    X[p.idx] = Math.cos(a) * rr;
    Z[p.idx] = Math.sin(a) * rr;
    Y[p.idx] = y;
    top = Math.max(top, y);
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = M.get(p.anchor ?? root.id);
    const list = spOf.get(a.id) ?? [p];
    const k = Math.max(0, list.indexOf(p));
    if (a === root) {
      // Screen-right of the founder is the direction face - pi/2 (left-to-right layout; Arabic mirrors it).
      const d = (1 + Math.floor(k / 2)) * lat;
      const side = k % 2 ? 1 : -1;
      const back = d * 0.22;
      X[p.idx] = Math.cos(o.face + (side * Math.PI) / 2) * d - Math.cos(o.face) * back;
      Z[p.idx] = Math.sin(o.face + (side * Math.PI) / 2) * d - Math.sin(o.face) * back;
      Y[p.idx] = (height[0] ?? T) - S * 0.1;
      ang[p.idx] = Math.atan2(Z[p.idx] ?? 0, X[p.idx] ?? 1);
      continue;
    }
    // Beside the partner at the partner's height and reach, the household centred on its sector.
    const r = Math.max(1e-3, rad[a.idx] ?? ring[a.gen] ?? 0);
    const b = (ang[a.idx] ?? 0) - (shiftOf(a) * S) / r + ((slotOf(k) + shiftOf(a)) * S) / r;
    X[p.idx] = Math.cos(b) * r;
    Z[p.idx] = Math.sin(b) * r;
    Y[p.idx] = (Y[a.idx] ?? T) - S * 0.08;
    ang[p.idx] = b;
  }
  // The crown leans a little to one side (across the default view, so the silhouette is uneven),
  // more the higher it grows; the trunk leans a touch with it.
  const lean = o.face + (fr() < 0.5 ? -1 : 1) * (Math.PI / 2) + (fr() - 0.5) * 0.6;
  const lx = Math.cos(lean);
  const lz = Math.sin(lean);
  const span = Math.max(1e-3, top - T);
  for (let i = 0; i < n; i++) {
    const y = Y[i] ?? T;
    const k = (S * 0.6 * Math.min(1, y / T) + Rmax * 0.16 * Math.max(0, (y - T) / span) ** 1.4) * wild;
    X[i] = (X[i] ?? 0) + lx * k;
    Z[i] = (Z[i] ?? 0) + lz * k;
  }
  // Keep portraits apart as seen from the default view (perspective, framed as the scene frames it):
  // where two would touch on screen, the higher one climbs and the lower one sinks a little (never
  // below its parent's step); the founder and his partners stay on the trunk. Then every child is
  // lifted back above its parent.
  const el = o.el ?? 0.66;
  const ce = Math.cos(el);
  const dirV = new Vector3(Math.cos(o.face) * ce, Math.sin(el), Math.sin(o.face) * ce);
  const half = (o.disc ?? S / 1.55) / 2;
  const radOf = (p: StudioPerson) => half * (p === root ? 1.35 : p.mi ? 0.85 : 1);
  const fixed = new Uint8Array(n);
  fixed[root.idx] = 1;
  for (const q of spOf.get(root.id) ?? []) fixed[q.idx] = 1;
  /** Lowest a person may sit: clearly above the parent. */
  const floorOf = (p: StudioPerson) => {
    const par = !p.mi && p.parent && !p.virt ? M.get(p.parent) : null;
    return par ? (Y[par.idx] ?? T) + H * 0.55 : Number.NEGATIVE_INFINITY;
  };
  const people = M.people;
  const cam = new PerspectiveCamera(42, 1.45, 0.5, 20000);
  const fpx = 300 / Math.tan((21 * Math.PI) / 180); // a 600 px tall reference stage
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sr = new Float32Array(n);
  const sd = new Float32Array(n);
  const v = new Vector3();
  const pts: Vector3[] = [];
  for (let round = 0; round < 3; round++) {
    pts.length = 0;
    for (let i = 0; i < n; i++) pts.push(new Vector3(X[i], Y[i], Z[i]));
    pts.push(new Vector3(0, 0, 0));
    const view = fitView(pts, half * 1.5, dirV, 1.45, 0.88);
    cam.position.copy(view.cam);
    cam.lookAt(view.target);
    cam.updateMatrixWorld();
    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < n; i++) {
        v.set(X[i] ?? 0, Y[i] ?? 0, Z[i] ?? 0);
        const d = Math.max(1e-3, v.distanceTo(cam.position));
        v.project(cam);
        sx[i] = v.x * 300 * 1.45;
        sy[i] = v.y * 300;
        sd[i] = d;
        sr[i] = (radOf(people[i] as StudioPerson) * fpx) / d;
      }
      let moved = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const du = (sx[i] ?? 0) - (sx[j] ?? 0);
          const dv = (sy[i] ?? 0) - (sy[j] ?? 0);
          const need = ((sr[i] ?? 0) + (sr[j] ?? 0)) * 1.1;
          if (du * du + dv * dv >= need * need) continue;
          const hiI = dv >= 0 ? i : j;
          const loI = dv >= 0 ? j : i;
          const hi = people[hiI] as StudioPerson;
          const lo = people[loI] as StudioPerson;
          const fh = fixed[hi.idx] ? 0 : 1;
          const fl = fixed[lo.idx] ? 0 : 1;
          if (!fh && !fl) continue;
          // Screen rise still needed, then the world lift that makes it (a lift of k shows as about k * ce * f / depth).
          const dvNeed = Math.sqrt(Math.max(0, need * need - du * du)) - Math.abs(dv);
          const k = (dvNeed * ((sd[hiI] ?? 1) + (sd[loI] ?? 1))) / 2 / (fpx * ce) + 1e-3;
          if (fh) Y[hi.idx] = (Y[hi.idx] ?? 0) + k * (fl ? 0.6 : 1);
          if (fl) Y[lo.idx] = Math.max(floorOf(lo), (Y[lo.idx] ?? 0) - k * (fh ? 0.4 : 1));
          moved = true;
        }
      }
      if (!moved) break;
    }
    // Every child stays clearly above its parent (top-down).
    for (const p of order) {
      if (fixed[p.idx]) continue;
      Y[p.idx] = Math.max(Y[p.idx] ?? 0, floorOf(p));
    }
  }
  for (let i = 0; i < n; i++) top = Math.max(top, Y[i] ?? 0);
  return { X, Y, Z, ring, height, rows, ang, T, Rmax, top, H, seed, reach: rad };
}
