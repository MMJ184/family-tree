import { AdditiveBlending, DoubleSide, NormalBlending, ShaderMaterial } from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// River Delta materials: one ground shader (hills, wetlands, sandbars, lakes, coast and sea),
// one water shader for every channel (levee banks first, then water with flow streaks running
// from source to sea), settlement discs and the thin pins under each portrait.

export interface DeltaLook {
  dark: boolean;
  top: string;
  hor: string;
  haze: string;
  wetA: string;
  wetB: string;
  forest: string;
  sand: string;
  rock: string;
  lake: string;
  shal: string;
  deep: string;
  turbid: string;
  foam: string;
  shallow: string;
  channel: string;
  bankIn: string;
  bankOut: string;
  streak: string;
  hi: string;
  disc: string;
  light: string;
  pin: string;
  bloom: number;
  exposure: number;
}

export const LOOK: { dark: DeltaLook; light: DeltaLook } = {
  light: {
    dark: false,
    top: '#7fa9cf',
    hor: '#dfeaee',
    haze: '#d9e6ea',
    wetA: '#7d9a55',
    wetB: '#a9b673',
    forest: '#4f6d3b',
    sand: '#e6d5a5',
    rock: '#a1907a',
    lake: '#3e8796',
    shal: '#7bd6cb',
    deep: '#1d5a93',
    turbid: '#a9cdb0',
    foam: '#ffffff',
    shallow: '#5cc3c6',
    channel: '#16679a',
    bankIn: '#e9d9a8',
    bankOut: '#6a8746',
    streak: '#ffffff',
    hi: '#ffb52e',
    disc: '#fbf7ee',
    light: '#ffffff',
    pin: '#5d6b62',
    bloom: 0.14,
    exposure: 0.98,
  },
  dark: {
    dark: true,
    top: '#02050c',
    hor: '#0c1a2d',
    haze: '#0b1828',
    wetA: '#172d27',
    wetB: '#22392f',
    forest: '#0c1b15',
    sand: '#4a4a40',
    rock: '#252a2f',
    lake: '#0b3040',
    shal: '#0e4152',
    deep: '#030c1c',
    turbid: '#123b3c',
    foam: '#8fd8ff',
    shallow: '#1a8fab',
    channel: '#06364f',
    bankIn: '#3c4a3f',
    bankOut: '#1a2c24',
    streak: '#7ff0ff',
    hi: '#ffcf6a',
    disc: '#26313a',
    light: '#ffc46b',
    pin: '#5f86a8',
    bloom: 0.62,
    exposure: 1.02,
  },
};

const GROW = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;

const FBM = /* glsl */ `${NOISE}
  float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }`;

const HAZE = /* glsl */ `float hz = smoothstep(uHazeNear, uHazeFar, length(vW - cameraPosition)); c = mix(c, uHaze, hz * .85);`;

/** Land mask shared by ground and sea: an arcuate lobe around the apex plus the mainland behind it. */
const COAST = /* glsl */ `
  float coastD(vec2 p, float n1, float n2) {
    float r = length(p), th = atan(p.x, p.y);
    float lobe = uRc * (1. + (n1 - .5) * .08) * (1. - smoothstep(uHalf, uHalf + .5, abs(th)));
    float main = uZm + uRc * .07 * (n2 - .5);
    return min(r - lobe, p.y - main); }`;

