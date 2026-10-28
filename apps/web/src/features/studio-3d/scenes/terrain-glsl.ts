// GLSL for the Family Atlas. The height of any map point is a blend of 8 keyframe heightfields
// (two RGBA textures, weights set per frame from the year), sampled by the terrain, the trails
// and the pins so everything stays draped on the surface while the island grows. Under the sea
// the height encodes the distance from the coast (see terrain-field.ts), which draws the waterlines.
//
// Every material here works in display colours: it shades like a printed map (multiply, ink over
// paper) and finally runs `untone`, the exact inverse of three's ACES filmic curve with the current
// exposure, so the sheet prints white, the ink black and the greys exactly as the palette says.

export const HEIGHT = /* glsl */ `
  uniform sampler2D uHA, uHB; uniform vec4 uWA, uWB; uniform float uS;
  float hAt(vec2 xz) { vec2 uv = xz / (2. * uS) + .5; return dot(texture2D(uHA, uv), uWA) + dot(texture2D(uHB, uv), uWB); }`;

/** Display colour (linear sRGB, 0..1) to the scene-linear value that ACES maps back onto it. */
export const UNTONE = /* glsl */ `
  uniform float uExpo;
  vec3 untone(vec3 y) {
    vec3 r = mat3(.643038, .059269, .005962, .311187, .931436, .063929, .045775, .009295, .930118) * clamp(y, 0., .985);
    vec3 A = 1. - .983729 * r, B = .0245786 - .432951 * r, C = .000090537 + .238081 * r;
    vec3 v = (sqrt(B * B + 4. * A * C) - B) / (2. * A);
    vec3 c = mat3(1.764741, -.147028, -.036337, -.675778, 1.160252, -.162436, -.088963, -.013224, 1.198773) * v;
    return max(c, 0.) * .6 / uExpo;
  }`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }`;

/** Anti-aliased line on a scalar field: `fw` is the field's screen derivative, `w` the width in pixels. */
const LINES = /* glsl */ `
  float lineAt(float v, float fw, float w) { float d = abs(fract(v + .5) - .5) / max(fw, 1e-4);
    return (1. - smoothstep(w * .5, w * .5 + 1., d)) * (1. - smoothstep(.14, .34, fw)); }
  float iso(float v, float w) { return lineAt(v, fwidth(v), w); }`;

export const TERRAIN_VS = /* glsl */ `
  ${HEIGHT}
  uniform float uTexel;
  varying vec2 vXZ; varying vec3 vN; varying float vSlope;
  void main() { vXZ = position.xz; float h = hAt(vXZ);
    // Hillshade normal per vertex (the grid is about as fine as the heightfield), so the fragment
    // shader samples the height only once.
    float e = uTexel;
    float hx = max(hAt(vXZ + vec2(e, 0.)), 0.) - max(hAt(vXZ - vec2(e, 0.)), 0.);
    float hz = max(hAt(vXZ + vec2(0., e)), 0.) - max(hAt(vXZ - vec2(0., e)), 0.);
    vN = vec3(-hx, 2. * e, -hz);
    vSlope = length(vec2(hx, hz)) / (2. * e);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position.x, max(h, 0.), position.z, 1.); }`;

export const TERRAIN_FS = /* glsl */ `
  ${HEIGHT}
  ${UNTONE}
  ${NOISE}
  ${LINES}
  uniform vec3 uTint[5], uSea, uInk, uCoast, uWater, uGridC, uShadow, uLit, uFade;
  uniform float uHMax, uInt, uFocus, uTime, uRtl, uStep, uRings, uSea0, uSlope, uCoastA;
  uniform float uMinor, uMajor, uWaterA, uGridA, uScree, uGrain, uRelief;
  uniform vec2 uCompass, uBar;
  varying vec2 vXZ; varying vec3 vN; varying float vSlope;
  vec3 tint(float t) { float x = clamp(t, 0., 1.) * 4.; vec3 c = uTint[0];
    for (int k = 0; k < 4; k++) c = mix(c, uTint[k + 1], smoothstep(0., 1., clamp(x - float(k), 0., 1.)));
    return c; }
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return (pa.x * ba.y - pa.y * ba.x) / length(ba); }
  // Eight-point compass rose (north is -z), split light and dark like an engraved atlas rose.
  vec2 rose(vec2 p, float R) { float r = length(p); float a = atan(p.x, -p.y); float shape = 0., dark = 0.;
    for (int s = 1; s >= 0; s--) { float off = float(s) * .785398; float L = s == 0 ? R : R * .6; float I = s == 0 ? R * .19 : R * .15;
      float ph = mod(a - off + .785398, 1.570796) - .785398; vec2 lp = r * vec2(cos(ph), sin(abs(ph)));
      if (seg(lp, vec2(L, 0.), vec2(I * .7071, I * .7071)) < 0.) { shape = 1.; dark = step(0., ph); } }
    float fw = fwidth(r);
    float ring = 1. - smoothstep(0., fw * 1.5, abs(r - R * .7) - R * .008);
    float ring2 = 1. - smoothstep(0., fw * 1.5, abs(r - R * .78) - R * .004);
    return vec2(max(shape, max(ring, ring2 * .7)), shape > .5 ? dark : 1.); }
  void main() {
    float h = hAt(vXZ);
    vec3 n = normalize(vN);
    float t = clamp(h / uHMax, 0., 1.);
    float land = step(0., h);
    vec3 col;
    if (land > .5) {
      col = tint(pow(t, .8));
      // Multidirectional hillshade: key light from the north-west, softer fills from the west and north.
      vec3 L1 = normalize(vec3(-.62, .72, -.55)), L2 = normalize(vec3(-1., .95, .15)), L3 = normalize(vec3(.15, .95, -1.));
      float I = max(dot(n, L1), 0.) * .62 + max(dot(n, L2), 0.) * .2 + max(dot(n, L3), 0.) * .18;
      float k = I / (L1.y * .62 + L2.y * .2 + L3.y * .18) - 1.;
      // Aerial perspective (Imhof): crisp light and shade on the heights, softer in the lowlands.
      k *= uRelief * mix(.55, 1.3, smoothstep(.0, .85, t));
      col *= k < 0. ? mix(vec3(1.), uShadow, clamp(-k * 1.15, 0., 1.)) : mix(vec3(1.), uLit, clamp(k * 1.5, 0., 1.));
      // Scree: stipple on the steepest ground, only once zoomed in far enough to resolve it.
      vec2 q = vXZ / .7; vec2 cell = floor(q);
      vec2 f = fract(q) - .5 - (vec2(hash(cell), hash(cell + 7.13)) - .5) * .5;
      float aa = fwidth(q.x) + 1e-4;
      float on = step(hash(cell + 3.71), smoothstep(.55, 1.3, vSlope) * .85);
      float dotv = on * (1. - smoothstep(.17 - aa, .17 + aa, length(f))) * (1. - smoothstep(.12, .3, aa));
      col = mix(col, uInk, dotv * uScree);
      // Contours: thin minor lines (they fade out where they crowd), heavier index lines every fifth,
      // and half-interval lines that only appear close up.
      float v = h / uInt;
      float fv = fwidth(v);
      float minor = lineAt(v, fv, .9), major = lineAt(v / 5., fv / 5., 1.5);
      float aux = lineAt(v - .5, fv, .7) * (1. - smoothstep(.02, .06, fv)) * .55;
      col = mix(col, uInk, max(max(minor * uMinor, aux * uMinor), major * uMajor));
    } else {
      // The sea floor drops with the distance from the coast, so depth reads back as that distance.
      float d = max(0., (-h - uSea0) / uSlope);
      col = uSea;
      // Waterlines: ink lines that follow the coast, opening out and fading with distance, drifting slowly ashore.
      float w = log(1. + d / 1.15) / log(1.36);
      float wl = iso(w + fract(uTime * .03), 1.);
      col = mix(col, uWater, wl * exp(-d / 10.) * smoothstep(.2, .9, d) * uWaterA);
    }
    // Coastline: one firm ink line where the land meets the sea.
    float coast = 1. - smoothstep(.55, 1.6, abs(h) / max(fwidth(h), 1e-4));
    col = mix(col, uCoast, coast * uCoastA);
    // Generation rings (a polar graticule centred on the founder) with spokes every 30 degrees.
    float r = length(vXZ);
    float fr = fwidth(r) / uStep;
    float gr = r / uStep;
    float ring = lineAt(gr, fr, .9) * step(.5, gr) * step(gr, uRings + .5);
    float ang = atan(vXZ.y, vXZ.x);
    float dash = step(.42, fract((ang + 3.14159) * r / (uStep * .16)));
    float sp = ang / .5235988;
    float spoke = lineAt(sp, length(fwidth(vXZ)) / max(r, 1e-3) / .5235988, .8) * smoothstep(uStep * .45, uStep * .9, r);
    float grid = max(ring * dash, spoke * .32) * mix(1., .35, land);
    col = mix(col, uGridC, grid * uGridA);
    // Compass rose and scale bar in the sea corners.
    vec2 cr = rose(vXZ - uCompass, uStep * .62);
    col = mix(col, mix(uSea, uInk, cr.y), cr.x * .9);
    vec2 bp = (vXZ - uBar) / vec2(uStep * .5, uStep * .04);
    if (abs(bp.y) < 1. && bp.x * uRtl > 0. && bp.x * uRtl < 4.) {
      float alt = mod(floor(bp.x * uRtl), 2.); float edge = step(.72, abs(bp.y));
      col = mix(uSea, uInk, max(alt, edge));
    }
    // Paper tooth, in map space so it stays put while the camera moves.
    float fg = fwidth(vXZ.x * 3.);
    col *= 1. + (vnoise(vXZ * 3.) - .5) * uGrain * (1. - smoothstep(.2, .6, fg));
    // Selection: the map steps back so the lineage trails and pins stand out.
    col = mix(col, mix(vec3(dot(col, vec3(.3, .59, .11))), uFade, .55), uFocus * .6);
    gl_FragColor = vec4(untone(col), 1.);
  }`;

export const SHEET_VS = /* glsl */ `varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

