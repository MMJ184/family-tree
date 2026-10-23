// GLSL for the Family Atlas. The height of any map point is a blend of 8 keyframe heightfields
// (two RGBA textures, weights set per frame from the year), sampled by the terrain, the trails
// and the pins so everything stays draped on the surface while the island grows.

export const HEIGHT = /* glsl */ `
  uniform sampler2D uHA, uHB; uniform vec4 uWA, uWB; uniform float uS;
  float hAt(vec2 xz) { vec2 uv = xz / (2. * uS) + .5; return dot(texture2D(uHA, uv), uWA) + dot(texture2D(uHB, uv), uWB); }`;

export const TERRAIN_VS = /* glsl */ `
  ${HEIGHT}
  varying vec2 vXZ; varying vec3 vW;
  void main() { vXZ = position.xz; float h = hAt(vXZ); vec4 w = modelMatrix * vec4(position.x, max(h, 0.), position.z, 1.);
    vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const TERRAIN_FS = /* glsl */ `
  ${HEIGHT}
  uniform vec3 uRamp[7], uSeaLo, uSeaHi, uInk, uInkHi, uSeaInk, uGridC, uShade, uLit, uPaper, uAccent;
  uniform float uHMax, uInt, uDeep, uGrid, uTexel, uDark, uFocus, uTime, uRtl;
  uniform vec2 uCompass, uBar;
  varying vec2 vXZ; varying vec3 vW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 ramp(float t) { float x = clamp(t, 0., 1.) * 6.; int i = int(min(floor(x), 5.)); float f = x - float(i);
    vec3 a = uRamp[0], b = uRamp[1];
    for (int k = 0; k < 6; k++) if (k == i) { a = uRamp[k]; b = uRamp[k + 1]; }
    return mix(a, b, smoothstep(0., 1., f)); }
  // Isoline of v with spacing 1, about w pixels wide (fwidth keeps the width constant on screen).
  float iso(float v, float w) { float fw = max(fwidth(v), 1e-4); float d = abs(fract(v + .5) - .5) / fw;
    return (1. - smoothstep(w * .5, w * .5 + 1., d)) * (1. - smoothstep(.12, .32, fw)); }
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return (pa.x * ba.y - pa.y * ba.x) / length(ba); }
  // Eight-point compass rose (north is -z), split light and dark like an engraved atlas rose.
  vec2 rose(vec2 p, float R) { float r = length(p); float a = atan(p.x, -p.y); float shape = 0., dark = 0.;
    for (int s = 1; s >= 0; s--) { float off = float(s) * .785398; float L = s == 0 ? R : R * .6; float I = s == 0 ? R * .19 : R * .15;
      float ph = mod(a - off + .785398, 1.570796) - .785398; vec2 lp = r * vec2(cos(ph), sin(abs(ph)));
      if (seg(lp, vec2(L, 0.), vec2(I * .7071, I * .7071)) < 0.) { shape = 1.; dark = step(0., ph); } }
    float ring = 1. - smoothstep(0., fwidth(r) * 1.5, abs(r - R * .7) - R * .01);
    return vec2(max(shape, ring), shape > .5 ? dark : 1.); }
  void main() {
    float h = hAt(vXZ);
    float e = uTexel;
    float hx = max(hAt(vXZ + vec2(e, 0.)), 0.) - max(hAt(vXZ - vec2(e, 0.)), 0.);
    float hz = max(hAt(vXZ + vec2(0., e)), 0.) - max(hAt(vXZ - vec2(0., e)), 0.);
    vec3 n = normalize(vec3(-hx * 2.2, 2. * e, -hz * 2.2));
    float t = h / uHMax;
    vec3 col;
    float land = step(0., h);
    if (h < 0.) col = mix(uSeaHi, uSeaLo, smoothstep(0., uDeep, -h));
    else col = ramp(pow(t, .85));
    // Hillshade: light from the north-west, cool shadows and warm highlights (Imhof).
    vec3 Ld = normalize(vec3(-.62, .7, -.55));
    float k = dot(n, Ld) / dot(vec3(0., 1., 0.), Ld);
    float sh = clamp(k, 0., 1.6);
    col *= land > .5 ? mix(uShade, uLit, smoothstep(.05, 1.3, sh)) * (.82 + .3 * smoothstep(.2, 1.4, sh)) : vec3(1.);
    col *= 1. + land * (sh - 1.) * .05;
    // Contours: minor, index (every fifth) and the coastline; bathymetric lines at sea.
    float v = h / uInt;
    float minor = iso(v, 1.), major = iso(v / 5., 1.9);
    float coast = 1. - smoothstep(.8, 2.2, abs(h) / max(fwidth(h), 1e-4));
    float sea = 1. - land; float bath = iso(-h / (uDeep / 4.), 1.) * sea;
    float lines = land * max(minor * (uDark > .5 ? .32 : .55), major);
    vec3 ink = mix(uInk, uInkHi, smoothstep(.2, .9, t));
    if (uDark > .5) {
      float flow = .75 + .25 * sin(h * .8 - uTime * 1.2);
      col += ink * lines * 1.15 * flow + uSeaInk * bath * .7 + uAccent * coast * .75;
    } else {
      col = mix(col, ink, lines * .6);
      col = mix(col, uSeaInk, bath * .45);
      col = mix(col, uAccent, coast * .85);
      // Swiss-style slope tone: steep faces darken a little more.
      col *= 1. - .12 * smoothstep(.5, 1.4, length(vec2(hx, hz)) / (2. * e));
    }
    // Faint graticule.
    vec2 g = vXZ / uGrid; vec2 gf = max(fwidth(g), vec2(1e-4)); vec2 gd = abs(fract(g + .5) - .5) / gf;
    float grid = (1. - smoothstep(.3, 1.2, min(gd.x, gd.y))) * (1. - smoothstep(.2, .5, max(gf.x, gf.y)));
    col = uDark > .5 ? col + uGridC * grid * .5 : mix(col, uGridC, grid * .3);
    // Compass rose and scale bar in the sea corners.
    vec2 cr = rose(vXZ - uCompass, uGrid * .55);
    vec3 roseC = mix(uPaper, uInk, cr.y);
    col = mix(col, uDark > .5 ? uGridC * (.6 + cr.y * 1.2) : roseC, cr.x * .9);
    vec2 bp = (vXZ - uBar) / vec2(uGrid * .5, uGrid * .045);
    if (abs(bp.y) < 1. && bp.x * uRtl > 0. && bp.x * uRtl < 4.) {
      float alt = mod(floor(bp.x * uRtl), 2.); float edge = step(.8, abs(bp.y));
      vec3 bc = mix(uPaper, uInk, max(alt, edge)); col = uDark > .5 ? mix(col, uGridC * (.4 + alt), .8) : bc;
    }
    // Paper grain and an edge vignette.
    float edgeV = max(abs(vXZ.x), abs(vXZ.y)) / uS;
    col *= 1. - .14 * smoothstep(.72, 1., edgeV);
    col *= 1. + (hash(floor(gl_FragCoord.xy)) - .5) * .035;
    // Selection: the map fades back so the lineage trails and pins stand out.
    col = mix(col, mix(vec3(dot(col, vec3(.3, .59, .11))), uPaper, .35), uFocus * .55);
    gl_FragColor = vec4(col, 1.);
  }`;

export const PAPER_VS = /* glsl */ `varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

