import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Curve,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  Sprite,
  SpriteMaterial,
  Vector3,
  Vector4,
} from 'three';
import { addCurveLine, flowLines, lineBuilder, skyDome, softTex } from '../gl.ts';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { hazeMat, LOOK, MAX_ARMS, MAX_GENS, type SpiralUniforms, starMat } from './galaxy-gl.ts';
import type { SceneBuilder } from './types.ts';

// Family Galaxy: the founder is the galactic core. Each of the founder's children starts a spiral arm
// and that line's descendants are stars along it, winding outward one generation per step; sub-branches
// spread across the arm like feathers. Spouses are binary pairs. Arms follow one log spiral
// (angle = arm phase + offset across the arm + ln(r / rc) * wind), shared with the GPU star field.

const TAU = Math.PI * 2;
/** cot(pitch angle): about 18 degrees, like M51. */
const WIND = 3.1;

/** Parent to child along the spiral: radius and angle interpolate in polar coordinates. */
class SpiralArc extends Curve<Vector3> {
  constructor(
    private readonly r0: number,
    private readonly t0: number,
    private readonly y0: number,
    private readonly r1: number,
    private readonly dt: number,
    private readonly y1: number,
  ) {
    super();
  }
  override getPoint(t: number, out = new Vector3()) {
    const r = this.r0 + (this.r1 - this.r0) * t;
    const th = this.t0 + this.dt * t;
    return out.set(
      Math.cos(th) * r,
      this.y0 + (this.y1 - this.y0) * t + Math.sin(Math.PI * t) * 0.25,
      Math.sin(th) * r,
    );
  }
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

export const galaxyScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const size = big ? 0.95 : 1.15;
  const rc = big ? 8 : 7;
  const tapR = (r: number) => Math.min(1, Math.max(0.35, 0.35 + 0.65 * (r / rc - 1) * 0.5));
  const wind = (r: number) => Math.log(Math.max(r, 0.01) / rc) * WIND;

  // ---- arms: the founder's line runs down a spine while it has one child; its children head the arms ----
  const spine: StudioPerson[] = [M.root];
  for (;;) {
    const last = spine[spine.length - 1] as StudioPerson;
    const kids = last.kids.map((k) => M.get(k));
    if (kids.length !== 1 || spine.length > 4) break;
    spine.push(kids[0] as StudioPerson);
  }
  const hub = spine[spine.length - 1] as StudioPerson;
  const heads = hub.kids.map((k) => M.get(k));
  const weights = heads.map((h) => h.leaves ** 0.5);
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  interface Arm {
    phi: number;
    span: number;
    a0: number;
    a1: number;
    w: number;
  }
  const arms: Arm[] = [];
  let acc = 0;
  let sec = 0;
  heads.forEach((h, i) => {
    const slot = (TAU * (weights[i] ?? 1)) / wSum;
    const sw = h.leaves / Math.max(1, hub.leaves);
    arms.push({ phi: acc + slot / 2, span: Math.min(1.25, slot * 0.5), a0: sec, a1: sec + sw, w: 1 });
    acc += slot;
    sec += sw;
  });
  const armOf = new Map<string, number>();
  heads.forEach((h, i) => {
    const q = [h.id];
    while (q.length) {
      const id = q.pop() as string;
      armOf.set(id, i);
      q.push(...M.get(id).kids);
    }
  });
  // Decorative arms so a small family still reads as a spiral galaxy.
  const deco: Arm[] = [];
  if (arms.length === 0)
    deco.push({ phi: 0.4, span: 0.9, a0: 0, a1: 1, w: 0.8 }, { phi: 0.4 + Math.PI, span: 0.9, a0: 0, a1: 1, w: 0.8 });
  else if (arms.length === 1)
    deco.push({ phi: (arms[0]?.phi ?? 0) + Math.PI, span: arms[0]?.span ?? 1, a0: 0, a1: 1, w: 0.7 });
  const allArms = [...arms, ...deco].slice(0, MAX_ARMS);