export const SHEET_FS = /* glsl */ `
  ${UNTONE}
  ${NOISE}
  uniform vec3 uPaper, uInk, uDesk, uDeskHi; uniform float uS, uB, uM, uGrid, uShadowA, uGrain;
  varying vec2 vP;
  float rule(float m, float at, float fw, float w) { return 1. - smoothstep(0., fw * 1.2, abs(m - at) - fw * w); }
  void main() {
    vec2 a = abs(vP); float m = max(a.x, a.y);
    // The map mesh covers the sheet inside the neatline; skip it there so the two never z-fight.
    if (m < uS * .998) discard;
    float P = uS + uM;
    vec3 col;
    if (m < P) {
      float fg = fwidth(vP.x * 3.);
      col = uPaper * (1. + (vnoise(vP * 3.) - .5) * uGrain * (1. - smoothstep(.2, .6, fg)));
      // Neatline: hairline at the map edge, a graduated border, and a heavier outer rule.
      float fw = fwidth(m);
      float along = a.x > a.y ? vP.y : vP.x;
      float band = step(uS, m) * step(m, uS + uB) * mod(floor(along / (uGrid * .25)), 2.);
      float ink = max(max(rule(m, uS, fw, .35), rule(m, uS + uB, fw, .35)), max(rule(m, uS + uB * 1.75, fw, 1.1), band));
      col = mix(col, uInk, ink * .92);
    } else {
      // Desk: soft contact shadow under the sheet, lighter near it, fading to the stage colour.
      vec2 o = abs(vP - vec2(uS * .015, uS * .03)); float d = max(o.x, o.y) - P;
      col = mix(uDeskHi, uDesk, smoothstep(P, P * 2.6, length(vP)));
      col *= 1. - exp(-max(d, 0.) / (uS * .05)) * uShadowA;
    }
    gl_FragColor = vec4(untone(col), 1.);
  }`;

