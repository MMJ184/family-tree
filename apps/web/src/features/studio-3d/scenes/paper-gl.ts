import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix3,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { rng } from '../palette.ts';

// Paper Pop-up materials: cut-paper generation cards, paper rosette tags, folded paper strips and
// gold-foil spouse links, the open book (pages, cover, page block), the table it lies on and the
// dust drifting through the lamp light. Every surface is shaded in display space and then passed
// through the inverse of the renderer's ACES curve, so the colours in paper.ts's LOOK are the
// colours on screen and paper shadows stay visible on white pages (ACES would flatten them).

// three.js ACESFilmicToneMapping matrices (row-major here; the shader writes them as columns).
const ACES_IN = new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const ACES_OUT = new Matrix3().set(
  1.60475,
  -0.53108,
  -0.07367,
  -0.10208,
  1.10813,
  -0.00605,
  -0.00327,
  -0.07276,
  1.07602,
);

/** Uniforms shared by every paper material: one object, so tint() restyles the whole book at once. */
export function paperLook(U: Shared) {
  return {
    uTime: U.uTime,
    uExp: { value: 1 },
    uInvIn: { value: ACES_IN.clone().invert() },
    uInvOut: { value: ACES_OUT.clone().invert() },
    uLampPos: { value: new Vector3(0, 100, 0) },
    uLampAxis: { value: new Vector3(0, -1, 0) },
    uLampCone: { value: new Vector2(0.4, 0.9) },
    uLampR: { value: 100 },
    uLampK: { value: 0 },
    uLampCol: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunK: { value: 0 },
    uSky: { value: new Color() },
    uGnd: { value: new Color() },
    uDapple: { value: 0 },
    uInk: { value: new Color() },
    uTeal: { value: new Color() },
    uGold: { value: new Color() },
    uDimC: { value: new Color() },
    uDimK: { value: 0.6 },
    uGlowK: { value: 0 },
    uFocus: { value: 0 },
  };
}
export type PaperLook = ReturnType<typeof paperLook>;

/** Display colour (linear sRGB, 0..1) to the scene value the ACES output pass turns back into it. */
const TONE = /* glsl */ `
  uniform float uExp; uniform mat3 uInvIn, uInvOut;
  vec3 toScene(vec3 c) {
    vec3 t = clamp(uInvOut * clamp(c, 0., 1.), 0., .984);
    vec3 A = 1. - .983729 * t, B = .0245786 - .432951 * t, C = -.000090537 - .238081 * t;
    vec3 v = (sqrt(B * B - 4. * A * C) - B) / (2. * A);
    return max(uInvIn * v, 0.) * .6 / uExp;
  }`;

/** Paper stock on a 2D paper coordinate (world units): fibres, a fine tooth and laid lines close up. */
const PAPER = /* glsl */ `
  float paperTex(vec2 p) {
    float fw = length(fwidth(p));
    float f = noise(vec2(p.x * 1.3 + p.y * .35, p.y * 8.)) * .45 + noise(vec2(p.x * 7., p.y * 1.4 - p.x * .25)) * .3;
    float near = 1. - smoothstep(.035, .11, fw);
    float tooth = (noise(p * 31.) * .17 + hash(floor(p * 83.)) * .08) * near + .12 * (1. - near);
    float laid = (.5 + .5 * sin(p.y * 40.)) * (1. - smoothstep(.015, .05, fw));
    return f + tooth + laid * .07;
  }`;

