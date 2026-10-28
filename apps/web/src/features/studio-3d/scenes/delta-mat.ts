import { AdditiveBlending, BackSide, DoubleSide, NormalBlending, ShaderMaterial, Vector2, Vector3 } from 'three';
import { NOISE, type Shared } from '../gl.ts';
import { lin } from '../palette.ts';

// River Delta materials: a Gulf khor seen from a drone. One ground shader (sabkha salt flats with a
// polygonal crust, pale rock hills, tidal flats, coast and sea), one water shader for every channel
// (damp levees first, then water with flow streaks running from the hills to the sea), the
// settlements' little villages, mangrove clumps along the lower channels, a light pool (night) or
// contact shadow (day) under each village, the pins under the portraits and the backdrop.
//
// Every shader works in display colours (the LOOK hexes) and converts at the very end with toPre(),
// the inverse of the engine's ACES tone mapping, so the stage edges land on #000000 / #f3f3f3 and the
// palette shows as written. Light that should bloom is added after the conversion.

export interface DeltaLook {
  night: boolean;
  /** Stage background: the world fades into it at the edges. */
  bg: string;
  /** Sabkha (salt flat) and its damp patches; crust ridges. */
  salt: string;
  saltShade: string;
  crack: string;
  /** Hills: rock and rock in shade; rim light on ridges (night). */
  rock: string;
  rockShade: string;
  rim: string;
  /** Intertidal flats, the sea near the coast and far out, glints and foam. */
  flat: string;
  seaNear: string;
  seaFar: string;
  glint: string;
  /** Channel water (signature): shallow edges, deep middle, flow streaks, the growing front. */
  shallow: string;
  deep: string;
  streak: string;
  front: string;
  /** Damp levee band along each channel. */
  bank: string;
  /** Mangroves (signature): body and lit side. */
  mangrove: string;
  mangroveLit: string;
  /** Village houses: walls, roofs, lit windows (night, signature). */
  wall: string;
  roof: string;
  window: string;
  /** Marriages (gold) and the selected lineage (teal). */
  gold: string;
  teal: string;
  pin: string;
  /** Sun or moon colour, ambient share of flat lighting. */
  light: string;
  amb: number;
  /** How far focus dims what is outside the lineage (toward the background). */
  dim: number;
  bloom: number;
  exposure: number;
}

export const LOOK: { dark: DeltaLook; light: DeltaLook } = {
  // Moonlit channels in deep blue and silver on black land; warm village lights.
  dark: {
    night: true,
    bg: '#000000',
    salt: '#121212',
    saltShade: '#0c0c0c',
    crack: '#171717',
    rock: '#161616',
    rockShade: '#070707',
    rim: '#8f98a3',
    flat: '#0d0e0f',
    seaNear: '#050607',
    seaFar: '#000000',
    glint: '#c8d2dc',
    shallow: '#24548c',
    deep: '#0d2747',
    streak: '#c8d2dc',
    front: '#e8eef4',
    bank: '#171819',
    mangrove: '#121510',
    mangroveLit: '#2b3324',
    wall: '#1e1c1a',
    roof: '#2a2724',
    window: '#ffb45a',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    pin: '#5d636b',
    light: '#c8d0da',
    amb: 0.42,
    dim: 0.62,
    bloom: 0.55,
    exposure: 1,
  },
  // Aerial delta over white salt flats: blue ink water, sage mangroves, pale rock hills.
  light: {
    night: false,
    bg: '#f3f3f3',
    salt: '#f4f4f1',
    saltShade: '#e4e4e0',
    crack: '#c9c9c4',
    rock: '#e2e2de',
    rockShade: '#b3b3af',
    rim: '#000000',
    flat: '#dfe5ea',
    seaNear: '#bccfe2',
    seaFar: '#e6ebf0',
    glint: '#ffffff',
    shallow: '#6c9fd0',
    deep: '#1d5fa6',
    streak: '#ffffff',
    front: '#123f73',
    bank: '#e2e4e2',
    mangrove: '#6b7b55',
    mangroveLit: '#8d9c74',
    wall: '#ece5d8',
    roof: '#f6f2ea',
    window: '#000000',
    gold: '#b7862c',
    teal: '#0f6b63',
    pin: '#8f8f8f',
    light: '#ffffff',
    amb: 0.56,
    dim: 0.66,
    bloom: 0,
    exposure: 1,
  },
};

