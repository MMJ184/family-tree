import { BufferAttribute, BufferGeometry, Group, Mesh, PlaneGeometry, Points, Vector3, Vector4 } from 'three';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import {
  arrival,
  backdrop,
  GOLD,
  galaxyInks,
  hazeMat,
  inkBuilder,
  inkGeometry,
  inkLine,
  inkLineMat,
  MAX_ARMS,
  MAX_GENS,
  mainBranches,
  makeTone,
  recolourInk,
  type SpiralUniforms,
  setInk,
  setTone,
  starMat,
  symbolGeometry,
  symbolMat,
  TEAL,
  widestGap,
  type YearMark,
  yearMarks,
} from './galaxy-gl.ts';
import type { SceneBuilder } from './types.ts';

// Family Galaxy: the founder is the galactic core. The family's main branches are the spiral arms (a
// branch holding most of the family is split into its children, so one dominant son does not leave a
// one-armed galaxy); each generation is a step outward along its arm, where the people of that line
// spread across the arm in staggered rows. Partners are binary companions linked in gold. The arms
// follow one log spiral (angle = arm phase + offset across the arm + ln(r / rc) * wind), shared with
// the GPU star field and the unresolved light. Dark: black space, white and pale-blue arms around an
// amber core. Light: a star-atlas plate, ink stars and graphite dust arms on white with a fine polar
// grid. Arabic mirrors the galaxy, so the arms wind and the branches run the other way round.

const TAU = Math.PI * 2;
/** cot(pitch angle): about 18 degrees, like M51. */
const WIND = 3.1;
/** The first arm starts at twelve o'clock (the far side) and the branches follow clockwise. */
const TH0 = -Math.PI / 2;

interface GalaxyLook {
  paperC: string;
  paperE: string;
  core: string;
  warm: string;
  blue: string;
  pink: string;
  inkCore: string;
  inkArm: string;
  inkKnot: string;
  grid: string;
  gridA: number;
  line: string;
  lineA: number;
  gold: string;
  teal: string;
  haze: number;
  stars: number;
  pocket: number;
  /** Night: the annotation ring around each person (alpha). */
  ring: number;
  /** Symbol colours for people born in and for the deceased (gold and teal come from above). */
  symInk: string;
  symDead: string;
  /** The year marks on the generation rings. */
  year: string;
  yearA: number;
  glow: number;
  bloom: number;
  exposure: number;
}

const LOOK: { dark: GalaxyLook; light: GalaxyLook } = {
  dark: {
    paperC: '#0a0a0c',
    paperE: '#000000',
    core: '#ffdcae',
    warm: '#ffc78a',
    blue: '#bcd1ff',
    pink: '#e7b3c6',
    inkCore: '#000000',
    inkArm: '#000000',
    inkKnot: '#000000',
    grid: '#8d99b3',
    gridA: 0.09,
    line: '#bccbec',
    lineA: 0.42,
    gold: GOLD.dark,
    teal: TEAL.dark,
    haze: 1,
    stars: 1,
    pocket: 0.8,
    ring: 0.42,
    symInk: '#e9edf5',
    symDead: '#8d929c',
    year: '#c3cad8',
    yearA: 0.62,
    glow: 0.5,
    bloom: 0.55,
    exposure: 1,
  },
  light: {
    paperC: '#ffffff',
    paperE: '#ebebeb',
    core: '#000000',
    warm: '#000000',
    blue: '#000000',
    pink: '#000000',
    inkCore: '#7d7061',
    inkArm: '#646d7d',
    inkKnot: '#8a5f4f',
    grid: '#8f8f8f',
    gridA: 0.62,
    line: '#3a3a3a',
    lineA: 0.72,
    gold: GOLD.light,
    teal: TEAL.light,
    haze: 0.9,
    stars: 1,
    pocket: 0,
    ring: 0,
    symInk: '#1a1a1a',
    symDead: '#8c8c8c',
    year: '#5c5c5c',
    yearA: 0.95,
    glow: 0,
    bloom: 0,
    exposure: 1,
  },
};

