import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LatheGeometry,
  Mesh,
  Points,
  QuadraticBezierCurve3,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { NOW, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import type { SceneBuilder } from './types.ts';

// Hourglass: one person at the waist, their ancestors in the upper bulb and their descendants in
// the lower, the brothers and sisters on the brass girdle round the waist and the wider family on
// rings on the floor. A crystal hourglass in a turned brass frame; its sand follows the timeline,
// draining from the past above into the future below. It recentres on whoever is picked.

const LOOK = {
  dark: {
    // Crystal and brass on black, golden sand.
    stage: '#000000',
    pool: '#141414',
    glass: '#e6e9ec',
    glassBody: 0.025,
    glassEdge: 0.5,
    brass: '#c0954f',
    brassLo: '#2e2008',
    sand: '#c89f5c',
    sandLo: '#5e4520',
    thread: '#a3a3a3',
    gold: '#e2b65a',
    teal: '#4fd1bd',
    sky: '#3a3a3a',
    ground: '#080808',
    env: 0.06,
    ring: '#1c1c1c',
    shadow: 0,
    bloom: 0.45,
  },
  light: {
    // The same on white: grey crystal edges, brass, warm beige sand, soft contact shadow.
    stage: '#ebebeb',
    pool: '#f6f6f6',
    glass: '#4a4a4a',
    glassBody: 0.03,
    glassEdge: 0.56,
    brass: '#b88a3e',
    brassLo: '#3a2a0e',
    sand: '#c9ac84',
    sandLo: '#8c7352',
    thread: '#6e6e6e',
    gold: '#a77c31',
    teal: '#0f6b63',
    sky: '#ffffff',
    ground: '#bdbdbd',
    env: 0.55,
    ring: '#d4d4d4',
    shadow: 1,
    bloom: 0,
  },
};

const col = (hex: string) => new Color(hex);

/** Display-referred shading (see mandala.ts): colours are written so the engine's ACES tone mapping shows them as is. */
const GLSL_TONE = /* glsl */ `
  const mat3 IIN = mat3(vec3(1.764741, -.147028, -.036337), vec3(-.675778, 1.160252, -.162436), vec3(-.088963, -.013224, 1.198773));
  const mat3 IOUT = mat3(vec3(.643038, .059269, .005962), vec3(.311187, .931436, .063929), vec3(.045775, .009295, .930118));
  vec3 unTone(vec3 c) {
    vec3 y = clamp(IOUT * c, 0., .985);
    vec3 a = 1. - y * .983729, b = .0245786 - y * .432951, k = -(.000090537 + y * .238081);
    return max(IIN * ((-b + sqrt(max(b * b - 4. * a * k, 0.))) / (2. * a)), 0.) * .6;
  }`;

/** A photographer's studio for reflections: a dim sky, two soft boxes and a floor bounce. */
const GLSL_STUDIO = /* glsl */ `
  uniform float uEnv;
  float skyEnv(vec3 r) { return mix(.02, .12, smoothstep(-.2, .8, r.y)) + uEnv * (.35 + .45 * smoothstep(-.4, .6, r.y)); }
  // Tall soft boxes (a key at the front left, a narrow fill behind on the right) and a small overhead box, off axis so
  // flat glass (the cap) only catches it at some angles.
  float strip(vec3 r, float az, float w) {
    // atan(0, 0) is undefined (NaN on some GPUs, which the bloom would spread over the frame).
    float d = abs(mod(atan(r.z, abs(r.x) + abs(r.z) < 1e-7 ? 1. : r.x) - az + 3.14159, 6.28318) - 3.14159);
    return (1. - smoothstep(w * .55, w, d)) * smoothstep(-.4, -.15, r.y) * (1. - smoothstep(.5, .8, r.y));
  }
  float boxes(vec3 r) {
    return strip(r, 2.2, .17) * 1.1 + strip(r, -.6, .08) * .65 + smoothstep(.975, .995, dot(r, vec3(.28, .94, .19))) * .45;
  }
  float studio(vec3 r) { return skyEnv(r) + boxes(r); }`;

const GLSL_WALL = /* glsl */ `
  uniform float uH, uRb, uRn;
  float prof(float t) { float a = min(1., t / .66); float s = 1. - pow(1. - a, 2.6);
    float c = t > .66 ? 1. - .16 * pow((t - .66) / .34, 2.) : 1.; return s * c; }
  float rWall(float y) { return uRn + (uRb - uRn) * prof(clamp(abs(y) / uH, 0., 1.)); }`;

const GLASS_VERT = /* glsl */ `
  varying vec3 vN, vW;
  void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w; }`;

const GLASS_FRAG = /* glsl */ `
  uniform vec3 uGlass; uniform float uBody, uEdge, uTime, uBack;
  varying vec3 vN, vW;
  ${GLSL_TONE}
  ${GLSL_STUDIO}
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    if (!gl_FrontFacing) n = -n;
    float ndv = abs(dot(n, v));
    float fr = pow(max(1. - ndv, 0.), 2.6);
    vec3 r = reflect(-v, n);
    float box = boxes(r);
    // A slow glint travels round the bulbs (the one ambient motion of the glass).
    float glint = smoothstep(.97, 1., sin(vW.y * .22 - uTime * .35 + atan(vW.z, abs(vW.x) + abs(vW.z) < 1e-7 ? 1. : vW.x) * 2.) * .5 + .5) * fr * .5;
    // Grazing reflections of the dark floor stay dark (from above the walls are all grazing); the rims that face the
    // room and the sky keep their crystal edge.
    float lit = mix(.1, 1., smoothstep(-.75, -.25, r.y));
    // Weighted layers: a faint body film (a dim tint, so stacked layers seen from above do not turn milky), the rim in
    // the glass colour, and the soft boxes and the glint in white.
    float wBody = uBody, wRim = fr * uEdge * lit + skyEnv(r) * uEnv * .12, wHi = (box * .36 + glint) * (uBack > .5 ? .5 : 1.);
    float a = wBody + wRim + wHi;
    vec3 c = min((uGlass * (wBody * .35 + wRim) + vec3(wHi)) / max(a, 1e-4), vec3(.84));
    gl_FragColor = vec4(unTone(c), clamp(a, 0., .85) * (uBack > .5 ? .5 : 1.));
  }`;

const BRASS_VERT = /* glsl */ `
  varying vec3 vN, vW; varying float vY;
  void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vY = position.y;
    gl_Position = projectionMatrix * viewMatrix * w; }`;

const BRASS_FRAG = /* glsl */ `
  uniform vec3 uBrass, uBrassLo, uSky, uGround;
  varying vec3 vN, vW; varying float vY;
  ${GLSL_TONE}
  ${GLSL_STUDIO}
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    vec3 L = normalize(vec3(-.5, .85, .55));
    float dif = max(dot(n, L), 0.);
    vec3 hemi = mix(uGround, uSky, n.y * .5 + .5);
    float ndv = max(dot(n, v), 0.);
    float fr = pow(max(1. - ndv, 0.), 5.);
    // Turned on a lathe: fine rings catch the light.
    float turn = .9 + .1 * sin(vY * 9.) * sin(vY * 2.3 + 1.);
    vec3 r = reflect(-v, n);
    float env = studio(r) * turn;
    vec3 spec = mix(uBrass, vec3(1., .96, .88), fr) * env;
    vec3 c = uBrassLo * (hemi * .6 + dif * .5) + spec * .95;
    c += uBrass * pow(max(dot(r, L), 0.), 60.) * .6;
    gl_FragColor = vec4(unTone(c), 1.);
  }`;

const SAND_VERT = /* glsl */ `
  attribute float aU, aAng, aWhich;
  uniform float uTop, uBot, uY0, uPush;
  varying vec3 vN, vW;
  ${GLSL_WALL}
  void main() {
    float y, r; vec3 n;
    float ca = cos(aAng), sa = sin(aAng);
    if (aWhich < .5) {
      // Upper bulb: sand lies against the glass from the neck to its level, with a funnel draining to the neck.
      if (aU < .5) { y = mix(uY0, uTop, aU * 2.); r = rWall(y) * .955; n = vec3(ca, .15, sa); }
      else { float s = (aU - .5) * 2.; float rw = rWall(uTop) * .955; r = rw * (1. - s); y = max(uTop - (rw - r) * .5, uY0);
        n = vec3(-ca * .5, 1., -sa * .5); }
    } else {
      // Lower bulb: a heap at the angle of repose under the falling stream.
      if (aU < .5) { y = mix(-uH * .985, uBot, aU * 2.); r = rWall(y) * .955; n = vec3(ca, -.1, sa); }
      else { float s = (aU - .5) * 2.; float rw = rWall(uBot) * .955; r = rw * (1. - s); y = uBot + (rw - r) * .26;
        n = vec3(ca * .26, 1., sa * .26); }
    }
    vN = normalize(n);
    vec4 w = modelMatrix * vec4(ca * r, y, sa * r, 1.);
    vW = w.xyz;
    // Drawn where it is, but its depth sits a little further back along the view ray, so the portrait at the
    // waist and the threads just behind the sand stay visible through it.
    vec4 clip = projectionMatrix * viewMatrix * w;
    vec4 back = projectionMatrix * viewMatrix * vec4(w.xyz + normalize(w.xyz - cameraPosition) * uPush, 1.);
    float bw = abs(back.w) < 1e-6 ? 1e-6 : back.w;
    gl_Position = vec4(clip.xy, back.z / bw * clip.w, clip.w);
  }`;

const SAND_FRAG = /* glsl */ `
  uniform vec3 uSand, uSandLo, uSky, uGround; uniform float uTime;
  varying vec3 vN, vW;
  ${GLSL_TONE}
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
    vec3 L = normalize(vec3(-.5, .85, .55));
    float dif = max(dot(n, L), 0.);
    vec3 hemi = mix(uGround, uSky, n.y * .5 + .5);
    float g = hash(floor(vW * 9.));
    float g2 = hash(floor(vW * 31.));
    vec3 c = mix(uSandLo, uSand, .35 + .45 * dif + .2 * (n.y * .5 + .5)) * (.9 + .1 * g + .06 * g2) + uSand * hemi * .08;
    float tw = step(.985, g2) * pow(max(.5 + .5 * sin(uTime * 2.6 + g * 40.), 0.), 10.);
    c += vec3(1., .92, .75) * tw * .8;
    gl_FragColor = vec4(unTone(c), 1.);
  }`;

const STREAM_VERT = /* glsl */ `
  attribute float aPh; attribute vec3 aJ;
  uniform float uTime, uPeak, uPx, uStart;
  varying float vA;
  void main() {
    // Grains leave the bottom of the upper sand, fall through the neck and land on the heap.
    float t = fract(uTime * .7 + aPh);
    float y = mix(uStart, uPeak, pow(t, 1.35));
    vec3 p = vec3(aJ.x, 0., aJ.y) * (.05 + .12 * t) + vec3(0., y, 0.);
    if (t > .97) p.xz += aJ.xy * 1.2;
    vA = (.55 + .45 * aJ.z) * smoothstep(0., .04, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = uPx * (.55 + .45 * aJ.z) / max(-mv.z, .1);
    gl_Position = projectionMatrix * mv;
  }`;

const STREAM_FRAG = /* glsl */ `
  uniform vec3 uSand;
  varying float vA;
  ${GLSL_TONE}
  void main() { float d = length(gl_PointCoord - .5); if (d > .5) discard;
    gl_FragColor = vec4(unTone(uSand * 1.1), (1. - smoothstep(.25, .5, d)) * vA); }`;

const THREAD_VERT = /* glsl */ `
  attribute vec3 aTan; attribute float aSide, aT, aBirth, aKind, aHi;
  uniform float uW;
  varying float vSide, vT, vBirth, vKind, vHi;
  void main() {
    vec3 w = (modelMatrix * vec4(position, 1.)).xyz;
    vec3 cr = cross(normalize(aTan), normalize(cameraPosition - w));
    float cl = length(cr);
    vec3 s = cl > 1e-6 ? cr / cl : vec3(1., 0., 0.);
    w += s * aSide * uW * (aKind > .5 ? .8 : aHi > .5 ? 1.6 : 1.);
    vSide = aSide; vT = aT; vBirth = aBirth; vKind = aKind; vHi = aHi;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  }`;

const THREAD_FRAG = /* glsl */ `
  uniform float uYear, uEnter, uMinYear, uTime, uFocus, uLight;
  uniform vec3 uThread, uGold, uTeal;
  varying float vSide, vT, vBirth, vKind, vHi;
  ${GLSL_TONE}
  void main() {
    bool hi = vHi > .5;
    float sd = vSide / (hi ? 1. : .5);
    // Derivatives before any discard (they are undefined once pixels of a quad take different paths).
    float aa = max(fwidth(sd) * 1.3, 1e-4);
    float yr = mix(uMinYear - 3., uYear, uEnter);
    float g = clamp((yr - vBirth) / 1.3, 0., 1.);
    if (vT > g) discard;
    float cov = 1. - smoothstep(1. - aa, 1., abs(sd));
    if (cov <= 0.) discard;
    vec3 base = vKind > .5 ? uGold : hi ? uTeal : uThread;
    float pulse = smoothstep(.82, 1., fract(vT * 2.2 - uTime * .4));
    vec3 c = base * (1. + (vKind > .5 ? 0. : hi ? .5 : .15) * pulse * (1. - uLight * .6));
    float a = cov * (vKind > .5 ? .95 : hi ? 1. : .55);
    a *= uFocus > .5 && !hi ? .2 : 1.;
    gl_FragColor = vec4(unTone(c), a);
  }`;

const FLOOR_VERT = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uStage, uPool, uRing; uniform float uRp, uR0, uGap, uRings, uShadow;
  varying vec3 vW;
  ${GLSL_TONE}
  void main() {
    float r = length(vW.xz);
    float px = max(length(fwidth(vW.xz)), 1e-4);
    vec3 c = mix(uPool, uStage, smoothstep(uRp * .4, uRp * 3.2, r));
    // Contact shadow under the base and a long soft shadow away from the key light.
    float ao = exp(-max(r - uRp * .55, 0.) / (uRp * .22));
    vec2 q = vW.xz - vec2(.5, -.55) * uRp * .9;
    q = vec2(dot(q, vec2(.67, -.74)), dot(q, vec2(.74, .67)));
    float longShadow = exp(-dot(q / vec2(uRp * 1.25, uRp * .62), q / vec2(uRp * 1.25, uRp * .62)));
    c *= 1. - uShadow * (.2 * ao + .07 * longShadow);
    // Rings where the wider family stands.
    float f = (r - uR0) / uGap;
    float k = floor(f + .5);
    if (k >= 0. && k < uRings) {
      float lw = max(.06, px * .6);
      c = mix(c, uRing, 1. - smoothstep(lw - px, lw + px, abs(f - k) * uGap));
    }
    gl_FragColor = vec4(unTone(c), 1.);
  }`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 uStage;
  ${GLSL_TONE}
  void main() { gl_FragColor = vec4(unTone(uStage), 1.); }`;

interface Unit {
  /** Line person (the unit's anchor) and anyone laid out beside them. */
  members: Array<{ id: string; off: number }>;
  /** Width in seats. */
  w: number;
  /** Desired angle. */
  a: number;
}

/** Pushes units apart round a circle until neighbours keep their widths (radians), keeping their order. */
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

export const hourScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const n = M.n;
  const f = M.byId.get(ctx.focusId()) ?? M.root;
  const mir = ctx.rtl() ? -1 : 1;
  const size = big ? 1.3 : 2;
  const medR = (p: StudioPerson) => 1.15 * size * sizeFactor(p);
  const slot = 2.3 * size * (big ? 1.1 : 1.16);

  // ---------- who goes where ----------
  // Spouses laid out beside their partner (married in, anchored to them), in marriage order.
  const wives = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const l = wives.get(p.anchor) ?? [];
    l.push(p);
    wives.set(p.anchor, l);
  }
  for (const l of wives.values()) l.sort((a, b) => spouseIndex(M, a) - spouseIndex(M, b));
  const placed = new Set<string>([f.id]);
  /** Spouses seated beside their partner, linked in gold: partner, wedding year and the highlight key (the person who
   * married in, so the engine lights the link whenever their partner's line is selected). */
  const beside = new Map<string, { partner: string; year: number; key: string }>();
  const unitOf = (p: StudioPerson, a: number): Unit => {
    const members = [{ id: p.id, off: 0 }];
    let plus = 0;
    let minus = 0;
    for (const [j, w] of (wives.get(p.id) ?? []).entries()) {
      if (placed.has(w.id)) continue;
      placed.add(w.id);
      beside.set(w.id, { partner: p.id, year: spouseYear(M, w), key: w.id });
      if (j % 2 === 0) members.push({ id: w.id, off: ++plus });
      else members.push({ id: w.id, off: -++minus });
    }
    // Centre the unit on its angle.
    const mid = (plus - minus) / 2;
    for (const m of members) m.off -= mid;
    return { members, w: members.length, a };
  };

  // Ancestors: each person's parents share their sector, father's side first.
  const anc = new Map<string, { k: number; a: number }>();
  let up = 0;
  const climb = (id: string, k: number, s0: number, s1: number) => {
    const par = [...M.get(id).parents].sort((x, y) => (M.get(x).sex === 'M' ? 0 : 1) - (M.get(y).sex === 'M' ? 0 : 1));
    par.forEach((pid, j) => {
      if (anc.has(pid) || pid === f.id) return;
      const a0 = s0 + ((s1 - s0) * j) / par.length;
      const a1 = s0 + ((s1 - s0) * (j + 1)) / par.length;
      anc.set(pid, { k, a: (a0 + a1) / 2 });
      up = Math.max(up, k);
      climb(pid, k + 1, a0, a1);
    });
  };
  climb(f.id, 1, 0, 1);
  // Descendants: sectors weighted by how many leaves each line has.
  const memo = new Map<string, number>();
  const busy = new Set<string>();
  const leaves = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (busy.has(id)) return 1;
    busy.add(id);
    const kids = M.get(id).children.filter((c) => !anc.has(c) && c !== f.id);
    const v = kids.length ? kids.reduce((s, c) => s + leaves(c), 0) : 1;
    busy.delete(id);
    memo.set(id, v);
    return v;
  };
  const des = new Map<string, { k: number; a: number }>();
  let down = 0;
  const descend = (id: string, k: number, s0: number, s1: number) => {
    const kids = M.get(id).children.filter((c) => !anc.has(c) && c !== f.id && !des.has(c));
    const tot = kids.reduce((s, c) => s + leaves(c), 0) || 1;
    let a = s0;
    for (const c of kids) {
      const w = ((s1 - s0) * leaves(c)) / tot;
      if (!des.has(c)) {
        des.set(c, { k, a: a + w / 2 });
        down = Math.max(down, k);
        descend(c, k + 1, a, a + w);
      }
      a += w;
    }
  };
  descend(f.id, 1, 0, 1);
  const sibs = [...new Set(f.parents.flatMap((pid) => M.get(pid).children))].filter(
    (id) => id !== f.id && !anc.has(id) && !des.has(id),
  );

  // ---------- generations, then the glass sized to hold them ----------
  // Parents keep their own sectors (father's side, mother's side), so mark the whole line before grouping.
  for (const id of anc.keys()) placed.add(id);
  for (const id of des.keys()) placed.add(id);
  // Angle 0 of a sector is the front of the glass; the father's line turns to the left (right in Arabic).
  const ang = (s: number) => Math.PI / 2 + s * Math.PI * 2;
  const gens = (src: Map<string, { k: number; a: number }>, depth: number) => {
    const out: Unit[][] = [];
    for (let k = 1; k <= depth; k++) {
      const units: Unit[] = [];
      for (const [id, v] of src) if (v.k === k) units.push(unitOf(M.get(id), ang(v.a)));
      units.sort((x, y) => x.a - y.a);
      out.push(units);
    }
    return out;
  };
  const upGens = gens(anc, up);
  const downGens = gens(des, down);
  // The waist: the focus's husbands or wives beside them (whichever of the two married into the family), in marriage
  // order, then the brothers and sisters (with their spouses) on the girdle ring, eldest first.
  const atWaist = f.spouses.filter((sp) => !placed.has(sp.id) && M.byId.has(sp.id));
  for (const sp of atWaist) {
    placed.add(sp.id);
    // Keyed by the focus: the hourglass is only ever selected on its focus, so the link lights with the lineage.
    beside.set(sp.id, { partner: f.id, year: sp.year, key: f.id });
  }
  const sibUnits = sibs
    .filter((id) => !placed.has(id))
    .sort((a, b) => M.get(a).born - M.get(b).born)
    .map((id, i, all) => {
      placed.add(id);
      return unitOf(M.get(id), Math.PI * (0.62 + (1.76 * (i + 0.5)) / Math.max(1, all.length)));
    });
  for (const u of sibUnits) for (const m of u.members) placed.add(m.id);
  const spread = atWaist.length ? (1 + Math.floor((atWaist.length - 1) / 2)) * slot * 1.05 : 0;
  const sibSeats = sibUnits.reduce((n, u) => n + u.w, 0);
  /** Radius the waist ring needs: clear of the focus's spouses, and room for every brother and sister. */
  const waistNeed = Math.max(spread + slot * 1.15, (sibSeats * slot) / (Math.PI * 2 * 0.8));
  const prof = (t: number) => {
    const a = Math.min(1, t / 0.66);
    const s = 1 - (1 - a) ** 2.6;
    return s * (t > 0.66 ? 1 - 0.16 * ((t - 0.66) / 0.34) ** 2 : 1);
  };
  const RK = 0.76;
  // The bulb radius each generation would need on a single ring at its default height; capped (tiers take the rest).
  const needR = (levels: Unit[][], t0: number, t1: number) =>
    levels.reduce((m, units, k) => {
      const t = levels.length <= 1 ? (t0 + t1) / 2 : t0 + ((t1 - t0) * k) / (levels.length - 1);
      const w = units.reduce((s, u) => s + u.w, 0) * slot;
      return Math.max(m, w / (Math.PI * 2 * 0.9) / (RK * prof(t)));
    }, 0);
  let Rb = Math.min(big ? 62 : 32, Math.max(17, needR(upGens, 0.45, 0.92), needR(downGens, 0.12, 0.64)));
  // The brass girdle (its tube's inner edge at about 1.094 Rb) stays clear of the waist ring's portraits, with room
  // for a selected portrait's growth and the gentle bob.
  Rb = Math.max(Rb, (waistNeed + medR(f) * 1.3 + 0.3) / 1.0938);
  let H = Rb * 1.2;
  let rn = Rb * 0.055;
  const rWall = (y: number) => rn + (Rb - rn) * prof(Math.min(1, Math.abs(y) / H));
  // People ride on a ring at 76% of the glass radius at their height; crowded generations split into tiers.
  const tierGap = 2.3 * size;
  const fits = (units: Unit[], T: number, t: number, r: number) => {
    let w = 0;
    units.forEach((u, i) => {
      if (i % T === t) w += u.w;
    });
    return w * slot <= Math.PI * 2 * r * 0.86;
  };
  /**
   * Rows (generation k, tier t) from y0 (near the waist) towards y1: a tier apart within a generation, more between.
   * Tiers are added to a generation until every row fits the ring at its own height.
   */
  const plan = (levels: Unit[][], y0: number, y1: number) => {
    const T = levels.map(() => 1);
    const span = Math.abs(y1 - y0);
    const dir = Math.sign(y1 - y0) || 1;
    let rows: Array<{ k: number; t: number; T: number; p: number; y: number }> = [];
    let p = 0;
    for (let pass = 0; pass < 24; pass++) {
      rows = [];
      p = 0;
      T.forEach((tk, k) => {
        for (let t = 0; t < tk; t++) {
          if (rows.length) p += t === 0 ? 1.35 : 1;
          rows.push({ k, t, T: tk, p, y: 0 });
        }
      });
      const unit = p > 0 ? Math.min(span / p, tierGap * 1.9) : 0;
      const extra = span - unit * p;
      for (const r of rows) r.y = y0 + dir * (extra / 2 + r.p * unit);
      let grew = false;
      for (let k = 0; k < levels.length; k++) {
        const tk = T[k] ?? 1;
        const bad = rows.some((r) => r.k === k && !fits(levels[k] ?? [], tk, r.t, rWall(r.y) * RK));
        if (bad && tk < 12) {
          T[k] = tk + 1;
          grew = true;
        }
      }
      if (!grew) break;
    }
    return { rows, need: p * tierGap };
  };
  // Upper bulb: above its sand (0.45 to 0.92 of the height). Lower bulb: from at least a row below the waist (clear of
  // the focus's spouses and name) down to above the heap (0.64).
  const lowTop = () => -Math.max(H * 0.12, tierGap * 1.1);
  for (let pass = 0; pass < 3; pass++) {
    const a = plan(upGens, H * 0.45, H * 0.92);
    const b = plan(downGens, lowTop(), -H * 0.64);
    const Hneed = Math.max(a.need / 0.47, b.need / 0.52, (b.need + tierGap * 1.1) / 0.64);
    if (Hneed <= H * 1.001) break;
    H = Hneed;
    Rb = Math.max(Rb, H / 1.5);
    rn = Rb * 0.055;
  }
  const colR = Rb * 0.042;
  const Rc = Rb * 1.04 + colR * 1.7;
  const Rp = Rc + colR * 2.4;
  const Th = H * 0.075;
  const footH = Rp * 0.06;
  const floorY = -H - Th - footH;

  const at = new Map<string, Vector3>();
  at.set(f.id, new Vector3(0, 0, 0));
  const put = (id: string, r: number, a: number, y: number) =>
    at.set(id, new Vector3(Math.cos(a) * r * mir, y, Math.sin(a) * r));
  const lay = (levels: Unit[][], y0: number, y1: number) => {
    for (const row of plan(levels, y0, y1).rows) {
      const tier = (levels[row.k] ?? []).filter((_, i) => i % row.T === row.t);
      const rt = rWall(row.y) * RK;
      const a = tier.map((u) => u.a);
      relax(
        a,
        tier.map((u) => (u.w * slot) / rt),
      );
      tier.forEach((u, i) => {
        for (const m of u.members) put(m.id, rt, (a[i] ?? 0) + (m.off * slot) / rt, row.y);
      });
    }
  };
  lay(upGens, H * 0.45, H * 0.92);
  lay(downGens, lowTop(), -H * 0.64);
  atWaist.forEach((sp, j) => {
    const side = (j % 2 ? -1 : 1) * (1 + Math.floor(j / 2));
    at.set(sp.id, new Vector3(side * slot * 1.05 * mir, 0, 0));
  });
  const rW = Math.max(Rb * 0.66, waistNeed);
  {
    const a = sibUnits.map((u) => u.a);
    relax(
      a,
      sibUnits.map((u) => (u.w * slot) / rW),
    );
    sibUnits.forEach((u, i) => {
      for (const m of u.members) put(m.id, rW, (a[i] ?? 0) + (m.off * slot) / rW, 0);
    });
  }
  // Everyone else: rings on the floor round the base, older generations inside, branches together.
  // Line people first (their spouses join their unit), then anyone left over.
  const restUnits: Array<{ u: Unit; p: StudioPerson }> = [];
  for (const pass of [0, 1])
    for (const p of M.people) {
      if (placed.has(p.id) || (pass === 0 && p.mi)) continue;
      placed.add(p.id);
      restUnits.push({ u: unitOf(p, 0), p });
    }
  restUnits.sort((x, y) => x.p.gen - y.p.gen || x.p.ang - y.p.ang);
  const r0 = Rp + slot * 1.3;
  const ringGap = slot * 1.15;
  let rings = 0;
  {
    let i = 0;
    let r = r0;
    while (i < restUnits.length) {
      const cap = (Math.PI * 2 * r * 0.96) / slot;
      const row: Unit[] = [];
      let used = 0;
      while (i < restUnits.length && used + (restUnits[i]?.u.w ?? 1) <= Math.max(cap, 1)) {
        const u = restUnits[i]?.u as Unit;
        row.push(u);
        used += u.w;
        i++;
      }
      let a = Math.PI / 2;
      const step = (Math.PI * 2) / Math.max(used, 1);
      for (const u of row) {
        const mid = a + (u.w * step) / 2;
        for (const m of u.members) put(m.id, r, mid + m.off * step, floorY + medR(M.get(m.id)) + 0.7);
        a += u.w * step;
      }
      rings++;
      r += ringGap;
    }
  }
  // Safety: anyone still unplaced (bad data) joins the focus's side.
  for (const p of M.people) if (!at.has(p.id)) at.set(p.id, new Vector3(rW * mir, 0, 0));

  const pos = new Float32Array(n * 3);
  M.people.forEach((p, i) => {
    const v = at.get(p.id) as Vector3;
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  });

  // ---------- threads: parent to child inside the glass, couples in gold ----------
  const tb = {
    pos: [] as number[],
    tan: [] as number[],
    side: [] as number[],
    t: [] as number[],
    birth: [] as number[],
    kind: [] as number[],
  };
  const keys: string[] = [];
  const idx: number[] = [];
  const inLine = (id: string) => id === f.id || anc.has(id) || des.has(id);
  const inLines = (id: string) => inLine(id) || sibs.includes(id);
  const thread = (pts: Vector3[], birth: number, key: string, kind: number) => {
    const base = tb.pos.length / 3;
    const tg = new Vector3();
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)] as Vector3;
      const b = pts[Math.min(pts.length - 1, i + 1)] as Vector3;
      tg.subVectors(b, a);
      if (tg.lengthSq() < 1e-8) tg.set(0, 1, 0);
      for (const s of [-1, 1]) {
        tb.pos.push(p.x, p.y, p.z);
        tb.tan.push(tg.x, tg.y, tg.z);
        tb.side.push(s);
        tb.t.push(i / (pts.length - 1));
        tb.birth.push(birth);
        tb.kind.push(kind);
        keys.push(key);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (const p of M.people) {
    if (!inLines(p.id)) continue;
    for (const pid of p.parents) {
      if (!inLines(pid)) continue;
      const a = at.get(pid);
      const c = at.get(p.id);
      if (!a || !c) continue;
      const m = a.clone().lerp(c, 0.5);
      m.x *= 0.55;
      m.z *= 0.55;
      // Threads within the focus's own line light with it (also both parents in a cousin marriage); a brother's or
      // sister's thread follows the engine's usual rule (lit when their parent is in the lineage).
      const key = inLine(p.id) && inLine(pid) ? f.id : p.id;
      thread(new QuadraticBezierCurve3(a, m, c).getPoints(big ? 14 : 22), p.born, key, 0);
    }
  }
  for (const [id, link] of beside) {
    const a = at.get(link.partner);
    const c = at.get(id);
    if (!a || !c) continue;
    const m = a
      .clone()
      .lerp(c, 0.5)
      .add(new Vector3(0, medR(M.get(id)) * 0.9, 0));
    thread(new QuadraticBezierCurve3(a, m, c).getPoints(10), link.year, link.key, 1);
  }
  const tg = new BufferGeometry();
  tg.setAttribute('position', new Float32BufferAttribute(tb.pos, 3));
  tg.setAttribute('aTan', new Float32BufferAttribute(tb.tan, 3));
  tg.setAttribute('aSide', new Float32BufferAttribute(tb.side, 1));
  tg.setAttribute('aT', new Float32BufferAttribute(tb.t, 1));
  tg.setAttribute('aBirth', new Float32BufferAttribute(tb.birth, 1));
  tg.setAttribute('aKind', new Float32BufferAttribute(tb.kind, 1));
  tg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(keys.length), 1));
  tg.setIndex(idx);
  tg.userData.keys = keys;
  const threadUni = {
    ...U,
    uFocus: { value: 0 },
    uLight: { value: 0 },
    uW: { value: big ? 0.16 : 0.22 },
    uThread: { value: col('#000000') },
    uGold: { value: col('#000000') },
    uTeal: { value: col('#000000') },
  };
  const threads = new Mesh(
    tg,
    new ShaderMaterial({
      uniforms: threadUni,
      vertexShader: THREAD_VERT,
      fragmentShader: THREAD_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  threads.renderOrder = 2;
  threads.frustumCulled = false;
  group.add(threads);

  // ---------- glass ----------
  const gpts: Vector2[] = [];
  const GN = 72;
  for (let i = 0; i <= GN; i++) {
    const y = -H + (2 * H * i) / GN;
    gpts.push(new Vector2(rWall(y), y));
  }
  // The bulbs, closed at the top by a glass cap under the open brass ring.
  const bulbs = new LatheGeometry(gpts, 96);
  const cap = new CircleGeometry(rWall(H), 64);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, H, 0);
  const glassGeo = mergeGeometries([bulbs, cap]);
  bulbs.dispose();
  cap.dispose();
  const glassUni = (back: number) => ({
    uTime: U.uTime,
    uGlass: { value: col('#000000') },
    uBody: { value: 0.03 },
    uEdge: { value: 0.5 },
    uBack: { value: back },
    uEnv: { value: 0 },
  });
  const gBackUni = glassUni(1);
  const gFrontUni = glassUni(0);
  const glassBack = new Mesh(
    glassGeo,
    new ShaderMaterial({
      uniforms: gBackUni,
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      transparent: true,
      depthWrite: false,
      side: BackSide,
    }),
  );
  glassBack.renderOrder = 1;
  const glassFront = new Mesh(
    glassGeo,
    new ShaderMaterial({
      uniforms: gFrontUni,
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      transparent: true,
      depthWrite: false,
      side: FrontSide,
    }),
  );
  glassFront.renderOrder = 3;
  group.add(glassBack, glassFront);

  // ---------- brass frame: an open top ring, a turned base, three baluster columns, a girdle, bun feet ----------
  const lathe = (pts: Array<[number, number]>, segs = 64) =>
    new LatheGeometry(
      pts.map(([r, y]) => new Vector2(Math.max(r, 0.001), y)),
      segs,
    );
  // The top plate is an open ring (the top view looks down through the glass); the base is solid.
  const rMouth = rWall(H) * 0.92;
  const plate = (top: boolean) => {
    const y0 = top ? H : -H;
    const s = top ? 1 : -1;
    const pts: Array<[number, number]> = [
      [top ? rMouth : 0, y0],
      [Rp * 0.9, y0],
      [Rp * 0.97, y0 + s * Th * 0.08],
      [Rp, y0 + s * Th * 0.25],
      [Rp, y0 + s * Th * 0.5],
      [Rp * 0.975, y0 + s * Th * 0.62],
      [Rp * 0.94, y0 + s * Th * 0.66],
      [Rp * 0.93, y0 + s * Th * 0.82],
      [Rp * 0.88, y0 + s * Th],
    ];
    if (top) pts.push([rMouth + colR * 0.8, y0 + Th], [rMouth, y0 + Th * 0.7], [rMouth, y0]);
    else pts.push([Rp * 0.3, y0 - Th * 1.04], [0, y0 - Th * 1.05]);
    return lathe(top ? pts : pts.reverse(), 96);
  };
  const bump = (s: number, m: number, w: number) => Math.exp(-(((s - m) / w) ** 2));
  const colPts: Array<[number, number]> = [];
  for (let i = 0; i <= 120; i++) {
    const s = i / 120;
    const end = s < 0.03 || s > 0.97 ? 1.65 : 0;
    const body = 0.72 + 0.32 * Math.abs(s - 0.5) * 2;
    const r = Math.max(
      end,
      body +
        0.55 * bump(s, 0.06, 0.012) +
        0.55 * bump(s, 0.94, 0.012) +
        0.6 * bump(s, 0.5, 0.016) +
        0.3 * bump(s, 0.5, 0.05),
    );
    colPts.push([r * colR, -H + 2 * H * s]);
  }
  const parts: BufferGeometry[] = [plate(true), plate(false)];
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3 + Math.PI / 3;
    const g = lathe([[0, -H], ...colPts, [0, H]], 18);
    g.translate(Math.cos(a) * Rc, 0, Math.sin(a) * Rc);
    parts.push(g);
    const foot = new SphereGeometry(Rp * 0.075, 16, 10);
    foot.scale(1, 0.75, 1);
    foot.translate(Math.cos(a) * Rp * 0.8, -H - Th - footH * 0.45, Math.sin(a) * Rp * 0.8);
    parts.push(foot);
  }
  const girdle = new TorusGeometry(Rc, colR * 0.42, 10, 128);
  girdle.rotateX(Math.PI / 2);
  parts.push(girdle);
  const brassGeo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  const brassUni = {
    uBrass: { value: col('#000000') },
    uBrassLo: { value: col('#000000') },
    uSky: { value: col('#000000') },
    uGround: { value: col('#000000') },
    uEnv: { value: 0 },
  };
  const brass = new Mesh(
    brassGeo,
    new ShaderMaterial({ uniforms: brassUni, vertexShader: BRASS_VERT, fragmentShader: BRASS_FRAG }),
  );
  group.add(brass);

  // ---------- sand: both piles in one mesh (shaped in the vertex shader), and the falling stream ----------
  const SU = 48;
  const SA = 64;
  const sPos: number[] = [];
  const sU: number[] = [];
  const sAng: number[] = [];
  const sWhich: number[] = [];
  const sIdx: number[] = [];
  for (let which = 0; which < 2; which++) {
    const base = sU.length;
    for (let i = 0; i <= SU; i++)
      for (let j = 0; j <= SA; j++) {
        sPos.push(0, 0, 0);
        sU.push(i / SU);
        sAng.push((j / SA) * Math.PI * 2);
        sWhich.push(which);
      }
    for (let i = 0; i < SU; i++)
      for (let j = 0; j < SA; j++) {
        const a = base + i * (SA + 1) + j;
        const b = a + SA + 1;
        sIdx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  }
  const sandGeo = new BufferGeometry();
  sandGeo.setAttribute('position', new Float32BufferAttribute(sPos, 3));
  sandGeo.setAttribute('aU', new Float32BufferAttribute(sU, 1));
  sandGeo.setAttribute('aAng', new Float32BufferAttribute(sAng, 1));
  sandGeo.setAttribute('aWhich', new Float32BufferAttribute(sWhich, 1));
  sandGeo.setIndex(sIdx);
  const sandUni = {
    uTime: U.uTime,
    uH: { value: H },
    uRb: { value: Rb },
    uRn: { value: rn },
    uTop: { value: H * 0.3 },
    uPush: { value: 2.3 * size * 1.7 },
    // The upper sand starts above the portrait at the waist, so the sand never hides it.
    uY0: { value: Math.min(H * 0.12, 2.3 * size * 0.7) },
    uBot: { value: -H * 0.9 },
    uSand: { value: col('#000000') },
    uSandLo: { value: col('#000000') },
    uSky: { value: col('#000000') },
    uGround: { value: col('#000000') },
  };
  const sand = new Mesh(
    sandGeo,
    new ShaderMaterial({ uniforms: sandUni, vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, side: DoubleSide }),
  );
  sand.frustumCulled = false;
  group.add(sand);
  const SN = big ? 260 : 420;
  const rnd = rng(11);
  const ph = new Float32Array(SN);
  const jit = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) {
    ph[i] = rnd();
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    jit.set([Math.cos(a) * r, Math.sin(a) * r, rnd()], i * 3);
  }
  const stGeo = new BufferGeometry();
  stGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(SN * 3), 3));
  stGeo.setAttribute('aPh', new Float32BufferAttribute(ph, 1));
  stGeo.setAttribute('aJ', new Float32BufferAttribute(jit, 3));
  const streamUni = {
    uTime: U.uTime,
    uPeak: { value: -H * 0.6 },
    uPx: { value: 260 },
    uStart: { value: sandUni.uY0.value },
    uSand: { value: col('#000000') },
  };
  const stream = new Points(
    stGeo,
    new ShaderMaterial({
      uniforms: streamUni,
      vertexShader: STREAM_VERT,
      fragmentShader: STREAM_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  stream.frustumCulled = false;
  stream.renderOrder = 2;
  group.add(stream);
  // Sand follows the timeline: the upper bulb drains from the first year of the family to today.
  const span = Math.max(1, NOW - M.minYear);
  const yearHook = (yr: number) => {
    const k = Math.min(1, Math.max(0, (yr - M.minYear) / span));
    sandUni.uTop.value = Math.max(H * (0.4 - 0.27 * k), sandUni.uY0.value + H * 0.06);
    const bot = -H * (0.985 - 0.08 * k);
    sandUni.uBot.value = bot;
    streamUni.uPeak.value = bot + rWall(bot) * 0.955 * 0.26;
  };
  yearHook(ctx.effYear());

  // ---------- floor and sky ----------
  const floorUni = {
    uStage: { value: col('#000000') },
    uPool: { value: col('#000000') },
    uRing: { value: col('#000000') },
    uRp: { value: Rp },
    uR0: { value: r0 },
    uGap: { value: ringGap },
    uRings: { value: rings },
    uShadow: { value: 0 },
  };
  const floorGeo = new CircleGeometry(Math.max(1400, Rp * 30), 96);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new Mesh(
    floorGeo,
    new ShaderMaterial({ uniforms: floorUni, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG }),
  );
  floor.position.y = floorY - footH * 0.05;
  floor.frustumCulled = false;
  group.add(floor);
  const domeUni = { uStage: { value: col('#000000') } };
  const dome = new Mesh(
    new SphereGeometry(Math.max(1500, Rp * 32), 24, 12),
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
    const light = ctx.dark() ? 0 : 1;
    for (const g of [gBackUni, gFrontUni]) {
      g.uGlass.value.set(L.glass);
      g.uBody.value = L.glassBody;
      g.uEdge.value = L.glassEdge;
      g.uEnv.value = L.env;
    }
    brassUni.uBrass.value.set(L.brass);
    brassUni.uBrassLo.value.set(L.brassLo);
    brassUni.uSky.value.set(L.sky);
    brassUni.uGround.value.set(L.ground);
    brassUni.uEnv.value = L.env;
    sandUni.uSand.value.set(L.sand);
    sandUni.uSandLo.value.set(L.sandLo);
    sandUni.uSky.value.set(L.sky);
    sandUni.uGround.value.set(L.ground);
    streamUni.uSand.value.set(L.sand);
    threadUni.uThread.value.set(L.thread);
    threadUni.uGold.value.set(L.gold);
    threadUni.uTeal.value.set(L.teal);
    threadUni.uLight.value = light;
    floorUni.uStage.value.set(L.stage);
    floorUni.uPool.value.set(L.pool);
    floorUni.uRing.value.set(L.ring);
    floorUni.uShadow.value = L.shadow;
    domeUni.uStage.value.set(L.stage);
  };
  paint();
  const tint = () => {
    paint();
    ctx.look((ctx.dark() ? LOOK.dark : LOOK.light).bloom, 1);
  };

  const ty = -H * 0.12;
  const D = H * 3.7 + 14;
  const el = (15 * Math.PI) / 180;
  const az = (16 * Math.PI) / 180;
  return {
    key: 'hour',
    group,
    pos,
    size,
    style: 0,
    lift: 6,
    tint,
    centre: f.id,
    hiTargets: [{ geo: tg }],
    focus: [threadUni.uFocus],
    yearHook,
    view: {
      target: new Vector3(0, ty, 0),
      cam: new Vector3(D * Math.cos(el) * Math.sin(az) * mir, ty + D * Math.sin(el), D * Math.cos(el) * Math.cos(az)),
    },
    follow: 30,
  };
};