/** Inverse of three's ACES Filmic (exposure / 0.6, AP1 matrices, RRT+ODT fit): display colour in, scene colour out. */
const TONE = /* glsl */ `
  uniform float uExpo;
  vec3 toPre(vec3 y) {
    y = clamp(mat3(.643038, .059269, .005962, .311187, .931436, .063929, .045775, .009295, .930118) * y, 0., .985);
    vec3 A = 1. - y * .983729, B = .0245786 - y * .432951, C = .000090537 + y * .238081;
    vec3 v = (-B + sqrt(B * B + 4. * A * C)) / (2. * A);
    return max(mat3(1.764741, -.147028, -.036337, -.675778, 1.160252, -.162436, -.088963, -.013224, 1.198773) * v, 0.) * .6 / uExpo;
  }`;

const GROW = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;

const FBM = /* glsl */ `${NOISE}
  float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }`;

/** Sine-free hashes (stable at large world coordinates) and a cheap F2-F1 Voronoi for the salt crust. */
const VORONOI = /* glsl */ `
  vec2 h22(vec2 p) { vec3 a = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); a += dot(a, a.yzx + 33.33); return fract((a.xx + a.yz) * a.zy); }
  float h12(vec2 p) { vec3 a = fract(vec3(p.xyx) * .1031); a += dot(a, a.yzx + 33.33); return fract((a.x + a.y) * a.z); }
  vec2 vor(vec2 x) {
    vec2 n = floor(x), f = fract(x); float d1 = 8., d2 = 8., id = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j)); vec2 o = h22(n + g) * .8 + .1; vec2 r = g + o - f; float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h12(n + g); } else if (d < d2) d2 = d;
    }
    return vec2(sqrt(d2) - sqrt(d1), id);
  }`;

/** Land mask shared by ground and sea: an arcuate lobe around the apex plus the mainland behind it. */
const COAST = /* glsl */ `
  float coastD(vec2 p, float n1, float n2) {
    float r = length(p), th = r > 1e-4 ? atan(p.x, p.y) : 0.;
    float lobe = uRc * (1. + (n1 - .5) * .08) * (1. - smoothstep(uHalf, uHalf + .5, abs(th)));
    float main = uZm + uRc * .07 * (n2 - .5);
    return min(r - lobe, p.y - main); }`;

/** Uniforms every material shares: theme switch, focus, sun or moon, the dim target and the tone mapping inverse. */
export function makeLight() {
  return {
    uNight: { value: 0 },
    uFocus: { value: 0 },
    uExpo: { value: 1 },
    uSun: { value: new Vector3(-0.45, 0.8, -0.4).normalize() },
    uLightCol: { value: lin('#ffffff') },
    uAmb: { value: 0.6 },
    uBg: { value: lin('#000000') },
    uDim: { value: 0.6 },
  };
}
export type Light = ReturnType<typeof makeLight>;

const HEAD = /* glsl */ `uniform float uNight, uFocus, uAmb, uDim; uniform vec3 uSun, uLightCol, uBg;`;

