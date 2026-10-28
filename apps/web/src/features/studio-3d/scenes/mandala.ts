import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { sizeFactor } from '../portraits.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Girih Mandala: the family inlaid in a marble medallion. The founders sit on an authentic girih
// rosette (a decagon's ten-point star ringed by ten pentagon stars); each generation is a band of
// the medallion, its people seated on star roundels; gold strapwork in the girih manner (Penrose
// rhombs with Hankin's 54-degree rays, as in the Darb-i Imam panels) fills the field, quieter in the
// bands and at full strength in the border. Descent is a gold inlay ribbon from each couple to their
// children; marriages are gold links along the band. The selected lineage turns teal.

const LOOK = {
  dark: {
    // Black marble with gold girih inlay and deep lapis fills.
    stage: '#000000',
    lift: '#0c0c0c',
    marble: '#0f0f10',
    vein: '#3d3d40',
    gold: '#cfa75a',
    goldLo: '#6f5629',
    rib: '#d2a95c',
    line: '#cfa75a',
    lapis: '#1b2b5e',
    seat: '#161616',
    ink: '#000000',
    teal: '#4fd1bd',
    veinK: 0.55,
    calm: 0.065,
    calmFill: 1,
    alt: 0.06,
    sheen: 0.16,
    shadow: 0,
    halo: 0.82,
    bloom: 0.42,
  },
  light: {
    // White marble with lapis and gold inlay.
    stage: '#e9e9e9',
    lift: '#f4f4f4',
    marble: '#f7f7f5',
    vein: '#bdbdbd',
    gold: '#a8802f',
    goldLo: '#6e4f17',
    rib: '#8a6420',
    line: '#8a6420',
    lapis: '#2a4893',
    seat: '#fbfbfa',
    ink: '#7a7a7a',
    teal: '#0f6b63',
    veinK: 0.5,
    calm: 0.36,
    calmFill: 0.55,
    alt: -0.035,
    sheen: 0.07,
    shadow: 1,
    halo: 0.16,
    bloom: 0,
  },
};

const col = (hex: string) => new Color(hex);

/** Display-referred shading: the scene's colours are written so that, after the engine's ACES tone mapping, the
 * stage shows exactly the palette (black stays #000, the light stage stays a neutral near-white). */
const GLSL_TONE = /* glsl */ `
  const mat3 IIN = mat3(vec3(1.764741, -.147028, -.036337), vec3(-.675778, 1.160252, -.162436), vec3(-.088963, -.013224, 1.198773));
  const mat3 IOUT = mat3(vec3(.643038, .059269, .005962), vec3(.311187, .931436, .063929), vec3(.045775, .009295, .930118));
  vec3 unTone(vec3 c) {
    vec3 y = clamp(IOUT * c, 0., .985);
    vec3 a = 1. - y * .983729, b = .0245786 - y * .432951, k = -(.000090537 + y * .238081);
    return max(IIN * ((-b + sqrt(max(b * b - 4. * a * k, 0.))) / (2. * a)), 0.) * .6;
  }`;