/** Lamp pool (a warm spot), daylight sun with a slow leaf dapple, and hemisphere ambient: display-space light. */
const LIGHT = /* glsl */ `
  uniform vec3 uLampPos, uLampAxis, uLampCol, uSunDir, uSky, uGnd; uniform vec2 uLampCone;
  uniform float uLampR, uLampK, uSunK, uDapple, uTime;
  vec3 lightK(vec3 p, vec3 n, float wrap, float dapK) {
    vec3 d = uLampPos - p; float dist = length(d); vec3 l = d / dist;
    float spot = smoothstep(uLampCone.x, uLampCone.y, dot(-l, uLampAxis));
    float att = 1. / (1. + dist * dist / (uLampR * uLampR));
    vec3 c = uLampCol * (uLampK * spot * att * clamp((dot(n, l) + wrap) / (1. + wrap), 0., 1.));
    float sd = clamp((dot(n, uSunDir) + wrap) / (1. + wrap), 0., 1.);
    float dap = 1.;
    if (dapK > 0.) {
      vec2 q = p.xz - uSunDir.xz / max(uSunDir.y, .2) * p.y;
      float k = noise(q * .03 + vec2(uTime * .011, uTime * .006)) * .62 + noise(q * .085 - vec2(uTime * .008, -uTime * .012)) * .38;
      dap = 1. - dapK * smoothstep(.45, .72, k);
    }
    return c + uSunK * sd * dap + mix(uGnd, uSky, n.y * .5 + .5);
  }
  vec3 lightAt(vec3 p, vec3 n, float wrap) { return lightK(p, n, wrap, uDapple); }`;

/** Pointed (ogee-like) arch row: 0 at the cusps between arches, ~1 at each peak; eight-point star distance. */
const ARCH = /* glsl */ `
  float arch(float u, float P) { float x = abs(2. * fract(u / P) - 1.); return sqrt(max(0., 1. - pow((x + .35) / 1.35, 2.))); }
  float star8(vec2 q) { q = abs(q); return min(max(q.x, q.y), (q.x + q.y) * .7071); }`;

/** Fold progress of one layer: flat on the page before its generation is born, upright after. */
const FOLD = /* glsl */ `float foldK(float born, float yr) { return smoothstep(born - 6., born - .3, yr); }`;

const HEAD = `${NOISE}${PAPER}${LIGHT}${TONE}`;

export interface LayerData {
  R: number[];
  H: number[];
  born: number[];
}

/**
 * All generation cards in one mesh; per-layer radius, height, birth and paper colour live in uniform arrays.
 * The cut edges (arch row, star windows, jaali band) are anti-aliased with coverage, so the mesh is drawn
 * as a transparent pass in build order (the back card first).
 */
