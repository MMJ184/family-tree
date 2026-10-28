import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, Vector3 } from 'three';
import { type StudioModel, type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';

// Family Atlas layout and heightfield. The founder is the summit in the middle of an island;
// each line of descent is a ridge running out from its parent, as high as the line is big
// (log of the descendant count), so large branches become mountain spurs and leaves are
// coastal hills. Every generation stands on its own ring around the summit; spouses stand
// beside their partner on a shoulder of the same ridge, and each ring is packed so that no two
// portraits (spouses included) touch. Heights are baked at 8 keyframe years (two RGBA half-float
// textures) and blended on the GPU, so the island rises out of the sea as births accumulate.
// Under the sea the height is minus the distance from that keyframe's coast, which the shader
// reads back to draw cartographic waterlines that follow the coast as the island grows.

export const KF = 8;

/** Sea floor just off the coast, and its drop per world unit of distance from the coast. */
export const SEA0 = 0.35;
export const SLOPE = 0.3;

export interface Atlas {
  /** Ground position per person (y is the final terrain height, sea flattened to 0). */
  at: Map<string, Vector3>;
  /** Polar position per born-in person, for trails that follow the ridges. */
  polar: Map<string, { r: number; th: number }>;
  step: number;
  /** Half size of the square map. */
  S: number;
  /** Radius of the island (outermost ring plus a coastal margin). */
  mapR: number;
  hMax: number;
  n: number;
  texA: DataTexture;
  texB: DataTexture;
  years: number[];
  /** Final height (bilinear) at a point, sea flattened to 0. */
  ground(x: number, z: number): number;
  /** Polar point to map xz (mirrored in RTL). */
  xz(r: number, th: number): [number, number];
  /** Point at t (0..1) on the ridge path from a parent to a child (shared by the stamps and the trails). */
  path(a: { r: number; th: number }, b: { r: number; th: number }, t: number): [number, number];
}

const TAU = Math.PI * 2;

const smax = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
};

function valueNoise(seed: number) {
  const r = rng(seed);
  const P = 64;
  const g = new Float32Array(P * P).map(() => r());
  // The table wraps every 64 cells (a bit mask, also right for negative cells).
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const i0 = xi & 63;
    const i1 = (xi + 1) & 63;
    const j0 = (yi & 63) * P;
    const j1 = ((yi + 1) & 63) * P;
    const a0 = g[j0 + i0] ?? 0;
    const b0 = g[j1 + i0] ?? 0;
    const a = a0 + ((g[j0 + i1] ?? 0) - a0) * fx;
    const b = b0 + ((g[j1 + i1] ?? 0) - b0) * fx;
    return a + (b - a) * fy;
  };
  return (x: number, y: number) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      s += n2(x * f, y * f) * a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / 0.9375;
  };
}

/**
 * Places a ring of people at angles as close as possible to their targets while keeping the
 * required gap between neighbours (gaps[i] sits between list item i and i + 1, the last one
 * wraps round to item 0). The circle is cut at its loosest gap and solved as an isotonic
 * regression (pool adjacent violators), which moves people the least overall.
 */
