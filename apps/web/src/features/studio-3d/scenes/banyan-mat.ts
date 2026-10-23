import {
  AdditiveBlending,
  type Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// Banyan materials: fluted bark that thickens with age, swaying aerial rootlets, leathery
// leaves lit from behind, dusty ground under a dappled canopy shadow, a sandstone
// chabutro, prayer threads, figs, fireflies and diya flames. One shared light rig
// (sun or moon, sky, canopy) is referenced by every material, so tint() updates them all.

export interface BanyanLook {
  dark: boolean;
  top: string;
  hor: string;
  ground: string;
  sun: string;
  sunDir: [number, number, number];
  sky: string;
  amb: string;
  barkA: string;
  barkB: string;
  moss: string;
  rootA: string;
  rootB: string;
  leafA: string;
  leafB: string;
  vein: string;
  old: string;
  soil: string;
  soil2: string;
  grass: string;
  fog: string;
  hi: string;
  stoneA: string;
  stoneB: string;
  fly: string;
  flame: string;
  fig: string;
  orb: string;
  bloom: number;
  exposure: number;
}

export const LOOK: { light: BanyanLook; dark: BanyanLook } = {
  light: {
    dark: false,
    top: '#8fb4cf',
    hor: '#fbd49a',
    ground: '#d8b98a',
    sun: '#ffd49a',
    sunDir: [-0.6, 0.27, -0.55],
    sky: '#b9c8cf',
    amb: '#9a7a55',
    barkA: '#4f4136',
    barkB: '#8f806c',
    moss: '#6e7a3a',
    rootA: '#7a5a44',
    rootB: '#c79a72',
    leafA: '#23401b',
    leafB: '#7d9a33',
    vein: '#d6dc8e',
    old: '#b8862f',
    soil: '#caa676',
    soil2: '#a7845a',
    grass: '#8e9748',
    fog: '#f0d3a2',
    hi: '#ff9f2e',
    stoneA: '#b89f78',
    stoneB: '#e9dcc0',
    fly: '#ffe7b0',
    flame: '#ff9a2e',
    fig: '#c8462a',
    orb: '#fff0c8',
    bloom: 0.16,
    exposure: 0.95,
  },
  dark: {
    dark: true,
    top: '#03060e',
    hor: '#1d3150',
    ground: '#080d14',
    sun: '#b4c8ea',
    sunDir: [0.6, 0.6, 0.35],
    sky: '#6f88b0',
    amb: '#2e3a4f',
    barkA: '#2c2d33',
    barkB: '#8b919d',
    moss: '#2b3a2c',
    rootA: '#35302d',
    rootB: '#7d756c',
    leafA: '#0e2219',
    leafB: '#4f8a68',
    vein: '#7fa894',
    old: '#6b5a33',
    soil: '#36445a',
    soil2: '#252f3f',
    grass: '#1a2a26',
    fog: '#0e192a',
    hi: '#ffc163',
    stoneA: '#3f444e',
    stoneB: '#7b8492',
    fly: '#d6ff8f',
    flame: '#ffa63d',
    fig: '#5e2a22',
    orb: '#dfe9ff',
    bloom: 0.62,
    exposure: 1.05,
  },
};

/** The light rig every banyan material shares (uniform objects are shared by reference). */
export function lightRig() {
  return {
    uSunDir: { value: new Vector3(-0.7, 0.4, -0.3).normalize() },
    uSunCol: { value: lin('#ffffff') },
    uSky: { value: lin('#ffffff') },
    uAmb: { value: lin('#000000') },
    uHi: { value: lin('#ffffff') },
    uFogColor: { value: lin('#000000') },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    /** Canopy radius (grows with the family) and height: the shadow the leaves cast. */
    uCanR: { value: 10 },
    uCanY: { value: 14 },
    uFocus: { value: 0 },
    /** Leaves dissolve (dithered) nearer the camera than this range, wood at half of it, so a fly-to never ends inside a wall of leaves. */
    uNear: { value: new Vector2(8, 18) },
  };
}
export type Rig = ReturnType<typeof lightRig>;

export function setRig(R: Rig, L: BanyanLook) {
  R.uSunDir.value.set(...L.sunDir).normalize();
  R.uSunCol.value.copy(lin(L.sun)).multiplyScalar(L.dark ? 1.15 : 1.25);
  R.uSky.value.copy(lin(L.sky));
  R.uAmb.value.copy(lin(L.amb));
  R.uHi.value.copy(lin(L.hi));
  R.uFogColor.value.copy(lin(L.fog));
}

const RIG = /* glsl */ `
  uniform vec3 uSunDir, uSunCol, uSky, uAmb, uHi, uFogColor; uniform float uFogNear, uFogFar, uCanR, uCanY, uFocus; uniform vec2 uNear;
  uniform float uYear, uEnter, uMinYear, uTime;
  ${NOISE}
  // Sunlight that reaches a point through the leaves: x = light (0..1+), y = under the canopy.
  vec2 dapple(vec3 w) {
    vec3 L = normalize(uSunDir);
    vec2 q = w.xz + L.xz / max(L.y, .45) * (uCanY - w.y) * .4;
    float r = length(q);
    float edge = noise(q * .06) * .18;
    float under = (1. - smoothstep(uCanR * (.86 + edge), uCanR * (1.04 + edge), r)) * (1. - smoothstep(uCanY - 1., uCanY + 3., w.y));
    vec2 m = q * .42 + vec2(uTime * .05, uTime * .03);
    float n = noise(m) * .5 + noise(m * 2.3 + 4.1 - uTime * .04) * .32 + noise(m * 5.3) * .18;
    float spot = smoothstep(.58, .76, n);
    return vec2(mix(1., .3 + spot * .8, under), under);
  }
  vec3 fogged(vec3 c, float depth) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth)); }
  float yrNow() { return mix(uMinYear - 3., uYear, uEnter); }
  bool nearCut(vec3 w, float k) { return hash(floor(gl_FragCoord.xy)) > smoothstep(uNear.x * k, uNear.y * k, distance(cameraPosition, w)); }`;

const WOOD_VERT = /* glsl */ `
  attribute vec3 aC, aCol; attribute float aT, aS, aU, aBirth, aGrow, aThin, aHi;
  uniform float uYear, uEnter, uMinYear, uTime, uMature, uSway;
  varying float vT, vS, vU, vBirth, vGrow, vHi, vDepth; varying vec3 vN, vW, vCol;
  void main() {
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float k = mix(aThin, 1., smoothstep(aBirth, aBirth + uMature, yr));
    vec3 p = aC + (position - aC) * k;
    p.xz += uSway * aT * aT * vec2(sin(uTime * .7 + aBirth * 1.3 + aC.y * .3), cos(uTime * .55 + aBirth + aC.y * .2));
    vT = aT; vS = aS; vU = aU; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vCol = aCol;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;

const WOOD_HEAD = /* glsl */ `varying float vT, vS, vU, vBirth, vGrow, vHi, vDepth; varying vec3 vN, vW, vCol;`;

/** Seamless noise around a tube (blends across the u = 0/1 seam). */
const PNOISE = /* glsl */ `float pn(float u, float s, float k) { return mix(noise(vec2(u * k, s)), noise(vec2((u - 1.) * k, s)), u); }`;

/** Banyan bark: pale fluted wood, knots and lenticels, moss at the foot, dappled sun; lineage glows marigold. */
export function barkMat(U: Shared, R: Rig) {
  const uni = {
    ...U,
    ...R,
    uMature: { value: 30 },
    uSway: { value: 0 },
    uBarkA: { value: lin('#000000') },
    uBarkB: { value: lin('#000000') },
    uMoss: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: WOOD_VERT,
    fragmentShader: /* glsl */ `${RIG} ${WOOD_HEAD} ${PNOISE} uniform vec3 uBarkA, uBarkB, uMoss;
      void main() {
        float yr = yrNow(); float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g || nearCut(vW, .45)) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSunDir);
        float wob = pn(vU, vS * .07, 5.) * 2.6;
        float flute = .5 + .5 * sin(vU * 6.2832 * 9. + wob * 2.4);
        flute = flute * flute * (3. - 2. * flute);
        float fine = pn(vU, vS * 1.1, 34.);
        float broad = pn(vU, vS * .04 + vBirth * .01, 3.);
        float knot = smoothstep(.74, .9, pn(vU, vS * .3 + 3., 8.));
        float dots = step(.9, pn(vU, vS * 2.6, 46.));
        vec3 base = mix(uBarkA, uBarkB, clamp(flute * .4 + fine * .3 + broad * .45, 0., 1.));
        base = mix(base, uBarkA * .55, knot * .7) + dots * .06;
        float moss = smoothstep(2.6, .2, vW.y) * smoothstep(.35, .7, pn(vU, vS * .2, 6.));
        base = mix(base, uMoss, moss * .65);
        vec2 d = dapple(vW);
        float dif = max(dot(n, L) * .8 + .2, 0.) * d.x;
        vec3 hemi = mix(uAmb, uSky, n.y * .5 + .5);
        float groove = .5 + .5 * fine;
        vec3 col = base * (hemi * .62 + uSunCol * dif) * (.5 + .38 * flute + .2 * groove);
        float rim = pow(1. - max(dot(n, V), 0.), 3.) * max(dot(-V, L) * .5 + .5, 0.);
        col += uSunCol * base * rim * .5 * d.x;
        float flow = smoothstep(.88, 1., fract(vS * .06 - uTime * .35));
        col = mix(col, col * 1.08 + uHi * (.05 + flow * .4), vHi);
        col = mix(col, col * .38, uFocus * (1. - step(.5, vHi)));
        col += uHi * 1.6 * smoothstep(g - .04, g, vT) * (1. - step(.999, g));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Hanging aerial rootlets: reddish young tips, sway in the breeze, lengthen over the years. */