export function cardMaterial(U: Shared, look: PaperLook, L: LayerData, arch: { A: number; P: number }) {
  const n = L.R.length;
  const uni = {
    ...U,
    ...look,
    uR: { value: L.R },
    uH: { value: L.H },
    uBorn: { value: L.born },
    uCol: { value: L.R.map(() => new Color()) },
    uA: { value: arch.A },
    uP: { value: arch.P },
    uShadowK: { value: 0.5 },
    uShadowW: { value: 1.5 },
    uEdgeK: { value: 0.1 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    transparent: true,
    uniforms: uni,
    defines: { NL: n },
    vertexShader: /* glsl */ `
      attribute float aL, aTh, aV;
      uniform float uR[NL], uH[NL], uBorn[NL]; uniform vec3 uCol[NL];
      uniform float uYear, uEnter, uMinYear, uA, uP;
      varying float vU, vV, vTop, vFU, vFTop, vFK, vL, vPh, vFPh; varying vec3 vN, vW, vCol;
      ${FOLD}
      void main() {
        int l = int(aL + .5);
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float k = foldK(uBorn[l], yr), ph = (1. - k) * 1.5708;
        vec3 o = vec3(sin(aTh), 0., cos(aTh));
        float h = aV * (uH[l] + uA + .1);
        // Falls toward the viewer about its base line; lifted a hair per layer so flat cards never z-fight.
        vec3 p = o * uR[l] + vec3(0., h * cos(ph) + (1. - k) * (.03 + .03 * aL), 0.) + o * h * sin(ph);
        vN = o * cos(ph) - vec3(0., 1., 0.) * sin(ph);
        vU = uR[l] * aTh; vV = h; vTop = uH[l]; vL = aL; vCol = uCol[l];
        vPh = aL * .37 * uP;
        vFK = 0.; vFU = 0.; vFTop = 0.; vFPh = 0.;
        if (l + 1 < NL) { vFU = uR[l + 1] * aTh; vFTop = uH[l + 1]; vFK = foldK(uBorn[l + 1], yr); vFPh = (aL + 1.) * .37 * uP; }
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uA, uP, uShadowK, uShadowW, uEdgeK, uFocus, uDimK, uGlowK; uniform vec3 uInk, uDimC;
      varying float vU, vV, vTop, vFU, vFTop, vFK, vL, vPh, vFPh; varying vec3 vN, vW, vCol;
      ${HEAD}
      ${ARCH}
      void main() {
        float u = vU + vPh;
        float prof = vTop + uA * arch(u, uP);
        float e = prof - vV;
        float fe = max(fwidth(vV), 1e-4);
        float cov = smoothstep(-fe, fe, e);
        // Cut-outs: an eight-point star window in every arch and a jaali band of diamonds under the arches.
        // Holes smaller than a couple of pixels turn into a printed tone instead of shimmering. Every
        // derivative (here and in paperTex) is taken before the first discard.
        float f = fract(u / uP) - .5;
        float st = star8(vec2(f * uP, vV - vTop - uA * .42));
        float sr = uA * .19, fs = max(fwidth(st), 1e-4);
        float big = smoothstep(.6, 1.6, sr / fs);
        float hole = (1. - smoothstep(sr - fs, sr + fs, st)) * big;
        float cell = uP * .25, cy = vTop - .62;
        float dj = abs(fract(u / cell) - .5) + abs(vV - cy) / cell;
        float fj = max(fwidth(dj), 1e-4), bigJ = smoothstep(.7, 1.8, .26 / fj);
        hole = max(hole, (1. - smoothstep(.26 - fj, .26 + fj, dj)) * bigJ);
        float tone = (1. - bigJ) * smoothstep(cell * .55, cell * .35, abs(vV - cy)) * .12;
        float tex = paperTex(vec2(vU, vV));
        cov *= 1. - hole;
        if (cov < .003) discard;
        vec3 n = normalize(vN);
        vec3 base = vCol;
        if (!gl_FrontFacing) { n = -n; base *= .9; }
        base *= .92 + .13 * tex;
        vec3 col = base * lightAt(vW, n, .45);
        // Cut edges catch the light (paper thickness); an inked rule follows the arch line; the fold crease at the foot.
        float rim = min(e, min(abs(st - sr), abs(dj - .26) * cell));
        col *= 1. + uEdgeK * smoothstep(fe * 2.5, 0., rim) - tone;
        col = mix(col, col * uInk * 1.6, .55 * smoothstep(fe * 1.4, 0., abs(e - .42)) * step(.0, vV - vTop + .2));
        col *= 1. - .22 * smoothstep(.16, .0, abs(vV - .14));
        // Shadow of the card in front (it follows that card's arches), and ambient occlusion near the page.
        float fprof = vFTop + uA * arch(vFU + vFPh, uP);
        float d = vV - fprof;
        float sh = vFK * step(-3., d) * (1. - smoothstep(0., uShadowW, d)) + vFK * .35 * (1. - smoothstep(0., uShadowW * 3.5, d)) * step(0., d);
        col *= 1. - uShadowK * clamp(sh, 0., 1.);
        col *= mix(.68, 1., smoothstep(0., 2.6, vV));
        if (uFocus > .5) col = mix(col, uDimC, uDimK * .45);
        gl_FragColor = vec4(toScene(col), cov);
      }`,
  });
  return { mat, uni };
}