interface Arm {
  phi: number;
  span: number;
  max: number;
  w: number;
}

interface Seat {
  p: StudioPerson;
  plus: number;
  minus: number;
}

export const galaxyScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const mirror = ctx.rtl() ? -1 : 1;
  const size = big ? 0.95 : 1.15;
  /** A medal's full width, glow included (portraits.ts draws a quad of size × 2.3). */
  const D = size * 2.3;
  const slot = D * 1.06;
  // Partners sit along the ring one medal apart, with room for the default view's tilt (sin 55° ≈ 0.82).
  const wifeGap = D * 1.22;
  const gapR = D * (big ? 1.35 : 1.55);
  const rowGap = D * 0.92;
  const maxRows = big ? 4 : 2;
  const rc = big ? 8 : 7;
  const tapR = (r: number) => Math.min(1, Math.max(0.35, 0.35 + 0.65 * (r / rc - 1) * 0.5));
  const wind = (r: number) => Math.log(Math.max(r, 0.01) / rc) * WIND;

  const wives = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) wives.set(p.anchor, [...(wives.get(p.anchor) ?? []), p]);
  for (const list of wives.values()) list.sort((a, b) => spouseYear(M, a) - spouseYear(M, b));
  const seat = (p: StudioPerson): Seat => {
    const n = wives.get(p.id)?.length ?? 0;
    return { p, plus: slot / 2 + Math.ceil(n / 2) * wifeGap, minus: slot / 2 + Math.floor(n / 2) * wifeGap };
  };

  // ---- arms: the main branches, each given a slice of the disk by the square root of its size ----
  const { heads, core } = mainBranches(M, MAX_ARMS - 2, 0.6);
  const weights = heads.map((h) => Math.sqrt(h.leaves));
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  const maxLeaves = Math.max(1, ...heads.map((h) => h.leaves));
  const arms: Arm[] = [];
  let acc = TH0;
  heads.forEach((h, i) => {
    const slice = (TAU * (weights[i] ?? 1)) / wSum;
    arms.push({
      phi: acc + slice / 2,
      span: 0.3,
      max: Math.min(1.35, slice * 0.78),
      w: 0.4 + 0.6 * Math.sqrt(h.leaves / maxLeaves),
    });
    acc += slice;
  });
  const armOf = new Map<string, number>();
  heads.forEach((h, i) => {
    const q = [h.id];
    while (q.length) {
      const id = q.pop() as string;
      armOf.set(id, i);
      q.push(...M.get(id).kids);
    }
  });

  // ---- one radius per generation, wide enough for every arm's people in at most maxRows rows ----
  const line = M.people.filter((p) => !p.mi && armOf.has(p.id));
  const g0 = Math.min(...heads.map((h) => h.gen), M.maxGen);
  const g1 = Math.max(g0, ...line.map((p) => p.gen));
  const at = new Map<string, { r: number; th: number }>();
  const radius = new Map<number, number>();
  const rings: number[] = [];
  let edge = rc - gapR;
  for (let g = g0; g <= g1; g++) {
    const byArm = arms.map((_, a) =>
      line
        .filter((p) => p.gen === g && armOf.get(p.id) === a)
        .sort((x, y) => x.ang - y.ang)
        .map(seat),
    );
    const lengths = byArm.map((list) => list.reduce((s, q) => s + q.plus + q.minus, 0));
    let r = Math.max(rc, edge + gapR);
    const rowsAt = (rr: number) =>
      arms.map((A, a) => Math.max(1, Math.ceil((lengths[a] ?? 0) / Math.max(1e-3, A.max * tapR(rr) * rr))));
    let rows = rowsAt(r);
    for (let k = 0; k < 80 && Math.max(...rows) > maxRows; k++) {
      r *= 1.05;
      rows = rowsAt(r);
    }
    radius.set(g, r);
    rings.push(r);
    let used = 1;
    byArm.forEach((list, a) => {
      const A = arms[a] as Arm;
      const R = Math.min(maxRows, rows[a] ?? 1);
      used = Math.max(used, list.length ? R : 1);
      for (let j = 0; j < R; j++) {
        // Rows alternate through the line's order, so neighbours sit staggered across the arm.
        const row = list.filter((_, k) => k % R === j);
        const rr = r + j * rowGap;
        const total = row.reduce((s, q) => s + q.plus + q.minus, 0);
        let c = -total / 2;
        for (const q of row) {
          c += q.minus;
          at.set(q.p.id, { r: rr, th: A.phi + wind(rr) + c / rr });
          c += q.plus;
        }
        A.span = Math.max(A.span, Math.min(1.6, total / rr / tapR(rr)));
      }
    });
    edge = r + (used - 1) * rowGap;
  }
  const outer = edge;

  // The founder at the core; anyone folded into the core on the way to the arms sits in the bulge,
  // towards the arms they lead to.
  at.set(M.root.id, { r: 0, th: 0 });
  for (const id of core) {
    if (id === M.root.id) continue;
    const p = M.get(id);
    let x = 0;
    let z = 0;
    heads.forEach((h, a) => {
      let q: StudioPerson | undefined = h;
      while (q?.parent && q.parent !== id) q = M.byId.get(q.parent);
      if (q?.parent === id) {
        x += Math.cos((arms[a] as Arm).phi);
        z += Math.sin((arms[a] as Arm).phi);
      }
    });
    const th = Math.hypot(x, z) > 0.2 ? Math.atan2(z, x) : (arms[0]?.phi ?? 0) + Math.PI / 2;
    at.set(id, { r: Math.min(rc * 0.82, rc * (0.3 + 0.2 * Math.max(0, p.gen - M.root.gen - 1))), th });
  }
  for (const p of M.people) if (!p.mi && !at.has(p.id)) at.set(p.id, { r: rc * 0.5, th: (p.idx * 2.39996) % TAU });
  // Partners: binary companions along the ring, alternating sides in wedding order.
  for (let pass = 0; pass < 2; pass++)
    for (const [id, list] of wives) {
      const a = at.get(id);
      if (!a) continue;
      list.forEach((w, k) => {
        const step = (1 + Math.floor(k / 2)) * (k % 2 ? -1 : 1) * wifeGap;
        at.set(
          w.id,
          a.r < 1e-3 ? { r: Math.abs(step), th: step > 0 ? 0 : Math.PI } : { r: a.r, th: a.th + step / a.r },
        );
      });
    }
  for (const p of M.people) if (!at.has(p.id)) at.set(p.id, { r: rc * 0.5, th: (p.idx * 2.39996) % TAU });
  // The core is crowded (the founder, partners, anyone folded into the centre): push apart any two whose
  // medals would touch, keeping the founder fixed and everyone clear of the first generation ring.
  const firstRing = radius.get(g0) ?? rc;
  const coreP = M.people.filter((p) => (at.get(p.id)?.r ?? 0) < firstRing - D * 0.5);
  const cx = coreP.map((p) => {
    const q = at.get(p.id) ?? { r: 0, th: 0 };
    return [Math.cos(q.th) * q.r, Math.sin(q.th) * q.r];
  });
  const maxR = coreP.map((p) => Math.max(firstRing - D * 1.05, at.get(p.id)?.r ?? 0));
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < coreP.length; i++)
      for (let j = i + 1; j < coreP.length; j++) {
        const a = cx[i] as number[];
        const b = cx[j] as number[];
        const need = ((sizeFactor(coreP[i] as StudioPerson) + sizeFactor(coreP[j] as StudioPerson)) / 2) * D * 1.04;
        let dx = (b[0] ?? 0) - (a[0] ?? 0);
        let dz = (b[1] ?? 0) - (a[1] ?? 0);
        let d = Math.hypot(dx, dz);
        if (d >= need) continue;
        if (d < 1e-4) {
          dx = Math.cos(j * 2.4);
          dz = Math.sin(j * 2.4);
          d = 1;
        }
        const push = (need - d) / d;
        const fa = coreP[i] === M.root ? 0 : coreP[j] === M.root ? 1 : 0.5;
        a[0] = (a[0] ?? 0) - dx * push * fa;
        a[1] = (a[1] ?? 0) - dz * push * fa;
        b[0] = (b[0] ?? 0) + dx * push * (1 - fa);
        b[1] = (b[1] ?? 0) + dz * push * (1 - fa);
        moved = true;
      }
    cx.forEach((c, i) => {
      const r = Math.hypot(c[0] ?? 0, c[1] ?? 0);
      const m = maxR[i] ?? r;
      if (r > m) {
        c[0] = ((c[0] ?? 0) * m) / r;
        c[1] = ((c[1] ?? 0) * m) / r;
      }
    });
    if (!moved) break;
  }
  coreP.forEach((p, i) => {
    const c = cx[i] as number[];
    if (p !== M.root) at.set(p.id, { r: Math.hypot(c[0] ?? 0, c[1] ?? 0), th: Math.atan2(c[1] ?? 0, c[0] ?? 0) });
  });
  const heightOf = (id: string) => {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    return ((h >>> 0) / 4294967296 - 0.5) * 0.5;
  };
  const plane = (q: { r: number; th: number }) => [Math.cos(q.th) * q.r, Math.sin(q.th) * q.r] as const;
  const pos = new Float32Array(M.n * 3);
  let reach = 0;
  M.people.forEach((p, i) => {
    const q = at.get(p.id) ?? { r: 0, th: 0 };
    const [x, z] = plane(q);
    reach = Math.max(reach, q.r);
    // The galaxy group is mirrored in Arabic; the portraits are not in it, so mirror them here.
    pos.set([x * mirror, p === M.root ? 0.6 : heightOf(p.id) + 0.3, z], i * 3);
  });
  const R = Math.max(outer, reach) * 1.06 + 4;

  // ---- birth year by radius: the galaxy grows outward with the family ----
  const gr: number[] = [0];
  const gy: number[] = [M.root.born];
  let prevR = 0;
  for (let g = g0; g <= g1 && gr.length < MAX_GENS; g++) {
    const r = radius.get(g) ?? prevR;
    const ys = line.filter((p) => p.gen === g).map((p) => p.born);
    gr.push(prevR ? (prevR + r) / 2 : r * 0.6);
    gy.push(Math.max(gy[gy.length - 1] ?? M.root.born, ys.length ? Math.min(...ys) : (gy[gy.length - 1] ?? 0) + 25));
    prevR = r;
  }
  const ng = gr.length;
  while (gr.length < MAX_GENS) {
    gr.push(1e6);
    gy.push(gy[gy.length - 1] ?? M.root.born);
  }
  const S: SpiralUniforms = {
    uRc: { value: rc },
    uWind: { value: WIND },
    uR: { value: R },
    uGR: { value: gr },
    uGY: { value: gy },
    uNG: { value: ng },
  };

  // ---- lineage trails along the arms, and partners linked in gold ----
  const B = inkBuilder();
  const kinds: number[] = [];
  const mark = (k: number) => {
    while (kinds.length < B.t.length) kinds.push(k);
  };
  const white = lin('#ffffff');
  const trimOf = (p: StudioPerson) => D * sizeFactor(p) * 0.34;
  const lift = (p: StudioPerson) => (p === M.root ? 0.6 : heightOf(p.id) + 0.3);
  const path = (
    f: (t: number) => readonly [number, number, number],
    n: number,
    a: readonly [number, number],
    ta: number,
    b: readonly [number, number],
    tb: number,
  ) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const [x, y, z] = f(i / n);
      if (Math.hypot(x - a[0], z - a[1]) < ta || Math.hypot(x - b[0], z - b[1]) < tb) continue;
      pts.push(new Vector3(x, y, z));
    }
    return pts;
  };
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const qa = at.get(p.parent);
    const qb = at.get(p.id);
    if (!qa || !qb) continue;
    const parent = M.get(p.parent);
    // Leave the core along the arm; elsewhere follow the spiral the short way round.
    const t0 = qa.r < 0.5 ? qb.th - 1.2 : qa.th;
    let dt = (qb.th - t0) % TAU;
    if (dt > Math.PI) dt -= TAU;
    if (dt < -Math.PI) dt += TAU;
    const y0 = lift(parent);
    const y1 = lift(p);
    const f = (t: number) => {
      const r = qa.r + (qb.r - qa.r) * t;
      const th = t0 + dt * t;
      return [Math.cos(th) * r, y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * 0.25, Math.sin(th) * r] as const;
    };
    const pts = path(f, big ? 9 : 22, plane(qa), trimOf(parent), plane(qb), trimOf(p));
    if (pts.length > 1) inkLine(B, pts, p.born, p.id, white, 1, 1);
    mark(0);
  }
  for (const [id, list] of wives) {
    const qa = at.get(id);
    if (!qa) continue;
    const husband = M.get(id);
    list.forEach((w, k) => {
      const qb = at.get(w.id);
      if (!qb) return;
      const s = 1 + Math.floor(k / 2);
      const bow = (s - 1) * D * 0.62;
      const a = plane(qa);
      const b = plane(qb);
      const y = lift(husband);
      const f =
        qa.r < 1e-3
          ? (t: number) => [a[0] + (b[0] - a[0]) * t, y, a[1] - (bow + D * 0.1) * Math.sin(Math.PI * t)] as const
          : (t: number) => {
              const r = qa.r + bow * Math.sin(Math.PI * t);
              const th = qa.th + (qb.th - qa.th) * t;
              return [Math.cos(th) * r, y, Math.sin(th) * r] as const;
            };
      const pts = path(f, 12 + s * 8, a, trimOf(husband), b, trimOf(w));
      if (pts.length > 1) inkLine(B, pts, spouseYear(M, w), w.id, white, 1, 1.2);
      mark(1);
    });
  }
  const lineGeo = inkGeometry(B);
  const lineKinds = Uint8Array.from(kinds);
  const T = makeTone();
  const lines = inkLineMat(U, T);
  lines.uni.uWidth.value = big ? 1 : 1.2;
  const lineMesh = new Mesh(lineGeo, lines.mat);
  lineMesh.frustumCulled = false;
  lineMesh.renderOrder = 4;

  // ---- the GPU star field: bulge, arms, disk, HII knots and the far sky, one Points draw ----
  // Decorative arms so a family with one branch still reads as a spiral galaxy.
  const deco: Arm[] = [];
  if (arms.length === 0)
    deco.push({ phi: 0.4, span: 0.9, max: 1, w: 0.8 }, { phi: 0.4 + Math.PI, span: 0.9, max: 1, w: 0.8 });
  else if (arms.length === 1)
    deco.push({ phi: (arms[0]?.phi ?? 0) + Math.PI, span: arms[0]?.span ?? 1, max: 1, w: 0.7 });
  const allArms = [...arms, ...deco].slice(0, MAX_ARMS);
  const r1 = rng(51);
  const gauss = () => {
    const u = Math.max(1e-6, r1());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r1());
  };
  const nArm = big ? 42000 : 30000;
  const nBulge = big ? 9000 : 7000;
  const nDisk = big ? 9000 : 6000;
  const nKnot = big ? 190 : 110;
  const nFar = 4000;
  const cap = nArm + nBulge + nDisk + nKnot * 12 + nFar;
  const P = new Float32Array(cap * 3);
  const K = new Float32Array(cap * 4);
  const C = new Float32Array(cap * 4);
  const Sz = new Float32Array(cap);
  let n = 0;
  const push = (
    a: number,
    b: number,
    c: number,
    kind: number,
    span: number,
    y: number,
    jr: number,
    col: [number, number, number],
    s: number,
  ) => {
    P.set([a, b, c], n * 3);
    K.set([kind, span, y, jr], n * 4);
    C.set([col[0], col[1], col[2], r1() * 10], n * 4);
    Sz[n] = s;
    n++;
  };
  const lMin = Math.log(0.45);
  const lMax = Math.log((R * 0.98) / rc);
  const armW = allArms.map((a) => a.w * (a.span + 0.4));
  const armWSum = armW.reduce((s, w) => s + w, 0);
  const pickArm = () => {
    let x = r1() * armWSum;
    for (let i = 0; i < allArms.length; i++) {
      x -= armW[i] ?? 0;
      if (x <= 0) return allArms[i] as Arm;
    }
    return allArms[0] as Arm;
  };
  const tintStar = (): [number, number, number] => {
    const v = r1();
    const b = 0.35 + r1() ** 2 * 1.1;
    if (v < 0.12) return [1.1 * b, 0.9 * b, 0.7 * b];
    if (v < 0.3) return [0.8 * b, 0.9 * b, 1.15 * b];
    return [b, b, b];
  };
  // ln(r) is drawn so the surface density falls off roughly exponentially.
  const drawL = () => {
    for (;;) {
      const l = lMin + r1() * (lMax - lMin);
      const r = rc * Math.exp(l);
      if (r1() < Math.exp(-r / (R * 0.55)) * (r / rc) ** 0.35 * 1.4) return l;
    }
  };
  for (let i = 0; i < nArm; i++) {
    const A = pickArm();
    const l = drawL();
    const r = rc * Math.exp(l);
    // Power-law scatter keeps most stars tight to the arm, with a few strays.
    const u = gauss() * 0.2 - 0.1 + (r1() < 0.15 ? (r1() - 0.5) * 1.6 : 0);
    const y = (r1() - 0.5) * 2 * r1() ** 3 * (1.6 + r * 0.03);
    const s = r1() < 0.01 ? 2.6 + r1() * 1.4 : 0.3 + r1() ** 3 * 0.9;
    push(l, A.phi, u, 1, A.span, y, (r1() - 0.5) * 0.08, tintStar(), s);
  }
  for (let i = 0; i < nBulge; i++) {
    const r = rc * 0.95 * r1() ** 1.7 + 0.2;
    const y = gauss() * (0.5 + r * 0.32) * 0.6;
    const b = 0.2 + r1() * 0.42;
    push(r, r1() * TAU, y, 0, 0, 0, 0, [b * 1.05, b * 0.92, b * 0.78], 0.3 + r1() ** 2 * 0.8);
  }
  for (let i = 0; i < nDisk; i++) {
    const r = Math.min(R * 1.1, -Math.log(Math.max(1e-4, r1())) * R * 0.3 + rc * 0.4);
    const b = 0.2 + r1() * 0.4;
    push(r, r1() * TAU, gauss() * 0.5, 2, 0, 0, 0, [b, b * 0.97, b * 0.92], 0.3 + r1() * 0.5);
  }
  // HII knots: clumps just downstream of the dust lane, ringed by a few hot blue stars.
  for (let i = 0; i < nKnot; i++) {
    const A = pickArm();
    const l = Math.log(1.2) + r1() * (lMax - Math.log(1.3));
    const u = -0.18 + gauss() * 0.14;
    const m = 5 + Math.floor(r1() * 7);
    const big1 = 0.8 + r1() * 1.2;
    for (let k = 0; k < m; k++) {
      const hot = k < 2;
      const c: [number, number, number] = hot ? [0.75, 0.85, 1.4] : [0.75, 0.75, 0.75];
      push(
        l + gauss() * 0.02,
        A.phi,
        u + gauss() * 0.03,
        hot ? 1 : 3,
        A.span,
        gauss() * 0.15,
        0,
        c,
        hot ? 0.7 + r1() * 0.8 : big1 * (0.4 + r1() * 0.6),
      );
    }
  }
  for (let i = 0; i < nFar; i++) {
    const u = r1() * 2 - 1;
    const th = r1() * TAU;
    const rr = 900 + r1() * 300;
    const s = Math.sqrt(1 - u * u);
    const b = 0.25 + r1() ** 3 * 0.9;
    const blue = r1() < 0.3;
    push(
      Math.cos(th) * s * rr,
      u * rr,
      Math.sin(th) * s * rr,
      4,
      0,
      0,
      0,
      blue ? [b * 0.8, b * 0.9, b * 1.2] : [b, b, b],
      1 + r1() ** 4 * 2.2,
    );
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(P.subarray(0, n * 3), 3));
  sg.setAttribute('aK', new BufferAttribute(K.subarray(0, n * 4), 4));
  sg.setAttribute('aC', new BufferAttribute(C.subarray(0, n * 4), 4));
  sg.setAttribute('aS', new BufferAttribute(Sz.subarray(0, n), 1));
  const I = galaxyInks();
  const stars = starMat(U, S, T, I);
  stars.uni.uLmin.value = lMin;
  stars.uni.uLmax.value = lMax;
  // Star sizes are in world units; keep them the same on screen whatever the galaxy's size.
  stars.uni.uSz.value = Math.min(1.8, Math.max(0.5, R / 75));
  const field = new Points(sg, stars.mat);
  field.frustumCulled = false;
  field.renderOrder = 1;

  // ---- unresolved light: arms, dust lanes, nebulae and the chart grid on one plane ----
  const armVecs = allArms.map((a) => new Vector4(a.phi, a.span, a.w, 0));
  const haze = hazeMat(U, S, T, I, armVecs, rings);
  haze.uni.uGridR.value = R * 0.9;
  const disk = new Mesh(new PlaneGeometry(R * 2.7, R * 2.7), haze.mat);
  disk.rotation.x = -Math.PI / 2;
  disk.renderOrder = 0;

  // ---- atlas star symbols under the people (an ink disc on paper, a dark pocket in the star clouds) ----
  const symPos = new Float32Array(pos);
  for (let i = 0; i < M.n; i++) symPos[i * 3] = (symPos[i * 3] ?? 0) * mirror;
  const symGeo = symbolGeometry(M, symPos, sizeFactor);
  const sym = symbolMat(U, T, size);
  const symMesh = new Points(symGeo, sym.mat);
  symMesh.frustumCulled = false;
  symMesh.renderOrder = 5;

  // ---- year marks on the generation rings: each generation's first birth year, in the ring's widest gap ----
  const marks: YearMark[] = [];
  for (let g = g0; g <= g1; g++) {
    const r = radius.get(g);
    const gen = line.filter((p) => p.gen === g);
    if (r == null || !gen.length) continue;
    const spans: Array<[number, number]> = [];
    for (const p of [...gen, ...gen.flatMap((p) => wives.get(p.id) ?? [])]) {
      const q = at.get(p.id);
      if (q) spans.push([q.th, (D * 0.75) / Math.max(q.r, 1)]);
    }
    const th = widestGap(spans, TH0);
    const [x, z] = plane({ r: r - D * 0.55, th });
    const year = Math.min(...gen.map((p) => p.born));
    // In Arabic the group (and so the anchor) is mirrored; the text is laid out in view space and never reads backwards.
    marks.push({ text: String(year), at: new Vector3(x, 0.15, z), year });
  }
  const years = yearMarks(U, T, marks, D * 0.42);
  years.mesh.renderOrder = 3;

  const back = backdrop(T);
  group.add(back, disk, field, lineMesh, symMesh, years.mesh);
  // Bloom eases down as the camera closes in on the bright core (dark theme), so the people stay clear.
  const cam = new Vector3();
  let bloomK = 1;
  let sentK = -1;
  const before = back.onBeforeRender;
  back.onBeforeRender = (renderer, scene, camera, geometry, material, grp) => {
    before.call(back, renderer, scene, camera, geometry, material, grp);
    cam.setFromMatrixPosition(camera.matrixWorld);
    bloomK = 0.5 + 0.5 * Math.min(1, Math.max(0, (cam.length() / I.uViewD.value - 0.3) / 0.65));
  };
  group.scale.x = mirror;
  const fade = arrival(U, sym.uni.uFade);

  const tint = () => {
    const dark = ctx.dark();
    const L = dark ? LOOK.dark : LOOK.light;
    setTone(T, !dark, L.exposure, L.paperC, L.paperE);
    I.uWarm.value.copy(lin(L.warm));
    I.uBlue.value.copy(lin(L.blue));
    I.uPink.value.copy(lin(L.pink));
    I.uCore.value.copy(lin(L.core));
    I.uInkCore.value.copy(lin(L.inkCore));
    I.uInkArm.value.copy(lin(L.inkArm));
    I.uInkKnot.value.copy(lin(L.inkKnot));
    I.uGain.value = dark ? L.stars : L.haze;
    haze.uni.uGrid.value = L.gridA;
    haze.uni.uGridC.value.copy(lin(L.grid));
    haze.setLight(!dark);
    setInk(stars.mat, !dark, true);
    setInk(lines.mat, !dark);
    lines.uni.uHi.value.copy(lin(L.teal));
    lines.uni.uGlow.value = L.glow;
    lines.uni.uDim.value = dark ? 0.2 : 0.28;
    sym.uni.uPocket.value = L.pocket;
    sym.uni.uRing.value = L.ring;
    sym.uni.uInkC.value.copy(lin(L.symInk));
    sym.uni.uGoldC.value.copy(lin(L.gold));
    sym.uni.uDeadC.value.copy(lin(L.symDead));
    sym.uni.uTealC.value.copy(lin(L.teal));
    years.uni.uC.value.copy(lin(L.year));
    years.uni.uA.value = L.yearA;
    setInk(years.mat, !dark);
    const ln = lin(L.line);
    const gold = lin(L.gold);
    recolourInk(lineGeo, lineKinds, (k) => (k === 1 ? [gold, 1] : [ln, L.lineA]));
    ctx.look(L.bloom * (dark ? bloomK : 1), L.exposure);
    sentK = dark ? bloomK : -1;
  };

  // Default view: the whole galaxy, a tilted three-quarter view; the engine pulls back if anyone is left out.
  const el = 0.96;
  const az = 0.5 * mirror;
  const dist = (reach + D) * 2.25 + 6;
  const target = new Vector3(0, 0, (reach + D) * 0.16);
  const view = {
    target,
    cam: new Vector3(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    ),
  };

  I.uViewD.value = view.cam.length();
  const update = () => {
    fade();
    if (!ctx.dark() || Math.abs(bloomK - sentK) < 0.02) return;
    sentK = bloomK;
    ctx.look(LOOK.dark.bloom * bloomK, LOOK.dark.exposure);
  };

  return {
    key: 'galaxy',
    group,
    pos,
    size,
    style: 1,
    lift: 4,
    labelScale: 0.86,
    tint,
    hiTargets: [{ geo: lineGeo }, { geo: symGeo, perPerson: true }],
    focus: [lines.uni.uFocus, stars.uni.uFocus, haze.uni.uFocus, sym.uni.uFocus, years.uni.uFocus],
    view,
    follow: big ? 22 : 20,
    update,
  };
};