const FLOOR_VERT = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FLOOR_FRAG = /* glsl */ `
  uniform float uTime, uStep, uR1, uRb, uRm, uR0, uHW, uLW, uE, uCalm, uCalmFill, uSheen, uSeps, uVeinK, uShadow, uAlt;
  uniform int uLevels;
  uniform vec3 uStage, uLift, uMarble, uVein, uGold, uGoldLo, uLapis, uInk, uLine;
  uniform sampler2D uNoise;
  varying vec3 vW;
  const float PI = 3.14159265, PHI = 1.618034;
  ${GLSL_TONE}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float side(vec2 p, vec2 a, vec2 b) { vec2 e = b - a, q = p - a; return e.x * q.y - e.y * q.x; }
  float sd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0., 1.)); }
  // atan(0, 0) is undefined (NaN on some GPUs, which the bloom would spread over the frame).
  float angle(vec2 p) { return atan(p.y, abs(p.x) + abs(p.y) < 1e-7 ? 1. : p.x); }

  // The field: a Penrose rhomb tiling grown by Robinson-triangle deflation from a ten-triangle sun, then girih
  // strapwork by Hankin's method: two straps cross every rhomb edge at its midpoint, 54 degrees to the edge.
  // x: distance to the nearest strap; y: region (0 ground, 1 bowtie, 2 small diamond).
  vec2 field(vec2 p) {
    float ang = angle(p);
    float k = floor((ang + PI * .1) / (PI * .2));
    float t0 = (2. * k - 1.) * PI * .1;
    vec2 A = vec2(0.), B = uR0 * vec2(cos(t0), sin(t0)), C = uR0 * vec2(cos(t0 + PI * .2), sin(t0 + PI * .2));
    if (mod(k, 2.) < .5) { vec2 t = B; B = C; C = t; }
    bool red = true;
    for (int i = 0; i < 14; i++) {
      if (i >= uLevels) break;
      if (red) {
        vec2 P = A + (B - A) / PHI;
        if (side(p, C, P) * side(B, C, P) >= 0.) { vec2 ob = B; A = C; B = P; C = ob; }
        else { vec2 oa = A; A = P; B = C; C = oa; red = false; }
      } else {
        vec2 Q = B + (A - B) / PHI, R = B + (C - B) / PHI;
        if (side(p, A, R) * side(C, A, R) >= 0.) { vec2 oa = A; A = R; B = C; C = oa; }
        else if (side(p, Q, R) * side(B, Q, R) >= 0.) { vec2 ob = B; A = Q; B = R; C = ob; }
        else { vec2 oa = A; A = R; B = Q; C = oa; red = true; }
      }
    }
    // Half a rhomb: A is a rhomb corner, AB and AC are rhomb edges, BC the diagonal shared with its mirror half.
    float s = length(B - A);
    vec2 D = (B + C) * .5, Mab = (A + B) * .5, Mac = (A + C) * .5;
    vec2 XA = A + normalize(D - A) * (.4253 * s);
    vec2 bc = normalize(C - B);
    float dB = red ? .5 * s : .4045 * s;
    vec2 YB = B + bc * dB, YC = C - bc * dB;
    float ex = uHW * 1.7;
    vec2 M1 = Mab + normalize(Mab - XA) * ex, M2 = Mac + normalize(Mac - XA) * ex;
    vec2 M3 = Mab + normalize(Mab - YB) * ex, M4 = Mac + normalize(Mac - YC) * ex;
    float d = min(min(sd(p, XA, M1), sd(p, XA, M2)), min(sd(p, YB, M3), sd(p, YC, M4)));
    vec2 nn = vec2(-bc.y, bc.x);
    vec2 pm = p - 2. * dot(p - B, nn) * nn;
    d = min(d, min(sd(pm, YB, M3), sd(pm, YC, M4)));
    float reg = 0.;
    if (!red) {
      bool kite = side(p, Mab, XA) * side(A, Mab, XA) > 0. && side(p, Mac, XA) * side(A, Mac, XA) > 0.;
      bool cb = side(p, Mab, YB) * side(B, Mab, YB) > 0.;
      bool cc = side(p, Mac, YC) * side(C, Mac, YC) > 0.;
      if (!kite && !cb && !cc) reg = 1.;
    } else if (side(p, Mab, YB) * side(D, Mab, YB) > 0. && side(p, Mac, YC) * side(D, Mac, YC) > 0.) reg = 2.;
    return vec2(d, reg);
  }

  // The founders' rosette: a girih decagon (its ten-point star and ten petals) ringed by ten girih pentagons,
  // folded into one 18-degree wedge. Units of uE (the tile edge). x: strap distance; y: region
  // (-1 outside the patch, 0 plain, 1 star, 2 petal, 3 pentagon star).
  vec2 rosette(vec2 p) {
    float r = length(p) / uE, th = angle(p);
    float f = mod(th, PI * .2); if (f > PI * .1) f = PI * .2 - f;
    vec2 q = r * vec2(cos(f), sin(f));
    const vec2 P0 = vec2(1.1180, 0.), m0 = vec2(1.4635, .4755), Nv = vec2(1.8680, .3441), ms0 = vec2(2.1180, 0.);
    const vec2 Nt = vec2(2.3680, .3441), ms1 = vec2(2.7726, .4755), Na = vec2(2.5225, .8197);
    const vec2 T0 = vec2(2.6180, 0.), A0 = vec2(2.9271, .9511), CP = vec2(2.1180, .6882), V0 = vec2(1.618, 0.);
    float d = min(min(sd(q, P0, m0), sd(q, m0, Nv)), min(sd(q, Nv, ms0), sd(q, ms0, Nt)));
    d = min(d, min(min(sd(q, Nt, ms1), sd(q, ms1, Na)), sd(q, T0, A0)));
    float reg = 0.;
    if (side(q, T0, A0) * side(vec2(0.), T0, A0) < 0. && q.x > 2.) reg = -1.;
    else if (side(q, P0, m0) * side(vec2(0.), P0, m0) > 0.) reg = 1.;
    else {
      vec2 u = q - CP;
      float ph = angle(u) - PI * .1;
      float g = mod(ph, PI * .4); if (g > PI * .2) g = PI * .4 - g;
      vec2 w = length(u) * vec2(cos(g), sin(g));
      if (side(w, vec2(.4253, 0.), .6882 * vec2(cos(PI * .2), sin(PI * .2))) * side(vec2(0.), vec2(.4253, 0.), .6882 * vec2(cos(PI * .2), sin(PI * .2))) > 0.) reg = 3.;
      else if (side(q, m0, Nv) * side(V0, m0, Nv) > 0. && side(q, Nv, ms0) * side(V0, Nv, ms0) > 0.) reg = 2.;
    }
    return vec2(d * uE, reg);
  }

  void main() {
    vec2 p = vW.xz;
    float r = length(p);
    float px = max(length(fwidth(p)), 1e-4);
    vec3 V = normalize(cameraPosition - vW);
    float la = uTime * .05;
    vec3 L = normalize(vec3(cos(la) * .85, 1.1, sin(la) * .85));
    float gloss = pow(max(normalize(L + V + vec3(0., 1e-4, 0.)).y, 0.), 70.);
    vec3 c;
    float spark = 0.;
    // Fetched before the branch: implicit-LOD texture reads need every pixel of a quad on the same path.
    vec4 m1 = texture2D(uNoise, p / 52.);
    vec4 m2 = texture2D(uNoise, p / 19. + vec2(.37, .61));
    if (r > uRm + px * 2.) {
      // The stage floor: neutral, slightly lifted round the medallion, with its contact shadow in daylight.
      c = mix(uLift, uStage, smoothstep(uRm, uRm * 2.4, r));
      c *= 1. - .16 * uShadow * exp(-(r - uRm) / (uStep * .3));
    } else {
      // Polished marble from the baked fields: two vein families drawn crisp at any zoom, a soft cloud, a grain.
      float vw1 = .045 + px / 52. * 9.;
      float vw2 = .03 + px / 19. * 9.;
      float vein = (1. - smoothstep(0., vw1, m1.r)) * .85 * (.4 + .6 * m1.g) + (1. - smoothstep(0., vw2, m2.b)) * .4 * m2.g;
      vec3 stone = mix(uMarble, uVein, clamp(vein, 0., 1.) * uVeinK);
      stone *= .955 + .06 * m1.g + .03 * (m2.a - .5) * (1. - smoothstep(.02, .12, px));
      float rIn = uR1 - .5 * uStep;
      // Every other generation band is a shade darker, so the bands read at a glance.
      float bi = floor((r - rIn) / uStep);
      stone *= 1. + uAlt * step(0., r - rIn) * step(r, uRb) * mod(bi, 2.);
      c = stone;
      float aa = px * .85;
      float hw = uHW;
      float lw0 = uLW;
      float detail = 1. - smoothstep(hw * .45, hw * 1.5, px);
      float fine = 1. - smoothstep(lw0 * .6, lw0 * 2.5, px);
      float goldCov = 0.;
      if (r < rIn) {
        vec2 ro = rosette(p);
        if (ro.y > -.5) {
          vec3 fill = ro.y > 2.5 ? uLapis : ro.y > 1.5 ? mix(stone, uGold, .22) : ro.y > .5 ? uLapis : stone;
          c = mix(stone, fill, .92);
          float hr = uE * .075;
          float cov = 1. - smoothstep(hr - aa, hr + aa, ro.x);
          float edge = 1. - smoothstep(hr + aa * .5, hr + aa * 2. + hr * .35, ro.x);
          c = mix(c, uInk, (edge - cov) * .5);
          c = mix(c, mix(uGoldLo, uGold, .55 + .45 * sqrt(max(1. - ro.x * ro.x / (hr * hr), 0.))), cov);
          goldCov = cov;
        }
      } else {
        float full = smoothstep(uRb - px, uRb + px, r);
        float k = mix(uCalm, 1., full);
        vec2 g = detail > .01 ? field(p) : vec2(1e3, 0.);
        float fk = mix(uCalmFill, 1., full);
        vec3 fill = mix(stone, g.y > 1.5 ? mix(stone, uGold, .8) : g.y > .5 ? uLapis : stone, fk);
        vec3 avg = mix(stone, mix(uLapis, uGold, .5), .2);
        float cov = 1. - smoothstep(hw - aa, hw + aa, g.x);
        float edge = 1. - smoothstep(hw + aa * .5, hw + aa * 2. + hw * .4, g.x);
        vec3 pat = mix(fill, uInk, (edge - cov) * .45 * fk);
        pat = mix(pat, mix(uGoldLo, uGold, .5 + .5 * sqrt(max(1. - g.x * g.x / (hw * hw), 0.))), cov);
        pat = mix(avg, pat, detail);
        c = mix(stone, pat, k);
        goldCov = cov * k * detail;
      }
      // Generation bands: double gold lines between the rings; the last one opens the border.
      float gs = (r - rIn) / uStep;
      float kk = floor(gs + .5);
      if (kk >= 0. && kk <= uSeps) {
        float ds = abs(gs - kk) * uStep;
        float lw = max(lw0 * .5, px * .75);
        float off = max(lw0 * 1.5, lw + px * 1.6);
        // ds is the distance from the boundary, so one line at ds = off draws the pair, one on each side.
        float sep = (1. - smoothstep(lw - aa, lw + aa, abs(ds - off))) * (kk > 0. && kk < uSeps ? .8 : 1.) * min(1., lw0 * .5 / lw + .25);
        float band = 1. - smoothstep(off - lw - aa, off - lw + aa, ds);
        c = mix(c, mix(c, uInk, .35), band * .5 * (kk > 0. && kk < uSeps ? 0. : 1.));
        c = mix(c, uLine, sep);
        goldCov = max(goldCov, sep);
      }
      // Border: beads and a broad gold rim.
      float rimW = lw0 * 3.6;
      float rim = smoothstep(uRm - rimW - aa, uRm - rimW + aa, r);
      float rb = uRm - rimW - lw0 * 2.6;
      float n = floor(PI * 2. * rb / (lw0 * 5.));
      float cell = fract(angle(p) / (PI * 2.) * max(n, 1.));
      vec2 bq = vec2((cell - .5) * PI * 2. * rb / max(n, 1.), r - rb);
      float bead = (1. - smoothstep(lw0 * .95 - aa, lw0 * .95 + aa, length(bq))) * fine;
      c = mix(c, mix(uGoldLo, uGold, .7), bead);
      float rp = clamp((r - (uRm - rimW)) / rimW, 0., 1.);
      vec3 rimC = mix(uGoldLo, uGold, .25 + .6 * sin(rp * PI));
      c = mix(c, rimC, rim);
      goldCov = max(goldCov, max(rim, bead));
      // The moving reflection: polished stone shows it softly, the gold crisply.
      c += (uSheen * gloss + uSheen * 2.2 * goldCov * pow(gloss, .35) * gloss) * (1. - .5 * goldCov);
      float h = hash(floor(p * 9.));
      spark = goldCov * detail * step(.992, h) * pow(max(.5 + .5 * sin(uTime * 2.3 + h * 60.), 0.), 16.);
    }
    gl_FragColor = vec4(unTone(c) + spark * uGold * 2.5 * uSheen * 6., 1.);
  }`;