/** Paper rosette tags behind every portrait (instanced quads facing out from the stage), with a soft drop shadow. */
export function rosetteMaterial(U: Shared, look: PaperLook) {
  const uni = {
    ...U,
    ...look,
    uPaper: { value: new Color() },
    uDead: { value: new Color() },
    uShadowA: { value: 0.3 },
    uShadowOff: { value: new Vector2(0.1, -0.16) },
    /** Dimmed (outside the lineage): how far the paper darkens, and how much of it stays opaque. */
    uTagDimK: { value: 0.66 },
    uTagDimA: { value: 1 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute float aTh, aSize, aBirth, aDeath, aHi;
      uniform float uYear, uEnter, uMinYear;
      varying vec2 vQ; varying vec3 vLight; varying float vDead, vHi, vA, vSeed;
      ${NOISE}
      ${LIGHT}
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float app = smoothstep(aBirth - .2, aBirth + .9, yr);
        vA = app; vDead = step(aDeath, yr); vHi = aHi; vQ = position.xy * 2.8; vSeed = fract(aBirth * .137) * 9.;
        vec3 o = vec3(sin(aTh), 0., cos(aTh));
        vLight = lightAt(aPos, o, .45);
        vec3 right = vec3(cos(aTh), 0., -sin(aTh));
        // Unfolds upward like a pop-up tab.
        vec3 p = aPos + (right * position.x + vec3(0., 1., 0.) * position.y * app) * aSize * 2.8;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper, uDead, uInk, uTeal, uDimC; uniform float uShadowA, uFocus, uTagDimK, uTagDimA, uGlowK; uniform vec2 uShadowOff;
      varying vec2 vQ; varying vec3 vLight; varying float vDead, vHi, vA, vSeed;
      ${NOISE}
      ${PAPER}
      ${TONE}
      void main() {
        float r = length(vQ), an = atan(vQ.y, vQ.x + 1e-5);
        float re = .93 + .07 * cos(an * 16.);
        float fw = max(fwidth(r), 1e-4);
        float tex = paperTex(vQ * 3. + vSeed);
        if (vA < .01) discard;
        bool dim = uFocus > .5 && vHi < .5;
        float cov = 1. - smoothstep(re - fw, re + fw, r);
        vec2 s = vQ - uShadowOff; float rs = length(s), as = atan(s.y, s.x + 1e-5);
        float sh = (1. - smoothstep(.8 + .07 * cos(as * 16.), 1.2, rs)) * uShadowA * (dim ? .5 : 1.);
        // White stock (greyer once the person has died), a raised inner disc and a stitched ring:
        // ink normally, teal on the selected lineage. The bevel is lit from the side the shadow falls away from.
        vec3 paper = mix(uPaper, uDead, vDead);
        vec3 c = paper * (.93 + .1 * tex);
        vec2 ld = normalize(vec2(-.6 * sign(uShadowOff.x), .8));
        float lit = dot(r > 0. ? vQ / r : vec2(0.), ld);
        c *= 1. + .1 * lit * smoothstep(.06, 0., abs(r - .62)) - .16 * smoothstep(.05, 0., abs(r - .645)) * step(.62, r);
        c *= 1. + .08 * lit * smoothstep(.08, 0., re - r);
        float stitch = step(.5, fract(an / 6.2832 * 44.)) * smoothstep(.025, .01, abs(r - .84));
        vec3 thread = vHi > .5 ? uTeal : uInk;
        c = mix(c, thread, stitch * (vHi > .5 ? 1. : .7));
        c *= vLight;
        if (vHi > .5) c += uTeal * uGlowK * .12 * smoothstep(.3, .9, r);
        if (dim) c = mix(c, uDimC, uTagDimK);
        // Paper over its own (black) shadow: straight alpha, so blending scales the colour by coverage once.
        float a = cov + sh * (1. - cov);
        vec3 rgb = a > 0. ? toScene(c) * cov / a : vec3(0.);
        a *= vA * (dim ? uTagDimA : 1.);
        if (a < .004) discard;
        gl_FragColor = vec4(rgb, a);
      }`,
  });
  return { mat, uni };
}

/**
 * Accordion-folded paper strips from each parent's tag over the next card to the child's tag (kind 0),
 * and flat gold-foil links between spouses (kind 1).
 */
export function ribbonMaterial(U: Shared, look: PaperLook) {
  const uni = { ...U, ...look, uRib: { value: new Color() } };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aT, aBirth, aHi, aF, aK;
      varying float vT, vBirth, vHi, vF, vK; varying vec3 vN, vW;
      void main() { vT = aT; vBirth = aBirth; vHi = aHi; vF = aF; vK = aK; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uFocus, uDimK, uGlowK; uniform vec3 uRib, uTeal, uGold, uDimC;
      varying float vT, vBirth, vHi, vF, vK; varying vec3 vN, vW;
      ${HEAD}
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        // Derivatives (inside paperTex) only in uniform control flow: read before the discard and the branch.
        float tex = paperTex(vW.xz * 2. + vW.y);
        float g = clamp((yr - vBirth + .4) / 1.6, 0., 1.); if (vT > g) discard;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        bool hi = vHi > .5;
        vec3 L = lightAt(vW, n, .35);
        vec3 col;
        if (vK < .5) {
          vec3 base = hi ? uTeal : uRib;
          base *= .9 + .14 * tex;
          col = base * L * (.8 + .3 * vF);
          float flow = smoothstep(.9, 1., fract(vT * 2.5 - uTime * .3 + vBirth * .37));
          if (hi) col += uTeal * uGlowK * (.15 + .5 * flow);
        } else {
          // Gold foil: a little diffuse and a sharp glint that slides as the camera moves.
          vec3 V = normalize(cameraPosition - vW);
          vec3 Ldir = normalize(normalize(uLampPos - vW) * uLampK + uSunDir * uSunK + vec3(0., .01, 0.));
          float spec = pow(max(dot(n, normalize(Ldir + V)), 0.), 24.);
          col = uGold * (L * .75 + spec * 1.1) * (.9 + .16 * noise(vW.xy * 9.));
        }
        if (uFocus > .5 && !hi) col = mix(col, uDimC, uDimK);
        gl_FragColor = vec4(toScene(col), 1.);
      }`,
  });
  return { mat, uni };
}

