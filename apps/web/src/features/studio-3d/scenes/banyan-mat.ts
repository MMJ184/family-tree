import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { DOME_VERT, LINEAGE, REF_PX } from './tree-gl.ts';

// Banyan materials: fluted bark that thickens with age, swaying aerial rootlets, leathery
// leaves, the ground under a dappled canopy shadow, a stone chabutro, prayer threads, figs,
// fireflies, hanging lanterns and diya flames. One shared light rig (moon or sun, sky, canopy)
// is referenced by every material, so tint() updates them all.

export interface BanyanLook {
  dark: boolean;
  /** Backdrop and fog, as display colours (untoned). */
  top: string;
  hor: string;
  fog: string;
  dim: string;
  sun: string;
  sunI: number;
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
  hi: string;
  gold: string;
  stoneA: string;
  stoneB: string;
  fly: string;
  flame: string;
  lantern: string;
  fig: string;
  bloom: number;
  exposure: number;
}

/** Scene palette (sRGB hex). Signature: moonlit bark, deep canopy green, warm lantern amber (night); pale bark, deep green (day). */
export const LOOK: { light: BanyanLook; dark: BanyanLook } = {
  dark: {
    dark: true,
    top: '#000000',
    hor: '#050505',
    fog: '#050505',
    dim: '#050505',
    sun: '#c7cfdc',
    sunI: 1.3,
    sunDir: [-0.35, 0.85, 0.4],
    sky: '#6e747d',
    amb: '#34383e',
    barkA: '#252321',
    barkB: '#99928a',
    moss: '#28301f',
    rootA: '#2b2622',
    rootB: '#6e655d',
    leafA: '#0b150d',
    leafB: '#3d5f3a',
    vein: '#6f8a5f',
    old: '#5c5032',
    soil: '#121212',
    soil2: '#0a0a0a',
    grass: '#11140f',
    hi: '#4fd1bd',
    gold: '#e2b65a',
    stoneA: '#2a2927',
    stoneB: '#5d5a55',
    fly: '#ffcc80',
    flame: '#ffa24a',
    lantern: '#ffb35c',
    fig: '#4d1f18',
    bloom: 0.45,
    exposure: 1.0,
  },
  light: {
    dark: false,
    top: '#ffffff',
    hor: '#f2f2f2',
    fog: '#f2f2f2',
    dim: '#f2f2f2',
    sun: '#fffaf3',
    sunI: 1.25,
    sunDir: [-0.45, 0.8, 0.35],
    sky: '#ffffff',
    amb: '#8f8f8f',
    barkA: '#6c675f',
    barkB: '#cdc7bc',
    moss: '#6f7c4c',
    rootA: '#7b7166',
    rootB: '#bcb2a6',
    leafA: '#123019',
    leafB: '#557f43',
    vein: '#a9c48a',
    old: '#b39a5a',
    soil: '#eeeeee',
    soil2: '#e3e3e3',
    grass: '#d9ddd3',
    hi: '#0f6b63',
    gold: '#b7862c',
    stoneA: '#b9b3a9',
    stoneB: '#e7e2da',
    fly: '#8a8174',
    flame: '#ff9a2e',
    lantern: '#b8322a',
    fig: '#a8432c',
    // No bloom by day: the white stage would bleed over everything.
    bloom: 0,
    exposure: 1.0,
  },
};

/** The light rig every banyan material shares (uniform objects are shared by reference). */
export function lightRig() {
  return {
    uSunDir: { value: new Vector3(-0.7, 0.4, -0.3).normalize() },
    uSunCol: { value: new Color('#ffffff') },
    uSky: { value: new Color('#ffffff') },
    uAmb: { value: new Color('#000000') },
    uHi: { value: new Color('#ffffff') },
    uGold: { value: new Color('#ffffff') },
    uFogColor: { value: new Color('#000000') },
    uDimCol: { value: new Color('#000000') },
    uFogNear: { value: 200 },
    uFogFar: { value: 900 },
    /** Canopy footprint (half width, half depth) as it grows with the family, and its height. */
    uCan: { value: new Vector2(10, 10) },
    uCanY: { value: 14 },
    uDark: { value: 1 },
    uFocus: { value: 0 },
    /** Leaves dissolve (dithered) nearer the camera than this range, wood at half of it, so a fly-to never ends inside a wall of leaves. */
    uNear: { value: new Vector2(8, 18) },
  };
}
export type Rig = ReturnType<typeof lightRig>;

