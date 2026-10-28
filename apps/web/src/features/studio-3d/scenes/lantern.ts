import {
  AdditiveBlending,
  Group,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  QuadraticBezierCurve3,
  Vector3,
} from 'three';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import {
  addThread,
  glowPoints,
  lakeUniforms,
  lanternAttrs,
  lanternGeometry,
  lanternMaterial,
  reflectionMesh,
  skyMesh,
  threadBuilder,
  threadMesh,
  waterMesh,
} from './lantern-gl.ts';
import type { SceneBuilder } from './types.ts';

// Lantern Lake: each life is a paper fanous rising over a still lake, tethered by a thread to its
// parent's lantern. The founder floats just above the water; every generation is a higher, wider
// tier of an amphitheatre fan (crowded tiers stagger into rows), spouses float beside their partner
// joined by gold cords. Night: amber candle-lit paper and bronze frames over black water, each
// lantern mirrored as a column of ripple glints. Dawn: cream paper and vermilion frames over pale
// silver water in white mist. Close up: arched windows with a jaali, pierced domes, the candle
// glowing through the paper, ripple rings around the floating lamps, a slow candle flicker.

/** Signature colours per theme (teal is only the lineage, gold only marriages); the rest is neutral. */
const LOOK = {
  dark: {
    light: '#ff9b3d', // candle light through amber paper
    frame: '#5b4026', // dark bronze frames and domes
    gold: '#e2b65a',
    teal: '#4fd1bd',
    paper: '#2a2018',
    thread: '#8a7860',
    skyTop: '#000000',
    skyHor: '#0e0e0e',
    hill: '#050505',
    water: '#010101',
    waterFar: '#090909',
    skyL: '#3a342c',
    groundL: '#0a0a0a',
    stars: 0.9,
    mist: 0,
    sheen: 0.014,
    bloom: 0.45,
    exposure: 1,
  },
  light: {
    light: '#ffb25c', // a faint candle behind cream paper
    frame: '#c0412a', // vermilion lacquer frames and domes
    gold: '#b7862c',
    teal: '#0f6b63',
    paper: '#eee3cf',
    thread: '#4b4b4b',
    skyTop: '#ececec',
    skyHor: '#fbfbfb',
    hill: '#dadbdc',
    water: '#b5c0c9',
    waterFar: '#f3f4f5',
    skyL: '#ffffff',
    groundL: '#c5cdd3',
    stars: 0,
    mist: 0.55,
    sheen: 0,
    // No bloom by day: the white mist is far above the bloom threshold and would wash the far lanterns out.
    bloom: 0,
    exposure: 1,
  },
};

/** Camera position that frames every point on a wide stage beside the scene rail (free area about 1.45:1). */
function frameAll(pts: Vector3[], target: Vector3, elev: number) {
  const cam = new PerspectiveCamera(42, 1.45, 0.5, 6000);
  const dirV = new Vector3(0, Math.sin(elev), Math.cos(elev));
  const v = new Vector3();
  const fits = (D: number) => {
    cam.position.copy(target).addScaledVector(dirV, D);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    for (const p of pts) {
      v.copy(p).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 0.9 || v.y > 0.78 || v.y < -0.8) return false;
    }
    return true;
  };
  let lo = 4;
  let hi = 5000;
  for (let i = 0; i < 36; i++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }
  return target.clone().addScaledVector(dirV, hi);
}