/**
 * A page of the open book. FLOOR: the page the cards stand on, with each card's glue tab and contact shadow.
 * Otherwise the upright back page. Both carry a printed border of ink rules and eight-point stars.
 */
export function pageMaterial(
  U: Shared,
  look: PaperLook,
  L: LayerData,
  cols: Color[],
  rect: [number, number, number, number],
  half: number,
  floor: boolean,
) {
  const n = L.R.length;
  const uni = {
    ...U,
    ...look,
    uR: { value: L.R },
    uBorn: { value: L.born },
    uCol: { value: cols },
    uPage: { value: new Color() },
    uRect: { value: rect },
    uHalf: { value: half },
    uShadowK: { value: 0.4 },
    uCast: { value: 2.6 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    defines: floor ? { NL: n, FLOOR: 1 } : { NL: n },
    vertexShader: /* glsl */ `varying vec2 vP; varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      #ifdef FLOOR
      vP = w.xz;
      #else
      vP = w.xy;
      #endif
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uR[NL], uBorn[NL]; uniform vec3 uCol[NL];
      uniform float uYear, uEnter, uMinYear, uShadowK, uCast, uRect[4], uHalf; uniform vec3 uPage, uInk;
      varying vec2 vP; varying vec3 vW;
      ${HEAD}
      ${ARCH}
      ${FOLD}
      void main() {
        vec3 base = uPage * (.93 + .1 * paperTex(vP * .9));
        float dx = min(vP.x - uRect[0], uRect[2] - vP.x), dy = min(vP.y - uRect[1], uRect[3] - vP.y);
        float d = min(dx, dy);
        float yr = mix(uMinYear - 3., uYear, uEnter);
      #ifdef FLOOR
        vec3 nrm = vec3(0., 1., 0.);
        float r = length(vP), th = atan(vP.x, vP.y), sh = 0.;
        float inArc = smoothstep(uHalf + .02, uHalf - .01, abs(th));
        float fr = max(fwidth(r), 1e-4);
        float tabTex = .95 + .08 * paperTex(vec2(th * r, r * 3.));
        for (int l = 0; l < NL; l++) {
          float k = foldK(uBorn[l], yr);
          float ds = r - uR[l];
          sh += k * inArc * (ds < 0. ? exp(ds / uCast) * .8 : exp(-ds / .5) * .55);
          // The card's glue tab: its own paper folded flat in front of its foot, with a crease and a cut edge.
          float tab = k * inArc * step(0., ds) * (1. - smoothstep(.7 - fr, .7 + fr, ds));
          base = mix(base, uCol[l] * tabTex, tab);
          sh += k * inArc * .5 * smoothstep(fr * 2., 0., abs(ds - .7)) * step(0., ds);
        }
        base *= 1. - uShadowK * min(sh, 1.15);
        base *= mix(.72, 1., smoothstep(0., 7., vP.y - uRect[1]));
      #else
        vec3 nrm = vec3(0., 0., 1.);
        base *= mix(.7, 1., smoothstep(0., 6., vP.y - uRect[1]));
      #endif
        vec3 col = base * lightAt(vW, nrm, .3);
        // Printed border: two ink rules with a frieze of eight-point stars between them.
        float b = d - 3.2;
        float fb = max(fwidth(b), 1e-4);
        float rules = smoothstep(fb * 1.4, 0., abs(abs(b) - 1.1) - .03);
        vec2 q = vec2(mod(dx < dy ? vP.y : vP.x, 2.4) - 1.2, b);
        float st = smoothstep(fb * 1.4, 0., abs(star8(q) - .6) - .02) + smoothstep(fb * 1.4, 0., abs(star8(q) - .27) - .02);
        col = mix(col, col * uInk * 1.5, clamp(rules + st * step(abs(b), .9), 0., 1.) * .7);
        col *= mix(.8, 1., smoothstep(0., .9, d));
        gl_FragColor = vec4(toScene(col), 1.);
      }`,
  });
  return { mat, uni };
}

