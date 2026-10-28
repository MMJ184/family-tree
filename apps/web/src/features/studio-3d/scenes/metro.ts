import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  type Color,
  CustomBlending,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  MinEquation,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { spouseYear } from '../model.ts';
import { lin, NOW } from '../palette.ts';
import { metroLayout, roundCorners } from './metro-layout.ts';
import type { SceneBuilder } from './types.ts';

// Family Metro: the family as a transit diagram. Time runs along x (birth year); each couple's
// children ride one line as stations in birth order, a child's own family branches off with 45°
// bends onto a parallel track, and spouses are interchanges (white capsule, gold rim) beside their
// partner. The founder's children's and grandchildren's families each get a line colour and a
// numbered line bullet at every terminus; deeper families are branches of their parents' line.
//
// Dark: a black lacquered map board with enamel lines. Light: the classic printed diagram, white
// paper and black ink, with the same line colours. Close up: enamel gloss, casing gaps where
// lines pass, the year ruler's ticks, and small trains running the lines (the ambient motion).
// The selected lineage gets a teal casing and teal station rings while the rest of the map greys.
// In Arabic the map is mirrored so the founder sits on the right (spec decision #10).

type P2 = [number, number];

/** Line colours: saturated transit enamel, no teal or cyan-green (reserved for the selection), no gold (marriages). */
const LINES = {
  dark: [
    '#ec3b3f',
    '#3f7fe6',
    '#f38a26',
    '#9a6ae0',
    '#4fb04f',
    '#e4499a',
    '#c08452',
    '#6176ea',
    '#f293bd',
    '#a9b83a',
    '#62a8ec',
    '#a3abb5',
  ],
  light: [
    '#d42a30',
    '#1f5fbf',
    '#e8761a',
    '#7448ad',
    '#36913a',
    '#c3256f',
    '#8c5a2e',
    '#2f40a0',
    '#df6c9d',
    '#78881c',
    '#3a80cc',
    '#6f7782',
  ],
};

const LOOK = {
  dark: {
    stage: '#000000',
    board: '#090909',
    lift: '#121212',
    side: '#161616',
    edge: '#3a3a3a',
    grid: '#121212',
    major: '#1d1d1d',
    zone: '#0d0d0d',
    ink: '#8e8e8e',
    cursor: '#d6d6d6',
    station: '#f7f7f7',
    gap: '#000000',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    shade: '#000000',
    shadow: 0.75,
    train: '#f4f4f4',
  },
  light: {
    stage: '#e9e9e9',
    board: '#ffffff',
    lift: '#ffffff',
    side: '#d6d6d6',
    edge: '#bdbdbd',
    grid: '#f4f4f4',
    major: '#ebebeb',
    zone: '#fafafa',
    ink: '#3c3c3c',
    cursor: '#1a1a1a',
    station: '#ffffff',
    gap: '#ffffff',
    gold: '#b7862c',
    teal: '#0f6b63',
    shade: '#7a7a7a',
    shadow: 0.34,
    train: '#ffffff',
  },
};
type Look = typeof LOOK.dark;

// The renderer tone-maps everything with three's ACES fit (exposure / 0.6). A printed map wants
// exact flat colours, so every surface here passes its target colour through the inverse of that
// curve; the tone mapper then lands on the colour that was asked for. Bloom stays off.
const EXPO = 1;
const ACES_IN_INV = new Matrix3()
  .fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777])
  .invert();
const ACES_OUT_INV = new Matrix3()
  .fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602])
  .invert();
const UNTONE = /* glsl */ `uniform float uExpo; uniform mat3 uInInv, uOutInv;
  vec3 untone(vec3 c) { vec3 y = max(uOutInv * clamp(c, 0., .985), 0.);
    vec3 A = y * .983729 - 1., B = y * .432951 - .0245786, C = y * .238081 + .000090537;
    vec3 v = (-B - sqrt(max(B * B - 4. * A * C, 0.))) / (2. * A);
    return max(uInInv * v, 0.) / (uExpo / .6); }`;
const YEAR = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;
const NLINES = 12;
const LINE_UNI = /* glsl */ `uniform vec3 uLines[${NLINES}];
  vec3 lineCol(float k) { return uLines[int(mod(k + .5, ${NLINES}.))]; }`;
/** Greys a colour towards the board for people outside the selected lineage. */
const DIM = /* glsl */ `vec3 dimmed(vec3 c, float d) { float l = dot(c, vec3(.3, .59, .11));
    return mix(c, mix(vec3(l), uBoard, .72), d * .88); }`;
const SAMPLES = 128; // train path samples per line

const setColors = (arr: Color[], hex: string[]) => {
  hex.forEach((h, i) => {
    arr[i]?.copy(lin(h));
  });
};

