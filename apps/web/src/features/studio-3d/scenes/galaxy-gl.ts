import {
  AddEquation,
  BufferGeometry,
  CanvasTexture,
  type Color,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  Matrix3,
  MaxEquation,
  Mesh,
  MinEquation,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import type { StudioModel, StudioPerson } from '../model.ts';
import { lin } from '../palette.ts';

// Cosmic scenes (galaxy, sky, helix): shared tone and ink helpers, then the Family Galaxy materials.
//
// Tone: the engine tone-maps everything with three's ACES fit. `untone` is its inverse, so a shader can
// ask for an exact display colour. The light themes are printed: paper is drawn first, then lines,
// washes and dots write the tone-mapped value of "ink at this coverage over the paper here" with a
// darken (min) blend. Plain alpha blending over a tone-mapped white washes ink out (50% ink over the
// paper shows at about 5%), and multiplying in HDR compounds far too steeply where inks overlap; darken
// is exact over the paper and never doubles up where segments meet or lines cross. Dark themes add or
// lighten (max) over black. Bloom must stay at 0 in the light themes: the paper is bright HDR.

export const TEAL = { dark: '#4fd1bd', light: '#0f6b63' };
export const GOLD = { dark: '#e2b65a', light: '#b7862c' };

const ACES_IN_INV = new Matrix3()
  .fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777])
  .invert();
const ACES_OUT_INV = new Matrix3()
  .fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602])
  .invert();

export interface Tone {
  uExpo: { value: number };
  uInInv: { value: Matrix3 };
  uOutInv: { value: Matrix3 };
  /** 1: light theme (ink darkens the paper), 0: dark theme (light adds to, or lightens, the black). */
  uInk: { value: number };
  /** Drawing-buffer size and pixel ratio, refreshed by the backdrop before each frame. */
  uRes: { value: Vector2 };
  uPR: { value: number };
  /** Centre of the free stage area in 0..1 screen units (the engine shifts it beside the scene rail). */
  uCtr: { value: Vector2 };
  /** Paper (or night) colour at the centre and at the edges of the stage, display-linear. */
  uPaperC: { value: Color };
  uPaperE: { value: Color };
}

export function makeTone(): Tone {
  return {
    uExpo: { value: 1 },
    uInInv: { value: ACES_IN_INV },
    uOutInv: { value: ACES_OUT_INV },
    uInk: { value: 0 },
    uRes: { value: new Vector2(1280, 800) },
    uPR: { value: 1 },
    uCtr: { value: new Vector2(0.5, 0.5) },
    uPaperC: { value: lin('#000000') },
    uPaperE: { value: lin('#000000') },
  };
}

/** Sets the theme on a tone block: exposure, ink mode and the paper colours (sRGB hex). */
export function setTone(T: Tone, light: boolean, expo: number, centre: string, edge: string) {
  T.uInk.value = light ? 1 : 0;
  T.uExpo.value = expo;
  T.uPaperC.value.copy(lin(centre));
  T.uPaperE.value.copy(lin(edge));
}

/** GLSL: untone(), paper() and inkOut(colour, coverage) for materials that carry the Tone uniforms. */
export const TONE = /* glsl */ `
  uniform float uExpo, uInk, uPR; uniform mat3 uInInv, uOutInv; uniform vec2 uRes, uCtr; uniform vec3 uPaperC, uPaperE;
  // NaN safety: a NaN or Inf pixel would be spread over the whole frame by the bloom pass, so every
  // division, pow() and atan() below is guarded. y stays under 1/0.983729, where A would reach 0.
  vec3 untone(vec3 c) { vec3 y = clamp(uOutInv * clamp(c, 0., .985), 0., .98);
    vec3 A = y * .983729 - 1., B = y * .432951 - .0245786, C = y * .238081 + .000090537;
    vec3 v = (-B - sqrt(max(B * B - 4. * A * C, 0.))) / (2. * A);
    return max(uInInv * v, 0.) / (uExpo / .6); }
  vec3 paper() { vec2 res = max(uRes, vec2(1.)); vec2 q = gl_FragCoord.xy / res - uCtr; q.x *= res.x / res.y;
    return mix(uPaperC, uPaperE, smoothstep(.1, .95, length(q))); }
  // Light: the tone-mapped value of ink c at coverage a over the paper (darken blend).
  // Dark: light c times a (added, or lightened).
  vec4 inkOut(vec3 c, float a) {
    if (uInk > .5) return vec4(untone(mix(paper(), c, clamp(a, 0., 1.))), 1.);
    return vec4(max(untone(c * a) - untone(vec3(0.)), 0.), 1.); }`;

