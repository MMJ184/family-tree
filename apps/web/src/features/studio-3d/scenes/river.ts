import {
  AddEquation,
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
  ZeroFactor,
} from 'three';
import { NOISE } from '../gl.ts';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, NOW, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import type { SceneBuilder } from './types.ts';

// Time River: time becomes distance. Each life is a stream running from birth (or marriage)
// to death or today; a child's stream forks off the parents' streams at the child's birth
// and bends into its own lane; a spouse arrives as a gold tributary. Parents sit in the
// middle of their descendants (in-order lanes), so forks never cross other lives, and a
// river bed (the band every living life flows in) widens generation by generation like a
// delta in time. Dark: a river of light on black with silver decade marks. Light: blue ink
// on a white map with grey decade lines. Close up: current lines, ripples, year ticks, and a
// landmark where each business was founded. In Arabic the river runs right to left (earliest
// on the right, spec decision #10): every x goes through X(), which carries the direction.
// Draw calls: dome, map, bed, decade numbers, streams, markers, "now" curtain.

interface RiverLook {
  night: boolean;
  /** Map centre and stage edge (shown colours: the ACES output pass is inverted for them). */
  bg: string;
  edge: string;
  /** Decade lines, year ticks, decade numbers and the "now" line. */
  grid: string;
  tick: string;
  text: string;
  now: string;
  /**
   * Signature colours: a life in progress (banks and lines), a life that has ended, the water inside wide
   * streams, and the current (light pulses by night, fine current lines by day).
   */
  life: string;
  past: string;
  water: string;
  /** The river bed: the band every living life flows in at a given year. */
  bed: string;
  bank: string;
  flow: string;
  /** Marriages (gold) and the selected lineage (teal), as in the rest of the studio. */
  gold: string;
  teal: string;
  bloom: number;
  exposure: number;
}

const LOOK: { dark: RiverLook; light: RiverLook } = {
  dark: {
    night: true,
    bg: '#111111',
    edge: '#000000',
    grid: '#2e3033',
    tick: '#232427',
    text: '#8f959c',
    now: '#6f7780',
    life: '#c4d4e7',
    past: '#5b6572',
    water: '#1a2c44',
    bed: '#0c1219',
    bank: '#2a333f',
    flow: '#a3c8f2',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    bloom: 0.55,
    exposure: 1,
  },
  light: {
    night: false,
    bg: '#fafafa',
    edge: '#ececec',
    grid: '#e1e1e1',
    tick: '#e6e6e6',
    text: '#7a7a7a',
    now: '#3b3b3b',
    life: '#3166a6',
    past: '#93abc8',
    water: '#d5e3f3',
    bed: '#eef3f9',
    bank: '#b9cce2',
    flow: '#5f8cc2',
    gold: '#b7862c',
    teal: '#0f6b63',
    bloom: 0,
    exposure: 1,
  },
};