function packRing(targets: number[], gaps: number[]): number[] {
  const m = targets.length;
  if (m < 2) return targets.slice();
  let cut = m - 1;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < m; i++) {
    const a = targets[i] ?? 0;
    const b = i === m - 1 ? (targets[0] ?? 0) + TAU : (targets[i + 1] ?? 0);
    const slack = b - a - (gaps[i] ?? 0);
    if (slack > best) {
      best = slack;
      cut = i;
    }
  }
  const start = (cut + 1) % m;
  const order: number[] = [];
  const u: number[] = [];
  const c: number[] = [];
  let acc = 0;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % m;
    order.push(i);
    u.push((targets[i] ?? 0) + (start + k >= m ? TAU : 0));
    c.push(acc);
    acc += gaps[i] ?? 0;
  }
  // Pool adjacent violators on y = u - c (must be non-decreasing).
  const val: number[] = [];
  const wt: number[] = [];
  const len: number[] = [];
  for (let k = 0; k < m; k++) {
    val.push((u[k] ?? 0) - (c[k] ?? 0));
    wt.push(1);
    len.push(1);
    while (val.length > 1 && (val[val.length - 2] ?? 0) > (val[val.length - 1] ?? 0)) {
      const v1 = val.pop() ?? 0;
      const w1 = wt.pop() ?? 1;
      const l1 = len.pop() ?? 1;
      const j = val.length - 1;
      const w0 = wt[j] ?? 1;
      val[j] = ((val[j] ?? 0) * w0 + v1 * w1) / (w0 + w1);
      wt[j] = w0 + w1;
      len[j] = (len[j] ?? 1) + l1;
    }
  }
  const x: number[] = new Array(m).fill(0);
  let k = 0;
  val.forEach((v, j) => {
    for (let q = 0; q < (len[j] ?? 1); q++, k++) x[k] = v + (c[k] ?? 0);
  });
  // The wrap gap (between the last and the first) must hold too; if pooling ate it, close the ring evenly.
  const wrapNeed = gaps[cut] ?? 0;
  if ((x[0] ?? 0) + TAU - (x[m - 1] ?? 0) < wrapNeed) {
    const mean = u.reduce((s, v) => s + v, 0) / m;
    const cm = c.reduce((s, v) => s + v, 0) / m;
    for (let q = 0; q < m; q++) x[q] = mean + (c[q] ?? 0) - cm;
  }
  const out: number[] = new Array(m).fill(0);
  order.forEach((i, q) => {
    out[i] = x[q] ?? 0;
  });
  return out;
}

/** Euclidean distance (in cells) from every cell to the nearest set cell of the mask (8SSEDT). */
function distanceField(mask: Uint8Array, n: number, dx: Float32Array, dy: Float32Array, out: Float32Array) {
  const FAR = 1e5;
  for (let c = 0; c < n * n; c++) {
    const on = mask[c] === 1;
    dx[c] = on ? 0 : FAR;
    dy[c] = on ? 0 : FAR;
  }
  const test = (c: number, o: number, ox: number, oy: number) => {
    const x = (dx[o] ?? FAR) + ox;
    const y = (dy[o] ?? FAR) + oy;
    const cx = dx[c] ?? FAR;
    const cy = dy[c] ?? FAR;
    if (x * x + y * y < cx * cx + cy * cy) {
      dx[c] = x;
      dy[c] = y;
    }
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if (i > 0) test(c, c - 1, -1, 0);
      if (j > 0) {
        test(c, c - n, 0, -1);
        if (i > 0) test(c, c - n - 1, -1, -1);
        if (i < n - 1) test(c, c - n + 1, 1, -1);
      }
    }
    for (let i = n - 2; i >= 0; i--) test(j * n + i, j * n + i + 1, 1, 0);
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const c = j * n + i;
      if (i < n - 1) test(c, c + 1, 1, 0);
      if (j < n - 1) {
        test(c, c + n, 0, 1);
        if (i < n - 1) test(c, c + n + 1, 1, 1);
        if (i > 0) test(c, c + n - 1, -1, 1);
      }
    }
    for (let i = 1; i < n; i++) test(j * n + i, j * n + i - 1, -1, 0);
  }
  for (let c = 0; c < n * n; c++) {
    const x = dx[c] ?? FAR;
    const y = dy[c] ?? FAR;
    out[c] = Math.sqrt(x * x + y * y);
  }
}

