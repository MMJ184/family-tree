import { AdditiveBlending, BackSide, Color, ShaderMaterial, type Texture, Vector2, Vector3 } from 'three';
import type { Shared } from '../gl.ts';
import { BUMP, DOME_VERT, LINEAGE, NOISE3, REF_PX } from './tree-gl.ts';

// Bonsai materials, lit like a studio product shot: a juniper with reddish stringy bark and
// bleached deadwood (shari on the trunk, jin stubs), dense foliage pads, a glazed pot, moss and
// gravel, a lacquered (night) or white gallery (day) plinth and a seamless backdrop.

/** Scene palette (sRGB hex): signature colours from the subject; everything else neutral. */
export const LOOK = {
  dark: {
    dark: true,
    // signature: oxblood glaze, juniper green, juniper bark and its silver deadwood
    glazeA: '#120504',
    glazeB: '#45150f',
    clay: '#5e4234',
    crackle: 0,
    leafA: '#0f1d14',
    leafB: '#557a49',
    dead: '#6e6658',
    barkA: '#1e130d',
    barkB: '#6a432f',
    shari: '#a69f93',
    moss: '#33461f',
    soil: '#1c1611',
    gravel: '#4d4a46',
    stone: '#46423f',
    // neutrals
    wallIn: '#151515',
    wallOut: '#000000',
    stand: '#060606',
    standEdge: '#5a5a5a',
    key: '#fff1df',
    keyI: 1.1,
    fill: '#d7dde8',
    fillI: 0.16,
    rimI: 0.75,
    amb: 0.14,
    dust: '#ffeccc',
    hi: '#4fd1bd',
    gold: '#e2b65a',
    tip: '#ffe2b0',
    dim: '#050505',
    bloom: 0.38,
    exposure: 1.0,
  },
  light: {
    dark: false,
    // signature: celadon glaze, deep juniper green, juniper bark and its silver deadwood
    glazeA: '#74886f',
    glazeB: '#c3cfba',
    clay: '#94816d',
    crackle: 1,
    leafA: '#132a18',
    leafB: '#4d7a41',
    dead: '#a1977f',
    barkA: '#2a1a11',
    barkB: '#7c4d34',
    shari: '#d3ccbf',
    moss: '#46622c',
    soil: '#4a3b2c',
    gravel: '#9b958b',
    stone: '#67635d',
    wallIn: '#ffffff',
    wallOut: '#ebebeb',
    stand: '#f4f4f4',
    standEdge: '#ffffff',
    key: '#ffffff',
    keyI: 1.05,
    fill: '#ffffff',
    fillI: 0.32,
    rimI: 0.3,
    amb: 0.45,
    dust: '#000000',
    hi: '#0f6b63',
    gold: '#b7862c',
    tip: '#0f6b63',
    dim: '#f2f2f2',
    // No bloom by day: the white stage would bleed over everything.
    bloom: 0,
    exposure: 1.0,
  },
};
export type BonsaiLook = typeof LOOK.dark;

/** One light rig for every material (uniform objects are shared, so tint() updates them all). */
export function studioRig() {
  const c = () => ({ value: new Color(0, 0, 0) });
  return {
    uKeyCol: c(),
    uFillCol: c(),
    uRimCol: c(),
    uAmb: { value: 0.2 },
    uHiCol: c(),
    uGold: c(),
    uTip: c(),
    uDimCol: c(),
    uDark: { value: 1 },
    uFocus: { value: 0 },
  };
}
export type StudioRig = ReturnType<typeof studioRig>;

export function setStudio(R: StudioRig, L: BonsaiLook, plain: (hex: string) => Color, scene: (hex: string) => Color) {
  R.uKeyCol.value.copy(plain(L.key)).multiplyScalar(L.keyI);
  R.uFillCol.value.copy(plain(L.fill)).multiplyScalar(L.fillI);
  R.uRimCol.value.copy(plain('#ffffff')).multiplyScalar(L.rimI);
  R.uAmb.value = L.amb;
  R.uHiCol.value.copy(plain(L.hi));
  R.uGold.value.copy(plain(L.gold));
  R.uTip.value.copy(plain(L.tip)).multiplyScalar(L.dark ? 2.2 : 1);
  R.uDimCol.value.copy(scene(L.dim));
  R.uDark.value = L.dark ? 1 : 0;
}