  // ---- radii per generation step: far enough apart, and wide enough for everyone on that ring ----
  const spousesOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    spousesOf.set(p.anchor, [...(spousesOf.get(p.anchor) ?? []), p]);
  }
  const step = (p: StudioPerson) => Math.max(1, p.gen - hub.gen);
  const maxD = Math.max(1, ...M.people.filter((p) => armOf.has(p.id)).map(step));
  // Load per arm and generation step (a spouse widens a star into a binary).
  const load = arms.map(() => new Array<number>(maxD + 1).fill(0));
  const members = arms.map(() => Array.from({ length: maxD + 1 }, () => [] as StudioPerson[]));
  for (const p of M.people) {
    const ai = armOf.get(p.id);
    if (ai == null || p.mi) continue;
    const L = load[ai] as number[];
    L[step(p)] = (L[step(p)] ?? 0) + 1 + 0.8 * (spousesOf.get(p.id)?.length ?? 0);
    members[ai]?.[step(p)]?.push(p);
  }
  const gap = size * 2.4;
  const rowGap = gap * 0.8;
  const maxRows = big ? 4 : 2;
  const radius: number[] = [0];
  const rowsOf: number[] = [1];
  let edge = rc - (big ? 4.5 : 6);
  for (let d = 1; d <= maxD; d++) {
    let r = Math.max(rc, edge + (big ? 4.5 : 6));
    let rows = 1;
    // A generation is a band of up to maxRows staggered rows; widen the radius when that is not enough.
    for (let k = 0; k < 60; k++) {
      rows = 1;
      arms.forEach((A, i) => {
        const room = r * Math.max(0.35, A.span) * tapR(r) * 0.9;
        rows = Math.max(rows, Math.ceil(((load[i]?.[d] ?? 0) * gap) / Math.max(room, 1e-3)));
      });
      if (rows <= maxRows) break;
      r *= 1.06;
    }
    rows = Math.min(rows, maxRows);
    radius.push(r);
    rowsOf.push(rows);
    edge = r + (rows - 1) * rowGap;
  }
  const R = edge * 1.06 + 4;

  // ---- where everyone sits ----
  const place = new Map<string, { r: number; th: number; y: number }>();
  spine.forEach((p, k) => {
    const r = k === 0 ? 0 : 1.6 + k * 1.4;
    place.set(p.id, { r, th: k * 2.3, y: k === 0 ? 0.8 : 0.4 });
  });
  arms.forEach((A, ai) => {
    for (let d = 1; d <= maxD; d++) {
      const list = (members[ai]?.[d] ?? []).sort((x, y) => x.ang - y.ang);
      const rows = rowsOf[d] ?? 1;
      list.forEach((p, rank) => {
        const u = (p.ang - A.a0) / Math.max(1e-6, A.a1 - A.a0) - 0.5;
        const h = hash(p.id);
        // Feathers: the outer side of a line sits a little further out, so sub-branches peel off at an angle.
        const r0 = (radius[d] ?? rc) + (rank % rows) * rowGap;
        const r = r0 * (1 + 0.06 * u) + (h - 0.5) * (big ? 0.8 : 1.6);
        const th = A.phi + u * Math.max(0.35, A.span) * tapR(r) * 0.9 + wind(r);
        place.set(p.id, { r, th, y: (hash(`${p.id}y`) - 0.5) * 0.8 });
      });
    }
  });
  // Anyone left (unusual data): beside the founder.
  for (const p of M.people) if (!p.mi && !place.has(p.id)) place.set(p.id, { r: 3, th: hash(p.id) * TAU, y: 0 });
  const xyz = (q: { r: number; th: number; y: number }, out = new Vector3()) =>
    out.set(Math.cos(q.th) * q.r, q.y, Math.sin(q.th) * q.r);
  const at = new Map<string, Vector3>();
  for (const [id, q] of place) at.set(id, xyz(q));
  // Spouses: binary companions on either side of the partner, along the arm.
  const binaries: Array<{ a: string; b: string; year: number }> = [];
  for (let pass = 0; pass < 3; pass++)
    for (const p of M.people) {
      if (!p.mi || at.has(p.id)) continue;
      const a = at.get(p.anchor ?? M.root.id);
      if (!a) continue;
      const k = spouseIndex(M, p);
      const out = new Vector3(a.x, 0, a.z);
      if (out.lengthSq() < 0.01) out.set(1, 0, 0);
      out.normalize();
      const tan = new Vector3(-out.z, 0, out.x);
      const sep = size * (p.anchor === M.root.id ? 2.6 : 1.9) * (1 + Math.floor(k / 2) * 0.9);
      at.set(
        p.id,
        a
          .clone()
          .addScaledVector(tan, (k % 2 ? -1 : 1) * sep)
          .addScaledVector(out, 0.25 * size)
          .add(new Vector3(0, 0.3, 0)),
      );
      binaries.push({ a: p.anchor ?? M.root.id, b: p.id, year: spouseYear(M, p) });
    }
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const v = at.get(p.id) ?? new Vector3();
    pos.set([v.x, v.y, v.z], i * 3);
  });

  // ---- birth year by radius: the galaxy grows outward with the family ----
  const gr: number[] = [0];
  const gy: number[] = [M.root.born];
  for (let d = 1; d <= maxD && gr.length < MAX_GENS; d++) {
    const ys = M.people.filter((p) => armOf.has(p.id) && !p.mi && step(p) === d).map((p) => p.born);
    gr.push(d === 1 ? rc * 0.6 : ((radius[d - 1] ?? rc) + ((rowsOf[d - 1] ?? 1) - 1) * rowGap + (radius[d] ?? rc)) / 2);
    gy.push(Math.max(gy[gy.length - 1] ?? M.root.born, ys.length ? Math.min(...ys) : (gy[gy.length - 1] ?? 0) + 25));
  }
  while (gr.length < MAX_GENS) {
    gr.push(1e6);
    gy.push(gy[gy.length - 1] ?? M.root.born);
  }
  const S: SpiralUniforms = {
    uRc: { value: rc },
    uWind: { value: WIND },
    uR: { value: R },
    uGR: { value: gr },
    uGY: { value: gy },
    uNG: { value: Math.min(MAX_GENS, maxD + 1) },
  };

  // ---- lineage trails along the arms and binary orbits ----
  const B = lineBuilder();
  const trailK = big ? 0.5 : 0.8;
  const trail = lin('#000000');
  const L0 = ctx.dark() ? LOOK.dark : LOOK.light;
  trail.copy(lin(L0.link)).lerp(lin(M.homeColor), 0.25).multiplyScalar(trailK);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = place.get(p.parent);
    const c = place.get(p.id);
    if (!a || !c) continue;
    let t0 = a.th;
    if (a.r < 0.5) t0 = c.th - 1.2; // leave the core along the arm
    // Angles are unwrapped (phase + wind), so the plain difference follows the arm.
    const dt = c.th - t0;
    addCurveLine(B, new SpiralArc(a.r, t0, a.y, c.r, dt, c.y), big ? 10 : 22, p.born, p.id, trail);
  }
  const gold = lin(L0.ring).multiplyScalar(0.55);
  for (const { a, b, year } of binaries) {
    const pa = at.get(a);
    const pb = at.get(b);
    if (!pa || !pb) continue;
    const m = pa.clone().lerp(pb, 0.5);
    const ax = pb.clone().sub(pa).setY(0);
    const half = ax.length() / 2 + size * 0.7;
    ax.normalize();
    const side = new Vector3(-ax.z, 0, ax.x);
    const pts: Vector3[] = [];
    const n = big ? 20 : 36;
    for (let k = 0; k <= n; k++) {
      const v = (k / n) * TAU;
      pts.push(
        m
          .clone()
          .addScaledVector(ax, Math.cos(v) * half)
          .addScaledVector(side, Math.sin(v) * half * 0.45),
      );
    }
    for (let k = 0; k < n; k++) {
      const p0 = pts[k] as Vector3;
      const p1 = pts[k + 1] as Vector3;
      B.pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      B.t.push(k / n, (k + 1) / n);
      B.birth.push(year, year);
      B.key.push(b, b);
      B.col.push(gold.r, gold.g, gold.b, gold.r, gold.g, gold.b);
    }
  }
  const { lines, uni: lineUni } = flowLines(B, U, big ? 0.16 : 0.3);
  lines.renderOrder = 3;
  group.add(lines);

  // ---- the GPU star field: bulge, arms, disk, HII knots and the far sky, one Points draw ----
  const r1 = rng(51);
  const gauss = () => {
    const u = Math.max(1e-6, r1());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r1());
  };
  const nArm = big ? 42000 : 30000;
  const nBulge = big ? 9000 : 7000;
  const nDisk = big ? 9000 : 6000;
  const nKnot = big ? 190 : 110;
  const nFar = 4000;
  const cap = nArm + nBulge + nDisk + nKnot * 12 + nFar;
  const P = new Float32Array(cap * 3);
  const K = new Float32Array(cap * 4);
  const C = new Float32Array(cap * 4);
  const Sz = new Float32Array(cap);
  let n = 0;
  const push = (
    a: number,
    b: number,
    c: number,
    kind: number,
    span: number,
    y: number,
    jr: number,
    col: [number, number, number],
    s: number,
  ) => {
    P.set([a, b, c], n * 3);
    K.set([kind, span, y, jr], n * 4);
    C.set([col[0], col[1], col[2], r1() * 10], n * 4);
    Sz[n] = s;
    n++;
  };
  const lMin = Math.log(0.45);
  const lMax = Math.log((R * 0.98) / rc);
  const armW = allArms.map((a) => a.w * (a.span + 0.4));
  const armWSum = armW.reduce((s, w) => s + w, 0);
  const pickArm = () => {
    let x = r1() * armWSum;
    for (let i = 0; i < allArms.length; i++) {
      x -= armW[i] ?? 0;
      if (x <= 0) return allArms[i] as Arm;
    }
    return allArms[0] as Arm;
  };
  const tintStar = (): [number, number, number] => {
    const v = r1();
    const b = 0.35 + r1() ** 2 * 1.1;
    if (v < 0.12) return [1.1 * b, 0.9 * b, 0.7 * b];
    if (v < 0.3) return [0.8 * b, 0.9 * b, 1.15 * b];
    return [b, b, b];
  };
  // ln(r) is drawn so the surface density falls off roughly exponentially.
  const drawL = () => {
    for (;;) {
      const l = lMin + r1() * (lMax - lMin);
      const r = rc * Math.exp(l);
      if (r1() < Math.exp(-r / (R * 0.55)) * (r / rc) ** 0.35 * 1.4) return l;
    }
  };
  for (let i = 0; i < nArm; i++) {
    const A = pickArm();
    const l = drawL();
    const r = rc * Math.exp(l);
    // Three.js Journey style: power-law scatter keeps most stars tight to the arm, with a few strays.
    const u = gauss() * 0.2 - 0.1 + (r1() < 0.15 ? (r1() - 0.5) * 1.6 : 0);
    const y = (r1() - 0.5) * 2 * r1() ** 3 * (1.6 + r * 0.03);
    const s = r1() < 0.01 ? 2.6 + r1() * 1.4 : 0.3 + r1() ** 3 * 0.9;
    push(l, A.phi, u, 1, A.span, y, (r1() - 0.5) * 0.08, tintStar(), s);
  }
  for (let i = 0; i < nBulge; i++) {
    const r = rc * 0.95 * r1() ** 1.7 + 0.2;
    const y = gauss() * (0.5 + r * 0.32) * 0.6;
    const b = 0.22 + r1() * 0.5;
    push(r, r1() * TAU, y, 0, 0, 0, 0, [b * 1.05, b * 0.92, b * 0.78], 0.3 + r1() ** 2 * 0.8);
  }
  for (let i = 0; i < nDisk; i++) {
    const r = Math.min(R * 1.1, -Math.log(Math.max(1e-4, r1())) * R * 0.3 + rc * 0.4);
    const b = 0.2 + r1() * 0.4;
    push(r, r1() * TAU, gauss() * 0.5, 2, 0, 0, 0, [b, b * 0.97, b * 0.92], 0.3 + r1() * 0.5);
  }
  // HII knots: clumps of pink just downstream of the dust lane, ringed by a few hot blue stars.
  for (let i = 0; i < nKnot; i++) {
    const A = pickArm();
    const l = Math.log(1.2) + r1() * (lMax - Math.log(1.3));
    const u = -0.18 + gauss() * 0.14;
    const m = 5 + Math.floor(r1() * 7);
    const big1 = 0.8 + r1() * 1.2;
    for (let k = 0; k < m; k++) {
      const hot = k < 2;
      const c: [number, number, number] = hot ? [0.75, 0.85, 1.4] : [0.75, 0.75, 0.75];
      push(
        l + gauss() * 0.02,
        A.phi,
        u + gauss() * 0.03,
        hot ? 1 : 3,
        A.span,
        gauss() * 0.15,
        0,
        c,
        hot ? 0.7 + r1() * 0.8 : big1 * (0.4 + r1() * 0.6),
      );
    }
  }
  for (let i = 0; i < nFar; i++) {
    const u = r1() * 2 - 1;
    const th = r1() * TAU;
    const rr = 900 + r1() * 300;
    const s = Math.sqrt(1 - u * u);
    const b = 0.25 + r1() ** 3 * 0.9;
    const blue = r1() < 0.3;
    push(
      Math.cos(th) * s * rr,
      u * rr,
      Math.sin(th) * s * rr,
      4,
      0,
      0,
      0,
      blue ? [b * 0.8, b * 0.9, b * 1.2] : [b, b, b],
      1 + r1() ** 4 * 2.2,
    );
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(P.subarray(0, n * 3), 3));
  sg.setAttribute('aK', new BufferAttribute(K.subarray(0, n * 4), 4));
  sg.setAttribute('aC', new BufferAttribute(C.subarray(0, n * 4), 4));
  sg.setAttribute('aS', new BufferAttribute(Sz.subarray(0, n), 1));
  const stars = starMat(U, S);
  stars.uni.uLmin.value = lMin;
  stars.uni.uLmax.value = lMax;
  // Star sizes are in world units; keep them the same on screen whatever the galaxy's size.
  stars.uni.uSz.value = Math.min(1.8, Math.max(0.5, R / 75));
  const field = new Points(sg, stars.mat);
  field.frustumCulled = false;
  field.renderOrder = 1;
  field.onBeforeRender = (renderer) => {
    stars.uni.uPR.value = renderer.getPixelRatio();
  };
  group.add(field);

  // ---- unresolved light: arms, dust lanes and nebulae on one plane ----
  const armVecs = allArms.map((a) => new Vector4(a.phi, a.span, a.w, 0));
  const haze = hazeMat(U, S, armVecs);
  const plane = new Mesh(new PlaneGeometry(R * 2.7, R * 2.7), haze.mat);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 0;
  group.add(plane);

  // ---- the core: a bright bulge with a soft halo ----
  const glow = softTex([
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.55)'],
    [0.45, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const coreMatl = new SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const haloMatl = new SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const core = new Sprite(coreMatl);
  core.scale.setScalar(rc * 1.3);
  const halo = new Sprite(haloMatl);
  halo.scale.setScalar(Math.min(R * 0.9, rc * 6));
  core.renderOrder = 2;
  halo.renderOrder = 2;
  group.add(halo, core);

  const sky = skyDome(LOOK.dark.top, LOOK.dark.hor, LOOK.dark.ground);
  group.add(sky.mesh);

  const tint = () => {
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    sky.set(L.top, L.hor, L.ground);
    for (const u of [stars.uni, haze.uni]) {
      u.uWarm.value.copy(lin(L.warm));
      u.uBlue.value.copy(lin(L.blue));
      u.uPink.value.copy(lin(L.pink));
    }
    haze.uni.uCore.value.copy(lin(L.core));
    haze.uni.uGain.value = L.haze;
    stars.uni.uGain.value = L.stars;
    coreMatl.color.copy(lin(L.core)).multiplyScalar(0.6);
    haloMatl.color.copy(lin(L.warm)).multiplyScalar(L.dark ? 0.07 : 0.06);
    const tr = lin(L.link).lerp(lin(M.homeColor), 0.25).multiplyScalar(trailK);
    const gd = lin(L.ring).multiplyScalar(0.55);
    // Recolour the trails and orbits in place (the attribute holds both).
    const col = lines.geometry.getAttribute('aCol');
    const keys = lines.geometry.userData.keys as string[];
    for (let k = 0; k < keys.length; k++) {
      const p = M.byId.get(keys[k] ?? '');
      const c = p?.mi ? gd : tr;
      col.setXYZ(k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    ctx.look(L.bloom, L.exposure);
  };

  // Default view: the whole galaxy at a tilted 3/4 angle. Arabic looks from the other face of the
  // disk, which mirrors the spiral so the arms wind the other way.
  const target = new Vector3(0, 0, 0);
  const el = 0.95; // elevation above the disk, radians
  const dist = (R * 1.3) / Math.tan((21 * Math.PI) / 180);
  const camAt = (rtl: boolean) =>
    new Vector3(
      Math.sin(0.5) * Math.cos(el) * dist,
      (rtl ? -1 : 1) * Math.sin(el) * dist,
      Math.cos(0.5) * Math.cos(el) * dist,
    );
  const view = { target, cam: camAt(ctx.rtl()) };

  return {
    key: 'galaxy',
    group,
    pos,
    size,
    style: 1,
    lift: 4,
    labelScale: 0.85,
    tint,
    hiTargets: [{ geo: lines.geometry }],
    focus: [lineUni.uFocus, stars.uni.uFocus, haze.uni.uFocus],
    view,
    follow: big ? 22 : 20,
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
    },
  };
};