/**
 * Blending for materials that end in inkOut(): darken on paper (light theme); on black, add (glows that
 * should build up, like dense star fields) or lighten (lines and charts, which must not double up).
 */
export function setInk(m: ShaderMaterial, light: boolean, add = false) {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendEquation = light ? MinEquation : add ? AddEquation : MaxEquation;
}

/**
 * The stage behind a scene: a screen-filling quad at the far plane in the paper (or night) colour,
 * lifted towards the centre of the free area. It renders first and refreshes the Tone screen uniforms.
 */
export function backdrop(T: Tone) {
  // Double-sided: a scene may mirror its group for Arabic (negative scale flips the winding).
  const mat = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { ...T },
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, .99999, 1.); }`,
    fragmentShader: /* glsl */ `${TONE} void main() { gl_FragColor = vec4(untone(paper()), 1.); }`,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  const v = new Vector3();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(T.uRes.value);
    T.uPR.value = renderer.getPixelRatio();
    // The point straight ahead of the camera lands on the projection centre, which the engine shifts beside the rail.
    v.set(0, 0, -1).applyMatrix4(camera.projectionMatrix);
    T.uCtr.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
  };
  return mesh;
}

// ---------- layout ----------

/**
 * The family's main branches: the founder's children, where a branch holding most of the family is
 * replaced by its children (so one dominant son does not leave a single arm or constellation). Returns
 * the branch heads in sibling order and the people folded into the centre on the way.
 */
export function mainBranches(M: StudioModel, max = 8, share = 0.6) {
  const core = new Set<string>([M.root.id]);
  let heads: StudioPerson[] = M.root.kids.map((k) => M.get(k));
  const total = Math.max(1, M.root.leaves);
  for (let guard = 0; guard < 16 && heads.length < max; guard++) {
    let top: StudioPerson | undefined;
    for (const h of heads) if (!top || h.leaves > top.leaves) top = h;
    if (!top?.kids.length || top.leaves / total < share) break;
    // Stop before the split would pass the limit, or would only scatter childless children into branches.
    if (heads.length - 1 + top.kids.length > max) break;
    if (top.kids.every((k) => !M.get(k).kids.length)) break;
    const i = heads.indexOf(top);
    core.add(top.id);
    heads = [...heads.slice(0, i), ...top.kids.map((k) => M.get(k)), ...heads.slice(i + 1)];
  }
  return { heads, core };
}

// ---------- screen-space ink lines ----------

export interface InkBuilder {
  a: number[];
  b: number[];
  q: number[];
  t: number[];
  birth: number[];
  col: number[];
  w: number[];
  dash: number[];
  key: string[];
  idx: number[];
}

export const inkBuilder = (): InkBuilder => ({
  a: [],
  b: [],
  q: [],
  t: [],
  birth: [],
  col: [],
  w: [],
  dash: [],
  key: [],
  idx: [],
});

const CORNERS = [0, -1, 0, 1, 1, -1, 1, 1];

/**
 * Appends a polyline drawn as crisp screen-space segments (one draw call for every line in the builder).
 * t runs t0..t1 along it (the line grows with the years); width is a multiple of the material's width;
 * dash > 0 cuts it into dashes of that world length; key drives the lineage highlight (aHi).
 */
export function inkLine(
  B: InkBuilder,
  pts: Vector3[],
  birth: number,
  key: string,
  col: Color,
  alpha = 1,
  width = 1,
  dash = 0,
  t0 = 0,
  t1 = 1,
) {
  let len = 0;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const A = pts[i];
    const C = pts[i + 1];
    if (!A || !C) continue;
    const seg = A.distanceTo(C);
    const base = B.a.length / 3;
    for (let k = 0; k < 4; k++) {
      const e = CORNERS[k * 2] ?? 0;
      B.a.push(A.x, A.y, A.z);
      B.b.push(C.x, C.y, C.z);
      B.q.push(e, CORNERS[k * 2 + 1] ?? 1);
      B.t.push(t0 + ((t1 - t0) * (i + e)) / n);
      B.birth.push(birth);
      B.col.push(col.r, col.g, col.b, alpha);
      B.w.push(width);
      B.dash.push(dash > 0 ? (len + e * seg) / dash : -1);
      B.key.push(key);
    }
    B.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    len += seg;
  }
}

export function inkGeometry(B: InkBuilder) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B.a, 3));
  g.setAttribute('aB', new Float32BufferAttribute(B.b, 3));
  g.setAttribute('aQ', new Float32BufferAttribute(B.q, 2));
  g.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  g.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  g.setAttribute('aCol', new Float32BufferAttribute(B.col, 4));
  g.setAttribute('aW', new Float32BufferAttribute(B.w, 1));
  g.setAttribute('aDash', new Float32BufferAttribute(B.dash, 1));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.t.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

/** Recolours ink lines in place (theme change): colour and alpha for each vertex from its kind. */
export function recolourInk(geo: BufferGeometry, kinds: Uint8Array, pick: (kind: number) => [Color, number]) {
  const col = geo.getAttribute('aCol');
  for (let i = 0; i < kinds.length; i++) {
    const [c, a] = pick(kinds[i] ?? 0);
    col.setXYZW(i, c.r, c.g, c.b, a);
  }
  col.needsUpdate = true;
}

/**
 * Lines of a fixed pixel width, anti-aliased in the shader. Lines on the selected lineage turn teal,
 * grow wider and carry a slow pulse from parent to child; with a selection the rest fade.
 */
export function inkLineMat(U: Shared, T: Tone) {
  const uni = {
    ...U,
    ...T,
    uFocus: { value: 0 },
    uHi: { value: lin(TEAL.dark) },
    uAlpha: { value: 1 },
    uWidth: { value: 1.2 },
    uGlow: { value: 0 },
    uGrowT: { value: 1.2 },
    uDim: { value: 0.22 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aB; attribute vec4 aCol; attribute vec2 aQ; attribute float aT, aBirth, aHi, aW, aDash;
      uniform vec2 uRes; uniform float uPR, uWidth, uGlow;
      varying vec4 vCol; varying float vT, vBirth, vHi, vDash, vD, vHW;
      void main() {
        vCol = aCol; vT = aT; vBirth = aBirth; vHi = aHi; vDash = aDash;
        vec4 ca = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.);
        if (ca.w < .01 || cb.w < .01) { gl_Position = vec4(0., 0., 2., 1.); return; }
        vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes; float l = length(d); d = l > 1e-5 ? d / l : vec2(1., 0.);
        float hw = uWidth * aW * (1. + aHi * .9) * .5 * uPR;
        float ext = hw * (1. + uGlow * 3.) + 1.;
        vec4 c = aQ.x < .5 ? ca : cb;
        c.xy += vec2(-d.y, d.x) * aQ.y * ext * 2. / max(uRes, vec2(1.)) * c.w;
        gl_Position = c; vD = aQ.y * ext; vHW = hw; }`,
    fragmentShader: /* glsl */ `${TONE}
      uniform float uYear, uEnter, uMinYear, uTime, uFocus, uAlpha, uGlow, uGrowT, uDim; uniform vec3 uHi;
      varying vec4 vCol; varying float vT, vBirth, vHi, vDash, vD, vHW;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float g = clamp((yr - vBirth) / uGrowT, 0., 1.); if (vT > g) discard;
        if (vDash >= 0. && fract(vDash) > .5) discard;
        float d = abs(vD);
        float cov = clamp(vHW + .5 - d, 0., 1.);
        float halo = uGlow * exp(-d * d / max(vHW * vHW * 5., .6)) * .45;
        float a = (cov + halo * (1. - cov)) * mix(uAlpha * vCol.a, 1., vHi);
        a *= uFocus > .5 && vHi < .5 ? uDim : 1.;
        float pulse = vHi * smoothstep(.82, 1., fract(vT * 1.5 - uTime * .32 + vBirth * .13));
        vec3 c = mix(vCol.rgb, uHi, vHi);
        c = uInk > .5 ? c * (1. - pulse * .35) : mix(c, vec3(1.), pulse * .45);
        if (a < .002) discard;
        gl_FragColor = inkOut(c, a); }`,
  });
  setInk(mat, false);
  return { mat, uni };
}

