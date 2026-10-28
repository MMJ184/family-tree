import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  DoubleSide,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Date Palm Oasis materials. One shared set of "light" uniforms (sun or moon, sky fill, haze, lanterns,
// selection and marriage colours) feeds every shader, so tint() and the RTL mirror only touch one place.

/**
 * Scene palette. Signature colours: night = lantern amber, moon silver, palm sage, falaj blue;
 * day = frond green, date gold, falaj blue, trunk umber. Everything else is neutral grey or white.
 * Strengths (…K) are linear multipliers: ACES tone mapping needs values above 1 for a white stage.
 */
export interface PalmLook {
  night: boolean;
  zenith: string;
  zenithK: number;
  horizon: string;
  horizonK: number;
  /** Key light: the sun by day, the moon by night. */
  key: string;
  keyK: number;
  /** Hemisphere: sky fill from above, sand bounce from below. */
  fill: string;
  fillK: number;
  bounce: string;
  bounceK: number;
  /** Sheen on crests, leaflets and trunk edges (moonlit silver at night). */
  rim: string;
  rimK: number;
  sand: string;
  bed: string;
  path: string;
  frond: string;
  frondUnder: string;
  dry: string;
  grass: string;
  trunk: string;
  trunkDark: string;
  dateA: string;
  dateB: string;
  dateC: string;
  soil: string;
  water: string;
  waterDeep: string;
  glint: string;
  bank: string;
  gold: string;
  sel: string;
  lamp: string;
  lampK: number;
  /** Strength of the contact shadow at each palm's foot and of the trunk and crown shadow cast on the sand. */
  contact: number;
  shadow: number;
  /** While someone is picked, everyone else fades toward this (black at night, the white stage by day). */
  dim: string;
  dimL: number;
  dimK: number;
  bloom: number;
  exposure: number;
}

export const LOOK: { light: PalmLook; dark: PalmLook } = {
  light: {
    night: false,
    zenith: '#ffffff',
    zenithK: 1.5,
    horizon: '#ffffff',
    horizonK: 3.2,
    key: '#fff8ee',
    keyK: 2.05,
    fill: '#e9ecef',
    fillK: 0.62,
    bounce: '#f4f1ec',
    bounceK: 0.32,
    rim: '#ffffff',
    rimK: 0.12,
    sand: '#f2efea',
    bed: '#e3ddd3',
    path: '#d3ccc1',
    frond: '#3f5f2c',
    frondUnder: '#7d9468',
    dry: '#968055',
    grass: '#8b9a6c',
    trunk: '#8c7a66',
    trunkDark: '#43392f',
    dateA: '#d9a83a',
    dateB: '#b0601f',
    dateC: '#5e2614',
    soil: '#c3b8a8',
    water: '#2a68a8',
    waterDeep: '#1b4a80',
    glint: '#ffffff',
    bank: '#e6e2db',
    gold: '#b7862c',
    sel: '#0f6b63',
    lamp: '#ffb45a',
    lampK: 0,
    contact: 0.75,
    shadow: 0.62,
    dim: '#ffffff',
    dimL: 1.9,
    dimK: 0.66,
    // Almost the whole white stage is above the bloom threshold: any bloom would veil the scene and portraits.
    bloom: 0,
    exposure: 1,
  },
  dark: {
    night: true,
    zenith: '#000000',
    zenithK: 1,
    horizon: '#1c1c1c',
    horizonK: 1,
    key: '#cdd5de',
    keyK: 0.42,
    fill: '#1d1e20',
    fillK: 0.55,
    bounce: '#17140f',
    bounceK: 0.4,
    rim: '#dfe6ee',
    rimK: 0.55,
    sand: '#5e5e5e',
    bed: '#55514c',
    path: '#6b6761',
    frond: '#56664a',
    frondUnder: '#6b7560',
    dry: '#6a5a44',
    grass: '#4a5038',
    trunk: '#6a5646',
    trunkDark: '#1e1814',
    dateA: '#e8a93c',
    dateB: '#c0601e',
    dateC: '#6a2614',
    soil: '#2a2622',
    water: '#2c4f78',
    waterDeep: '#0f1c2e',
    glint: '#cfd8e2',
    bank: '#2e2e2e',
    gold: '#e2b65a',
    sel: '#4fd1bd',
    lamp: '#ffb45a',
    lampK: 1,
    contact: 0.7,
    // Moon shadows would fall toward the viewer as dark stars across the lantern pools: contact only.
    shadow: 0,
    dim: '#000000',
    dimL: 1,
    dimK: 0.72,
    bloom: 0.55,
    exposure: 1,
  },
};

export function makeLight() {
  return {
    /** Toward the key light (sun or moon). */
    uSun: { value: new Vector3(-0.55, 0.62, -0.42).normalize() },
    /** Where the moon disc is drawn: lower than the light so it shows above the dunes. */
    uDisc: { value: new Vector3(-0.42, 0.24, -0.87).normalize() },
    uKey: { value: lin('#000000') },
    uFill: { value: lin('#000000') },
    uBounce: { value: lin('#000000') },
    uRim: { value: lin('#000000') },
    uHaze: { value: lin('#000000') },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    uLamp: { value: lin('#000000') },
    uNight: { value: 0 },
    uSel: { value: lin('#000000') },
    uGold: { value: lin('#000000') },
    uDim: { value: lin('#000000') },
    uDimK: { value: 0.7 },
    uShadowC: { value: 0.7 },
    uShadow: { value: 0.5 },
    uCamLod: { value: 200 },
  };
}
export type Light = ReturnType<typeof makeLight>;

const LIGHT_HEAD = /* glsl */ `
  uniform vec3 uDisc, uSun, uKey, uFill, uBounce, uRim, uHaze, uLamp, uSel, uGold, uDim;
  uniform float uFogNear, uFogFar, uNight, uDimK, uShadowC, uShadow;
  vec3 fogged(vec3 c, float d) { return mix(c, uHaze, smoothstep(uFogNear, uFogFar, d)); }
  vec3 hemi(vec3 n) { return mix(uBounce, uFill, n.y * .5 + .5); }
  vec3 dimmed(vec3 c, float hi, float focus) { return mix(c, uDim, focus * (1. - step(.5, hi)) * uDimK); }`;

/** Shared palm maths: growth by year, a curved trunk and a gentle crown sway. */
const PALM = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus;
  attribute vec4 aPalm; attribute vec2 aLean, aLife; attribute float aHi;
  float yrNow() { return mix(uMinYear - 3., uYear, uEnter); }
  float hNow(float yr) { return aPalm.z * (.3 + .7 * smoothstep(aLife.x, aLife.x + 9., yr)); }
  vec3 trunkAt(float y01, float hn) {
    float k = pow(max(y01, 0.), 1.7);
    vec2 sw = vec2(sin(uTime * .55 + aPalm.w), cos(uTime * .43 + aPalm.w * 1.3)) * hn * .012;
    vec2 o = aLean * hn * k + sw * k * k;
    return vec3(aPalm.x + o.x, y01 * hn, aPalm.y + o.y);
  }
  /** The lantern at the palm's foot, on the side facing out of the grove. */
  vec3 lampAt(float hn) {
    float R = hn * .14 + .7;
    vec2 d = dot(aPalm.xy, aPalm.xy) > .25 ? normalize(aPalm.xy) : vec2(0., 1.);
    return vec3(aPalm.x + d.x * R * .85, .5, aPalm.y + d.y * R * .85);
  }
  const vec4 HIDE = vec4(0., 0., -2., 1.);`;

/** Palm trunks: a curved, tapering column covered in the diamond pattern of old leaf bases. */
export function trunkMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uFocus: { value: 0 }, uA: { value: lin('#000000') }, uB: { value: lin('#000000') } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vUv; varying vec3 vN, vW, vL; varying float vHi, vY, vDead, vDepth;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); float y = position.y;
        float r = aPalm.z * (.028 + .012 * (1. - y)) * (.55 + .45 * hn / aPalm.z) + aPalm.z * .035 * exp(-y * 14.);
        vec3 c = trunkAt(y, hn);
        vec3 w = c + vec3(position.x * r, 0., position.z * r);
        vN = normalize(vec3(position.x, .15, position.z)); vW = w; vY = y * hn; vL = lampAt(hn) - w;
        vUv = vec2(uv.x * 9., y * hn / (aPalm.z * .062)); vHi = aHi; vDead = step(aLife.y, yr);
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus, uTime; uniform vec3 uA, uB;
      varying vec2 vUv; varying vec3 vN, vW, vL; varying float vHi, vY, vDead, vDepth;
      void main() {
        float a = fract(vUv.x + vUv.y), b = fract(vUv.x - vUv.y);
        float d = min(min(a, 1. - a), min(b, 1. - b));
        float crev = smoothstep(.02, .16, d);
        float cell = fract(vUv.y + .5 * step(.5, fract(vUv.x)));
        vec3 base = mix(uB, uA, crev * (.55 + .45 * cell));
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float dif = max(dot(n, uSun), 0.);
        vec3 c = base * (hemi(n) + uKey * dif);
        c *= .55 + .45 * smoothstep(0., 1.4, vY);
        float ld = length(vL);
        float up = (max(dot(n, vL / ld), 0.) * .75 + .25) / (1. + ld * ld * .05);
        c += base * uLamp * up * 1.9 * (1. - vDead * .6);
        float rim = pow(clamp(1. - dot(n, V), 0., 1.), 3.) * (.3 + .7 * max(dot(n, uSun) + .3, 0.));
        c += mix(uRim, uSel * mix(.8, 1., uNight), vHi * uFocus) * rim;
        c = dimmed(c, vHi, uFocus);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Pinnate frond texture: a rachis with leaflets angled toward the tip, short spines at the base. */
export function frondTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(64, 508);
    g.lineTo(64, 6);
    g.stroke();
    const n = 52;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = 500 - t * 490;
      const spine = t < 0.14;
      const len = spine ? 12 + t * 90 : 60 * Math.sin(Math.PI * Math.min(1, (t - 0.08) / 0.94)) ** 0.5 + 4;
      for (const s of [-1, 1]) {
        const off = s * (i % 2 ? 1 : 0.92);
        g.lineWidth = spine ? 2.5 : 4.2 - t * 1.6;
        g.beginPath();
        g.moveTo(64, y);
        g.quadraticCurveTo(64 + off * len * 0.55, y - len * 0.4, 64 + off * len, y - len * 0.74);
        g.stroke();
      }
    }
  }
  const tx = new CanvasTexture(c);
  tx.colorSpace = SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}

/** Fronds: instanced arching blades with a vertex-shader sway. Far palms drop every other frond. */
export function frondMat(U: Shared, L: Light, tex: Texture) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uTex: { value: tex },
    uLeaf: { value: lin('#000000') },
    uUnder: { value: lin('#000000') },
    uDry: { value: lin('#000000') },
    uGrass: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM} uniform float uCamLod; attribute vec4 aFr; attribute vec3 aCol;
      varying vec2 vUv; varying vec3 vN, vW, vCol; varying float vHi, vDead, vDepth, vLamp, vTuft;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vec3 crown = trunkAt(1., hn);
        float far = distance(cameraPosition, crown);
        if (aFr.w > .5 && far > uCamLod) { gl_Position = HIDE; return; }
        float dead = smoothstep(aLife.y, aLife.y + 3., yr);
        float t = position.y, ph = aPalm.w + aFr.x * 3.;
        float gust = sin(uTime * .7 + aPalm.x * .05 + aPalm.y * .04) * .5 + .5;
        float az = aFr.x + sin(uTime * 1.1 + ph) * .035 * (.5 + gust);
        float pitch = aFr.y + (sin(uTime * 1.6 + ph * 1.7) * .05 - .03) * (.4 + gust) * t - dead * .3;
        float Ln = aFr.z * hn * (far > uCamLod ? 1.1 : 1.);
        vec3 d = vec3(cos(pitch) * cos(az), sin(pitch), cos(pitch) * sin(az));
        vec3 side = vec3(-sin(az), 0., cos(az));
        float droop = .28 + max(0., -aFr.y) * .6 + dead * .15;
        vec3 p = crown + d * t * Ln; p.y -= droop * t * t * Ln;
        float wid = Ln * .3 * (far > uCamLod ? 1.25 : 1.);
        p += side * position.x * wid;
        p.y += abs(position.x) * wid * .55 * (1. - t * .4);
        vec3 tg = normalize(d * Ln - vec3(0., 2. * droop * t * Ln, 0.));
        vN = normalize(cross(side, tg)); if (vN.y < 0.) vN = -vN;
        vec3 lp = lampAt(hn); float ld = distance(lp, p);
        vLamp = (1. - t * .7) / (1. + ld * ld * .02);
        vTuft = step(aPalm.z, .2);
        vUv = uv; vW = p; vCol = aCol; vHi = aHi; vDead = dead;
        vec4 mv = viewMatrix * vec4(p, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform sampler2D uTex; uniform vec3 uLeaf, uUnder, uDry, uGrass; uniform float uFocus;
      varying vec2 vUv; varying vec3 vN, vW, vCol; varying float vHi, vDead, vDepth, vLamp, vTuft;
      void main() { if (texture2D(uTex, vUv).a < .42) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float top = step(0., dot(n, V));
        vec3 leaf = mix(mix(uUnder, uLeaf, top), uGrass, vTuft);
        vec3 base = mix(leaf * vCol, uDry, vDead * .55) * (.72 + .38 * vUv.y);
        float dif = max(dot(n, uSun), 0.) * mix(.5, 1., top);
        float trans = pow(max(dot(-V, uSun), 0.), 4.) * .45;
        vec3 c = base * (hemi(n) + uKey * (dif + trans));
        float sp = pow(max(dot(reflect(-uSun, n), V), 0.), 12.) * top;
        c += uRim * sp * .22 * (1. - vTuft);
        c += uRim * pow(clamp(1. - abs(dot(n, V)), 0., 1.), 3.) * .12 * uNight * (1. - vTuft);
        c += base * uLamp * vLamp * 1.15;
        c += uSel * vHi * uFocus * (1. - vTuft) * pow(clamp(1. - abs(dot(n, V)), 0., 1.), 3.) * mix(.12, .2, uNight);
        c = dimmed(c, vHi, uFocus);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Date clusters under the crown: ripen from gold (khalal) to amber and deep red-brown as the person ages. */
export function dateMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uDateA: { value: lin('#000000') },
    uDateB: { value: lin('#000000') },
    uDateC: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM} attribute float aDir;
      varying vec3 vN, vW; varying float vHi, vRipe, vDepth, vLamp;
      void main() { float yr = yrNow(); float age = yr - aLife.x;
        if (age < 16. || yr > aLife.y) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vec3 crown = trunkAt(1., hn);
        float s = hn * .085 * smoothstep(16., 19., age);
        vec2 o = vec2(cos(aDir), sin(aDir));
        float sw = sin(uTime * 1.3 + aPalm.w + aDir) * .04;
        vec3 p = position; p.xz += o * p.y * -sw * 4.;
        vec3 w = crown + vec3(o.x, 0., o.y) * hn * .07 - vec3(0., hn * .02, 0.) + p * s;
        vec3 lp = lampAt(hn); float ld = distance(lp, w);
        vLamp = 1. / (1. + ld * ld * .02);
        vN = normalize(normal); vW = w; vHi = aHi; vRipe = clamp((age - 16.) / 40., 0., 1.);
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus; uniform vec3 uDateA, uDateB, uDateC;
      varying vec3 vN, vW; varying float vHi, vRipe, vDepth, vLamp;
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 base = mix(mix(uDateA, uDateB, smoothstep(0., .5, vRipe)), uDateC, smoothstep(.5, 1., vRipe));
        float dif = max(dot(n, uSun), 0.);
        float sp = pow(max(dot(reflect(-uSun, n), V), 0.), 24.) * .5;
        vec3 c = base * (hemi(n) * .8 + uKey * dif) + uKey * sp;
        c += base * uLamp * (vLamp * 1.4 + .12);
        c = dimmed(c, vHi, uFocus);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/**
 * Irrigation basin (hawdh) at each palm's foot: damp soil inside a raised earthen rim. The mother palm stands in
 * a stone-ringed spring that feeds every channel. Teal rim on the lineage while someone is picked.
 */
export function basinMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uSoil: { value: lin('#000000') },
    uEdge: { value: lin('#000000') },
    uWater: { value: lin('#000000') },
    uDeep: { value: lin('#000000') },
    uGlint: { value: lin('#000000') },
    uStone: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vQ; varying float vHi, vDepth, vA, vPh, vSpring; varying vec3 vW;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vSpring = 1. - step(.05, length(aPalm.xy));
        float R = (hn * .14 + .7) * (1. + vSpring * .75);
        vec3 w = vec3(aPalm.x + position.x * R, .07 + vSpring * .01, aPalm.y - position.y * R);
        vQ = position.xy; vHi = aHi; vA = smoothstep(aLife.x - .2, aLife.x + .8, yr); vPh = aPalm.w; vW = w;
        vec4 mv = viewMatrix * vec4(w, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${NOISE} uniform vec3 uSoil, uEdge, uWater, uDeep, uGlint, uStone; uniform float uFocus, uTime;
      varying vec2 vQ; varying float vHi, vDepth, vA, vPh, vSpring; varying vec3 vW;
      void main() { float r = length(vQ); if (r > 1.) discard;
        vec3 up = vec3(0., 1., 0.);
        float rim = smoothstep(.6, .78, r) * (1. - smoothstep(.86, 1., r));
        vec2 dw = vec2(vQ.x, -vQ.y) / max(r, 1e-3);
        float face = dot(dw, normalize(uSun.xz + 1e-4)) * (r < .8 ? -1. : 1.);
        vec3 c;
        if (vSpring > .5) {
          // The founder's spring: still water in a stone ring, slow ripples spreading from the mother palm.
          float wave = sin(r * 34. - uTime * 1.6) * .5 + .5;
          vec3 V = normalize(cameraPosition - vW);
          float fr = .03 + .97 * pow(clamp(1. - V.y, 0., 1.), 5.);
          vec3 water = mix(uDeep, uWater, smoothstep(.15, .74, r)) * (hemi(up) * .9 + uKey * max(uSun.y, 0.) * .45);
          water = mix(water, uHaze, fr * .8 * (1. - uNight));
          water += mix(uWater, uGlint, .4) * uNight * (.12 + wave * .1) + uGlint * (1. - uNight) * wave * .06;
          vec3 stone = uStone * (hemi(up) + uKey * max(uSun.y + face * .4, 0.)) * (.88 + noise(vQ * 18.) * .16);
          float lip = smoothstep(.74, .79, r);
          c = mix(water * (1. - smoothstep(.62, .74, r) * .3), stone, lip);
        } else {
          vec3 soil = uSoil * (.88 + noise(vQ * 7. + vPh) * .2);
          c = mix(soil, uEdge, rim);
          c *= hemi(up) + uKey * max(uSun.y + face * rim * .45, 0.);
        }
        float ring = (1. - smoothstep(0., .07, abs(r - .84))) * vHi * uFocus;
        c = mix(c, uSel * mix(1., 2.2, uNight), ring);
        c = dimmed(c, vHi, uFocus);
        float a = (1. - smoothstep(.9, 1., r)) * vA;
        gl_FragColor = vec4(fogged(c, vDepth), a); }`,
  });
  return { mat, uni };
}