/** Cover boards (grained leather with a blind-tooled fillet; kind 0) and the page block edges (fine stripes
 * parallel to the pages: kind 1 for the block lying flat, kind 2 for the upright one). */
export function bookMaterial(U: Shared, look: PaperLook, rect: [number, number, number, number]) {
  const uni = { ...U, ...look, uCover: { value: new Color() }, uEdge: { value: new Color() }, uRect: { value: rect } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aKind; varying float vK; varying vec3 vN, vW;
      void main() { vK = aKind; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uCover, uEdge, uInk; uniform float uRect[4]; varying float vK; varying vec3 vN, vW;
      ${HEAD}
      void main() { vec3 n = normalize(vN);
        // Distance to the board's edge, for the blind-tooled fillet (derivative taken outside the branch).
        float dx = min(vW.x - uRect[0], uRect[2] - vW.x), dz = min(vW.z - uRect[1], uRect[3] - vW.z);
        float fd = min(dx, dz), ff = max(fwidth(fd), 1e-4);
        float stack = (vK > 1.5 ? vW.z : vW.y) * 8.7;
        float fs = fwidth(stack);
        vec3 c;
        if (vK < .5) {
          vec2 g = vW.xz * 2.2 + vW.y * 1.7;
          float grain = noise(g * 3.) * .5 + noise(g * 9.) * .3 + noise(g * .7) * .2;
          c = uCover * (.82 + .3 * grain);
          c *= 1. - .3 * smoothstep(ff * 1.5, 0., abs(fd - .55)) * step(.5, n.y);
        } else {
          float side = vK > 1.5 ? 1. - abs(n.z) : 1. - abs(n.y);
          float lines = .86 + .14 * cos(stack * 6.2832) * (1. - smoothstep(.25, .5, fs));
          c = uEdge * mix(1., lines, side);
        }
        gl_FragColor = vec4(toScene(c * lightAt(vW, n, .4)), 1.); }`,
  });
  return { mat, uni };
}

/**
 * The table under the book: a lamp pool in the dark theme, soft daylight in the light one, with the book's
 * own shadow, fading into the backdrop colour away from the book.
 */
export function tableMaterial(U: Shared, look: PaperLook, book: [number, number, number, number]) {
  const uni = {
    ...U,
    ...look,
    uTable: { value: new Color() },
    uFar: { value: new Color() },
    uBook: { value: book },
    uShadowK: { value: 0.5 },
    uFade: { value: new Vector2(60, 220) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uTable, uFar; uniform float uBook[4], uShadowK; uniform vec2 uFade; varying vec3 vW;
      ${HEAD}
      void main() {
        vec2 c = vec2((uBook[0] + uBook[2]) * .5, (uBook[1] + uBook[3]) * .5), hs = vec2(uBook[2] - uBook[0], uBook[3] - uBook[1]) * .5;
        vec2 o = vW.xz - c + vec2(uSunDir.x, uSunDir.z) * 1.2 * step(.001, uSunK);
        vec2 q = abs(o) - hs;
        float sd = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
        float sh = sd < 0. ? 1. : exp(-sd / 2.2) * .8 + exp(-sd / 9.) * .2;
        vec3 col = uTable * lightK(vW, vec3(0., 1., 0.), 0., 0.);
        col *= 1. - uShadowK * sh;
        float far = smoothstep(uFade.x, uFade.y, length(vW.xz - c));
        gl_FragColor = vec4(toScene(mix(col, uFar, far)), 1.);
      }`,
  });
  return { mat, uni };
}

