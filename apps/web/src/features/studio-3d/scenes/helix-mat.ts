import { DoubleSide, NormalBlending, ShaderMaterial } from 'three';
import type { Shared } from '../gl.ts';
import { lin } from '../palette.ts';
import { GOLD, setInk, TEAL, TONE, type Tone } from './galaxy-gl.ts';

// Family Helix materials. Dark ("lab black"): glass backbone ribbons with a silver edge light and a slow
// pulse rising along them, luminous base-pair slabs, drifting motes. Light ("scientific illustration"):
// matte graphite ribbons shaded by a sky and a key light with inked edges, print-colour slabs, a contact
// shadow on white paper. Base pairs take a restrained ramp of colour from the oldest generation to the
// youngest; the hydrogen bonds between partners are gold (marriages).

export interface HelixLook {
  paperC: string;
  paperE: string;
  /** Backbone: glass tint and edge light at night, graphite on paper. */
  glass: string;
  rim: string;
  ink: string;
  /** The generation ramp: oldest, middle, youngest. */
  ramp: [string, string, string];
  gold: string;
  teal: string;
  arc: string;
  arcA: number;
  ring: string;
  ringA: number;
  floor: string;
  floorLine: string;
  shadow: string;
  mote: string;
  glow: number;
  bloom: number;
  exposure: number;
}

export const LOOK: { dark: HelixLook; light: HelixLook } = {
  dark: {
    paperC: '#0c0c0d',
    paperE: '#000000',
    glass: '#dce3ee',
    rim: '#f3efe6',
    ink: '#000000',
    ramp: ['#dfb07c', '#d499ab', '#a2abe2'],
    gold: GOLD.dark,
    teal: TEAL.dark,
    arc: '#c6cedc',
    arcA: 0.42,
    ring: '#8d96a8',
    ringA: 0.34,
    floor: '#121214',
    floorLine: '#9aa0aa',
    shadow: '#000000',
    mote: '#e8ebf1',
    glow: 0.45,
    bloom: 0.42,
    exposure: 1,
  },
  light: {
    paperC: '#ffffff',
    paperE: '#ebebeb',
    glass: '#000000',
    rim: '#000000',
    ink: '#757b84',
    ramp: ['#c2802a', '#b04a64', '#4659ad'],
    gold: GOLD.light,
    teal: TEAL.light,
    arc: '#474c54',
    arcA: 0.66,
    ring: '#9b9b9b',
    ringA: 0.72,
    floor: '#ffffff',
    floorLine: '#b4b4b4',
    shadow: '#c4c6ca',
    mote: '#9c9c9c',
    glow: 0,
    bloom: 0,
    exposure: 1,
  },
};

const GROW = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;

const VERT = /* glsl */ `
  attribute float aT, aBirth, aGrow, aHi, aG, aKind;
  varying float vT, vBirth, vGrow, vHi, vG, vKind; varying vec3 vN, vW;
  void main() { vT = aT; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vG = aG; vKind = aKind;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const HEAD = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus;
  varying float vT, vBirth, vGrow, vHi, vG, vKind; varying vec3 vN, vW;`;

/**
 * The key light (upper front left) and a safe normalize. NaN safety: a NaN or Inf pixel would be spread over
 * the whole frame by the bloom pass, so normalize, pow() bases and atan() are guarded in these shaders.
 */
const LIGHT = /* glsl */ `const vec3 KEY = vec3(-.45, .8, .4);
  vec3 safeN(vec3 v, vec3 f) { float l = length(v); return l > 1e-6 ? v / l : f; }`;

/**
 * Backbone ribbons. Night: glass, nearly clear in its body, bright at grazing angles, sharp highlights,
 * with a pulse of light rising along it. Paper: opaque graphite, sky-lit, with darkened (inked) edges.
 * Faint bands mark the nucleotides. Each stretch appears once the people beside it are born.
 */