// Key softbox upper left and in front, a fill from the right, a rim from behind.
const STUDIO = /* glsl */ `
  uniform vec3 uKeyCol, uFillCol, uRimCol, uHiCol, uGold, uTip, uDimCol; uniform float uAmb, uDark, uFocus;
  const vec3 L1 = vec3(-.5234, .7614, .3825), L2 = vec3(.8805, .3108, .3581), L3 = vec3(.2269, .4084, -.8840);
  vec3 studio(vec3 base, vec3 n, vec3 V, float gloss, float wrap, float ao) {
    float k = clamp((dot(n, L1) + wrap) / (1. + wrap), 0., 1.);
    float f = clamp((dot(n, L2) + wrap) / (1. + wrap), 0., 1.);
    float rim = pow(clamp(1. - dot(n, V), 0., 1.), 3.) * max(dot(n, L3) + .35, 0.);
    float sky = n.y * .5 + .5;
    vec3 c = base * (uAmb * (.55 + .45 * sky) * ao + uKeyCol * k * mix(.55, 1., ao) + uFillCol * f) + uRimCol * rim * base * 1.6;
    vec3 R = reflect(-V, n);
    float soft = smoothstep(.86, .97, dot(R, L1));
    c += uKeyCol * (soft * .55 + pow(max(dot(R, L2), 0.), 40.) * .15) * gloss;
    return c;
  }
  vec3 focused(vec3 c, float hi) { return mix(c, uDimCol, uFocus * (1. - step(.5, hi)) * mix(.5, .65, uDark)); }`;

// ---------- wood: juniper bark, shari and jin ----------

