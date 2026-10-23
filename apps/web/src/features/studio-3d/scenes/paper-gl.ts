import { BackSide, type Color, DoubleSide, ShaderMaterial } from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Paper Pop-up materials: cut-paper stage cards, paper rosette tags, folded ribbons,
// the book page they stand on and the lamplit backdrop. Paper fibre is procedural.

/** Paper fibre and grain on a 2D paper coordinate (world units). */
const FIBRE = /* glsl */ `
  ${NOISE}
  float fibre(vec2 p) {
    float a = noise(vec2(p.x * 1.1 + p.y * .3, p.y * 7.5)) * .45 + noise(vec2(p.x * 6.5, p.y * 1.3 - p.x * .2)) * .3;
    float g = noise(p * 26.) * .17 + hash(floor(p * 70.)) * .08;
    return a + g;
  }`;

/** Pointed (ogee-like) arch row: 0 at the cusps between arches, ~1 at each peak. */
const ARCH = /* glsl */ `
  float arch(float u, float P) { float x = abs(2. * fract(u / P) - 1.); return sqrt(max(0., 1. - pow((x + .35) / 1.35, 2.))); }
  float star8(vec2 q) { q = abs(q); return min(max(q.x, q.y), (q.x + q.y) * .7071); }`;

/** Fold progress of one layer: flat on the page before its generation is born, upright after. */
const FOLD = /* glsl */ `float foldK(float born, float yr) { return smoothstep(born - 6., born - .3, yr); }`;

export interface LayerData {
  R: number[];
  H: number[];
  born: number[];
}