export const metroScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const look = (): Look => (ctx.dark() ? LOOK.dark : LOOK.light);
  const lines = () => (ctx.dark() ? LINES.dark : LINES.light);
  const W = big ? 0.66 : 1.32; // route width
  const H = W * 0.42; // route height
  const SR = big ? 0.52 : 1.06; // station radius
  const SH = H + (big ? 0.07 : 0.12);
  const K = big ? 1.25 : 1.15; // x units per year (on average: the axis is warped, see X)
  const mid = (M.minYear + NOW) / 2;
  const gap = big ? 1.8 : 4.4;
  const wedGap = big ? 1.4 : 3.4;
  const tail = big ? 1.9 : 3.4;
  // Time axis, warped like Beck's map: busy decades get more room. x blends a linear axis with the
  // share of stations opened by then (softened over a few years), at the linear axis' length.
  const opened = M.people.map((p) => (p.mi ? spouseYear(M, p) : p.born));
  // Guarded so a mistyped future birth year can neither collapse nor reverse the axis.
  const y0 = Math.min(M.minYear, NOW) - 2;
  const y1 = Math.max(NOW, ...opened) + 1;
  const span = (y1 - y0) * K;
  const share: number[] = [];
  for (let y = Math.floor(y0); y <= Math.ceil(y1) + 1; y++) {
    let acc = 0;
    for (const b of opened) acc += Math.min(1, Math.max(0, (y - b) / 6 + 0.5));
    share.push(acc / Math.max(1, opened.length));
  }
  const LIN = big ? 0.5 : 0.42;
  const X = (y: number) => {
    const f = Math.min(Math.max(y, y0), y1) - Math.floor(y0);
    const i = Math.floor(f);
    const s0 = share[i] ?? 0;
    const sh = s0 + ((share[i + 1] ?? s0) - s0) * (f - i);
    return span * (LIN * ((y - y0) / (y1 - y0)) + (1 - LIN) * sh) - span / 2;
  };
  const lay = (lz: number) => metroLayout(M, { k: K, gap, wedGap, C: lz * 0.5, bin: gap, mid, tail, year: X });
  // Lane spacing: the map's proportions follow the stage (about 1.3 : 1 once tilted), within limits.
  const LZ0 = big ? 1.7 : 3.6;
  const L0 = lay(LZ0);
  const lanes0 = Math.max(1, L0.laneMax - L0.laneMin);
  const LZ = Math.min(big ? 2.6 : 15, Math.max(LZ0, (L0.xMax - L0.xMin) / (1.3 * lanes0)));
  const L = LZ === LZ0 ? L0 : lay(LZ);
  const C = LZ * 0.5; // 45° chamfer
  const laneMid = (L.laneMin + L.laneMax) / 2;
  const xMid = (L.xMin + L.xMax) / 2;
  const Z = (lane: number) => (lane - laneMid) * LZ;
  const laneOf = (id: string) => L.lane.get(id) ?? 0;
  const xOf = (id: string) => dir * ((L.x.get(id) ?? 0) - xMid);
  const endOf = (id: string) => (L.x.get(id) ?? 0) + (L.wed.get(id)?.length ?? 0) * wedGap;

  // Colour slot per person: the line they ride (the founder rides line 0).
  const famCol = new Map<string, number>([[M.root.id, 0]]);
  for (const f of L.fams) {
    if (f.root) famCol.set(f.head.id, f.col);
    for (const k of f.kids) famCol.set(k.id, f.col);
  }
  const slotOf = (id: string) => famCol.get(id) ?? 0;

  const t0 = look();
  const lineCols = LINES.dark.map((h) => lin(h));
  setColors(lineCols, lines());
  const common = {
    uStage: { value: lin(t0.stage) },
    uBoard: { value: lin(t0.board) },
    uGap: { value: lin(t0.gap) },
    uGold: { value: lin(t0.gold) },
    uTeal: { value: lin(t0.teal) },
    uStation: { value: lin(t0.station) },
    uLines: { value: lineCols },
    uFocus: { value: 0 },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uExpo: { value: EXPO },
    uInInv: { value: ACES_IN_INV },
    uOutInv: { value: ACES_OUT_INV },
  };
  const FOG = /* glsl */ `uniform vec3 uStage; uniform float uFogNear, uFogFar;
    vec3 fogged(vec3 c, float d) { return mix(c, uStage, smoothstep(uFogNear, uFogFar, d)); }`;

  // ---- Routes: flat rounded enamel bars swept along octilinear polylines, each over a casing ----
  const R = {
    pos: [] as number[],
    nor: [] as number[],
    line: [] as number[],
    t: [] as number[],
    end: [] as number[],
    grow: [] as number[],
    kase: [] as number[],
    side: [] as number[],
  };
  const S = { pos: [] as number[], sh: [] as number[], t: [] as number[], end: [] as number[], grow: [] as number[] };
  const idx: number[] = [];
  const sIdx: number[] = [];
  // Rounded-rectangle cross-section (superellipse), shared by every route.
  const RAD = big ? 8 : 14;
  const prof: Array<[number, number, number, number]> = [];
  for (let j = 0; j <= RAD; j++) {
    const a = (j / RAD) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const e = 0.5;
    const px = Math.sign(ca) * Math.abs(ca) ** e * (W / 2);
    const py = Math.sign(sa) * Math.abs(sa) ** e * (H / 2);
    const nx = Math.sign(ca) * Math.abs(ca) ** (2 - e);
    const ny = Math.sign(sa) * Math.abs(sa) ** (2 - e);
    const nl = Math.hypot(nx, ny) || 1;
    prof.push([px, py, nx / nl, ny / nl]);
  }
  interface Piece {
    v0: number;
    v1: number;
    owners: number[];
  }
  const pieces: Piece[] = [];
  // Shadows fall away from the fixed light (Ld in the route shader), in both reading directions.
  const SHX = 0.2 * W;
  const SHZ = 0.6 * W;
  /** Sweeps one piece of route; returns its rounded centre line (world x, z) for the trains. */
  const addRoute = (path: P2[], slot: number, end: number, g: number, owners: number[]): P2[] => {
    const pts = roundCorners(
      path.map(([u, z]) => [dir * (u - xMid), z] as P2),
      big ? LZ * 0.7 : LZ * 0.42,
      big ? 5 : 8,
    );
    if (pts.length < 2) return pts;
    const len: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as P2;
      const b = pts[i] as P2;
      len.push((len[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = len[len.length - 1] || 1;
    const v0 = R.pos.length / 3;
    const s0 = S.pos.length / 3;
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, t: number, k: number) => {
      R.pos.push(x, y, z);
      R.nor.push(nx, ny, nz);
      R.line.push(slot);
      R.t.push(t);
      R.end.push(end);
      R.grow.push(g);
      R.kase.push(k);
    };
    const sides: P2[] = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)] as P2;
      const b = pts[Math.min(pts.length - 1, i + 1)] as P2;
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const sx = tz; // side = up × tangent
      const sz = -tx;
      sides.push([sx, sz]);
      const t = (len[i] ?? 0) / total;
      for (const [px, py, nx, ny] of prof) {
        push(p[0] + sx * px, H / 2 + py, p[1] + sz * px, sx * nx, ny, sz * nx, t, 0);
        R.side.push(0, 0);
      }
      // Soft shadow strip on the ground, nudged away from the light.
      for (const k of [-1, 1]) {
        S.pos.push(p[0] + sx * W * 1.3 * k + SHX, 0.06, p[1] + sz * W * 1.3 * k + SHZ);
        S.sh.push(k, 0);
        S.t.push(t);
        S.end.push(end);
        S.grow.push(g);
      }
    });
    const ring = prof.length;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < ring - 1; j++) {
        const a = v0 + i * ring + j;
        const b = a + ring;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const a = s0 + i * 2;
      sIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    // Casing: a flat ribbon under the bar, pushed out sideways in the shader (a gap in the board's
    // colour where lines meet; teal and wider along the selected lineage).
    const c0 = R.pos.length / 3;
    pts.forEach((p, i) => {
      const [sx, sz] = sides[i] as P2;
      const t = (len[i] ?? 0) / total;
      for (const k of [-1, 1]) {
        push(p[0] + sx * (W / 2) * k, H * 0.32, p[1] + sz * (W / 2) * k, 0, 1, 0, t, 1);
        R.side.push(sx * k, sz * k);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = c0 + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // facing up
    }
    pieces.push({ v0, v1: R.pos.length / 3, owners });
    return pts;
  };

  // Each family line: a branch from the parents' station (two 45° bends) then one piece per child,
  // growing from one birth to the next. A piece lights up when any child it leads to is lit.
  const trainPaths: Array<{ pts: P2[]; yrs: number[]; slot: number }> = [];
  for (const f of L.fams) {
    const zF = Z(f.lane);
    const zH = Z(f.headLane);
    const wed = L.wed.get(f.head.id) ?? [];
    const lastWed = wed[wed.length - 1];
    let prev: P2[];
    let prevYear: number;
    if (f.root) {
      prev = [[L.x.get(f.head.id) ?? 0, zF]];
      prevYear = f.head.born;
    } else {
      const s = Math.sign(zF - zH) || 1;
      prev = [
        [f.from, zH],
        [f.from + C, zH + s * C],
        [f.from + C, zF - s * C],
        [f.from + 2 * C, zF],
      ];
      prevYear = lastWed ? spouseYear(M, lastWed) : (f.kids[0]?.born ?? f.head.born) - 3;
    }
    const tp: { pts: P2[]; yrs: number[]; slot: number } = { pts: [], yrs: [], slot: f.col };
    f.kids.forEach((k, i) => {
      const to: P2 = [L.x.get(k.id) ?? 0, zF];
      const g = Math.min(i ? 12 : 6, Math.max(0.8, k.born - prevYear));
      const pts = addRoute(
        [...prev, to],
        f.col,
        k.born,
        g,
        f.kids.slice(i).map((q) => q.idx),
      );
      // Year the line reaches each point (for the trains).
      let acc = 0;
      const seg: number[] = [0];
      for (let j = 1; j < pts.length; j++) {
        const a = pts[j - 1] as P2;
        const b = pts[j] as P2;
        acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        seg.push(acc);
      }
      pts.forEach((p, j) => {
        if (tp.pts.length && j === 0) return;
        tp.pts.push(p);
        tp.yrs.push(k.born - g + (g * (seg[j] ?? 0)) / (acc || 1));
      });
      prev = [to];
      prevYear = k.born;
    });
    trainPaths.push(tp);
  }
  const routeGeo = new BufferGeometry();
  routeGeo.setAttribute('position', new Float32BufferAttribute(R.pos, 3));
  routeGeo.setAttribute('normal', new Float32BufferAttribute(R.nor, 3));
  routeGeo.setAttribute('aLine', new Float32BufferAttribute(R.line, 1));
  routeGeo.setAttribute('aT', new Float32BufferAttribute(R.t, 1));
  routeGeo.setAttribute('aEnd', new Float32BufferAttribute(R.end, 1));
  routeGeo.setAttribute('aGrow', new Float32BufferAttribute(R.grow, 1));
  routeGeo.setAttribute('aCase', new Float32BufferAttribute(R.kase, 1));
  routeGeo.setAttribute('aSide', new Float32BufferAttribute(R.side, 2));
  const routeHi = new Float32BufferAttribute(new Float32Array(R.t.length), 1);
  routeGeo.setAttribute('aHi', routeHi);
  routeGeo.setIndex(idx);

  const routeUni = { ...U, ...common, uCase: { value: new Vector3(W * 0.17, W * 0.68, 0) } };
  const routeMat = new ShaderMaterial({
    uniforms: routeUni,
    vertexShader: /* glsl */ `${LINE_UNI} attribute float aLine, aT, aEnd, aGrow, aHi, aCase; attribute vec2 aSide;
      uniform float uFocus; uniform vec3 uCase;
      varying vec3 vCol, vN, vW; varying float vT, vEnd, vGrow, vHi, vCase, vDepth;
      void main() { vCol = lineCol(aLine); vT = aT; vEnd = aEnd; vGrow = aGrow; vHi = aHi; vCase = aCase; vN = normal;
        vec3 p = position; float lit = step(.5, aHi) * uFocus;
        p.xz += aSide * mix(uCase.x, uCase.y, lit);
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform float uYear, uEnter, uMinYear, uTime, uFocus;
      uniform vec3 uBoard, uGap, uTeal;
      ${DIM}
      varying vec3 vCol, vN, vW; varying float vT, vEnd, vGrow, vHi, vCase, vDepth;
      void main() { ${YEAR} float prog = (yr - (vEnd - vGrow)) / vGrow; if (vT > prog) discard;
        float lit = step(.5, vHi) * uFocus; float dim = uFocus * (1. - step(.5, vHi));
        vec3 col;
        if (vCase > .5) col = mix(uGap, uTeal, lit);
        else {
          vec3 n = vN / max(length(vN), 1e-6); vec3 Ld = normalize(vec3(-.3, .9, -.35));
          float dif = max(dot(n, Ld), 0.); col = vCol * (.8 + .24 * dif);
          vec3 V = normalize(cameraPosition - vW); vec3 Hv = Ld + V; float spec = pow(max(dot(n, Hv / max(length(Hv), 1e-6)), 0.), 70.);
          col += spec * .16;
          float pulse = smoothstep(.9, 1., fract(vT * 2. - uTime * .4)) * lit * step(.4, n.y);
          col = mix(col, vec3(1.), pulse * .45);
          col = dimmed(col, dim);
        }
        gl_FragColor = vec4(untone(fogged(col, vDepth)), 1.); }`,
  });
  group.add(new Mesh(routeGeo, routeMat));

  // ---- Stations (one instanced cylinder) and interchange capsules ----
  const n = M.n;
  const pos = new Float32Array(n * 3);
  const appear = new Float32Array(n);
  const stGeo = new CylinderGeometry(1, 1, 1, big ? 20 : 40, 1);
  stGeo.translate(0, 0.5, 0);
  const aLine = new Float32Array(n);
  const aBorn = new Float32Array(n);
  const aKind = new Float32Array(n);
  stGeo.setAttribute('aLine', new InstancedBufferAttribute(aLine, 1));
  stGeo.setAttribute('aBorn', new InstancedBufferAttribute(aBorn, 1));
  stGeo.setAttribute('aKind', new InstancedBufferAttribute(aKind, 1));
  stGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  stGeo.userData.keys = M.people.map((p) => p.id);
  const stUni = { ...U, ...common };
  const stMat = new ShaderMaterial({
    uniforms: stUni,
    vertexShader: /* glsl */ `${LINE_UNI} attribute float aLine, aBorn, aKind, aHi; uniform float uYear, uEnter, uMinYear;
      varying vec3 vCol, vP, vN; varying float vKind, vHi, vDepth;
      void main() { ${YEAR} float app = smoothstep(aBorn - .3, aBorn + .7, yr);
        float s = app * (1. + .12 * aHi);
        vec3 p = position * vec3(s, max(app, .001), s); vP = position; vN = normal; vCol = lineCol(aLine); vKind = aKind; vHi = aHi;
        vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform vec3 uStation, uGold, uTeal, uBoard; uniform float uFocus;
      ${DIM}
      varying vec3 vCol, vP, vN; varying float vKind, vHi, vDepth;
      void main() { float lit = step(.5, vHi) * uFocus; float dim = uFocus * (1. - step(.5, vHi));
        vec3 ring = vKind > 1.5 ? uGold : vCol;
        ring = mix(ring, uTeal, lit);
        vec3 col;
        if (vN.y > .5) { float r = length(vP.xz); float e = max(fwidth(r) * 1.2, 1e-4);
          if (vKind > .5 && vKind < 1.5) {
            // The founder: a terminus roundel, thick ring with a line-coloured core.
            col = mix(uStation, ring, smoothstep(.66 - e, .66 + e, r));
            col = mix(col, ring, 1. - smoothstep(.27 - e, .27 + e, r));
          } else col = mix(uStation, ring, smoothstep(.6 - e, .6 + e, r));
        } else col = ring * .74;
        col = dimmed(col, dim);
        gl_FragColor = vec4(untone(fogged(col, vDepth)), 1.); }`,
  });
  const stations = new InstancedMesh(stGeo, stMat, n);
  const mtx = new Matrix4();
  const rot = new Matrix4();
  const lift = SH + (big ? 1.25 : 2.6);
  M.people.forEach((p, i) => {
    const x = xOf(p.id);
    const z = Z(laneOf(p.id));
    const root = p === M.root;
    const r = root ? SR * 1.45 : p.mi ? SR * 0.88 : SR;
    mtx.makeScale(r, SH, r).setPosition(x, 0, z);
    stations.setMatrixAt(i, mtx);
    aLine[i] = slotOf(p.mi && p.anchor ? p.anchor : p.id);
    const yr = p.mi ? spouseYear(M, p) : p.born;
    aBorn[i] = yr;
    aKind[i] = root ? 1 : p.mi ? 2 : 0;
    appear[i] = yr;
    pos[i * 3] = x;
    pos[i * 3 + 1] = lift + (root ? 0.5 : 0);
    pos[i * 3 + 2] = z;
  });
  stations.frustumCulled = false;
  group.add(stations);

  const spouses = M.people.filter((p) => p.mi && p.anchor);
  const barGeo = new BoxGeometry(1, 1, 1);
  barGeo.translate(0, 0.5, 0);
  const nb = Math.max(1, spouses.length);
  const bBorn = new Float32Array(nb);
  barGeo.setAttribute('aBorn', new InstancedBufferAttribute(bBorn, 1));
  barGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(nb), 1));
  barGeo.userData.keys = spouses.map((p) => p.id);
  const barMat = new ShaderMaterial({
    uniforms: stUni,
    vertexShader: /* glsl */ `attribute float aBorn, aHi; uniform float uYear, uEnter, uMinYear;
      varying vec3 vP, vN; varying float vHi, vDepth;
      void main() { ${YEAR} float app = smoothstep(aBorn - .3, aBorn + .7, yr);
        vec3 p = position * vec3(1., max(app, .001), app); p.x = mix(-.5, p.x, app); vP = position; vN = normal; vHi = aHi;
        vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform vec3 uStation, uGold, uTeal, uBoard; uniform float uFocus;
      ${DIM}
      varying vec3 vP, vN; varying float vHi, vDepth;
      void main() { float e = max(fwidth(vP.z) * 1.2, 1e-4); float lit = step(.5, vHi) * uFocus; float dim = uFocus * (1. - step(.5, vHi));
        vec3 rim = mix(uGold, uTeal, lit);
        vec3 col = vN.y > .5 ? mix(uStation, rim, smoothstep(.27 - e, .27 + e, abs(vP.z))) : rim * .78;
        col = dimmed(col, dim);
        gl_FragColor = vec4(untone(fogged(col, vDepth)), 1.); }`,
  });
  const bars = new InstancedMesh(barGeo, barMat, nb);
  bars.count = spouses.length;
  spouses.forEach((p, i) => {
    const list = L.wed.get(p.anchor as string) ?? [];
    const j = list.indexOf(p);
    const prevId = j > 0 ? (list[j - 1] as (typeof list)[number]).id : (p.anchor as string);
    const xa = xOf(prevId);
    const xs = xOf(p.id);
    // The capsule grows from the partner's side towards the spouse.
    mtx.makeScale(Math.abs(xs - xa), SH * 0.9, SR * 1.05);
    mtx.setPosition((xa + xs) / 2, 0, Z(laneOf(p.id)));
    if (xs < xa) mtx.multiply(rot.makeRotationY(Math.PI));
    bars.setMatrixAt(i, mtx);
    bBorn[i] = spouseYear(M, p);
  });
  bars.frustumCulled = false;
  group.add(bars);

  // Station shadows join the route shadow strips in one mesh.
  for (let i = 0; i < n; i++) {
    const p = M.people[i];
    if (!p) continue;
    const x = (pos[i * 3] ?? 0) + SHX;
    const z = (pos[i * 3 + 2] ?? 0) + SHZ;
    const r = SR * (p === M.root ? 1.45 : 1) * 1.9;
    const s0 = S.pos.length / 3;
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      S.pos.push(x + a * r, 0.065, z + b * r);
      S.sh.push(a, b);
      S.t.push(0);
      S.end.push(appear[i] ?? 0);
      S.grow.push(0.6);
    }
    sIdx.push(s0, s0 + 2, s0 + 1, s0 + 1, s0 + 2, s0 + 3);
  }
  const shGeo = new BufferGeometry();
  shGeo.setAttribute('position', new Float32BufferAttribute(S.pos, 3));
  shGeo.setAttribute('aSh', new Float32BufferAttribute(S.sh, 2));
  shGeo.setAttribute('aT', new Float32BufferAttribute(S.t, 1));
  shGeo.setAttribute('aEnd', new Float32BufferAttribute(S.end, 1));
  shGeo.setAttribute('aGrow', new Float32BufferAttribute(S.grow, 1));
  shGeo.setIndex(sIdx);
  const shUni = { ...U, ...common, uShade: { value: lin(t0.shade) }, uAlpha: { value: t0.shadow } };
  // Shadows are composited in display space against the board's colour and min-blended: alpha
  // blending over the untoned (very bright) paper would wash them out in the light theme.
  const shadows = new Mesh(
    shGeo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MinEquation,
      uniforms: shUni,
      vertexShader: /* glsl */ `attribute vec2 aSh; attribute float aT, aEnd, aGrow; varying vec2 vSh; varying float vT, vEnd, vGrow;
        void main() { vSh = aSh; vT = aT; vEnd = aEnd; vGrow = aGrow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uShade, uBoard; uniform float uYear, uEnter, uMinYear, uAlpha, uFocus; varying vec2 vSh; varying float vT, vEnd, vGrow;
        void main() { ${YEAR} float prog = (yr - (vEnd - vGrow)) / vGrow; if (vT > prog) discard;
          float a = 1. - smoothstep(0., 1., length(vSh)); a = a * a * uAlpha * (1. - .5 * uFocus);
          if (a < .003) discard;
          gl_FragColor = vec4(untone(mix(uBoard, uShade, a)), 1.); }`,
    }),
  );
  shadows.renderOrder = 1;
  group.add(shadows);

  // ---- Line bullets: a numbered roundel at every terminus (the founder's line also at its start) ----
  const bulletAt: Array<{ x: number; z: number; slot: number; yr: number }> = [];
  for (const f of L.fams) {
    const last = f.kids[f.kids.length - 1];
    if (!last) continue;
    // Big families: only the coloured lines' own termini, not every branch.
    const parentSlot = f.root ? -1 : slotOf(f.head.id);
    if (big && parentSlot === f.col) continue;
    bulletAt.push({ x: dir * (endOf(last.id) + tail * 0.62 - xMid), z: Z(f.lane), slot: f.col, yr: last.born });
    if (f.root) {
      bulletAt.push({
        x: dir * ((L.x.get(f.head.id) ?? 0) - tail * 0.62 - xMid),
        z: Z(f.lane),
        slot: f.col,
        yr: f.head.born,
      });
    }
  }
  const maxSlot = Math.max(1, ...bulletAt.map((b) => b.slot + 1));
  const CELLS = Math.min(64, maxSlot);
  const bulletTex = () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let k = 0; k < CELLS; k++) {
        const label = String(k + 1);
        g.font = `800 ${label.length > 1 ? 34 : 40}px Manrope, "IBM Plex Sans Arabic", sans-serif`;
        g.fillText(label, (k % 8) * 64 + 32, Math.floor(k / 8) * 64 + 34);
      }
    }
    const tx = new CanvasTexture(c);
    tx.flipY = false;
    tx.anisotropy = 8;
    return tx;
  };
  const nBul = Math.max(1, bulletAt.length);
  const bulGeo = new PlaneGeometry(1, 1);
  bulGeo.rotateX(-Math.PI / 2);
  const buSlot = new Float32Array(nBul);
  const buBorn = new Float32Array(nBul);
  bulGeo.setAttribute('aLine', new InstancedBufferAttribute(buSlot, 1));
  bulGeo.setAttribute('aBorn', new InstancedBufferAttribute(buBorn, 1));
  const bulUni = { ...U, ...common, uMap: { value: bulletTex() } };
  const bullets = new InstancedMesh(
    bulGeo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: bulUni,
      vertexShader: /* glsl */ `${LINE_UNI} attribute float aLine, aBorn; uniform float uYear, uEnter, uMinYear;
        varying vec2 vUv; varying vec3 vCol; varying float vCell, vApp, vDepth;
        void main() { ${YEAR} vApp = smoothstep(aBorn, aBorn + 1., yr); vUv = uv; vCol = lineCol(aLine); vCell = mod(aLine, 64.);
          vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position * max(vApp, .001), 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform sampler2D uMap; uniform vec3 uStation, uBoard; uniform float uFocus;
        ${DIM}
        varying vec2 vUv; varying vec3 vCol; varying float vCell, vApp, vDepth;
        void main() { vec2 q = vUv * 2. - 1.; float r = length(q); float e = max(fwidth(r) * 1.3, 1e-4); if (r > 1.) discard;
          vec2 cell = vec2(mod(vCell, 8.), floor(vCell / 8.));
          float glyph = texture2D(uMap, (cell + vec2(vUv.x, 1. - vUv.y)) / vec2(8., 8.)).a;
          vec3 col = mix(vCol, uStation, smoothstep(.84 - e, .84 + e, r));
          col = mix(col, uStation, glyph * (1. - smoothstep(.8, .84, r)));
          col = dimmed(col, uFocus);
          gl_FragColor = vec4(untone(fogged(col, vDepth)), (1. - smoothstep(1. - e, 1., r)) * step(.01, vApp)); }`,
    }),
    nBul,
  );
  bullets.count = bulletAt.length;
  const BR = big ? 1.5 : 3.1; // bullet diameter
  bulletAt.forEach((b, i) => {
    mtx.makeScale(BR, 1, BR).setPosition(b.x, H + 0.02, b.z);
    bullets.setMatrixAt(i, mtx);
    buSlot[i] = b.slot;
    buBorn[i] = b.yr;
  });
  bullets.frustumCulled = false;
  bullets.renderOrder = 2;
  group.add(bullets);

  // ---- Trains: one per line, shuttling between its ends along a path stored in a float texture ----
  const runs = trainPaths
    .map((tp) => {
      let len = 0;
      for (let i = 1; i < tp.pts.length; i++) {
        const a = tp.pts[i - 1] as P2;
        const b = tp.pts[i] as P2;
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return { ...tp, len };
    })
    .filter((tp) => tp.pts.length > 1 && tp.len > (big ? 6 : 10))
    .sort((a, b) => b.len - a.len)
    .slice(0, big ? 64 : 40);
  const nRun = Math.max(1, runs.length);
  const pathData = new Float32Array(SAMPLES * nRun * 4);
  runs.forEach((tp, row) => {
    const cum: number[] = [0];
    for (let i = 1; i < tp.pts.length; i++) {
      const a = tp.pts[i - 1] as P2;
      const b = tp.pts[i] as P2;
      cum.push((cum[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    let j = 1;
    for (let s = 0; s < SAMPLES; s++) {
      const d = (tp.len * s) / (SAMPLES - 1);
      while (j < cum.length - 1 && (cum[j] ?? 0) < d) j++;
      const d0 = cum[j - 1] ?? 0;
      const d1 = cum[j] ?? d0;
      const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      const a = tp.pts[j - 1] as P2;
      const b = tp.pts[j] as P2;
      const o = (row * SAMPLES + s) * 4;
      pathData[o] = a[0] + (b[0] - a[0]) * f;
      pathData[o + 1] = a[1] + (b[1] - a[1]) * f;
      pathData[o + 2] = (tp.yrs[j - 1] ?? 0) + ((tp.yrs[j] ?? 0) - (tp.yrs[j - 1] ?? 0)) * f;
    }
  });
  const pathTex = new DataTexture(pathData, SAMPLES, nRun, RGBAFormat, FloatType);
  pathTex.minFilter = NearestFilter;
  pathTex.magFilter = NearestFilter;
  pathTex.needsUpdate = true;
  const trGeo = new BoxGeometry(1, 1, 1, 1, 1, 1);
  trGeo.translate(0, 0.5, 0);
  const trRow = new Float32Array(nRun);
  const trLen = new Float32Array(nRun);
  const trPhase = new Float32Array(nRun);
  const trSlot = new Float32Array(nRun);
  trGeo.setAttribute('aRow', new InstancedBufferAttribute(trRow, 1));
  trGeo.setAttribute('aLen', new InstancedBufferAttribute(trLen, 1));
  trGeo.setAttribute('aPhase', new InstancedBufferAttribute(trPhase, 1));
  trGeo.setAttribute('aLine', new InstancedBufferAttribute(trSlot, 1));
  const TL = big ? 1.5 : 2.6; // train length
  const TW = W * 0.72;
  const trUni = {
    ...U,
    ...common,
    uPath: { value: pathTex },
    uTrain: { value: new Vector3(TL, TW, H * 0.95) },
    uBody: { value: lin(t0.train) },
  };
  const trains = new InstancedMesh(
    trGeo,
    new ShaderMaterial({
      uniforms: trUni,
      vertexShader: /* glsl */ `${LINE_UNI} uniform sampler2D uPath; uniform vec3 uTrain; uniform float uTime, uYear, uEnter, uMinYear;
        attribute float aRow, aLen, aPhase, aLine;
        varying vec3 vP, vN, vCol; varying float vDepth;
        void main() { ${YEAR}
          // Ease in and out of each terminus, like a train braking into the platform.
          float cyc = fract(uTime * 1.6 / (2. * aLen) + aPhase);
          float t = .5 - .5 * cos(6.2831853 * cyc);
          float fi = t * ${SAMPLES - 1}.; int i0 = min(int(floor(fi)), ${SAMPLES - 2}); float f = fi - float(i0);
          vec4 a = texelFetch(uPath, ivec2(i0, int(aRow)), 0); vec4 b = texelFetch(uPath, ivec2(i0 + 1, int(aRow)), 0);
          vec3 s = mix(a.xyz, b.xyz, f); vec2 tg = b.xy - a.xy; tg = length(tg) > 1e-5 ? normalize(tg) : vec2(1., 0.);
          float on = step(s.z, yr);
          vec3 lp = position * vec3(uTrain.x, uTrain.z, uTrain.y) * on;
          vec3 w = vec3(s.x + tg.x * lp.x - tg.y * lp.z, lp.y + uTrain.z * .55, s.y + tg.y * lp.x + tg.x * lp.z);
          vP = position; vN = normal; vCol = lineCol(aLine);
          vec4 mv = viewMatrix * modelMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform vec3 uBody, uBoard, uTrain; uniform float uFocus;
        ${DIM}
        varying vec3 vP, vN, vCol; varying float vDepth;
        void main() { vec2 q = vP.xz * vec2(uTrain.x, uTrain.y); vec2 hs = vec2(uTrain.x, uTrain.y) * .5;
          float r = hs.y * .9; vec2 d = abs(q) - hs + r; if (length(max(d, 0.)) > r) discard;
          vec3 col = uBody;
          if (vN.y > .5) {
            // Windows: a dark band split into cars.
            float band = 1. - smoothstep(hs.y * .38, hs.y * .5, abs(q.y));
            float car = step(.12, fract(q.x / (uTrain.x / 3.) + .5)) * step(abs(q.x), hs.x - r * .6);
            col = mix(col, vCol * .45, band * car * .85);
          } else col *= .82;
          col = dimmed(col, uFocus);
          gl_FragColor = vec4(untone(fogged(col, vDepth)), 1.); }`,
    }),
    nRun,
  );
  trains.count = runs.length;
  runs.forEach((tp, i) => {
    trRow[i] = i;
    trLen[i] = tp.len;
    trPhase[i] = (i * 0.618) % 1;
    trSlot[i] = tp.slot;
  });
  trains.frustumCulled = false;
  group.add(trains);

  // ---- The board: a lacquered panel (dark) or a printed sheet (light) on the neutral stage ----
  const spanX = L.xMax - L.xMin;
  const stripH = big ? 5.4 : 6.4;
  const margin = Math.min(LZ * 0.9, big ? 2.4 : 6.5);
  const zTop = Z(L.laneMin) - margin - stripH;
  const zBot = Z(L.laneMax) + margin;
  const padX = big ? 6 : 8;
  const boardW = spanX + tail * 2 + padX * 2;
  const boardD = zBot - zTop + (big ? 4 : 6);
  const boardZ = (zTop + zBot) / 2 + (big ? 0.6 : 1);
  const T = big ? 0.9 : 1.2; // board thickness
  const yearX = (y: number) => dir * (X(y) - xMid);
  const decades: number[] = [];
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1 && decades.length < 48; y += 10) decades.push(yearX(y));
  const gUni = {
    ...common,
    uLift: { value: lin(t0.lift) },
    uSide: { value: lin(t0.side) },
    uEdge: { value: lin(t0.edge) },
    uLine: { value: lin(t0.grid) },
    uMajor: { value: lin(t0.major) },
    uZone: { value: lin(t0.zone) },
    uCursor: { value: lin(t0.cursor) },
    uLZ: { value: LZ },
    uZ0: { value: Z(0) },
    uDecX: { value: [...decades, ...new Array(48 - decades.length).fill(1e5)] },
    uDecN: { value: decades.length },
    uDir: { value: dir },
    uHalf: { value: new Vector3(boardW / 2, T, boardD / 2) },
    uNow: { value: 1e5 },
  };
  const boardGeo = new BoxGeometry(1, 1, 1);
  boardGeo.translate(0, -0.5, 0);
  const board = new Mesh(
    boardGeo,
    new ShaderMaterial({
      uniforms: gUni,
      vertexShader: /* glsl */ `varying vec3 vL, vN; varying vec2 vP; varying float vDepth;
        void main() { vL = position; vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform vec3 uBoard, uLift, uSide, uEdge, uLine, uMajor, uZone, uCursor, uHalf;
        uniform float uLZ, uZ0, uNow, uFocus, uDir; uniform float uDecX[48]; uniform int uDecN;
        varying vec3 vL, vN; varying vec2 vP; varying float vDepth;
        float grid(float v, float s, float w) { float d = abs(fract(v / s + .5) - .5) * s; return 1. - smoothstep(0., max(fwidth(v) * w, 1e-4), d); }
        void main() { vec3 c;
          if (vN.y > .5) {
            vec2 q = abs(vL.xz) * 2.; // 0 at the centre, 1 at the edge
            float centre = 1. - smoothstep(.0, 1.1, length(q * vec2(.8, 1.)));
            c = mix(uBoard, uLift, centre);
            // Decade zones (warped, so read from the ruler's own positions) and faint lane guides.
            float zone = 0., major = 0., fx = max(fwidth(vP.x) * 1.4, 1e-4);
            for (int i = 0; i < 48; i++) { if (i >= uDecN) break; float dx = vP.x - uDecX[i];
              major = max(major, 1. - smoothstep(0., fx, abs(dx))); zone += step(0., dx * uDir); }
            c = mix(c, uZone, mod(zone, 2.) * .9);
            float fw = length(fwidth(vP));
            float minor = grid(vP.y - uZ0, uLZ, 1.) * (1. - smoothstep(.1, .3, fw / uLZ));
            c = mix(c, uLine, minor * .8);
            c = mix(c, uMajor, major);
            // Neatline: a thin double rule inset from the board's edge.
            vec2 ed = (uHalf.xz - abs(vL.xz) * uHalf.xz * 2.);
            float de = min(ed.x, ed.y); float aa = max(fwidth(de) * 1.2, 1e-4);
            float rule = 1. - smoothstep(0., aa, abs(de - 1.6) - .07);
            rule = max(rule, (1. - smoothstep(0., aa, abs(de - 2.05) - .025)) * .7);
            c = mix(c, uEdge, rule);
            c = mix(c, uEdge * 1.25, 1. - smoothstep(0., aa * 2., de - .05));
            // The slider's year: a dashed cursor across the sheet.
            float now = (1. - smoothstep(0., max(fwidth(vP.x) * 1.5, 1e-4), abs(vP.x - uNow))) * step(.45, fract(vP.y * .35));
            c = mix(c, uCursor, now * .6 * step(1.6, de));
          } else c = mix(uSide, uEdge, smoothstep(-.18, 0., vL.y * uHalf.y) * .8);
          gl_FragColor = vec4(untone(fogged(c, vDepth)), 1.); }`,
    }),
  );
  board.scale.set(boardW, T, boardD);
  board.position.set(0, 0, boardZ);
  group.add(board);
  // The stage under the board: neutral, a soft contact shadow below the board's edges.
  const floorUni = { ...common, uShadeC: { value: lin(t0.shade) }, uHalf: gUni.uHalf, uFloorA: { value: t0.shadow } };
  const floor = new Mesh(
    new PlaneGeometry(2400, 2400),
    new ShaderMaterial({
      uniforms: floorUni,
      vertexShader: `varying vec2 vP; varying float vDepth; void main() { vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform vec3 uShadeC, uHalf; uniform float uFloorA; varying vec2 vP; varying float vDepth;
        void main() { vec2 q = abs(vP - vec2(.8, ${(boardZ + 1.4).toFixed(2)})) - uHalf.xz;
          float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
          float sh = (1. - smoothstep(-1., 7., d)) * uFloorA * .55;
          gl_FragColor = vec4(untone(mix(uStage, uShadeC, sh)), 1.); }`,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -T;
  group.add(floor);
  // Backdrop: the stage colour all round (no gradient sky over a printed map).
  const sky = new Mesh(
    new SphereGeometry(1400, 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: common,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uStage; void main() { gl_FragColor = vec4(untone(uStage), 1.); }`,
    }),
  );
  group.add(sky);

  // ---- Year ruler along the far edge: ticks every year, decades labelled, all in one canvas strip ----
  const step = big ? 20 : 10;
  const stripW = boardW - 5;
  const stripTex = () => {
    const c = document.createElement('canvas');
    const pxu = Math.min(26, 4096 / stripW);
    c.width = Math.ceil(stripW * pxu);
    c.height = Math.ceil(stripH * pxu);
    const g = c.getContext('2d');
    if (g) {
      const ink = look().ink;
      g.strokeStyle = ink;
      g.fillStyle = ink;
      const base = c.height * 0.92;
      const PX = (y: number) => (yearX(y) + stripW / 2) * pxu;
      g.lineWidth = Math.max(1, pxu * 0.06);
      g.beginPath();
      g.moveTo(0, base);
      g.lineTo(c.width, base);
      g.stroke();
      for (let y = Math.ceil(y0); y <= NOW + 1; y++) {
        const x = PX(y);
        if (x < 0 || x > c.width) continue;
        const major = y % step === 0;
        const five = y % 5 === 0;
        if (!major && !five && Math.abs(PX(y + 1) - x) < pxu * 0.8) continue;
        const h = major ? 0.34 : five ? 0.2 : 0.11;
        g.lineWidth = Math.max(1, pxu * (major ? 0.09 : 0.05));
        g.beginPath();
        g.moveTo(x, base);
        g.lineTo(x, base - c.height * h);
        g.stroke();
      }
      g.font = `600 ${Math.round(c.height * 0.44)}px Manrope, "IBM Plex Sans Arabic", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      // Decade labels in time order (the same ones in both reading directions), skipping any that
      // would touch the previous one where the axis is compressed.
      let lastX = Number.NaN;
      let lastW = 0;
      for (let y = Math.ceil(y0 / step) * step; y <= NOW; y += step) {
        const x = PX(y);
        const w = g.measureText(`${y}`).width;
        if (Math.abs(x - lastX) < (w + lastW) / 2 + pxu * 1.2) continue;
        g.fillText(`${y}`, x, c.height * 0.5);
        lastX = x;
        lastW = w;
      }
    }
    const tx = new CanvasTexture(c);
    tx.colorSpace = SRGBColorSpace;
    tx.anisotropy = 8;
    // Premultiplied, so smaller mip levels fade the ink to transparent instead of towards the
    // colour stored in transparent pixels (dark ink on paper otherwise turns pale at a distance).
    tx.premultiplyAlpha = true;
    return tx;
  };
  const stripUni = { ...common, uMap: { value: stripTex() } };
  // The ruler is composited onto the board's colour and drawn opaque (cut out where empty): like the
  // shadows, alpha blending over the untoned paper would turn dark ink pale.
  const strip = new Mesh(
    new PlaneGeometry(stripW, stripH),
    new ShaderMaterial({
      uniforms: stripUni,
      vertexShader: `varying vec2 vUv; varying float vDepth; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${FOG} uniform sampler2D uMap; varying vec2 vUv; varying float vDepth;
        uniform vec3 uBoard;
        void main() { vec4 t = texture2D(uMap, vUv); if (t.a < .03) discard;
          gl_FragColor = vec4(untone(fogged(mix(uBoard, t.rgb / t.a, t.a), vDepth)), 1.); }`,
    }),
  );
  strip.rotation.x = -Math.PI / 2;
  // Lifted clear of the board: at fit-all distance a few hundredths would z-fight with it.
  strip.position.set(0, 0.25, zTop + stripH * 0.5 - (big ? 0.6 : 1));
  group.add(strip);
  // Redraw the canvas text once the app's fonts are in (skipped if the scene was dropped meanwhile).
  const fonts = document.fonts;
  if (fonts)
    void Promise.all([fonts.load('800 40px Manrope'), fonts.load('600 40px Manrope')])
      .then(() => {
        if (!group.parent) return;
        bulUni.uMap.value.dispose();
        bulUni.uMap.value = bulletTex();
        stripUni.uMap.value.dispose();
        stripUni.uMap.value = stripTex();
      })
      .catch(() => {});

  // ---- Lineage highlight: the engine fills a per-person probe; spine pieces light up if any child they lead to is lit ----
  const probe = new BufferGeometry();
  const probeHi = new Float32BufferAttribute(new Float32Array(n), 1);
  probe.setAttribute('aHi', probeHi);
  probe.userData.keys = M.people.map((p) => p.id);
  let seen = -1;
  const update = () => {
    const y = ctx.effYear();
    gUni.uNow.value = y < NOW - 0.5 ? yearX(y) : 1e5;
    if (probeHi.version === seen) return;
    seen = probeHi.version;
    const src = probeHi.array as Float32Array;
    const out = routeHi.array as Float32Array;
    for (const pc of pieces) {
      let v = 0;
      for (const o of pc.owners) if ((src[o] ?? 0) > 0.5) v = 1;
      out.fill(v, pc.v0, pc.v1);
    }
    routeHi.needsUpdate = true;
  };

  let viewDist = 300;
  let inkDark = ctx.dark();
  const tint = () => {
    const t = look();
    common.uStage.value.copy(lin(t.stage));
    common.uBoard.value.copy(lin(t.board));
    common.uGap.value.copy(lin(t.gap));
    common.uGold.value.copy(lin(t.gold));
    common.uTeal.value.copy(lin(t.teal));
    common.uStation.value.copy(lin(t.station));
    setColors(common.uLines.value, lines());
    common.uFogNear.value = viewDist * 1.8;
    common.uFogFar.value = viewDist * 5;
    gUni.uLift.value.copy(lin(t.lift));
    gUni.uSide.value.copy(lin(t.side));
    gUni.uEdge.value.copy(lin(t.edge));
    gUni.uLine.value.copy(lin(t.grid));
    gUni.uMajor.value.copy(lin(t.major));
    gUni.uZone.value.copy(lin(t.zone));
    gUni.uCursor.value.copy(lin(t.cursor));
    shUni.uShade.value.copy(lin(t.shade));
    shUni.uAlpha.value = t.shadow;
    floorUni.uShadeC.value.copy(lin(t.shade));
    floorUni.uFloorA.value = t.shadow;
    trUni.uBody.value.copy(lin(t.train));
    if (inkDark !== ctx.dark()) {
      inkDark = ctx.dark();
      stripUni.uMap.value.dispose();
      stripUni.uMap.value = stripTex();
    }
    // No bloom: the colours are exact (see untone), so the map reads like print.
    ctx.look(0, EXPO);
  };

  // Default view: the whole board from the front, tilted well over so it reads as a diagram, fitted
  // by projecting the board's corners (the engine widens it further for narrow stages).
  const tilt = big ? 1.12 : 1.08;
  const yaw = -dir * 0.1;
  const target = new Vector3(0, 0, boardZ + boardD * 0.03);
  const dirV = new Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt));
  const probeCam = new PerspectiveCamera(42, 1.45, 0.5, 6000);
  const corners: Vector3[] = [];
  for (const x of [-boardW / 2, boardW / 2])
    for (const z of [boardZ - boardD / 2, boardZ + boardD / 2]) corners.push(new Vector3(x, 0, z));
  for (const x of [-spanX / 2, spanX / 2])
    for (const z of [Z(L.laneMin), Z(L.laneMax)]) corners.push(new Vector3(x, lift + 2.5, z));
  const v = new Vector3();
  const fits = (d: number) => {
    probeCam.position.copy(target).addScaledVector(dirV, d);
    probeCam.lookAt(target);
    probeCam.updateMatrixWorld();
    return corners.every((c) => {
      v.copy(c).project(probeCam);
      return Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.93 && v.z < 1;
    });
  };
  let lo = 10;
  let hi = 5000;
  for (let it = 0; it < 32; it++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }
  viewDist = hi;
  tint();
  const cam = target.clone().addScaledVector(dirV, hi);
  return {
    key: 'metro',
    group,
    pos,
    size: big ? 0.8 : 1.62,
    style: 0,
    lift: 4,
    tint,
    labelUp: true,
    labelScale: 0.85,
    dir,
    appear,
    update,
    hiTargets: [
      { geo: probe, perPerson: false },
      { geo: stGeo, perPerson: true },
      { geo: barGeo, perPerson: true },
    ],
    focus: [common.uFocus],
    view: { target, cam },
    follow: big ? 30 : 50,
  };
};