export function rootletMat(U: Shared, R: Rig) {
  const uni = {
    ...U,
    ...R,
    uMature: { value: 6 },
    uSway: { value: 0.35 },
    uRootA: { value: lin('#000000') },
    uRootB: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: WOOD_VERT,
    fragmentShader: /* glsl */ `${RIG} ${WOOD_HEAD} uniform vec3 uRootA, uRootB;
      void main() {
        float yr = yrNow(); float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g || nearCut(vW, .45)) discard;
        vec3 n = normalize(vN), L = normalize(uSunDir);
        vec3 base = mix(uRootA, uRootB, smoothstep(.2, 1., vT) * .8 + noise(vec2(vS * 2., vBirth)) * .2);
        vec2 d = dapple(vW);
        float dif = max(dot(n, L) * .6 + .4, 0.) * d.x;
        vec3 col = base * (mix(uAmb, uSky, .5) * .6 + uSunCol * dif * .9);
        col = mix(col, col * 1.2 + uHi * .3, vHi);
        col = mix(col, col * .38, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Prayer threads (kalava) round the trunk: vertex colours with a cotton sheen. */
export function threadMat(U: Shared, R: Rig) {
  const uni = { ...U, ...R, uMature: { value: 1 }, uSway: { value: 0 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: WOOD_VERT,
    fragmentShader: /* glsl */ `${RIG} ${WOOD_HEAD}
      void main() {
        float yr = yrNow(); float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g || nearCut(vW, .45)) discard;
        vec3 n = normalize(vN), L = normalize(uSunDir);
        float twist = .8 + .2 * sin(vS * 40. + vU * 6.2832);
        vec2 d = dapple(vW);
        vec3 col = vCol * (mix(uAmb, uSky, .5) * .7 + uSunCol * max(dot(n, L) * .7 + .3, 0.) * d.x) * twist;
        col = mix(col, col * .45, uFocus);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Instanced leaves: leathery ovals around each clump, translucent when the sun is behind them. */
export function leafMat(U: Shared, R: Rig, tex: Texture) {
  const uni = {
    ...U,
    ...R,
    uLeaf: { value: tex },
    uLeafA: { value: lin('#000000') },
    uLeafB: { value: lin('#000000') },
    uVein: { value: lin('#000000') },
    uOld: { value: lin('#000000') },
  };
  const mat = new ShaderMaterial({
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aDeath, aPhase, aVar, aAO, aHi; attribute vec3 aN;
      uniform float uYear, uEnter, uMinYear, uTime;
      varying vec2 vUv; varying vec3 vN, vW; varying float vVar, vAO, vHi, vOld, vDepth;
      void main() { vUv = uv; float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(aBirth, aBirth + 2.5, yr);
        vec3 p = position * grow;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        float gust = sin(uTime * .9 + w.x * .04 + w.z * .03) * .5 + .5;
        w.xyz += aN * sin(uTime * 1.7 + aPhase) * .07 * grow;
        w.x += sin(uTime * 1.2 + aPhase) * .12 * gust * grow; w.y += cos(uTime * 1.5 + aPhase * 1.3) * .06 * grow;
        vN = aN; vW = w.xyz; vVar = aVar; vAO = aAO; vHi = aHi; vOld = step(aDeath, yr);
        vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform sampler2D uLeaf; uniform vec3 uLeafA, uLeafB, uVein, uOld;
      varying vec2 vUv; varying vec3 vN, vW; varying float vVar, vAO, vHi, vOld, vDepth;
      void main() { vec4 tx = texture2D(uLeaf, vUv); if (tx.a < .5 || nearCut(vW, 1.)) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSunDir);
        vec3 base = mix(uLeafA, uLeafB, clamp(vVar * .75 + vUv.y * .25, 0., 1.));
        base = mix(base, uVein, (1. - tx.r) * .55);
        base = mix(base, uOld, vOld * .12);
        float lit = clamp(dot(n, L) * .7 + .3, 0., 1.) * mix(.25, 1., vAO) * smoothstep(-.6, .4, n.y);
        float back = pow(max(dot(-V, L), 0.), 6.) * vAO * smoothstep(-.2, .5, n.y);
        vec3 hemi = mix(uAmb, uSky, n.y * .5 + .5);
        vec3 col = base * (hemi * (.25 + .35 * vAO) + uSunCol * lit) + uLeafB * uSunCol * back * .45;
        col += uSunCol * .25 * smoothstep(.8, 1., lit) * vVar;
        col = mix(col, col * 1.06 + uHi * .07, vHi);
        col = mix(col, col * .42, uFocus * (1. - step(.5, vHi)));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Swept earth under the tree: dust, sparse grass beyond the canopy, a dappled leaf shadow with a warm fringe. */
export function groundMat(R: Rig, U: Shared, trunkR: number, reach: number) {
  const uni = {
    ...U,
    ...R,
    uSoil: { value: lin('#000000') },
    uSoil2: { value: lin('#000000') },
    uGrass: { value: lin('#000000') },
    uHor: { value: lin('#000000') },
    uTrunk: { value: trunkR },
    uReach: { value: reach },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: `varying vec3 vW; varying float vDepth; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uSoil, uSoil2, uGrass, uHor; uniform float uTrunk, uReach; varying vec3 vW; varying float vDepth;
      void main() { vec2 p = vW.xz; float r = length(p);
        float n1 = noise(p * .07), n2 = noise(p * .55), n3 = noise(p * 2.2);
        vec3 c = mix(uSoil, uSoil2, n1 * .6 + n2 * .25 + n3 * .15);
        float grass = smoothstep(.42, .72, noise(p * .045 + 7.) * .7 + n3 * .3) * smoothstep(uCanR * .7, uCanR * 1.25, r);
        c = mix(c, uGrass, grass * .75);
        vec2 d = dapple(vec3(p.x, 0., p.y));
        float fringe = smoothstep(.3, .55, d.x) * (1. - smoothstep(.7, 1.05, d.x)) * d.y;
        vec3 col = c * (mix(uAmb, uSky, .6) * .55 + uSunCol * d.x * .8) + uSunCol * c * fringe * .35;
        col *= 1. - .45 * exp(-r * r / (uTrunk * uTrunk * 5.));
        col = mix(col, uHor, smoothstep(uReach * .9, uReach * 2.2, r));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Sandstone chabutro: coursed blocks, a worn top, a vermilion band on the rim. */
export function stoneMat(U: Shared, R: Rig) {
  const uni = {
    ...U,
    ...R,
    uStoneA: { value: lin('#000000') },
    uStoneB: { value: lin('#000000') },
    uBand: { value: lin('#c2321f') },
    uBandY: { value: 1 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: `varying vec3 vN, vW; varying float vDepth; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uStoneA, uStoneB, uBand; uniform float uBandY; varying vec3 vN, vW; varying float vDepth;
      void main() { vec3 n = normalize(vN), L = normalize(uSunDir);
        float a = atan(vW.z, vW.x) / 6.2832 + .5; float r = length(vW.xz);
        float row = floor(vW.y * 2.4); float side = 1. - step(.8, n.y);
        float cols = mix(r * .9, 48., side);
        float joint = side * max(smoothstep(.06, 0., abs(fract(vW.y * 2.4) - .5) - .44), smoothstep(.05, 0., abs(fract(a * cols + row * .5) - .5) - .45));
        float slab = (1. - side) * smoothstep(.05, 0., abs(fract(r * .5 + noise(vW.xz * .3) * .4) - .5) - .46);
        vec3 c = mix(uStoneA, uStoneB, noise(vW.xz * 1.3 + vW.y) * .5 + noise(vec2(a * 40., vW.y * 3.)) * .3 + (1. - side) * .25);
        c *= 1. - (joint + slab) * .35;
        float band = side * smoothstep(.02, 0., abs(vW.y - uBandY) - .07);
        c = mix(c, uBand, band * .8);
        vec2 d = dapple(vW);
        vec3 col = c * (mix(uAmb, uSky, n.y * .5 + .5) * .6 + uSunCol * max(dot(n, L) * .8 + .2, 0.) * d.x);
        col = mix(col, col * .5, uFocus);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Figs: small round red points that ripen in the canopy. */
export function figMat(U: Shared, R: Rig) {
  const uni = { ...U, ...R, uFig: { value: lin('#000000') }, uPx: { value: 600 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aVar; uniform float uYear, uEnter, uMinYear, uPx; varying float vVar, vDepth, vG;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float g = smoothstep(aBirth, aBirth + 2., yr); vG = g;
        vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; vVar = aVar;
        gl_PointSize = min(g * (.32 + aVar * .16) * uPx / vDepth, 9.) * smoothstep(4., 12., vDepth); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uFig; varying float vVar, vDepth, vG;
      void main() { vec2 q = gl_PointCoord - .5; float r = length(q); if (r > .5 || vG < .05) discard;
        vec3 c = uFig * (.7 + vVar * .5) * (1.15 - r * 1.2) + uSunCol * .25 * smoothstep(.2, 0., length(q + vec2(.15, .15)));
        c = mix(c, c * .4, uFocus);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Fireflies (moonlit grove) or golden dust in the sunbeams, plus diya flames on the platform. */
export function glowMat(U: Shared, tex: Texture) {
  const uni = {
    uTime: U.uTime,
    uFly: { value: lin('#000000') as Color },
    uFlame: { value: lin('#000000') as Color },
    uTex: { value: tex },
    uAdd: { value: 1 },
    uPx: { value: 600 },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh, aKind; uniform float uTime, uAdd, uPx; varying float vA, vKind;
      void main() { vec3 p = position; vKind = aKind;
        if (aKind < .5) { p.y += sin(uTime * .35 + aPh) * 1.4; p.x += cos(uTime * .27 + aPh * 1.7) * 1.6; p.z += sin(uTime * .31 + aPh * 2.3) * 1.6;
          vA = uAdd > .5 ? pow(.5 + .5 * sin(uTime * 1.3 + aPh * 3.), 3.) : .55 + .45 * sin(uTime * .8 + aPh); }
        else vA = .8 + .2 * sin(uTime * 11. + aPh * 5.) * sin(uTime * 7.3 + aPh);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float s = aKind < .5 ? (uAdd > .5 ? .9 : .28) : 1.1;
        gl_PointSize = clamp(s * uPx / -mv.z, 1., 40.); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform vec3 uFly, uFlame; uniform float uAdd; varying float vA, vKind;
      void main() { vec2 q = gl_PointCoord; if (vKind > .5) q.y = (q.y - .5) * .7 + .5;
        float a = texture2D(uTex, q).a * vA; vec3 c = vKind > .5 ? uFlame : uFly;
        gl_FragColor = uAdd > .5 ? vec4(c * a * 1.8, 1.) : vec4(c, a * (vKind > .5 ? 1. : .5)); }`,
  });
  const setAdd = (on: boolean) => {
    uni.uAdd.value = on ? 1 : 0;
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setAdd };
}