/** All generation cards in one mesh; per-layer radius, height, birth, colour and glow live in uniform arrays. */
export function cardMaterial(U: Shared, L: LayerData, arch: { A: number; P: number }) {
  const n = L.R.length;
  const uni = {
    ...U,
    uR: { value: L.R },
    uH: { value: L.H },
    uBorn: { value: L.born },
    uCol: { value: L.R.map(() => lin('#ffffff')) as Color[] },
    uTrans: { value: L.R.map(() => 0) },
    uBackCol: { value: lin('#ffffff') },
    uA: { value: arch.A },
    uP: { value: arch.P },
    uAmb: { value: 0.6 },
    uDif: { value: 0.5 },
    uRim: { value: 0.1 },
    uRimCol: { value: lin('#ffffff') },
    uShadow: { value: 0.4 },
    uFocus: { value: 0 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    defines: { NL: n },
    vertexShader: /* glsl */ `
      attribute float aL, aTh, aV;
      uniform float uR[NL], uH[NL], uBorn[NL], uTrans[NL]; uniform vec3 uCol[NL];
      uniform float uYear, uEnter, uMinYear, uA, uP;
      varying float vU, vV, vTop, vFU, vFTop, vFK, vL, vTrans, vPh, vFPh; varying vec3 vN, vW, vCol;
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
        vU = uR[l] * aTh; vV = h; vTop = uH[l]; vL = aL; vTrans = uTrans[l]; vCol = uCol[l];
        vPh = aL * .37 * uP;
        vFK = 0.; vFU = 0.; vFTop = 0.; vFPh = 0.;
        if (l + 1 < NL) { vFU = uR[l + 1] * aTh; vFTop = uH[l + 1]; vFK = foldK(uBorn[l + 1], yr); vFPh = (aL + 1.) * .37 * uP; }
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uA, uP, uAmb, uDif, uRim, uShadow, uFocus; uniform vec3 uBackCol, uRimCol;
      varying float vU, vV, vTop, vFU, vFTop, vFK, vL, vTrans, vPh, vFPh; varying vec3 vN, vW, vCol;
      ${FIBRE}
      ${ARCH}
      void main() {
        float prof = vTop + uA * arch(vU + vPh, uP);
        float e = prof - vV;
        if (e < 0.) discard;
        // Cut-outs: an eight-point star window in every arch and a jaali lattice band under the arches.
        float f = fract((vU + vPh) / uP) - .5;
        float st = star8(vec2(f * uP, vV - vTop - uA * .42) * vec2(1., 1.));
        float cut = 1. - step(uA * .2, st);
        vec2 jq = vec2((vU + vPh) / (uP * .25), (vV - vTop + .55) / (uP * .25));
        vec2 jf = abs(fract(jq) - .5);
        float band = step(abs(vV - vTop + .55), uP * .14);
        cut = max(cut, band * step(jf.x + jf.y, .2));
        if (cut > .5) discard;
        float edge = min(e, min(abs(st - uA * .2), band > .5 ? abs(jf.x + jf.y - .2) * uP * .25 : 9.));
        vec3 n = normalize(vN);
        vec3 base = vCol;
        if (!gl_FrontFacing) { n = -n; base = uBackCol; }
        base *= .9 + .2 * fibre(vec2(vU, vV));
        vec3 Ld = normalize(vec3(-.35, .85, .55));
        float dif = max(dot(n, Ld), 0.);
        vec3 col = base * (uAmb + uDif * dif);
        // Backlit paper glows through; the cut edges catch the light.
        col += base * vTrans * (.55 + .45 * smoothstep(0., 6., vV));
        col += uRimCol * uRim * smoothstep(.12, .0, edge);
        // Inked score line following the edge.
        col *= 1. - .18 * smoothstep(.04, .0, abs(e - .32));
        // Soft contact shadow from the layer in front, and ambient occlusion near the page.
        float fprof = vFTop + uA * arch(vFU + vFPh, uP);
        float d = vV - fprof;
        col *= 1. - uShadow * vFK * (1. - smoothstep(-.2, 1.9, d)) * step(-4., d);
        col *= mix(.72, 1., smoothstep(0., 2.5, vV));
        col *= 1. - .22 * uFocus;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  return { mat, uni };
}

/** Paper rosette tags behind every portrait (instanced quads facing out from the stage), with a soft drop shadow. */
export function rosetteMaterial(U: Shared) {
  const uni = {
    ...U,
    uPaper: { value: lin('#f6efe0') },
    uInk: { value: lin('#a2533b') },
    uLight: { value: 1 },
    uShadowA: { value: 0.32 },
    uFocus: { value: 0 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aPos, aCol; attribute float aTh, aSize, aBirth, aDeath, aHi;
      uniform float uYear, uEnter, uMinYear;
      varying vec2 vQ; varying vec3 vCol; varying float vDead, vHi, vA, vSeed;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float app = smoothstep(aBirth - .2, aBirth + .9, yr);
        vA = app; vDead = step(aDeath, yr); vHi = aHi; vCol = aCol; vQ = position.xy * 2.8; vSeed = aBirth;
        vec3 right = vec3(cos(aTh), 0., -sin(aTh));
        // Unfolds upward like a pop-up tab.
        vec3 p = aPos + (right * position.x + vec3(0., 1., 0.) * position.y * app) * aSize * 2.8;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper, uInk; uniform float uLight, uShadowA, uFocus, uTime;
      varying vec2 vQ; varying vec3 vCol; varying float vDead, vHi, vA, vSeed;
      ${FIBRE}
      void main() {
        if (vA < .01) discard;
        float dim = uFocus > .5 && vHi < .5 ? 1. : 0.;
        float r = length(vQ), a = atan(vQ.y, vQ.x);
        float re = .93 + .07 * cos(a * 16.);
        if (r > re) {
          vec2 s = vQ - vec2(.1, -.16); float rs = length(s), as = atan(s.y, s.x);
          float sh = (1. - smoothstep(.85 + .07 * cos(as * 16.), 1.15, rs)) * uShadowA;
          float ring = 0.;
          if (vHi > 1.5) { float ph = fract(uTime * .5); ring = smoothstep(.04, 0., abs(r - (1.02 + .3 * ph))) * (1. - ph); }
          if (sh + ring < .01) discard;
          gl_FragColor = ring > .01 ? vec4(uInk * 1.6, ring * vA) : vec4(vec3(.06, .035, .02), sh * vA * (1. - .6 * dim));
          return;
        }
        vec3 tone = mix(uPaper, vCol, .62);
        if (vDead > .5) tone = mix(tone, vec3(dot(tone, vec3(.3, .59, .11))) * vec3(1.02, .96, .86), .75);
        vec3 c = r < .8 ? uPaper : tone;
        // Stitched ring on the coloured layer, a scalloped inner layer edge with a little lift.
        float stitch = step(.55, fract(a / 6.2832 * 40.)) * smoothstep(.022, .008, abs(r - .87));
        c = mix(c, uInk * .8, stitch * .85);
        vec2 ld = normalize(vec2(-.6, .8));
        float lit = dot(r > 0. ? vQ / r : vec2(0.), ld);
        c *= 1. + .16 * lit * smoothstep(.07, 0., re - r) + .1 * lit * smoothstep(.04, 0., abs(r - .8));
        c *= 1. - .25 * smoothstep(.04, 0., abs(r - .8) - .01) * step(0., r - .8);
        c *= .92 + .14 * fibre(vQ * 3. + vSeed);
        if (vHi > .5) c = mix(c, tone * 1.25, .35);
        c *= uLight;
        c = mix(c, c * .45 + uPaper * .08, dim);
        gl_FragColor = vec4(c, vA);
      }`,
  });
  return { mat, uni };
}

