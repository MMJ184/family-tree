import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import {
  arrival,
  backdrop,
  GOLD,
  inkBuilder,
  inkGeometry,
  inkLine,
  inkLineMat,
  mainBranches,
  makeTone,
  recolourInk,
  setInk,
  setTone,
  symbolGeometry,
  symbolMat,
  TEAL,
  TONE,
  type Tone,
  widestGap,
  type YearMark,
  yearMarks,
} from './galaxy-gl.ts';
import type { SceneBuilder } from './types.ts';

// Constellation: the family drawn as a celestial chart (a planisphere). The founder is the pole and each
// generation a declination circle; constellation lines run from parents to children; the main branches
// are constellations with stepped, dashed boundaries (like the IAU's); partners are double stars joined
// in gold. Dark: a night sky with a faint Milky Way and twinkling stars. Light: an engraved chart printed
// in ink on white, the Milky Way as a wash with isophote contours. The graduated rim turns slowly, like
// a planisphere's date wheel. Arabic mirrors the chart, so siblings run the other way round.

const TAU = Math.PI * 2;
const MAX_RINGS = 24;
/** The first branch starts at twelve o'clock (the far side) and siblings follow clockwise. */
const TH0 = -Math.PI / 2;

interface SkyLook {
  paperC: string;
  paperE: string;
  grid: string;
  gridA: number;
  rim: string;
  rimA: number;
  milky: string;
  milkyA: number;
  cont: string;
  line: string;
  lineA: number;
  bound: string;
  boundA: number;
  gold: string;
  teal: string;
  /** The year marks on the circles. */
  year: string;
  yearA: number;
  /** Star colours: white, blue-white and warm at night; ink on paper. */
  s0: string;
  s1: string;
  s2: string;
  glow: number;
  bloom: number;
  exposure: number;
}

const LOOK: { dark: SkyLook; light: SkyLook } = {
  dark: {
    paperC: '#0b0b0c',
    paperE: '#000000',
    grid: '#9aa6bf',
    gridA: 0.2,
    rim: '#c3cad8',
    rimA: 0.5,
    milky: '#d3dbef',
    milkyA: 0.075,
    cont: '#000000',
    line: '#a8bde8',
    lineA: 0.62,
    bound: '#8f9ab0',
    boundA: 0.42,
    gold: GOLD.dark,
    teal: TEAL.dark,
    year: '#b3bccd',
    yearA: 0.7,
    s0: '#ffffff',
    s1: '#c9d8ff',
    s2: '#ffdcb4',
    glow: 0.55,
    bloom: 0.45,
    exposure: 1,
  },
  light: {
    paperC: '#ffffff',
    paperE: '#ebebeb',
    grid: '#8c8c8c',
    gridA: 0.55,
    rim: '#1c1c1c',
    rimA: 0.9,
    milky: '#dfe3ea',
    milkyA: 0.8,
    cont: '#b4bcc8',
    line: '#2b2b2b',
    lineA: 0.85,
    bound: '#8a8a8a',
    boundA: 0.75,
    gold: GOLD.light,
    teal: TEAL.light,
    year: '#5c5c5c',
    yearA: 0.95,
    s0: '#3a3a3a',
    s1: '#3a3a3a',
    s2: '#3a3a3a',
    glow: 0,
    bloom: 0,
    exposure: 1,
  },
};

