import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { spouseYear } from '../model.ts';
import { lin, NOW, PORTRAIT_COLOURS } from '../palette.ts';
import { metroLayout, roundCorners } from './metro-layout.ts';
import type { SceneBuilder } from './types.ts';

// Family Metro: the family as a Vignelli-style transit diagram printed on a sheet. Time runs
// along x (birth year); each couple's children ride one flat coloured line as stations in birth
// order, a child's own family branches off with 45° bends onto a parallel track, and spouses
// are interchanges (white bar, ink rim) beside their partner. Lines grow from one birth to the
// next with the time slider. One draw call each for routes, stations, interchange bars, soft
// shadows, the gridded sheet, the backdrop and the year strip. In Arabic the map is mirrored so
// the founder sits on the right (spec decision #10); `dir` records which way it was built.

type P2 = [number, number];

const THEME = {
  light: { bg: '#e6e4de', ground: '#fcfbf8', grid: '#e7e4dc', paper: '#ffffff', ink: '#1f2328', shadow: 0.3 },
  dark: { bg: '#0a0c0f', ground: '#161a20', grid: '#232933', paper: '#f4f3ee', ink: '#0b0d10', shadow: 0.55 },
};

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

const hue = (hex: string) => {
  const c = lin(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.h * 360;
};

export const metroScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const W = big ? 0.6 : 0.9; // route width
  const H = W * 0.42; // route height
  const SR = big ? 0.48 : 0.8; // station radius
  const SH = H + (big ? 0.07 : 0.12);
  const K = big ? 1.25 : 1.15; // x units per year
  const mid = (M.minYear + NOW) / 2;
  const gap = big ? 1.8 : 3.7;
  const lay = (lz: number) => metroLayout(M, { k: K, gap, wedGap: big ? 1.35 : 2.9, C: lz * 0.5, bin: gap, mid });
  // Lane spacing: roomy for small families so the map fills a landscape frame, tight for large ones.
  const LZ0 = big ? 1.7 : 3.2;
  const L0 = lay(LZ0);
  const LZ = Math.min(big ? 2.6 : 6, Math.max(LZ0, (L0.xMax - L0.xMin) / (2.1 * Math.max(1, L0.laneMax - L0.laneMin))));
  const L = LZ === LZ0 ? L0 : lay(LZ);
  const C = LZ * 0.5; // 45° chamfer
  const laneMid = (L.laneMin + L.laneMax) / 2;
  const xMid = (L.xMin + L.xMax) / 2;
  const Z = (lane: number) => (lane - laneMid) * LZ;
  const laneOf = (id: string) => L.lane.get(id) ?? 0;
  const xOf = (id: string) => dir * ((L.x.get(id) ?? 0) - xMid);

  // Line colours: the founder's line in the family colour, branches from the family palette.
  const home = M.homeColor;
  const pool = PORTRAIT_COLOURS.filter((c) => {
    const d = Math.abs(hue(c) - hue(home)) % 360;
    return Math.min(d, 360 - d) > 24 && c !== '#9aa7b3';
  });
  const lineCol = (k: number) => (k === 0 ? home : (pool[(k - 1) % pool.length] ?? home));
  const famCol = new Map<string, number>([[M.root.id, 0]]);
  for (const f of L.fams) {
    if (f.root) famCol.set(f.head.id, f.col);
    for (const k of f.kids) famCol.set(k.id, f.col);
  }
  const colOf = (id: string) => (M.get(id).mi ? M.get(id).color : lineCol(famCol.get(id) ?? 0));

  // ---- Routes: flat rounded tubes swept along octilinear polylines ----
  const R = { pos: [] as number[], nor: [] as number[], col: [] as number[], t: [] as number[], end: [] as number[] };
  const grow: number[] = [];
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
  const SHX = 0.18 * W;
  const SHZ = 0.55 * W;
  const addRoute = (path: P2[], color: string, end: number, g: number, owners: number[]) => {
    const pts = roundCorners(
      path.map(([u, z]) => [dir * (u - xMid), z] as P2),
      big ? LZ * 0.7 : LZ * 0.45,
    );
    if (pts.length < 2) return;
    const len: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as P2;
      const b = pts[i] as P2;
      len.push((len[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = len[len.length - 1] || 1;
    const c = lin(color);
    const v0 = R.pos.length / 3;
    const s0 = S.pos.length / 3;
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
      const t = (len[i] ?? 0) / total;
      for (const [px, py, nx, ny] of prof) {
        R.pos.push(p[0] + sx * px, H / 2 + py, p[1] + sz * px);
        R.nor.push(sx * nx, ny, sz * nx);
        R.col.push(c.r, c.g, c.b);
        R.t.push(t);
        R.end.push(end);
        grow.push(g);
      }
      // Soft shadow strip on the ground, nudged away from the light.
      for (const k of [-1, 1]) {
        S.pos.push(p[0] + sx * W * 1.25 * k + SHX * dir, 0.015, p[1] + sz * W * 1.25 * k + SHZ);
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
    pieces.push({ v0, v1: R.pos.length / 3, owners });
  };

  // Each family line: a branch from the parents' station (two 45° bends) then one piece per child,
  // growing from one birth to the next. A piece lights up when any child it leads to is lit.
  for (const f of L.fams) {
    const zF = Z(f.lane);
    const zH = Z(f.headLane);
    const color = lineCol(f.col);
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
    f.kids.forEach((k, i) => {
      const to: P2 = [L.x.get(k.id) ?? 0, zF];
      const g = Math.min(i ? 12 : 6, Math.max(0.8, k.born - prevYear));
      addRoute(
        [...prev, to],
        color,
        k.born,
        g,
        f.kids.slice(i).map((q) => q.idx),
      );
      prev = [to];
      prevYear = k.born;
    });
  }
  const routeGeo = new BufferGeometry();
  routeGeo.setAttribute('position', new Float32BufferAttribute(R.pos, 3));
  routeGeo.setAttribute('normal', new Float32BufferAttribute(R.nor, 3));
  routeGeo.setAttribute('aCol', new Float32BufferAttribute(R.col, 3));
  routeGeo.setAttribute('aT', new Float32BufferAttribute(R.t, 1));
  routeGeo.setAttribute('aEnd', new Float32BufferAttribute(R.end, 1));
  routeGeo.setAttribute('aGrow', new Float32BufferAttribute(grow, 1));
  const routeHi = new Float32BufferAttribute(new Float32Array(R.t.length), 1);
  routeGeo.setAttribute('aHi', routeHi);
  routeGeo.setIndex(idx);

  const th = () => (ctx.dark() ? THEME.dark : THEME.light);
  const t0 = th();
  const common = {
    uBg: { value: lin(t0.bg) },
    uShade: { value: lin(t0.ground) },
    uFocus: { value: 0 },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uExpo: { value: EXPO },
    uInInv: { value: ACES_IN_INV },
    uOutInv: { value: ACES_OUT_INV },
  };
  const YEAR = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;
  const routeMat = new ShaderMaterial({
    uniforms: { ...U, ...common },
    vertexShader: /* glsl */ `attribute vec3 aCol; attribute float aT, aEnd, aGrow, aHi;
      varying vec3 vCol, vN, vW; varying float vT, vEnd, vGrow, vHi, vDepth;
      void main() { vCol = aCol; vT = aT; vEnd = aEnd; vGrow = aGrow; vHi = aHi; vN = normal;
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} uniform float uYear, uEnter, uMinYear, uTime, uFocus, uFogNear, uFogFar; uniform vec3 uBg;
      varying vec3 vCol, vN, vW; varying float vT, vEnd, vGrow, vHi, vDepth;
      void main() { ${YEAR} float prog = (yr - (vEnd - vGrow)) / vGrow; if (vT > prog) discard;
        vec3 n = normalize(vN); vec3 Ld = normalize(vec3(-.3, .9, -.35));
        float dif = max(dot(n, Ld), 0.); vec3 col = vCol * (.74 + .3 * dif);
        vec3 V = normalize(cameraPosition - vW); float spec = pow(max(dot(n, normalize(Ld + V)), 0.), 60.);
        col += spec * .12;
        float pulse = smoothstep(.86, 1., fract(vT * 2. - uTime * .5)) * vHi * step(.4, n.y);
        col = mix(col, vec3(1.), pulse * .55);
        col = mix(col, mix(col, uBg, .8), uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(untone(mix(col, uBg, smoothstep(uFogNear, uFogFar, vDepth))), 1.); }`,
  });
  group.add(new Mesh(routeGeo, routeMat));

  // ---- Stations (one instanced cylinder) and interchange bars ----
  const n = M.n;
  const pos = new Float32Array(n * 3);
  const appear = new Float32Array(n);
  const stGeo = new CylinderGeometry(1, 1, 1, big ? 20 : 36, 1);
  stGeo.translate(0, 0.5, 0);
  const aCol = new Float32Array(n * 3);
  const aBorn = new Float32Array(n);
  const aKind = new Float32Array(n);
  stGeo.setAttribute('aCol', new InstancedBufferAttribute(aCol, 3));
  stGeo.setAttribute('aBorn', new InstancedBufferAttribute(aBorn, 1));
  stGeo.setAttribute('aKind', new InstancedBufferAttribute(aKind, 1));
  stGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  stGeo.userData.keys = M.people.map((p) => p.id);
  const stUni = { ...U, ...common, uPaper: { value: lin(t0.paper) }, uInk: { value: lin(t0.ink) } };
  const stMat = new ShaderMaterial({
    uniforms: stUni,
    vertexShader: /* glsl */ `attribute vec3 aCol; attribute float aBorn, aKind, aHi; uniform float uYear, uEnter, uMinYear;
      varying vec3 vCol, vP, vN; varying float vKind, vHi, vDepth;
      void main() { ${YEAR} float app = smoothstep(aBorn - .3, aBorn + .7, yr);
        float s = app * (1. + .14 * aHi);
        vec3 p = position * vec3(s, max(app, .001), s); vP = position; vN = normal; vCol = aCol; vKind = aKind; vHi = aHi;
        vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uPaper, uInk, uBg; uniform float uFocus, uFogNear, uFogFar;
      varying vec3 vCol, vP, vN; varying float vKind, vHi, vDepth;
      void main() { vec3 col;
        if (vN.y > .5) { float r = length(vP.xz); float e = fwidth(r) * 1.2;
          vec3 rim = vKind > 1.5 ? mix(vCol, uInk, .15) : vCol;
          col = mix(uPaper, rim, smoothstep(.6 - e, .6 + e, r));
          if (vKind > .5 && vKind < 1.5) col = mix(col, rim, smoothstep(.34 - e, .34 + e, r) * (1. - smoothstep(.46 - e, .46 + e, r)));
          col = mix(col, col * 1.08 + .04, vHi);
        } else col = vCol * .72;
        col = mix(col, mix(col, uBg, .8), uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(untone(mix(col, uBg, smoothstep(uFogNear, uFogFar, vDepth))), 1.); }`,
  });
  const stations = new InstancedMesh(stGeo, stMat, n);
  const mtx = new Matrix4();
  const lift = SH + (big ? 1.2 : 2.3);
  M.people.forEach((p, i) => {
    const x = xOf(p.id);
    const z = Z(laneOf(p.id));
    const root = p === M.root;
    const r = root ? SR * 1.45 : p.mi ? SR * 0.86 : SR;
    mtx.makeScale(r, SH, r).setPosition(x, 0, z);
    stations.setMatrixAt(i, mtx);
    const c = lin(colOf(p.id));
    aCol.set([c.r, c.g, c.b], i * 3);
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
    fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uPaper, uInk, uBg; uniform float uFocus, uFogNear, uFogFar;
      varying vec3 vP, vN; varying float vHi, vDepth;
      void main() { float e = fwidth(vP.z) * 1.2;
        vec3 col = vN.y > .5 ? mix(uPaper, uInk, smoothstep(.22 - e, .22 + e, abs(vP.z))) : uInk;
        col = mix(col, mix(col, uBg, .8), uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(untone(mix(col, uBg, smoothstep(uFogNear, uFogFar, vDepth))), 1.); }`,
  });
  const bars = new InstancedMesh(barGeo, barMat, nb);
  bars.count = spouses.length;
  spouses.forEach((p, i) => {
    const list = L.wed.get(p.anchor as string) ?? [];
    const j = list.indexOf(p);
    const prevId = j > 0 ? (list[j - 1] as (typeof list)[number]).id : (p.anchor as string);
    const xa = xOf(prevId);
    const xs = xOf(p.id);
    // The bar grows from the partner's side towards the spouse.
    mtx.makeScale(Math.abs(xs - xa), SH * 0.86, SR * 0.95);
    mtx.setPosition((xa + xs) / 2, 0, Z(laneOf(p.id)));
    if (xs < xa) mtx.multiply(new Matrix4().makeRotationY(Math.PI));
    bars.setMatrixAt(i, mtx);
    bBorn[i] = spouseYear(M, p);
  });
  bars.frustumCulled = false;
  group.add(bars);

  // Station shadows join the route shadow strips in one mesh.
  for (let i = 0; i < n; i++) {
    const p = M.people[i];
    if (!p) continue;
    const x = (pos[i * 3] ?? 0) + SHX * dir;
    const z = (pos[i * 3 + 2] ?? 0) + SHZ;
    const r = SR * (p === M.root ? 1.45 : 1) * 1.9;
    const s0 = S.pos.length / 3;
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      S.pos.push(x + a * r, 0.02, z + b * r);
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
  const shUni = { ...U, ...common, uAlpha: { value: t0.shadow } };
  const shadows = new Mesh(
    shGeo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: shUni,
      vertexShader: /* glsl */ `attribute vec2 aSh; attribute float aT, aEnd, aGrow; varying vec2 vSh; varying float vT, vEnd, vGrow;
        void main() { vSh = aSh; vT = aT; vEnd = aEnd; vGrow = aGrow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uShade; uniform float uYear, uEnter, uMinYear, uAlpha, uFocus; varying vec2 vSh; varying float vT, vEnd, vGrow;
        void main() { ${YEAR} float prog = (yr - (vEnd - vGrow)) / vGrow; if (vT > prog) discard;
          float a = 1. - smoothstep(0., 1., length(vSh)); a = a * a * uAlpha * (1. - .5 * uFocus);
          gl_FragColor = vec4(untone(uShade * .62), a); }`,
    }),
  );
  shadows.renderOrder = 1;
  group.add(shadows);

  // ---- Ground: matte paper with a lane grid and generation columns ----
  const spanX = L.xMax - L.xMin;
  const spanZ = (L.laneMax - L.laneMin) * LZ;
  const stripH = big ? 4.4 : 3.2;
  const yearX = (y: number) => dir * ((y - mid) * K - xMid);
  const gUni = {
    ...common,
    uC: { value: lin(t0.ground) },
    uLine: { value: lin(t0.grid) },
    uLZ: { value: LZ },
    uZ0: { value: Z(0) },
    uDec: { value: 10 * K },
    uX0: { value: yearX(0) },
    uHalf: { value: new Vector3(spanX / 2 + 6, 0, spanZ / 2 + LZ * 1.6 + stripH + 1.5) },
    uNow: { value: 1e5 },
    uInk: { value: lin(t0.ink) },
  };
  const ground = new Mesh(
    new PlaneGeometry(2600, 2600),
    new ShaderMaterial({
      uniforms: gUni,
      vertexShader: `varying vec2 vP; varying float vDepth; void main() { vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uC, uLine, uBg, uHalf, uInk; uniform float uLZ, uZ0, uDec, uX0, uNow, uFogNear, uFogFar; varying vec2 vP; varying float vDepth;
        float grid(float v, float s, float w) { float d = abs(fract(v / s + .5) - .5) * s; return 1. - smoothstep(0., fwidth(v) * w, d); }
        void main() { vec2 q = abs(vP) - uHalf.xz; float d = max(q.x, q.y); float aa = fwidth(d);
          float inside = 1. - smoothstep(-aa, aa, d);
          vec2 qs = abs(vP - vec2(.5, 1.4)) - uHalf.xz; float drop = 1. - smoothstep(-1., 5., max(qs.x, qs.y));
          float fw = length(fwidth(vP));
          float minor = max(grid(vP.x - uX0, uDec * .5, 1.), grid(vP.y - uZ0, uLZ, 1.)) * (1. - smoothstep(.12, .35, fw / uLZ));
          float major = grid(vP.x - uX0, uDec, 1.6);
          float band = mod(floor((vP.x - uX0) / uDec), 2.);
          vec3 c = mix(uC, uLine, .14 * band);
          c = mix(c, uLine, minor * .5 + major * .75);
          // The slider's year: a dashed cursor across the sheet.
          float now = (1. - smoothstep(0., fwidth(vP.x) * 1.5, abs(vP.x - uNow))) * step(.45, fract(vP.y * .35));
          c = mix(c, uInk, now * .55 * inside);
          c = mix(uBg * (1. - .16 * drop), c, inside);
          gl_FragColor = vec4(untone(mix(c, uBg, smoothstep(uFogNear, uFogFar, vDepth))), 1.); }`,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  // Backdrop: the same flat paper colour all round (no gradient sky on a printed map).
  const sky = new Mesh(
    new SphereGeometry(2800, 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: common,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uBg; void main() { gl_FragColor = vec4(untone(uBg), 1.); }`,
    }),
  );
  group.add(sky);

  // ---- Timeline: decade years printed along the far edge, all in one canvas strip ----
  const step = spanX / K > 120 ? 20 : 10;
  const years: number[] = [];
  for (let y = Math.ceil(M.minYear / step) * step; y <= NOW; y += step) years.push(y);
  const stripW = spanX + 16;
  const stripTex = () => {
    const c = document.createElement('canvas');
    const pxu = Math.min(24, 4096 / stripW);
    c.width = Math.ceil(stripW * pxu);
    c.height = Math.ceil(stripH * pxu);
    const g = c.getContext('2d');
    if (g) {
      g.font = `700 ${Math.round(stripH * pxu * 0.62)}px Manrope, "IBM Plex Sans Arabic", sans-serif`;
      g.fillStyle = ctx.dark() ? '#8792a1' : '#5f636b';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const y of years) g.fillText(`${y}`, (yearX(y) + stripW / 2) * pxu, c.height * 0.55);
    }
    const tx = new CanvasTexture(c);
    tx.colorSpace = SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  };
  const stripUni = { ...common, uMap: { value: stripTex() } };
  const stripMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: stripUni,
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */ `${UNTONE} uniform sampler2D uMap; varying vec2 vUv;
      void main() { vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(untone(t.rgb), t.a); }`,
  });
  const strip = new Mesh(new PlaneGeometry(stripW, stripH), stripMat);
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.03, Z(L.laneMin) - LZ * 1.6 - stripH * 0.5);
  group.add(strip);

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
      const v = pc.owners.some((o) => (src[o] ?? 0) > 0.5) ? 1 : 0;
      out.fill(v, pc.v0, pc.v1);
    }
    routeHi.needsUpdate = true;
  };

  let viewDist = 300;
  let inkDark = ctx.dark();
  const tint = () => {
    const t = th();
    common.uBg.value.copy(lin(t.bg));
    common.uFogNear.value = viewDist * 1.6;
    common.uFogFar.value = viewDist * 4;
    gUni.uC.value.copy(lin(t.ground));
    gUni.uLine.value.copy(lin(t.grid));
    gUni.uInk.value.copy(lin(ctx.dark() ? '#9aa4b2' : '#3b4048'));
    stUni.uPaper.value.copy(lin(t.paper));
    stUni.uInk.value.copy(lin(t.ink));
    shUni.uAlpha.value = t.shadow;
    common.uShade.value.copy(lin(t.ground));
    if (inkDark !== ctx.dark()) {
      inkDark = ctx.dark();
      stripUni.uMap.value.dispose();
      stripUni.uMap.value = stripTex();
    }
    // No bloom: the colours are exact (see untone), so the map reads like print.
    ctx.look(0, EXPO);
  };

  // Default view: the whole map from the front with a slight isometric turn, fitted by
  // projecting the map's corners (the engine widens it further for narrow stages).
  const tilt = big ? 0.98 : 1.02;
  const yaw = -dir * 0.16;
  const zTop = Z(L.laneMin) - LZ * 1.6 - stripH;
  const zBot = Z(L.laneMax) + LZ;
  const target = new Vector3(0, 0, (zTop + zBot) / 2);
  const look = new Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt));
  const probeCam = new PerspectiveCamera(42, 1.45, 0.5, 6000);
  const corners: Vector3[] = [];
  for (const x of [-spanX / 2 - 3, spanX / 2 + 3])
    for (const z of [zTop, zBot]) for (const y of [0, lift + 2]) corners.push(new Vector3(x, y, z));
  const fits = (d: number) => {
    probeCam.position.copy(target).addScaledVector(look, d);
    probeCam.lookAt(target);
    probeCam.updateMatrixWorld();
    const v = new Vector3();
    return corners.every((c) => {
      v.copy(c).project(probeCam);
      return Math.abs(v.x) < 0.93 && Math.abs(v.y) < 0.86 && v.z < 1;
    });
  };
  let lo = 10;
  let hi = 4000;
  for (let it = 0; it < 30; it++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }
  viewDist = hi;
  const cam = target.clone().addScaledVector(look, hi);
  return {
    key: 'metro',
    group,
    pos,
    size: big ? 0.78 : 1.3,
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
    follow: big ? 30 : 48,
  };
};