export function setRig(R: Rig, L: BanyanLook, plain: (hex: string) => Color, scene: (hex: string) => Color) {
  R.uSunDir.value.set(...L.sunDir).normalize();
  R.uSunCol.value.copy(plain(L.sun)).multiplyScalar(L.sunI);
  R.uSky.value.copy(plain(L.sky));
  R.uAmb.value.copy(plain(L.amb));
  R.uHi.value.copy(plain(L.hi));
  R.uGold.value.copy(plain(L.gold));
  R.uFogColor.value.copy(scene(L.fog));
  R.uDimCol.value.copy(scene(L.dim));
  R.uDark.value = L.dark ? 1 : 0;
}

const RIG = /* glsl */ `
  uniform vec3 uSunDir, uSunCol, uSky, uAmb, uHi, uGold, uFogColor, uDimCol; uniform float uFogNear, uFogFar, uCanY, uDark, uFocus;
  uniform vec2 uNear, uCan;
  uniform float uYear, uEnter, uMinYear, uTime;
  ${NOISE}
  // Light that reaches a point through the leaves: x = light (0..1+), y = under the canopy.
  vec2 dapple(vec3 w) {
    vec3 L = normalize(uSunDir);
    vec2 q = w.xz + L.xz / max(L.y, .45) * (uCanY - w.y) * .4;
    float r = length(q / max(uCan, vec2(1.)));
    float edge = noise(q * .06) * .18;
    float under = (1. - smoothstep(.86 + edge, 1.04 + edge, r)) * (1. - smoothstep(uCanY - 1., uCanY + 3., w.y));
    vec2 m = q * .42 + vec2(uTime * .05, uTime * .03);
    float n = noise(m) * .5 + noise(m * 2.3 + 4.1 - uTime * .04) * .32 + noise(m * 5.3) * .18;
    float spot = smoothstep(.58, .76, n);
    return vec2(mix(1., .3 + spot * .8, under), under);
  }
  vec3 fogged(vec3 c, float depth) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth)); }
  vec3 dimmed(vec3 c, float hi) { return mix(c, uDimCol, uFocus * (1. - step(.5, hi)) * mix(.5, .62, uDark)); }
  float yrNow() { return mix(uMinYear - 3., uYear, uEnter); }
  bool nearCut(vec3 w, float k) { return hash(floor(gl_FragCoord.xy)) > smoothstep(uNear.x * k, uNear.y * k, distance(cameraPosition, w)); }`;

const WOOD_VERT = /* glsl */ `
  attribute vec3 aC, aCol; attribute float aT, aS, aU, aBirth, aGrow, aThin, aHi;
  uniform float uYear, uEnter, uMinYear, uTime, uMature, uSway;
  varying float vT, vS, vU, vBirth, vGrow, vHi, vDepth, vRad; varying vec3 vN, vW, vCol;
  void main() {
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float k = mix(aThin, 1., smoothstep(aBirth, aBirth + uMature, yr));
    vec3 p = aC + (position - aC) * k;
    vRad = length(position - aC) * k;
    p.xz += uSway * aT * aT * vec2(sin(uTime * .7 + aBirth * 1.3 + aC.y * .3), cos(uTime * .55 + aBirth + aC.y * .2));
    vT = aT; vS = aS; vU = aU; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vCol = aCol;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;

const WOOD_HEAD = /* glsl */ `varying float vT, vS, vU, vBirth, vGrow, vHi, vDepth, vRad; varying vec3 vN, vW, vCol;`;

/** Seamless noise around a tube (blends across the u = 0/1 seam). */
const PNOISE = /* glsl */ `float pn(float u, float s, float k) { return mix(noise(vec2(u * k, s)), noise(vec2((u - 1.) * k, s)), u); }`;

/** Banyan bark: fluted wood, knots and lenticels, moss at the foot, dappled light; the lineage carries a teal current. */
export function barkMat(U: Shared, R: Rig) {
  const uni = {
    ...U,
    ...R,
    uMature: { value: 30 },
    uSway: { value: 0 },
    uBarkA: { value: new Color() },
    uBarkB: { value: new Color() },
    uMoss: { value: new Color() },
    /** Wood radius from which the lineage shows only as a current and an edge (thin to thick). */
    uThick: { value: new Vector2(0.3, 0.8) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: WOOD_VERT,
    fragmentShader: /* glsl */ `${RIG} ${WOOD_HEAD} ${PNOISE} ${LINEAGE} uniform vec3 uBarkA, uBarkB, uMoss; uniform vec2 uThick;
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
        base = mix(base, uBarkA * .55, knot * .7) + dots * .04;
        float moss = (1. - smoothstep(.2, 2.6, vW.y)) * smoothstep(.35, .7, pn(vU, vS * .2, 6.));
        base = mix(base, uMoss, moss * .65);
        vec2 d = dapple(vW);
        float dif = max(dot(n, L) * .8 + .2, 0.) * d.x;
        vec3 hemi = mix(uAmb, uSky, n.y * .5 + .5);
        float groove = .5 + .5 * fine;
        vec3 col = base * (hemi * .62 + uSunCol * dif) * (.5 + .38 * flute + .2 * groove);
        float rim = pow(clamp(1. - dot(n, V), 0., 1.), 3.) * max(dot(-V, L) * .5 + .5, 0.);
        col += uSunCol * base * rim * .5 * d.x;
        float flow = smoothstep(.86, 1., fract(vS * .07 - uTime * .32 + vBirth * .13));
        col = lineage(col, uHi, uGold, vHi, 0., flow, smoothstep(uThick.x, uThick.y, vRad), pow(clamp(1. - abs(dot(n, V)), 0., 1.), 2.), uDark);
        col = dimmed(col, vHi);
        col = mix(col, uHi * (uDark > .5 ? 2. : 1.), smoothstep(g - .05, g, vT) * (1. - step(.999, g)) * .8);
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
    uRootA: { value: new Color() },
    uRootB: { value: new Color() },
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
        col = dimmed(col, 0.);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Threads: prayer threads (kalava) round the trunk and lantern cords use their vertex colour; marriage twigs (red < 0) are gold. */