export function groundMat(U: Shared, L: Light) {
  const uni = {
    uTime: U.uTime,
    ...L,
    uRc: { value: 100 },
    uHalf: { value: 0.9 },
    uZm: { value: 10 },
    uH: { value: 20 },
    uCentre: { value: new Vector2() },
    uWorld: { value: new Vector2(100, 100) },
    uSalt: { value: lin('#000') },
    uSaltShade: { value: lin('#000') },
    uCrack: { value: lin('#000') },
    uRock: { value: lin('#000') },
    uRockShade: { value: lin('#000') },
    uRim: { value: lin('#000') },
    uFlat: { value: lin('#000') },
    uSeaNear: { value: lin('#000') },
    uSeaFar: { value: lin('#000') },
    uGlint: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW, vN;
      void main() { vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${HEAD}
      uniform float uTime, uRc, uHalf, uZm, uH; uniform vec2 uCentre, uWorld;
      uniform vec3 uSalt, uSaltShade, uCrack, uRock, uRockShade, uRim, uFlat, uSeaNear, uSeaFar, uGlint;
      varying vec3 vW, vN;
      ${FBM}
      ${VORONOI}
      ${COAST}
      ${TONE}
      void main() {
        vec2 p = vW.xz; vec2 q = p * (110. / uRc);
        float n1 = fbm(q * .018), n2 = fbm(q * .06 + 3.1);
        float d = coastD(p, n1, n2);
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float hgt = clamp(vW.y / uH, 0., 1.);
        // Light relative to flat ground (flat = 1): hillshade without changing the salt's own colour.
        float lam = max(dot(n, uSun), 0.) / max(uSun.y, .25);
        float lit = mix(uAmb, 1., min(lam, 1.)) + max(lam - 1., 0.) * .3;

        // Sabkha: broad damp patches, wetter toward the coast, and a two-scale polygonal salt crust that
        // fades out before its cells get smaller than a few pixels.
        float patchy = noise(q * .1 + 2.) * .65 + noise(q * .37) * .35;
        vec3 salt = mix(uSalt, uSaltShade, smoothstep(.42, .85, patchy) * .6);
        salt = mix(salt, uSaltShade, smoothstep(-uRc * .12, -uRc * .01, d) * .5);
        vec2 v1 = vor(p * .9), v2 = vor(p * .24 + 7.3);
        float px1 = length(fwidth(p * .9)), px2 = length(fwidth(p * .24));
        float e1 = (1. - smoothstep(.0, .05 + px1 * 1.2, v1.x)) * (1. - smoothstep(.1, .28, px1));
        float e2 = (1. - smoothstep(.0, .04 + px2 * 1.2, v2.x)) * (1. - smoothstep(.12, .3, px2));
        salt *= 1. + (v1.y - .5) * .035 * (1. - smoothstep(.1, .28, px1));
        float flatK = 1. - smoothstep(.01, .1, hgt);
        float ridge = smoothstep(.25, .65, noise(p * .7 + 11.));
        salt = mix(salt, uCrack, max(e1 * .55 * (.35 + .65 * ridge), e2 * .34 * (.5 + .5 * ridge)) * flatK);

        // Hills: rock with hillshade, gullies, and a moonlit rim on the ridges at night.
        float rk = smoothstep(.01, .16, hgt);
        float gully = noise(q * vec2(.5, 2.2) + 4.) * .5 + noise(q * 1.7) * .5;
        vec3 rock = mix(uRock, uRockShade, clamp(gully * .35 + (1. - n.y) * .9, 0., 1.));
        vec3 land = mix(salt, rock, rk);
        land *= mix(1., lit, max(rk, .2));
        float rim = pow(clamp(1. - dot(n, V), 0., 1.), 3.) * max(dot(n, uSun), 0.);
        land += uRim * rim * rk * uNight * .3;

        // Intertidal flats with meandering creeks, the sea, foam on the shore and glints at night.
        float tf = 1. - smoothstep(uRc * .015, uRc * .1, d);
        float creek = 1. - abs(noise(q * .32 + 3.) * 2. - 1.);
        creek = smoothstep(.9, .975, creek) * tf * smoothstep(-.5, 2., d);
        vec3 sea = mix(uSeaNear, uSeaFar, smoothstep(uRc * .03, uRc * .4, d));
        sea = mix(sea, uFlat, tf * .8);
        sea = mix(sea, uSeaNear * mix(.92, 1.6, uNight), creek * .55);
        float wav = noise(vec2(p.x * .35 + uTime * .1, p.y * .9 - uTime * .16)) * noise(p * .6 - uTime * .07);
        sea = mix(sea, uGlint, smoothstep(.62, .92, wav) * mix(.05, .04, uNight) * (1. - tf));
        float foam = 1. - smoothstep(.05, .8, abs(d - .45 - sin(uTime * .45 + n2 * 9.) * .2));
        foam *= .35 + .65 * smoothstep(.35, .7, noise(p * .45 + n1 * 4.));
        sea = mix(sea, uGlint, foam * mix(.5, .1, uNight));
        vec2 gp = p * 1.4 + vec2(0., uTime * .05); vec2 gc = floor(gp); float gh = h12(gc);
        float tw = step(.975, gh) * (1. - smoothstep(0., .28, length(fract(gp) - .5))) * (.5 + .5 * sin(uTime * 2.2 + gh * 60.));
        float near = 1. - smoothstep(uRc * .02, uRc * .16, d);
        sea += uGlint * tw * near * uNight * .3 * (1. - tf);
        vec3 c = mix(land, sea, smoothstep(-.4, .4, d));

        // The world fades into the stage background at the edges; focus washes it back.
        float wf = smoothstep(.62, 1., length((p - uCentre) / uWorld));
        c = mix(c, uBg, wf);
        c = mix(c, uBg, uFocus * uDim * .45);
        gl_FragColor = vec4(toPre(c), 1.); }`,
  });
  return { mat, uni };
}

/** Channels: levee bands (aBank 1, soft-edged) and water with streaks flowing downstream along aS. */
export function waterMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uShallow: { value: lin('#000') },
    uDeep: { value: lin('#000') },
    uStreak: { value: lin('#000') },
    uFront: { value: lin('#000') },
    uBank: { value: lin('#000') },
    uGold: { value: lin('#000') },
    uTeal: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aT, aU, aS, aW, aBirth, aGrow, aTint, aBank, aHi, aFade;
      varying float vT, vU, vS, vWd, vBirth, vGrow, vTint, vBank, vHi, vFade; varying vec3 vW;
      void main() { vT = aT; vU = aU; vS = aS; vWd = aW; vBirth = aBirth; vGrow = aGrow; vTint = aTint; vBank = aBank; vHi = aHi; vFade = aFade;
        vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${HEAD}
      uniform float uYear, uEnter, uMinYear, uTime;
      uniform vec3 uShallow, uDeep, uStreak, uFront, uBank, uGold, uTeal;
      varying float vT, vU, vS, vWd, vBirth, vGrow, vTint, vBank, vHi, vFade; varying vec3 vW;
      ${NOISE}
      ${TONE}
      void main() { ${GROW}
        float g = clamp((yr - vBirth) / vGrow, 0., 1.); if (vT > g) discard;
        float au = min(abs(vU), 1.);
        float hi = step(.5, vHi) * uFocus, off = uFocus * (1. - step(.5, vHi));
        // Fades: a tributary rises out of the salt flat, a childless wadi sinks back into it.
        float fade = mix(1., smoothstep(0., .22, vT), step(.5, vTint)) * mix(1., 1. - smoothstep(.45, 1., vT), vFade);
        vec3 c; float a; vec3 glow = vec3(0.);
        if (vBank > .5) {
          c = uBank * (.97 + noise(vec2(vS * .4, vU * 3.)) * .06);
          a = (1. - smoothstep(.5, 1., au)) * (1. - off * .5);
        } else {
          float dep = (1. - au * au) * clamp(vWd / 2.4, .35, 1.);
          vec3 water = mix(uShallow, uDeep, dep);
          water = mix(water, uGold * mix(1., .7, dep) * mix(1., .78, uNight), vTint);
          // Flow: long streaks drifting from source to sea, plus a finer, faster ripple.
          float f = noise(vec2(vU * 2.2 + vBirth * .37, (vS - uTime * 3.) * .16));
          float r = noise(vec2(vU * 6. + 3., (vS - uTime * 5.2) * .55));
          float st = (smoothstep(.62, .92, f) * .8 + smoothstep(.72, .96, r) * .3) * (.35 + dep * .65);
          vec3 lineage = mix(uTeal * mix(1., mix(.62, .36, dep), uNight), mix(uTeal, uStreak, .35), st * mix(.3, .75, uNight));
          water = mix(water, lineage, hi * (1. - vTint));
          c = mix(water, uStreak, st * mix(.3, .5, uNight) * (1. - hi * .4));
          c *= 1. - smoothstep(.7, .97, au) * mix(.22, .1, uNight);
          a = 1. - smoothstep(.84, 1., au);
          glow = (uStreak * st * .2 * (1. - vTint) * (1. - hi) + uTeal * hi * (.02 + st * .32)) * uNight;
        }
        float front = smoothstep(g - .03, g, vT) * (1. - step(.999, g)) * step(vBank, .5);
        c = mix(c, uFront, front * .3);
        c = mix(c, uBg, off * uDim);
        glow *= 1. - off * .9;
        a *= fade;
        gl_FragColor = vec4(toPre(c) + glow + uFront * front * uNight * .08, a); }`,
  });
  return { mat, uni };
}