export const SKY_FS = /* glsl */ `
  ${UNTONE}
  uniform vec3 uTop, uLow; varying vec3 vD;
  void main() { gl_FragColor = vec4(untone(mix(uLow, uTop, smoothstep(-.1, .6, normalize(vD).y))), 1.); }`;

export const SKY_VS = /* glsl */ `varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

export const PIN_VS = /* glsl */ `
  ${HEIGHT}
  attribute vec2 aXZ; attribute float aTop, aBirth, aHi, aPart, aRole;
  uniform float uYear, uEnter, uMinYear;
  varying vec3 vN; varying float vHi, vPart, vY, vRole;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float app = smoothstep(aBirth, aBirth + 1.6, yr);
    float g = max(hAt(aXZ), 0.);
    vec3 p = position;
    float top = g + (aTop - g) * app;
    // Part 0 is the needle (unit height), part 1 the foot ring flat on the ground; the lineage ring opens wider.
    float grow = aPart < .5 ? 1. : app * (1. + .45 * step(.5, aHi) + .35 * step(1.5, aHi));
    float y = aPart < .5 ? mix(g, top, p.y) : g + .06 + p.y;
    vec3 w = vec3(aXZ.x + p.x * grow, y, aXZ.y + p.z * grow);
    if (app < .01) w.y = -50.;
    vHi = aHi; vPart = aPart; vY = p.y; vN = normal; vRole = aRole;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(w, 1.); }`;

export const PIN_FS = /* glsl */ `
  ${UNTONE}
  uniform vec3 uNeedle, uFoot, uGold, uTeal, uFade; uniform float uFocus;
  varying vec3 vN; varying float vHi, vPart, vY, vRole;
  void main() {
    vec3 c;
    if (vPart < .5) {
      float lit = .72 + .38 * max(dot(normalize(vN), normalize(vec3(-.6, .55, .5))), 0.);
      c = uNeedle * lit;
    } else c = vRole > .5 ? uGold : uFoot;
    if (vHi > .5) c = vPart < .5 ? mix(c, uTeal, .55) : uTeal;
    c = mix(c, uFade, uFocus * (1. - step(.5, vHi)) * .72);
    gl_FragColor = vec4(untone(c) * (vHi > .5 && vPart > .5 ? 1.25 : 1.), 1.);
  }`;

export const TRAIL_VS = /* glsl */ `
  ${HEIGHT}
  attribute vec2 aOff; attribute float aT, aL, aBirth, aHi, aKind, aSide;
  uniform float uW, uPx;
  varying float vT, vL, vBirth, vHi, vKind, vSide;
  void main() {
    // Line weight like ink on a map: the world width, held between about 2 and 5 pixels on screen.
    float y0 = max(hAt(position.xz), 0.);
    vec4 c = viewMatrix * modelMatrix * vec4(position.x, y0, position.z, 1.);
    float px = uPx / max(-c.z, .1);
    float w = clamp(uW, 1.1 / px, 2.5 / px) * (1. + aHi * .8) * (aKind > .5 ? .75 : 1.);
    vec2 xz = position.xz + aOff * w;
    float y = max(hAt(xz), 0.) + .18;
    vT = aT; vL = aL; vBirth = aBirth; vHi = aHi; vKind = aKind; vSide = aSide;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(xz.x, y, xz.y, 1.); }`;

export const TRAIL_FS = /* glsl */ `
  ${UNTONE}
  uniform float uYear, uEnter, uMinYear, uFocus, uDash, uA, uCaseA, uGlow;
  uniform vec3 uCore, uCase, uTeal, uGold;
  varying float vT, vL, vBirth, vHi, vKind, vSide;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float g = clamp((yr - vBirth) / 1.4, 0., 1.); if (vT > g) discard;
    float s = abs(vSide);
    bool wed = vKind > .5;
    bool hi = vHi > .5;
    // Descent trails: dashes on a light casing (the classic hiking-trail symbol); marriages: gold dots.
    float dash = wed ? step(fract(vL / (uDash * .42)), .5) : step(.36, fract(vL / uDash));
    float aw = fwidth(s) * 1.2;
    float core = 1. - smoothstep(.56 - aw, .56 + aw, s);
    vec3 ink = wed ? uGold : hi ? uTeal : uCore;
    float on = hi ? 1. : dash;
    // A soft halo of the casing colour only around the inked dashes (none around the gold dots).
    vec3 col = mix(uCase, ink, core);
    float a = mix(wed ? 0. : uCaseA, 1., core) * on * (1. - smoothstep(1. - aw, 1., s));
    a *= hi ? 1. : uA;
    a *= uFocus > .5 && !hi ? .16 : 1.;
    if (a < .02) discard;
    gl_FragColor = vec4(untone(col) * (hi ? uGlow : 1.), a); }`;

export const BIZ_VS = /* glsl */ `
  attribute float aYear; uniform float uYear, uEnter, uMinYear, uTime; varying vec3 vN;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float app = smoothstep(aYear, aYear + 1.5, yr);
    vN = normalize(mat3(instanceMatrix) * normal);
    vec3 p = position * app; vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
    w.y += sin(uTime * 1.3 + w.x) * .12; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const BIZ_FS = /* glsl */ `
  ${UNTONE}
  uniform vec3 uMark, uFade; uniform float uFocus; varying vec3 vN;
  void main() { float l = .62 + .5 * max(dot(normalize(vN), normalize(vec3(-.5, .8, .3))), 0.);
    gl_FragColor = vec4(untone(mix(uMark * l, uFade, uFocus * .7)), 1.); }`;