export function ribbonMat(U: Shared, T: Tone) {
  const uni = {
    ...U,
    ...T,
    uFocus: { value: 0 },
    uGlass: { value: lin('#000000') },
    uRim: { value: lin('#000000') },
    uInkC: { value: lin('#000000') },
    uBands: { value: 10 },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} ${TONE} ${LIGHT}
      uniform vec3 uGlass, uRim, uInkC; uniform float uBands;
      void main() { ${GROW} if (yr < vBirth) discard;
        vec3 n = safeN(vN, vec3(0., 1., 0.)); vec3 V = safeN(cameraPosition - vW, vec3(0., 0., 1.));
        if (dot(n, V) < 0.) n = -n;
        vec3 L = normalize(KEY);
        float nv = clamp(dot(n, V), 0., 1.), dif = max(dot(n, L), 0.);
        float spec = pow(max(dot(reflect(-L, n), V), 0.), 64.);
        float band = smoothstep(.86, 1., cos(vT * uBands * 6.2832) * .5 + .5);
        // A soft light at the growing end while the years play (it fades once the strand is a year old).
        float tip = (1. - smoothstep(0., 1., yr - vBirth)) * .3;
        if (uInk > .5) {
          vec3 hemi = mix(vec3(.5), vec3(1.), n.y * .5 + .5);
          vec3 c = uInkC * (hemi * .62 + dif * .58) + spec * .1;
          c *= 1. - .6 * smoothstep(.45, .95, 1. - nv);
          c *= 1. - band * .14;
          c = mix(c, paper(), uFocus * .55);
          gl_FragColor = vec4(untone(c), 1.);
          return;
        }
        float fr = pow(max(1. - nv, 0.), 2.3);
        float pulse = smoothstep(.965, 1., fract(vT * .3 - uTime * .07));
        vec3 c = uGlass * (.035 + band * .05 + fr * .45) + uRim * fr * .5 + vec3(spec) * .45 + uRim * (pulse * .45 + tip);
        float a = clamp(.06 + band * .05 + fr * .7 + spec * .6 + pulse * .4 + tip, 0., .95);
        c *= 1. - uFocus * .55;
        // Capped below white so a glint cannot bloom into a flare.
        gl_FragColor = vec4(untone(min(c, vec3(.8))), a);
      }`,
  });
  const setLight = (light: boolean) => {
    mat.transparent = !light;
    mat.depthWrite = light;
    mat.blending = NormalBlending;
  };
  setLight(false);
  return { mat, uni, setLight };
}

/**
 * Base-pair slabs and the gold hydrogen bonds between partners. aG is the generation (0 oldest, 1 youngest)
 * on the ramp; aKind is 0 for a person born in, 1 for a partner (a lighter tint), 2 for a bond. Slabs grow
 * from their strand towards the axis. Night: luminous enamel. Paper: printed colour, sky-lit.
 */
export function slabMat(U: Shared, T: Tone) {
  const uni = {
    ...U,
    ...T,
    uFocus: { value: 0 },
    uR0: { value: lin('#000000') },
    uR1: { value: lin('#000000') },
    uR2: { value: lin('#000000') },
    uGold: { value: lin('#000000') },
    uTeal: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} ${TONE} ${LIGHT}
      uniform vec3 uR0, uR1, uR2, uGold, uTeal;
      void main() { ${GROW} float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        vec3 n = safeN(vN, vec3(0., 1., 0.)), V = safeN(cameraPosition - vW, vec3(0., 0., 1.)), L = normalize(KEY);
        float dif = max(dot(n, L), 0.), nv = clamp(dot(n, V), 0., 1.);
        float spec = pow(max(dot(reflect(-L, n), V), 0.), 40.);
        vec3 base = vG < .5 ? mix(uR0, uR1, vG * 2.) : mix(uR1, uR2, vG * 2. - 1.);
        bool bond = vKind > 1.5;
        float other = uFocus * (1. - step(.5, vHi));
        if (uInk > .5) {
          if (vKind > .5 && !bond) base = mix(base, vec3(1.), .38);
          if (bond) base = uGold;
          vec3 hemi = mix(vec3(.6), vec3(1.), n.y * .5 + .5);
          vec3 c = base * (hemi * .66 + dif * .44) + spec * .06;
          c *= 1. - .3 * pow(max(1. - nv, 0.), 2.5);
          c = mix(c, mix(c, paper(), .72), other);
          gl_FragColor = vec4(untone(c), 1.);
          return;
        }
        if (vKind > .5 && !bond) base = mix(base, vec3(1.), .3);
        if (bond) base = uGold;
        vec3 c = base * (.5 + dif * .55) + vec3(spec) * .35;
        c += uTeal * vHi * .12;
        float edge = smoothstep(g - .06, g, vT) * (1. - step(.999, g));
        c += vec3(1.) * edge;
        c = mix(c, c * .22, other);
        gl_FragColor = vec4(untone(min(c, vec3(.94))) * (bond ? 1.3 : 1.), 1.);
      }`,
  });
  return { mat, uni };
}