export function buildAtlas(M: StudioModel, big: boolean, rtl: boolean, size: number): Atlas {
  const G = Math.max(1, M.maxGen);
  const L = Math.max(1, M.root.leaves);
  const spacing = big ? 4.4 : 7.5;
  const sx = rtl ? -1 : 1;
  const xz = (r: number, th: number): [number, number] => [Math.cos(th) * r * sx, Math.sin(th) * r];

  // ---- Footprints: portrait radius, and the room spouses take beside their partner ----
  // Oblique views shorten distances along the line of sight, so spacing carries a margin (F).
  const F = 1.4;
  const air = size * 0.32;
  const rad = (p: StudioPerson) => size * sizeFactor(p) * 0.86;
  const rS = size * 0.85 * 0.86;
  const wives = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) wives.set(p.anchor, [...(wives.get(p.anchor) ?? []), p]);
  for (const list of wives.values()) list.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  /** Distance along the ring from a person to their j-th spouse on one side. */
  const offset = (a: StudioPerson, j: number) => F * (rad(a) + rS + air + j * (2 * rS + air));
  const reach = (a: StudioPerson, side: 1 | -1) => {
    const k = wives.get(a.id)?.length ?? 0;
    const count = side > 0 ? Math.ceil(k / 2) : Math.floor(k / 2);
    return count ? offset(a, count - 1) + F * rS : F * rad(a);
  };

  // ---- Rings: target angles from the tree's leaf sectors, then packed so nobody touches ----
  const rings = new Map<number, StudioPerson[]>();
  for (const p of M.people) if (!p.mi && p !== M.root) rings.set(p.gen, [...(rings.get(p.gen) ?? []), p]);
  const target = (p: StudioPerson) => p.ang * TAU + Math.PI / 2;
  let step = Math.max(big ? 10 : 13, (L * spacing) / (TAU * G));
  const ringGaps = new Map<number, number[]>();
  for (const [g, list] of rings) {
    list.sort((a, b) => target(a) - target(b));
    const gaps = list.map((p, i) => {
      const q = list[(i + 1) % list.length] as StudioPerson;
      return list.length < 2 ? 0 : reach(p, 1) + reach(q, -1) + F * air;
    });
    ringGaps.set(g, gaps);
    const total = gaps.reduce((s, v) => s + v, 0);
    step = Math.max(step, total / (TAU * g * 0.92));
  }
  const R = (g: number) => g * step;
  const polar = new Map<string, { r: number; th: number }>();
  polar.set(M.root.id, { r: 0, th: Math.PI / 2 });
  for (const [g, list] of rings) {
    const r = R(g);
    const gaps = (ringGaps.get(g) ?? []).map((v) => v / r);
    const th = packRing(
      list.map((p) => target(p)),
      gaps,
    );
    list.forEach((p, i) => {
      // Packing works on an unwrapped circle: bring each angle back next to its target, so a trail
      // from a parent to a child never runs the long way round the island.
      const t0 = target(p);
      let a = th[i] ?? t0;
      while (a - t0 > Math.PI) a -= TAU;
      while (a - t0 < -Math.PI) a += TAU;
      polar.set(p.id, { r, th: a });
    });
  }
  const mapR = R(G) + step * 0.9;
  const S = mapR * 1.06 + 4;
  const hMax = Math.min(52, Math.max(17, mapR * 0.32));
  const hLeaf = big ? 2.6 : 3.2;

  // Descendant counts along the layout tree.
  const desc = new Map<string, number>();
  const count = (p: StudioPerson): number => {
    let c = 0;
    for (const k of p.kids) c += 1 + count(M.get(k));
    desc.set(p.id, c);
    return c;
  };
  const dRoot = Math.max(1, count(M.root));
  const hOf = (p: StudioPerson) =>
    p === M.root ? hMax : hLeaf + (hMax - hLeaf) * (Math.log1p(desc.get(p.id) ?? 0) / Math.log1p(dRoot)) ** 1.15;
  const rMin = Math.max(big ? 3.4 : 4.6, (TAU * R(G)) / L) * 1.05;
  const rMax = step * 1.25;
  const rOf = (p: StudioPerson) => {
    if (p === M.root) return step * 1.15;
    const arc = (p.leaves / L) * TAU * R(p.gen);
    // Never steeper than about 50 degrees: tall lines get broad shoulders.
    return Math.max(Math.min(rMax, Math.max(rMin, arc * 0.5)), hOf(p) * 0.85);
  };

  // ---- Spouse places: beside their partner along the same ring (around the summit for the founder) ----
  const spot = new Map<string, { x: number; z: number }>();
  for (const [id, list] of wives) {
    const a = M.get(id);
    const pa = polar.get(id);
    if (!pa) continue;
    if (pa.r < 1e-3) {
      // Founder: spouses evenly round the summit, turned to sit between the first ridges.
      const k = list.length;
      const r0 = Math.max(offset(a, 0), (k * F * (2 * rS + air)) / TAU);
      const ridges = (rings.get(1) ?? []).map((p) => polar.get(p.id)?.th ?? 0);
      let bestRot = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let s = 0; s < 48; s++) {
        const rot = (s / 48) * (TAU / k);
        let score = Number.POSITIVE_INFINITY;
        for (let i = 0; i < k; i++) {
          const th = Math.PI / 2 + rot + (i * TAU) / k;
          for (const q of ridges) {
            const d = Math.abs(((th - q + Math.PI) % TAU) - Math.PI);
            score = Math.min(score, d);
          }
        }
        if (!ridges.length) score = -Math.abs(rot);
        if (score > bestScore) {
          bestScore = score;
          bestRot = rot;
        }
      }
      list.forEach((p, i) => {
        const [x, z] = xz(r0, Math.PI / 2 + bestRot + (i * TAU) / k);
        spot.set(p.id, { x, z });
      });
      continue;
    }
    list.forEach((p, i) => {
      const side = i % 2 ? -1 : 1;
      const th = pa.th + (side * offset(a, Math.floor(i / 2))) / pa.r;
      const [x, z] = xz(pa.r, th);
      spot.set(p.id, { x, z });
    });
  }

  // ---- Stamps: bumps along every ridge path (polar interpolation parent to child) ----
  interface Stamp {
    x: number;
    z: number;
    r: number;
    h: number;
    born: number;
  }
  const stamps: Stamp[] = [];
  // Ridge path: out from the parent first, sweeping round in the middle and arriving square to the child's
  // ring, so siblings share one spur before it forks.
  const pathPoint = (a: { r: number; th: number }, b: { r: number; th: number }, t: number) => {
    const e = t * t * (3 - 2 * t);
    const th = a.r < 1e-3 ? b.th : a.th + (b.th - a.th) * e;
    return xz(a.r + (b.r - a.r) * t, th);
  };
  for (const p of M.people) {
    if (p.mi) continue;
    const b = polar.get(p.id);
    if (!b) continue;
    const h = hOf(p);
    const r = rOf(p);
    const [x, z] = xz(b.r, b.th);
    stamps.push({ x, z, r, h, born: p.born });
    if (!p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const a = polar.get(par.id);
    if (!a) continue;
    const hp = hOf(par);
    const rp = Math.min(rOf(par), r * 1.6);
    const len = Math.hypot(b.r - a.r, ((a.r + b.r) / 2) * (b.th - a.th));
    const segs = Math.max(3, Math.ceil(len / (r * 0.35)));
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const [px, pz] = pathPoint(a, b, t);
      // Ridge sags a little between the two people.
      const sag = 1 - 0.12 * Math.sin(Math.PI * t);
      stamps.push({ x: px, z: pz, r: rp + (r - rp) * t, h: (hp + (h - hp) * t ** 0.8) * sag, born: p.born });
    }
  }
  // Spouses stand on a shoulder of their partner's hill (raised from the wedding year) where the partner's
  // own hill would leave them low on its flank; broad, high hills already carry them.
  for (const p of M.people) {
    const sp = spot.get(p.id);
    if (!sp || !p.anchor) continue;
    const a = M.get(p.anchor);
    const pa = polar.get(a.id);
    if (!pa) continue;
    const [ax, az] = xz(pa.r, pa.th);
    const d = Math.hypot(sp.x - ax, sp.z - az);
    const ra = rOf(a);
    if ((d / ra) ** 2 < 0.12) continue;
    const r = Math.max(rS * 2.4, d * 0.95);
    const h = Math.min(hOf(a) * 0.82, r * 1.05);
    const segs = Math.max(1, Math.ceil(d / (r * 0.45)));
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      stamps.push({
        x: ax + (sp.x - ax) * t,
        z: az + (sp.z - az) * t,
        r,
        h: h * (1 - 0.08 * t),
        born: spouseYear(M, p),
      });
    }
  }

  // Keyframe years: before the founder, just after, then birth quantiles.
  const births = M.people
    .filter((p) => !p.mi)
    .map((p) => p.born)
    .sort((a, b) => a - b);
  const first = births[0] ?? M.minYear;
  const last = births[births.length - 1] ?? first;
  const years = [first - 4, first + 2];
  for (let k = 2; k < KF; k++) {
    const q = births[Math.min(births.length - 1, Math.ceil((k / (KF - 1)) * births.length) - 1)] ?? last;
    years.push(Math.max(q, (years[k - 1] ?? first) + 1));
  }

  const n = big ? 320 : 256;
  const cell = (2 * S) / n;
  const raw = Array.from({ length: KF }, () => new Float32Array(n * n));
  const kfOf = (born: number) => {
    let k = 1;
    while (k < KF && (years[k] ?? 0) < born) k++;
    return k;
  };
  // Max-stamps a bump into the grid.
  const stampInto = (s: Stamp, arr: Float32Array) => {
    const rr = s.r;
    const i0 = Math.max(0, Math.floor((s.x - rr + S) / cell));
    const i1 = Math.min(n - 1, Math.ceil((s.x + rr + S) / cell));
    const j0 = Math.max(0, Math.floor((s.z - rr + S) / cell));
    const j1 = Math.min(n - 1, Math.ceil((s.z + rr + S) / cell));
    const inv = 1 / (rr * rr);
    for (let j = j0; j <= j1; j++) {
      const dz = -S + (j + 0.5) * cell - s.z;
      for (let i = i0; i <= i1; i++) {
        const dx = -S + (i + 0.5) * cell - s.x;
        const d2 = (dx * dx + dz * dz) * inv;
        if (d2 >= 1) continue;
        const v = (1 - d2) ** 2 * (1 + 0.6 * d2) * s.h;
        const c = j * n + i;
        if (v > (arr[c] ?? 0)) arr[c] = v;
      }
    }
  };
  // Each ridge goes into the first keyframe it is born by; a running max fills the later ones.
  for (const s of stamps) stampInto(s, raw[kfOf(s.born)] as Float32Array);
  for (let k = 1; k < KF; k++) {
    const prev = raw[k - 1] as Float32Array;
    const cur = raw[k] as Float32Array;
    for (let c = 0; c < n * n; c++) if ((prev[c] ?? 0) > (cur[c] ?? 0)) cur[c] = prev[c] ?? 0;
  }

  // Land: ridges roughened by noise, with ridged noise carving gullies into the slopes.
  const n1 = valueNoise(7);
  const n2 = valueNoise(13);
  const seaD = 1.6;
  const f = 0.09 * (40 / Math.max(40, S));
  const nA = new Float32Array(n * n);
  const nB = new Float32Array(n * n);
  const nR = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const x = -S + (i + 0.5) * cell;
      const z = -S + (j + 0.5) * cell;
      nA[c] = n1(x * f, z * f);
      nB[c] = n2(x * f * 3.1, z * f * 3.1);
      nR[c] = (1 - Math.abs(2 * n2(x * f * 1.7 + 9, z * f * 1.7 - 4) - 1)) ** 2;
    }
  // Sea: the floor drops with the distance from each keyframe's coast (waterlines follow the growing island).
  const out = Array.from({ length: KF }, () => new Float32Array(n * n));
  const land = new Float32Array(n * n);
  const mask = new Uint8Array(n * n);
  const dist = new Float32Array(n * n);
  const tx = new Float32Array(n * n);
  const ty = new Float32Array(n * n);
  for (let k = 0; k < KF; k++) {
    const rk = raw[k] as Float32Array;
    for (let c = 0; c < n * n; c++) {
      const r0 = rk[c] ?? 0;
      const b = nB[c] ?? 0;
      land[c] =
        r0 > 0
          ? r0 * (0.72 + 0.42 * (nA[c] ?? 0) + 0.32 * (nR[c] ?? 0)) + (b - 0.5) * (1.3 + r0 * 0.12) - seaD * 0.9
          : -99;
      mask[c] = (land[c] ?? -99) > 0 ? 1 : 0;
    }
    distanceField(mask, n, tx, ty, dist);
    // A light tent blur (1 2 1, both ways) rounds the cell steps off the distance.
    for (let j = 0; j < n; j++) {
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const l = dist[row + Math.max(0, i - 1)] ?? 0;
        const r = dist[row + Math.min(n - 1, i + 1)] ?? 0;
        tx[row + i] = (l + 2 * (dist[row + i] ?? 0) + r) * 0.25;
      }
    }
    const ok = out[k] as Float32Array;
    for (let j = 0; j < n; j++) {
      const up = Math.max(0, j - 1) * n;
      const dn = Math.min(n - 1, j + 1) * n;
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const b = ((tx[up + i] ?? 0) + 2 * (tx[row + i] ?? 0) + (tx[dn + i] ?? 0)) * 0.25;
        const d = Math.min(S * 2, b * cell);
        ok[row + i] = smax(-(SEA0 + SLOPE * d), land[row + i] ?? -99, 0.5);
      }
    }
  }

  const tex = (k0: number) => {
    const d = new Uint16Array(n * n * 4);
    for (let c = 0; c < n * n; c++)
      for (let ch = 0; ch < 4; ch++) d[c * 4 + ch] = DataUtils.toHalfFloat((out[k0 + ch] as Float32Array)[c] ?? 0);
    const t = new DataTexture(d, n, n, RGBAFormat, HalfFloatType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const fin = out[KF - 1] as Float32Array;
  const ground = (x: number, z: number) => {
    const u = Math.max(0, Math.min(n - 1.001, (x + S) / cell - 0.5));
    const v = Math.max(0, Math.min(n - 1.001, (z + S) / cell - 0.5));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const h = (ii: number, jj: number) => fin[jj * n + ii] ?? 0;
    const top = h(i, j) + (h(i + 1, j) - h(i, j)) * fu;
    const bot = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * fu;
    return Math.max(0, top + (bot - top) * fv);
  };

  // People: born-in at their ridge point, spouses at their place beside them.
  const at = new Map<string, Vector3>();
  for (const p of M.people) {
    const b = polar.get(p.id);
    const s = spot.get(p.id);
    let x: number;
    let z: number;
    if (b) [x, z] = xz(b.r, b.th);
    else if (s) ({ x, z } = s);
    else [x, z] = [0, 0];
    at.set(p.id, new Vector3(x, ground(x, z), z));
  }
  return { at, polar, step, S, mapR, hMax, n, texA: tex(0), texB: tex(4), years, ground, xz, path: pathPoint };
}

/** Blend weights for the 8 keyframes at a given year (piecewise linear). */
// Reused every frame by kfWeights, so the time slider allocates nothing.
const W = new Array<number>(KF).fill(0);

export function kfWeights(years: number[], yr: number, wa: number[], wb: number[]) {
  const w = W.fill(0);
  const y0 = years[0] ?? 0;
  const yN = years[KF - 1] ?? 0;
  if (yr <= y0) w[0] = 1;
  else if (yr >= yN) w[KF - 1] = 1;
  else
    for (let k = 0; k < KF - 1; k++) {
      const a = years[k] ?? 0;
      const b = years[k + 1] ?? 0;
      if (yr >= a && yr < b) {
        const t = (yr - a) / Math.max(1e-3, b - a);
        w[k] = 1 - t;
        w[k + 1] = t;
        break;
      }
    }
  for (let k = 0; k < 4; k++) {
    wa[k] = w[k] ?? 0;
    wb[k] = w[k + 4] ?? 0;
  }
}