export const PAPER_FS = /* glsl */ `
  uniform vec3 uPaper, uInk, uDesk, uFar, uGlow; uniform float uS, uB, uM, uGrid, uDark;
  varying vec2 vP;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 a = abs(vP); float m = max(a.x, a.y);
    // The map mesh covers the sheet inside the neatline; skip it there so the two never z-fight.
    if (m < uS * .998) discard;
    float P = uS + uM;
    vec3 col;
    if (m < P) {
      col = uPaper * (1. + (hash(floor(gl_FragCoord.xy)) - .5) * .04);
      // Neatline: inner hairline at the map edge, the graduated border bar, and an outer rule.
      float fw = fwidth(m);
      float inner = 1. - smoothstep(0., fw * 1.5, abs(m - uS) - fw * .3);
      float outer = 1. - smoothstep(0., fw * 1.5, abs(m - uS - uB) - fw * .3);
      float rule = 1. - smoothstep(0., fw * 1.5, abs(m - uS - uB - uB * .7) - fw * .6);
      float along = a.x > a.y ? vP.y : vP.x;
      float band = step(uS, m) * step(m, uS + uB) * mod(floor(along / (uGrid * .25)), 2.);
      float ink = max(max(inner, outer), max(rule, band));
      col = uDark > .5 ? col + uGlow * ink * .55 : mix(col, uInk, ink * .9);
    } else {
      // Desk: soft drop shadow under the sheet, fading into the distance.
      vec2 o = abs(vP - vec2(uS * .025, uS * .04)); float d = max(o.x, o.y) - P;
      float shadow = exp(-max(d, 0.) / (uS * .05)) * .45;
      col = uDesk * (1. - shadow);
      col = mix(col, uFar, smoothstep(P * 1.3, P * 3.2, length(vP)));
    }
    gl_FragColor = vec4(col, 1.);
  }`;