/** Contact shadow at each palm's foot plus the trunk and crown shadow cast along the light. */
export function shadowMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uFocus: { value: 0 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // The quad is laid along the light, so its winding seen from above depends on the sun side.
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM} uniform vec3 uSun;
      varying vec2 vQ; varying vec4 vS; varying float vHi, vA, vR, vPh;
      void main() { float yr = yrNow(); if (yr < aLife.x - .2) { gl_Position = HIDE; return; }
        float hn = hNow(yr); vec3 crown = trunkAt(1., hn);
        vec2 sd = -normalize(uSun.xz + vec2(1e-5));
        float tanE = max(uSun.y, .15) / max(length(uSun.xz), 1e-3);
        vec2 foot = aPalm.xy;
        vec2 cs = crown.xz + sd * crown.y / tanE;
        vec2 ay = vec2(-sd.y, sd.x);
        float Rc = hn * .36 + .5;
        float st = 1. / max(uSun.y, .35);
        float a1 = dot(cs - foot, sd) + Rc * st;
        float wd = max(Rc, 1.6);
        float along = mix(-1.6, a1, position.x * .5 + .5);
        float across = position.y * wd;
        vec2 g = foot + sd * along + ay * across;
        vQ = vec2(along, across); vS = vec4(dot(cs - foot, sd), dot(cs - foot, ay), Rc, st);
        vR = hn * .032 + .22; vHi = aHi; vPh = aPalm.w;
        vA = smoothstep(aLife.x - .2, aLife.x + 1.5, yr);
        gl_Position = projectionMatrix * viewMatrix * vec4(g.x, .1, g.y, 1.); }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${NOISE} uniform float uFocus;
      varying vec2 vQ; varying vec4 vS; varying float vHi, vA, vR, vPh;
      void main() {
        float rf = length(vQ);
        float contact = exp(-rf * rf / (vR * vR * 10.));
        float t = clamp(vQ.x / max(vS.x, .01), 0., 1.);
        float dl = length(vQ - vS.xy * t);
        float trunk = (1. - smoothstep(vR * .45, vR * 1.4, dl)) * step(0., vQ.x) * .72 * (1. - t * .35);
        // Crown: an irregular star of fronds (7 to 11 per palm), striped by leaflets, denser at the heart.
        vec2 c = vQ - vS.xy; c.x /= vS.w;
        float r = length(c) / vS.z, a = atan(c.y, abs(c.x) + abs(c.y) < 1e-5 ? 1. : c.x);
        float n = 7. + floor(fract(vPh * .37) * 5.);
        float lobes = pow(abs(cos(a * n * .5 + vPh + noise(vec2(a * 2.5, vPh)) * .9)), 2.2);
        float edge = .3 + .7 * lobes * (.75 + .25 * noise(vec2(a * 6., vPh * 1.3)));
        float leaf = .78 + .22 * sin(r * 26. + a * 3.);
        float crown = (1. - smoothstep(edge - .32, edge + .04, r)) * leaf * (.6 + .3 * (1. - r));
        crown = max(crown, (1. - smoothstep(0., .3, r)) * .7);
        float sh = max(contact * uShadowC, max(trunk, crown) * uShadow);
        sh *= vA * (1. - uFocus * (1. - step(.5, vHi)) * .75);
        gl_FragColor = vec4(0., 0., 0., sh); }`,
  });
  return { mat, uni };
}

/** Falaj channels (plastered banks around flowing water) and gold marriage walks; teal water along the lineage. */
export function falajMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uFocus: { value: 0 },
    uWater: { value: lin('#000000') },
    uDeep: { value: lin('#000000') },
    uGlint: { value: lin('#000000') },
    uBank: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    // Drawn after the basins (transparent queue), so channels run into each basin and marriage walks cross them.
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aT, aS, aBirth, aHi, aLen, aGold;
      varying float vT, vS, vBirth, vHi, vLen, vDepth, vGold; varying vec3 vW;
      void main() { vT = aT; vS = aS; vBirth = aBirth; vHi = aHi; vLen = aLen; vGold = aGold; vW = position;
        vec4 mv = viewMatrix * vec4(position, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${NOISE} uniform float uYear, uEnter, uMinYear, uTime, uFocus;
      uniform vec3 uWater, uDeep, uGlint, uBank;
      varying float vT, vS, vBirth, vHi, vLen, vDepth, vGold; varying vec3 vW;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter);
        float g = clamp((yr - vBirth) / 1.5, 0., 1.); if (vT > g) discard;
        float s = abs(vS); float along = vT * vLen;
        vec3 V = normalize(cameraPosition - vW);
        vec3 up = vec3(0., 1., 0.);
        vec3 lit = hemi(up) + uKey * max(uSun.y, 0.);
        float hi = vHi * uFocus;
        vec3 c;
        if (vGold > .5) {
          // Marriage: a walk paved with gold-glazed tiles between pale kerbs.
          float tile = step(.5, fract(along * .6));
          float kerb = smoothstep(.7, .82, s);
          vec3 gold = uGold * (lit * (.82 + tile * .18) + uNight * (1. + hi * .8)) * (.92 + noise(vW.xz * 4.) * .12);
          c = mix(gold, uBank * lit * .95, kerb);
          c += uGold * hi * (1. - kerb) * mix(.25, .5, uNight);
        } else if (s > .56) {
          float e = (s - .56) / .44;
          c = uBank * lit * (.86 + noise(vW.xz * 2.3) * .18);
          c *= .7 + .3 * smoothstep(0., .3, e);
          c *= .9 + .1 * smoothstep(.75, .95, e);
        } else {
          float rip = noise(vec2(vS * 5. + along * .3, along * 1.4 - uTime * 1.8)) * .6 + noise(vec2(vS * 11., along * 3. - uTime * 2.6)) * .4;
          rip = mix(rip, .5, smoothstep(70., 170., vDepth)); // calm from afar: fine ripples would only shimmer
          float dep = 1. - s / .56;
          vec3 body = mix(uWater, uDeep, dep * .65) * (hemi(up) * .9 + uKey * max(uSun.y, 0.) * .45);
          vec3 nr = normalize(vec3((rip - .5) * .35, 1., (noise(vec2(along * 2. - uTime, vS * 4.)) - .5) * .3));
          float fr = .03 + .97 * pow(clamp(1. - dot(nr, V), 0., 1.), 5.);
          c = mix(body, uHaze, fr * .55 * (1. - uNight));
          vec3 Rv = reflect(-V, nr);
          c += uGlint * pow(max(dot(Rv, uSun), 0.), 60.) * mix(1.6, .7, uNight);
          c += mix(uWater, uGlint, .35) * uNight * (.1 + rip * .08);
          c *= .72 + .28 * (1. - smoothstep(.38, .56, s));
          float flow = smoothstep(.86, 1., fract(vT * max(1., vLen * .06) - uTime * .3 + vBirth * .37));
          vec3 teal = uSel * mix(1.15, 1.25, uNight) * (.8 + rip * .3) + uSel * flow * mix(1.2, 1.5, uNight);
          c = mix(c, teal, hi);
          c += uGlint * 1.6 * smoothstep(g - .04, g, vT) * (1. - step(.999, g));
        }
        c = dimmed(c, vHi, uFocus);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

const DUNE = /* glsl */ `${NOISE} uniform float uG, uA;
  /** Open desert: sinuous crests with gentle windward slopes and steep lee faces; flat in the oasis. */
  float dune(vec2 p) {
    float m = smoothstep(uG * 1.45, uG * 2.5, length(p));
    if (m <= 0.) return -.02;
    vec2 q = p / (uG * .45 + 55.);
    vec2 w = vec2(noise(q * .8 + 3.1), noise(q * .8 + 7.7)) - .5;
    float u = dot(q + w * 1.5, vec2(.83, .55)) * 1.7 + noise(q * 1.6) * .45;
    float f = fract(u);
    float prof = f < .7 ? smoothstep(0., .7, f) : 1. - smoothstep(.7, 1., f);
    float amp = .45 + .55 * noise(q * .9 + 11.);
    return m * uA * (prof * amp * .8 + noise(q * .4 + 2.) * .55) - .02;
  }`;

/** Desert floor: the oasis bed with a ring path per generation, rising into wind-rippled dunes. */
export function sandMat(L: Light, grove: number) {
  const uni = {
    ...L,
    uSand: { value: lin('#000000') },
    uBed: { value: lin('#000000') },
    uPath: { value: lin('#000000') },
    uG: { value: grove },
    uA: { value: grove * 0.07 + 7 },
    uRing: { value: 12 },
    uGens: { value: 0 },
    uPathW: { value: 0.6 },
    uHazeR: { value: 900 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `${DUNE} varying vec3 vW, vN; varying float vDepth;
      void main() { vec2 p = position.xy * vec2(1., -1.); float e = 2.;
        float h = dune(p);
        vN = normalize(vec3(h - dune(p + vec2(e, 0.)), e, h - dune(p + vec2(0., e))));
        vW = vec3(p.x, h, p.y);
        vec4 mv = viewMatrix * vec4(vW, 1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} ${DUNE} uniform vec3 uSand, uBed, uPath; uniform float uRing, uGens, uPathW, uHazeR;
      varying vec3 vW, vN; varying float vDepth;
      void main() { vec2 p = vW.xz; float r = length(p);
        vec3 n = vec3(0., 1., 0.);
        float m = smoothstep(uG * 1.45, uG * 2.5, r);
        // Crisp per-pixel crests where the dunes are near; the mesh's own normals further out (cheaper).
        float nearK = 1. - smoothstep(200., 260., vDepth);
        if (m > 0.) {
          n = normalize(vN);
          if (nearK > 0.) { float e = .6, h0 = dune(p); n = normalize(mix(n, normalize(vec3(h0 - dune(p + vec2(e, 0.)), e, h0 - dune(p + vec2(0., e)))), nearK)); }
        }
        float fade = 1. - smoothstep(50., 240., vDepth);
        float ph = dot(p, vec2(.6, .8)) * 2.4 + noise(p * .07) * 8.;
        n = normalize(n + vec3(.6, 0., .8) * cos(ph) * .14 * fade * m);
        // Oasis bed: compacted soil with a path along each generation ring and a plaza round the mother palm.
        float bedK = 1. - smoothstep(uG * .95, uG * 1.4, r + (noise(p * .05) - .5) * uG * .3);
        vec3 bed = uBed * (.93 + noise(p * 1.7) * .1) * (1. - smoothstep(.5, .8, noise(p * .09)) * .06);
        float gi = floor(r / uRing + .5), dd = abs(r - gi * uRing);
        float onRing = step(.5, gi) * step(gi, uGens + .2);
        float path = (1. - smoothstep(uPathW, uPathW + .45, dd)) * onRing;
        float plaza = 1. - smoothstep(uRing * .3, uRing * .3 + .45, r);
        bed = mix(bed, uPath * (.95 + noise(p * 5.) * .08), max(path, plaza));
        float kerb = (1. - smoothstep(0., .14, abs(dd - uPathW - .2))) * onRing + (1. - smoothstep(0., .14, abs(r - uRing * .3 - .2)));
        bed *= 1. - kerb * .1;
        vec3 sand = uSand * (.97 + noise(p * .9) * .05);
        vec3 alb = mix(sand, bed, bedK);
        // The open dunes are modelled by a lower light than the sun, so they keep their relief at midday.
        vec3 Ld = normalize(mix(uSun, vec3(uSun.x, uSun.y * .45, uSun.z), m));
        float dif = max(dot(n, Ld), 0.);
        vec3 c = alb * (hemi(n) + uKey * dif);
        vec3 V = normalize(cameraPosition - vW);
        c += uRim * pow(clamp(1. - dot(n, V), 0., 1.), 4.) * smoothstep(0., .3, dif) * m * .2;
        c = mix(c, uHaze, smoothstep(uG * 1.7, uHazeR, r));
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Sky: a white daylight dome, or a black desert night with faint stars and a silver crescent moon. */
export function skyMat(L: Light, U: Shared) {
  const uni = {
    ...L,
    uTop: { value: lin('#000000') },
    uHor: { value: lin('#000000') },
    uTime: U.uTime,
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `varying vec3 vD; void main() { vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform vec3 uTop, uHor; uniform float uTime; varying vec3 vD;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() { vec3 d = normalize(vD); float h = d.y;
        vec3 c = mix(uHor, uTop, pow(clamp(h, 0., 1.), mix(.42, .3, uNight)));
        c = mix(c, uHaze, (1. - smoothstep(-.03, .03, h)));
        float sd = max(dot(d, uDisc), 0.);
        if (uNight < .5) {
          c += uKey * pow(max(dot(d, uSun), 0.), 10.) * .12;
        } else {
          vec3 g = d * 240.; vec3 id = floor(g); vec3 f = fract(g) - .5;
          float st = step(.986, h3(id)) * (1. - smoothstep(0., .24, length(f))) * smoothstep(.02, .3, h);
          st *= (.35 + .65 * h3(id + 7.)) * (.7 + .3 * sin(uTime * 1.7 + h3(id + 3.) * 40.));
          c += vec3(.92) * st * 1.1;
          float bd = dot(d, normalize(vec3(.3, .25, .92))) * 3.2;
          float band = exp(-bd * bd) * smoothstep(.02, .45, h);
          c += vec3(.03) * band;
          float m = smoothstep(.99982, .99987, sd);
          vec3 mo = normalize(uDisc + vec3(.008, .004, 0.));
          float cut = smoothstep(.99985, .9999, max(dot(d, mo), 0.));
          c = mix(c, uRim * 1.5, m * (1. - cut));
          c += uRim * (pow(sd, 400.) * .12 + pow(sd, 40.) * .01);
        }
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** Lantern glow at each palm's foot (night only): a soft pool on the sand and a flickering flame. */
export function lampMat(U: Shared, L: Light, flame: boolean) {
  const uni = { ...U, ...L, uFocus: { value: 0 } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `${PALM}
      varying vec2 vQ; varying float vA, vHi;
      void main() { float yr = yrNow(); if (yr < aLife.x + .5) { gl_Position = HIDE; return; }
        float hn = hNow(yr); float R = hn * .14 + .7; vec3 lp = lampAt(hn);
        float fl = .86 + .14 * sin(uTime * 9. + aPalm.w * 7.) * sin(uTime * 5.3 + aPalm.w);
        vA = (yr > aLife.y ? .35 : 1.) * fl * smoothstep(aLife.x + .5, aLife.x + 2., yr); vHi = aHi; vQ = position.xy;
        ${
          flame
            ? `vec4 mv = viewMatrix * vec4(lp + vec3(0., .1, 0.), 1.); mv.xy += position.xy * .6; gl_Position = projectionMatrix * mv;`
            : `float s = R * 3.4; vec2 c = mix(aPalm.xy, lp.xz, .45); vec3 w = vec3(c.x + position.x * s, .11, c.y - position.y * s); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);`
        } }`,
    fragmentShader: /* glsl */ `${LIGHT_HEAD} uniform float uFocus; varying vec2 vQ; varying float vA, vHi;
      void main() { float r = length(vQ) * 2.; if (r > 1.) discard;
        float k = ${flame ? 'exp(-r * r * 14.) * 3.2 + exp(-r * 3.5) * .35' : 'exp(-r * r * 4.) * .42'};
        k *= vA * (1. - uFocus * .75 * (1. - step(.5, vHi)));
        gl_FragColor = vec4(uLamp * k, 1.); }`,
  });
  return { mat, uni };
}