/** Backdrop dome: one flat display colour (black, or the light theme's pale grey). */
export function backdropMaterial(look: PaperLook) {
  const uni = { uExp: look.uExp, uInvIn: look.uInvIn, uInvOut: look.uInvOut, uFar: { value: new Color() } };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform vec3 uFar; ${TONE} void main() { gl_FragColor = vec4(toScene(uFar), 1.); }`,
  });
  return { mat, uni };
}

/** Dust drifting through the lamp light: lit only inside the cone, one draw for all of it. */
export function dustPoints(
  U: Shared,
  look: PaperLook,
  box: { x: number; y0: number; y1: number; z0: number; z1: number },
  count: number,
) {
  const r = rng(71);
  const pos = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() * 2 - 1) * box.x;
    pos[i * 3 + 1] = box.y0 + r() * (box.y1 - box.y0);
    pos[i * 3 + 2] = box.z0 + r() * (box.z1 - box.z0);
    ph[i] = r();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPh', new Float32BufferAttribute(ph, 1));
  const uni = { ...U, ...look, uPx: { value: 400 }, uDustK: { value: 0 } };
  const pts = new Points(
    geo,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: uni,
      vertexShader: /* glsl */ `
        attribute float aPh; uniform float uTime, uPx, uDustK, uLampK, uLampR; uniform vec3 uLampPos, uLampAxis, uLampCol; uniform vec2 uLampCone;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (.05 + .05 * fract(aPh * 7.));
          p += vec3(sin(t * 2.1 + aPh * 40.) * 2.4, sin(t * 1.3 + aPh * 17.) * 1.6 - fract(uTime * .004 + aPh) * 3., cos(t * 1.7 + aPh * 29.) * 2.4);
          vec3 d = p - uLampPos;
          float spot = smoothstep(uLampCone.x, uLampCone.y, dot(normalize(d), uLampAxis));
          // Motes glint as they turn in the beam.
          float tw = .35 + .65 * pow(.5 + .5 * sin(uTime * (.6 + fract(aPh * 13.)) + aPh * 60.), 3.);
          vA = uDustK * uLampK * spot * tw / (1. + dot(d, d) / (uLampR * uLampR));
          vec4 mv = viewMatrix * vec4(p, 1.);
          gl_PointSize = vA < .002 ? 0. : clamp((.1 + .1 * fract(aPh * 3.)) * uPx / max(-mv.z, .1), 1., 6.);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uLampCol; varying float vA;
        void main() { vec2 q = gl_PointCoord - .5; float d = dot(q, q) * 4.; if (d > 1.) discard;
          gl_FragColor = vec4(uLampCol * vA * (1. - d) * (1. - d), 1.); }`,
    }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  const v = new Vector2();
  // World-unit point sizes need the drawing buffer height and the projection scale.
  pts.onBeforeRender = (rd, _s, cam) => {
    rd.getDrawingBufferSize(v);
    uni.uPx.value = (v.y * (cam as PerspectiveCamera).projectionMatrix.elements[5]) / 2;
  };
  return { pts, uni };
}
