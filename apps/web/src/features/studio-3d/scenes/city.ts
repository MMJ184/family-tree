import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CustomBlending,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  MinEquation,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type StudioBusiness, type StudioModel, type StudioPerson, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import type { SceneBuilder } from './types.ts';

// Heritage City: the family as an old Gulf quarter (fereej) seen from above. The founder's fort
// stands at the centre and every generation is a ring of courtyard houses around it, each branch in
// its own sector. A person born into the family has a coral-stone house with crenellated parapets;
// those with children raise a barjeel (wind tower) whose height grows with their line, as the number
// and height of wind towers once showed a house's standing. Spouses who married in live in an annex
// beside their partner, joined by a gold threshold. The lineage is the network of sikkas (lanes):
// from each parent's house a lane runs out to the next ring and along it to each child's door.
//
// Dark: an illuminated night model, dark stone, warm windows and lane lanterns on black. Light: a
// white card maquette on a white base, soft shadows. Close up: crenellations (sharafat), louvred
// tower heads with protruding poles, arched windows and doors, palms that sway (the ambient motion),
// lanterns that flicker at night.

const LOOK = {
  dark: {
    stage: '#000000',
    lift: '#111111',
    base: '#0e0d0c',
    baseSide: '#171615',
    ring: '#1a1816',
    wall: '#45403a',
    cap: '#56504a',
    recess: '#141210',
    door: '#3a2a1c',
    pole: '#5a4532',
    win: '#ffb45a',
    slot: '#a8652a',
    lane: '#3b352e',
    lantern: '#ffc477',
    up: '#ff9d42',
    upA: 0.09,
    key: '#575b66',
    sky: '#25272c',
    gnd: '#0d0c0b',
    night: 1,
    frond: '#2f3a26',
    trunk: '#3a2f25',
    shadow: '#000000',
    shadowA: 0.5,
    gold: '#e2b65a',
    teal: '#4fd1bd',
    dimTo: '#080808',
    sign: { ink: '#ffd9a3', bg: 'rgba(22,19,16,0.94)', rule: '#6b573f' },
    bloom: 0.6,
    exposure: 1,
  },
  light: {
    stage: '#ebebeb',
    lift: '#ffffff',
    base: '#f7f7f6',
    baseSide: '#e2e2e1',
    ring: '#e4e4e3',
    wall: '#fbfbfa',
    cap: '#ffffff',
    recess: '#a9a9a7',
    door: '#8f8a83',
    pole: '#b8ac98',
    win: '#ffb45a',
    slot: '#9a9a98',
    lane: '#dededb',
    lantern: '#ffc477',
    up: '#ffffff',
    upA: 0,
    key: '#a3a3a3',
    sky: '#9a9a9a',
    gnd: '#5e5e5e',
    night: 0,
    frond: '#7f9466',
    trunk: '#c9bda8',
    shadow: '#2a2a2a',
    shadowA: 0.2,
    gold: '#b7862c',
    teal: '#0f6b63',
    dimTo: '#f2f2f2',
    sign: { ink: '#1a1a1a', bg: 'rgba(255,255,255,0.97)', rule: '#bdbdbd' },
    bloom: 0,
    exposure: 1,
  },
};
type Look = typeof LOOK.dark;

// Every surface lands on an exact colour: the shaded colour goes through the inverse of the
// renderer's ACES tone curve, so a white card reads white and the stage is exactly the theme's.
const ACES_IN_INV = new Matrix3()
  .fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777])
  .invert();
const ACES_OUT_INV = new Matrix3()
  .fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602])
  .invert();
const UNTONE = /* glsl */ `uniform float uExpo; uniform mat3 uInInv, uOutInv;
  vec3 untone(vec3 c) { vec3 y = max(uOutInv * clamp(c, 0., .985), 0.);
    vec3 A = y * .983729 - 1., B = y * .432951 - .0245786, C = y * .238081 + .000090537;
    vec3 v = (-B - sqrt(max(B * B - 4. * A * C, 0.))) / (2. * A);
    return max(uInInv * v, 0.) / (uExpo / .6); }
  /* Bright emitters (windows, lanterns) pass above white so the bloom catches them. */
  vec3 emit(vec3 c, float k) { return c * k * 3.; }`;
const YEAR = /* glsl */ `float yr = mix(uMinYear - 3., uYear, uEnter);`;
const LIGHT = /* glsl */ `uniform vec3 uKey, uSky, uGnd; const vec3 SUN = vec3(-0.52, 0.78, 0.35);
  vec3 safeN(vec3 v) { float l = length(v); return l > 1e-6 ? v / l : vec3(0., 1., 0.); }
  vec3 shade(vec3 albedo, vec3 n, float ao) { float k = max(dot(n, normalize(SUN)), 0.);
    return albedo * (mix(uGnd, uSky, n.y * .5 + .5) + uKey * k * 1.25) * ao; }`;