/** Village houses: small flat-roofed cubes, white with soft shading by day, dark with warm windows at night. */
export function houseMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uWall: { value: lin('#000') },
    uRoof: { value: lin('#000') },
    uWin: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aHi, aSeed; uniform float uYear, uEnter, uMinYear;
      varying vec3 vN, vL; varying float vHi, vSeed;
      void main() { ${GROW} float k = smoothstep(aBirth - .5, aBirth + 1.5, yr);
        if (k <= 0.) { gl_Position = vec4(0., 0., -2., 1.); return; }
        vec3 lp = position; lp.y *= k;
        mat4 m = modelMatrix * instanceMatrix;
        vN = normalize(mat3(m) * normal); vL = position; vHi = aHi; vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * m * vec4(lp, 1.); }`,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uWall, uRoof, uWin;
      varying vec3 vN, vL; varying float vHi, vSeed;
      ${TONE}
      void main() { vec3 n = normalize(vN); float top = step(.6, n.y);
        float lam = max(dot(n, uSun), 0.);
        vec3 c = mix(uWall, uRoof, top) * (uAmb + (1. - uAmb) * lam) * mix(.74, 1., smoothstep(0., .7, vL.y));
        float off = uFocus * (1. - step(.5, vHi));
        vec3 glow = vec3(0.);
        if (top < .5) {
          vec2 f = abs(n.x) > .5 ? vec2(vL.z, vL.y) : vec2(vL.x, vL.y);
          float cx = floor((f.x + .5) * 2.);
          float on = step(.42, fract(sin(cx * 12.9898 + vSeed * 78.233) * 43758.5453));
          vec2 w = vec2(fract((f.x + .5) * 2.) - .5, f.y - .55);
          float win = step(abs(w.x), .2) * step(abs(w.y), .17) * on;
          float tiny = smoothstep(.12, .4, length(fwidth(f)));
          glow = uWin * mix(win * 1.5, on * .3, tiny) * uNight;
        }
        c = mix(c, uBg, off * uDim);
        glow *= 1. - off * .85;
        gl_FragColor = vec4(toPre(c) + glow, 1.); }`,
  });
  return { mat, uni };
}