/** Kinds: 0 branch, 1 marriage twig (gold), 2 surface root, 3 trunk (with a shari vein), 5 jin (all deadwood). */
export function juniperMaterial(U: Shared, R: StudioRig) {
  const uni = {
    ...U,
    ...R,
    uBarkA: { value: new Color() },
    uBarkB: { value: new Color() },
    uShari: { value: new Color() },
    /** Wood radius from which the lineage shows only as a current and an edge (thin to thick). */
    uThick: { value: new Vector2(0.3, 0.8) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute vec3 aC; attribute float aT, aS, aU, aR, aBirth, aGrow, aHi, aKind;
      uniform float uYear, uEnter, uMinYear;
      varying float vT, vS, vU, vR, vBirth, vGrow, vHi, vKind; varying vec3 vN, vW;
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float thick = mix(.62, 1., smoothstep(aBirth, aBirth + 35., yr));
        vec3 p = aC + (position - aC) * (abs(aKind - 1.) < .5 ? 1. : thick);
        vT = aT; vS = aS; vU = aU; vR = aR * thick; vBirth = aBirth; vGrow = aGrow; vHi = aHi; vKind = aKind;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uYear, uEnter, uMinYear, uTime; uniform vec3 uBarkA, uBarkB, uShari; uniform vec2 uThick;
      varying float vT, vS, vU, vR, vBirth, vGrow, vHi, vKind; varying vec3 vN, vW;
      ${STUDIO}
      ${NOISE3}
      ${BUMP}
      ${LINEAGE}
      void main() {
        // Growth cut-off: discarded at the end, after the derivatives (fwidth, bump) are taken.
        float g = clamp((mix(uMinYear - 3., uYear, uEnter) - vBirth) / vGrow, 0., 1.);
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        // Kinds (interpolated, so compared with a tolerance): 1 gold twig, 3 trunk with shari, 5 jin.
        float isGold = 1. - step(.5, abs(vKind - 1.));
        float isTrunk = 1. - step(.5, abs(vKind - 3.));
        float isJin = 1. - step(.5, abs(vKind - 5.));
        // Stringy bark: long strips that twist round the limb (seamless round the tube).
        float a = vU * 6.2832 + vS * .09;
        vec3 q = vec3(cos(a) * vR, sin(a) * vR, vS * .07) * 3.6 + vBirth * .31;
        q.xy += (vn3(q * vec3(.5, .5, 1.6) + 5.) - .5) * 2.4;
        float strip = vn3(q * vec3(1., 1., .35));
        float wS = fwidth(strip);
        float groove = (1. - smoothstep(.0, .12 + wS * 1.5, abs(strip - .5))) * (1. - smoothstep(.05, .2, wS));
        float h = 1. - groove;
        float detail = 1. - smoothstep(.04, .18, wS);
        vec3 base = mix(uBarkA, uBarkB, (.35 + .65 * h) * (.75 + .25 * vn3(q * 3.1)));
        // Deadwood: a shari vein spiralling up the trunk, jin stubs bleached all over; fine grain lines.
        float wv = .1 + .07 * vn3(vec3(vS * .25, vBirth, 1.));
        float shari = 1. - smoothstep(wv, wv + .03, abs(fract(vU + vT * .55 + (vn3(vec3(vS * .3, 0., vBirth)) - .5) * .18) - .5));
        float dead = isTrunk * shari * smoothstep(.02, .1, vT) + isJin;
        float grain = .5 + .5 * sin((vU * 6.2832 * vR * 9. + vn3(vec3(vS * 2., vU * 9., 1.)) * 6.));
        vec3 wood = uShari * (.78 + .22 * grain * detail) * (.9 + .2 * vn3(vec3(vS * .6, vU * 5., 3.)));
        base = mix(base, wood, dead);
        h = mix(h, .7 + .3 * grain, dead);
        vec3 nb = bump(n, vW, h, .8 * min(vR * 3., 1.) * detail);
        float ao = mix(.5, 1., h);
        vec3 col = studio(base, nb, V, .05 + dead * .12, .3, ao);
        col = mix(col, uGold * (.45 + .55 * max(dot(nb, L1), 0.)) + uGold * uDark * .15, isGold);
        float flow = smoothstep(.86, 1., fract(vS * .18 - uTime * .32 + vBirth * .13));
        col = lineage(col, uHiCol, uGold, vHi, isGold, flow, smoothstep(uThick.x, uThick.y, vR), pow(clamp(1. - abs(dot(n, V)), 0., 1.), 2.), uDark);
        col = focused(col, vHi);
        col = mix(col, uTip, smoothstep(g - .06, g, vT) * (1. - step(.999, g)) * .9);
        if (vT > g) discard;
        gl_FragColor = vec4(col, 1.); }`,
  });
  return { mat, uni };
}

// ---------- foliage pads ----------

/** Juniper pads: lumpy clouds of scale-like sprays, flat underneath; they bud after a birth and grey after a death. */
export function padMaterial(U: Shared, R: StudioRig) {
  const uni = { ...U, ...R, uLow: { value: new Color() }, uTop: { value: new Color() }, uDead: { value: new Color() } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `
      attribute float aBirth, aDeath, aSeed, aHi;
      uniform float uYear, uEnter, uMinYear, uTime;
      varying vec3 vW, vN; varying float vSeed, vDead, vHi, vLocalY;
      ${NOISE3}
      void main() {
        float yr = mix(uMinYear - 3., uYear, uEnter);
        float grow = smoothstep(aBirth + .3, aBirth + 2.2, yr);
        vec3 p = position;
        float lump = vn3(p * 2.1 + aSeed * 37.) * .55 + vn3(p * 4.7 + aSeed * 11.) * .25;
        p *= .78 + lump * .5;
        p.y = p.y < 0. ? p.y * .45 : p.y;
        vLocalY = p.y;
        p *= grow;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
        float br = sin(uTime * .6 + aSeed * 40.) * .03 + sin(uTime * 1.3 + aSeed * 17.) * .012;
        w.x += br * grow; w.y += cos(uTime * .5 + aSeed * 31.) * .02 * grow;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * position);
        vW = w.xyz; vSeed = aSeed; vDead = smoothstep(aDeath + .5, aDeath + 2.5, yr); vHi = aHi;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uLow, uTop, uDead;
      varying vec3 vW, vN; varying float vSeed, vDead, vHi, vLocalY;
      ${STUDIO}
      ${NOISE3}
      ${BUMP}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 fn = facet(vW, V);
        vec3 n = normalize(mix(normalize(vN), fn, .45)); if (dot(n, V) < 0.) n = fn;
        // Tufts of scale leaves: fine bumps whose tips catch the light.
        float t1 = vn3(vW * 7.3 + vSeed * 9.), t2 = vn3(vW * 17. + 3.);
        float wt = fwidth(t2);
        float tuft = t1 * .6 + t2 * .4 * (1. - smoothstep(.1, .35, wt));
        vec3 nb = bump(n, vW, tuft, .5);
        float up = clamp(vLocalY * .55 + .5, 0., 1.);
        vec3 base = mix(uLow, uTop, clamp(up * .55 + tuft * .45 + (vSeed - .5) * .2, 0., 1.));
        base = mix(base, uDead, vDead * .7);
        float ao = mix(.35, 1., up) * (.7 + .3 * tuft);
        vec3 col = studio(base, nb, V, .04, .45, ao);
        // Lineage pads keep a fine teal edge while the rest dims.
        float edge = pow(clamp(1. - dot(n, V), 0., 1.), 2.5);
        col += uHiCol * edge * step(.5, vHi) * uFocus * (uDark > .5 ? .55 : .35);
        col = focused(col, vHi);
        // Looking steeply down (the top view), whole pads thin out so the people on the lower rows show.
        if (vSeed < smoothstep(.72, .93, V.y) * .78) discard;
        gl_FragColor = vec4(col, 1.); }`,
  });
  return { mat, uni };
}

// ---------- pot, moss, stones ----------

/** Glazed pot: glaze pools darker low down and breaks lighter at the rim, a fine crackle by day. */
export function glazeMaterial(R: StudioRig) {
  const uni = {
    ...R,
    uA: { value: new Color() },
    uB: { value: new Color() },
    uClay: { value: new Color() },
    uCrackle: { value: 0 },
    uSize: { value: new Vector3(1, 1, 1) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vN, vW, vL; void main() { vN = normalize(mat3(modelMatrix) * normal); vL = position;
      vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB, uClay, uSize; uniform float uCrackle;
      varying vec3 vN, vW, vL;
      ${STUDIO}
      ${NOISE3}
      void main() {
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float y = clamp((vL.y - uSize.y) / uSize.z, 0., 1.); // 0 at the foot, 1 at the rim
        float ang = atan(vL.z, abs(vL.x) < 1e-6 ? 1e-6 : vL.x);
        float run = vn3(vec3(cos(ang) * 3., sin(ang) * 3., y * 5.)) * .6 + vn3(vec3(cos(ang) * 9., sin(ang) * 9., y * 14.)) * .4;
        vec3 base = mix(uA, uB, clamp(y * .55 + run * .35 + smoothstep(.5, 1., n.y) * .25, 0., 1.));
        float lip = smoothstep(.9, 1., y) * smoothstep(.55, .9, vn3(vec3(cos(ang) * 14., sin(ang) * 14., 2.)));
        base = mix(base, uClay, lip * .55);
        // Crackle: a fine net of dark lines in the glaze.
        vec3 cq = vec3(cos(ang) * 6., sin(ang) * 6., y * 4.) * 3.;
        float c1 = vn3(cq), c2 = vn3(cq * 2.1 + 5.);
        float cr = max(1. - smoothstep(.0, .025 + fwidth(c1), abs(c1 - .5)), (1. - smoothstep(.0, .02 + fwidth(c2), abs(c2 - .5))) * .6);
        base *= 1. - uCrackle * cr * .28;
        vec3 col = studio(base, n, V, 1.15, .1, 1.);
        col += uKeyCol * pow(clamp(1. - dot(n, V), 0., 1.), 4.) * .1;
        col = mix(col, uDimCol, uFocus * .45);
        gl_FragColor = vec4(col, 1.); }`,
  });
  return { mat, uni };
}