// ---- colour: the output pass tone-maps with ACES, so solve for the scene colour that shows as a given hex ----
const rrtOdt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const sat = (v: number) => Math.min(1, Math.max(0, v));
const toned = new Color();
function aces(r0: number, g0: number, b0: number, e: number) {
  const k = e / 0.6;
  const r = r0 * k;
  const g = g0 * k;
  const b = b0 * k;
  const a = rrtOdt(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const m = rrtOdt(0.076 * r + 0.90834 * g + 0.01566 * b);
  const c = rrtOdt(0.0284 * r + 0.13383 * g + 0.83777 * b);
  toned.r = sat(1.60475 * a - 0.53108 * m - 0.07367 * c);
  toned.g = sat(-0.10208 * a + 1.10813 * m - 0.00605 * c);
  toned.b = sat(-0.00327 * a - 0.07276 * m + 1.07602 * c);
}
/** Linear scene colour that the tone-mapped output shows as `hex` at exposure `e`. */
function shown(hex: string, e: number, out: Color): Color {
  const t = lin(hex);
  let r = t.r;
  let g = t.g;
  let b = t.b;
  for (let i = 0; i < 240; i++) {
    aces(r, g, b, e);
    r = Math.max(0, r + (t.r - toned.r) * (1 + r) * 0.8);
    g = Math.max(0, g + (t.g - toned.g) * (1 + g) * 0.8);
    b = Math.max(0, b + (t.b - toned.b) * (1 + b) * 0.8);
  }
  return out.setRGB(r, g, b);
}

const HIDE = 'gl_Position = vec4(0., 0., -2., 1.);';
/**
 * Day: ink on paper. The paper is brighter than 1.0 (so ACES shows it white), where plain alpha blending
 * would wash every soft edge out to white; instead the framebuffer is multiplied by (ink / paper) ^ coverage
 * (see setBlend), which mixes in log space like real ink and darkens where streams overlap.
 */
const INK = /* glsl */ `uniform vec3 uPaper;
  vec4 inked(vec3 ink, float a) { return vec4(pow(clamp(ink / uPaper, 1e-4, 1.), vec3(clamp(a, 0., 1.))), 1.); }`;

/** Night streams add light; day streams multiply the paper (see INK). */
function setBlend(m: ShaderMaterial, night: boolean) {
  if (night) m.blending = AdditiveBlending;
  else {
    m.blending = CustomBlending;
    m.blendEquation = AddEquation;
    m.blendSrc = DstColorFactor;
    m.blendDst = ZeroFactor;
    m.blendSrcAlpha = ZeroFactor;
    m.blendDstAlpha = OneFactor;
  }
  m.needsUpdate = true;
}
const FRONT = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter); float front = uDir * (yr - uMid) * uK;`;

interface Strip {
  pos: number[];
  n: number[];
  hw: number[];
  s: number[];
  l: number[];
  kind: number[];
  died: number[];
  seed: number[];
  /** Event year (birth or wedding) and position along a curved part (0..1, -1 on straight runs). */
  ev: number[];
  g: number[];
  key: string[];
  idx: number[];
}

type P2 = [number, number];

/** Cubic Bezier in the map plane. */
function bez(a: P2, b: P2, c: P2, d: P2, segs: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return out;
}

export const riverScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const rnd = rng(31);

  // ---- lanes: parents in the middle of their descendants (in-order), spouses close beside their partner ----
  const spousesOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) spousesOf.set(p.anchor, [...(spousesOf.get(p.anchor) ?? []), p]);
  for (const list of spousesOf.values()) list.sort((a, b) => spouseYear(M, a) - spouseYear(M, b));
  interface Entry {
    id: string;
    spouse: boolean;
  }
  const placed = new Set<string>();
  const spouseChain = (s: StudioPerson): Entry[] => {
    placed.add(s.id);
    const out: Entry[] = [{ id: s.id, spouse: true }];
    for (const t of spousesOf.get(s.id) ?? []) if (!placed.has(t.id)) out.push(...spouseChain(t));
    return out;
  };
  const block = (id: string): Entry[] => {
    placed.add(id);
    const p = M.get(id);
    // Spouses alternate sides (the first one above); with two or more, each child sits on its mother's side.
    const sideOf = new Map<string, number>();
    let j = 0;
    for (const s of spousesOf.get(id) ?? []) if (!placed.has(s.id)) sideOf.set(s.id, j++ % 2 === 0 ? -1 : 1);
    const above: Entry[][] = [];
    const below: Entry[][] = [];
    let i = 0;
    for (const k of p.kids) {
      if (placed.has(k)) continue;
      const mom = M.get(k)
        .parents.map((q) => M.byId.get(q))
        .find((q) => q?.mi && q.anchor === id);
      const side = (sideOf.size > 1 && mom ? sideOf.get(mom.id) : undefined) ?? (i++ % 2 === 0 ? 1 : -1);
      (side > 0 ? below : above).push(block(k));
    }
    const up: Entry[][] = [];
    const down: Entry[][] = [];
    for (const s of spousesOf.get(id) ?? []) {
      if (placed.has(s.id)) continue;
      ((sideOf.get(s.id) ?? 1) < 0 ? up : down).push(spouseChain(s));
    }
    // The eldest child sits outermost, so a younger sibling's fork never crosses an older sibling's stream.
    return [...above.flat(), ...up.reverse().flat(), { id, spouse: false }, ...down.flat(), ...below.reverse().flat()];
  };
  const order = block(M.root.id);
  for (const p of M.people) if (!placed.has(p.id)) order.push(...(p.mi ? spouseChain(p) : block(p.id)));

  const SG = 0.6; // a spouse's lane sits this share of a lane from its neighbours
  let units = 0;
  order.forEach((e, i) => {
    const prev = order[i - 1];
    if (prev) units += prev.spouse || e.spouse ? SG : 1;
  });
  const rawUnits = units;
  units = Math.max(1, units);
  const y0 = Math.min(M.minYear, NOW) - 4;
  const years = Math.max(5, NOW + 1 - y0);
  // Lane width and time scale are chosen together so the river frames well (about 1.5 : 1 on screen).
  const L = big ? 0.82 : Math.min(4.4, Math.max(2.5, (years * 0.95) / (1.2 * units)));
  const depth = units * L;
  const k = Math.min(2.6, Math.max(0.95, (1.2 * depth) / years));
  const mid = (y0 + NOW + 1) / 2;
  const X = (y: number) => dir * (y - mid) * k;
  const yearAt = (x: number) => mid + (dir * x) / k;
  const zOf = new Map<string, number>();
  let zz = 0;
  order.forEach((e, i) => {
    const prev = order[i - 1];
    if (prev) zz += (prev.spouse || e.spouse ? SG : 1) * L;
    zOf.set(e.id, zz - (rawUnits * L) / 2);
  });
  const laneZ = (id: string | null | undefined) => (id ? zOf.get(id) : undefined) ?? 0;
  const zMin = -depth / 2;
  const zMax = depth / 2;

  // ---- stream widths follow how many lives flow on through each person (thick trunk, fine twigs) ----
  const desc = new Map<string, number>();
  const count = (id: string): number => {
    const p = M.get(id);
    const v = 1 + p.kids.reduce((s, kid) => s + count(kid), 0);
    desc.set(id, v);
    return v;
  };
  const dMax = count(M.root.id);
  const hwOf = (p: StudioPerson) =>
    p.mi
      ? L * (big ? 0.065 : 0.085)
      : L * ((big ? 0.07 : 0.09) + (big ? 0.16 : 0.27) * Math.sqrt((desc.get(p.id) ?? 1) / dMax));

  // ---- portraits: at the start of each life on its lane; nudged later in time where two would touch ----
  const size = big ? 1.05 : Math.min(2.4, Math.max(1.2, L * 0.8));
  const lift = size * 1.15 + 0.35;
  const startYear = (p: StudioPerson) => (p.mi ? spouseYear(M, p) : p.born);
  const endYear = (p: StudioPerson) => Math.max(startYear(p) + 0.5, p.died ?? NOW);
  const px = new Float32Array(M.n);
  M.people.forEach((p, i) => {
    px[i] = X(startYear(p));
  });
  const rad = (p: StudioPerson) => 0.8 * size * sizeFactor(p);
  const cell = 2.4 * size * 1.35 + 0.5;
  const hash = new Map<string, number[]>();
  const byTime = [...M.people].sort((a, b) => startYear(a) - startYear(b));
  for (const p of byTime) {
    const z = laneZ(p.id);
    const r = rad(p);
    let x = px[p.idx] ?? 0;
    const xEnd = X(endYear(p));
    for (let it = 0; it < 30; it++) {
      let push = 0;
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const q of hash.get(`${cx + a},${cz + b}`) ?? []) {
            const o = M.people[q];
            if (!o) continue;
            const need = r + rad(o) + 0.15;
            const dz = Math.abs(laneZ(o.id) - z);
            const dx = dir * (x - (px[q] ?? 0));
            if (dz >= need || Math.abs(dx) >= need) continue;
            const clear = Math.sqrt(need * need - dz * dz);
            if (Math.abs(dx) < clear) push = Math.max(push, clear - dx + 0.05);
          }
      if (push <= 0 || dir * (x + dir * push - xEnd) > 0) break;
      x += dir * push;
    }
    px[p.idx] = x;
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    hash.set(key, [...(hash.get(key) ?? []), p.idx]);
  }
  const pos = new Float32Array(M.n * 3);
  const appear = new Float32Array(M.n);
  M.people.forEach((p, i) => {
    const x = px[i] ?? 0;
    pos.set([x, lift, laneZ(p.id)], i * 3);
    appear[i] = yearAt(x);
  });

  // ---- streams ----
  const S: Strip = {
    pos: [],
    n: [],
    hw: [],
    s: [],
    l: [],
    kind: [],
    died: [],
    seed: [],
    ev: [],
    g: [],
    key: [],
    idx: [],
  };
  /**
   * A flat stream along `pts`. `ev` is the year of the event it shows (birth or wedding); curved parts
   * (`grow`) draw on from their start just after it, straight runs are revealed by the "now" front.
   */
  const strip = (
    pts: P2[],
    hws: number[],
    kind: number,
    died: number,
    seed: number,
    key: string,
    l0: number,
    ev: number,
    grow: boolean,
  ) => {
    const m = pts.length;
    if (m < 2) return l0;
    const y = 0.02;
    const base = S.pos.length / 3;
    let acc = l0;
    for (let i = 0; i < m; i++) {
      const p = pts[i] as P2;
      const a = pts[Math.max(0, i - 1)] as P2;
      const b = pts[Math.min(m - 1, i + 1)] as P2;
      if (i) acc += Math.hypot(p[0] - a[0], p[1] - a[1]);
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // On a tight bend the inner edge would fold over itself: keep the half-width under the bend's radius.
      let w = hws[i] ?? 0;
      if (i > 0 && i < m - 1) {
        const ax = a[0] - p[0];
        const az = a[1] - p[1];
        const bx = b[0] - p[0];
        const bz = b[1] - p[1];
        const cross = Math.abs(ax * bz - az * bx);
        if (cross > 1e-9) w = Math.min(w, (0.9 * Math.hypot(ax, az) * Math.hypot(bx, bz) * tl) / (2 * cross));
      }
      for (const side of [-1, 1]) {
        S.pos.push(p[0], y, p[1]);
        S.n.push(-tz * side, tx * side);
        S.hw.push(w);
        S.s.push(side);
        S.l.push(acc);
        S.kind.push(kind);
        S.died.push(died);
        S.seed.push(seed);
        S.ev.push(ev);
        S.g.push(grow ? i / (m - 1) : -1);
        S.key.push(key);
      }
    }
    for (let i = 0; i < m - 1; i++) {
      const a = base + i * 2;
      S.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    return acc;
  };
  // One straight run along a lane, tapering where a life ends.
  const run = (p: StudioPerson, x0: number, z: number, hw: number, kind: number, seed: number, l0: number) => {
    const died = p.died ?? 9999;
    const x1 = X(endYear(p));
    const len = Math.abs(x1 - x0);
    if (len < 0.01) return;
    const ev = startYear(p);
    if (p.died == null) {
      strip(
        [
          [x0, z],
          [x1, z],
        ],
        [hw, hw],
        kind,
        died,
        seed,
        p.id,
        l0,
        ev,
        false,
      );
      return;
    }
    const tl = Math.min(2.4, len * 0.3);
    const xm = x1 - dir * tl;
    strip(
      [
        [x0, z],
        [xm, z],
        [x1, z],
      ],
      [hw, hw, 0],
      kind,
      died,
      seed,
      p.id,
      l0,
      ev,
      false,
    );
  };
  const segs = big ? 8 : 14;
  const startX = new Float32Array(M.n);
  const marks: Array<{ x: number; z: number; kind: number; r: number; year: number; died: number; key: string }> = [];
  for (const p of M.people) {
    const z = laneZ(p.id);
    const hw = hwOf(p);
    const seed = rnd();
    const died = p.died ?? 9999;
    const ev = startYear(p);
    const xa = X(ev);
    if (p.mi) {
      // A gold tributary from another family's river joins beside the partner at the wedding. It rises midway
      // to the next lane out, so it never seems to leave a neighbour's stream.
      const zp = laneZ(p.anchor);
      const side = Math.sign(z - zp) || 1;
      const off = SG * L * 0.5;
      const dxs = Math.max(2.4, Math.min(5, SG * L * 0.95 * 1.6)) * (big ? 0.7 : 1);
      const t0: P2 = [xa - dir * dxs, z + side * off];
      startX[p.idx] = xa - dir * dxs * 0.5;
      const pts = bez(t0, [xa - dir * dxs * 0.55, z + side * off], [xa - dir * dxs * 0.4, z], [xa, z], segs);
      // Swells from its source, then eases to the spouse's own width at the confluence.
      const tw = (t: number) =>
        t < 0.6 ? hw * (0.5 + 0.9 * Math.min(1, t * 2)) : hw * (1.4 - 0.4 * Math.min(1, (t - 0.6) / 0.4));
      const l1 = strip(
        pts,
        pts.map((_, i) => tw(i / segs)),
        2,
        died,
        seed,
        p.id,
        0,
        ev,
        true,
      );
      run(p, xa, z, hw, 1, seed, l1);
      marks.push({ x: xa, z, kind: 2, r: hw * 2.4 + 0.12, year: ev, died, key: p.id });
    } else if (p.parent && !p.virt) {
      // Fork off the parents and bend into the lane: from between the couple when the mother sits beside the
      // father, from her own stream when another wife's lane lies between them.
      const parent = M.get(p.parent);
      const other = p.parents.map((id) => M.byId.get(id)).find((q) => q?.mi && q.anchor === parent.id);
      const zp = laneZ(parent.id);
      const zm = other ? laneZ(other.id) : zp;
      const zf = Math.abs(zm - zp) > SG * L * 1.01 ? zm : (zp + zm) / 2;
      const dz = z - zf;
      const want = Math.min(
        big ? 7 : 9,
        Math.max(big ? 1.4 : 2.2, (big ? 0.9 : 1.4) + Math.abs(dz) * (big ? 0.22 : 0.32)),
      );
      const from = Math.max(dir * X(startYear(parent)), other ? dir * X(startYear(other)) : -1e9) + 0.3;
      const dx = Math.max(0.6, Math.min(want, dir * xa - from));
      const s0: P2 = [xa - dir * dx, zf];
      startX[p.idx] = xa - dir * dx * 0.5;
      const pts = bez(s0, [xa - dir * dx * 0.6, zf + dz * 0.16], [xa - dir * dx * 0.42, z], [xa, z], segs);
      const l1 = strip(
        pts,
        pts.map((_, i) => hw * (0.3 + 0.7 * Math.min(1, (i / segs) * 1.4))),
        0,
        died,
        seed,
        p.id,
        0,
        ev,
        true,
      );
      run(p, xa, z, hw, 0, seed, l1);
    } else {
      // The founder (and anyone without a parent here) rises from a short spring, inside the map's years.
      const sx = xa - dir * Math.min(Math.max(1.6, hw * 6), 3 * k);
      startX[p.idx] = sx;
      const pts: P2[] = [];
      for (let i = 0; i <= 6; i++) pts.push([sx + (xa - sx) * (i / 6), z]);
      const l1 = strip(
        pts,
        pts.map((_, i) => hw * Math.sqrt(i / 6)),
        0,
        died,
        seed,
        p.id,
        0,
        ev,
        true,
      );
      run(p, xa, z, hw, 0, seed, l1);
    }
    marks.push({
      x: px[p.idx] ?? xa,
      z,
      kind: 0,
      r: size * (p.mi ? 0.55 : 0.7),
      year: appear[p.idx] ?? 0,
      died,
      key: p.id,
    });
    if (p.died != null)
      marks.push({ x: X(endYear(p)), z, kind: 1, r: Math.max(0.16, hw * 0.9), year: endYear(p), died, key: p.id });
  }
  // Two people born into the family who married each other keep their own lanes: a gold ring on both marks it.
  for (const p of M.people) {
    if (p.mi) continue;
    for (const sp of p.spouses) {
      const q = M.byId.get(sp.id);
      if (!q || q.mi || q.id < p.id) continue;
      for (const r of [p, q])
        marks.push({
          x: X(sp.year),
          z: laneZ(r.id),
          kind: 2,
          r: hwOf(r) * 2.4 + 0.12,
          year: sp.year,
          died: r.died ?? 9999,
          key: r.id,
        });
    }
  }
  // A business is a small landmark on its owner's stream, the year it was founded.
  for (const b of M.biz)
    for (const id of b.owners) {
      const o = M.byId.get(id);
      if (!o) continue;
      const yr = Math.min(endYear(o), Math.max(startYear(o) + 1, b.year));
      marks.push({
        x: X(yr),
        z: laneZ(id),
        kind: 3,
        r: Math.max(0.3, size * 0.3),
        year: yr,
        died: o.died ?? 9999,
        key: id,
      });
    }
  // ---- the river bed: the band of water all living lives flow in, widening as the family grows ----
  const yStep = big ? 1 : 0.5;
  const nb = Math.max(2, Math.ceil((NOW - y0) / yStep) + 1);
  const lo = new Float32Array(nb).fill(Number.POSITIVE_INFINITY);
  const hi = new Float32Array(nb).fill(Number.NEGATIVE_INFINITY);
  for (const p of M.people) {
    const z = laneZ(p.id);
    const a = Math.ceil((yearAt(startX[p.idx] ?? 0) - y0) / yStep);
    const b = Math.floor((endYear(p) - y0) / yStep);
    for (let j = Math.max(0, a); j <= Math.min(nb - 1, b); j++) {
      lo[j] = Math.min(lo[j] ?? 0, z);
      hi[j] = Math.max(hi[j] ?? 0, z);
    }
  }
  // Widen over a few years either side, then smooth, so the bed swells ahead of each new branch.
  const win = Math.round(6 / yStep);
  const lo2 = new Float32Array(nb);
  const hi2 = new Float32Array(nb);
  for (let j = 0; j < nb; j++) {
    let a = Number.POSITIVE_INFINITY;
    let b = Number.NEGATIVE_INFINITY;
    for (let t = Math.max(0, j - win); t <= Math.min(nb - 1, j + win); t++) {
      a = Math.min(a, lo[t] ?? a);
      b = Math.max(b, hi[t] ?? b);
    }
    lo2[j] = a;
    hi2[j] = b;
  }
  const bp: number[] = [];
  const bv: number[] = [];
  const bw: number[] = [];
  const bi: number[] = [];
  const pad = L * 0.62;
  let prevLo = 0;
  let prevHi = 0;
  for (let j = 0; j < nb; j++) {
    let a = 0;
    let b = 0;
    let n = 0;
    for (let t = Math.max(0, j - win); t <= Math.min(nb - 1, j + win); t++) {
      const l = lo2[t] ?? 0;
      const h = hi2[t] ?? 0;
      if (!Number.isFinite(l) || !Number.isFinite(h)) continue;
      a += l;
      b += h;
      n++;
    }
    const ok = n > 0 && Number.isFinite(lo2[j] ?? Number.NaN);
    const zl = ok ? Math.min(a / n, lo2[j] ?? 0) - pad : (prevLo + prevHi) / 2;
    const zh = ok ? Math.max(b / n, hi2[j] ?? 0) + pad : (prevLo + prevHi) / 2;
    prevLo = zl;
    prevHi = zh;
    const x = X(y0 + j * yStep);
    bp.push(x, 0, zl, x, 0, zh);
    bv.push(0, 1);
    bw.push(zh - zl, zh - zl);
    if (j) {
      const q = (j - 1) * 2;
      bi.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  const bg = new BufferGeometry();
  bg.setAttribute('position', new Float32BufferAttribute(bp, 3));
  bg.setAttribute('aV', new Float32BufferAttribute(bv, 1));
  bg.setAttribute('aW', new Float32BufferAttribute(bw, 1));
  bg.setIndex(bi);
  const bedU = {
    ...U,
    uMid: { value: mid },
    uK: { value: k },
    uDir: { value: dir },
    uNight: { value: 1 },
    uPad: { value: pad },
    uFocus: { value: 0 },
    uBed: { value: new Color() },
    uBank: { value: new Color() },
    uPaper: { value: new Color() },
  };
  const bedMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: bedU,
    vertexShader: /* glsl */ `attribute float aV, aW; varying float vV, vW; varying vec3 vP;
      void main() { vV = aV; vW = aW; vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uYear, uEnter, uMinYear, uTime, uMid, uK, uDir, uNight, uPad, uFocus; uniform vec3 uBed, uBank;
      varying float vV, vW; varying vec3 vP; ${NOISE} ${INK}
      void main() { ${FRONT}
        // Derivatives first: they are undefined after a discard.
        float d = min(vV, 1. - vV) * vW, fd = fwidth(d), fz = fwidth(vP.z);
        if ((vP.x - front) * uDir > 0.) discard;
        float fill = smoothstep(0., uPad * .8, d);
        float bank = 1. - smoothstep(0., max(fd * 1.5, .02), abs(d - .04));
        float dim = 1. - uFocus * .45;
        if (uNight > .5) {
          // Moonlit current: slow streaks drifting downstream through the dark water.
          // Fades out where the streaks would be finer than a few pixels (far away), so they never shimmer.
          float lod = 1. - smoothstep(.12, .4, fz * 1.6);
          float t = mod(uTime * .14, 400.) * uDir;
          float st = noise(vec2(vP.x * .05 - t, vP.z * 1.6)) * .7 + noise(vec2(vP.x * .13, vP.z * 4.3)) * .3;
          vec3 col = uBed * fill * (1. + .6 * smoothstep(.62, .94, st) * lod) + uBank * bank * .6;
          gl_FragColor = vec4(col * dim, 1.);
        } else gl_FragColor = inked(mix(uBed, uBank, bank), max(fill, bank * .8) * dim);
      }`,
  });
  const bed = new Mesh(bg, bedMat);
  bed.frustumCulled = false;
  bed.renderOrder = 1;

  const rg = new BufferGeometry();
  rg.setAttribute('position', new Float32BufferAttribute(S.pos, 3));
  rg.setAttribute('aN', new Float32BufferAttribute(S.n, 2));
  rg.setAttribute('aHw', new Float32BufferAttribute(S.hw, 1));
  rg.setAttribute('aS', new Float32BufferAttribute(S.s, 1));
  rg.setAttribute('aL', new Float32BufferAttribute(S.l, 1));
  rg.setAttribute('aKind', new Float32BufferAttribute(S.kind, 1));
  rg.setAttribute('aDied', new Float32BufferAttribute(S.died, 1));
  rg.setAttribute('aSeed', new Float32BufferAttribute(S.seed, 1));
  rg.setAttribute('aEv', new Float32BufferAttribute(S.ev, 1));
  rg.setAttribute('aG', new Float32BufferAttribute(S.g, 1));
  rg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(S.key.length), 1));
  rg.setIndex(S.idx);
  rg.userData.keys = S.key;
  const ribU = {
    ...U,
    uMid: { value: mid },
    uK: { value: k },
    uDir: { value: dir },
    uFocus: { value: 0 },
    uNight: { value: 1 },
    /** Height in pixels of the target being drawn (set just before drawing), so far streams stay a pixel wide. */
    uViewH: { value: 800 },
    uNowYear: { value: NOW },
    uLife: { value: new Color() },
    uPast: { value: new Color() },
    uFlow: { value: new Color() },
    uWater: { value: new Color() },
    uGold: { value: new Color() },
    uTeal: { value: new Color() },
    uPaper: { value: new Color() },
  };
  const ribMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: ribU,
    vertexShader: /* glsl */ `
      attribute vec2 aN; attribute float aHw, aS, aL, aKind, aDied, aSeed, aEv, aG, aHi; uniform float uViewH;
      varying float vS, vL, vKind, vDied, vSeed, vEv, vG, vHi, vCover, vX;
      void main() {
        vec4 c = viewMatrix * modelMatrix * vec4(position, 1.);
        // World size of a pixel at this depth: never thinner than about 1.6 px, fading instead of shimmering.
        float px = 2. * max(-c.z, 1e-3) / (projectionMatrix[1][1] * max(uViewH, 1.));
        float hw = max(aHw, px * .8);
        vCover = aHw / max(hw, 1e-4);
        vec4 w = modelMatrix * vec4(position + vec3(aN.x, 0., aN.y) * hw, 1.);
        vS = aS; vL = aL; vKind = aKind; vDied = aDied; vSeed = aSeed; vEv = aEv; vG = aG; vHi = aHi; vX = w.x;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime, uMid, uK, uDir, uFocus, uNight, uNowYear;
      uniform vec3 uLife, uPast, uFlow, uWater, uGold, uTeal; ${INK}
      varying float vS, vL, vKind, vDied, vSeed, vEv, vG, vHi, vCover, vX;
      void main() { ${FRONT}
        // Derivatives first (undefined after a discard). Interpolation can land a hair outside the strip on
        // sub-pixel streams: clamp, or pow() below turns NaN and the bloom pass smears it over the whole frame.
        float s = min(abs(vS), 1.), fw = max(fwidth(vS), 1e-4);
        float ahead = (vX - front) * uDir; if (ahead > 0.) discard;
        // Forks, tributaries and springs draw on from their source just after the birth or wedding they show.
        if (vG >= 0. && vG > (yr - vEv) * 1.25) discard;
        float edge = 1. - smoothstep(1. - fw * 1.5, 1., s);
        float alive = step(yr, vDied), gold = step(1.5, vKind);
        float hi = step(.5, vHi);
        vec3 base = mix(mix(uPast, uLife, alive), uGold, gold);
        base = mix(base, uTeal, hi);
        float rest = uFocus * (1. - hi);
        // While the years play, the front where the river meets "now" is brighter (wetter, by day).
        float tip = smoothstep(-1.8, 0., ahead) * alive * (1. - smoothstep(uNowYear - 1.5, uNowYear - .3, yr));
        // Wide streams (several pixels across) are drawn like a river on a map: water inside, a line on each bank.
        float wide = 1. - smoothstep(.1, .3, fw);
        float bank = smoothstep(.62, .8, s);
        float lineW = 1. - smoothstep(.03, .09, fw);
        vec3 fill = mix(uWater, base, uNight > .5 ? .12 + hi * .25 + gold * .2 : .08 + hi * .3 + gold * .3);
        if (alive < .5 && gold < .5) fill = mix(fill, uNight > .5 ? uWater * .5 : uPaper, .45);
        if (uNight > .5) {
          // River of light: dark water between silver banks, pulses of light flowing with time down the middle.
          float soft = pow(max(1. - s * s, 0.), 1.5), core = 1. - smoothstep(0., .4, s);
          float pulse = smoothstep(.84, 1., fract(vL * .045 - mod(uTime * .2, 1000.) + vSeed * 7.)) * alive * (1. - gold);
          vec3 thin = base * (soft * .42 + core * .5);
          vec3 river = fill * 1.4 * (.7 + .3 * soft) + base * bank * .5 + base * core * .1;
          vec3 col = mix(thin, river, wide) + uFlow * pulse * mix(soft, core, wide) * (.9 - hi * .4);
          col += base * tip * 1.1 * (1. - rest);
          gl_FragColor = vec4(col * edge * vCover * (1. - rest * .82), 1.);
        } else {
          // Blue ink: a pale wash between inked banks, fine current lines drifting downstream when close.
          vec3 river = mix(fill, base, bank);
          vec3 thin = base * (1. - smoothstep(.5, .95, s) * .3);
          vec3 col = mix(thin, river, wide);
          col = mix(col, base * .75, tip * .6);
          float dash = smoothstep(.35, .65, fract(vL * .3 - mod(uTime * .1, 1000.) + vSeed * 5.));
          float cur = (1. - smoothstep(.03, .07, abs(s - .36))) * dash * alive * lineW * (1. - gold);
          col = mix(col, uFlow, cur);
          float a = edge * vCover * mix(.62, 1., max(alive, gold)) * mix(1., .14, rest);
          gl_FragColor = inked(col, a);
        } }`,
  });
  const ribbons = new Mesh(rg, ribMat);
  ribbons.frustumCulled = false;
  ribbons.renderOrder = 2;
  ribbons.onBeforeRender = (renderer) => {
    const rt = renderer.getRenderTarget();
    ribU.uViewH.value = rt ? rt.height : renderer.domElement.height;
  };

  // ---- markers on the water: a ring under each portrait, a dot where a life ends, gold where a marriage joins ----
  const mN = marks.length;
  const mP = new Float32Array(mN * 4);
  const mY = new Float32Array(mN * 2);
  const mKeys: string[] = [];
  marks.forEach((m, i) => {
    mP.set([m.x, m.z, m.kind, m.r], i * 4);
    mY.set([m.year, m.died], i * 2);
    mKeys.push(m.key);
  });
  const mg = new InstancedBufferGeometry();
  mg.setAttribute('position', new Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  mg.setIndex([0, 2, 1, 0, 3, 2]);
  mg.setAttribute('aP', new InstancedBufferAttribute(mP, 4));
  mg.setAttribute('aY', new InstancedBufferAttribute(mY, 2));
  mg.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(mN), 1));
  mg.instanceCount = mN;
  mg.userData.keys = mKeys;
  const markU = {
    ...U,
    uFocus: ribU.uFocus,
    uNight: ribU.uNight,
    uLife: ribU.uLife,
    uPast: ribU.uPast,
    uGold: ribU.uGold,
    uTeal: ribU.uTeal,
    uPaper: ribU.uPaper,
  };
  const markMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: markU,
    vertexShader: /* glsl */ `
      attribute vec4 aP; attribute vec2 aY; attribute float aHi; uniform float uYear, uEnter, uMinYear;
      varying vec2 vQ; varying float vKind, vAlive, vHi, vAge;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter);
        if (yr < aY.x) { ${HIDE} return; }
        // Portrait rings get a wider quad so their ripples have room to spread.
        float grow = aP.z < .5 ? 2.2 : 1.;
        vQ = position.xz; vKind = aP.z; vAlive = step(yr, aY.y); vHi = aHi; vAge = yr - aY.x;
        vec3 w = vec3(aP.x, .05 + aP.z * .004, aP.y) + position * aP.w * grow;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(w, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFocus, uNight; uniform vec3 uLife, uPast, uGold, uTeal; ${INK}
      varying vec2 vQ; varying float vKind, vAlive, vHi, vAge;
      void main() { float r = length(vQ), dm = abs(vQ.x) + abs(vQ.y);
        // Derivatives first: they are undefined after a discard.
        float aa = max(fwidth(r) * 1.5, 1e-3), ad = max(fwidth(dm) * 1.5, 1e-3), a;
        if (r > 1.) discard;
        float hi = step(.5, vHi);
        vec3 ink = vKind > 1.5 ? uGold : mix(uPast, uLife, vAlive);
        ink = mix(ink, uTeal, hi);
        if (vKind < .5) {
          // Under a portrait: the ring where the life enters the river; by night living ones send out slow ripples.
          a = 1. - smoothstep(.035 - aa, .035 + aa, abs(r - .32));
          if (uNight > .5) {
            float ph = fract(mod(uTime * .16, 1000.) + vAge * .37), rr = .32 + ph * .68;
            a = max(a, (1. - smoothstep(0., aa + .02, abs(r - rr))) * (1. - ph) * .55 * vAlive);
          }
        } else if (vKind < 1.5) a = 1. - smoothstep(.62 - aa, .62 + aa, r);
        else if (vKind < 2.5) a = max(1. - smoothstep(.1 - aa, .1 + aa, abs(r - .6)), 1. - smoothstep(.26 - aa, .26 + aa, r));
        else {
          // Business: a filled diamond with a lighter heart, like a landmark on a map.
          a = (1. - smoothstep(.75 - ad, .75 + ad, dm)) * (.55 + .45 * smoothstep(.22 - ad, .22 + ad, dm));
          ink = mix(mix(uLife, vec3(1.), .25 * uNight), uTeal, hi);
        }
        if (uNight > .5) gl_FragColor = vec4(ink * a * (1. - uFocus * (1. - hi) * .82) * 1.2, 1.);
        else gl_FragColor = inked(ink, a * mix(1., .14, uFocus * (1. - hi)));
      }`,
  });
  const markers = new Mesh(mg, markMat);
  markers.frustumCulled = false;
  markers.renderOrder = 3;

  // ---- the map: decade lines, year ticks, the "now" line and a soft vignette, all in one shader ----
  const xA = Math.min(X(y0), X(NOW + 1));
  const xB = Math.max(X(y0), X(NOW + 1));
  const cx = (xA + xB) / 2;
  const tickL = Math.max(0.5, L * 0.32);
  const mapU = {
    ...U,
    uMid: { value: mid },
    uK: { value: k },
    uDir: { value: dir },
    uNowYear: { value: NOW },
    uY0: { value: y0 },
    uBox: { value: new Vector4(xA, xB, zMin - L * 0.7, zMax + L * 0.7) },
    uTick: { value: tickL },
    uNight: ribU.uNight,
    uBg: { value: new Color() },
    uEdge: { value: new Color() },
    uGrid: { value: new Color() },
    uTickC: { value: new Color() },
    uNowC: { value: new Color() },
  };
  const span = xB - xA;
  const mapMat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: mapU,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uMid, uK, uDir, uNowYear, uY0, uTick, uNight; uniform vec4 uBox;
      uniform vec3 uBg, uEdge, uGrid, uTickC, uNowC; varying vec3 vW;
      ${NOISE}
      float lineAt(float d, float w) { return 1. - smoothstep(w * .5, w * 1.6, d); }
      void main() {
        vec2 p = vW.xz;
        vec2 c = vec2((uBox.x + uBox.y) * .5, (uBox.z + uBox.w) * .5);
        vec2 h = vec2((uBox.y - uBox.x) * .5, (uBox.w - uBox.z) * .5);
        // The lifted map hugs the river: the stage reads black (night) or soft grey (day) right beyond it.
        float v = length(max(abs(p - c) - h, 0.)) / (length(h) * .15 + 18.);
        vec3 col = mix(uBg, uEdge, smoothstep(0., 1., v));
        float yr = uMid + uDir * p.x / uK;
        float wy = max(fwidth(yr), 1e-4);
        float inYears = step(uY0, yr + .5 * wy) * step(yr - .5 * wy, uNowYear + 1.);
        float zIn = smoothstep(uBox.z - .01, uBox.z + .01, p.y) * (1. - smoothstep(uBox.w - .01, uBox.w + .01, p.y));
        // Decade lines across the river; 5-year and yearly ticks along both banks (the yearly ones show when close).
        float dDec = abs(fract(yr / 10. + .5) - .5) * 10.;
        float dFive = abs(fract(yr / 5. + .5) - .5) * 5.;
        float dOne = abs(fract(yr + .5) - .5);
        float zN = p.y - uBox.w, zF = uBox.z - p.y;
        float bank = max(step(0., zN) * (1. - step(uTick * 2.2, zN)), step(0., zF) * (1. - step(uTick * 2.2, zF)));
        float edgeD = max(zN, zF);
        // Decade and 5-year lines fade out before a pixel spans that many years (grazing views, far zoom).
        float dec = lineAt(dDec, wy) * (zIn + bank * step(edgeD, uTick * 2.2)) * (1. - smoothstep(2., 5., wy));
        float five = lineAt(dFive, wy) * bank * step(edgeD, uTick * 1.3) * (1. - smoothstep(1., 2.5, wy));
        float one = lineAt(dOne, wy) * bank * step(edgeD, uTick * .7) * (1. - smoothstep(.12, .3, wy));
        col = mix(col, uGrid, dec * inYears);
        col = mix(col, uTickC, max(five * .9, one * .7) * inYears * (1. - dec));
        // Paper grain by day (the night water texture lives in the river bed).
        if (uNight < .5) col *= 1. - .014 * (noise(p * .9) * .6 + noise(p * 3.1) * .4);
        // "Now": a fine line across the river; the years still to come are veiled.
        float yNow = mix(uMinYear - 3., uYear, uEnter);
        float band = smoothstep(uBox.z - uTick * 2., uBox.z, p.y) * (1. - smoothstep(uBox.w, uBox.w + uTick * 2., p.y));
        col = mix(col, uEdge, step(yNow, yr) * band * inYears * .35);
        col = mix(col, uNowC, lineAt(abs(yr - yNow), wy * 1.3) * band);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const map = new Mesh(new PlaneGeometry(Math.max(2600, span * 6), Math.max(2600, depth * 6)), mapMat);
  map.rotation.x = -Math.PI / 2;
  map.position.set(cx, -0.05, 0);
  map.renderOrder = 0;
  const domeU = { uC: mapU.uEdge };
  const dome = new Mesh(
    new SphereGeometry(Math.max(1500, (span + depth) * 4), 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: domeU,
      vertexShader: `void main() { vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uC; void main() { gl_FragColor = vec4(uC, 1.); }`,
    }),
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;

  // ---- decade numbers printed on the map along both banks (one canvas, one draw call) ----
  const decs: number[] = [];
  for (let y = Math.ceil(y0 / 10) * 10; y <= NOW; y += 10) decs.push(y);
  const cw = 256;
  const ch = 96;
  const cols = 4;
  const rows = Math.max(1, Math.ceil(decs.length / cols));
  const cv = document.createElement('canvas');
  cv.width = cw * cols;
  cv.height = ch * rows;
  const draw = () => {
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = '600 64px Manrope, "IBM Plex Sans Arabic", sans-serif';
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.direction = 'ltr';
    decs.forEach((d, i) => {
      g.fillText(String(d), (i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch / 2 + 3);
    });
  };
  draw();
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  if (globalThis.document?.fonts && !document.fonts.check('600 64px Manrope'))
    void document.fonts.ready.then(() => {
      draw();
      tex.needsUpdate = true;
    });
  const th = big ? Math.max(3.6, L * 5) : Math.min(3.4, Math.max(2.2, L * 1.05));
  const tw = (th * cw) / ch;
  const lp: number[] = [];
  const luv: number[] = [];
  const li: number[] = [];
  const rowsZ = [zMax + L * 0.7 + tickL * 2.4 + th * 0.55, zMin - L * 0.7 - tickL * 2.4 - th * 0.55];
  if (big) for (let z = zMin + 140; z < zMax - 70; z += 140) rowsZ.push(z);
  for (const rz of rowsZ)
    decs.forEach((d, i) => {
      const x = X(d);
      const u0 = (i % cols) / cols;
      const u1 = u0 + 1 / cols;
      const v1 = 1 - Math.floor(i / cols) / rows;
      const v0 = v1 - 1 / rows;
      const b = lp.length / 3;
      lp.push(
        x - tw / 2,
        0.06,
        rz - th / 2,
        x + tw / 2,
        0.06,
        rz - th / 2,
        x - tw / 2,
        0.06,
        rz + th / 2,
        x + tw / 2,
        0.06,
        rz + th / 2,
      );
      luv.push(u0, v1, u1, v1, u0, v0, u1, v0);
      li.push(b, b + 2, b + 3, b, b + 3, b + 1);
    });
  const lg = new BufferGeometry();
  lg.setAttribute('position', new Float32BufferAttribute(lp, 3));
  lg.setAttribute('uv', new Float32BufferAttribute(luv, 2));
  lg.setIndex(li);
  const textU = { uTex: { value: tex }, uC: { value: new Color() }, uNight: ribU.uNight, uPaper: ribU.uPaper };
  const textMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: textU,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform vec3 uC; uniform float uNight; varying vec2 vUv; ${INK}
      void main() { float a = texture2D(uTex, vUv).a; if (a < .01) discard;
        gl_FragColor = uNight > .5 ? vec4(uC * a, 1.) : inked(uC, a); }`,
  });
  const numbers = new Mesh(lg, textMat);
  numbers.renderOrder = 1;
  numbers.frustumCulled = false;

  // ---- the "now" curtain that rides the year slider: a faint veil of light (night) or graphite (day) ----
  const curtH = big ? 14 : Math.max(5, L * 2.2);
  const curtU = { ...U, uC: { value: new Color() }, uNight: ribU.uNight, uPaper: ribU.uPaper };
  const curtMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: curtU,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uTime, uNight; varying vec2 vUv; ${NOISE} ${INK}
      void main() { float ends = smoothstep(0., .04, vUv.x) * (1. - smoothstep(.96, 1., vUv.x));
        float sheen = .75 + .25 * noise(vec2(vUv.x * 60., vUv.y * 2. - mod(uTime * .25, 200.)));
        float a = pow(clamp(1. - vUv.y, 0., 1.), 2.6) * ends * sheen;
        gl_FragColor = uNight > .5 ? vec4(uC * a * .07, 1.) : inked(uC, a * .05); }`,
  });
  const curtain = new Mesh(new PlaneGeometry(depth + L * 1.4, curtH), curtMat);
  curtain.rotation.y = Math.PI / 2;
  curtain.position.set(X(NOW), curtH / 2, 0);
  curtain.renderOrder = 4;
  curtain.frustumCulled = false;

  group.add(dome, map, bed, numbers, ribbons, markers, curtain);

  let night = -1;
  const tint = () => {
    const K = ctx.dark() ? LOOK.dark : LOOK.light;
    const e = K.exposure;
    shown(K.bg, e, mapU.uBg.value);
    shown(K.edge, e, mapU.uEdge.value);
    shown(K.grid, e, mapU.uGrid.value);
    shown(K.tick, e, mapU.uTickC.value);
    shown(K.now, e, mapU.uNowC.value);
    shown(K.text, e, textU.uC.value);
    shown(K.life, e, ribU.uLife.value);
    shown(K.past, e, ribU.uPast.value);
    shown(K.flow, e, ribU.uFlow.value);
    shown(K.water, e, ribU.uWater.value);
    shown(K.bed, e, bedU.uBed.value);
    shown(K.bank, e, bedU.uBank.value);
    shown(K.bg, e, bedU.uPaper.value);
    bedU.uNight.value = K.night ? 1 : 0;
    shown(K.gold, e, ribU.uGold.value);
    shown(K.teal, e, ribU.uTeal.value);
    shown(K.bg, e, ribU.uPaper.value);
    shown(K.now, e, curtU.uC.value);
    ribU.uNight.value = K.night ? 1 : 0;
    if (night !== ribU.uNight.value) {
      night = ribU.uNight.value;
      for (const m of [bedMat, ribMat, markMat, textMat, curtMat]) setBlend(m, K.night);
    }
    ctx.look(K.bloom, e);
  };

  // Default view: high over the near bank, looking across the whole river; Arabic mirrors it.
  const pitch = 0.98;
  const tanV = Math.tan((21 * Math.PI) / 180);
  const halfW = span / 2 + 3;
  const halfD = depth / 2 + L * 0.7 + tickL * 2.4 + th * 1.3;
  // Framed for a 1.45 : 1 free area (the engine pulls back on narrower stages), clear of the tab bar above and
  // the time bar below; the near bank is closer to the camera, so it is the one that has to fit across.
  const dist = Math.max(
    halfW / (tanV * 1.45 * 0.96) + halfD * Math.cos(pitch),
    (halfD * Math.sin(pitch)) / (tanV * 0.86) + halfD * Math.cos(pitch) * 0.5,
  );
  const target = new Vector3(cx, 0, halfD * 0.08);
  const camAt = () => new Vector3(target.x, target.y + Math.sin(pitch) * dist, target.z + Math.cos(pitch) * dist);
  const view = { target, cam: camAt() };

  return {
    key: 'river',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    tint,
    labelUp: true,
    labelScale: 0.85,
    dir,
    update: () => {
      curtain.position.x = X(ctx.effYear());
    },
    hiTargets: [
      { geo: rg, perPerson: true },
      { geo: mg, perPerson: true },
    ],
    focus: [ribU.uFocus, bedU.uFocus],
    appear,
    view,
    follow: big ? 30 : 26,
    // Streams, rings and name pills reach a little past the portraits when a lineage is framed.
    framePad: big ? 1.5 : 3,
    relang: () => {
      view.cam.copy(camAt());
    },
  };
};