/** Mangroves: low faceted clumps; muted sage by day, near-black olive with a faint moon edge at night. */
export function mangroveMat(U: Shared, L: Light) {
  const uni = {
    ...U,
    ...L,
    uLeaf: { value: lin('#000') },
    uLeafLit: { value: lin('#000') },
    uRim: { value: lin('#000') },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aTone; uniform float uYear, uEnter, uMinYear;
      varying vec3 vN, vW; varying float vTone, vY;
      void main() { ${GROW} float k = smoothstep(aBirth, aBirth + 3., yr);
        if (k <= 0.) { gl_Position = vec4(0., 0., -2., 1.); return; }
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(position * k, 1.);
        vN = normalize(mat3(m) * normal); vW = w.xyz; vTone = aTone; vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uLeaf, uLeafLit, uRim; varying vec3 vN, vW; varying float vTone, vY;
      ${TONE}
      void main() { vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float lam = max(dot(n, uSun), 0.);
        vec3 c = mix(uLeaf, uLeafLit, vTone * .6 + lam * .4) * (uAmb + (1. - uAmb) * lam);
        c *= mix(.7, 1., smoothstep(-.2, .45, vY));
        c += uRim * pow(clamp(1. - dot(n, V), 0., 1.), 3.) * lam * uNight * .35;
        c = mix(c, uBg, uFocus * uDim * .5);
        gl_FragColor = vec4(toPre(c), 1.); }`,
  });
  return { mat, uni };
}

/** Ground pool under each village: warm lamplight at night (additive), a soft contact shadow by day. */
export function poolMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uWin: { value: lin('#000') } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute vec4 aPool; attribute float aBirth, aHi; uniform float uYear, uEnter, uMinYear;
      varying vec2 vQ; varying float vA, vHi;
      void main() { ${GROW} vA = smoothstep(aBirth - .5, aBirth + 1.5, yr); vHi = aHi; vQ = position.xy;
        vec3 w = vec3(aPool.x + position.x * aPool.w, aPool.y + .06, aPool.z - position.y * aPool.w);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
    fragmentShader: /* glsl */ `${HEAD} uniform vec3 uWin; uniform float uTime; varying vec2 vQ; varying float vA, vHi;
      void main() { float r = length(vQ); if (r > 1. || vA < .01) discard;
        float off = uFocus * (1. - step(.5, vHi));
        if (uNight > .5) {
          float k = (exp(-r * r * 5.) * .22 + exp(-r * 2.5) * .06) * vA * (1. - off * .8);
          gl_FragColor = vec4(uWin * k * (.92 + .08 * sin(uTime * 1.7 + vQ.x)), 1.);
        } else {
          float k = (1. - smoothstep(.1, 1., r)) * .3 * vA * (1. - off * .6);
          gl_FragColor = vec4(0., 0., 0., k);
        } }`,
  });
  const setNight = (on: boolean) => {
    mat.blending = on ? AdditiveBlending : NormalBlending;
    mat.needsUpdate = true;
  };
  return { mat, uni, setNight };
}

/** Thin pins from each settlement up to its portrait. */
export function pinMat(U: Shared, L: Light) {
  const uni = { ...U, ...L, uC: { value: lin('#000') } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aBirth, aT, aHi; varying float vBirth, vT, vHi;
      void main() { vBirth = aBirth; vT = aT; vHi = aHi; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `${HEAD} uniform float uYear, uEnter, uMinYear; uniform vec3 uC; varying float vBirth, vT, vHi;
      ${TONE}
      void main() { ${GROW} if (yr < vBirth) discard;
        float a = mix(.8, .3, vT) * (1. - uFocus * (1. - step(.5, vHi)) * .75);
        gl_FragColor = vec4(toPre(uC), a); }`,
  });
  return { mat, uni };
}

/** Backdrop: the stage background colour all round, so the world's faded edge has no seam. */
export function backdropMat(L: Light) {
  const uni = { uBg: L.uBg, uExpo: L.uExpo };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: uni,
    vertexShader: `void main() { vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `uniform vec3 uBg; ${TONE} void main() { gl_FragColor = vec4(toPre(uBg), 1.); }`,
  });
  return { mat, uni };
}