/** Moss mound with a ring of fine gravel at the pot's edge. */
export function mossMaterial(R: StudioRig) {
  const uni = {
    ...R,
    uMoss: { value: new Color() },
    uSoil: { value: new Color() },
    uGravel: { value: new Color() },
    uRad: { value: new Vector3(1, 1, 0) },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoss, uSoil, uGravel, uRad;
      varying vec3 vW;
      ${STUDIO}
      ${NOISE3}
      ${BUMP}
      void main() {
        vec2 p = vW.xz;
        float e = length(vec2(vW.x / uRad.x, vW.z / uRad.y));
        float a = vn2(p * 1.6) * .55 + vn2(p * 5.) * .3 + vn2(p * 14.) * .15;
        float cushion = vn2(p * 9.) * .6 + vn2(p * 23.) * .4;
        vec3 moss = mix(uMoss * .55, uMoss * 1.25, cushion);
        vec3 base = mix(uSoil, moss, smoothstep(.12, .3, a) * (1. - smoothstep(.78, .88, e)));
        // Gravel: rounded pebbles round the edge.
        vec2 gq = p * 7.; vec2 cell = floor(gq); vec2 f = fract(gq) - .5;
        vec2 o = vec2(h21(cell), h21(cell + 5.3)) - .5;
        float peb = 1. - smoothstep(.2, .34, length(f - o * .35));
        float ring = smoothstep(.74, .86, e);
        vec3 grav = uGravel * (.7 + .5 * h21(cell + 1.7)) * (.6 + .4 * peb);
        base = mix(base, grav, ring);
        float h = mix(cushion, peb, ring);
        vec3 n = bump(vec3(0., 1., 0.), vW, h, .25);
        vec3 col = studio(base, n, normalize(cameraPosition - vW), ring * .15, .4, .75 + .25 * h);
        col = mix(col, uDimCol, uFocus * .45);
        gl_FragColor = vec4(col, 1.); }`,
  });
  return { mat, uni };
}

export function stoneMaterial(R: StudioRig) {
  const uni = { ...R, uC: { value: new Color() } };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uC; varying vec3 vW;
      ${STUDIO}
      ${NOISE3}
      ${BUMP}
      void main() { vec3 V = normalize(cameraPosition - vW); vec3 n = facet(vW, V);
        vec3 base = uC * (.75 + .4 * vn3(vW * 3.) + .15 * vn3(vW * 11.));
        vec3 col = studio(base, n, V, .2, .2, 1.);
        gl_FragColor = vec4(mix(col, uDimCol, uFocus * .45), 1.); }`,
  });
  return { mat, uni };
}

