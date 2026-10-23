import { AdditiveBlending, FrontSide, NormalBlending, ShaderMaterial } from 'three';
import type { Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Family Helix materials: glass sheath with Fresnel rim, glowing core filament,
// glossy base pairs with a thin-film (dichroic) edge, light-carrying lineage arcs and drifting motes.

export interface HelixLook {
  dark: boolean;
  top: string;
  hor: string;
  ground: string;
  tint: string;
  rim: string;
  core: string;
  link: string;
  mote: string;
  floor: string;
  line: string;
  bloom: number;
  exposure: number;
}

export const LOOK: { dark: HelixLook; light: HelixLook } = {
  dark: {
    dark: true,
    top: '#03060d',
    hor: '#0a1a2e',
    ground: '#02050a',
    tint: '#9fd8ff',
    rim: '#6fe3ff',
    core: '#38c8ff',
    link: '#4fd6ff',
    mote: '#7fd0ff',
    floor: '#1d4a6e',
    line: '#2f6f96',
    bloom: 0.55,
    exposure: 1.0,
  },
  light: {
    dark: false,
    top: '#d5dfeb',
    hor: '#f5f7fa',
    ground: '#e3e8ef',
    tint: '#9fc1e8',
    rim: '#1f5fb0',
    core: '#1d5fb8',
    link: '#1f6bd0',
    mote: '#5b7fa8',
    floor: '#9db4cf',
    line: '#7d98b8',
    bloom: 0.12,
    exposure: 0.95,
  },
};

const GROW = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;

const VERT = /* glsl */ `
  attribute float aT, aBirth, aGrow, aHi; attribute vec3 aCol;
  varying float vT, vBirth, vGrow, vHi; varying vec3 vN, vW, vCol;
  void main() { vT = aT; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vCol = aCol; vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const HEAD = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus;
  varying float vT, vBirth, vGrow, vHi; varying vec3 vN, vW, vCol;`;

/** Strand glass: tinted body, bright Fresnel edge, sharp specular; grows upward with the years. */
export function sheathMat(U: Shared) {
  const uni = {
    ...U,
    uFocus: { value: 0 },
    uTint: { value: lin('#000000') },
    uRim: { value: lin('#000000') },
    uBody: { value: 0.1 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: FrontSide,
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uTint, uRim; uniform float uBody;
      void main() { ${GROW} if (yr < vBirth) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(vec3(.4, .85, .5));
        float nv = max(dot(n, V), 0.); float fr = pow(1. - nv, 2.4);
        float sp = pow(max(dot(reflect(-L, n), V), 0.), 70.) + pow(max(dot(reflect(-normalize(vec3(-.6, .3, -.4)), n), V), 0.), 30.) * .35;
        float band = smoothstep(.8, 1., sin(vT * 62.83) * .5 + .5) * .08;
        vec3 c = uTint * (uBody + band + fr * .45) + uRim * fr * .4 + vec3(sp) * .7;
        float a = clamp(uBody + band + fr * .6 + sp * .7, 0., .9);
        float tip = smoothstep(2., 0., yr - vBirth); c += uRim * tip; a = max(a, tip * .6);
        a *= 1. - uFocus * .55;
        gl_FragColor = vec4(c, a); }`,
  });
  return { mat, uni };
}

/** Core filament inside the glass: light rises along it. */
export function coreMat(U: Shared) {
  const uni = { ...U, uFocus: { value: 0 }, uCore: { value: lin('#000000') }, uGain: { value: 1 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uCore; uniform float uGain;
      void main() { ${GROW} if (yr < vBirth) discard;
        float pulse = smoothstep(.93, 1., fract(vT * .5 - uTime * .12));
        vec3 c = uCore * uGain * (.75 + pulse * 1.6);
        c *= 1. - uFocus * .5;
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Base pairs: glossy enamel in the family colours with a thin-film edge; they grow from each strand to the axis. */
export function baseMat(U: Shared, shine: number) {
  const uni = {
    ...U,
    uFocus: { value: 0 },
    uSky: { value: lin('#000000') },
    uGlow: { value: lin('#000000') },
    uShine: { value: shine },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uSky, uGlow; uniform float uShine;
      void main() { ${GROW} float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(vec3(.4, .85, .5));
        float dif = max(dot(n, L), 0.), nv = max(dot(n, V), 0.), fr = pow(1. - nv, 3.);
        float sp = pow(max(dot(reflect(-L, n), V), 0.), 48.);
        vec3 film = .5 + .5 * cos(6.2832 * (fr * 1.4 + vT * .3 + vec3(0., .33, .67)));
        vec3 c = vCol * (.55 + dif * .75) + uSky * (n.y * .5 + .5) * .12 + (film * fr * .55 + vec3(sp) * .7) * uShine;
        c = mix(c, c * 1.3 + uGlow * .25, vHi);
        c = mix(c, c * .3, uFocus * (1. - step(.5, vHi)));
        c += uGlow * 2. * smoothstep(g - .06, g, vT) * (1. - step(.999, g));
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Lineage arcs: a bright view-facing core with pulses running parent to child. Additive on dark, ink on light. */
export function linkMat(U: Shared) {
  const uni = { ...U, uFocus: { value: 0 }, uGlow: { value: lin('#000000') }, uAdd: { value: 1 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uGlow; uniform float uAdd;
      void main() { ${GROW} float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW); float core = pow(abs(dot(n, V)), 1.6);
        float pulse = smoothstep(.86, 1., fract(vT * 1.4 - uTime * .4 + vBirth * .17));
        float a = (.22 + core * .55) + pulse * .9 * core + vHi * (.55 + pulse * 1.2);
        a *= uFocus > .5 && vHi < .5 ? .15 : 1.;
        vec3 c = mix(uGlow, vec3(1.), pulse * core * .35 * uAdd);
        a += smoothstep(g - .08, g, vT) * (1. - step(.999, g)) * 1.5;
        gl_FragColor = uAdd > .5 ? vec4(c * a, 1.) : vec4(c, clamp(a * .8, 0., 1.)); }`,
  });
  const setAdd = (on: boolean) => {
    uni.uAdd.value = on ? 1 : 0;
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setAdd };
}

/** Motes drifting up through the helix (like particles in a lab light beam). */
export function moteMat(U: Shared, height: number) {
  const uni = { uTime: U.uTime, uCol: { value: lin('#000000') }, uAdd: { value: 1 }, uH: { value: height } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh; uniform float uTime, uH; varying float vA;
      void main() { vec3 p = position; p.y = mod(p.y + uTime * (.25 + fract(aPh * 3.1) * .5), uH) - uH * .08;
        p.x += sin(uTime * .3 + aPh) * .6; p.z += cos(uTime * .27 + aPh * 1.3) * .6;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = (.35 + .65 * (.5 + .5 * sin(uTime * (.5 + fract(aPh) * 1.2) + aPh))) * smoothstep(0., uH * .12, p.y + uH * .08) * smoothstep(uH, uH * .8, p.y);
        gl_PointSize = clamp((1. + fract(aPh * 7.) * 1.8) * 90. / -mv.z, 1., 4.); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uAdd; varying float vA;
      void main() { float d = length(gl_PointCoord - .5); if (d > .5) discard; float k = (1. - d * 2.) * vA;
        gl_FragColor = uAdd > .5 ? vec4(uCol * k * .8, 1.) : vec4(uCol, k * .45); }`,
  });
  const setAdd = (on: boolean) => {
    uni.uAdd.value = on ? 1 : 0;
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setAdd };
}

/** Exhibit plinth under the helix: fine concentric rings and a soft pool of light. */
export function floorMat(radius: number) {
  const uni = { uC: { value: lin('#000000') }, uR: { value: radius }, uAdd: { value: 1 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uC; uniform float uR, uAdd; varying vec2 vP;
      void main() { float r = length(vP) / uR; float ring = smoothstep(.06, 0., abs(fract(r * 9.) - .5) * 2. - .9);
        float tick = step(.97, fract(atan(vP.y, vP.x) / 6.2832 * 72.)) * step(.9, r) * step(r, 1.);
        float pool = exp(-r * r * 6.);
        float a = (ring * .32 + tick * .5) * (1. - smoothstep(.85, 1.05, r)) + pool * (uAdd > .5 ? .35 : .18);
        gl_FragColor = vec4(uC * (uAdd > .5 ? 1.2 : .9), a * (1. - smoothstep(1., 1.2, r))); }`,
  });
  return { mat, uni };
}
