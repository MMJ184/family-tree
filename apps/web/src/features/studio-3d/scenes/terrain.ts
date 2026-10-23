import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { skyDome } from '../gl.ts';
import { spouseYear } from '../model.ts';
import { lin } from '../palette.ts';
import { buildAtlas, kfWeights } from './terrain-field.ts';
import {
  BIZ_FS,
  BIZ_VS,
  PAPER_FS,
  PAPER_VS,
  PIN_FS,
  PIN_VS,
  TERRAIN_FS,
  TERRAIN_VS,
  TRAIL_FS,
  TRAIL_VS,
} from './terrain-glsl.ts';
import type { SceneBuilder } from './types.ts';

// Family Atlas: the family as a topographic island. The founder is the summit, each line of
// descent a ridge as high as the line is big; people are map pins on the slopes and descent
// paths are trails on the ground. Printed atlas by day, glowing GIS contours by night.

const LIGHT = {
  ramp: ['#9fcaa6', '#c4dba5', '#ece2b2', '#ebc89e', '#e0a493', '#e8bcbb', '#f7e9e6'],
  seaHi: '#d5ebe5',
  seaLo: '#a3cad2',
  ink: '#8a5b3d',
  inkHi: '#7a3f3f',
  seaInk: '#6c9caa',
  grid: '#3f6f8e',
  shade: '#a9b6d6',
  lit: '#fff6e8',
  paper: '#f4eddc',
  accent: '#3e6a78',
  desk: '#cfc6b5',
  far: '#e6dfd2',
  frame: '#3b3a36',
  stem: '#2c2b30',
  trail: '#b8432c',
  trailCase: '#fbf6ec',
  trailHi: '#e2401f',
  gold: '#c7942f',
};

const DARK = {
  ramp: ['#0d3438', '#11423f', '#1b3f4c', '#2a3a5a', '#47336a', '#6f3a73', '#a04f86'],
  seaHi: '#0a2230',
  seaLo: '#040c14',
  ink: '#33f0cf',
  inkHi: '#ff6fb3',
  seaInk: '#1d6f8a',
  grid: '#1fa8d8',
  shade: '#6e7fa8',
  lit: '#d8e6ff',
  paper: '#081420',
  accent: '#7af5ff',
  desk: '#03070c',
  far: '#02050a',
  frame: '#2fd5c6',
  stem: '#2a3b48',
  trail: '#ffcf7a',
  trailCase: '#000000',
  trailHi: '#fff1c4',
  gold: '#ffc45a',
};