// ---------- plinth and backdrop ----------

/** The plinth: black lacquer with a long softbox reflection (night) or matte gallery white (day); the pot's contact shadow on top. */
export function plinthMaterial(R: StudioRig) {
  const uni = {
    ...R,
    uBody: { value: new Color() },
    uEdge: { value: new Color() },
    uGloss: { value: 1 },
    /** Pot footprint on the top face: half width, half depth, top height. */
    uPot: { value: new Vector3(1, 1, 0) },
    uShade: { value: new Color() },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vN, vW; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBody, uEdge, uPot, uShade; uniform float uGloss;
      varying vec3 vN, vW;
      ${STUDIO}
      ${NOISE3}
      void main() {
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        float top = smoothstep(.7, .95, n.y);
        vec3 base = uBody;
        vec3 col = studio(base, n, V, 0., .2, 1.);
        // Lacquer: mirror-like Fresnel and the softbox as a long bright streak.
        vec3 Rf = reflect(-V, n);
        float fr = .04 + .96 * pow(clamp(1. - dot(n, V), 0., 1.), 5.);
        float box = smoothstep(.93, .985, dot(Rf, L1)) * (.75 + .25 * vn2(vW.xz * .3));
        // The lacquer mirrors a dim studio: the lit wall behind the camera and the floor's glow.
        float env = smoothstep(-.2, .35, Rf.y) * (1. - smoothstep(.35, .9, Rf.y)) * .5 + smoothstep(.6, 1., Rf.y) * .2;
        col += uGloss * (uKeyCol * box * .9 + uEdge * fr * (.25 + env));
        // Contact shadow of the pot (and a softer one of the crown) on the top face.
        float d = length(vec2(vW.x / uPot.x, vW.z / uPot.y));
        float sh = (1. - smoothstep(.92, 1.5, d)) * .75 + (1. - smoothstep(.6, 2.6, d)) * .25;
        col = mix(col, uShade, sh * top * .6);
        // Edges catch a fine line of light.
        col += uEdge * pow(clamp(1. - abs(dot(n, V)), 0., 1.), 8.) * .12;
        col = mix(col, uDimCol, uFocus * .35);
        gl_FragColor = vec4(col, 1.); }`,
  });
  return { mat, uni };
}

/** Seamless sweep (floor curving into the wall): a soft pool of light behind the tree, neutral falloff to the edges. */
export function sweepMaterial() {
  const uni = {
    uIn: { value: new Color() },
    uOut: { value: new Color() },
    uCentre: { value: new Vector3() },
    uSpan: { value: 30 },
  };
  const mat = new ShaderMaterial({
    uniforms: uni,
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uIn, uOut, uCentre; uniform float uSpan; varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float d = length((vW - uCentre) * vec3(.8, 1., .8)) / uSpan;
        vec3 c = mix(uIn, uOut, smoothstep(.15, 1.25, d));
        // Dither against banding: about half an 8-bit step after tone mapping (a larger share in the dark).
        c *= 1. + (h(gl_FragCoord.xy) - .5) * mix(.1, .025, smoothstep(.0, .5, dot(c, vec3(.333))));
        gl_FragColor = vec4(c, 1.); }`,
  });
  return { mat, uni };
}