const HASH = /* glsl */ `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

/** Marks every vertex of a geometry with a part id (for the shaders) and drops the index for merging. */
function part(g: BufferGeometry, id: number): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.setAttribute(
    'aPart',
    new Float32BufferAttribute(new Float32Array(out.getAttribute('position').count).fill(id), 1),
  );
  out.deleteAttribute('uv');
  return out;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, id: number) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return part(g, id);
};
const merge = (list: BufferGeometry[]) => {
  const g = mergeGeometries(list) ?? new BufferGeometry();
  for (const l of list) l.dispose();
  return g;
};

/** Sharafat: small stepped merlons along a parapet line from (x0, z0) to (x1, z1). */
function merlons(
  out: BufferGeometry[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  s: number,
  id: number,
) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / (s * 2.4)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    out.push(box(along ? s : s * 0.55, s * 0.62, along ? s * 0.55 : s, x, y, z, id));
    const tip = new ConeGeometry(s * 0.5, s * 0.55, 4, 1);
    tip.rotateY(Math.PI / 4);
    tip.scale(along ? 1 : 0.55, 1, along ? 0.55 : 1);
    tip.translate(x, y + s * 0.62 + s * 0.27, z);
    out.push(part(tip, id));
  }
}

interface Dim {
  W: number;
  D: number;
  H: number;
}

/**
 * A courtyard house block, door on +z: walls, parapet, a door frame and a roof stair room, with
 * merlons along the parapet when `fine` (large families skip them: they would be sub-pixel).
 */
function houseGeo(d: Dim, fine: boolean): BufferGeometry {
  const { W, D, H } = d;
  const t = W * 0.035;
  const ph = H * 0.12;
  const out: BufferGeometry[] = [box(W, H, D, 0, 0, 0, 0)];
  out.push(box(W, ph, t, 0, H, D / 2 - t / 2, 1), box(W, ph, t, 0, H, -D / 2 + t / 2, 1));
  out.push(box(t, ph, D - 2 * t, W / 2 - t / 2, H, 0, 1), box(t, ph, D - 2 * t, -W / 2 + t / 2, H, 0, 1));
  const s = W * 0.06;
  if (fine) {
    merlons(out, -W / 2 + s, D / 2 - t / 2, W / 2 - s, D / 2 - t / 2, H + ph, s, 1);
    merlons(out, -W / 2 + s, -D / 2 + t / 2, W / 2 - s, -D / 2 + t / 2, H + ph, s, 1);
    merlons(out, W / 2 - t / 2, -D / 2 + s * 2, W / 2 - t / 2, D / 2 - s * 2, H + ph, s, 1);
    merlons(out, -W / 2 + t / 2, -D / 2 + s * 2, -W / 2 + t / 2, D / 2 - s * 2, H + ph, s, 1);
  }
  // Door surround (a shallow gypsum frame) and a small stair room on the roof.
  out.push(box(W * 0.3, H * 0.66, t * 1.2, 0, 0, D / 2 + t * 0.3, 2));
  out.push(box(W * 0.3, H * 0.34, D * 0.3, -W * 0.27, H, -D * 0.27, 3));
  return merge(out);
}

/** A barjeel, built for a shaft of height 1 (the shader stretches part 0 and lifts the rest). */
function towerGeo(w: number, fine: boolean): BufferGeometry {
  const hw = w * 1.16;
  const hh = w * 1.5;
  const out: BufferGeometry[] = [box(w, 1, w, 0, 0, 0, 0)];
  out.push(box(hw, hh, hw, 0, 1, 0, 1));
  out.push(box(hw * 1.12, w * 0.12, hw * 1.12, 0, 1 + hh, 0, 2));
  const s = w * 0.17;
  const e = (hw * 1.12) / 2 - s * 0.3;
  if (fine) {
    merlons(out, -e, e, e, e, 1 + hh + w * 0.12, s, 2);
    merlons(out, -e, -e, e, -e, 1 + hh + w * 0.12, s, 2);
    merlons(out, e, -e + s, e, e - s, 1 + hh + w * 0.12, s, 2);
    merlons(out, -e, -e + s, -e, e - s, 1 + hh + w * 0.12, s, 2);
  }
  // Danjal: wooden poles through the tower, sticking out on every side.
  const pl = hw * 1.5;
  const pr = w * 0.05;
  for (const y of [1 - w * 0.05, 1 + hh * 0.52]) {
    for (const o of [-hw * 0.28, hw * 0.28]) {
      out.push(box(pl, pr, pr, 0, y, o, 3), box(pr, pr, pl, o, y, 0, 3));
    }
  }
  return merge(out);
}

/** The founder's fort: a walled square with three square corner towers and one round one. */
function fortGeo(half: number, h: number): BufferGeometry {
  const t = half * 0.08;
  const out: BufferGeometry[] = [];
  const gate = half * 0.34;
  out.push(box(half * 2, h, t, 0, 0, -half, 0));
  out.push(box(t, h, half * 2, -half, 0, 0, 0), box(t, h, half * 2, half, 0, 0, 0));
  // Front wall with a gate.
  out.push(
    box(half - gate, h, t, -(half + gate) / 2, 0, half, 0),
    box(half - gate, h, t, (half + gate) / 2, 0, half, 0),
  );
  out.push(box(gate * 2.4, h * 0.42, t * 1.6, 0, h, half, 0));
  const s = half * 0.075;
  merlons(out, -half, -half, half, -half, h, s, 1);
  merlons(out, -half, -half + s, -half, half - s, h, s, 1);
  merlons(out, half, -half + s, half, half - s, h, s, 1);
  const tw = half * 0.36;
  const th = h * 1.7;
  for (const [x, z] of [
    [-half, -half],
    [half, -half],
    [-half, half],
  ] as const) {
    out.push(box(tw, th, tw, x, 0, z, 0));
    merlons(out, x - tw / 2, z + tw / 2, x + tw / 2, z + tw / 2, th, s, 1);
    merlons(out, x - tw / 2, z - tw / 2, x + tw / 2, z - tw / 2, th, s, 1);
  }
  const round = new CylinderGeometry(tw * 0.66, tw * 0.74, th * 1.15, 20, 1);
  round.translate(half, (th * 1.15) / 2, half);
  out.push(part(round, 0));
  const cap = new CylinderGeometry(tw * 0.72, tw * 0.72, h * 0.12, 20, 1);
  cap.translate(half, th * 1.15 + h * 0.06, half);
  out.push(part(cap, 1));
  return merge(out);
}

/** A date palm: a slender trunk and a crown of drooping fronds (part 1, swayed in the shader). */
function palmGeo(h: number): BufferGeometry {
  const trunk = new CylinderGeometry(h * 0.03, h * 0.05, h, 6, 3, true);
  trunk.translate(0, h / 2, 0);
  const out: BufferGeometry[] = [part(trunk, 0)];
  const pos: number[] = [];
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const L = h * 0.42;
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push([ca * L * t, h + L * (0.25 * t - 0.55 * t * t), sa * L * t]);
    }
    for (let k = 0; k < 4; k++) {
      const p0 = pts[k] as [number, number, number];
      const p1 = pts[k + 1] as [number, number, number];
      const w0 = h * 0.06 * Math.sin(((k + 0.2) / 4) * Math.PI);
      const w1 = h * 0.06 * Math.sin(((k + 1.2) / 4) * Math.PI);
      const sx = -sa;
      const sz = ca;
      const q = [
        [p0[0] - sx * w0, p0[1], p0[2] - sz * w0],
        [p0[0] + sx * w0, p0[1], p0[2] + sz * w0],
        [p1[0] + sx * w1, p1[1], p1[2] + sz * w1],
        [p1[0] - sx * w1, p1[1], p1[2] - sz * w1],
      ];
      for (const j of [0, 1, 2, 0, 2, 3]) pos.push(...(q[j] as number[]));
    }
  }
  const crown = new BufferGeometry();
  crown.setAttribute('position', new Float32BufferAttribute(pos, 3));
  crown.computeVertexNormals();
  out.push(part(crown, 1));
  return merge(out);
}

export interface CityPlan {
  /** Ring radius per generation (0 for the founder). */
  ring: (g: number) => number;
  ang: Map<string, number>;
  /** Spouses beside each person, in wedding order. */
  wed: Map<string, StudioPerson[]>;
  rMax: number;
}

/**
 * Radial plan: every generation on its own ring, each branch in an angular sector sized so the
 * houses (with their spouses' annexes) on every ring fit side by side. Ring spacing grows only when
 * the outer rings need more room.
 */
export function cityPlan(M: StudioModel, HW: number, AW: number, GAP: number, RSmin: number, R0: number): CityPlan {
  const wed = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    wed.set(p.anchor, [...(wed.get(p.anchor) ?? []), p]);
  }
  for (const [id, list] of wed) {
    const order = M.get(id).spouses.map((s) => s.id);
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  // Annexes alternate sides starting on one side, so that side holds ceil(n/2) of them: reserve it on both.
  const need = (p: StudioPerson) =>
    p === M.root ? 0 : HW + 2 * Math.ceil((wed.get(p.id)?.length ?? 0) / 2) * (AW + GAP * 0.4) + GAP;
  const radius = (g: number, RS: number) => (g === 0 ? 0 : R0 + g * RS);
  const span = new Map<string, number>();
  const total = (RS: number) => {
    const rec = (p: StudioPerson): number => {
      let s = 0;
      for (const k of p.kids) s += rec(M.get(k));
      const a = Math.max(p === M.root ? 0 : need(p) / radius(p.gen, RS), s);
      span.set(p.id, a);
      return a;
    };
    return rec(M.root);
  };
  const FULL = Math.PI * 2 * 0.97;
  let RS = RSmin;
  if (total(RS) > FULL) {
    let lo = RSmin;
    let hi = 4000;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (total(m) > FULL) lo = m;
      else hi = m;
    }
    RS = hi;
  }
  const sum = total(RS);
  const ang = new Map<string, number>();
  const assign = (p: StudioPerson, a0: number, a1: number) => {
    ang.set(p.id, (a0 + a1) / 2);
    const kids = p.kids.map((k) => M.get(k));
    const tot = kids.reduce((s, k) => s + (span.get(k.id) ?? 0), 0) || 1;
    let a = a0;
    for (const k of kids) {
      const w = ((a1 - a0) * (span.get(k.id) ?? 0)) / tot;
      assign(k, a, a + w);
      a += w;
    }
  };
  // The founder's first branch starts at the back; the circle is shared out by need.
  const start = -Math.PI / 2 - Math.PI * (sum / FULL);
  assign(M.root, start, start + Math.PI * 2);
  return { ring: (g) => radius(g, RS), ang, wed, rMax: radius(M.maxGen, RS) };
}

/** A shop sign: the business name in the app's font on a framed board (drawn per theme and language). */
function signTexture(text: string, t: Look['sign'], rtl: boolean) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 44px Manrope, "IBM Plex Sans Arabic", sans-serif';
  if (!g) return { tex: new CanvasTexture(c), aspect: 1 };
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + 56);
  c.height = 84;
  g.fillStyle = t.bg;
  g.strokeStyle = t.rule;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(3, 3, c.width - 6, c.height - 6, 14);
  g.fill();
  g.stroke();
  g.font = font;
  g.fillStyle = t.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.direction = rtl ? 'rtl' : 'ltr';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

interface Sign {
  mesh: Mesh;
  uni: { uMap: { value: Texture }; uSize: { value: Vector2 } };
}

/** Redraws a sign (new language or theme), freeing the old texture. */
function drawSign(s: Sign, text: string, t: Look['sign'], h: number, rtl: boolean) {
  const { tex, aspect } = signTexture(text, t, rtl);
  s.uni.uMap.value.dispose();
  s.uni.uMap.value = tex;
  s.uni.uSize.value.set(h * aspect, h);
}

export const cityScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const look = (): Look => (ctx.dark() ? LOOK.dark : LOOK.light);
  const L0 = look();
  const dir = ctx.rtl() ? -1 : 1;
  const group = new Group();
  const n = M.n;
  const pos = new Float32Array(n * 3);
  const appear = new Float32Array(n);
  const rnd = rng(31);

  const dim: Dim = big ? { W: 2.5, D: 2.5, H: 1.8 } : { W: 4.2, D: 4.2, H: 2.9 };
  const AW = dim.W * 0.72; // annex frontage
  const GAP = big ? 0.85 : 1.35;
  const LW = big ? 0.95 : 1.7; // lane width
  // The founder's fort: two annexes stand beside the keep, any more in rows of two in front of it
  // (towards the gate); the fort grows to hold them and the first ring moves out with it.
  const rootWives = M.people.filter((p) => p.mi && p.anchor === M.root.id).length;
  const frontRows = Math.max(0, Math.ceil((rootWives - 2) / 2));
  const fortHalf = Math.max(
    (big ? 7 : 9.5) * 0.78,
    (0.61 * dim.D + 0.6 * GAP + frontRows * (0.72 * dim.D + 0.6 * GAP) + 0.3) / 1.1,
  );
  const R0 = fortHalf / 0.78;
  const plan = cityPlan(M, dim.W, AW, GAP, dim.D + (big ? 3.4 : 4.6), R0);
  const { ring, ang, wed, rMax } = plan;
  const size = big ? 0.95 : 1.55;
  const lift = big ? 1.5 : 2.2;

  // ---- Buildings: one instance per person (houses for those born in, annexes for spouses) ----
  interface Lot {
    x: number;
    z: number;
    rot: number;
    scale: number;
    storey: number;
    r: number;
    a: number;
  }
  const lot = new Map<string, Lot>();
  const P = (r: number, a: number) => ({ x: dir * r * Math.cos(a), z: r * Math.sin(a) });
  const facing = (x: number, z: number) => Math.atan2(-x, -z); // local +z (the door) towards the centre
  const keepZ = -fortHalf * 0.18;
  for (const p of M.people) {
    if (p.mi) continue;
    const a = ang.get(p.id) ?? 0;
    const r = ring(p.gen);
    const storey = p.leaves >= (big ? 8 : 4) || p === M.root ? 1.42 : 1;
    if (p === M.root) {
      lot.set(p.id, { x: 0, z: keepZ, rot: 0, scale: 1.22, storey, r: 0, a: Math.PI / 2 });
    } else {
      const { x, z } = P(r, a);
      lot.set(p.id, { x, z, rot: facing(x, z), scale: 1, storey, r, a });
    }
    // Annexes beside the house along the ring, alternating sides, outward from the house.
    (wed.get(p.id) ?? []).forEach((s, k) => {
      const side = k % 2 ? -1 : 1;
      const off = dim.W * (p === M.root ? 1.22 : 1) * 0.5 + GAP * 0.4 + AW * 0.5 + Math.floor(k / 2) * (AW + GAP * 0.4);
      if (p === M.root) {
        const front = k >= 2;
        const row = Math.floor((k - 2) / 2);
        const x = side * dir * (front ? AW * 0.5 + GAP * 0.3 : off);
        const z = front
          ? keepZ + 0.61 * dim.D + 0.6 * GAP + 0.36 * dim.D + row * (0.72 * dim.D + 0.6 * GAP)
          : keepZ + dim.D * 0.12;
        lot.set(s.id, { x, z, rot: 0, scale: 0.72, storey: 1, r: 0, a: Math.PI / 2 });
        return;
      }
      const aa = a + (side * off) / r;
      const q = P(r, aa);
      lot.set(s.id, { x: q.x, z: q.z, rot: facing(q.x, q.z), scale: 0.72, storey: 1, r, a: aa });
    });
  }
  const lotOf = (id: string | null): Lot =>
    (id ? lot.get(id) : undefined) ?? { x: 0, z: 0, rot: 0, scale: 1, storey: 1, r: 0, a: 0 };

  const houseG = houseGeo(dim, !big);
  const hBorn = new Float32Array(n);
  const hDeath = new Float32Array(n);
  const hSeed = new Float32Array(n);
  const hStorey = new Float32Array(n);
  houseG.setAttribute('aBorn', new InstancedBufferAttribute(hBorn, 1));
  houseG.setAttribute('aDeath', new InstancedBufferAttribute(hDeath, 1));
  houseG.setAttribute('aSeed', new InstancedBufferAttribute(hSeed, 1));
  houseG.setAttribute('aStorey', new InstancedBufferAttribute(hStorey, 1));
  houseG.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(n), 1));
  houseG.userData.keys = M.people.map((p) => p.id);

  const focus = { value: 0 };
  const common = {
    ...U,
    uFocus: focus,
    uExpo: { value: L0.exposure },
    uInInv: { value: ACES_IN_INV },
    uOutInv: { value: ACES_OUT_INV },
    uKey: { value: lin(L0.key) },
    uSky: { value: lin(L0.sky) },
    uGnd: { value: lin(L0.gnd) },
    uTeal: { value: lin(L0.teal) },
    uGold: { value: lin(L0.gold) },
    uDimTo: { value: lin(L0.dimTo) },
    uNight: { value: L0.night },
  };
  const wallUni = {
    ...common,
    uWall: { value: lin(L0.wall) },
    uCap: { value: lin(L0.cap) },
    uRecess: { value: lin(L0.recess) },
    uDoor: { value: lin(L0.door) },
    uPole: { value: lin(L0.pole) },
    uWin: { value: lin(L0.win) },
    uSlot: { value: lin(L0.slot) },
    uUp: { value: lin(L0.up) },
    uUpA: { value: L0.upA },
    uDim: { value: new Vector3(dim.W, dim.D, dim.H) },
  };
  const DIMMED = /* glsl */ `vec3 dimmed(vec3 c, float hi) { return mix(c, uDimTo, uFocus * (1. - step(.5, hi)) * .72); }`;
  const houseMat = new ShaderMaterial({
    uniforms: wallUni,
    vertexShader: /* glsl */ `attribute float aPart, aBorn, aDeath, aSeed, aStorey, aHi; uniform float uYear, uEnter, uMinYear; uniform vec3 uDim;
      varying vec3 vLP, vLN, vN, vW; varying float vPart, vDead, vSeed, vHi, vStorey, vDepth;
      void main() { ${YEAR} float grow = smoothstep(aBorn - .4, aBorn + 1.6, yr);
        vec3 p = position;
        if (aPart < .5) p.y *= aStorey; else if (aPart > .5 && aPart < 1.5 || aPart > 2.5) p.y += uDim.z * (aStorey - 1.);
        p.y *= max(grow, .001);
        vLP = p; vLN = normal; vPart = aPart; vSeed = aSeed; vHi = aHi; vStorey = aStorey; vDead = step(aDeath, yr);
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz; vN = (mat3(modelMatrix * instanceMatrix) * normal) / max(length(mat3(modelMatrix * instanceMatrix) * normal), 1e-6);
        vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${UNTONE} ${LIGHT} ${HASH}
      uniform vec3 uWall, uCap, uRecess, uDoor, uWin, uUp, uDim, uTeal, uDimTo; uniform float uUpA, uNight, uFocus, uTime;
      varying vec3 vLP, vLN, vN, vW; varying float vPart, vDead, vSeed, vHi, vStorey, vDepth;
      ${DIMMED}
      void main() { vec3 n = safeN(vN); float ao = mix(.6, 1., smoothstep(0., uDim.z * .55, vW.y));
        vec3 base = vPart > .5 && vPart < 1.5 ? uCap : uWall;
        vec3 col = shade(base, n, ao);
        float glow = 0.;
        if (vPart < .5 && abs(vLN.y) < .5) {
          // Arched windows in the block's own face coordinates, one row per storey.
          bool alongX = abs(vLN.z) > .5; float fw = alongX ? uDim.x : uDim.y;
          float u = (alongX ? vLP.x : vLP.z) / fw + .5;
          float rows = vStorey > 1.2 ? 2. : 1.; float hh = uDim.z * vStorey / rows;
          float fy = fract(vLP.y / hh); float row = floor(vLP.y / hh);
          float cu = fract(u * 3.); float ci = floor(u * 3.);
          float ax = abs(cu - .5) / .14; float ay = (fy - .42) / .32;
          float win = step(ax, 1.) * step(0., ay) * step(ay, 1.);
          float k = max(ay - .68, 0.) / .32; win *= ay > .68 ? step(ax * ax + k * k, 1.) : 1.;
          // The front's middle bay on the ground floor is the door (drawn on its frame).
          if (vLN.z > .5 && row < .5 && ci > .5 && ci < 1.5) win = 0.;
          float on = step(.36, hash(vec2(ci + row * 5.3 + (alongX ? 0. : 11.) + sign(vLN.x + vLN.z) * 23., vSeed))) * (1. - vDead);
          float flick = .9 + .1 * sin(uTime * 2.3 + vSeed * 7. + ci * 3.);
          col = mix(col, uRecess, win);
          glow = win * on * uNight * flick;
          // Warm light washing up the wall from the lane (night only).
          col += uUp * uUpA * (1. - smoothstep(0., hh * .9, vLP.y)) * (.6 + .4 * max(dot(n, vec3(0., 0., 1.)), 0.));
        }
        if (vPart > 1.5 && vPart < 2.5 && vLN.z > .5) {
          // The door: dark wood under a pointed arch, inside its gypsum frame.
          float dx = abs(vLP.x) / (uDim.x * .1); float dy = vLP.y / (uDim.z * .54);
          float door = step(dx, 1.) * step(dy, 1.) * (dy > .78 ? step(dx, 1. - (dy - .78) / .22) : 1.);
          col = mix(col, uDoor, door);
        }
        // The lineage: a teal line along the parapet.
        float lit = step(.5, vHi) * uFocus;
        if (vPart > .5 && vPart < 1.5) col = mix(col, uTeal * 1.15, lit * .85);
        col = dimmed(col, vHi);
        vec3 outc = untone(col) + emit(uWin, glow * (1. - uFocus * (1. - step(.5, vHi)) * .8));
        gl_FragColor = vec4(outc, 1.); }`,
  });
  const houses = new InstancedMesh(houseG, houseMat, n);
  const mtx = new Matrix4();
  const sv = new Vector3();
  M.people.forEach((p, i) => {
    const l = lotOf(p.id);
    mtx
      .makeRotationY(l.rot)
      .scale(sv.set(l.scale, l.scale, l.scale))
      .setPosition(l.x, 0, l.z);
    houses.setMatrixAt(i, mtx);
    hBorn[i] = p.mi ? spouseYear(M, p) : p.born;
    hDeath[i] = p.died ?? 9999;
    hSeed[i] = rnd() * 10;
    hStorey[i] = l.storey;
    appear[i] = hBorn[i] ?? p.born;
  });
  houses.frustumCulled = false;
  group.add(houses);

  // ---- Wind towers for everyone with children: taller for a larger line ----
  const towerW = dim.W * 0.3;
  const builders = M.people.filter((p) => !p.mi && p.kids.length);
  const nt = Math.max(1, builders.length);
  const towerG = towerGeo(towerW, !big);
  const tShaft = new Float32Array(nt);
  const tBorn = new Float32Array(nt);
  towerG.setAttribute('aShaft', new InstancedBufferAttribute(tShaft, 1));
  towerG.setAttribute('aBorn', new InstancedBufferAttribute(tBorn, 1));
  towerG.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(nt), 1));
  towerG.userData.keys = builders.map((p) => p.id);
  const towerMat = new ShaderMaterial({
    uniforms: wallUni,
    vertexShader: /* glsl */ `attribute float aPart, aShaft, aBorn, aHi; uniform float uYear, uEnter, uMinYear;
      varying vec3 vLP, vLN, vN, vW; varying float vPart, vHi;
      void main() { ${YEAR} float grow = smoothstep(aBorn + .5, aBorn + 3.5, yr);
        vec3 p = position; float g = max(grow, .001);
        if (aPart < .5) p.y *= aShaft * g; else p.y = (p.y - 1. + aShaft) * g;
        vLP = position; vLN = normal; vPart = aPart; vHi = aHi;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz; vN = (mat3(modelMatrix * instanceMatrix) * normal) / max(length(mat3(modelMatrix * instanceMatrix) * normal), 1e-6);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${UNTONE} ${LIGHT}
      uniform vec3 uWall, uCap, uRecess, uPole, uSlot, uTeal, uDimTo, uDim; uniform float uNight, uFocus, uTime;
      varying vec3 vLP, vLN, vN, vW; varying float vPart, vHi;
      ${DIMMED}
      void main() { vec3 n = safeN(vN);
        vec3 col = shade(vPart > 2.5 ? uPole : vPart > 1.5 ? uCap : uWall, n, 1.);
        float glow = 0.;
        if (vPart > .5 && vPart < 1.5 && abs(vLN.y) < .5) {
          // The louvred head: three tall openings on every face, divided by slim piers.
          float u = (abs(vLN.z) > .5 ? vLP.x : vLP.z) / (uDim.x * .3 * 1.16) + .5;
          float cu = fract(u * 3.); float v = (vLP.y - 1.) / (uDim.x * .3 * 1.5);
          float slot = step(.2, cu) * step(cu, .8) * step(.1, v) * step(v, .86) * step(.06, u) * step(u, .94);
          col = mix(col, uRecess, slot);
          glow = slot * uNight * (.55 + .2 * sin(uTime * .7 + vW.x));
        }
        float lit = step(.5, vHi) * uFocus;
        if (vPart > 1.5 && vPart < 2.5) col = mix(col, uTeal * 1.15, lit * .85);
        col = dimmed(col, vHi);
        gl_FragColor = vec4(untone(col) + emit(uSlot, glow * (1. - uFocus * (1. - step(.5, vHi)) * .8)) * .5, 1.); }`,
  });
  const towers = new InstancedMesh(towerG, towerMat, nt);
  towers.count = builders.length;
  const tTop = new Map<string, Vector3>();
  builders.forEach((p, i) => {
    const l = lotOf(p.id);
    const shaft = (big ? 1.3 : 2.2) + Math.sqrt(p.leaves) * (big ? 0.8 : 1.3);
    const back = -dim.D * 0.2 * l.scale;
    const bx = l.x + Math.sin(l.rot) * back;
    const bz = l.z + Math.cos(l.rot) * back;
    const baseY = dim.H * l.storey * l.scale;
    mtx
      .makeRotationY(l.rot)
      .scale(sv.set(l.scale, 1, l.scale))
      .setPosition(bx, baseY, bz);
    towers.setMatrixAt(i, mtx);
    tShaft[i] = shaft;
    tBorn[i] = p.born + (big ? 14 : 18);
    tTop.set(p.id, new Vector3(bx, baseY + shaft + towerW * (1.5 + 0.12 + 0.3), bz));
  });
  towers.frustumCulled = false;
  group.add(towers);

  // Portraits: above the tower for those with one, otherwise above the roof. A spouse whose partner
  // has a tower flies their portrait at the partner's height on a slim mast from the annex roof, so the
  // household's portraits share one height and no camera angle can line them up.
  const roofY = (l: Lot) => dim.H * l.storey * l.scale + dim.H * 0.2;
  const medalY = (id: string) => {
    const t = tTop.get(id);
    return t ? t.y + lift * 0.8 : roofY(lotOf(id)) + lift;
  };
  const masts: Array<{ id: string; x: number; z: number; y0: number; y1: number }> = [];
  M.people.forEach((p, i) => {
    const l = lotOf(p.id);
    const t = tTop.get(p.id);
    let y = medalY(p.id);
    if (p.mi && p.anchor && tTop.has(p.anchor)) {
      y = medalY(p.anchor);
      masts.push({ id: p.id, x: l.x, z: l.z, y0: roofY(l) - dim.H * 0.2, y1: y - size * 0.85 * 0.79 });
    }
    pos[i * 3] = t ? t.x : l.x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = t ? t.z : l.z;
  });
  const nm = Math.max(1, masts.length);
  const mastG = new CylinderGeometry(big ? 0.05 : 0.08, big ? 0.07 : 0.11, 1, 6, 1);
  mastG.translate(0, 0.5, 0);
  const mBorn = new Float32Array(nm);
  mastG.setAttribute('aBorn', new InstancedBufferAttribute(mBorn, 1));
  mastG.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(nm), 1));
  mastG.userData.keys = masts.map((m) => m.id);
  const mastMesh = new InstancedMesh(
    mastG,
    new ShaderMaterial({
      uniforms: wallUni,
      vertexShader: /* glsl */ `attribute float aBorn, aHi; uniform float uYear, uEnter, uMinYear; varying float vHi; varying vec3 vN;
        void main() { ${YEAR} float on = smoothstep(aBorn - .3, aBorn + .9, yr); vHi = aHi; vN = normal;
          vec3 p = position; p.y *= max(on, .001);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */ `${UNTONE} ${LIGHT} uniform vec3 uPole, uCap, uTeal, uDimTo; uniform float uNight, uFocus; varying float vHi; varying vec3 vN;
        void main() { vec3 c = shade(mix(uCap, uPole, uNight), safeN(vN), 1.);
          c = mix(c, uTeal, step(.5, vHi) * uFocus * .8);
          c = mix(c, uDimTo, uFocus * (1. - step(.5, vHi)) * .72);
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
    nm,
  );
  mastMesh.count = masts.length;
  masts.forEach((m, i) => {
    mtx.makeScale(1, Math.max(0.01, m.y1 - m.y0), 1).setPosition(m.x, m.y0, m.z);
    mastMesh.setMatrixAt(i, mtx);
    const sp = M.get(m.id);
    mBorn[i] = spouseYear(M, sp);
  });
  mastMesh.frustumCulled = false;
  group.add(mastMesh);

  // ---- The founder's fort ----
  const fortG = fortGeo(fortHalf, dim.H * 0.92);
  const fort = new Mesh(
    fortG,
    new ShaderMaterial({
      uniforms: wallUni,
      vertexShader: /* glsl */ `attribute float aPart; uniform float uYear, uEnter, uMinYear; varying vec3 vN, vW; varying float vPart;
        void main() { vPart = aPart; vN = (mat3(modelMatrix) * normal) / max(length(mat3(modelMatrix) * normal), 1e-6); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${LIGHT} uniform vec3 uWall, uCap, uUp, uDimTo; uniform float uUpA, uFocus;
        varying vec3 vN, vW; varying float vPart;
        void main() { vec3 n = safeN(vN); vec3 col = shade(vPart > .5 ? uCap : uWall, n, mix(.6, 1., smoothstep(0., 2., vW.y)));
          col += uUp * uUpA * (1. - smoothstep(0., 3., vW.y));
          col = mix(col, uDimTo, uFocus * .45);
          gl_FragColor = vec4(untone(col), 1.); }`,
    }),
  );
  fort.scale.x = dir;
  group.add(fort);

  // ---- Lanes: from each parent's house out to the next ring, along it, and in to each child's door ----
  const LP: number[] = [];
  const LK: string[] = [];
  const LT: number[] = [];
  const LS: number[] = [];
  const LB: number[] = [];
  const lanternAt: number[] = [];
  const lanternSeed: number[] = [];
  const lanternBorn: number[] = [];
  const ribbon = (pts: Array<[number, number]>, key: string, born: number) => {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as [number, number];
      const b = pts[i + 1] as [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const sx = (-dz / len) * (LW / 2);
      const sz = (dx / len) * (LW / 2);
      const q = [
        [a[0] - sx, a[1] - sz],
        [a[0] + sx, a[1] + sz],
        [b[0] + sx, b[1] + sz],
        [b[0] - sx, b[1] - sz],
      ];
      for (const j of [0, 1, 2, 0, 2, 3]) {
        const v = q[j] as number[];
        LP.push(v[0] ?? 0, 0.13, v[1] ?? 0);
        LS.push(j === 1 || j === 2 ? 1 : -1);
        LK.push(key);
        LT.push(acc + (j === 2 || j === 3 ? len : 0));
        LB.push(born);
      }
      // Lanterns every few metres, alternating sides.
      const step = big ? 7 : 6.5;
      for (let d = step - (acc % step); d < len; d += step) {
        const t = d / len;
        const side = Math.floor((acc + d) / step) % 2 ? 1 : -1;
        lanternAt.push(a[0] + dx * t + sx * side * 1.7, dim.H * 0.32, a[1] + dz * t + sz * side * 1.7);
        lanternSeed.push(rnd());
        lanternBorn.push(born);
      }
      acc += len;
    }
  };
  const polar = (r: number, a: number): [number, number] => {
    const q = P(r, a);
    return [q.x, q.z];
  };
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const ac = ang.get(p.id) ?? 0;
    const rc = ring(p.gen) - dim.D * 0.5 - 0.2;
    const pts: Array<[number, number]> = [];
    if (par === M.root) {
      const edge = fortHalf / Math.max(Math.abs(Math.cos(ac)), Math.abs(Math.sin(ac)), 1e-3) + fortHalf * 0.22;
      pts.push(polar(Math.min(edge, rc - 0.5), ac), polar(rc, ac));
    } else {
      const ap = ang.get(par.id) ?? 0;
      const r0 = ring(par.gen) + dim.D * 0.5 * (lotOf(par.id).scale ?? 1) + 0.2;
      const rm = (ring(par.gen) + ring(p.gen)) / 2;
      pts.push(polar(r0, ap), polar(rm, ap));
      const steps = Math.max(1, Math.ceil((Math.abs(ac - ap) * rm) / 2.2));
      for (let s = 1; s <= steps; s++) pts.push(polar(rm, ap + ((ac - ap) * s) / steps));
      pts.push(polar(rc, ac));
    }
    ribbon(pts, p.id, p.born);
  }
  const laneG = new BufferGeometry();
  laneG.setAttribute('position', new Float32BufferAttribute(LP, 3));
  laneG.setAttribute('aT', new Float32BufferAttribute(LT, 1));
  laneG.setAttribute('aS', new Float32BufferAttribute(LS, 1));
  laneG.setAttribute('aBorn', new Float32BufferAttribute(LB, 1));
  laneG.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(LK.length), 1));
  laneG.userData.keys = LK;
  const laneUni = { ...common, uLane: { value: lin(L0.lane) }, uBase: { value: lin(L0.base) } };
  const lanes = new Mesh(
    laneG,
    new ShaderMaterial({
      uniforms: laneUni,
      vertexShader: /* glsl */ `attribute float aT, aS, aBorn, aHi; uniform float uFocus; varying float vT, vS, vBorn, vHi; varying vec3 vW;
        void main() { vT = aT; vS = aS; vBorn = aBorn; vHi = aHi; vec3 p = position; p.y += .02 * step(.5, aHi) * uFocus;
          vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uLane, uBase, uTeal, uDimTo; uniform float uFocus, uTime, uYear, uEnter, uMinYear;
        varying float vT, vS, vBorn, vHi; varying vec3 vW;
        void main() { ${YEAR} if (yr < vBorn - 1.) discard;
          float lit = step(.5, vHi) * uFocus;
          // Paving with joints, kerbs along both edges, and a slow light running out along the lineage.
          float joint = 1. - smoothstep(0., .04, abs(fract(vT * .8) - .5) - .45);
          float kerb = smoothstep(.62, .8, abs(vS));
          vec3 c = mix(uLane, uBase, joint * .25);
          c = mix(c, mix(uLane, vec3(0.), .28), kerb);
          float run = smoothstep(.8, 1., fract(vT * .05 - uTime * .25));
          c = mix(c, uTeal, lit * (.8 + .2 * run));
          c = mix(c, uDimTo, uFocus * (1. - lit) * .3);
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
  );
  group.add(lanes);

  // Lanterns (night): soft warm points that flicker; hidden in the daylight model.
  const lanternG = new BufferGeometry();
  lanternG.setAttribute('position', new Float32BufferAttribute(lanternAt, 3));
  lanternG.setAttribute('aSeed', new Float32BufferAttribute(lanternSeed, 1));
  lanternG.setAttribute('aBorn', new Float32BufferAttribute(lanternBorn, 1));
  const lanternUni = {
    ...common,
    uLantern: { value: lin(L0.lantern) },
    uPx: { value: big ? 14 : 22 },
    uPR: { value: 1 },
  };
  const lanterns = new Points(
    lanternG,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: lanternUni,
      vertexShader: /* glsl */ `attribute float aSeed, aBorn; uniform float uTime, uPx, uPR, uYear, uEnter, uMinYear; varying float vA;
        void main() { ${YEAR} vec4 mv = modelViewMatrix * vec4(position, 1.);
          vA = (.75 + .25 * sin(uTime * (2. + aSeed * 3.) + aSeed * 40.)) * step(aBorn, yr);
          gl_PointSize = uPx * uPR * 30. / max(-mv.z, 1.); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uLantern; uniform float uNight, uFocus; varying float vA;
        void main() { float r = length(gl_PointCoord - .5) * 2.; float a = exp(-r * r * 7.) * vA * uNight * (1. - .7 * uFocus);
          if (a < .01) discard; gl_FragColor = vec4(emit(uLantern, .8), a); }`,
    }),
  );
  lanterns.frustumCulled = false;
  // Point sizes are in device pixels: follow the renderer's (adaptive) pixel ratio.
  lanterns.onBeforeRender = (renderer) => {
    lanternUni.uPR.value = renderer.getPixelRatio();
  };
  group.add(lanterns);

  // ---- Gold thresholds: a strip at the front between each partner's house and each spouse's annex ----
  const spouses = M.people.filter((p) => p.mi && p.anchor && lot.has(p.anchor));
  const nb = Math.max(1, spouses.length);
  const thrG = new BoxGeometry(1, 1, 1);
  thrG.translate(0, 0.5, 0.5);
  const thrBorn = new Float32Array(nb);
  thrG.setAttribute('aBorn', new InstancedBufferAttribute(thrBorn, 1));
  thrG.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(nb), 1));
  thrG.userData.keys = spouses.map((p) => p.id);
  const thresholds = new InstancedMesh(
    thrG,
    new ShaderMaterial({
      uniforms: common,
      vertexShader: /* glsl */ `attribute float aBorn, aHi; uniform float uYear, uEnter, uMinYear; varying float vHi; varying vec3 vN;
        void main() { ${YEAR} float on = smoothstep(aBorn - .3, aBorn + .9, yr); vHi = aHi; vN = (mat3(instanceMatrix) * normal) / max(length(mat3(instanceMatrix) * normal), 1e-6);
          vec3 p = position; p.z *= on; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */ `${UNTONE} ${LIGHT} uniform vec3 uGold, uDimTo; uniform float uFocus; varying float vHi; varying vec3 vN;
        void main() { vec3 c = uGold * (.85 + .3 * max(vN.y, 0.)); c = mix(c, uDimTo, uFocus * (1. - step(.5, vHi)) * .7);
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
    nb,
  );
  thresholds.count = spouses.length;
  const fwd = new Vector3();
  spouses.forEach((s, i) => {
    const a = lotOf(s.anchor);
    const b = lotOf(s.id);
    // Along the front of the two buildings, from the partner's door to the spouse's.
    fwd.set(Math.sin(a.rot), 0, Math.cos(a.rot));
    const front = dim.D * 0.5 * a.scale + LW * 0.45;
    const ax = a.x + fwd.x * front;
    const az = a.z + fwd.z * front;
    const bx = b.x + fwd.x * (dim.D * 0.5 * b.scale + LW * 0.45);
    const bz = b.z + fwd.z * (dim.D * 0.5 * b.scale + LW * 0.45);
    const d = Math.hypot(bx - ax, bz - az);
    mtx
      .makeRotationY(Math.atan2(bx - ax, bz - az))
      .scale(sv.set(LW * 0.34, 0.09, d))
      .setPosition(ax, 0.14, az);
    thresholds.setMatrixAt(i, mtx);
    thrBorn[i] = spouseYear(M, s);
  });
  thresholds.frustumCulled = false;
  group.add(thresholds);

  // ---- Palms: around the fort and an oasis belt outside the last ring; the fronds sway ----
  const palmAt: Array<[number, number, number]> = [];
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    palmAt.push([x * fortHalf * 1.25, z * fortHalf * 1.25, 0.9 + rnd() * 0.3]);
  const belt = Math.max(rMax + dim.D * 0.9, fortHalf * 1.55) + (big ? 3 : 4.5);
  const count = Math.floor((Math.PI * 2 * belt) / (big ? 7 : 6));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.05;
    const r = belt + (rnd() - 0.5) * (big ? 3 : 2.5);
    palmAt.push([Math.cos(a) * r, Math.sin(a) * r, 0.75 + rnd() * 0.45]);
  }
  const palmG = palmGeo(big ? 4.2 : 5.4);
  const np = palmAt.length;
  const pSeed = new Float32Array(np);
  palmG.setAttribute('aSeed', new InstancedBufferAttribute(pSeed, 1));
  const palmUni = { ...common, uFrond: { value: lin(L0.frond) }, uTrunk: { value: lin(L0.trunk) } };
  const palms = new InstancedMesh(
    palmG,
    new ShaderMaterial({
      uniforms: palmUni,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute float aPart, aSeed; uniform float uTime; varying vec3 vN, vW; varying float vPart;
        void main() { vec3 p = position; vPart = aPart;
          if (aPart > .5) { float k = max(0., p.y - ${(big ? 4.2 : 5.4).toFixed(2)} * .9); p.x += sin(uTime * .9 + aSeed * 6.) * k * .12; p.z += cos(uTime * .7 + aSeed * 4.) * k * .08; }
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz; vN = (mat3(modelMatrix * instanceMatrix) * normal) / max(length(mat3(modelMatrix * instanceMatrix) * normal), 1e-6);
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${UNTONE} ${LIGHT} uniform vec3 uFrond, uTrunk, uDimTo; uniform float uFocus; varying vec3 vN, vW; varying float vPart;
        void main() { vec3 n = safeN(vN); if (!gl_FrontFacing) n = -n;
          vec3 c = shade(vPart > .5 ? uFrond : uTrunk, n, mix(.7, 1., smoothstep(0., 2., vW.y)));
          c = mix(c, uDimTo, uFocus * .45);
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
    np,
  );
  palmAt.forEach(([x, z, s], i) => {
    mtx
      .makeRotationY(rnd() * Math.PI * 2)
      .scale(sv.set(s, s, s))
      .setPosition(dir * x, 0, z);
    palms.setMatrixAt(i, mtx);
    pSeed[i] = rnd();
  });
  palms.frustumCulled = false;
  group.add(palms);

  // ---- Soft shadows: one blurred footprint per house, annex and tower, cast away from the sun ----
  const shadowList: Array<{ x: number; z: number; w: number; d: number; rot: number; h: number }> = [];
  for (const p of M.people) {
    const l = lotOf(p.id);
    const h = dim.H * l.storey * l.scale;
    shadowList.push({ x: l.x, z: l.z, w: dim.W * l.scale, d: dim.D * l.scale, rot: l.rot, h });
  }
  builders.forEach((p, i) => {
    const t = tTop.get(p.id);
    const l = lotOf(p.id);
    if (!t) return;
    shadowList.push({
      x: t.x,
      z: t.z,
      w: towerW * 1.2 * l.scale,
      d: towerW * 1.2 * l.scale,
      rot: l.rot,
      h: (tShaft[i] ?? 1) + dim.H,
    });
  });
  const ns = shadowList.length;
  const shG = new PlaneGeometry(1, 1);
  shG.rotateX(-Math.PI / 2);
  const shUni = {
    ...common,
    uShade: { value: lin(L0.shadow) },
    uShadeA: { value: L0.shadowA },
    uBase: { value: lin(L0.base) },
  };
  // Composited in display space against the base board and min-blended: alpha blending over the
  // untoned white board would wash a soft shadow out completely.
  const shadows = new InstancedMesh(
    shG,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: MinEquation,
      uniforms: shUni,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uShade, uBase; uniform float uShadeA; varying vec2 vUv;
        void main() { vec2 q = abs(vUv - .5) * 2.; float a = (1. - smoothstep(.35, 1., q.x)) * (1. - smoothstep(.35, 1., q.y)) * uShadeA;
          if (a < .003) discard;
          gl_FragColor = vec4(untone(mix(uBase, uShade, a)), 1.); }`,
    }),
    ns,
  );
  // Cast away from the shaders' fixed sun (SUN in LIGHT), also when the plan is mirrored for Arabic.
  const sunXZ = new Vector3(0.52, 0, -0.35).normalize();
  shadowList.forEach((s, i) => {
    const len = s.h * 0.55;
    mtx
      .makeRotationY(s.rot)
      .scale(sv.set(s.w * 1.25 + len * 0.3, 1, s.d * 1.25 + len * 0.3))
      .setPosition(s.x + sunXZ.x * len * 0.45, 0.06, s.z + sunXZ.z * len * 0.45);
    shadows.setMatrixAt(i, mtx);
  });
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  group.add(shadows);

  // ---- Base board (the model's plinth), the stage and the backdrop ----
  const half = belt + (big ? 8 : 9);
  const T = big ? 2.4 : 1.8;
  const baseUni = {
    ...common,
    uBase: laneUni.uBase,
    uBaseSide: { value: lin(L0.baseSide) },
    uRing: { value: lin(L0.ring) },
    uLift: { value: lin(L0.lift) },
    uHalf: { value: new Vector3(half, T, half) },
    uRings: { value: [...new Array(11).fill(-10), rMax + dim.D * 0.9] },
  };
  const baseG = new BoxGeometry(1, 1, 1);
  baseG.translate(0, -0.5, 0);
  const base = new Mesh(
    baseG,
    new ShaderMaterial({
      uniforms: baseUni,
      vertexShader: `varying vec3 vL, vN; varying vec2 vP; void main() { vL = position; vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uBase, uBaseSide, uRing, uLift, uHalf; uniform float uRings[12], uNight;
        varying vec3 vL, vN; varying vec2 vP;
        void main() { vec3 c;
          if (vN.y > .5) {
            float r = length(vP);
            c = mix(uBase, uLift, (1. - smoothstep(0., uHalf.x, r)) * .5 * uNight);
            // A faint engraved circle where the quarter ends.
            float fw = max(fwidth(r) * 1.4, 1e-4);
            c = mix(c, uRing, (1. - smoothstep(0., fw, abs(r - uRings[11]) - .06)) * .8);
            // The model's edge: a hairline bevel.
            vec2 e = uHalf.xz - abs(vP); float de = min(e.x, e.y);
            c = mix(c, uBaseSide, 1. - smoothstep(0., max(fwidth(de) * 2., 1e-4), de - .15));
          } else c = uBaseSide * (.8 + .2 * smoothstep(-uHalf.y, 0., vL.y * uHalf.y));
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
  );
  base.scale.set(half * 2, T, half * 2);
  group.add(base);
  const stageUni = {
    ...common,
    uStage: { value: lin(L0.stage) },
    uLift: baseUni.uLift,
    uShade: shUni.uShade,
    uHalf: baseUni.uHalf,
  };
  const stage = new Mesh(
    new PlaneGeometry(2400, 2400),
    new ShaderMaterial({
      uniforms: stageUni,
      vertexShader: `varying vec2 vP; varying vec3 vV; void main() { vec4 w = modelMatrix * vec4(position, 1.); vP = w.xz; vec4 mv = viewMatrix * w; vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uStage, uLift, uShade, uHalf; uniform float uNight; varying vec2 vP; varying vec3 vV;
        void main() { vec2 q = abs(vP - vec2(2., -1.4)) - uHalf.xz; float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
          float sh = (1. - smoothstep(-2., 14., d)) * (.22 - .1 * uNight);
          vec2 s = vV.xy / max(-vV.z, 1e-3); float vig = smoothstep(.2, 1.1, length(s * vec2(.62, 1.)));
          vec3 c = mix(mix(uLift, uStage, vig), uShade, sh);
          gl_FragColor = vec4(untone(c), 1.); }`,
    }),
  );
  stage.rotation.x = -Math.PI / 2;
  stage.position.y = -T;
  group.add(stage);
  const sky = new Mesh(
    new SphereGeometry(1400, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: stageUni,
      vertexShader: `varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${UNTONE} uniform vec3 uStage, uLift; varying vec3 vV;
        void main() { vec2 s = vV.xy / max(-vV.z, 1e-3); float vig = smoothstep(.2, 1.1, length(s * vec2(.62, 1.)));
          gl_FragColor = vec4(untone(mix(uLift, uStage, vig)), 1.); }`,
    }),
  );
  sky.renderOrder = -1;
  group.add(sky);

  // ---- Family businesses: a small shop in front of the owner's house, with its name on a sign ----
  const shops: Array<{ s: Sign; bz: StudioBusiness }> = [];
  const bizName = (bz: StudioBusiness) => (ctx.lang() === 'ar' ? bz.ar : bz.en);
  const signH = big ? 2.4 : 3.1;
  const signsAt = new Map<Lot, number>();
  for (const bz of M.biz) {
    const owner = bz.owners.map((o) => lot.get(o)).find((l): l is Lot => !!l);
    if (!owner) continue;
    // Several businesses of one owner stack up on the same post.
    const stack = signsAt.get(owner) ?? 0;
    signsAt.set(owner, stack + 1);
    // A billboard whose colours pass through untone, so the board and its ink land exactly.
    const uni = {
      ...common,
      uMap: { value: new CanvasTexture(document.createElement('canvas')) as Texture },
      uSize: { value: new Vector2(1, 1) },
    };
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: uni,
        vertexShader: `uniform vec2 uSize; varying vec2 vUv; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `${UNTONE} uniform sampler2D uMap; uniform float uFocus; varying vec2 vUv;
          void main() { vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(untone(t.rgb), t.a * (1. - .55 * uFocus)); }`,
      }),
    );
    const sign: Sign = { mesh, uni };
    drawSign(sign, bizName(bz), look().sign, signH, ctx.rtl());
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    fwd.set(Math.sin(owner.rot), 0, Math.cos(owner.rot));
    mesh.position.set(
      owner.x + fwd.x * dim.D * 1.05,
      dim.H * 2.2 + stack * signH * 1.25,
      owner.z + fwd.z * dim.D * 1.05,
    );
    mesh.userData.year = bz.year;
    group.add(mesh);
    shops.push({ s: sign, bz });
  }

  // Redraw the signs once the app's fonts are in (skipped if the scene was dropped meanwhile).
  void document.fonts
    ?.load('600 44px Manrope')
    .then(() => {
      if (!group.parent) return;
      for (const { s, bz } of shops) drawSign(s, bizName(bz), look().sign, signH, ctx.rtl());
    })
    .catch(() => {});

  const tint = () => {
    const t = look();
    common.uExpo.value = t.exposure;
    common.uKey.value.copy(lin(t.key));
    common.uSky.value.copy(lin(t.sky));
    common.uGnd.value.copy(lin(t.gnd));
    common.uTeal.value.copy(lin(t.teal));
    common.uGold.value.copy(lin(t.gold));
    common.uDimTo.value.copy(lin(t.dimTo));
    common.uNight.value = t.night;
    wallUni.uWall.value.copy(lin(t.wall));
    wallUni.uCap.value.copy(lin(t.cap));
    wallUni.uRecess.value.copy(lin(t.recess));
    wallUni.uDoor.value.copy(lin(t.door));
    wallUni.uPole.value.copy(lin(t.pole));
    wallUni.uWin.value.copy(lin(t.win));
    wallUni.uSlot.value.copy(lin(t.slot));
    wallUni.uUp.value.copy(lin(t.up));
    wallUni.uUpA.value = t.upA;
    laneUni.uLane.value.copy(lin(t.lane));
    laneUni.uBase.value.copy(lin(t.base));
    lanternUni.uLantern.value.copy(lin(t.lantern));
    palmUni.uFrond.value.copy(lin(t.frond));
    palmUni.uTrunk.value.copy(lin(t.trunk));
    shUni.uShade.value.copy(lin(t.shadow));
    shUni.uShadeA.value = t.shadowA;
    shUni.uBase.value.copy(lin(t.base));
    baseUni.uBaseSide.value.copy(lin(t.baseSide));
    baseUni.uRing.value.copy(lin(t.ring));
    baseUni.uLift.value.copy(lin(t.lift));
    stageUni.uStage.value.copy(lin(t.stage));
    for (const { s, bz } of shops) drawSign(s, bizName(bz), t.sign, signH, ctx.rtl());
    ctx.look(t.bloom, t.exposure);
  };
  const yearHook = (yr: number) => {
    for (const { s } of shops) s.mesh.visible = yr >= (s.mesh.userData.year as number);
  };
  const relang = () => {
    for (const { s, bz } of shops) drawSign(s, bizName(bz), look().sign, signH, ctx.rtl());
  };

  // ---- Default view: the whole quarter from the front, well above it, fitted to the stage ----
  let tallest = dim.H * 1.5;
  for (const v of tTop.values()) tallest = Math.max(tallest, v.y);
  const reach = rMax + dim.D * 1.2;
  const target = new Vector3(0, tallest * 0.12, reach * 0.04);
  const yaw = -dir * 0.32;
  // Steep enough that a parent's tower-top portrait never lines up with a child's on the next ring.
  const elev = big ? 1.05 : 0.98;
  const dirV = new Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
  const probe = new PerspectiveCamera(42, 1.45, 0.5, 8000);
  const corners: Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    corners.push(new Vector3(Math.cos(a) * reach, 0, Math.sin(a) * reach));
    corners.push(new Vector3(Math.cos(a) * rMax * 0.5, tallest + lift, Math.sin(a) * rMax * 0.5));
  }
  const v = new Vector3();
  const fits = (d: number) => {
    probe.position.copy(target).addScaledVector(dirV, d);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    return corners.every((c) => {
      v.copy(c).project(probe);
      return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.9 && v.z < 1;
    });
  };
  let lo = 5;
  let hi = 8000;
  for (let it = 0; it < 32; it++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m;
    else lo = m;
  }
  tint();
  return {
    key: 'city',
    group,
    pos,
    size,
    style: 0,
    lift: 7,
    tint,
    yearHook,
    relang,
    appear,
    labelUp: true,
    labelScale: big ? 0.85 : 0.92,
    hiTargets: [
      { geo: houseG, perPerson: true },
      { geo: towerG, perPerson: true },
      { geo: thrG, perPerson: true },
      { geo: mastG, perPerson: true },
      { geo: laneG },
    ],
    focus: [focus],
    view: { target, cam: target.clone().addScaledVector(dirV, hi) },
    follow: big ? 30 : 40,
  };
};