/** Accordion-folded paper strips from each parent's tag over the next card to the child's tag. */
export function ribbonMaterial(U: Shared) {
  const uni = {
    ...U,
    uCol: { value: lin('#b5603f') },
    uHiCol: { value: lin('#d9813e') },
    uAmb: { value: 0.55 },
    uDif: { value: 0.6 },
    uGlow: { value: 0 },
    uFocus: { value: 0 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aT, aBirth, aHi, aF;
      varying float vT, vBirth, vHi, vF; varying vec3 vN, vW;
      void main() { vT = aT; vBirth = aBirth; vHi = aHi; vF = aF; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime, uAmb, uDif, uGlow, uFocus; uniform vec3 uCol, uHiCol;
      varying float vT, vBirth, vHi, vF; varying vec3 vN, vW;
      ${FIBRE}
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float g = clamp((yr - vBirth + .4) / 1.6, 0., 1.); if (vT > g) discard;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float dif = max(dot(n, normalize(vec3(-.35, .85, .55))), 0.);
        vec3 base = mix(uCol, uHiCol, step(.5, vHi));
        base *= .9 + .2 * fibre(vW.xz * 2. + vW.y);
        vec3 col = base * (uAmb + uDif * dif) * (.86 + .22 * vF);
        float flow = smoothstep(.92, 1., fract(vT * 3. - uTime * .35 + vBirth * .37));
        col += uHiCol * vHi * (uGlow + .25) * flow;
        col += uHiCol * uGlow * .35 * vHi;
        col = mix(col, col * .3, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  return { mat, uni };
}

/**
 * A page of the open book. FLOOR: the page the cards stand on, with contact shadows at each card's foot.
 * Otherwise the upright back page, lit by the lamp behind it in the dark theme. Both carry a printed border.
 */
export function pageMaterial(U: Shared, L: LayerData, rect: [number, number, number, number], floor: boolean) {
  const n = L.R.length;
  const uni = {
    ...U,
    uR: { value: L.R },
    uBorn: { value: L.born },
    uPaper: { value: lin('#efe5d2') },
    uInk: { value: lin('#a2533b') },
    uGlow: { value: lin('#000000') },
    uRect: { value: rect },
    uShadow: { value: 0.4 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    defines: floor ? { NL: n, FLOOR: 1 } : { NL: n },
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.);
      #ifdef FLOOR
      vP = w.xz;
      #else
      vP = w.xy;
      #endif
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uR[NL], uBorn[NL]; uniform float uYear, uEnter, uMinYear, uShadow, uRect[4]; uniform vec3 uPaper, uInk, uGlow;
      varying vec2 vP;
      ${FIBRE}
      ${ARCH}
      ${FOLD}
      void main() {
        vec3 col = uPaper * (.9 + .16 * fibre(vP * .7));
        // Distance inside the page rectangle (x0, y0, x1, y1).
        float dx = min(vP.x - uRect[0], uRect[2] - vP.x), dy = min(vP.y - uRect[1], uRect[3] - vP.y);
        float d = min(dx, dy);
        float yr = mix(uMinYear - 3., uYear, uEnter);
      #ifdef FLOOR
        float r = length(vP), sh = 0.;
        for (int l = 0; l < NL; l++) {
          float ds = r - uR[l];
          sh += foldK(uBorn[l], yr) * (ds < 0. ? exp(ds / 2.6) * .75 : exp(-ds / .55));
        }
        col *= 1. - uShadow * min(sh, 1.2);
        col *= mix(.75, 1., smoothstep(0., 6., vP.y - uRect[1])); // the spine
      #else
        float lamp = exp(-pow(length((vP - vec2(0., uRect[3] * .55)) / vec2(uRect[2] * .9, uRect[3] * .8)), 2.) * 1.6);
        col += uGlow * lamp;
        col *= mix(.7, 1., smoothstep(0., 5., vP.y - uRect[1]));
      #endif
        // Printed border: two ink rules with a row of eight-point stars between.
        float b = d - 3.2;
        float rules = smoothstep(.08, 0., abs(abs(b) - 1.1));
        vec2 q = vec2(mod((dx < dy ? vP.y : vP.x) + .0, 2.4) - 1.2, b);
        float st = smoothstep(.06, 0., abs(star8(q) - .62)) + smoothstep(.06, 0., abs(star8(q) - .28));
        col = mix(col, uInk, (rules + st * step(abs(b), .9)) * .5);
        col *= mix(.82, 1., smoothstep(0., .8, d)); // page edge
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  return { mat, uni };
}

/** Book cover boards and the page block edges (fine stripes on the sides). */
export function bookMaterial() {
  const uni = { uCover: { value: lin('#7a3b2e') }, uEdge: { value: lin('#eadcc0') }, uAmb: { value: 0.6 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aKind; varying float vK; varying vec3 vN, vW;
      void main() { vK = aKind; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uCover, uEdge; uniform float uAmb; varying float vK; varying vec3 vN, vW;
      ${FIBRE}
      void main() { vec3 n = normalize(vN); float dif = max(dot(n, normalize(vec3(-.35, .85, .55))), 0.);
        vec3 c;
        if (vK < .5) c = uCover * (.85 + .3 * noise(vW.xz * 3. + vW.y * 3.));
        else { float side = 1. - abs(n.y); float lines = .88 + .12 * sin((vW.y + vW.z * (1. - abs(n.z))) * 60.); c = uEdge * mix(1., lines, side); }
        gl_FragColor = vec4(c * (uAmb + .55 * dif), 1.); }`,
  });
  return { mat, uni };
}

/** Backdrop dome: warm daylight wash, or deep indigo with a lamp glowing behind the stage. */
export function backdropMaterial() {
  const uni = {
    uTop: { value: lin('#000000') },
    uHor: { value: lin('#000000') },
    uLow: { value: lin('#000000') },
    uLamp: { value: lin('#000000') },
    uLampK: { value: 0 },
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop, uHor, uLow, uLamp; uniform float uLampK; varying vec3 vD;
      ${FIBRE}
      void main() { float h = vD.y;
        vec3 c = h > 0. ? mix(uHor, uTop, pow(h, .6)) : mix(uHor, uLow, pow(-h, .45));
        float lamp = pow(max(dot(vD, normalize(vec3(0., .2, -1.))), 0.), 9.);
        c += uLamp * lamp * uLampK;
        c *= .96 + .06 * fibre(vec2(atan(vD.x, vD.z) * 160., h * 160.));
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}