export const PIN_VS = /* glsl */ `
  ${HEIGHT}
  attribute vec2 aXZ; attribute float aTop, aBirth, aDeath, aHi, aPart; attribute vec3 aCol;
  uniform float uYear, uEnter, uMinYear;
  varying vec3 vCol, vN; varying float vDead, vHi, vPart, vY;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float app = smoothstep(aBirth, aBirth + 1.6, yr);
    float g = max(hAt(aXZ), 0.);
    vec3 p = position;
    float top = g + (aTop - g) * app;
    float y = aPart < .5 ? mix(g, top, p.y) : g + .08 + p.y;
    vec3 w = vec3(aXZ.x + p.x * (aPart < .5 ? 1. : app), y, aXZ.y + p.z * (aPart < .5 ? 1. : app));
    if (app < .01) w.y = -50.;
    vCol = aCol; vDead = step(aDeath, yr); vHi = aHi; vPart = aPart; vY = p.y; vN = normal;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(w, 1.); }`;

export const PIN_FS = /* glsl */ `
  uniform vec3 uStem; uniform float uDark, uFocus;
  varying vec3 vCol, vN; varying float vDead, vHi, vPart, vY;
  void main() { vec3 c = vCol; if (vDead > .5) c = mix(vec3(dot(c, vec3(.3, .59, .11))), vec3(.55), .5);
    float lit = .65 + .35 * max(dot(normalize(vN), normalize(vec3(-.6, .6, .5))), 0.);
    vec3 col = vPart < .5 ? mix(uStem, c, smoothstep(.55, 1., vY) * .8) * lit : c * (uDark > .5 ? 1.4 : .95);
    if (uDark > .5 && vPart < .5) col = c * (.5 + vY * .9);
    col *= 1. + vHi * .5;
    col = mix(col, col * .3, uFocus * (1. - step(.5, vHi)));
    gl_FragColor = vec4(col, 1.); }`;

export const TRAIL_VS = /* glsl */ `
  ${HEIGHT}
  attribute vec2 aOff; attribute float aT, aL, aBirth, aHi, aKind, aSide;
  uniform float uW;
  varying float vT, vL, vBirth, vHi, vKind, vSide;
  void main() { vec2 xz = position.xz + aOff * uW * (1. + aHi * .7) * (aKind > .5 ? .6 : 1.);
    float y = max(hAt(xz), 0.) + .18;
    vT = aT; vL = aL; vBirth = aBirth; vHi = aHi; vKind = aKind; vSide = aSide;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(xz.x, y, xz.y, 1.); }`;

export const TRAIL_FS = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus, uDark, uDash, uA; uniform vec3 uCore, uCase, uHiC;
  varying float vT, vL, vBirth, vHi, vKind, vSide;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float g = clamp((yr - vBirth) / 1.4, 0., 1.); if (vT > g) discard;
    float s = abs(vSide);
    float dash = vKind > .5 ? step(.5, fract(vL / (uDash * .45))) : step(.38, fract(vL / uDash));
    float pulse = smoothstep(.8, 1., fract(vT * 1.5 - uTime * .4 + vBirth * .13));
    vec3 core = mix(uCore, uHiC, vHi);
    float a;
    vec3 col;
    if (uDark > .5) { col = core * (1.2 + pulse * 1.6 * (.3 + vHi)) * (1. - s * .6); a = (vHi > .5 ? 1. : dash * .85 + .15) * (1. - s * s); }
    else { bool edge = s > .55; col = edge ? uCase : core * (1. + pulse * .25); a = edge ? .9 : (vHi > .5 ? 1. : dash); }
    a *= vHi > .5 ? 1. : uA;
    a *= uFocus > .5 && vHi < .5 ? .2 : 1.;
    if (a < .02) discard;
    gl_FragColor = vec4(col, a); }`;

export const BIZ_VS = /* glsl */ `
  attribute float aYear; uniform float uYear, uEnter, uMinYear, uTime; varying vec3 vN;
  void main() { float yr = mix(uMinYear - 3., uYear, uEnter); float app = smoothstep(aYear, aYear + 1.5, yr);
    vN = normalize(mat3(instanceMatrix) * normal);
    vec3 p = position * app; vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.);
    w.y += sin(uTime * 1.3 + w.x) * .15; gl_Position = projectionMatrix * viewMatrix * w; }`;

export const BIZ_FS = /* glsl */ `
  uniform vec3 uGold; uniform float uFocus; varying vec3 vN;
  void main() { float l = .55 + .6 * max(dot(normalize(vN), normalize(vec3(-.5, .8, .3))), 0.);
    gl_FragColor = vec4(uGold * l * (1. - uFocus * .5), 1.); }`;
