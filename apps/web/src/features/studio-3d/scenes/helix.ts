import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Curve,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineCurve3,
  LineSegments,
  Mesh,
  Points,
  Vector3,
} from 'three';
import { bake, builder, skyDome, type TubeBuilder, tube } from '../gl.ts';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, NOW, rng } from '../palette.ts';
import { baseMat, coreMat, floorMat, LOOK, linkMat, moteMat, sheathMat } from './helix-mat.ts';
import type { SceneBuilder } from './types.ts';

// Family Helix: one right-handed double helix of constant pitch. People born into the family
// sit in lineage order along strand A, generation after generation, so the generations climb;
// each spouse sits opposite on strand B and the couple is a base pair (a two-coloured rung).
// Parent-to-child links are glowing arcs bowing outward across the turns.

const TAU = Math.PI * 2;
/** Angle between the strands: unequal grooves like B-DNA, so rungs miss the axis. */
const GROOVE = Math.PI * 0.8;

/** Point on a cylinder of radius r around the vertical axis (right-handed as θ grows upward). */
const onCyl = (th: number, y: number, r: number, out = new Vector3()) => out.set(r * Math.sin(th), y, r * Math.cos(th));

/** Arc on the cylinder surface between two people, bowing outward. */
class Arc extends Curve<Vector3> {
  constructor(
    private readonly a: { th: number; y: number; r: number },
    private readonly dth: number,
    private readonly b: { y: number; r: number },
    private readonly bow: number,
  ) {
    super();
  }
  override getPoint(t: number, out = new Vector3()) {
    const s = t * t * (3 - 2 * t);
    const r = this.a.r + (this.b.r - this.a.r) * t + this.bow * Math.sin(Math.PI * t);
    return onCyl(this.a.th + this.dth * t, this.a.y + (this.b.y - this.a.y) * s, r, out);
  }
}