// ---------- star symbols under the people ----------

/**
 * Atlas star symbols under the people, sized in the world. Paper: a filled disc in the medal's colour
 * language (ink, gold for married in, grey once deceased, teal on the selected lineage) inside a paper
 * halo that knocks out the stars and lines behind it; it fades as the portrait opens up close (the medal
 * covers that size). Night: a soft dark pocket that keeps a star readable over bright star clouds, and a
 * fine annotation ring in the same colour language, like a star marked on a photographic plate.
 * Attributes: aSF (portrait size factor), aKind (0 born in, 1 married in, 2 deceased), aBirth, aHi.
 */
export function symbolMat(U: Shared, T: Tone, size: number) {
  const uni = {
    ...U,
    ...T,
    uSize: { value: size },
    uFade: { value: 0 },
    uFocus: { value: 0 },
    uPocket: { value: 0.6 },
    uRing: { value: 0 },
    uInkC: { value: lin('#1a1a1a') },
    uGoldC: { value: lin(GOLD.light) },
    uDeadC: { value: lin('#8c8c8c') },
    uTealC: { value: lin(TEAL.light) },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aSF, aKind, aBirth, aHi;
      uniform float uSize, uYear, uEnter, uMinYear, uTime, uFade, uInk, uPR, uFocus; uniform vec2 uRes;
      uniform vec3 uInkC, uGoldC, uDeadC, uTealC;
      varying vec3 vC; varying float vA, vR, vH, vS, vOpen;
      void main() {
        vec3 p = position; p.y += sin(uTime * .8 + aBirth * 1.7) * .12; // the medals' bob
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float ppu = projectionMatrix[1][1] * .5 * uRes.y / max(-mv.z, 1e-3);
        vOpen = smoothstep(8., 18., .506 * uSize * aSF * ppu);
        vR = max(.36 * uSize * aSF * ppu, 3.4 * uPR);
        vH = uInk > .5 ? vR + max(2.4 * uPR, vR * .5) : max(1.25 * uSize * aSF * ppu, 11. * uPR);
        vS = vH * 2. + 2.;
        gl_PointSize = vS;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        vA = smoothstep(aBirth, aBirth + .9, yr) * uFade * (1. - uFocus * .72 * (1. - step(.5, aHi)));
        vC = aHi > .5 ? uTealC : aKind > 1.5 ? uDeadC : aKind > .5 ? uGoldC : uInkC;
        gl_Position = projectionMatrix * mv;
        if (vA < .01) gl_Position = vec4(0., 0., 2., 1.);
      }`,
    fragmentShader: /* glsl */ `
      ${TONE}
      uniform float uPocket, uRing;
      varying vec3 vC; varying float vA, vR, vH, vS, vOpen;
      void main() {
        float d = length(gl_PointCoord - .5) * vS;
        if (uInk > .5) {
          float disc = clamp(vR + .5 - d, 0., 1.), halo = clamp(vH + .5 - d, 0., 1.);
          float a = halo * vA * (1. - vOpen);
          if (a < .003) discard;
          gl_FragColor = vec4(untone(mix(paper(), vC, disc * .95)), a);
          return;
        }
        // The pocket darkens what is behind; the ring of colour rc and coverage ra lies over it.
        float pa = (1. - smoothstep(vH * .6, vH, d)) * uPocket * vA;
        float rr = vH * .78, rw = max(.9 * uPR, 1.);
        float ra = clamp(rw * .5 + .5 - abs(d - rr), 0., 1.) * uRing * vA;
        float A = 1. - (1. - pa) * (1. - ra);
        if (A < .003) discard;
        gl_FragColor = vec4(untone(vC) * ra / A, A); }`,
  });
  return { mat, uni };
}

/** Geometry for symbolMat: one point per person at the scene's portrait positions. */
export function symbolGeometry(M: StudioModel, pos: Float32Array, sizeOf: (p: StudioPerson) => number) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos.slice(), 3));
  g.setAttribute('aSF', new Float32BufferAttribute(M.people.map(sizeOf), 1));
  g.setAttribute(
    'aKind',
    new Float32BufferAttribute(
      M.people.map((p) => (p.died != null ? 2 : p.mi ? 1 : 0)),
      1,
    ),
  );
  g.setAttribute(
    'aBirth',
    new Float32BufferAttribute(
      M.people.map((p) => p.born),
      1,
    ),
  );
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(M.n), 1));
  g.userData.keys = M.people.map((p) => p.id);
  return g;
}

/**
 * Fade-in for scene overlays that sit on the portraits: they wait while the medals glide in from the
 * previous scene. Call tick() from SceneDef.update (it runs only while the scene is shown).
 */
export function arrival(U: Shared, target: { value: number }, delay = 1.1) {
  let seen = -1;
  let opened = 0;
  return () => {
    const t = U.uTime.value;
    if (t - seen > 0.25) opened = t;
    seen = t;
    target.value = Math.min(1, Math.max(0, (t - opened - delay) / 0.6));
  };
}

// ---------- year marks ----------

const TAU_ = Math.PI * 2;

export interface YearMark {
  text: string;
  at: Vector3;
  /** Year the mark appears (the ring is drawn then). */
  year: number;
}

/**
 * Small year marks on the generation circles, like the declinations engraved on a star chart: one canvas
 * atlas, one camera-facing quad each, one draw call. Digits only (they read the same in both languages).
 * Light: ink that darkens the paper. Dark: soft silver light. `h` is the text height in world units.
 */
export function yearMarks(U: Shared, T: Tone, marks: YearMark[], h: number) {
  const fs = 44;
  const pad = 8;
  const font = `600 ${fs}px Manrope, "IBM Plex Sans Arabic", ui-sans-serif, sans-serif`;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  const widths = marks.map((m) => {
    if (!g) return fs * 2;
    g.font = font;
    return Math.ceil(g.measureText(m.text).width) + pad * 2;
  });
  const row = fs + pad * 2;
  cv.width = Math.max(64, ...widths);
  cv.height = Math.max(64, row * marks.length);
  if (g) {
    g.font = font;
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.direction = 'ltr';
    marks.forEach((m, i) => {
      g.fillText(m.text, cv.width / 2, row * i + row / 2 + 2);
    });
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const pos: number[] = [];
  const q: number[] = [];
  const uv: number[] = [];
  const size: number[] = [];
  const birth: number[] = [];
  const idx: number[] = [];
  marks.forEach((m, i) => {
    const w = widths[i] ?? row;
    const hw = (h * w) / row / 2;
    const u0 = (cv.width - w) / 2 / cv.width;
    const u1 = 1 - u0;
    const v1 = 1 - (row * i) / cv.height;
    const v0 = 1 - (row * (i + 1)) / cv.height;
    const base = pos.length / 3;
    for (const [qx, qy, u, v] of [
      [-1, -1, u0, v0],
      [1, -1, u1, v0],
      [1, 1, u1, v1],
      [-1, 1, u0, v1],
    ] as const) {
      pos.push(m.at.x, m.at.y, m.at.z);
      q.push(qx, qy);
      uv.push(u, v);
      size.push(hw, h / 2);
      birth.push(m.year);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aQ', new Float32BufferAttribute(q, 2));
  geo.setAttribute('aUv', new Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSize', new Float32BufferAttribute(size, 2));
  geo.setAttribute('aBirth', new Float32BufferAttribute(birth, 1));
  geo.setIndex(idx);
  const uni = {
    ...U,
    ...T,
    uMap: { value: tex },
    uFocus: { value: 0 },
    uC: { value: lin('#000000') },
    uA: { value: 0.8 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec2 aQ, aUv, aSize; attribute float aBirth;
      uniform float uYear, uEnter, uMinYear;
      varying vec2 vUv; varying float vA;
      void main() {
        vUv = aUv;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        vA = smoothstep(aBirth - 2., aBirth + 2., yr);
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        mv.xy += aQ * aSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `${TONE}
      uniform sampler2D uMap; uniform vec3 uC; uniform float uA, uFocus;
      varying vec2 vUv; varying float vA;
      void main() {
        float a = texture2D(uMap, vUv).a * vA * uA * (1. - uFocus * .6);
        if (a < .004) discard;
        gl_FragColor = inkOut(uC, a); }`,
  });
  setInk(mat, false);
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat, uni };
}

/**
 * The middle of the widest empty arc on a ring, given the angles people occupy (centre and half-extent
 * in radians), so a mark set there never sits under a person.
 */
export function widestGap(spans: Array<[number, number]>, fallback: number) {
  if (!spans.length) return fallback;
  const iv = spans.map(([c, e]) => [(((c - e) % TAU_) + TAU_) % TAU_, e * 2] as const).sort((a, b) => a[0] - b[0]);
  let best = -1;
  let at = fallback;
  for (let i = 0; i < iv.length; i++) {
    const a = iv[i] as readonly [number, number];
    const b = iv[(i + 1) % iv.length] as readonly [number, number];
    const end = a[0] + a[1];
    const next = i + 1 < iv.length ? b[0] : b[0] + TAU_;
    if (next - end > best) {
      best = next - end;
      at = end + (next - end) / 2;
    }
  }
  return at;
}

// ---------- Family Galaxy ----------
// The GPU star field (one Points draw for bulge, arms, disk, HII knots and the far sky) and the
// unresolved galaxy light (one disk plane with arms, dust lanes, nebulae and the chart grid). Both
// share the spiral: angle = arm phase + offset across the arm + ln(r / rc) * wind.

export const MAX_ARMS = 16;
export const MAX_GENS = 24;

/** Shared GLSL: spiral angle, arm taper and the birth year of a radius (the galaxy grows outward). */
const SPIRAL = /* glsl */ `
  uniform float uRc, uWind, uR, uGR[${MAX_GENS}], uGY[${MAX_GENS}];
  uniform int uNG;
  float taperR(float r) { return clamp(.35 + .65 * (r / uRc - 1.) * .5, .35, 1.); }
  float birthAt(float r) { float b = uGY[0]; for (int i = 1; i < ${MAX_GENS}; i++) { if (i >= uNG) break; if (r > uGR[i] - 1.5) b = uGY[i]; } return b; }`;

export interface SpiralUniforms {
  uRc: { value: number };
  uWind: { value: number };
  uR: { value: number };
  uGR: { value: number[] };
  uGY: { value: number[] };
  uNG: { value: number };
}

/** Colours the galaxy materials read; tint() copies a theme's LOOK into them. */
export interface GalaxyInks {
  uWarm: { value: Color };
  uBlue: { value: Color };
  uPink: { value: Color };
  uCore: { value: Color };
  /** Light theme: ink of the bulge, the arms and the knots. */
  uInkCore: { value: Color };
  uInkArm: { value: Color };
  uInkKnot: { value: Color };
  uGain: { value: number };
  /**
   * Camera distance from the core at which the whole galaxy is framed. Closer in, the galaxy resolves:
   * the unresolved light dims and star glows stop growing, so the people stay readable up close.
   */
  uViewD: { value: number };
}

export const galaxyInks = (): GalaxyInks => ({
  uWarm: { value: lin('#000000') },
  uBlue: { value: lin('#000000') },
  uPink: { value: lin('#000000') },
  uCore: { value: lin('#000000') },
  uInkCore: { value: lin('#000000') },
  uInkArm: { value: lin('#000000') },
  uInkKnot: { value: lin('#000000') },
  uGain: { value: 1 },
  uViewD: { value: 100 },
});

/**
 * Star particles. Attributes: position (kind-specific), aK (kind, arm span, height, radial jitter),
 * aC (tint rgb, phase), aS (world size). Kinds: 0 bulge, 1 arm star, 2 disk, 3 HII knot, 4 far sky.
 * Arm stars and knots slide along their log spiral (which reads as the arms turning); bulge and disk
 * rotate differentially. Dark: soft additive glows with diffraction spikes on the brightest.
 * Light: crisp ink dots (atlas style); the far sky is left out.
 */
export function starMat(U: Shared, S: SpiralUniforms, T: Tone, I: GalaxyInks) {
  const uni = {
    ...U,
    ...S,
    ...T,
    ...I,
    uFocus: { value: 0 },
    uLmin: { value: 0 },
    uLmax: { value: 1 },
    uSz: { value: 1 },
    uInkK: { value: 1 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      ${SPIRAL}
      attribute vec4 aK, aC; attribute float aS;
      uniform float uTime, uYear, uEnter, uMinYear, uPR, uGain, uLmin, uLmax, uSz, uInk, uInkK, uFocus, uViewD;
      uniform vec3 uWarm, uBlue, uPink, uInkCore, uInkArm, uInkKnot;
      varying vec3 vCol; varying float vA, vSpike, vPx;
      void main() {
        float kind = aK.x; vec3 p; float r = 0.;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float tw = .75 + .25 * sin(uTime * (.7 + fract(aC.w) * 1.6) + aC.w * 6.28);
        vec3 ink = uInkArm; float inkA = .5;
        if (kind > 3.5) { p = position; r = 0.; vCol = aC.rgb; vA = tw; inkA = 0.; }
        else if (kind > .5 && kind < 1.5 || kind > 2.5) {
          // Slide along the arm: a log spiral turned by d(theta) is the same spiral scaled.
          float span = uLmax - uLmin;
          float l = uLmin + mod(position.x - uLmin - uTime * .006, span);
          r = uRc * exp(l) * (1. + aK.w);
          float th = position.y + position.z * aK.y * taperR(r) + l * uWind;
          p = vec3(cos(th) * r, aK.z, sin(th) * r);
          float k = smoothstep(uLmin, uLmin + span * .08, l) * smoothstep(uLmax, uLmax - span * .25, l);
          float t = smoothstep(uRc * .4, uR * .9, r);
          vCol = kind > 2.5 ? uPink * aC.rgb : mix(uWarm, uBlue, t) * aC.rgb;
          vA = k * tw * (kind > 2.5 ? .85 : 1.);
          ink = kind > 2.5 ? uInkKnot : mix(uInkCore, uInkArm, t);
          inkA = kind > 2.5 ? .8 : .85;
        } else {
          // Bulge and disk: differential rotation (flat rotation curve, faster inside).
          r = position.x;
          float th = position.y + uTime * .05 * uRc / (r + uRc * .6);
          p = vec3(cos(th) * r, position.z, sin(th) * r);
          float t = smoothstep(uRc * .5, uR, r);
          vCol = (kind < .5 ? uWarm : mix(uWarm, uBlue, t * .7)) * aC.rgb;
          vA = tw;
          ink = kind < .5 ? uInkCore : mix(uInkCore, uInkArm, t);
          inkA = kind < .5 ? .45 : .55;
        }
        if (kind < 3.5) vA *= smoothstep(birthAt(r), birthAt(r) + 4., yr) * uGain;
        vSpike = step(2.4, aS) * step(kind, 1.5) * step(.5, kind) * (1. - uInk);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float px = kind > 3.5 ? aS * uPR : aS * uSz * uPR * 900. / -mv.z;
        // Zoomed in, glows stop growing and quieten, so they do not pile up into a white haze.
        float near = smoothstep(.3, .95, length(cameraPosition) / uViewD);
        if (kind < 3.5 && uInk < .5) { px = min(px, mix(7., 40., near) * uPR); vA *= mix(.5, 1., near); }
        if (uInk > .5) {
          // Ink dots, crisp like an atlas's magnitude scale: brighter stars print larger, up to a cap.
          px = min(px * .66, 7.5 * uPR);
          vCol = ink * .3;
          vA = clamp(vA, 0., 1.) * inkA * uInkK * (.55 + .45 * min(aC.r, 1.)) * (1. - uFocus * .5);
        }
        gl_PointSize = clamp(px, 1., 40.);
        vPx = gl_PointSize;
        vA *= min(1., px * px);
        gl_Position = projectionMatrix * mv;
        if (vA < .002) gl_Position = vec4(0., 0., 2., 1.);
      }`,
    fragmentShader: /* glsl */ `
      ${TONE}
      uniform float uFocus; varying vec3 vCol; varying float vA, vSpike, vPx;
      void main() {
        vec2 q = gl_PointCoord - .5; float d = length(q); if (d > .5) discard;
        if (uInk > .5) { float a = clamp((.5 - d) * vPx + .5, 0., 1.) * vA; if (a < .003) discard; gl_FragColor = inkOut(vCol, a); return; }
        float a = exp(-d * d * 28.) + exp(-d * 9.) * .25;
        a += vSpike * (exp(-abs(q.x) * 70.) * exp(-abs(q.y) * 7.) + exp(-abs(q.y) * 70.) * exp(-abs(q.x) * 7.)) * .6;
        a *= vA * (1. - uFocus * .5) * smoothstep(.5, .35, d);
        gl_FragColor = vec4(vCol * a, 1.); }`,
  });
  setInk(mat, false, true);
  return { mat, uni };
}