const SEAT_VERT = /* glsl */ `
  attribute vec3 aOff; attribute float aR, aBirth, aDeath, aHi;
  uniform float uYear, uEnter, uMinYear;
  varying vec2 vQ; varying float vHi, vDead;
  void main() {
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float grow = smoothstep(aBirth - .3, aBirth + 1.3, yr);
    vQ = position.xy * 2.;
    vHi = aHi; vDead = step(aDeath, yr);
    vec3 w = aOff + vec3(position.x, 0., -position.y) * aR * 2.7 * grow;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  }`;

const SEAT_FRAG = /* glsl */ `
  uniform float uFocus, uHalo, uSheen;
  uniform vec3 uSeat, uGold, uGoldLo, uTeal, uInk;
  varying vec2 vQ; varying float vHi, vDead;
  const float PI = 3.14159265;
  ${GLSL_TONE}
  float side(vec2 p, vec2 a, vec2 b) { vec2 e = b - a, q = p - a; return e.x * q.y - e.y * q.x; }
  float sd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0., 1.)); }
  void main() {
    float r = length(vQ) * 1.35;
    // Derivatives before any discard (they are undefined once pixels of a quad take different paths).
    float aa = max(fwidth(r) * 1.2, 1e-4);
    if (r > 1.35) discard;
    // A ten-point girih star frames the seat (tips at 1, notches at .87), a gold bezel holds the plain stone.
    float th = atan(vQ.y, abs(vQ.x) + abs(vQ.y) < 1e-7 ? 1. : vQ.x);
    float f = mod(th, PI * .2); if (f > PI * .1) f = PI * .2 - f;
    vec2 q = r * vec2(cos(f), sin(f));
    vec2 tip = vec2(1., 0.), notch = .87 * vec2(cos(PI * .1), sin(PI * .1));
    float ds = sd(q, tip, notch);
    float inside = side(q, tip, notch) * side(vec2(0.), tip, notch) > 0. ? 1. : 0.;
    float starA = clamp(inside + (1. - smoothstep(0., aa, ds)) * (1. - inside), 0., 1.);
    vec3 gold = vDead > .5 ? mix(uGold, vec3(dot(uGold, vec3(.3, .59, .11))), .55) : uGold;
    vec3 ring = mix(gold, uTeal, step(.5, vHi));
    vec3 stone = uSeat * (1. - .1 * r) * (vDead > .5 ? .92 : 1.);
    vec3 c = stone;
    float bz = smoothstep(.70 - aa, .70 + aa, r) * (1. - smoothstep(.80 - aa, .80 + aa, r));
    float prof = sin(clamp((r - .7) / .1, 0., 1.) * PI);
    c = mix(c, mix(uGoldLo, ring, .5 + .5 * prof), bz);
    float outline = 1. - smoothstep(.022 - aa, .022 + aa, ds);
    c = mix(c, ring, outline * .7);
    c += uSheen * .8 * prof * bz;
    // Outside the star: a soft halo that quiets the strapwork round the seat (shadow by day, dark by night).
    float halo = (1. - inside) * (1. - smoothstep(1., 1.35, r)) * uHalo;
    float a = max(starA, halo);
    c = mix(uInk, c, starA / max(a, 1e-3));
    float dim = uFocus > .5 && vHi < .5 ? .45 : 1.;
    gl_FragColor = vec4(unTone(c), a * dim);
  }`;

