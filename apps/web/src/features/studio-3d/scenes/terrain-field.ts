import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, Vector3 } from 'three';
import { type StudioModel, type StudioPerson, spouseIndex } from '../model.ts';
import { rng } from '../palette.ts';

// Family Atlas layout and heightfield. The founder is the summit in the middle of an island;
// each line of descent is a ridge running out from its parent, as high as the line is big
// (log of the descendant count), so large branches become mountain spurs and leaves are
// coastal hills. Heights are baked at 8 keyframe years (two RGBA half-float textures) and
// blended on the GPU, so the island rises out of the sea as births accumulate.

export const KF = 8;

export interface Atlas {
  /** Ground position per person (y is the final terrain height, sea flattened to 0). */
  at: Map<string, Vector3>;
  /** Polar position per born-in person, for trails that follow the ridges. */
  polar: Map<string, { r: number; th: number }>;
  step: number;
  /** Half size of the square map. */
  S: number;
  hMax: number;
  n: number;
  texA: DataTexture;
  texB: DataTexture;
  years: number[];
  /** Final height (bilinear) at a point, sea flattened to 0. */
  ground(x: number, z: number): number;
  /** Polar point to map xz (mirrored in RTL). */
  xz(r: number, th: number): [number, number];
}

const smax = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
};