/**
 * Unresolved galaxy light on a disk plane: warm bulge, exponential disk, arms with dust lanes on their
 * inner edge and nebulae just downstream, plus the chart grid (generation rings, spokes and a graduated
 * rim). Dark: premultiplied light whose alpha is the dust that darkens what lies behind. Light: a graphite
 * wash that multiplies the paper, dust lanes left as paper.
 */
export function hazeMat(U: Shared, S: SpiralUniforms, T: Tone, I: GalaxyInks, arms: Vector4[], rings: number[]) {
  const uni = {
    ...U,
    ...S,
    ...T,
    ...I,
    uFocus: { value: 0 },
    uArms: { value: arms },
    uNA: { value: arms.length },
    uRings: { value: rings },
    uNR: { value: rings.length },
    uGrid: { value: 0 },
    uGridC: { value: lin('#000000') },
    uGridR: { value: 1 },
  };
  while (uni.uArms.value.length < MAX_ARMS) uni.uArms.value.push(new Vector4());
  while (uni.uRings.value.length < MAX_GENS) uni.uRings.value.push(-1);
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      ${SPIRAL}
      ${NOISE}
      ${TONE}
      uniform float uTime, uYear, uEnter, uMinYear, uFocus, uGain, uGrid, uGridR, uViewD, uRings[${MAX_GENS}]; uniform vec4 uArms[${MAX_ARMS}];
      uniform int uNA, uNR; uniform vec3 uCore, uWarm, uBlue, uPink, uInkCore, uInkArm, uInkKnot, uGridC;
      varying vec2 vP;
      float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += noise(p) * a; p = p * 2.03 + 17.1; a *= .5; } return s; }
      float hair(float x, float w) { float f = fwidth(x) * w; return 1. - smoothstep(f * .5, f * 1.5, abs(x)); }
      void main() {
        vec2 p = vec2(vP.x, -vP.y); float r = length(p);
        // Nothing is drawn beyond the faded edge of the disk (the plane's corners).
        if (r > uR * 1.3) discard;
        float th = r > 1e-5 ? atan(p.y, p.x) : 0.;
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(birthAt(r), birthAt(r) + 6., yr);
        // Clumps drift with differential rotation inside the fixed arm envelope.
        float rot = uTime * .05 * uRc / (r + uRc * .6);
        vec2 q = vec2(cos(th - rot), sin(th - rot)) * r;
        float n1 = fbm(q * .16), n2 = fbm(q * .45 + 3.), n3 = fbm(q * .9 - 7.);
        float lw = log(max(r, .01) / uRc) * uWind;
        float arm = 0., dust = 0., hii = 0.;
        for (int i = 0; i < ${MAX_ARMS}; i++) {
          if (i >= uNA) break;
          vec4 A = uArms[i];
          float d = th - (A.x + lw); d = mod(d + 3.14159, 6.28318) - 3.14159;
          float hw = max(A.y * taperR(r) * .5, .04) + 1.2 / max(r, 1.);
          float u = d / hw;
          if (abs(u) > 3.6) continue; // too far from this arm to see any of it
          arm += exp(-u * u * 1.6) * A.z;
          // The dust lane hugs the arm's inner edge, clear of the band where the people sit.
          float du = (u - 1.08) * 3.2, hu = (u + .25) * 2.2;
          dust += exp(-du * du) * A.z;
          hii += exp(-hu * hu) * A.z;
        }
        float inner = smoothstep(uRc * .45, uRc * 1.4, r), outer = 1. - smoothstep(uR * .75, uR * 1.25, r);
        float bulge = exp(-pow(r / (uRc * .32), 1.1));
        float disk = exp(-r / (uR * .35)) * outer;
        float a = arm * inner * outer;
        float knots = smoothstep(.58, .78, n3) * hii * inner * outer;
        float lane = clamp(dust * inner * outer * smoothstep(.35, .75, n2 + n1 * .5), 0., 1.);
        float edge = 1. - smoothstep(uR * 1.05, uR * 1.3, r);
        // The chart grid: a ring per generation, spokes every 30 degrees, a graduated rim.
        float grid = 0.;
        for (int i = 0; i < ${MAX_GENS}; i++) { if (i >= uNR) break; grid = max(grid, hair(r - uRings[i], 1.) * .55); }
        float spoke = hair(sin((th) * 6.) * r, 1.) * step(uRc * .9, r) * step(r, uGridR);
        float rim = max(hair(r - uGridR, 1.2), hair(r - uGridR * 1.025, 1.));
        float tick = step(uGridR, r) * step(r, uGridR * 1.025) * hair(sin(th * 36.) * r, 1.);
        tick = max(tick, step(uGridR, r) * step(r, uGridR * 1.012) * hair(sin(th * 180.) * r, .8) * .7);
        grid = max(max(grid, spoke * .45), max(rim, tick)) * uGrid;
        if (uInk > .5) {
          // Graphite wash: denser along the arms and in the bulge; the dust lanes are left as paper.
          float wash = pow(max(a, 0.), .85) * (.72 + .28 * n2) * (1. - lane * .85) * .86 + bulge * .6 + disk * .06;
          wash = clamp(wash * grow * uGain * (1. - uFocus * .45) * edge, 0., .88);
          vec3 ic = mix(uInkCore, uInkArm, smoothstep(uRc * .45, uR * .6, r));
          vec3 c = mix(paper(), ic, wash);
          c = mix(c, uInkKnot, clamp(knots * .35 * grow * edge, 0., 1.));
          c = mix(c, uGridC, clamp(grid, 0., 1.));
          gl_FragColor = vec4(untone(c), 1.);
          return;
        }
        vec3 armC = mix(uWarm, uBlue, smoothstep(uRc, uR * .8, r));
        vec3 col = uCore * bulge * .5 + uWarm * disk * .1 + armC * a * (.3 + .4 * n1) * (.55 + .8 * n2);
        col += uPink * knots * .22;
        col *= 1. - lane * .85;
        col *= grow * uGain * (1. - uFocus * .45) * mix(.3, 1., smoothstep(.3, .95, length(cameraPosition) / uViewD));
        float alpha = lane * .55 * grow * outer;
        col += uGridC * grid * (1. - uFocus * .5);
        gl_FragColor = vec4(col * edge, alpha * edge); }`,
  });
  const setLight = (light: boolean) => {
    if (light) setInk(mat, true);
    else {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = CustomBlending;
      mat.blendEquation = AddEquation;
      mat.blendSrc = OneFactor;
      mat.blendDst = OneMinusSrcAlphaFactor;
    }
  };
  setLight(false);
  return { mat, uni, setLight };
}