const RIB_VERT = /* glsl */ `
  attribute float aT, aSide, aBirth, aKind, aHi, aLen;
  varying float vT, vSide, vBirth, vKind, vHi, vLen;
  void main() { vT = aT; vSide = aSide; vBirth = aBirth; vKind = aKind; vHi = aHi; vLen = aLen;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

const RIB_FRAG = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus, uSheen;
  uniform vec3 uGold, uGoldLo, uTeal;
  varying float vT, vSide, vBirth, vKind, vHi, vLen;
  ${GLSL_TONE}
  void main() {
    bool hi = vHi > .5;
    // The strip is drawn wide; a plain ribbon fills its middle third, a highlighted one the whole width.
    float sd = vSide / (hi ? 1. : .35);
    // Derivatives before any discard (they are undefined once pixels of a quad take different paths).
    float aa = max(fwidth(sd) * 1.3, 1e-4);
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float g = clamp((yr - vBirth) / 1.3, 0., 1.);
    if (vT > g) discard;
    float cov = 1. - smoothstep(1. - aa, 1., abs(sd));
    if (cov <= 0.) discard;
    float prof = sqrt(max(1. - sd * sd, 0.));
    bool teal = hi && vKind < .5;
    vec3 base = teal ? uTeal : uGold;
    vec3 c = mix(teal ? uTeal * .55 : uGoldLo, base, .2 + .8 * prof * prof);
    float pulse = smoothstep(.86, 1., fract(vT * vLen / 10. - uTime * .3));
    c += base * (hi ? .35 : .08) * pulse * prof;
    c += uSheen * prof * prof * .9;
    c = mix(c, base * 1.15, smoothstep(g - .05, g, vT) * (1. - step(.999, g)));
    float dim = uFocus > .5 && !hi ? .22 : 1.;
    gl_FragColor = vec4(unTone(c), cov * dim);
  }`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 uStage;
  ${GLSL_TONE}
  void main() { gl_FragColor = vec4(unTone(uStage), 1.); }`;

/** Tileable marble fields, baked once: r and b are smooth distances to two vein families (the shader draws the
 * veins crisp at any zoom with smoothstep), g a soft cloud, a a fine grain. */
let marbleBytes: Uint8Array | null = null;
function marbleTexture(): DataTexture {
  const N = 256;
  if (!marbleBytes) {
    const P = 8;
    const lat = new Float32Array(P * P * 3);
    let seed = 7;
    for (let i = 0; i < lat.length; i++) {
      seed = (seed * 16807) % 2147483647;
      lat[i] = seed / 2147483647;
    }
    const vnoise = (x: number, y: number, period: number, ch: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => {
        const a = ((i % period) + period) % period;
        const b = ((j % period) + period) % period;
        return lat[((a * 7 + b * 13 + ch * 29) % (P * P)) * 3 + ch] ?? 0;
      };
      const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
      const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
      return top + (bot - top) * sy;
    };
    const fbm = (u: number, v: number, ch: number) => {
      let s = 0;
      let a = 0.5;
      let f = 4;
      for (let o = 0; o < 4; o++) {
        s += a * vnoise(u * f, v * f, f, ch);
        a *= 0.5;
        f *= 2;
      }
      return s;
    };
    marbleBytes = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const u = i / N;
        const v = j / N;
        const w = fbm(u, v, 0);
        const r = Math.abs(Math.sin(Math.PI * (2 * u + 1 * v) + w * 7.5));
        const b = Math.abs(Math.sin(Math.PI * (3 * v - 1 * u) + fbm(u, v, 1) * 6.5));
        const k = (j * N + i) * 4;
        marbleBytes[k] = Math.round(r * 255);
        marbleBytes[k + 1] = Math.round(fbm(u + 0.31, v + 0.17, 2) * 255);
        marbleBytes[k + 2] = Math.round(b * 255);
        marbleBytes[k + 3] = Math.round(vnoise(u * 64, v * 64, 64, 1) * 255);
      }
  }
  const t = new DataTexture(marbleBytes, N, N);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Pushes items apart round a circle until neighbours keep their widths (radians), keeping their order. */
function relax(a: number[], w: number[]) {
  const n = a.length;
  if (n < 2) return;
  const total = w.reduce((s, x) => s + x, 0);
  const k = total > Math.PI * 2 * 0.98 ? (Math.PI * 2 * 0.98) / total : 1;
  for (let it = 0; it < 120; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const gap = (a[j] ?? 0) - (a[i] ?? 0) + (j === 0 ? Math.PI * 2 : 0);
      const need = (((w[i] ?? 0) + (w[j] ?? 0)) / 2) * k;
      if (gap < need - 1e-6) {
        const d = (need - gap) / 2;
        a[i] = (a[i] ?? 0) - d;
        a[j] = (a[j] ?? 0) + d;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export const mandalaScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const n = M.n;
  const size = big ? 1.1 : 1.6;
  /** Seat (star roundel) radius: its star tips, a little wider than the portrait disc. */
  const seatR = (p: StudioPerson) => 1.15 * size * sizeFactor(p) * 1.3;
  const gapU = big ? 0.9 : 1.6; // between neighbouring families on a band
  const gapM = big ? 1.1 : 1.7; // the visible gold link between spouses

  // Married-in people sit beside their partner on the band, alternating sides, in marriage order.
  const wives = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const l = wives.get(p.anchor) ?? [];
    l.push(p);
    wives.set(p.anchor, l);
  }
  for (const l of wives.values()) l.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  // Arc offsets (along the band) of each spouse from their partner, and of the whole family unit's ends.
  const offsets = new Map<string, number>();
  const unitSpan = new Map<string, [number, number]>();
  for (const p of M.people) {
    if (p.mi) continue;
    const list = wives.get(p.id) ?? [];
    let plus = 0;
    let minus = 0;
    let lastPlus = p;
    let lastMinus = p;
    list.forEach((w, j) => {
      if (j % 2 === 0) {
        plus += seatR(lastPlus) + seatR(w) + gapM;
        offsets.set(w.id, plus);
        lastPlus = w;
      } else {
        minus -= seatR(lastMinus) + seatR(w) + gapM;
        offsets.set(w.id, minus);
        lastMinus = w;
      }
    });
    unitSpan.set(p.id, [minus - seatR(lastMinus) - gapU / 2, plus + seatR(lastPlus) + gapU / 2]);
  }
  const span = (p: StudioPerson) => unitSpan.get(p.id) ?? [-seatR(p), seatR(p)];
  // Children follow their mothers' places, so each wife's children sit on her side of the father.
  const motherOff = (p: StudioPerson, kid: string) => {
    for (const q of M.get(kid).parents) {
      const o = offsets.get(q);
      if (o !== undefined && M.get(q).anchor === p.id) return o;
    }
    return 0;
  };
  const kidsOf = (p: StudioPerson) =>
    [...p.kids].sort((a, b) => motherOff(p, a) - motherOff(p, b) || M.get(a).born - M.get(b).born);

  // Bands: generation g sits on radius (R1K + g - 1) * step. Angular need of each subtree at step 1.
  const R1K = 1.6;
  const ringK = (g: number) => (g <= 0 ? 0 : R1K + g - 1);
  const need = new Map<string, number>();
  const calc = (p: StudioPerson): number => {
    let sum = 0;
    for (const k of kidsOf(p)) sum += calc(M.get(k));
    const [lo, hi] = span(p);
    const own = p === M.root ? 0 : (hi - lo) / ringK(p.gen);
    const v = Math.max(own, sum);
    need.set(p.id, v);
    return v;
  };
  const total = calc(M.root);
  const step = Math.max(big ? 7 : 10.5, total / (Math.PI * 2 * 0.9));
  const ringR = (g: number) => ringK(g) * step;

  // Angles: every subtree gets a sector in proportion to its need; the eldest branch starts at the top.
  const theta = new Map<string, number>();
  const assign = (p: StudioPerson, a0: number, a1: number) => {
    const ks = kidsOf(p).map((id) => M.get(id));
    const sum = ks.reduce((s, k) => s + (need.get(k.id) ?? 0), 0);
    const [lo, hi] = span(p);
    const R = ringR(p.gen);
    theta.set(p.id, (a0 + a1) / 2 - (R > 0 ? (lo + hi) / 2 / R : 0));
    if (!sum) return;
    let a = a0;
    for (const k of ks) {
      const w = ((a1 - a0) * (need.get(k.id) ?? 0)) / sum;
      assign(k, a, a + w);
      a += w;
    }
  };
  const first = kidsOf(M.root)[0];
  const w0 = first && total ? ((need.get(first) ?? 0) / total) * Math.PI * 2 : 0;
  assign(M.root, -Math.PI / 2 - w0 / 2, -Math.PI / 2 - w0 / 2 + Math.PI * 2);

  // Floor positions (x, z) per person; Arabic mirrors the medallion (siblings read right to left).
  const mir = ctx.rtl() ? -1 : 1;
  const at = new Map<string, Vector2>();
  const polar = (R: number, a: number) => new Vector2(Math.cos(a) * R * mir, Math.sin(a) * R);
  const rootWives = wives.get(M.root.id) ?? [];
  const D0 = seatR(M.root) + (rootWives[0] ? seatR(rootWives[0]) : 0) + gapM;
  if (rootWives.length === 1) {
    at.set(M.root.id, new Vector2((-D0 / 2) * mir, 0));
    at.set((rootWives[0] as StudioPerson).id, new Vector2((D0 / 2) * mir, 0));
  } else if (rootWives.length > 1) {
    // Several wives: each sits towards her own children's sector, so descent ribbons never cross the rosette.
    at.set(M.root.id, new Vector2(0, 0));
    const want = rootWives.map((w, j) => {
      let sx = 0;
      let sy = 0;
      for (const k of M.root.kids) {
        if (!M.get(k).parents.includes(w.id)) continue;
        const t = theta.get(k) ?? 0;
        sx += Math.cos(t);
        sy += Math.sin(t);
      }
      return sx * sx + sy * sy > 1e-6 ? Math.atan2(sy, sx) : (j / rootWives.length) * Math.PI * 2 - Math.PI;
    });
    const order = rootWives.map((_, j) => j).sort((x, y) => (want[x] ?? 0) - (want[y] ?? 0));
    const angs = order.map((j) => want[j] ?? 0);
    relax(
      angs,
      order.map((j) => (seatR(rootWives[j] as StudioPerson) * 2 + gapM) / D0),
    );
    order.forEach((j, i) => {
      at.set((rootWives[j] as StudioPerson).id, polar(D0, angs[i] ?? 0));
    });
  } else at.set(M.root.id, new Vector2(0, 0));
  for (const p of M.people) {
    if (p.mi || p === M.root) continue;
    const R = ringR(p.gen);
    const a = theta.get(p.id) ?? 0;
    at.set(p.id, polar(R, a));
    for (const w of wives.get(p.id) ?? []) at.set(w.id, polar(R, a + (offsets.get(w.id) ?? 0) / R));
  }
  const atOf = (id: string) => at.get(id) ?? new Vector2();

  const pos = new Float32Array(n * 3);
  const hMed = big ? 1.6 : 2.2;
  M.people.forEach((p, i) => {
    const a = atOf(p.id);
    pos[i * 3] = a.x;
    pos[i * 3 + 1] = hMed + (isRoot(p) ? 0.5 : 0);
    pos[i * 3 + 2] = a.y;
  });

  // ---------- inlay ribbons: descent (couple to child) and marriage (partner to spouse) ----------
  const rb = {
    pos: [] as number[],
    t: [] as number[],
    side: [] as number[],
    birth: [] as number[],
    kind: [] as number[],
  };
  const rlen: number[] = [];
  const keys: string[] = [];
  const idx: number[] = [];
  const ribbon = (pts: Vector2[], width: number, birth: number, key: string, kind: number, y: number) => {
    let L = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      L += (pts[i] as Vector2).distanceTo(pts[i - 1] as Vector2);
      acc.push(L);
    }
    if (L < 1e-3) return;
    const base = rb.pos.length / 3;
    const tan = new Vector2();
    pts.forEach((pt, i) => {
      const a = pts[Math.max(0, i - 1)] as Vector2;
      const b = pts[Math.min(pts.length - 1, i + 1)] as Vector2;
      tan.subVectors(b, a).normalize();
      const nx = -tan.y * width * 0.5;
      const nz = tan.x * width * 0.5;
      for (const s of [-1, 1]) {
        rb.pos.push(pt.x + nx * s, y, pt.y + nz * s);
        rb.t.push((acc[i] ?? 0) / L);
        rb.side.push(s);
        rb.birth.push(birth);
        rb.kind.push(kind);
        rlen.push(L);
        keys.push(key);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const ribW = big ? 0.78 : 1.02;
  const sample = (n0: number, f: (t: number) => Vector2) => Array.from({ length: n0 + 1 }, (_, i) => f(i / n0));
  // Links to a spouse beyond another one dip inside the band, under the nearer spouse's seat.
  const linkDip = (p: StudioPerson, w: StudioPerson) => {
    const off = Math.abs(offsets.get(w.id) ?? 0);
    return off > seatR(p) + seatR(w) + gapM + 0.01 ? seatR(w) * 1.25 + 0.6 : 0;
  };
  // The point a couple's children hang from: on the gold link between them, beside the mother.
  const hang = (p: StudioPerson, mother: StudioPerson | undefined): Vector2 => {
    const a = atOf(p.id);
    if (!mother || mother.anchor !== p.id) return a;
    const off = offsets.get(mother.id);
    if (p === M.root) {
      const m = atOf(mother.id);
      return rootWives.length === 1 ? new Vector2(0, 0) : a.clone().lerp(m, 0.5);
    }
    if (off === undefined) return a;
    const R = ringR(p.gen);
    const th = theta.get(p.id) ?? 0;
    const sgn = Math.sign(off);
    const inner = Math.abs(off) - seatR(mother) - gapM / 2;
    // On the marriage link itself, which dips by linkDip * sin(pi * min(1, 1.15 t)) along its length.
    const t = Math.min(1, inner / Math.abs(off));
    return polar(R - linkDip(p, mother) * Math.sin(Math.PI * Math.min(1, t * 1.15)), th + (sgn * inner) / R);
  };
  // Marriage links.
  for (const p of M.people) {
    if (p.mi) continue;
    for (const w of wives.get(p.id) ?? []) {
      const yr = spouseYear(M, w);
      if (p === M.root) {
        const a = atOf(p.id);
        const b = atOf(w.id);
        ribbon(
          sample(8, (t) => a.clone().lerp(b, t)),
          ribW * 0.8,
          yr,
          w.id,
          1,
          0.05,
        );
        continue;
      }
      const R = ringR(p.gen);
      const th = theta.get(p.id) ?? 0;
      const off = offsets.get(w.id) ?? 0;
      const dip = linkDip(p, w);
      ribbon(
        sample(Math.max(8, Math.ceil(Math.abs(off) * 1.5)), (t) =>
          polar(R - dip * Math.sin(Math.PI * Math.min(1, t * 1.15)), th + (off * t) / R),
        ),
        ribW * 0.8,
        yr,
        w.id,
        1,
        0.05,
      );
    }
  }
  // Descent: a smooth radial S from the couple's link to the child (cubic Bezier in the floor plane).
  const b3 = (p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number) => {
    const u = 1 - t;
    return new Vector2(
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    );
  };
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const mother = p.parents.map((q) => M.get(q)).find((q) => q.anchor === par.id);
    const s0 = hang(par, mother);
    const c3 = atOf(p.id);
    const dc = c3.clone().normalize();
    const r0 = s0.length();
    const d0 = r0 > 0.5 ? s0.clone().normalize() : dc;
    const pull = step * 0.5;
    const c1 = s0.clone().addScaledVector(d0, pull);
    const c2 = c3.clone().addScaledVector(dc, -pull);
    ribbon(
      sample(big ? 14 : 22, (t) => b3(s0, c1, c2, c3, t)),
      ribW,
      p.born,
      p.id,
      0,
      0.04,
    );
  }
  const rg = new BufferGeometry();
  rg.setAttribute('position', new Float32BufferAttribute(rb.pos, 3));
  rg.setAttribute('aT', new Float32BufferAttribute(rb.t, 1));
  rg.setAttribute('aSide', new Float32BufferAttribute(rb.side, 1));
  rg.setAttribute('aBirth', new Float32BufferAttribute(rb.birth, 1));
  rg.setAttribute('aKind', new Float32BufferAttribute(rb.kind, 1));
  rg.setAttribute('aLen', new Float32BufferAttribute(rlen, 1));
  rg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(keys.length), 1));
  rg.setIndex(idx);
  rg.userData.keys = keys;
  const ribUni = {
    ...U,
    uFocus: { value: 0 },
    uSheen: { value: 0 },
    uGold: { value: col('#000000') },
    uGoldLo: { value: col('#000000') },
    uTeal: { value: col('#000000') },
  };
  const ribMat = new ShaderMaterial({
    uniforms: ribUni,
    vertexShader: RIB_VERT,
    fragmentShader: RIB_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const ribbons = new Mesh(rg, ribMat);
  ribbons.renderOrder = 1;
  ribbons.frustumCulled = false;
  group.add(ribbons);

  // ---------- seats: one instanced star roundel per person ----------
  const sg = new InstancedBufferGeometry();
  sg.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  sg.setIndex([0, 1, 2, 0, 2, 3]);
  const aOff = new Float32Array(n * 3);
  const aR = new Float32Array(n);
  const aBirth = new Float32Array(n);
  const aDeath = new Float32Array(n);
  M.people.forEach((p, i) => {
    const a = atOf(p.id);
    aOff.set([a.x, 0.08, a.y], i * 3);
    aR[i] = seatR(p);
    aBirth[i] = p.born;
    aDeath[i] = p.died ?? 9999;
  });
  sg.setAttribute('aOff', new InstancedBufferAttribute(aOff, 3));
  sg.setAttribute('aR', new InstancedBufferAttribute(aR, 1));
  sg.setAttribute('aBirth', new InstancedBufferAttribute(aBirth, 1));
  sg.setAttribute('aDeath', new InstancedBufferAttribute(aDeath, 1));
  sg.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  sg.instanceCount = n;
  sg.userData.keys = M.people.map((p) => p.id);
  const seatUni = {
    ...U,
    uFocus: { value: 0 },
    uHalo: { value: 0 },
    uSheen: { value: 0 },
    uSeat: { value: col('#000000') },
    uGold: { value: col('#000000') },
    uGoldLo: { value: col('#000000') },
    uTeal: { value: col('#000000') },
    uInk: { value: col('#000000') },
  };
  const seats = new Mesh(
    sg,
    new ShaderMaterial({
      uniforms: seatUni,
      vertexShader: SEAT_VERT,
      fragmentShader: SEAT_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  seats.renderOrder = 2;
  seats.frustumCulled = false;
  group.add(seats);

  // ---------- the medallion floor ----------
  let maxR = 0;
  for (const v of at.values()) maxR = Math.max(maxR, v.length());
  const rMax = Math.max(maxR, ringR(M.maxGen));
  const Rb = rMax + step * 0.5;
  const lw = big ? 0.26 : 0.17;
  const Rm = Rb + Math.max(step * 0.62, lw * 30);
  // Girih tile edge for the field: a little larger than a portrait, so the strapwork reads at "fit all".
  const s0 = Math.min(Math.max(Rm / 17, 3.2), 9);
  const hw = s0 * 0.1;
  const R0 = (Rm + 4) / Math.cos(Math.PI / 10);
  const levels = Math.min(14, Math.max(3, Math.round(Math.log(R0 / s0) / Math.log((1 + Math.sqrt(5)) / 2))));
  const rIn = ringR(1) - 0.5 * step;
  const floorUni = {
    uTime: U.uTime,
    uStep: { value: step },
    uR1: { value: ringR(1) },
    uRb: { value: Rb },
    uRm: { value: Rm },
    uR0: { value: R0 },
    uHW: { value: hw },
    uLW: { value: lw },
    uE: { value: (rIn - 0.08 * step) / 3.078 },
    uCalm: { value: 0.4 },
    uCalmFill: { value: 1 },
    uAlt: { value: 0 },
    uSheen: { value: 0.1 },
    uSeps: { value: Math.max(1, M.maxGen) },
    uVeinK: { value: 0.5 },
    uShadow: { value: 0 },
    uLevels: { value: levels },
    uNoise: { value: marbleTexture() },
    uStage: { value: col('#000000') },
    uLift: { value: col('#000000') },
    uMarble: { value: col('#000000') },
    uVein: { value: col('#000000') },
    uGold: { value: col('#000000') },
    uGoldLo: { value: col('#000000') },
    uLapis: { value: col('#000000') },
    uInk: { value: col('#000000') },
    uLine: { value: col('#000000') },
  };
  const floorGeo = new CircleGeometry(Math.max(1400, Rm * 6), 160);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new Mesh(
    floorGeo,
    new ShaderMaterial({ uniforms: floorUni, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG }),
  );
  floor.frustumCulled = false;
  group.add(floor);
  const domeUni = { uStage: { value: col('#000000') } };
  const dome = new Mesh(
    new SphereGeometry(Math.max(1500, Rm * 6.5), 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: domeUni,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: DOME_FRAG,
    }),
  );
  group.add(dome);

  // Colours for the current theme; tint() also sets the engine's bloom, so only the engine calls it.
  const paint = () => {
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    floorUni.uStage.value.set(L.stage);
    floorUni.uLift.value.set(L.lift);
    floorUni.uMarble.value.set(L.marble);
    floorUni.uVein.value.set(L.vein);
    floorUni.uGold.value.set(L.gold);
    floorUni.uGoldLo.value.set(L.goldLo);
    floorUni.uLapis.value.set(L.lapis);
    floorUni.uInk.value.set(L.ink);
    floorUni.uCalm.value = L.calm;
    floorUni.uCalmFill.value = L.calmFill;
    floorUni.uAlt.value = L.alt;
    floorUni.uLine.value.set(L.line);
    floorUni.uSheen.value = L.sheen;
    floorUni.uVeinK.value = L.veinK;
    floorUni.uShadow.value = L.shadow;
    domeUni.uStage.value.set(L.stage);
    seatUni.uSeat.value.set(L.seat);
    seatUni.uGold.value.set(L.gold);
    seatUni.uGoldLo.value.set(L.goldLo);
    seatUni.uTeal.value.set(L.teal);
    seatUni.uInk.value.set(L.ink);
    seatUni.uHalo.value = L.halo;
    seatUni.uSheen.value = L.sheen;
    ribUni.uGold.value.set(L.rib);
    ribUni.uGoldLo.value.set(L.goldLo);
    ribUni.uTeal.value.set(L.teal);
    ribUni.uSheen.value = L.sheen;
  };
  paint();
  const tint = () => {
    paint();
    ctx.look((ctx.dark() ? LOOK.dark : LOOK.light).bloom, 1);
  };

  const D = Rm * 2.4 + 10;
  const el = (56 * Math.PI) / 180;
  return {
    key: 'mandala',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    tint,
    labelUp: true,
    hiTargets: [{ geo: sg, perPerson: true }, { geo: rg }],
    focus: [seatUni.uFocus, ribUni.uFocus],
    view: {
      target: new Vector3(0, 0, Rm * 0.04),
      cam: new Vector3(D * Math.cos(el) * 0.22 * mir, D * Math.sin(el), D * Math.cos(el) * 0.975 + Rm * 0.04),
    },
    follow: big ? 20 : 26,
  };
};
