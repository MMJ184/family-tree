import {
  BufferGeometry as BG,
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { layoutGrove, type Palm } from './palm-layout.ts';
import {
  basinMat,
  dateMat,
  falajMat,
  frondMat,
  frondTexture,
  LOOK,
  lampMat,
  makeLight,
  sandMat,
  shadowMat,
  skyMat,
  trunkMat,
} from './palm-mat.ts';
import type { SceneBuilder } from './types.ts';

// Date Palm Oasis: date palms multiply by offshoots (fasail) that sprout at the mother palm's foot and
// are planted out to become palms themselves. The founder is the tall mother palm at the heart of the
// oasis; each child is an offshoot planted outward on the next ring, younger and shorter, fed by a
// falaj channel from the parent's basin. Spouses stand beside their partner on the same ring path,
// joined by a gold-inlaid walk. Night: black desert, moonlit dunes, lanterns at every palm's foot.
// Day: white dunes, deep green fronds and soft cast shadows. Draw calls: sky, sand, falaj, basins,
// shadows, lantern pools, trunks, fronds (with grass tufts), dates, flames.

const TAU = Math.PI * 2;
const SUN = new Vector3(-0.5, 1, -0.38).normalize();
const MOON = new Vector3(-0.36, 0.42, -0.83).normalize();
/** The crescent hangs low over the far dunes, in the gap between the studio's top controls in the default view. */
const MOON_DISC = new Vector3(-0.219, 0.03, -0.977).normalize();

/** Copies a template geometry into an instanced one with the given per-instance attributes. */
function instanced(base: BufferGeometry, count: number, attrs: Record<string, [Float32Array, number]>) {
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  for (const [k, v] of Object.entries(base.attributes)) g.setAttribute(k, v);
  for (const [k, [arr, size]] of Object.entries(attrs)) g.setAttribute(k, new InstancedBufferAttribute(arr, size));
  g.instanceCount = count;
  return g;
}

/** Per-palm attributes repeated `per` times (one entry per frond, cluster...). */
function palmAttrs(palms: Palm[], per: number) {
  const n = palms.length * per;
  const aPalm = new Float32Array(n * 4);
  const aLean = new Float32Array(n * 2);
  const aLife = new Float32Array(n * 2);
  const aHi = new Float32Array(n);
  const keys: string[] = [];
  palms.forEach((pl, i) => {
    for (let k = 0; k < per; k++) {
      const j = i * per + k;
      aPalm.set([pl.x, pl.z, pl.h, pl.phase], j * 4);
      aLean.set([pl.lx, pl.lz], j * 2);
      aLife.set([pl.p.born, pl.p.died ?? 9999], j * 2);
      keys.push(pl.p.id);
    }
  });
  return {
    n,
    keys,
    attrs: { aPalm: [aPalm, 4], aLean: [aLean, 2], aLife: [aLife, 2], aHi: [aHi, 1] } as Record<
      string,
      [Float32Array, number]
    >,
  };
}

/** A hanging cluster of dates (one template, instanced under every crown). */
function clusterGeometry(big: boolean): BufferGeometry {
  const r = rng(5);
  const parts: BufferGeometry[] = [];
  const n = big ? 12 : 22;
  for (let i = 0; i < n; i++) {
    const s = big ? new SphereGeometry(0.14, 5, 3) : new SphereGeometry(0.12, 6, 4);
    s.scale(0.72, 1, 0.72);
    const y = -0.12 - r() * 0.9;
    const rad = 0.06 + -y * 0.32 * Math.sqrt(r());
    const a = r() * TAU;
    s.translate(Math.cos(a) * rad, y, Math.sin(a) * rad);
    parts.push(s);
  }
  const g = mergeGeometries(parts) ?? new BG();
  for (const p of parts) p.dispose();
  return g;
}

export const palmScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const rtl = ctx.rtl();
  const grove = layoutGrove(M, big, rtl);
  const { palms, byId, G, H0, ring, gens } = grove;
  // Anyone the layout could not place (bad data): beside the mother palm.
  for (const p of M.people)
    if (!byId.has(p.id)) {
      const a = (palms.length * 2.39996) % TAU;
      const pl: Palm = { p, x: Math.cos(a) * 6, z: Math.sin(a) * 6, h: H0 * 0.6, lx: 0, lz: 0, th: a, r: 6, phase: 0 };
      palms.push(pl);
      byId.set(p.id, pl);
    }
  const L = makeLight();
  L.uCamLod.value = big ? Math.max(110, G * 1.25) : 1e5;

  // ---- portraits float just clear of the young fronds at the top of each crown ----
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const pl = byId.get(p.id) as Palm;
    pos.set([pl.x + pl.lx * pl.h, pl.h * 1.2 + 1, pl.z + pl.lz * pl.h], i * 3);
  });

  // ---- trunks ----
  const tA = palmAttrs(palms, 1);
  const trunkBase = new CylinderGeometry(1, 1, 1, big ? 7 : 10, big ? 8 : 14, true);
  trunkBase.translate(0, 0.5, 0);
  const trunkGeo = instanced(trunkBase, tA.n, tA.attrs);
  trunkGeo.userData.keys = tA.keys;
  const trunk = trunkMat(U, L);
  const trunkMesh = new Mesh(trunkGeo, trunk.mat);
  trunkMesh.frustumCulled = false;

  // ---- fronds: three tiers (young upright, spreading, old drooping), golden-angle spiral ----
  const F = big ? 12 : 18;
  const fA = palmAttrs(palms, F);
  const aFr = new Float32Array(fA.n * 4);
  const aCol = new Float32Array(fA.n * 3);
  const fr = rng(23);
  palms.forEach((pl, i) => {
    for (let k = 0; k < F; k++) {
      const j = i * F + k;
      const tier = k / F;
      const pitch = tier < 0.3 ? 0.62 + fr() * 0.15 : tier < 0.68 ? 0.12 + fr() * 0.16 : -0.22 - fr() * 0.18;
      const len = (tier < 0.3 ? 0.3 : tier < 0.68 ? 0.4 : 0.37) * (0.9 + fr() * 0.2);
      aFr.set([k * 2.39996 + pl.phase, pitch, len, k % 2 && tier >= 0.3 ? 1 : 0], j * 4);
      // Per-frond tone: younger fronds a touch brighter, a slight warm/cool drift between leaves.
      const v = (0.9 + fr() * 0.16) * (tier < 0.3 ? 1.08 : tier < 0.68 ? 1 : 0.9);
      const h = (fr() - 0.5) * 0.08;
      aCol.set([v * (1 + h), v, v * (1 - h)], j * 3);
    }
  });
  // Desert grass tufts on the oasis floor: extra frond instances on a near-zero trunk (same draw call).
  const T = Math.round(Math.min(big ? 300 : 200, 30 + G * 1.1));
  const BL = 6;
  const tN = fA.n + T * BL;
  const grow = (a: Float32Array, size: number) => {
    const out = new Float32Array(tN * size);
    out.set(a);
    return out;
  };
  const at = fA.attrs as Record<string, [Float32Array, number]>;
  const gPalm = grow((at.aPalm as [Float32Array, number])[0], 4);
  const gLean = grow((at.aLean as [Float32Array, number])[0], 2);
  const gLife = grow((at.aLife as [Float32Array, number])[0], 2);
  const gFr = grow(aFr, 4);
  const gCol = grow(aCol, 3);
  const tr = rng(41);
  for (let t = 0; t < T; t++) {
    const a = tr() * TAU;
    const r = Math.sqrt(tr()) * G * 1.05 + 3;
    const ph = tr() * 100;
    for (let k = 0; k < BL; k++) {
      const j = fA.n + t * BL + k;
      gPalm.set([Math.cos(a) * r, Math.sin(a) * r, 0.05, ph], j * 4);
      gLife.set([M.minYear - 6, 9999], j * 2);
      gFr.set([k * 2.39996 + ph, 0.45 + tr() * 0.6, 9 + tr() * 9, big ? 1 : 0], j * 4);
      const v = 0.85 + tr() * 0.3;
      gCol.set([v, v, v], j * 3);
    }
  }
  const frondBase = new PlaneGeometry(1, 1, 1, big ? 6 : 9);
  frondBase.translate(0, 0.5, 0);
  const frondGeo = instanced(frondBase, tN, {
    aPalm: [gPalm, 4],
    aLean: [gLean, 2],
    aLife: [gLife, 2],
    aHi: [new Float32Array(tN), 1],
    aFr: [gFr, 4],
    aCol: [gCol, 3],
  });
  frondGeo.userData.keys = [...fA.keys, ...new Array<string>(T * BL).fill('')];
  const tex = frondTexture();
  const frond = frondMat(U, L, tex);
  const frondMesh = new Mesh(frondGeo, frond.mat);
  frondMesh.frustumCulled = false;

  // ---- dates ----
  const C = big ? 2 : 4;
  const dA = palmAttrs(palms, C);
  const aDir = new Float32Array(dA.n);
  palms.forEach((pl, i) => {
    for (let k = 0; k < C; k++) aDir[i * C + k] = (k / C) * TAU + pl.phase * 1.3;
  });
  const dateGeo = instanced(clusterGeometry(big), dA.n, { ...dA.attrs, aDir: [aDir, 1] });
  dateGeo.userData.keys = dA.keys;
  const dates = dateMat(U, L);
  const dateMesh = new Mesh(dateGeo, dates.mat);
  dateMesh.frustumCulled = false;

  // ---- basins, shadows and lanterns ----
  const bA = palmAttrs(palms, 1);
  const basinGeo = instanced(new PlaneGeometry(2, 2), bA.n, bA.attrs);
  basinGeo.userData.keys = bA.keys;
  const basin = basinMat(U, L);
  const basinMesh = new Mesh(basinGeo, basin.mat);
  basinMesh.frustumCulled = false;
  basinMesh.renderOrder = 1;
  const shadowGeo = instanced(new PlaneGeometry(2, 2), bA.n, bA.attrs);
  shadowGeo.userData.keys = bA.keys;
  const shadow = shadowMat(U, L);
  const shadowMesh = new Mesh(shadowGeo, shadow.mat);
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = 2;
  const lampGeo = instanced(new PlaneGeometry(1, 1), bA.n, bA.attrs);
  lampGeo.userData.keys = bA.keys;
  const pool = lampMat(U, L, false);
  const flame = lampMat(U, L, true);
  const poolMesh = new Mesh(lampGeo, pool.mat);
  const flameMesh = new Mesh(lampGeo, flame.mat);
  for (const m of [poolMesh, flameMesh]) m.frustumCulled = false;
  poolMesh.renderOrder = 3;
  flameMesh.renderOrder = 6;

  // ---- falaj: a channel from each parent's basin out to the child's, bending along the rings ----
  const W = {
    pos: [] as number[],
    t: [] as number[],
    s: [] as number[],
    birth: [] as number[],
    len: [] as number[],
    gold: [] as number[],
  };
  const keys: string[] = [];
  const idx: number[] = [];
  const ribbon = (pts: Vector3[], width: number, birth: number, key: string, gold: number) => {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += (pts[i] as Vector3).distanceTo(pts[i - 1] as Vector3);
    const base = W.pos.length / 3;
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as Vector3;
      const a = pts[Math.max(0, i - 1)] as Vector3;
      const b = pts[Math.min(pts.length - 1, i + 1)] as Vector3;
      if (i > 0) acc += p.distanceTo(pts[i - 1] as Vector3);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1;
      const nx = -dz / dl;
      const nz = dx / dl;
      for (const s of [-1, 1]) {
        W.pos.push(p.x + nx * width * 0.5 * s, p.y, p.z + nz * width * 0.5 * s);
        W.t.push(total ? acc / total : 0);
        W.s.push(s);
        W.birth.push(birth);
        W.len.push(total);
        W.gold.push(gold);
        keys.push(key);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  const ww = big ? 1.5 : 1.05;
  const spring = (H0 * 0.14 + 0.7) * 1.75 * 0.72;
  const rootLeaves = Math.max(1, M.root.leaves);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = byId.get(p.parent);
    const b = byId.get(p.id);
    if (!a || !b) continue;
    let dth = b.th - a.th;
    while (dth > Math.PI) dth -= TAU;
    while (dth < -Math.PI) dth += TAU;
    // Channels leave the founder's spring at its stone rim; elsewhere they start in the parent's basin.
    const fromSpring = a.r < 0.01;
    const th0 = fromSpring ? b.th : a.th;
    const r0 = fromSpring ? spring : a.r;
    const segs = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (big ? 3 : 1.4)));
    const pts: Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = r0 + (b.r - r0) * t;
      const s = t * t * (3 - 2 * t);
      const th = th0 + (fromSpring ? 0 : dth * Math.min(1, s * 1.15));
      pts.push(new Vector3(Math.cos(th) * r, 0.05, Math.sin(th) * r));
    }
    if (!fromSpring) pts[0]?.set(a.x, 0.05, a.z);
    pts[segs]?.set(b.x, 0.05, b.z);
    ribbon(pts, ww * (0.75 + 0.7 * Math.sqrt(p.leaves / rootLeaves)), p.born, p.id, 0);
  }
  // Marriages: a gold-tiled walk from each partner's basin to the spouse's (drawn over channels and basins).
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = byId.get(p.anchor);
    const b = byId.get(p.id);
    if (!a || !b) continue;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      pts.push(new Vector3(a.x + (b.x - a.x) * t, 0.06, a.z + (b.z - a.z) * t));
    }
    ribbon(pts, ww * 0.95, spouseYear(M, p), p.id, 1);
  }
  const falajGeo = new BG();
  falajGeo.setAttribute('position', new Float32BufferAttribute(W.pos, 3));
  falajGeo.setAttribute('aT', new Float32BufferAttribute(W.t, 1));
  falajGeo.setAttribute('aS', new Float32BufferAttribute(W.s, 1));
  falajGeo.setAttribute('aBirth', new Float32BufferAttribute(W.birth, 1));
  falajGeo.setAttribute('aLen', new Float32BufferAttribute(W.len, 1));
  falajGeo.setAttribute('aGold', new Float32BufferAttribute(W.gold, 1));
  falajGeo.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(keys.length), 1));
  falajGeo.setIndex(idx);
  falajGeo.userData.keys = keys;
  const falaj = falajMat(U, L);
  const falajMesh = new Mesh(falajGeo, falaj.mat);
  falajMesh.renderOrder = 1.5;

  // ---- sand, dunes and sky ----
  const S = Math.min(1300, G * 4 + 260);
  const sand = sandMat(L, G);
  sand.uni.uRing.value = ring;
  sand.uni.uGens.value = gens;
  sand.uni.uPathW.value = big ? 0.8 : 0.6;
  sand.uni.uHazeR.value = Math.max(S * 0.92, G * 1.7 + 60);
  const sandMesh = new Mesh(new PlaneGeometry(S * 2, S * 2, 240, 240), sand.mat);
  sandMesh.frustumCulled = false;
  sandMesh.renderOrder = -1;
  const sky = skyMat(L, U);
  const skyMesh = new Mesh(new SphereGeometry(1400, 48, 24), sky.mat);
  skyMesh.renderOrder = -2;
  skyMesh.frustumCulled = false;

  group.add(skyMesh, sandMesh, falajMesh, basinMesh, shadowMesh, poolMesh, trunkMesh, frondMesh, dateMesh, flameMesh);

  const sunDir = () => {
    const d = (ctx.dark() ? MOON : SUN).clone();
    const disc = MOON_DISC.clone();
    if (rtl) {
      d.x = -d.x;
      disc.x = -disc.x;
    }
    L.uSun.value.copy(d);
    L.uDisc.value.copy(disc);
  };
  const tint = () => {
    const K = ctx.dark() ? LOOK.dark : LOOK.light;
    sunDir();
    L.uKey.value.copy(lin(K.key)).multiplyScalar(K.keyK);
    L.uFill.value.copy(lin(K.fill)).multiplyScalar(K.fillK);
    L.uBounce.value.copy(lin(K.bounce)).multiplyScalar(K.bounceK);
    L.uRim.value.copy(lin(K.rim)).multiplyScalar(K.rimK);
    L.uHaze.value.copy(lin(K.horizon)).multiplyScalar(K.horizonK);
    // Depth haze only for far-away views; the open desert fades by distance from the grove (sand shader).
    L.uFogNear.value = G * 3 + 260;
    L.uFogFar.value = G * 6 + 900;
    L.uLamp.value.copy(lin(K.lamp)).multiplyScalar(K.lampK);
    L.uNight.value = K.night ? 1 : 0;
    L.uSel.value.copy(lin(K.sel));
    L.uGold.value.copy(lin(K.gold));
    L.uDim.value.copy(lin(K.dim)).multiplyScalar(K.dimL);
    L.uDimK.value = K.dimK;
    L.uShadowC.value = K.contact;
    L.uShadow.value = K.shadow;
    sky.uni.uTop.value.copy(lin(K.zenith)).multiplyScalar(K.zenithK);
    sky.uni.uHor.value.copy(lin(K.horizon)).multiplyScalar(K.horizonK);
    trunk.uni.uA.value.copy(lin(K.trunk));
    trunk.uni.uB.value.copy(lin(K.trunkDark));
    frond.uni.uLeaf.value.copy(lin(K.frond));
    frond.uni.uUnder.value.copy(lin(K.frondUnder));
    frond.uni.uDry.value.copy(lin(K.dry));
    frond.uni.uGrass.value.copy(lin(K.grass));
    dates.uni.uDateA.value.copy(lin(K.dateA));
    dates.uni.uDateB.value.copy(lin(K.dateB));
    dates.uni.uDateC.value.copy(lin(K.dateC));
    basin.uni.uSoil.value.copy(lin(K.soil));
    basin.uni.uEdge.value.copy(lin(K.bed));
    basin.uni.uWater.value.copy(lin(K.water));
    basin.uni.uDeep.value.copy(lin(K.waterDeep));
    basin.uni.uGlint.value.copy(lin(K.glint));
    basin.uni.uStone.value.copy(lin(K.bank));
    falaj.uni.uWater.value.copy(lin(K.water));
    falaj.uni.uDeep.value.copy(lin(K.waterDeep));
    falaj.uni.uGlint.value.copy(lin(K.glint));
    falaj.uni.uBank.value.copy(lin(K.bank));
    sand.uni.uSand.value.copy(lin(K.sand));
    sand.uni.uBed.value.copy(lin(K.bed));
    sand.uni.uPath.value.copy(lin(K.path));
    poolMesh.visible = K.night;
    flameMesh.visible = K.night;
    ctx.look(K.bloom, K.exposure);
  };

  // Default view: the whole grove beside the scene rail, a band of sky above the dunes; Arabic mirrors it.
  // (Checked for every demo family with a projection of all portraits and name pills at 1280x800.)
  const target = new Vector3(0, H0 * (big ? 0.45 : 0.8), G * (big ? 0.12 : 0.16));
  const dist = big ? G * 1.95 + 30 : G * 1.2 + 26;
  const el = big ? 0.55 : 0.3;
  const az = 0.28;
  const camAt = (r: boolean) =>
    new Vector3(
      (r ? -1 : 1) * Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
  const view = { target, cam: camAt(rtl) };

  return {
    key: 'palm',
    group,
    pos,
    size: big ? 1.35 : 1.1,
    style: 0,
    lift: 4,
    labelUp: true,
    labelScale: 0.85,
    tint,
    hiTargets: [
      { geo: trunkGeo, perPerson: true },
      { geo: frondGeo, perPerson: true },
      { geo: dateGeo, perPerson: true },
      { geo: basinGeo, perPerson: true },
      { geo: shadowGeo, perPerson: true },
      { geo: lampGeo, perPerson: true },
      { geo: falajGeo },
    ],
    focus: [
      trunk.uni.uFocus,
      frond.uni.uFocus,
      dates.uni.uFocus,
      basin.uni.uFocus,
      shadow.uni.uFocus,
      falaj.uni.uFocus,
      pool.uni.uFocus,
      flame.uni.uFocus,
    ],
    view,
    follow: big ? 34 : 26,
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
      sunDir();
    },
  };
};