function valueNoise(seed: number) {
  const r = rng(seed);
  const P = 64;
  const g = new Float32Array(P * P).map(() => r());
  const at = (i: number, j: number) => g[(((j % P) + P) % P) * P + (((i % P) + P) % P)] ?? 0;
  const n2 = (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    let fx = x - i;
    let fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
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

export function buildAtlas(M: StudioModel, big: boolean, rtl: boolean): Atlas {
  const G = Math.max(1, M.maxGen);
  const L = Math.max(1, M.root.leaves);
  const spacing = big ? 4.4 : 7.5;
  const step = Math.max(big ? 10 : 13, (L * spacing) / (Math.PI * 2 * G));
  const R = (g: number) => g * step;
  const mapR = R(G) + step * 0.9;
  const S = mapR * 1.06 + 4;
  const hMax = Math.min(52, Math.max(17, mapR * 0.32));
  const hLeaf = big ? 2.6 : 3.2;
  const sx = rtl ? -1 : 1;
  const xz = (r: number, th: number): [number, number] => [Math.cos(th) * r * sx, Math.sin(th) * r];

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
  const rMin = Math.max(big ? 3.4 : 4.6, (Math.PI * 2 * R(G)) / L) * 1.05;
  const rMax = step * 1.25;
  const rOf = (p: StudioPerson) => {
    if (p === M.root) return step * 1.15;
    const arc = (p.leaves / L) * Math.PI * 2 * R(p.gen);
    // Never steeper than about 50 degrees: tall lines get broad shoulders.
    return Math.max(Math.min(rMax, Math.max(rMin, arc * 0.5)), hOf(p) * 0.85);
  };

  const polar = new Map<string, { r: number; th: number }>();
  for (const p of M.people) if (!p.mi) polar.set(p.id, { r: R(p.gen), th: p.ang * Math.PI * 2 + Math.PI / 2 });

  // Stamps: bumps along every ridge path (polar interpolation parent to child).
  interface Stamp {
    x: number;
    z: number;
    r: number;
    h: number;
    born: number;
  }
  const stamps: Stamp[] = [];
  const pathPoint = (a: { r: number; th: number }, b: { r: number; th: number }, t: number) => {
    const th = a.r < 1e-3 ? b.th : a.th + (b.th - a.th) * t;
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
  // Max-stamps a bump into a grid of nn x nn cells over the map square.
  const stampInto = (s: Stamp, profile: (d2: number) => number, rr: number, arr: Float32Array, nn: number) => {
    const cc = (2 * S) / nn;
    const i0 = Math.max(0, Math.floor((s.x - rr + S) / cc));
    const i1 = Math.min(nn - 1, Math.ceil((s.x + rr + S) / cc));
    const j0 = Math.max(0, Math.floor((s.z - rr + S) / cc));
    const j1 = Math.min(nn - 1, Math.ceil((s.z + rr + S) / cc));
    const inv = 1 / (rr * rr);
    for (let j = j0; j <= j1; j++) {
      const dz = -S + (j + 0.5) * cc - s.z;
      for (let i = i0; i <= i1; i++) {
        const dx = -S + (i + 0.5) * cc - s.x;
        const d2 = (dx * dx + dz * dz) * inv;
        if (d2 >= 1) continue;
        const v = profile(d2) * s.h;
        const c = j * nn + i;
        if (v > (arr[c] ?? 0)) arr[c] = v;
      }
    }
  };
  // Each ridge goes into the first keyframe it is born by; a running max fills the later ones.
  const ridge = (d2: number) => (1 - d2) ** 2 * (1 + 0.6 * d2);
  for (const s of stamps) stampInto(s, ridge, s.r, raw[kfOf(s.born)] as Float32Array, n);
  for (let k = 1; k < KF; k++) {
    const prev = raw[k - 1] as Float32Array;
    const cur = raw[k] as Float32Array;
    for (let c = 0; c < n * n; c++) if ((prev[c] ?? 0) > (cur[c] ?? 0)) cur[c] = prev[c] ?? 0;
  }
  // Continental shelf: a wide, static falloff around the final island (bathymetry), on a coarse grid.
  const nC = 64;
  const shelfC = new Float32Array(nC * nC);
  const tail = (d2: number) => (1 - Math.sqrt(d2)) ** 1.6;
  for (const s of stamps) stampInto({ ...s, h: 1 }, tail, s.r * 2.6 + step * 0.8, shelfC, nC);
  const shelfAt = (x: number, z: number) => {
    const u = Math.max(0, Math.min(nC - 1.001, ((x + S) / (2 * S)) * nC - 0.5));
    const v = Math.max(0, Math.min(nC - 1.001, ((z + S) / (2 * S)) * nC - 0.5));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const g = (ii: number, jj: number) => shelfC[jj * nC + ii] ?? 0;
    const top = g(i, j) + (g(i + 1, j) - g(i, j)) * (u - i);
    const bot = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * (u - i);
    return top + (bot - top) * (v - j);
  };

  const n1 = valueNoise(7);
  const n2 = valueNoise(13);
  const seaD = 1.6;
  const deep = Math.max(5, hMax * 0.3);
  const out = Array.from({ length: KF }, () => new Float32Array(n * n));
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const x = -S + (i + 0.5) * cell;
      const z = -S + (j + 0.5) * cell;
      const f = 0.09 * (40 / Math.max(40, S));
      const a = n1(x * f, z * f);
      const b = n2(x * f * 3.1, z * f * 3.1);
      // Ridged noise carves gullies into the slopes.
      const rg = (1 - Math.abs(2 * n2(x * f * 1.7 + 9, z * f * 1.7 - 4) - 1)) ** 2;
      const sea = -seaD - deep * (1 - Math.min(1, shelfAt(x, z))) + (b - 0.5) * 1.2;
      for (let k = 0; k < KF; k++) {
        const r0 = (raw[k] as Float32Array)[c] ?? 0;
        const land = r0 > 0 ? r0 * (0.72 + 0.42 * a + 0.32 * rg) + (b - 0.5) * (2.2 + r0 * 0.1) - seaD * 0.9 : -99;
        (out[k] as Float32Array)[c] = smax(sea, land, 0.9);
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

  // People: born-in at their ridge point, spouses beside them along the contour.
  const at = new Map<string, Vector3>();
  for (const p of M.people) {
    const b = polar.get(p.id);
    if (!b) continue;
    const [x, z] = xz(b.r, b.th);
    at.set(p.id, new Vector3(x, ground(x, z), z));
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = (p.anchor ? polar.get(p.anchor) : undefined) ?? { r: 0, th: Math.PI / 2 };
    const i = spouseIndex(M, p);
    const gap = (big ? 2.3 : 3.4) * (a.r < 1 ? 1.6 : 1) * (1 + Math.floor(i / 2));
    const side = i % 2 ? -1 : 1;
    const [ax, az] = xz(a.r, a.th);
    let tx = -Math.sin(a.th) * sx;
    let tz = Math.cos(a.th);
    if (a.r < 1) {
      tx = 1;
      tz = 0;
    }
    const x = ax + tx * gap * side;
    const z = az + tz * gap * side;
    at.set(p.id, new Vector3(x, ground(x, z), z));
  }
  return { at, polar, step, S, hMax, n, texA: tex(0), texB: tex(4), years, ground, xz };
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