export function threadMat(U: Shared, R: Rig) {
  const uni = { ...U, ...R, uMature: { value: 1 }, uSway: { value: 0 } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: WOOD_VERT,
    fragmentShader: /* glsl */ `${RIG} ${WOOD_HEAD}
      void main() {
        float yr = yrNow(); float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g || nearCut(vW, .45)) discard;
        vec3 n = normalize(vN), L = normalize(uSunDir);
        float gold = step(vCol.r, -.5);
        vec3 base = mix(vCol, uGold, gold);
        float twist = .8 + .2 * sin(vS * 40. + vU * 6.2832);
        vec2 d = dapple(vW);
        vec3 col = base * (mix(uAmb, uSky, .5) * .7 + uSunCol * max(dot(n, L) * .7 + .3, 0.) * d.x) * mix(twist, 1., gold);
        col += uGold * gold * uDark * .18;
        col = dimmed(col, gold * vHi);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Instanced leaves: leathery ovals round each clump, translucent when the light is behind them. */
export function leafMat(U: Shared, R: Rig, tex: Texture) {
  const uni = {
    ...U,
    ...R,
    uLeaf: { value: tex },
    uLeafA: { value: new Color() },
    uLeafB: { value: new Color() },
    uVein: { value: new Color() },
    uOld: { value: new Color() },
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
        // Seen from above the canopy (the top view), whole leaves drop out so the family below shows through.
        if (vVar < smoothstep(uCanY + 2., uCanY + 14., cameraPosition.y) * .85) discard;
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSunDir);
        vec3 base = mix(uLeafA, uLeafB, clamp(vVar * .75 + vUv.y * .25, 0., 1.));
        base = mix(base, uVein, (1. - tx.r) * .45);
        base = mix(base, uOld, vOld * .12);
        float lit = clamp(dot(n, L) * .7 + .3, 0., 1.) * mix(.25, 1., vAO) * smoothstep(-.6, .4, n.y);
        float back = pow(max(dot(-V, L), 0.), 4.) * vAO;
        vec3 hemi = mix(uAmb, uSky, n.y * .5 + .5);
        vec3 col = base * (hemi * (.25 + .35 * vAO) + uSunCol * lit) + uLeafB * uSunCol * back * .5;
        col += uSunCol * .2 * smoothstep(.8, 1., lit) * vVar;
        col = dimmed(col, vHi);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Ground under the tree: soil, sparse grass beyond the canopy, the canopy's dappled shadow; mist far off. */
export function groundMat(R: Rig, U: Shared, trunk: Vector3) {
  const uni = {
    ...U,
    ...R,
    uSoil: { value: new Color() },
    uSoil2: { value: new Color() },
    uGrass: { value: new Color() },
    /** Trunk position (x, z) and radius. */
    uTrunk: { value: trunk },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: `varying vec3 vW; varying float vDepth; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uSoil, uSoil2, uGrass, uTrunk; varying vec3 vW; varying float vDepth;
      void main() { vec2 p = vW.xz; float r = length(p / max(uCan, vec2(1.)));
        float n1 = noise(p * .07), n2 = noise(p * .55), n3 = noise(p * 2.2);
        vec3 c = mix(uSoil, uSoil2, n1 * .6 + n2 * .25 + n3 * .15);
        float grass = smoothstep(.42, .72, noise(p * .045 + 7.) * .7 + n3 * .3) * smoothstep(.75, 1.3, r);
        c = mix(c, uGrass, grass * .6);
        vec2 d = dapple(vec3(p.x, 0., p.y));
        vec3 lightC = mix(uAmb, uSky, .6) * .55 + uSunCol * d.x * .8;
        vec3 col = uDark > .5 ? c * lightC : mix(c, c * lightC * .9, .65 * d.y + .25 * (1. - d.x));
        float tr = length(p - uTrunk.xy);
        col *= 1. - .45 * exp(-tr * tr / (uTrunk.z * uTrunk.z * 5.));
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Stone chabutro: coursed blocks, a worn top, a vermilion band on the rim. */
export function stoneMat(U: Shared, R: Rig) {
  const uni = {
    ...U,
    ...R,
    uStoneA: { value: new Color() },
    uStoneB: { value: new Color() },
    uBand: { value: new Color('#b0301f') },
    uBandY: { value: 1 },
    uCentre: { value: new Vector2() },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: `varying vec3 vN, vW; varying float vDepth; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uStoneA, uStoneB, uBand; uniform float uBandY; uniform vec2 uCentre; varying vec3 vN, vW; varying float vDepth;
      void main() { vec3 n = normalize(vN), L = normalize(uSunDir);
        vec2 q = vW.xz - uCentre;
        float a = atan(q.y, abs(q.x) < 1e-6 ? 1e-6 : q.x) / 6.2832 + .5; float r = length(q);
        float row = floor(vW.y * 2.4); float side = 1. - step(.8, n.y);
        float cols = mix(r * .9, 48., side);
        float joint = side * max((1. - smoothstep(0., .06, abs(fract(vW.y * 2.4) - .5) - .44)), (1. - smoothstep(0., .05, abs(fract(a * cols + row * .5) - .5) - .45)));
        float slab = (1. - side) * (1. - smoothstep(0., .05, abs(fract(r * .5 + noise(vW.xz * .3) * .4) - .5) - .46));
        vec3 c = mix(uStoneA, uStoneB, noise(vW.xz * 1.3 + vW.y) * .5 + noise(vec2(dot(q, vec2(1.9, 1.3)), vW.y * 3.)) * .3 + (1. - side) * .25);
        c *= 1. - (joint + slab) * .35;
        float band = side * (1. - smoothstep(0., .02, abs(vW.y - uBandY) - .07));
        c = mix(c, uBand, band * .8);
        vec2 d = dapple(vW);
        vec3 col = c * (mix(uAmb, uSky, n.y * .5 + .5) * .6 + uSunCol * max(dot(n, L) * .8 + .2, 0.) * d.x);
        col = mix(col, uDimCol, uFocus * .4);
        gl_FragColor = vec4(fogged(col, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Figs: small round red points that ripen in the canopy. */
export function figMat(U: Shared, R: Rig) {
  const uni = { ...U, ...R, uFig: { value: new Color() }, uPx: { value: REF_PX } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aVar; uniform float uYear, uEnter, uMinYear, uPx; varying float vVar, vDepth, vG;
      void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float g = smoothstep(aBirth, aBirth + 2., yr); vG = g;
        vec4 mv = modelViewMatrix * vec4(position, 1.); vDepth = -mv.z; vVar = aVar;
        gl_PointSize = min(g * (.2 + aVar * .1) * uPx / max(vDepth, .1), 9. * uPx / ${REF_PX.toFixed(1)}) * smoothstep(4., 12., vDepth); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${RIG} uniform vec3 uFig; varying float vVar, vDepth, vG;
      void main() { vec2 q = gl_PointCoord - .5; float r = length(q); if (r > .5 || vG < .05) discard;
        vec3 c = uFig * (.7 + vVar * .5) * (1.15 - r * 1.2) + uSunCol * .25 * (1. - smoothstep(0., .2, length(q + vec2(.15, .15))));
        c = mix(c, uDimCol, uFocus * .5);
        gl_FragColor = vec4(fogged(c, vDepth), 1.); }`,
  });
  return { mat, uni };
}

/** Glows: fireflies (night) or dust in the light (day), diya flames on the platform, and paper lanterns hanging under the canopy. */
export function glowMat(U: Shared, tex: Texture) {
  const uni = {
    uTime: U.uTime,
    uYear: U.uYear,
    uEnter: U.uEnter,
    uMinYear: U.uMinYear,
    uFly: { value: new Color() },
    uFlame: { value: new Color() },
    uLantern: { value: new Color() },
    uTex: { value: tex },
    uAdd: { value: 1 },
    uPx: { value: REF_PX },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh, aKind, aBirth; uniform float uTime, uAdd, uPx, uYear, uEnter, uMinYear; varying float vA, vKind;
      void main() { vec3 p = position; vKind = aKind;
        float on = smoothstep(aBirth, aBirth + 1.5, mix(uMinYear - 3., uYear, uEnter));
        if (aKind < .5) { p.y += sin(uTime * .35 + aPh) * 1.4; p.x += cos(uTime * .27 + aPh * 1.7) * 1.6; p.z += sin(uTime * .31 + aPh * 2.3) * 1.6;
          vA = uAdd > .5 ? pow(max(.5 + .5 * sin(uTime * 1.3 + aPh * 3.), 0.), 3.) : .55 + .45 * sin(uTime * .8 + aPh); }
        else if (aKind < 1.5) vA = .8 + .2 * sin(uTime * 11. + aPh * 5.) * sin(uTime * 7.3 + aPh);
        else { p.x += sin(uTime * .6 + aPh) * .08; vA = (.85 + .15 * sin(uTime * 3.1 + aPh * 4.) * sin(uTime * 5.3 + aPh)) * on; }
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float s = aKind < .5 ? (uAdd > .5 ? .9 : .28) : aKind < 1.5 ? 1.1 : (uAdd > .5 ? 1.5 : 1.25);
        float k = uPx / ${REF_PX.toFixed(1)};
        gl_PointSize = clamp(s * uPx * .622 / max(-mv.z, .1), k, 48. * k); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform vec3 uFly, uFlame, uLantern; uniform float uAdd; varying float vA, vKind;
      void main() { vec2 q = gl_PointCoord; if (vKind > .5 && vKind < 1.5) q.y = (q.y - .5) * .7 + .5;
        if (vKind > 1.5 && uAdd < .5) {
          // By day a lantern is an unlit paper globe: cream paper, vermilion caps, a soft shade on its far side.
          vec2 c = gl_PointCoord - .5; float r = length(c * vec2(1.15, .9)); if (r > .45 || vA < .02) discard;
          float cap = smoothstep(.3, .34, abs(c.y));
          float rib = (1. - smoothstep(0., .035, abs(fract(c.y * 6. + .5) - .5))) * .08;
          vec3 paper = vec3(.86, .82, .74) * (1.08 - r * .7 + (c.x < 0. ? .05 : -.05)) - rib;
          gl_FragColor = vec4(mix(paper, uLantern, cap), 1.); return; }
        float a = texture2D(uTex, q).a * vA; vec3 c = vKind > 1.5 ? uLantern : vKind > .5 ? uFlame : uFly;
        // A lantern: a small paper globe glowing from inside, with a soft halo.
        float core = vKind > 1.5 ? (1. - smoothstep(.1, .2, length((gl_PointCoord - .5) * vec2(1., .85)))) * vA : 0.;
        float k = vKind > 1.5 ? .7 : 1.8;
        gl_FragColor = uAdd > .5 ? vec4(c * (a * k + core * 2.2), 1.) : vec4(c, a * (vKind > .5 ? 1. : .5)); }`,
  });
  const setAdd = (on: boolean) => {
    uni.uAdd.value = on ? 1 : 0;
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setAdd };
}

/** A neutral dome: display colours untoned so they land exactly on screen. */
export function backdropMat() {
  const uni = { uTop: { value: new Color() }, uHor: { value: new Color() } };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: uni,
    vertexShader: DOME_VERT,
    fragmentShader: /* glsl */ `uniform vec3 uTop, uHor; varying vec3 vD;
      void main() { gl_FragColor = vec4(mix(uHor, uTop, smoothstep(0., .5, vD.y)), 1.); }`,
  });
  return { mat, uni };
}