/** A big neutral dome behind everything (orbiting past the sweep). */
export function domeMaterial() {
  const uni = { uC: { value: new Color() } };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: uni,
    vertexShader: DOME_VERT,
    fragmentShader: /* glsl */ `uniform vec3 uC; varying vec3 vD; void main() { gl_FragColor = vec4(uC, 1.); }`,
  });
  return { mat, uni };
}

/** Night only: a few motes of dust drifting through the key light. */
export function dustMaterial(U: Shared, tex: Texture) {
  const uni = { uTime: U.uTime, uCol: { value: new Color() }, uTex: { value: tex }, uPx: { value: REF_PX } };
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: uni,
    vertexShader: /* glsl */ `attribute float aPh; uniform float uTime, uPx; varying float vA;
      void main() { vec3 p = position;
        p.y += mod(uTime * .12 + aPh * 3., 6.) - 3.; p.x += sin(uTime * .17 + aPh) * .8; p.z += cos(uTime * .13 + aPh * 1.3) * .6;
        vA = (.35 + .65 * pow(max(sin(uTime * .4 + aPh * 5.), 0.), 2.)) * (1. - smoothstep(2., 3., abs(mod(uTime * .12 + aPh * 3., 6.) - 3.)));
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float k = uPx / ${REF_PX.toFixed(1)};
        gl_PointSize = clamp(uPx * .056 / max(-mv.z, .1), k, 4. * k); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform vec3 uCol; varying float vA;
      void main() { float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(uCol * a * .9, 1.); }`,
  });
  return { mat, uni };
}