export function groundMat(U: Shared) {
  const uni = {
    uTime: U.uTime,
    uFocus: { value: 0 },
    uRc: { value: 100 },
    uHalf: { value: 0.9 },
    uZm: { value: 10 },
    uH: { value: 20 },
    uNight: { value: 0 },
    uHazeNear: { value: 200 },
    uHazeFar: { value: 900 },
    uWetA: { value: lin('#000') },
    uWetB: { value: lin('#000') },
    uForest: { value: lin('#000') },
    uSand: { value: lin('#000') },
    uRock: { value: lin('#000') },
    uLake: { value: lin('#000') },
    uShal: { value: lin('#000') },
    uDeep: { value: lin('#000') },
    uTurbid: { value: lin('#000') },
    uFoam: { value: lin('#000') },
    uHaze: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW, vN;
      void main() { vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFocus, uRc, uHalf, uZm, uH, uNight, uHazeNear, uHazeFar;
      uniform vec3 uWetA, uWetB, uForest, uSand, uRock, uLake, uShal, uDeep, uTurbid, uFoam, uHaze;
      varying vec3 vW, vN;
      ${FBM}
      ${COAST}
      void main() {
        vec2 p = vW.xz; vec2 q = p * (110. / uRc);
        float n1 = fbm(q * .018), n2 = fbm(q * .06 + 3.1), n3 = noise(q * .23 + 9.);
        float d = coastD(p, n1, n2);
        vec3 n = normalize(vN);
        vec3 L = normalize(vec3(-.35, .8, -.45));
        // Land: wetland mosaic, vegetated levees, bare sandbars, thermokarst lakes; hills behind.
        vec3 land = mix(uWetA, uWetB, smoothstep(.3, .75, n2));
        land = mix(land, uForest, smoothstep(.52, .78, n1) * .7);
        land = mix(land, uSand, smoothstep(.66, .8, noise(q * .045 + 7.)) * .55);
        land *= (.9 + n3 * .14) * (.92 + noise(q * 1.1 + 4.) * .16);
        float hgt = clamp(vW.y / uH, 0., 1.);
        land = mix(land, uForest, smoothstep(.02, .25, hgt));
        land *= 1. - smoothstep(.03, .2, hgt) * (noise(q * 2.6) * .25 + noise(q * 7.) * .12);
        land = mix(land, uRock, smoothstep(.35, .9, hgt) * .8 + smoothstep(.75, .55, n.y) * .5);
        float ln = noise(q * .3 + 13.) * .7 + noise(q * .9) * .3;
        float lake = smoothstep(.74, .76, ln) * smoothstep(-3., -9., d) * (1. - smoothstep(.01, .05, hgt));
        land = mix(land, uSand, smoothstep(.69, .74, ln) * smoothstep(-3., -9., d) * (1. - smoothstep(.01, .05, hgt)) * .5);
        land = mix(land, uLake, lake);
        land = mix(land, uSand, smoothstep(-5., -.5, d) * .85); // beach
        float dif = max(dot(n, L), 0.);
        land *= mix(.62, 1.12, dif);
        // Sea: turquoise shallows and a turbid plume near the coast, deep blue offshore.
        float deepK = smoothstep(0., uRc * .45, d);
        vec3 sea = mix(uShal, uDeep, deepK);
        sea = mix(sea, uTurbid, (1. - smoothstep(0., uRc * .07, d)) * .55 * (.6 + n2 * .6));
        float wav = noise(vec2(p.x * .35 + uTime * .15, p.y * .9 - uTime * .25)) * noise(p * .6 - uTime * .1);
        sea += mix(vec3(1.), uFoam, uNight) * smoothstep(.55, .9, wav) * (.06 + uNight * .1);
        float foam = smoothstep(2.2, .2, abs(d - .9 - sin(uTime * .8 + n3 * 6.) * .4)) * (1. - deepK);
        sea = mix(sea, uFoam, foam * (uNight > .5 ? .35 : .7));
        vec3 c = mix(land, sea, smoothstep(-.6, .6, d));
        // Cloud shadows drifting over the delta by day.
        c *= 1. - (1. - uNight) * .2 * smoothstep(.55, .78, fbm(p * .006 + vec2(uTime * .006, uTime * .003)));
        c *= 1. - uFocus * .25;
        ${HAZE}
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Channels: banks (aBank 1, soft-edged) and water with streaks flowing downstream along aS. */
export function waterMat(U: Shared) {
  const uni = {
    ...U,
    uFocus: { value: 0 },
    uNight: { value: 0 },
    uHazeNear: { value: 200 },
    uHazeFar: { value: 900 },
    uShallow: { value: lin('#000') },
    uChannel: { value: lin('#000') },
    uBankIn: { value: lin('#000') },
    uBankOut: { value: lin('#000') },
    uStreak: { value: lin('#000') },
    uHi: { value: lin('#000') },
    uHaze: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aT, aU, aS, aW, aBirth, aGrow, aTint, aBank, aHi; attribute vec3 aCol;
      varying float vT, vU, vS, vWd, vBirth, vGrow, vTint, vBank, vHi; varying vec3 vCol, vW;
      void main() { vT = aT; vU = aU; vS = aS; vWd = aW; vBirth = aBirth; vGrow = aGrow; vTint = aTint; vBank = aBank; vHi = aHi; vCol = aCol;
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime, uFocus, uNight, uHazeNear, uHazeFar;
      uniform vec3 uShallow, uChannel, uBankIn, uBankOut, uStreak, uHi, uHaze;
      varying float vT, vU, vS, vWd, vBirth, vGrow, vTint, vBank, vHi; varying vec3 vCol, vW;
      ${NOISE}
      void main() { ${GROW}
        float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        float au = abs(vU);
        float dim = mix(1., .4, uFocus * (1. - step(.5, vHi)));
        vec3 c; float a = 1.;
        if (vBank > .5) {
          // Riparian green with intermittent sandbars (point bars) hugging the water.
          float bar = smoothstep(.5, .72, noise(vec2(vS * .09 + vU * 1.7, vBirth * .7 + vU)));
          c = mix(uBankOut, uBankIn, bar * smoothstep(1., .45, au));
          c *= .9 + noise(vec2(vS * .5, vU * 4.)) * .2;
          a = smoothstep(1., .55, au);
          c = mix(c, mix(c, uHi, .35), vHi * uFocus);
        } else {
          float dep = (1. - au * au) * clamp(vWd / 2.6, .3, 1.);
          c = mix(uShallow, uChannel, dep);
          c = mix(c, vCol * mix(.9, .7, uNight), vTint * .62);
          // Flow: elongated streaks drifting from source to sea, plus a fine faster ripple.
          float f = noise(vec2(vU * 2.2 + vBirth * .37, (vS - uTime * 3.2) * .16));
          float r = noise(vec2(vU * 6. + 3., (vS - uTime * 5.5) * .55));
          float st = smoothstep(.62, .92, f) * .8 + smoothstep(.7, .95, r) * .35;
          float big = clamp(vWd / 2.2, .25, 1.);
          c += uStreak * st * mix(.22, .55, uNight) * (.4 + dep * .6) * mix(1., big, uNight);
          c += uStreak * uNight * .2 * (.3 + dep) * big;
          c *= mix(1., .55 + big * .45, uNight);
          c = mix(c, mix(c * .55 + uHi * (.45 + st * .6), c * .5 + uHi * (.9 + st * 1.4), uNight), vHi * uFocus);
          a = smoothstep(1., .82, au);
        }
        c += uStreak * smoothstep(g - .04, g, vT) * (1. - step(.999, g)) * 1.6;
        c *= dim;
        ${HAZE}
        gl_FragColor = vec4(c, a); }`,
  });
  return { mat, uni };
}

/** Settlement discs: a pale plinth with a family-colour ring by day, warm village lights by night. */
export function discMat(U: Shared) {
  const uni = { ...U, uDisc: { value: lin('#000') }, uLight: { value: lin('#000') }, uNight: { value: 0 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBorn; attribute vec3 aCol; uniform float uYear, uEnter, uMinYear;
      varying vec3 vCol, vN; varying vec2 vP;
      void main() { ${GROW} float k = smoothstep(aBorn - .5, aBorn + 1., yr); vCol = aCol; vN = normal; vP = position.xz;
        vec4 w = modelMatrix * instanceMatrix * vec4(position * vec3(k, 1., k), 1.);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uDisc, uLight; uniform float uNight, uTime; varying vec3 vCol, vN; varying vec2 vP;
      void main() { float r = length(vP); float top = step(.5, vN.y);
        float ring = smoothstep(.62, .7, r) * smoothstep(.98, .9, r);
        vec3 c = mix(uDisc * (.7 + .3 * vN.x), mix(uDisc, vCol, ring), top);
        vec3 lights = uLight * (1.4 + .3 * sin(uTime * 2. + vP.x * 9.)) * (1. - smoothstep(.0, .6, r)) + vCol * ring * 1.3;
        c = mix(c, c * .6 + lights * top, uNight);
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Thin pins from each settlement up to its portrait. */
export function pinMat(U: Shared) {
  const uni = { ...U, uC: { value: lin('#000') }, uAdd: { value: 0 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aT; varying float vBirth, vT;
      void main() { vBirth = aBirth; vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `uniform float uYear, uEnter, uMinYear, uAdd; uniform vec3 uC; varying float vBirth, vT;
      void main() { ${GROW} if (yr < vBirth) discard; float a = mix(.75, .25, vT);
        gl_FragColor = uAdd > .5 ? vec4(uC * a, 1.) : vec4(uC, a); }`,
  });
  const setAdd = (on: boolean) => {
    uni.uAdd.value = on ? 1 : 0;
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setAdd };
}