export const lanternScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const dir = ctx.rtl() ? -1 : 1;
  const size = big ? 0.66 : 0.78;
  const K = 3.4 * size; // lantern scale: the portrait sits in the body like a round window
  const sOf = (p: StudioPerson) => K * sizeFactor(p);
  const pitch = K * (big ? 1.02 : 1.24); // centre to centre along a tier
  const spPitch = pitch * 0.9;
  const SPAN = big ? 3.3 : 2.85;
  const H0 = 1.3 + 0.95 * K;
  const rand = rng(23);

  // Married-in spouses float beside their partner: slot 0 on the end side, 1 on the start side, 2 further out...
  const slots = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) slots.set(p.anchor, [...(slots.get(p.anchor) ?? []), p]);
  for (const list of slots.values()) list.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  const nSp = (p: StudioPerson) => slots.get(p.id)?.length ?? 0;
  const leftW = (p: StudioPerson) => pitch / 2 + Math.floor(nSp(p) / 2) * spPitch;
  const rightW = (p: StudioPerson) => pitch / 2 + Math.ceil(nSp(p) / 2) * spPitch;

  // Leaf-weighted angular sectors in tree order (targets for the packing below).
  const self = (p: StudioPerson) => 1 + 0.9 * nSp(p);
  const W = new Map<string, number>();
  const weigh = (p: StudioPerson): number => {
    const k = p.kids.reduce((s, id) => s + weigh(M.get(id)), 0);
    const w = Math.max(self(p), k);
    W.set(p.id, w);
    return w;
  };
  weigh(M.root);
  const A = new Map<string, number>();
  const sector = (p: StudioPerson, a0: number, a1: number) => {
    A.set(p.id, (a0 + a1) / 2);
    const tot = p.kids.reduce((s, id) => s + (W.get(id) ?? 1), 0);
    if (!tot) return;
    const span = ((a1 - a0) * tot) / (W.get(p.id) ?? tot);
    let a = (a0 + a1) / 2 - span / 2;
    for (const id of p.kids) {
      const w = (span * (W.get(id) ?? 1)) / tot;
      sector(M.get(id), a, a + w);
      a += w;
    }
  };
  sector(M.root, 0, 1);
  const angOf = (p: StudioPerson) => ((A.get(p.id) ?? 0.5) - 0.5) * SPAN;

  /**
   * Arc positions along a tier, as near the targets as the spacing allows. With nr rows, person k shares
   * a row with k - nr (full spacing, spouses included) and only needs a little room from k - 1. The mean of
   * a forward (push right) and a backward (push left) pass keeps every spacing and stays centred.
   */
  const pack = (row: StudioPerson[], nr: number, target: (p: StudioPerson) => number) => {
    const n = row.length;
    const gapTo = (a: StudioPerson, b: StudioPerson, same: boolean) => (same ? rightW(a) + leftW(b) : pitch / nr);
    const f: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = row[k] as StudioPerson;
      let x = target(p);
      for (let j = Math.max(0, k - nr); j < k; j++) {
        const q = row[j] as StudioPerson;
        x = Math.max(x, (f[j] ?? 0) + gapTo(q, p, (k - j) % nr === 0));
      }
      f.push(x);
    }
    const b: number[] = new Array(n).fill(0);
    for (let k = n - 1; k >= 0; k--) {
      const p = row[k] as StudioPerson;
      let x = target(p);
      for (let j = k + 1; j <= Math.min(n - 1, k + nr); j++) {
        const q = row[j] as StudioPerson;
        x = Math.min(x, (b[j] ?? 0) - gapTo(p, q, (j - k) % nr === 0));
      }
      b[k] = x;
    }
    return f.map((x, k) => (x + (b[k] ?? 0)) / 2);
  };
  const extent = (row: StudioPerson[], xs: number[]) => {
    let lo = 0;
    let hi = 0;
    row.forEach((p, k) => {
      lo = Math.min(lo, (xs[k] ?? 0) - leftW(p));
      hi = Math.max(hi, (xs[k] ?? 0) + rightW(p));
    });
    return hi - lo;
  };

  // Tiers: radius and rows per generation; a crowded tier staggers into rows (stadium steps) before it widens.
  const line = M.people.filter((p) => !p.mi);
  const R: number[] = [0];
  const NR: number[] = [1];
  const DR = pitch * 0.95;
  const DY = K * 1.55;
  const rGap = big ? 4.6 : 5.6;
  const maxRows = big ? 3 : 2;
  const Rcap = big ? 52 : 64;
  const xOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  for (let g = 1; g <= M.maxGen; g++) {
    const tier = line.filter((p) => p.gen === g).sort((a, b) => (A.get(a.id) ?? 0) - (A.get(b.id) ?? 0));
    const prevOuter = (R[g - 1] ?? 0) + ((NR[g - 1] ?? 1) - 1) * DR;
    const rMin = Math.max(prevOuter + rGap, g === 1 ? pitch * 2.2 : 0);
    let nr = 1;
    let r = rMin;
    let xs: number[] = [];
    for (; nr <= maxRows; nr++) {
      xs = pack(tier, nr, (p) => angOf(p) * rMin);
      r = Math.max(rMin, extent(tier, xs) / SPAN);
      if (r <= Rcap || nr === maxRows) break;
    }
    nr = Math.min(nr, maxRows);
    if (r > rMin) xs = pack(tier, nr, (p) => angOf(p) * r);
    R.push(r);
    NR.push(tier.length ? nr : 1);
    tier.forEach((p, k) => {
      xOf.set(p.id, xs[k] ?? 0);
      rowOf.set(p.id, k % nr);
    });
  }
  const Rmax = (R[M.maxGen] ?? 0) + ((NR[M.maxGen] ?? 1) - 1) * DR;
  // Tiers climb in proportion to the lake they span, so the fan reads as an amphitheatre.
  const GY = Math.max(big ? 3.6 : 4.6, (Rmax * 0.44) / Math.max(1, M.maxGen));
  const Y: number[] = [H0];
  for (let g = 1; g <= M.maxGen; g++) Y.push((Y[g - 1] ?? H0) + ((NR[g - 1] ?? 1) - 1) * DY + GY);

  const at = new Map<string, Vector3>();
  const thOf = new Map<string, number>();
  const rOf = new Map<string, number>();
  const atOf = (id: string | null) => (id ? at.get(id) : undefined) ?? new Vector3();
  for (const p of line) {
    if (p === M.root) {
      at.set(p.id, new Vector3(0, H0, 0));
      thOf.set(p.id, 0);
      rOf.set(p.id, 0);
      continue;
    }
    const j = rowOf.get(p.id) ?? 0;
    const base = R[p.gen] ?? 0;
    const r = base + j * DR;
    const th = ((xOf.get(p.id) ?? 0) / Math.max(base, 1)) * dir;
    const y = (Y[p.gen] ?? H0) + j * DY + (rand() - 0.5) * 0.6;
    at.set(p.id, new Vector3(Math.sin(th) * r, y, -Math.cos(th) * r));
    thOf.set(p.id, th);
    rOf.set(p.id, r);
  }
  const slotOf = new Map<string, number>();
  for (const [aid, list] of slots) {
    const a = at.get(aid);
    if (!a) continue;
    const r = rOf.get(aid) ?? 0;
    const base = R[M.get(aid).gen] ?? 0;
    list.forEach((p, j) => {
      slotOf.set(p.id, j);
      const off = (j % 2 ? -1 : 1) * (Math.floor(j / 2) + 1) * spPitch * dir;
      if (r < 1) at.set(p.id, new Vector3(a.x + off, a.y - 0.15, a.z));
      else {
        const th = (thOf.get(aid) ?? 0) + off / Math.max(base, 1);
        at.set(p.id, new Vector3(Math.sin(th) * r, a.y - 0.15, -Math.cos(th) * r));
      }
    });
  }
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const v = atOf(p.id);
    pos.set([v.x, v.y, v.z], i * 3);
  });

  // Lake and sky, sharing the theme uniforms with everything else.
  const u = lakeUniforms();
  u.uFanR.value = Rmax * 0.75 + 8;
  u.uFanC.value.set(0, -Rmax * 0.45);
  group.add(skyMesh(u, U), waterMesh(u, U));

  // Lanterns and their reflections (one draw each, same per-person buffers).
  const inst = {
    pos,
    scale: new Float32Array(M.n),
    birth: new Float32Array(M.n),
    death: new Float32Array(M.n),
    phase: new Float32Array(M.n),
  };
  M.people.forEach((p, i) => {
    inst.scale[i] = sOf(p);
    inst.birth[i] = p.born;
    inst.death[i] = p.died ?? 9999;
    inst.phase[i] = rand();
  });
  const attrs = lanternAttrs(inst);
  const keys = M.people.map((p) => p.id);
  const lgeo = lanternGeometry(attrs, keys, big);
  const lanterns = new Mesh(lgeo, lanternMaterial(u, U));
  lanterns.frustumCulled = false;
  const refl = reflectionMesh(attrs, M.n, u, U);
  group.add(lanterns, refl.mesh);

  // Threads: a sagging string from a parent's top knob to the child's bottom finial; gold cords to spouses.
  const B = threadBuilder();
  const segs = big ? 8 : 16;
  const curvePts = (c: QuadraticBezierCurve3, n: number) => Array.from({ length: n + 1 }, (_, i) => c.getPoint(i / n));
  for (const p of line) {
    if (!p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const a = atOf(par.id)
      .clone()
      .add(new Vector3(0, 0.74 * sOf(par), 0));
    const c = atOf(p.id)
      .clone()
      .add(new Vector3(0, -0.7 * sOf(p), 0));
    const mid = a.clone().lerp(c, 0.5);
    mid.y -= a.distanceTo(c) * 0.22;
    addThread(B, curvePts(new QuadraticBezierCurve3(a, mid, c), segs), p.born, p.id, 0, par.born, p.born);
  }
  const glowPos: number[] = [];
  const wedYears: number[] = [];
  const wedKeys: string[] = [];
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const an = M.get(p.anchor);
    const a = atOf(an.id);
    const b = atOf(p.id);
    const side = b.clone().sub(a).setY(0).normalize();
    const yr = spouseYear(M, p);
    const outer = Math.floor((slotOf.get(p.id) ?? 0) / 2);
    const s0 = a.clone().addScaledVector(side, 0.4 * sOf(an));
    const e0 = b.clone().addScaledVector(side, -0.4 * sOf(p));
    if (!outer) {
      // One gold cord between the top rails, drooping a little like a garland.
      const s = s0.clone().setY(a.y + 0.3 * sOf(an));
      const e = e0.clone().setY(b.y + 0.3 * sOf(p));
      const mid = s.clone().lerp(e, 0.5);
      mid.y -= 0.3 * K;
      addThread(B, curvePts(new QuadraticBezierCurve3(s, mid, e), big ? 5 : 8), yr, p.id, 1, an.born, p.born);
      const m = a.clone().lerp(b, 0.5);
      glowPos.push(m.x, m.y, m.z);
      wedYears.push(yr);
      wedKeys.push(p.id);
    } else {
      // A second wife further out: the cord arches over the nearer lantern instead of passing through it.
      const s = a.clone().add(new Vector3(0, 0.74 * sOf(an), 0));
      const e = b.clone().add(new Vector3(0, 0.74 * sOf(p), 0));
      const mid = s.clone().lerp(e, 0.5);
      mid.y += K * (0.7 + 0.5 * outer);
      addThread(B, curvePts(new QuadraticBezierCurve3(s, mid, e), big ? 6 : 12), yr, p.id, 1, an.born, p.born);
    }
  }
  const threads = threadMesh(B, u, U);
  group.add(threads.mesh);

  // Floating diyas in front of the fan, wedding glows between spouses and a halo round each lantern.
  const nD = big ? 16 : 11;
  const nW = wedYears.length;
  const total = nD + nW + M.n;
  const gd = {
    pos: new Float32Array(total * 3),
    kind: new Float32Array(total),
    phase: new Float32Array(total),
    birth: new Float32Array(total),
    death: new Float32Array(total).fill(9999),
    keys: new Array<string>(total).fill(''),
  };
  const rings = u.uRings.value;
  rings[0]?.set(0, 0, 0.13, 1);
  for (let i = 0; i < total; i++) {
    gd.phase[i] = rand();
    if (i < nD) {
      const th = (rand() - 0.5) * 2.3 + Math.PI;
      const r = 7 + rand() * (Rmax * 0.5 + 8);
      const x = Math.sin(th) * r;
      const z = -Math.cos(th) * r - 2;
      gd.pos.set([x, 0.12, z], i * 3);
      gd.kind[i] = 1;
      rings[i + 1]?.set(x, z, rand(), 0.55);
    } else if (i < nD + nW) {
      const k = i - nD;
      gd.pos.set(glowPos.slice(k * 3, k * 3 + 3), i * 3);
      gd.kind[i] = 2;
      gd.birth[i] = wedYears[k] ?? 0;
      gd.keys[i] = wedKeys[k] ?? '';
    } else {
      const j = i - nD - nW;
      const p = M.people[j] as StudioPerson;
      gd.pos.set([pos[j * 3] ?? 0, pos[j * 3 + 1] ?? 0, pos[j * 3 + 2] ?? 0], i * 3);
      gd.kind[i] = 3;
      gd.birth[i] = p.born;
      gd.death[i] = p.died ?? 9999;
      gd.keys[i] = p.id;
    }
  }
  const glows = glowPoints(gd, u, U, { wed: K * 1.7, halo: K * 2.1, diya: big ? 1.1 : 0.9 });
  group.add(glows.pts);

  // Theme colours only (safe while building); tint() also sets the stage's bloom and exposure.
  const paint = () => {
    const dark = ctx.dark();
    const L = dark ? LOOK.dark : LOOK.light;
    u.uSkyTop.value.copy(lin(L.skyTop));
    u.uSkyHor.value.copy(lin(L.skyHor));
    u.uHill.value.copy(lin(L.hill));
    u.uStars.value = L.stars;
    u.uWater.value.copy(lin(L.water));
    u.uWaterFar.value.copy(lin(L.waterFar));
    u.uMist.value = L.mist;
    u.uSheen.value = L.sheen;
    u.uWarm.value.copy(lin(L.light));
    u.uPaper.value.copy(lin(L.paper));
    u.uFrame.value.copy(lin(L.frame));
    u.uHi.value.copy(lin(L.teal));
    u.uGold.value.copy(lin(L.gold));
    u.uThread.value.copy(lin(L.thread));
    u.uSkyL.value.copy(lin(L.skyL));
    u.uGroundL.value.copy(lin(L.groundL));
    u.uDay.value = dark ? 0 : 1;
    u.uExpo.value = L.exposure;
    // Large families: hundreds of threads and reflections would turn into a web and a wall of light.
    u.uThreadA.value = (dark ? 0.5 : 0.55) * (big ? 0.62 : 1);
    u.uRefl.value = big ? 0.6 : 1;
    refl.mat.blending = dark ? AdditiveBlending : NormalBlending;
    glows.pts.material.blending = dark ? AdditiveBlending : NormalBlending;
  };
  paint();
  const tint = () => {
    paint();
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    ctx.look(L.bloom, L.exposure);
  };

  // Default view: the whole fan and the founder's reflection, seen from the front and a little above.
  const fitPts: Vector3[] = [];
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  let y1 = 0;
  M.people.forEach((p) => {
    const v = atOf(p.id);
    const s = sOf(p);
    fitPts.push(v.clone().setY(v.y + 0.85 * s), v.clone().setY(v.y - 0.8 * s));
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    z0 = Math.min(z0, v.z);
    z1 = Math.max(z1, v.z);
    y1 = Math.max(y1, v.y);
  });
  fitPts.push(new Vector3(0, -H0 * 1.2, 0));
  const target = new Vector3((x0 + x1) / 2, y1 * 0.4, (z0 + z1) / 2);
  const cam = frameAll(fitPts, target, 0.3);

  return {
    key: 'lantern',
    group,
    pos,
    size,
    style: 0,
    lift: 6,
    tint,
    labelScale: 0.85,
    hiTargets: [{ geo: lgeo, perPerson: true }, { geo: threads.geo }, { geo: glows.geo, perPerson: true }],
    focus: [u.uFocus],
    view: { target, cam },
    follow: big ? 13 : 16,
  };
};