export const terrainScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const rtl = ctx.rtl();
  const group = new Group();
  const A = buildAtlas(M, big, rtl);
  const { S, hMax } = A;
  const pos = new Float32Array(M.n * 3);
  const size = big ? 1.2 : 1.45;
  const stem = big ? 3.2 : 3.6;

  // Height uniforms shared by every draped material.
  const hU = {
    uHA: { value: A.texA },
    uHB: { value: A.texB },
    uWA: { value: new Vector4(0, 0, 0, 0) },
    uWB: { value: new Vector4(0, 0, 0, 1) },
    uS: { value: S },
  };
  const wa = [0, 0, 0, 0];
  const wb = [0, 0, 0, 0];
  const reweigh = () => {
    kfWeights(A.years, ctx.effYear(), wa, wb);
    hU.uWA.value.fromArray(wa);
    hU.uWB.value.fromArray(wb);
  };
  reweigh();

  // Terrain: one draped grid, coloured and contoured in the fragment shader.
  const grid = S / (big ? 5 : 4);
  const sgn = rtl ? -1 : 1;
  const terrainUni = {
    ...hU,
    uTime: U.uTime,
    uRamp: { value: LIGHT.ramp.map(lin) },
    uSeaLo: { value: lin(LIGHT.seaLo) },
    uSeaHi: { value: lin(LIGHT.seaHi) },
    uInk: { value: lin(LIGHT.ink) },
    uInkHi: { value: lin(LIGHT.inkHi) },
    uSeaInk: { value: lin(LIGHT.seaInk) },
    uGridC: { value: lin(LIGHT.grid) },
    uShade: { value: lin(LIGHT.shade) },
    uLit: { value: lin(LIGHT.lit) },
    uPaper: { value: lin(LIGHT.paper) },
    uAccent: { value: lin(LIGHT.accent) },
    uHMax: { value: hMax },
    uInt: { value: hMax / 14 },
    uDeep: { value: Math.max(5, hMax * 0.3) },
    uGrid: { value: grid },
    uTexel: { value: (2 * S) / A.n },
    uDark: { value: 0 },
    uFocus: { value: 0 },
    uRtl: { value: sgn },
    uCompass: { value: [S * 0.8 * sgn, S * 0.8] },
    uBar: { value: [-S * 0.86 * sgn, S * 0.9] },
  };
  const segs = big ? 300 : 220;
  const tGeo = new PlaneGeometry(2 * S, 2 * S, segs, segs);
  tGeo.rotateX(-Math.PI / 2);
  const terrainMat = new ShaderMaterial({ uniforms: terrainUni, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
  const terrain = new Mesh(tGeo, terrainMat);
  terrain.frustumCulled = false;
  group.add(terrain);

  // Paper sheet with the neatline, on a desk.
  const band = S * 0.035;
  const margin = S * 0.1;
  const paperUni = {
    uPaper: { value: lin(LIGHT.paper) },
    uInk: { value: lin(LIGHT.frame) },
    uDesk: { value: lin(LIGHT.desk) },
    uFar: { value: lin(LIGHT.far) },
    uGlow: { value: lin(DARK.frame) },
    uS: { value: S },
    uB: { value: band },
    uM: { value: margin },
    uGrid: { value: grid },
    uDark: { value: 0 },
  };
  const pGeo = new PlaneGeometry(S * 14, S * 14);
  pGeo.rotateX(-Math.PI / 2);
  const paper = new Mesh(
    pGeo,
    new ShaderMaterial({ uniforms: paperUni, vertexShader: PAPER_VS, fragmentShader: PAPER_FS }),
  );
  paper.position.y = -0.05;
  group.add(paper);

  // Pins: a needle from the ground up to the portrait, and a coloured ring at its foot.
  const pinGeo = (() => {
    const parts: BufferGeometry[] = [new CylinderGeometry(0.07, 0.11, 1, 6, 1, true).translate(0, 0.5, 0)];
    const ring = new RingGeometry(big ? 0.28 : 0.4, big ? 0.55 : 0.8, 18);
    ring.rotateX(-Math.PI / 2);
    parts.push(ring);
    const P: number[] = [];
    const N: number[] = [];
    const part: number[] = [];
    const idx: number[] = [];
    parts.forEach((g, k) => {
      const base = P.length / 3;
      P.push(...(g.getAttribute('position').array as Float32Array));
      N.push(...(g.getAttribute('normal').array as Float32Array));
      for (let i = 0; i < g.getAttribute('position').count; i++) part.push(k);
      for (const i of g.getIndex()?.array ?? []) idx.push(base + i);
      g.dispose();
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new Float32BufferAttribute(N, 3));
    g.setAttribute('aPart', new Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    return g;
  })();
  const n = M.n;
  const aXZ = new Float32Array(n * 2);
  const aTop = new Float32Array(n);
  const aBirth = new Float32Array(n);
  const aDeath = new Float32Array(n);
  const aCol = new Float32Array(n * 3);
  M.people.forEach((p, i) => {
    const v = A.at.get(p.id) ?? new Vector3();
    aXZ[i * 2] = v.x;
    aXZ[i * 2 + 1] = v.z;
    const s = p.mi ? stem * 0.8 : stem;
    aTop[i] = v.y + s;
    aBirth[i] = p.born;
    aDeath[i] = p.died ?? 9999;
    const c = lin(p.color);
    aCol.set([c.r, c.g, c.b], i * 3);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y + s + size * 1.05;
    pos[i * 3 + 2] = v.z;
  });
  pinGeo.setAttribute('aXZ', new InstancedBufferAttribute(aXZ, 2));
  pinGeo.setAttribute('aTop', new InstancedBufferAttribute(aTop, 1));
  pinGeo.setAttribute('aBirth', new InstancedBufferAttribute(aBirth, 1));
  pinGeo.setAttribute('aDeath', new InstancedBufferAttribute(aDeath, 1));
  pinGeo.setAttribute('aCol', new InstancedBufferAttribute(aCol, 3));
  pinGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  pinGeo.userData.keys = M.people.map((p) => p.id);
  const pinUni = { ...hU, ...U, uStem: { value: lin(LIGHT.stem) }, uDark: { value: 0 }, uFocus: { value: 0 } };
  const pins = new InstancedMesh(
    pinGeo,
    new ShaderMaterial({ uniforms: pinUni, vertexShader: PIN_VS, fragmentShader: PIN_FS, side: DoubleSide }),
    n,
  );
  pins.frustumCulled = false;
  group.add(pins);

  // Trails: ribbons draped on the ridges, parent to child; dotted links to spouses.
  const T = { p: [] as number[], off: [] as number[], t: [] as number[], l: [] as number[] };
  const attr = { birth: [] as number[], kind: [] as number[], side: [] as number[], key: [] as string[] };
  const idx: number[] = [];
  const ribbon = (pts: Array<[number, number]>, birth: number, kind: number, key: string) => {
    const base = T.p.length / 3;
    let L = 0;
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)] ?? q;
      const b = pts[Math.min(pts.length - 1, i + 1)] ?? q;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      if (i) {
        const pr = pts[i - 1] ?? q;
        L += Math.hypot(q[0] - pr[0], q[1] - pr[1]);
      }
      for (const s of [-1, 1]) {
        T.p.push(q[0], 0, q[1]);
        T.off.push((-dz / len) * s, (dx / len) * s);
        T.t.push(i / (pts.length - 1));
        T.l.push(L);
        attr.birth.push(birth);
        attr.kind.push(kind);
        attr.side.push(s);
        attr.key.push(key);
      }
      if (i) {
        const v = base + i * 2;
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    });
  };
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = A.polar.get(p.parent);
    const b = A.polar.get(p.id);
    if (!a || !b) continue;
    const len = Math.hypot(b.r - a.r, ((a.r + b.r) / 2) * (b.th - a.th));
    const k = Math.max(8, Math.ceil(len / (big ? 1.4 : 1)));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= k; i++) {
      const t = i / k;
      pts.push(A.xz(a.r + (b.r - a.r) * t, a.r < 1e-3 ? b.th : a.th + (b.th - a.th) * t));
    }
    ribbon(pts, p.born, 0, p.id);
  }
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = A.at.get(p.anchor);
    const b = A.at.get(p.id);
    if (!a || !b) continue;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 6; i++) pts.push([a.x + (b.x - a.x) * (i / 6), a.z + (b.z - a.z) * (i / 6)]);
    ribbon(pts, spouseYear(M, p), 1, p.id);
  }
  const trGeo = new BufferGeometry();
  trGeo.setAttribute('position', new Float32BufferAttribute(T.p, 3));
  trGeo.setAttribute('aOff', new Float32BufferAttribute(T.off, 2));
  trGeo.setAttribute('aT', new Float32BufferAttribute(T.t, 1));
  trGeo.setAttribute('aL', new Float32BufferAttribute(T.l, 1));
  trGeo.setAttribute('aBirth', new Float32BufferAttribute(attr.birth, 1));
  trGeo.setAttribute('aKind', new Float32BufferAttribute(attr.kind, 1));
  trGeo.setAttribute('aSide', new Float32BufferAttribute(attr.side, 1));
  trGeo.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(attr.key.length), 1));
  trGeo.setIndex(idx);
  trGeo.userData.keys = attr.key;
  const trailUni = {
    ...hU,
    ...U,
    uW: { value: big ? 0.24 : 0.42 },
    uDash: { value: big ? 1.6 : 2.2 },
    uA: { value: big ? 0.6 : 1 },
    uCore: { value: lin(LIGHT.trail) },
    uCase: { value: lin(LIGHT.trailCase) },
    uHiC: { value: lin(LIGHT.trailHi) },
    uDark: { value: 0 },
    uFocus: { value: 0 },
  };
  const trails = new Mesh(
    trGeo,
    new ShaderMaterial({
      uniforms: trailUni,
      vertexShader: TRAIL_VS,
      fragmentShader: TRAIL_FS,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  trails.frustumCulled = false;
  trails.renderOrder = 2;
  group.add(trails);

  // Businesses: small gold survey markers above their owners.
  const bizList = M.biz
    .map((bz) => {
      const os = bz.owners.map((o) => A.at.get(o)).filter((v): v is Vector3 => !!v);
      if (!os.length) return null;
      const c = os.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / os.length);
      return { c, year: bz.year };
    })
    .filter((b): b is { c: Vector3; year: number } => !!b);
  const bizUni = { ...U, uGold: { value: lin(LIGHT.gold) }, uFocus: { value: 0 } };
  if (bizList.length) {
    const bg = new OctahedronGeometry(big ? 0.55 : 0.8);
    bg.scale(1, 1.5, 1);
    bg.setAttribute('aYear', new InstancedBufferAttribute(new Float32Array(bizList.map((b) => b.year)), 1));
    const biz = new InstancedMesh(
      bg,
      new ShaderMaterial({ uniforms: bizUni, vertexShader: BIZ_VS, fragmentShader: BIZ_FS }),
      bizList.length,
    );
    const m = new Matrix4();
    bizList.forEach((b, i) => {
      const off = (big ? 1.8 : 2.6) * (i % 2 ? -1 : 1);
      const x = b.c.x + off;
      const z = b.c.z + (big ? 1.4 : 2);
      biz.setMatrixAt(i, m.makeTranslation(x, A.ground(x, z) + stem * 0.55, z));
    });
    biz.frustumCulled = false;
    group.add(biz);
  }

  const sky = skyDome(LIGHT.far, LIGHT.far, LIGHT.desk);
  group.add(sky.mesh);

  const tint = () => {
    const dark = ctx.dark();
    const C = dark ? DARK : LIGHT;
    const q = ctx.pal();
    terrainUni.uRamp.value.forEach((c, i) => {
      c.copy(lin(C.ramp[i] ?? '#000000'));
    });
    terrainUni.uSeaLo.value.copy(lin(C.seaLo));
    terrainUni.uSeaHi.value.copy(lin(C.seaHi));
    terrainUni.uInk.value.copy(lin(C.ink));
    terrainUni.uInkHi.value.copy(lin(C.inkHi));
    terrainUni.uSeaInk.value.copy(lin(C.seaInk));
    terrainUni.uGridC.value.copy(lin(C.grid));
    terrainUni.uShade.value.copy(lin(C.shade));
    terrainUni.uLit.value.copy(lin(C.lit));
    terrainUni.uPaper.value.copy(lin(C.paper));
    terrainUni.uAccent.value.copy(lin(C.accent));
    terrainUni.uDark.value = dark ? 1 : 0;
    paperUni.uPaper.value.copy(lin(C.paper));
    paperUni.uInk.value.copy(lin(C.frame));
    paperUni.uDesk.value.copy(lin(C.desk));
    paperUni.uFar.value.copy(lin(C.far));
    paperUni.uDark.value = dark ? 1 : 0;
    pinUni.uStem.value.copy(lin(C.stem));
    pinUni.uDark.value = dark ? 1 : 0;
    trailUni.uCore.value.copy(lin(C.trail));
    trailUni.uCase.value.copy(lin(C.trailCase));
    trailUni.uHiC.value.copy(lin(C.trailHi));
    trailUni.uDark.value = dark ? 1 : 0;
    bizUni.uGold.value.copy(lin(C.gold));
    sky.set(C.far, C.far, C.desk);
    ctx.look(dark ? 0.55 : 0.08, dark ? q.exposure : 1.02);
  };

  return {
    key: 'terrain',
    group,
    pos,
    size,
    style: 0,
    lift: 4,
    tint,
    labelUp: true,
    labelScale: 0.85,
    update: reweigh,
    dir: rtl ? -1 : 1,
    hiTargets: [{ geo: pinGeo, perPerson: true }, { geo: trGeo }],
    focus: [terrainUni.uFocus, pinUni.uFocus, trailUni.uFocus, bizUni.uFocus],
    view: { target: new Vector3(0, hMax * 0.2, S * 0.06), cam: new Vector3(0, S * 1.35 + hMax, S * 2.05) },
    follow: big ? 40 : 32,
  };
};