export const helixScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const size = big ? 1.2 : 1.25;

  // ---- layout along the strand: slots in generation, then lineage order ----
  const spousesOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    spousesOf.set(p.anchor, [...(spousesOf.get(p.anchor) ?? []), p]);
  }
  for (const list of spousesOf.values()) list.sort((x, y) => spouseYear(M, x) - spouseYear(M, y));
  const line = M.people.filter((p) => !p.mi).sort((a, b) => a.gen - b.gen || a.ang - b.ang);
  const slotOf = new Map<string, number>();
  const genStart: number[] = [];
  let slot = 0.4;
  let lastGen = -1;
  for (const p of line) {
    if (p.gen !== lastGen) {
      if (lastGen >= 0) slot += 0.7; // breathing room between generations
      for (let g = lastGen + 1; g <= p.gen; g++) genStart[g] = slot - 0.35;
      lastGen = p.gen;
    }
    const w = Math.max(1, spousesOf.get(p.id)?.length ?? 0);
    slotOf.set(p.id, slot + w / 2);
    slot += w;
  }
  const slots = slot + 0.4;
  genStart[lastGen + 1] = slots - 0.4 + 0.35;

  // ---- solve radius and pitch so the helix keeps a tall portrait proportion ----
  const gap = big ? 2.5 : 3.7; // arc between neighbours on a strand
  const arc = slots * gap;
  const K = big ? 0.85 : 1.3; // pitch / radius: DNA-like when small, flatter for big families
  const Q = big ? 1.35 : 1.45; // height / diameter
  const R = Math.max(4.6, (arc * K) / (TAU * Math.hypot(1, K / TAU) * 2 * Q));
  const P = Math.max(size * 3.4, K * R);
  const c = Math.hypot(R, P / TAU); // helix length per radian
  const thOf = (s: number) => (s * gap) / c;
  const yOf = (th: number) => (th / TAU) * P;
  const thMax = thOf(slots);
  const H = yOf(thMax);
  const out = 0.95 + size * 0.15; // portraits sit just outside the glass
  const sheathR = big ? 0.4 + R * 0.006 : 0.5;

  // Where everyone sits: angle, height, strand.
  const place = new Map<string, { th: number; y: number; b: boolean }>();
  for (const p of line) {
    const th = thOf(slotOf.get(p.id) ?? 0);
    place.set(p.id, { th, y: yOf(th), b: false });
    const sp = spousesOf.get(p.id) ?? [];
    const s0 = (slotOf.get(p.id) ?? 0) - sp.length / 2;
    sp.forEach((q, k) => {
      const t = thOf(sp.length > 1 ? s0 + k + 0.5 : (slotOf.get(p.id) ?? 0));
      place.set(q.id, { th: t + GROOVE, y: yOf(t), b: true });
    });
  }
  // Edge data (a spouse anchored to another married-in person): sit just past the anchor on strand B.
  for (let pass = 0; pass < 3; pass++)
    for (const p of M.people) {
      if (place.has(p.id)) continue;
      const a = place.get(p.anchor ?? M.root.id);
      if (a) place.set(p.id, { th: a.b ? a.th + (0.8 * gap) / c : a.th + GROOVE, y: a.y, b: true });
    }
  const pos = new Float32Array(M.n * 3);
  const v = new Vector3();
  M.people.forEach((p, i) => {
    const q = place.get(p.id) ?? { th: 0, y: 0, b: false };
    onCyl(q.th, q.y, R + out, v);
    pos.set([v.x, v.y, v.z], i * 3);
  });

  // ---- strands: glass sheath + glowing core; each ring appears once its people are born ----
  const seen = M.people
    .map((p) => ({ th: (place.get(p.id)?.th ?? 0) - (place.get(p.id)?.b ? GROOVE : 0), born: p.born }))
    .sort((a, b) => a.th - b.th);
  const suffix = new Float32Array(seen.length + 1);
  suffix[seen.length] = seen.length ? (seen[seen.length - 1]?.born ?? NOW) : NOW;
  for (let i = seen.length - 1; i >= 0; i--) suffix[i] = Math.min(seen[i]?.born ?? NOW, suffix[i + 1] ?? NOW);
  const birthAt = (th: number) => {
    let i = 0;
    while (i < seen.length && (seen[i]?.th ?? 0) < th - 0.05) i++;
    return suffix[i] ?? NOW;
  };
  const th0 = -0.2 * TAU;
  const th1 = thMax + 0.15 * TAU;
  const perTurn = big ? 72 : 96;
  const steps = Math.ceil(((th1 - th0) / TAU) * perTurn);
  const strand = (B: TubeBuilder, off: number, r: number, radial: number) => {
    const base = B.pos.length / 3;
    const C = new Vector3();
    const T = new Vector3();
    const N = new Vector3();
    const Bn = new Vector3();
    const n = new Vector3();
    for (let i = 0; i <= steps; i++) {
      const th = th0 + ((th1 - th0) * i) / steps;
      const y = yOf(th);
      onCyl(th + off, y, R, C);
      // Analytic frame: N points at the axis, T along the strand.
      N.set(-Math.sin(th + off), 0, -Math.cos(th + off));
      T.set(R * Math.cos(th + off), P / TAU, -R * Math.sin(th + off)).normalize();
      Bn.crossVectors(T, N).normalize();
      const birth = birthAt(th);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU;
        n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a));
        B.pos.push(C.x + n.x * r, C.y + n.y * r, C.z + n.z * r);
        B.nor.push(n.x, n.y, n.z);
        B.t.push(th / TAU);
        B.u.push(j / radial);
        B.birth.push(birth);
        B.grow.push(1);
        B.key.push('');
        B.col.push(1, 1, 1);
      }
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        B.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  };
  const withCol = (B: TubeBuilder) => {
    const g = bake(B);
    g.setAttribute('aCol', new Float32BufferAttribute(B.col, 3));
    return g;
  };
  const SB = builder();
  strand(SB, 0, sheathR, big ? 10 : 14);
  strand(SB, GROOVE, sheathR, big ? 10 : 14);
  const sheath = sheathMat(U);
  const sheathMesh = new Mesh(withCol(SB), sheath.mat);
  sheathMesh.renderOrder = 2;
  const CB = builder();
  strand(CB, 0, 0.11, 5);
  strand(CB, GROOVE, 0.11, 5);
  const core = coreMat(U);
  const coreMesh = new Mesh(withCol(CB), core.mat);
  group.add(coreMesh, sheathMesh);

  // ---- base pairs: two half-rungs in each person's colour, meeting near the axis ----
  const RB = builder();
  const rungR = big ? 0.13 + R * 0.002 : 0.26;
  const half = (a: Vector3, b: Vector3, birth: number, key: string, hex: string) => {
    const before = RB.pos.length / 3;
    tube(RB, new LineCurve3(a, b), rungR, rungR * 0.82, 2, 8, birth, key, 1.6);
    const col = lin(hex);
    for (let i = before; i < RB.pos.length / 3; i++) RB.col.push(col.r, col.g, col.b);
  };
  const a = new Vector3();
  const b = new Vector3();
  for (const p of line) {
    const pa = place.get(p.id);
    if (!pa) continue;
    const sp = spousesOf.get(p.id) ?? [];
    if (!sp.length) {
      if (big) continue; // big families: no stubs, the ladder stays legible
      // Unpaired base: a short stub toward the axis.
      onCyl(pa.th, pa.y, R, a);
      onCyl(pa.th + GROOVE, pa.y, R, b);
      half(a.clone(), a.clone().lerp(b, 0.24), p.born, p.id, p.color);
      continue;
    }
    for (const q of sp) {
      const pb = place.get(q.id);
      if (!pb) continue;
      const th = pb.th - GROOVE;
      onCyl(th, pb.y, R, a);
      onCyl(pb.th, pb.y, R, b);
      const mid = a.clone().lerp(b, 0.5);
      const yr = spouseYear(M, q);
      half(a.clone(), a.clone().lerp(mid, 0.93), yr, q.id, p.color);
      half(b.clone(), b.clone().lerp(mid, 0.93), yr, q.id, q.color);
    }
  }
  const bases = baseMat(U, big ? 0.25 : 1);
  const baseGeo = withCol(RB);
  group.add(new Mesh(baseGeo, bases.mat));

  // ---- lineage arcs, parent to child ----
  const LB = builder();
  for (const p of line) {
    if (!p.parent || p.virt) continue;
    const pp = place.get(p.parent);
    const pc = place.get(p.id);
    if (!pp || !pc) continue;
    let dth = (pc.th - pp.th) % TAU;
    if (dth > Math.PI) dth -= TAU;
    if (dth < -Math.PI) dth += TAU;
    const curve = new Arc({ th: pp.th, y: pp.y, r: R + out }, dth, { y: pc.y, r: R + out }, R * 0.12 + 0.6);
    tube(LB, curve, big ? 0.08 : 0.065, big ? 0.08 : 0.065, big ? 16 : 28, big ? 4 : 6, p.born, p.id, 1.3);
    for (let i = LB.col.length / 3; i < LB.pos.length / 3; i++) LB.col.push(1, 1, 1);
  }
  const links = linkMat(U);
  const linkGeo = withCol(LB);
  const linkMesh = new Mesh(linkGeo, links.mat);
  linkMesh.renderOrder = 3;
  group.add(linkMesh);

  // ---- generation rings and the axis ----
  const lines: number[] = [];
  const ringR = R + out + R * 0.16 + 1.6;
  for (let g = 1; g < genStart.length; g++) {
    const s = genStart[g];
    if (s == null || s <= 0.5) continue;
    const y = yOf(thOf(s));
    const n = 120;
    for (let k = 0; k < n; k += 2) {
      onCyl((k / n) * TAU, y, ringR, a);
      onCyl(((k + 1) / n) * TAU, y, ringR, b);
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  lines.push(0, yOf(th0), 0, 0, H + P * 0.2, 0);
  const lineMat = new LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
  group.add(
    new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3)), lineMat),
  );

  // ---- motes, plinth and backdrop ----
  const r1 = rng(11);
  const mN = big ? 900 : 520;
  const mp = new Float32Array(mN * 3);
  const mph = new Float32Array(mN);
  const mH = H + P * 1.2;
  for (let i = 0; i < mN; i++) {
    const rr = Math.sqrt(r1()) * (R * 2.4 + 6);
    const th = r1() * TAU;
    mp.set([Math.sin(th) * rr, r1() * mH, Math.cos(th) * rr], i * 3);
    mph[i] = r1() * 100;
  }
  const mg = new BufferGeometry();
  mg.setAttribute('position', new BufferAttribute(mp, 3));
  mg.setAttribute('aPh', new BufferAttribute(mph, 1));
  const motes = moteMat(U, mH);
  const moteMesh = new Points(mg, motes.mat);
  moteMesh.position.y = yOf(th0);
  moteMesh.frustumCulled = false;
  moteMesh.renderOrder = 4;
  group.add(moteMesh);
  const fR = R * 2.3 + 8;
  const floor = floorMat(fR);
  const plinth = new Mesh(new CircleGeometry(fR * 1.25, 96), floor.mat);
  plinth.rotation.x = -Math.PI / 2;
  plinth.position.y = yOf(th0) - P * 0.25;
  group.add(plinth);
  const sky = skyDome(LOOK.dark.top, LOOK.dark.hor, LOOK.dark.ground);
  group.add(sky.mesh);

  const tint = () => {
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    sky.set(L.top, L.hor, L.ground);
    sheath.uni.uTint.value.copy(lin(L.tint));
    sheath.uni.uRim.value.copy(lin(L.rim));
    sheath.uni.uBody.value = L.dark ? 0.03 : 0.22;
    core.uni.uCore.value.copy(lin(L.core));
    core.uni.uGain.value = L.dark ? 1.05 : 0.9;
    bases.uni.uSky.value.copy(lin(L.hor));
    bases.uni.uGlow.value.copy(lin(L.rim));
    links.uni.uGlow.value.copy(lin(L.link));
    links.setAdd(L.dark);
    motes.uni.uCol.value.copy(lin(L.mote));
    motes.setAdd(L.dark);
    floor.uni.uC.value.copy(lin(L.floor));
    floor.uni.uAdd.value = L.dark ? 1 : 0;
    lineMat.color.copy(lin(L.line));
    lineMat.opacity = L.dark ? 0.4 : 0.55;
    ctx.look(L.bloom, L.exposure);
  };

  // Default view: the whole helix, a little from above; RTL looks from the mirrored side.
  const target = new Vector3(0, H * 0.5, 0);
  const dist = (H * 0.5 + P * 0.6 + 4) / Math.tan((21 * Math.PI) / 180);
  const az = 0.42;
  const camAt = (rtl: boolean) =>
    new Vector3((rtl ? -1 : 1) * Math.sin(az) * dist, H * 0.5 + dist * 0.2, Math.cos(az) * dist);
  const view = { target, cam: camAt(ctx.rtl()) };

  return {
    key: 'helix',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    labelScale: 0.86,
    tint,
    hiTargets: [{ geo: baseGeo }, { geo: linkGeo }],
    focus: [sheath.uni.uFocus, core.uni.uFocus, bases.uni.uFocus, links.uni.uFocus],
    view,
    follow: big ? 30 : 27,
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
    },
  };
};
