import {
  BackSide,
  BufferGeometry,
  Color,
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
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { spouseYear } from '../model.ts';
import { buildAtlas, kfWeights, SEA0, SLOPE } from './terrain-field.ts';
import {
  BIZ_FS,
  BIZ_VS,
  PIN_FS,
  PIN_VS,
  SHEET_FS,
  SHEET_VS,
  SKY_FS,
  SKY_VS,
  TERRAIN_FS,
  TERRAIN_VS,
  TRAIL_FS,
  TRAIL_VS,
} from './terrain-glsl.ts';
import type { SceneBuilder } from './types.ts';

// Family Atlas: the family as an island relief map printed on a sheet. The founder is the
// summit, each line of descent a ridge as high as the line is big; every generation stands
// on its own ring around the summit (the map's polar graticule); people are map pins and
// descent paths are trails along the ridges, marriages dotted gold. By day a Swiss relief
// map (sage, grey-buff and white rock, black contours, red trails, waterlines on a white sea);
// by night a graphite relief with silver contours on a black sea. Teal marks only the
// selected lineage. All colours are display colours (the shaders undo the tone curve).

interface Look {
  /** Hypsometric tints from the coast to the summit. */
  tint: string[];
  sea: string;
  ink: string;
  coast: string;
  water: string;
  grid: string;
  /** Hillshade multipliers (linear r, g, b): the deepest shade, and lit slopes (above 1 brightens). */
  shadow: [number, number, number];
  lit: [number, number, number];
  coastA: number;
  /** What the map fades towards while a lineage is selected. */
  fade: string;
  paper: string;
  sheetInk: string;
  desk: string;
  deskHi: string;
  sky: string;
  trail: string;
  casing: string;
  gold: string;
  teal: string;
  needle: string;
  foot: string;
  mark: string;
  minor: number;
  major: number;
  waterA: number;
  gridA: number;
  scree: number;
  grain: number;
  relief: number;
  caseA: number;
  shadowA: number;
  /** Lineage trails are pushed past the bloom threshold by this factor (dark only). */
  glow: number;
  bloom: number;
  exposure: number;
}

const LOOK: { light: Look; dark: Look } = {
  // Swiss relief map: sage lowlands, grey-buff slopes, white rock; trail red and waterline blue-grey.
  light: {
    tint: ['#b3be9f', '#c6cdb0', '#d7d6c2', '#e5e1d6', '#f3f2ee'],
    sea: '#ffffff',
    ink: '#1a1a1a',
    coast: '#3d5770',
    water: '#6f8ba6',
    grid: '#8a8a8a',
    shadow: [0.5, 0.54, 0.6],
    lit: [1.15, 1.12, 1.04],
    coastA: 0.85,
    fade: '#f6f6f6',
    paper: '#ffffff',
    sheetInk: '#1a1a1a',
    desk: '#ebebeb',
    deskHi: '#f1f1f1',
    sky: '#ebebeb',
    trail: '#b23a2e',
    casing: '#ffffff',
    gold: '#b7862c',
    teal: '#0f6b63',
    needle: '#3a3a3a',
    foot: '#1a1a1a',
    mark: '#4a4a4a',
    minor: 0.3,
    major: 0.58,
    waterA: 0.75,
    gridA: 0.5,
    scree: 0.32,
    grain: 0.035,
    relief: 1,
    caseA: 0.55,
    shadowA: 0.24,
    glow: 1,
    bloom: 0,
    exposure: 1,
  },
  // Night atlas: graphite relief, silver contours and waterlines, ember trails on a black sea.
  dark: {
    tint: ['#171717', '#1c1c1c', '#232323', '#2c2c2c', '#393939'],
    sea: '#000000',
    ink: '#c4c8ce',
    coast: '#d2d5da',
    water: '#9097a0',
    grid: '#5d6168',
    shadow: [0.42, 0.42, 0.43],
    lit: [1.6, 1.6, 1.6],
    coastA: 0.38,
    fade: '#0b0b0b',
    paper: '#0e0e0e',
    sheetInk: '#767b82',
    desk: '#000000',
    deskHi: '#0b0b0b',
    sky: '#000000',
    trail: '#e0745a',
    casing: '#000000',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    needle: '#8e939a',
    foot: '#c9cdd3',
    mark: '#b5b9bf',
    minor: 0.09,
    major: 0.24,
    waterA: 0.2,
    gridA: 0.5,
    scree: 0.22,
    grain: 0.05,
    relief: 1,
    caseA: 0.55,
    shadowA: 0,
    glow: 1.7,
    bloom: 0.45,
    exposure: 1,
  },
};

export const terrainScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const rtl = ctx.rtl();
  const group = new Group();
  const size = big ? 1.5 : 2.1;
  const A = buildAtlas(M, big, rtl, size);
  const { S, hMax, step, mapR } = A;
  const pos = new Float32Array(M.n * 3);
  const stem = big ? 3.2 : 3.6;
  const expo = { value: 1 };
  const col = () => new Color();

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

  // ---- Terrain: one draped grid, tinted, shaded and inked in the fragment shader ----
  const sgn = rtl ? -1 : 1;
  const terrainUni = {
    ...hU,
    uTime: U.uTime,
    uExpo: expo,
    uTint: { value: [col(), col(), col(), col(), col()] },
    uSea: { value: col() },
    uInk: { value: col() },
    uCoast: { value: col() },
    uWater: { value: col() },
    uGridC: { value: col() },
    uShadow: { value: col() },
    uLit: { value: col() },
    uFade: { value: col() },
    uCoastA: { value: 1 },
    uHMax: { value: hMax },
    uInt: { value: hMax / 14 },
    uTexel: { value: (2 * S) / A.n },
    uFocus: { value: 0 },
    uRtl: { value: sgn },
    uStep: { value: step },
    uRings: { value: Math.max(1, M.maxGen) },
    uSea0: { value: SEA0 },
    uSlope: { value: SLOPE },
    uMinor: { value: 0 },
    uMajor: { value: 0 },
    uWaterA: { value: 0 },
    uGridA: { value: 0 },
    uScree: { value: 0 },
    uGrain: { value: 0 },
    uRelief: { value: 1 },
    uCompass: { value: [S * 0.8 * sgn, S * 0.8] },
    uBar: { value: [-S * 0.88 * sgn, S * 0.9] },
  };
  const segs = big ? 300 : 220;
  const tGeo = new PlaneGeometry(2 * S, 2 * S, segs, segs);
  tGeo.rotateX(-Math.PI / 2);
  const terrain = new Mesh(
    tGeo,
    new ShaderMaterial({ uniforms: terrainUni, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS }),
  );
  terrain.frustumCulled = false;
  group.add(terrain);

  // ---- The printed sheet (margin and neatline) on a desk ----
  const sheetUni = {
    uExpo: expo,
    uPaper: { value: col() },
    uInk: { value: col() },
    uDesk: { value: col() },
    uDeskHi: { value: col() },
    uS: { value: S },
    uB: { value: S * 0.016 },
    uM: { value: S * 0.1 },
    uGrid: { value: step },
    uShadowA: { value: 0 },
    uGrain: { value: 0 },
  };
  const pGeo = new PlaneGeometry(S * 14, S * 14);
  pGeo.rotateX(-Math.PI / 2);
  const sheet = new Mesh(
    pGeo,
    new ShaderMaterial({ uniforms: sheetUni, vertexShader: SHEET_VS, fragmentShader: SHEET_FS }),
  );
  sheet.position.y = -0.05;
  group.add(sheet);

  // ---- Pins: a needle from the ground up to the portrait, and a ring at its foot ----
  const pinGeo = (() => {
    const parts: BufferGeometry[] = [new CylinderGeometry(0.055, 0.09, 1, 6, 1, true).translate(0, 0.5, 0)];
    const ring = new RingGeometry(big ? 0.24 : 0.34, big ? 0.46 : 0.62, 20);
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
  const aRole = new Float32Array(n);
  M.people.forEach((p, i) => {
    const v = A.at.get(p.id) ?? new Vector3();
    aXZ[i * 2] = v.x;
    aXZ[i * 2 + 1] = v.z;
    // A couple's portraits hang level: a spouse's pin reaches up to the partner's height (seen at an
    // angle, a lower portrait on a flank would otherwise slide under the partner's).
    const a = p.mi && p.anchor ? A.at.get(p.anchor) : undefined;
    const top = a ? Math.max(v.y + stem * 0.55, a.y + stem - 0.1) : v.y + stem;
    aTop[i] = top;
    aBirth[i] = p.born;
    aRole[i] = p.mi ? 1 : 0;
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = top + size * 1.05;
    pos[i * 3 + 2] = v.z;
  });
  pinGeo.setAttribute('aXZ', new InstancedBufferAttribute(aXZ, 2));
  pinGeo.setAttribute('aTop', new InstancedBufferAttribute(aTop, 1));
  pinGeo.setAttribute('aBirth', new InstancedBufferAttribute(aBirth, 1));
  pinGeo.setAttribute('aRole', new InstancedBufferAttribute(aRole, 1));
  pinGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  pinGeo.userData.keys = M.people.map((p) => p.id);
  const pinUni = {
    ...hU,
    ...U,
    uExpo: expo,
    uNeedle: { value: col() },
    uFoot: { value: col() },
    uGold: { value: col() },
    uTeal: { value: col() },
    uFade: { value: col() },
    uFocus: { value: 0 },
  };
  const pins = new InstancedMesh(
    pinGeo,
    new ShaderMaterial({ uniforms: pinUni, vertexShader: PIN_VS, fragmentShader: PIN_FS, side: DoubleSide }),
    n,
  );
  pins.frustumCulled = false;
  group.add(pins);

  // ---- Trails: ribbons draped on the ridges, parent to child; dotted links to spouses ----
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
      pts.push(A.path(a, b, t));
    }
    ribbon(pts, p.born, 0, p.id);
  }
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const a = A.at.get(p.anchor);
    const b = A.at.get(p.id);
    if (!a || !b) continue;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 8; i++) pts.push([a.x + (b.x - a.x) * (i / 8), a.z + (b.z - a.z) * (i / 8)]);
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
    uExpo: expo,
    uW: { value: big ? 0.22 : 0.3 },
    uPx: { value: 800 },
    uDash: { value: big ? 1.5 : 2.1 },
    uA: { value: big ? 0.6 : 1 },
    uCaseA: { value: 0.9 },
    uGlow: { value: 1 },
    uCore: { value: col() },
    uCase: { value: col() },
    uTeal: { value: col() },
    uGold: { value: col() },
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
  // Pixel scale for the screen-space line weight (drawing buffer height times the projection's y scale).
  const buf = new Vector2();
  trails.onBeforeRender = (r, _s, cam) => {
    r.getDrawingBufferSize(buf);
    trailUni.uPx.value = (buf.y * cam.projectionMatrix.elements[5]) / 2;
  };
  group.add(trails);

  // ---- Businesses: small survey markers above their owners ----
  const bizList = M.biz
    .map((bz) => {
      const os = bz.owners.map((o) => A.at.get(o)).filter((v): v is Vector3 => !!v);
      if (!os.length) return null;
      const c = os.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / os.length);
      return { c, year: bz.year };
    })
    .filter((b): b is { c: Vector3; year: number } => !!b);
  const bizUni = { ...U, uExpo: expo, uMark: { value: col() }, uFade: { value: col() }, uFocus: { value: 0 } };
  if (bizList.length) {
    const bg = new OctahedronGeometry(big ? 0.5 : 0.7);
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

  // ---- Stage backdrop beyond the desk ----
  const skyUni = { uExpo: expo, uTop: { value: col() }, uLow: { value: col() } };
  const sky = new Mesh(
    new SphereGeometry(1400, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: skyUni,
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
    }),
  );
  group.add(sky);

  const tint = () => {
    const C = ctx.dark() ? LOOK.dark : LOOK.light;
    terrainUni.uTint.value.forEach((c, i) => {
      c.set(C.tint[i] ?? '#000000');
    });
    terrainUni.uSea.value.set(C.sea);
    terrainUni.uInk.value.set(C.ink);
    terrainUni.uCoast.value.set(C.coast);
    terrainUni.uWater.value.set(C.water);
    terrainUni.uGridC.value.set(C.grid);
    terrainUni.uShadow.value.setRGB(...C.shadow);
    terrainUni.uCoastA.value = C.coastA;
    terrainUni.uLit.value.setRGB(...C.lit);
    terrainUni.uFade.value.set(C.fade);
    terrainUni.uMinor.value = C.minor;
    terrainUni.uMajor.value = C.major;
    terrainUni.uWaterA.value = C.waterA;
    terrainUni.uGridA.value = C.gridA;
    terrainUni.uScree.value = C.scree;
    terrainUni.uGrain.value = C.grain;
    terrainUni.uRelief.value = C.relief;
    sheetUni.uPaper.value.set(C.paper);
    sheetUni.uInk.value.set(C.sheetInk);
    sheetUni.uDesk.value.set(C.desk);
    sheetUni.uDeskHi.value.set(C.deskHi);
    sheetUni.uShadowA.value = C.shadowA;
    sheetUni.uGrain.value = C.grain;
    pinUni.uNeedle.value.set(C.needle);
    pinUni.uFoot.value.set(C.foot);
    pinUni.uGold.value.set(C.gold);
    pinUni.uTeal.value.set(C.teal);
    pinUni.uFade.value.set(C.fade);
    trailUni.uCore.value.set(C.trail);
    trailUni.uCase.value.set(C.casing);
    trailUni.uTeal.value.set(C.teal);
    trailUni.uGold.value.set(C.gold);
    trailUni.uCaseA.value = C.caseA;
    trailUni.uGlow.value = C.glow;
    bizUni.uMark.value.set(C.mark);
    bizUni.uFade.value.set(C.fade);
    skyUni.uTop.value.set(C.sky);
    skyUni.uLow.value.set(C.desk);
    expo.value = C.exposure;
    ctx.look(C.bloom, C.exposure);
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
    // Fit-all: the whole island from the south, steep enough to read the map like a page.
    view: {
      target: new Vector3(0, hMax * 0.25, mapR * 0.04),
      cam: new Vector3(0, hMax * 0.25 + mapR * 2.5 * 0.77, mapR * 0.04 + mapR * 2.5 * 0.64),
    },
    follow: big ? 40 : 32,
  };
};