/** A flat disc of rings in the xz plane; the chart shader bends it into a gentle dome. */
function disc(R: number, nr: number, ns: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nr; i++) {
    const r = (R * i) / nr;
    for (let j = 0; j <= ns; j++) {
      const a = (j / ns) * TAU;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < nr; i++)
    for (let j = 0; j < ns; j++) {
      const a = i * (ns + 1) + j;
      const b = a + ns + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface ChartParams {
  rim: number;
  dome: number;
  mirror: number;
  rings: number[];
  half: number[];
  ringYear: number[];
  r1: number;
  /** Milky Way: centre of its arc (in rim units), the arc's radius and the band's half-width. */
  mwC: [number, number];
  mwR: number;
  mwW: number;
}

/** The chart: graticule, generation circles, the graduated rim and the Milky Way. */
function chartMat(U: Shared, T: Tone, P: ChartParams) {
  const pad = (a: number[], v: number) => {
    const out = a.slice(0, MAX_RINGS);
    while (out.length < MAX_RINGS) out.push(v);
    return out;
  };
  const uni = {
    ...U,
    ...T,
    uFocus: { value: 0 },
    uRim: { value: P.rim },
    uDome: { value: P.dome },
    uR1: { value: P.r1 },
    uRings: { value: pad(P.rings, -1) },
    uHalf: { value: pad(P.half, -1) },
    uRingY: { value: pad(P.ringYear, 0) },
    uNR: { value: Math.min(MAX_RINGS, P.rings.length) },
    uMwC: { value: [P.mwC[0] * P.mirror, P.mwC[1]] },
    uMwR: { value: P.mwR },
    uMwW: { value: P.mwW },
    uGridC: { value: lin('#000000') },
    uGridA: { value: 0 },
    uRimC: { value: lin('#000000') },
    uRimA: { value: 0 },
    uMilkC: { value: lin('#000000') },
    uMilkA: { value: 0 },
    uContC: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      uniform float uRim, uDome; varying vec2 vP;
      void main() { vP = position.xz; float r = length(vP);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, -uDome * r * r / (uRim * uRim), position.z, 1.); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${TONE}
      uniform float uTime, uYear, uEnter, uMinYear, uFocus, uRim, uR1, uRings[${MAX_RINGS}], uHalf[${MAX_RINGS}], uRingY[${MAX_RINGS}];
      uniform float uMwR, uMwW, uGridA, uRimA, uMilkA; uniform vec2 uMwC; uniform int uNR;
      uniform vec3 uGridC, uRimC, uMilkC, uContC;
      varying vec2 vP;
      float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += noise(p) * a; p = p * 2.07 + 13.7; a *= .5; } return s; }
      /** A hairline of w px centred where x = 0. */
      float hair(float x, float w) { float f = max(fwidth(x), 1e-6); return 1. - smoothstep(f * (w * .5 - .5), f * (w * .5 + .5), abs(x)); }
      float milky(vec2 p) {
        vec2 q = p / uRim;
        float dc = length(q - uMwC) - uMwR;
        float n1 = fbm(q * 3.1 + 2.), n2 = fbm(q * 7.3 - 4.), n3 = noise(q * 19. + 9.);
        float w = uMwW * (.7 + .6 * n1);
        float d = exp(-dc * dc / (w * w)) * (.42 + .55 * n2 + .18 * n3);
        float rv = (dc + (n1 - .5) * .07) / (w * .24);
        float rift = exp(-rv * rv) * smoothstep(.32, .62, n2);
        return clamp(d * (1. - .72 * rift), 0., 1.) * (1. - smoothstep(.92, 1.04, length(q)));
      }
      void main() {
        vec2 p = vP; float r = length(p); if (r > uRim * 1.09) discard;
        float th = r > 1e-5 ? atan(p.y, p.x) : 0.;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float px = max(fwidth(r), 1e-5);
        // Declination circles: one per generation, drawn once its first member is born; dotted half steps.
        float dec = 0., dots = 0.;
        for (int i = 0; i < ${MAX_RINGS}; i++) {
          if (i >= uNR) break;
          float on = smoothstep(uRingY[i] - 2., uRingY[i] + 2., yr);
          dec = max(dec, hair(r - uRings[i], 1.1) * on);
          if (uHalf[i] > 0.) dots = max(dots, hair(r - uHalf[i], 1.) * step(.62, fract(th * uHalf[i] / max(px * 7., .35))) * on);
        }
        // Hour lines every 30 degrees (stronger every 90), from inside the first circle to the rim.
        float inside = step(uR1 * .55, r) * step(r, uRim);
        float hour = hair(sin(th * 6.) * r, 1.) * inside * smoothstep(1.5, 5., uR1 * .5 / px);
        float hour4 = hair(sin(th * 2.) * r, 1.3) * inside;
        // The graduated rim: two circles with degree ticks between them; the ring turns slowly.
        float band = step(uRim, r) * step(r, uRim * 1.05);
        float thr = th + uTime * .0045;
        float t1 = band * step(r, uRim * 1.016) * hair(sin(thr * 180.) * r, .9) * smoothstep(2., 4.5, uRim * .01745 / px);
        float t5 = band * step(r, uRim * 1.03) * hair(sin(thr * 36.) * r, 1.) * smoothstep(1.5, 4., uRim * .0873 / px);
        float t15 = band * hair(sin(thr * 12.) * r, 1.1);
        float rim = max(max(hair(r - uRim, 1.5), hair(r - uRim * 1.05, 1.2)), max(max(t1, t5), t15));
        float orn = hair(r - uRim * 1.075, 1.);
        float mw = milky(p);
        float k = 1. - uFocus * .55;
        float grid = max(max(dec, dots * .55), max(hour * .42, hour4 * .62));
        if (uInk > .5) {
          float fw = max(fwidth(mw), 1e-4);
          float fill = (smoothstep(.24 - fw, .24 + fw, mw) + smoothstep(.5 - fw, .5 + fw, mw)) * .5;
          float cont = max(hair(mw - .24, .9), hair(mw - .5, .9));
          vec3 c = paper();
          c = mix(c, uMilkC, uMilkA * k * fill);
          c = mix(c, uContC, .5 * k * cont);
          c = mix(c, uRimC, .045 * band);
          c = mix(c, uGridC, uGridA * k * grid);
          c = mix(c, uRimC, uRimA * k * max(rim, orn * .6));
          gl_FragColor = vec4(untone(c), 1.);
          return;
        }
        vec3 col = uGridC * uGridA * grid + uRimC * uRimA * max(rim, orn * .5) + uMilkC * uMilkA * mw * (.75 + .5 * noise(p * 1.7));
        col += uRimC * .018 * band;
        gl_FragColor = inkOut(col * k, 1.);
      }`,
  });
  setInk(mat, false);
  return { mat, uni };
}

/** Background stars: points of a fixed pixel size. Night: soft twinkling glows. Paper: crisp ink dots. */
function starsMat(U: { uTime: { value: number } }, T: Tone, rim: number, dome: number, far: boolean) {
  const uni = {
    ...T,
    uTime: U.uTime,
    uFocus: { value: 0 },
    uRim: { value: rim },
    uDome: { value: dome },
    uFar: { value: far ? 1 : 0 },
    uS0: { value: lin('#ffffff') },
    uS1: { value: lin('#ffffff') },
    uS2: { value: lin('#ffffff') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aStar; // magnitude 0..1 (1 brightest), phase, colour index
      uniform float uTime, uRim, uDome, uFar, uInk, uPR, uFocus; uniform vec3 uS0, uS1, uS2;
      varying vec3 vC; varying float vA, vPx;
      void main() {
        vec3 p = position; float r = length(p.xz);
        if (uFar < .5) p.y = -uDome * r * r / (uRim * uRim) + .02;
        float m = aStar.x;
        vC = aStar.z < .5 ? uS0 : aStar.z < 1.5 ? uS1 : uS2;
        float px;
        if (uInk > .5) { px = (1. + 2.1 * m * m) * uPR; vA = (.38 + .5 * m) * (1. - uFocus * .45); }
        else {
          px = (1.7 + 4.6 * m * m) * uPR * (uFar > .5 ? .8 : 1.);
          float tw = .62 + .38 * sin(uTime * (.7 + fract(aStar.y * 3.7) * 2.1) + aStar.y * 6.2832);
          vA = (.22 + .78 * m) * tw * (1. - uFocus * .5) * (uFar > .5 ? .7 : 1.);
        }
        vPx = px; gl_PointSize = px;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */ `
      ${TONE}
      varying vec3 vC; varying float vA, vPx;
      void main() {
        float d = length(gl_PointCoord - .5) * 2.; if (d > 1.) discard;
        if (uInk > .5) { float e = 2. / vPx; float a = (1. - smoothstep(1. - e * 1.5, 1., d)) * vA; if (a < .003) discard; gl_FragColor = inkOut(vC, a); return; }
        float a = (exp(-d * d * 7.) + exp(-d * 3.2) * .12) * vA;
        gl_FragColor = inkOut(vC, a); }`,
  });
  setInk(mat, false, true);
  return { mat, uni };
}

export const skyScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const mirror = ctx.rtl() ? -1 : 1;
  const size = big ? 1.2 : 1.7;
  /** A medal's full width, glow included (portraits.ts draws a quad of size × 2.3). */
  const D = size * 2.3;
  const slot = D * 1.08;
  // Partners sit one medal apart along the circle, with room for the default view's tilt (sin 57° ≈ 0.84).
  const wifeGap = D * 1.2;
  const dr = D * (big ? 1.45 : 1.7);

  // Partners laid out beside each person, in wedding order, alternating sides.
  const wives = new Map<string, StudioPerson[]>();
  for (const p of M.people) if (p.mi && p.anchor) wives.set(p.anchor, [...(wives.get(p.anchor) ?? []), p]);
  for (const list of wives.values()) list.sort((a, b) => spouseYear(M, a) - spouseYear(M, b));
  const nW = (p: StudioPerson) => wives.get(p.id)?.length ?? 0;

  // ---- one circle per generation: angles from the family's sectors, pushed apart where crowded ----
  interface Seat {
    p: StudioPerson;
    ideal: number;
    plus: number;
    minus: number;
    th: number;
  }
  const byGen: Seat[][] = Array.from({ length: M.maxGen + 1 }, () => []);
  for (const p of M.people) {
    if (p.mi || p === M.root) continue;
    const n = nW(p);
    byGen[p.gen]?.push({
      p,
      ideal: TH0 + p.ang * TAU,
      plus: slot / 2 + Math.ceil(n / 2) * wifeGap,
      minus: slot / 2 + Math.floor(n / 2) * wifeGap,
      th: 0,
    });
  }
  /** Least-squares angles that keep order and spacing (pool adjacent violators), cut at the widest gap. */
  const solve = (list: Seat[], r: number): boolean => {
    const n = list.length;
    if (n === 1) {
      (list[0] as Seat).th = (list[0] as Seat).ideal;
      return true;
    }
    let cut = 0;
    let widest = -1;
    for (let i = 0; i < n; i++) {
      const a = (list[i] as Seat).ideal;
      const b = i + 1 < n ? (list[i + 1] as Seat).ideal : (list[0] as Seat).ideal + TAU;
      if (b - a > widest) {
        widest = b - a;
        cut = (i + 1) % n;
      }
    }
    const seq = [...list.slice(cut), ...list.slice(0, cut)];
    const x = seq.map((s) => s.ideal);
    for (let i = 1; i < n; i++) while ((x[i] as number) < (x[i - 1] as number)) x[i] = (x[i] as number) + TAU;
    const S = [0];
    for (let i = 0; i + 1 < n; i++) S.push((S[i] as number) + ((seq[i] as Seat).plus + (seq[i + 1] as Seat).minus) / r);
    const vals: number[] = [];
    const cnt: number[] = [];
    for (let i = 0; i < n; i++) {
      vals.push((x[i] as number) - (S[i] as number));
      cnt.push(1);
      while (vals.length > 1 && (vals[vals.length - 2] as number) > (vals[vals.length - 1] as number)) {
        const v2 = vals.pop() as number;
        const c2 = cnt.pop() as number;
        const v1 = vals.pop() as number;
        const c1 = cnt.pop() as number;
        vals.push((v1 * c1 + v2 * c2) / (c1 + c2));
        cnt.push(c1 + c2);
      }
    }
    let i = 0;
    vals.forEach((v, b) => {
      for (let k = 0; k < (cnt[b] as number); k++, i++) (seq[i] as Seat).th = v + (S[i] as number);
    });
    const first = seq[0] as Seat;
    const last = seq[n - 1] as Seat;
    return first.th + TAU - last.th >= (last.plus + first.minus) / r - 1e-6;
  };
  const radius: number[] = [0];
  const reach0 = Math.ceil(nW(M.root) / 2) * wifeGap;
  let prev = 0;
  for (let g = 1; g <= M.maxGen; g++) {
    const list = (byGen[g] ?? []).sort((a, b) => a.ideal - b.ideal);
    let r = g === 1 ? Math.max(dr * 1.1, reach0 + D * 1.5) : prev + dr;
    if (list.length) {
      r = Math.max(r, list.reduce((s, q) => s + q.plus + q.minus, 0) / (TAU * 0.96));
      for (let it = 0; it < 40 && !solve(list, r); it++) r *= 1.04;
    }
    radius.push(r);
    prev = r;
  }
  const rim = (radius[M.maxGen] ?? dr) + dr * 0.72 + D * 0.3;
  const dome = rim * 0.1;
  const yAt = (r: number) => -dome * (r / rim) ** 2;

  // ---- everyone's place: polar, then onto the dome ----
  const at = new Map<string, { r: number; th: number }>();
  at.set(M.root.id, { r: 0, th: 0 });
  for (const list of byGen) for (const s of list) at.set(s.p.id, { r: radius[s.p.gen] ?? 0, th: s.th });
  for (let pass = 0; pass < 2; pass++)
    for (const [id, list] of wives) {
      const a = at.get(id);
      if (!a) continue;
      list.forEach((w, k) => {
        const step = (1 + Math.floor(k / 2)) * (k % 2 ? -1 : 1) * wifeGap;
        // Beside the founder: left and right of the pole; elsewhere along the circle.
        at.set(
          w.id,
          a.r < 1e-3 ? { r: Math.abs(step), th: step > 0 ? 0 : Math.PI } : { r: a.r, th: a.th + step / a.r },
        );
      });
    }
  for (const p of M.people) if (!at.has(p.id)) at.set(p.id, { r: wifeGap * 2, th: Math.PI / 2 });
  const plane = (q: { r: number; th: number }) => [Math.cos(q.th) * q.r * mirror, Math.sin(q.th) * q.r] as const;
  const onDome = (x: number, z: number, lift = 0) => new Vector3(x, yAt(Math.hypot(x, z)) + lift, z);
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const [x, z] = plane(at.get(p.id) ?? { r: 0, th: 0 });
    pos.set([x, yAt(Math.hypot(x, z)) + 0.05, z], i * 3);
  });

  // ---- atlas star symbols under the people (an ink disc on paper, a dark pocket at night) ----
  const symGeo = symbolGeometry(M, pos, sizeFactor);

  // ---- ink: constellation lines, partners in gold, constellation boundaries ----
  const B = inkBuilder();
  const kinds: number[] = [];
  const mark = (k: number) => {
    while (kinds.length < B.t.length) kinds.push(k);
  };
  const white = lin('#ffffff');
  const trimOf = (p: StudioPerson) => D * sizeFactor(p) * 0.34;
  /** Samples a path in the chart plane, drops the parts under the two portraits, lifts it onto the dome. */
  const path = (
    f: (t: number) => readonly [number, number],
    n: number,
    a: readonly [number, number],
    ta: number,
    b: readonly [number, number],
    tb: number,
  ) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const [x, z] = f(i / n);
      if (Math.hypot(x - a[0], z - a[1]) < ta || Math.hypot(x - b[0], z - b[1]) < tb) continue;
      pts.push(onDome(x, z, 0.03));
    }
    return pts;
  };
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const qa = at.get(p.parent);
    const qb = at.get(p.id);
    if (!qa || !qb) continue;
    const a = plane(qa);
    const b = plane(qb);
    const pts = path(
      (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      big ? 10 : 28,
      a,
      trimOf(M.get(p.parent)),
      b,
      trimOf(p),
    );
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
      // Partners further out along the circle get an arc that bows over the ones in between.
      const bow = (s - 1) * D * 0.62;
      const a = plane(qa);
      const b = plane(qb);
      const f =
        qa.r < 1e-3
          ? (t: number) => [a[0] + (b[0] - a[0]) * t, a[1] - (bow + D * 0.1) * Math.sin(Math.PI * t)] as const
          : (t: number) => plane({ r: qa.r + bow * Math.sin(Math.PI * t), th: qa.th + (qb.th - qa.th) * t });
      const pts = path(f, 12 + s * 8, a, trimOf(husband), b, trimOf(w));
      if (pts.length > 1) inkLine(B, pts, spouseYear(M, w), w.id, white, 1, 1.25);
      mark(1);
    });
  }
  // Constellation boundaries between neighbouring branches: radial within each generation's band and
  // along the band's edge between them (stepped, like the IAU's), dashed.
  const { heads } = mainBranches(M, 8, 0.6);
  const branchOf = new Map<string, number>();
  heads.forEach((h, i) => {
    const q = [h.id];
    while (q.length) {
      const id = q.pop() as string;
      branchOf.set(id, i);
      q.push(...M.get(id).kids);
    }
  });
  if (heads.length >= 2)
    for (let i = 0; i < heads.length; i++) {
      const j = (i + 1) % heads.length;
      const pts: Vector3[] = [];
      let lastBeta: number | null = null;
      let lastR = 0;
      for (let g = 1; g <= M.maxGen; g++) {
        const r = radius[g] ?? 0;
        const A = (byGen[g] ?? []).filter((s) => branchOf.get(s.p.id) === i);
        const Bs = (byGen[g] ?? []).filter((s) => branchOf.get(s.p.id) === j);
        if (!A.length || !Bs.length) {
          if (lastBeta != null) break;
          continue;
        }
        // Angles relative to branch i's middle, so wrap-around does not matter.
        const mid = A.reduce((s, q) => s + q.th, 0) / A.length;
        const norm = (t: number) => mid + ((((t - mid + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
        const aMax = Math.max(...A.map((q) => norm(q.th) + q.plus / r));
        let bMin = Math.min(...Bs.map((q) => norm(q.th) - q.minus / r));
        if (bMin < aMax - Math.PI) bMin += TAU;
        const beta = (aMax + bMin) / 2;
        const r0 = r - dr / 2;
        const r1 = g === M.maxGen ? rim : r + dr / 2;
        if (lastBeta != null) {
          const steps = Math.max(2, Math.ceil(Math.abs(beta - lastBeta) * lastR * 0.8));
          for (let k = 0; k <= steps; k++) {
            const [x, z] = plane({ r: lastR, th: lastBeta + ((beta - lastBeta) * k) / steps });
            pts.push(onDome(x, z, 0.02));
          }
        }
        const steps = Math.max(2, Math.ceil((r1 - r0) * 0.6));
        for (let k = 0; k <= steps; k++) {
          const [x, z] = plane({ r: r0 + ((r1 - r0) * k) / steps, th: beta });
          pts.push(onDome(x, z, 0.02));
        }
        lastBeta = beta;
        lastR = r1;
      }
      if (pts.length > 1) inkLine(B, pts, M.minYear - 10, '', white, 1, 0.9, D * 0.32);
      mark(2);
    }
  const lineGeo = inkGeometry(B);
  const lineKinds = Uint8Array.from(kinds);
  const T = makeTone();
  const lines = inkLineMat(U, T);
  lines.uni.uWidth.value = big ? 1.05 : 1.25;
  const lineMesh = new Mesh(lineGeo, lines.mat);
  lineMesh.frustumCulled = false;
  lineMesh.renderOrder = 4;

  // ---- the chart, its stars and the night sky ----
  const half: number[] = [];
  for (let g = 1; g < M.maxGen; g++) half.push(((radius[g] ?? 0) + (radius[g + 1] ?? 0)) / 2);
  half.push(-1);
  const ringYear: number[] = [];
  for (let g = 1; g <= M.maxGen; g++) {
    const ys = (byGen[g] ?? []).map((s) => s.p.born);
    ringYear.push(ys.length ? Math.min(...ys) : M.minYear);
  }
  const mw = { c: [0.92, -0.62] as [number, number], r: 1.18, w: 0.1 };
  const chart = chartMat(U, T, {
    rim,
    dome,
    mirror,
    rings: radius.slice(1),
    half,
    ringYear,
    r1: radius[1] ?? dr,
    mwC: mw.c,
    mwR: mw.r,
    mwW: mw.w,
  });
  const chartMesh = new Mesh(disc(rim * 1.09, 48, 192), chart.mat);
  chartMesh.renderOrder = 1;
  chartMesh.frustumCulled = false;

  // Stars on the chart: magnitude-scaled, thicker along the Milky Way, never under a portrait.
  const sr = rng(7);
  const cell = D * 0.9;
  const taken = new Set<string>();
  for (let i = 0; i < M.n; i++) {
    const cx = Math.floor((pos[i * 3] ?? 0) / cell);
    const cz = Math.floor((pos[i * 3 + 2] ?? 0) / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) taken.add(`${cx + dx},${cz + dz}`);
  }
  const nS = big ? 3400 : 2600;
  const sp: number[] = [];
  const sa: number[] = [];
  for (let k = 0; k < nS * 3 && sp.length / 3 < nS; k++) {
    let x: number;
    let z: number;
    if (sr() < 0.42) {
      // Along the Milky Way's arc.
      const a = sr() * TAU;
      const off = (sr() + sr() + sr() - 1.5) * mw.w * 0.9;
      x = (mw.c[0] + Math.cos(a) * (mw.r + off)) * rim * mirror;
      z = (mw.c[1] + Math.sin(a) * (mw.r + off)) * rim;
    } else {
      const rr = rim * Math.sqrt(sr());
      const a = sr() * TAU;
      x = Math.cos(a) * rr;
      z = Math.sin(a) * rr;
    }
    if (Math.hypot(x, z) > rim * 0.995) continue;
    if (taken.has(`${Math.floor(x / cell)},${Math.floor(z / cell)}`)) continue;
    sp.push(x, 0, z);
    const ci = sr();
    sa.push(sr() ** 5, sr(), ci < 0.62 ? 0 : ci < 0.86 ? 1 : 2);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
  starGeo.setAttribute('aStar', new Float32BufferAttribute(sa, 3));
  const stars = starsMat(U, T, rim, dome, false);
  const starMesh = new Points(starGeo, stars.mat);
  starMesh.frustumCulled = false;
  starMesh.renderOrder = 2;

  // The night sky around the chart (dark theme only).
  const fN = 2600;
  const fp = new Float32Array(fN * 3);
  const fa = new Float32Array(fN * 3);
  for (let i = 0; i < fN; i++) {
    const u = sr() * 2 - 1;
    const th = sr() * TAU;
    const rr = 700 + sr() * 400;
    const s = Math.sqrt(1 - u * u);
    fp.set([Math.cos(th) * s * rr, u * rr, Math.sin(th) * s * rr], i * 3);
    const ci = sr();
    fa.set([sr() ** 4, sr(), ci < 0.6 ? 0 : ci < 0.85 ? 1 : 2], i * 3);
  }
  const farGeo = new BufferGeometry();
  farGeo.setAttribute('position', new BufferAttribute(fp, 3));
  farGeo.setAttribute('aStar', new BufferAttribute(fa, 3));
  const farStars = starsMat(U, T, rim, dome, true);
  const farMesh = new Points(farGeo, farStars.mat);
  farMesh.frustumCulled = false;
  farMesh.renderOrder = 0;

  const sym = symbolMat(U, T, size);
  const symMesh = new Points(symGeo, sym.mat);
  symMesh.frustumCulled = false;
  symMesh.renderOrder = 5;

  // Year marks on the declination circles: each generation's first birth year, in the ring's widest gap.
  const marks: YearMark[] = [];
  for (let g = 1; g <= M.maxGen; g++) {
    const r = radius[g] ?? 0;
    const list = byGen[g] ?? [];
    if (!list.length || r <= 0) continue;
    const spans = list.map(
      (q) => [q.th + (q.plus - q.minus) / (2 * r), (q.plus + q.minus) / (2 * r) + 0.02] as [number, number],
    );
    const th = widestGap(spans, TH0);
    const [x, z] = plane({ r: r - D * 0.45, th });
    marks.push({ text: String(ringYear[g - 1] ?? ''), at: onDome(x, z, 0.08), year: ringYear[g - 1] ?? M.minYear });
  }
  const years = yearMarks(U, T, marks, D * 0.45);
  years.mesh.renderOrder = 3;

  group.add(backdrop(T), farMesh, chartMesh, starMesh, lineMesh, symMesh, years.mesh);

  // The symbols wait for the medals to land when the scene opens (they glide in from the last scene).
  const update = arrival(U, sym.uni.uFade);

  const tint = () => {
    const dark = ctx.dark();
    const L = dark ? LOOK.dark : LOOK.light;
    setTone(T, !dark, L.exposure, L.paperC, L.paperE);
    const c = chart.uni;
    c.uGridC.value.copy(lin(L.grid));
    c.uGridA.value = L.gridA;
    c.uRimC.value.copy(lin(L.rim));
    c.uRimA.value = L.rimA;
    c.uMilkC.value.copy(lin(L.milky));
    c.uMilkA.value = L.milkyA;
    c.uContC.value.copy(lin(L.cont));
    for (const s of [stars.uni, farStars.uni]) {
      s.uS0.value.copy(lin(L.s0));
      s.uS1.value.copy(lin(L.s1));
      s.uS2.value.copy(lin(L.s2));
    }
    for (const m of [chart.mat, lines.mat]) setInk(m, !dark);
    for (const m of [stars.mat, farStars.mat]) setInk(m, !dark, true);
    farMesh.visible = dark;
    sym.uni.uPocket.value = dark ? 0.35 : 0;
    sym.uni.uRing.value = dark ? 0.32 : 0;
    sym.uni.uInkC.value.copy(lin(dark ? '#e9edf5' : '#1a1a1a'));
    sym.uni.uGoldC.value.copy(lin(L.gold));
    sym.uni.uDeadC.value.copy(lin(dark ? '#8d929c' : '#8c8c8c'));
    sym.uni.uTealC.value.copy(lin(L.teal));
    years.uni.uC.value.copy(lin(L.year));
    years.uni.uA.value = L.yearA;
    setInk(years.mat, !dark);
    lines.uni.uHi.value.copy(lin(L.teal));
    lines.uni.uGlow.value = L.glow;
    lines.uni.uDim.value = dark ? 0.22 : 0.3;
    const line = lin(L.line);
    const gold = lin(L.gold);
    const bound = lin(L.bound);
    recolourInk(lineGeo, lineKinds, (k) => (k === 1 ? [gold, 1] : k === 2 ? [bound, L.boundA] : [line, L.lineA]));
    ctx.look(L.bloom, L.exposure);
  };

  // Default view: the whole chart from about 57 degrees up; the engine pulls back if anyone is left out.
  // The near half of the tilted chart looks larger, so the view aims a little in front of the pole.
  const el = 1.0;
  const dist = rim * 2.5;
  const target = new Vector3(0, -dome * 0.45, rim * 0.25);
  const view = {
    target,
    cam: new Vector3(0, target.y + Math.sin(el) * dist, Math.cos(el) * dist),
  };

  return {
    key: 'sky',
    group,
    pos,
    size,
    style: 1,
    lift: 6,
    labelScale: big ? 0.84 : 0.92,
    tint,
    hiTargets: [{ geo: lineGeo }, { geo: symGeo, perPerson: true }],
    focus: [
      lines.uni.uFocus,
      chart.uni.uFocus,
      stars.uni.uFocus,
      farStars.uni.uFocus,
      sym.uni.uFocus,
      years.uni.uFocus,
    ],
    update,
    view,
    follow: D * 6.5,
  };
};