/**
 * The plinth under the helix: fine engraved rings and ticks; at night a dark disc with a soft pool of
 * light, on paper a soft contact shadow under the helix.
 */
export function floorMat(T: Tone, radius: number, helixR: number) {
  const uni = {
    ...T,
    uR: { value: radius },
    uHR: { value: helixR },
    uFloor: { value: lin('#000000') },
    uLine: { value: lin('#000000') },
    uShadow: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `${TONE}
      uniform float uR, uHR; uniform vec3 uFloor, uLine, uShadow; varying vec2 vP;
      float hair(float x, float w) { float f = max(fwidth(x), 1e-6); return 1. - smoothstep(f * (w * .5 - .5), f * (w * .5 + .5), abs(x)); }
      void main() {
        float r = length(vP), th = r > 1e-5 ? atan(vP.y, vP.x) : 0.;
        float ring = max(hair(fract(r / (uR * .1) + .5) - .5, 1.) * step(uHR * 1.15, r), hair(r - uR * .98, 1.4));
        float tick = step(uR * .9, r) * step(r, uR * .98) * hair(sin(th * 36.) * r, 1.);
        tick = max(tick, step(uR * .94, r) * step(r, uR * .98) * hair(sin(th * 180.) * r, .8) * smoothstep(1.5, 4., uR * .0175 / max(fwidth(r), 1e-5)));
        float lines = max(ring * .55, tick * .7) * (1. - smoothstep(uR * .98, uR * 1.02, r));
        float fade = 1. - smoothstep(uR * .9, uR * 1.08, r);
        if (uInk > .5) {
          float shade = exp(-pow(r / (uHR * 1.35), 2.)) * .55 + exp(-pow(r / (uHR * 2.6), 2.)) * .25;
          vec3 c = mix(paper(), uShadow, shade);
          c = mix(c, uLine, lines * .8);
          gl_FragColor = vec4(untone(c), 1.);
          return;
        }
        float pool = exp(-pow(r / (uHR * 1.9), 2.)) * .5;
        vec3 c = uFloor + uLine * (lines * .35 + pool * .12);
        gl_FragColor = vec4(untone(c), fade);
      }`,
  });
  const setLight = (light: boolean) => {
    if (light) setInk(mat, true);
    else {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = NormalBlending;
    }
  };
  setLight(false);
  return { mat, uni, setLight };
}

/** Motes drifting up through the helix, like dust in a lab's light beam: light at night, grey specks on paper. */
export function moteMat(U: Shared, T: Tone, height: number) {
  const uni = { ...T, uTime: U.uTime, uCol: { value: lin('#000000') }, uH: { value: height } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh; uniform float uTime, uH, uPR, uInk; varying float vA;
      void main() { vec3 p = position; p.y = mod(p.y + uTime * (.25 + fract(aPh * 3.1) * .5), uH) - uH * .08;
        p.x += sin(uTime * .3 + aPh) * .6; p.z += cos(uTime * .27 + aPh * 1.3) * .6;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = (.35 + .65 * (.5 + .5 * sin(uTime * (.5 + fract(aPh) * 1.2) + aPh))) * smoothstep(0., uH * .12, p.y + uH * .08) * smoothstep(uH, uH * .8, p.y);
        gl_PointSize = clamp((1. + fract(aPh * 7.) * 1.8) * 90. / -mv.z, 1., 4.) * uPR * (uInk > .5 ? .8 : 1.); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${TONE} uniform vec3 uCol; varying float vA;
      void main() { float d = length(gl_PointCoord - .5); if (d > .5) discard; float k = (1. - d * 2.) * vA;
        gl_FragColor = inkOut(uCol, uInk > .5 ? k * .5 : k * .7); }`,
  });
  const setLight = (light: boolean) => setInk(mat, light, true);
  setLight(false);
  return { mat, uni, setLight };
}
