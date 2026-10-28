import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  Vector3,
} from 'three';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, NOW, rng } from '../palette.ts';
import { sizeFactor } from '../portraits.ts';
import {
  backdrop,
  inkBuilder,
  inkGeometry,
  inkLine,
  inkLineMat,
  makeTone,
  recolourInk,
  setInk,
  setTone,
} from './galaxy-gl.ts';
import { floorMat, LOOK, moteMat, ribbonMat, slabMat } from './helix-mat.ts';
import type { SceneBuilder } from './types.ts';

// Family Helix: one right-handed double helix of constant pitch. People born into the family sit in
// lineage order along strand A, generation after generation, so the generations climb; each partner sits
// opposite on strand B and the couple is a base pair: two slabs meeting in gold hydrogen bonds (a
// marriage). Unpaired people are single bases. The base pairs take a restrained ramp of colour from the
// oldest generation to the youngest; parent-to-child links are fine arcs bowing outward across the turns.
// The backbones are flat ribbons, like a structural-biology cartoon, banded at each nucleotide.

const TAU = Math.PI * 2;
/** Angle between the strands: unequal grooves like B-DNA, so the base pairs miss the axis. */
const GROOVE = Math.PI * 0.8;

/** Point on a cylinder of radius r around the vertical axis (right-handed as θ grows upward). */
const onCyl = (th: number, y: number, r: number, out = new Vector3()) => out.set(r * Math.sin(th), y, r * Math.cos(th));

interface Lit {
  pos: number[];
  nor: number[];
  t: number[];
  birth: number[];
  grow: number[];
  g: number[];
  kind: number[];
  key: string[];
  idx: number[];
}

const lit = (): Lit => ({ pos: [], nor: [], t: [], birth: [], grow: [], g: [], kind: [], key: [], idx: [] });

function bakeLit(B: Lit) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(B.nor, 3));
  g.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  g.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  g.setAttribute('aGrow', new Float32BufferAttribute(B.grow, 1));
  g.setAttribute('aG', new Float32BufferAttribute(B.g, 1));
  g.setAttribute('aKind', new Float32BufferAttribute(B.kind, 1));
  g.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.t.length), 1));
  g.setIndex(B.idx);
  g.userData.keys = B.key;
  return g;
}

const X = new Vector3();
const Y = new Vector3();
const Z = new Vector3();
const F = new Vector3();
const E1 = new Vector3();
const E2 = new Vector3();
/** A flat slab (base) from a to b: horizontal, `w` wide and `h` thick; aT runs 0 at a to 1 at b. */
function slab(
  B: Lit,
  a: Vector3,
  b: Vector3,
  w: number,
  h: number,
  birth: number,
  grow: number,
  key: string,
  gen: number,
  kind: number,
) {
  X.subVectors(b, a);
  const L = X.length();
  if (L < 1e-4) return;
  X.divideScalar(L);
  Y.set(0, 1, 0).addScaledVector(X, -X.y).normalize();
  Z.crossVectors(X, Y).normalize();
  // Six faces: [normal axis, sign], with the four corners of each face.
  const faces: Array<[Vector3, number]> = [
    [Y, 1],
    [Y, -1],
    [Z, 1],
    [Z, -1],
    [X, 1],
    [X, -1],
  ];
  for (const [axis, sgn] of faces) {
    const base = B.pos.length / 3;
    F.copy(axis).multiplyScalar(sgn);
    const corners: Array<[number, number, number]> =
      axis === Y
        ? [
            [0, sgn, -1],
            [1, sgn, -1],
            [1, sgn, 1],
            [0, sgn, 1],
          ]
        : axis === Z
          ? [
              [0, -1, sgn],
              [1, -1, sgn],
              [1, 1, sgn],
              [0, 1, sgn],
            ]
          : [
              [sgn > 0 ? 1 : 0, -1, -1],
              [sgn > 0 ? 1 : 0, 1, -1],
              [sgn > 0 ? 1 : 0, 1, 1],
              [sgn > 0 ? 1 : 0, -1, 1],
            ];
    for (const [sx, sy, sz] of corners) {
      B.pos.push(
        a.x + X.x * L * sx + Y.x * (h / 2) * sy + Z.x * (w / 2) * sz,
        a.y + X.y * L * sx + Y.y * (h / 2) * sy + Z.y * (w / 2) * sz,
        a.z + X.z * L * sx + Y.z * (h / 2) * sy + Z.z * (w / 2) * sz,
      );
      B.nor.push(F.x, F.y, F.z);
      B.t.push(sx);
      B.birth.push(birth);
      B.grow.push(grow);
      B.g.push(gen);
      B.kind.push(kind);
      B.key.push(key);
    }
    // Wind each face so its front faces outward (checked against the face's own normal).
    const p0 = base * 3;
    E1.set(
      (B.pos[p0 + 3] ?? 0) - (B.pos[p0] ?? 0),
      (B.pos[p0 + 4] ?? 0) - (B.pos[p0 + 1] ?? 0),
      (B.pos[p0 + 5] ?? 0) - (B.pos[p0 + 2] ?? 0),
    );
    E2.set(
      (B.pos[p0 + 6] ?? 0) - (B.pos[p0] ?? 0),
      (B.pos[p0 + 7] ?? 0) - (B.pos[p0 + 1] ?? 0),
      (B.pos[p0 + 8] ?? 0) - (B.pos[p0 + 2] ?? 0),
    );
    if (E1.cross(E2).dot(F) < 0) B.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
  const out = 0.95 + size * 0.15; // portraits sit just outside the backbone

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
  const genT = (g: number) => (M.maxGen > 0 ? g / M.maxGen : 0);

  // ---- backbones: two flat ribbons; each stretch appears once the people beside it are born ----
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
  const perTurn = big ? 72 : 112;
  const steps = Math.ceil(((th1 - th0) / TAU) * perTurn);
  const ribW = big ? 0.62 : 0.95;
  const ribH = big ? 0.2 : 0.3;
  const radial = big ? 10 : 16;
  // Superellipse profile (a flat band with rounded edges): offsets across (x) and outward (y), and normals.
  const prof: Array<[number, number, number, number]> = [];
  for (let j = 0; j <= radial; j++) {
    const a = (j / radial) * TAU;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const nx = Math.sign(cs) * Math.abs(cs) ** 1.5 * ribH;
    const ny = Math.sign(sn) * Math.abs(sn) ** 1.5 * ribW;
    const l = Math.hypot(nx, ny) || 1;
    prof.push([
      Math.sign(cs) * Math.abs(cs) ** 0.5 * (ribW / 2),
      Math.sign(sn) * Math.abs(sn) ** 0.5 * (ribH / 2),
      nx / l,
      ny / l,
    ]);
  }
  const RB = lit();
  const C = new Vector3();
  const T = new Vector3();
  const N = new Vector3();
  const Bn = new Vector3();
  const ribbon = (off: number) => {
    const base = RB.pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const th = th0 + ((th1 - th0) * i) / steps;
      const a = th + off;
      onCyl(a, yOf(th), R, C);
      N.set(Math.sin(a), 0, Math.cos(a));
      T.set(R * Math.cos(a), P / TAU, -R * Math.sin(a)).normalize();
      Bn.crossVectors(T, N).normalize();
      const birth = birthAt(th);
      for (const [px, py, nx, ny] of prof) {
        RB.pos.push(C.x + Bn.x * px + N.x * py, C.y + Bn.y * px + N.y * py, C.z + Bn.z * px + N.z * py);
        RB.nor.push(Bn.x * nx + N.x * ny, Bn.y * nx + N.y * ny, Bn.z * nx + N.z * ny);
        RB.t.push(th / TAU);
        RB.birth.push(birth);
        RB.grow.push(1);
        RB.g.push(0);
        RB.kind.push(0);
        RB.key.push('');
      }
    }
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        RB.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  };
  ribbon(0);
  ribbon(GROOVE);
  const T0 = makeTone();
  const rib = ribbonMat(U, T0);
  // One faint band per nucleotide (person slot) along the strand.
  rib.uni.uBands.value = (TAU * c) / gap;
  const ribMesh = new Mesh(bakeLit(RB), rib.mat);
  ribMesh.renderOrder = 3;

  // ---- base pairs: slabs from each strand towards the axis, gold hydrogen bonds between partners ----
  const SB = lit();
  const sw = big ? 0.5 : 0.82;
  const sh = big ? 0.14 : 0.2;
  const a = new Vector3();
  const b = new Vector3();
  const m0 = new Vector3();
  const m1 = new Vector3();
  const off = new Vector3();
  const side = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (const p of line) {
    const pa = place.get(p.id);
    if (!pa) continue;
    const sp = spousesOf.get(p.id) ?? [];
    if (!sp.length) {
      if (big) continue; // big families: no single bases, the ladder stays legible
      onCyl(pa.th, pa.y, R, a);
      onCyl(pa.th + GROOVE, pa.y, R, b);
      slab(SB, a.clone(), a.clone().lerp(b, 0.27), sw, sh, p.born, 1.4, p.id, genT(p.gen), 0);
      continue;
    }
    for (const q of sp) {
      const pb = place.get(q.id);
      if (!pb) continue;
      onCyl(pb.th - GROOVE, pb.y, R, a);
      onCyl(pb.th, pb.y, R, b);
      const yr = spouseYear(M, q);
      m0.copy(a).lerp(b, 0.43);
      m1.copy(a).lerp(b, 0.57);
      slab(SB, a.clone(), m0.clone(), sw, sh, yr, 1.6, q.id, genT(p.gen), 0);
      slab(SB, b.clone(), m1.clone(), sw, sh, yr, 1.6, q.id, genT(p.gen), 1);
      // Two hydrogen bonds across the gap, side by side.
      side.subVectors(b, a).normalize().cross(up).normalize();
      for (const s of [-0.24, 0.24]) {
        off.copy(side).multiplyScalar(sw * s);
        slab(SB, m0.clone().add(off), m1.clone().add(off), sw * 0.12, sh * 0.55, yr + 1.2, 0.8, q.id, genT(p.gen), 2);
      }
    }
  }
  const slabGeo = bakeLit(SB);
  const slabs = slabMat(U, T0);
  const slabMesh = new Mesh(slabGeo, slabs.mat);
  slabMesh.renderOrder = 2;

  // ---- ink: lineage arcs bowing outward, generation rings and the axis ----
  const IB = inkBuilder();
  const kinds: number[] = [];
  const mark = (k: number) => {
    while (kinds.length < IB.t.length) kinds.push(k);
  };
  const white = lin('#ffffff');
  const medalR = (p: StudioPerson) => size * sizeFactor(p) * 1.15 * 0.72;
  const bow = big ? R * 0.06 + 0.6 : R * 0.12 + 0.6;
  const pp = new Vector3();
  const pc = new Vector3();
  for (const p of line) {
    if (!p.parent || p.virt) continue;
    const qa = place.get(p.parent);
    const qb = place.get(p.id);
    if (!qa || !qb) continue;
    let dth = (qb.th - qa.th) % TAU;
    if (dth > Math.PI) dth -= TAU;
    if (dth < -Math.PI) dth += TAU;
    onCyl(qa.th, qa.y, R + out, pp);
    onCyl(qb.th, qb.y, R + out, pc);
    const ta = medalR(M.get(p.parent));
    const tb = medalR(p);
    const n = big ? 14 : 30;
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = t * t * (3 - 2 * t);
      const q = onCyl(qa.th + dth * t, qa.y + (qb.y - qa.y) * s, R + out + bow * Math.sin(Math.PI * t));
      if (q.distanceTo(pp) < ta || q.distanceTo(pc) < tb) continue;
      pts.push(q);
    }
    if (pts.length > 1) inkLine(IB, pts, p.born, p.id, white, 1, 1);
    mark(0);
  }
  const ringR = R + out + bow + 1.6;
  for (let g = 1; g < genStart.length; g++) {
    const s = genStart[g];
    if (s == null || s <= 0.5) continue;
    const y = yOf(thOf(s));
    const pts: Vector3[] = [];
    for (let k = 0; k <= 160; k++) pts.push(onCyl((k / 160) * TAU, y, ringR));
    const first = line.find((p) => p.gen >= g);
    inkLine(IB, pts, first ? first.born - 1 : M.minYear, '', white, 1, 0.9, 0.9);
    mark(1);
  }
  inkLine(IB, [new Vector3(0, yOf(th0), 0), new Vector3(0, H + P * 0.2, 0)], M.minYear - 10, '', white, 1, 0.8, 0.7);
  mark(1);
  const inkGeo = inkGeometry(IB);
  const inkKinds = Uint8Array.from(kinds);
  const arcs = inkLineMat(U, T0);
  arcs.uni.uWidth.value = big ? 1 : 1.25;
  const arcMesh = new Mesh(inkGeo, arcs.mat);
  arcMesh.frustumCulled = false;
  arcMesh.renderOrder = 4;

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
  const motes = moteMat(U, T0, mH);
  const moteMesh = new Points(mg, motes.mat);
  moteMesh.position.y = yOf(th0);
  moteMesh.frustumCulled = false;
  moteMesh.renderOrder = 5;
  const fR = R * 2.3 + 8;
  const floor = floorMat(T0, fR, R);
  const plinth = new Mesh(new CircleGeometry(fR * 1.1, 128), floor.mat);
  plinth.rotation.x = -Math.PI / 2;
  plinth.position.y = yOf(th0) - P * 0.25;
  plinth.renderOrder = 1;
  group.add(backdrop(T0), plinth, slabMesh, ribMesh, arcMesh, moteMesh);

  const tint = () => {
    const dark = ctx.dark();
    const L = dark ? LOOK.dark : LOOK.light;
    setTone(T0, !dark, L.exposure, L.paperC, L.paperE);
    rib.uni.uGlass.value.copy(lin(L.glass));
    rib.uni.uRim.value.copy(lin(L.rim));
    rib.uni.uInkC.value.copy(lin(L.ink));
    rib.setLight(!dark);
    slabs.uni.uR0.value.copy(lin(L.ramp[0]));
    slabs.uni.uR1.value.copy(lin(L.ramp[1]));
    slabs.uni.uR2.value.copy(lin(L.ramp[2]));
    slabs.uni.uGold.value.copy(lin(L.gold));
    slabs.uni.uTeal.value.copy(lin(L.teal));
    setInk(arcs.mat, !dark);
    arcs.uni.uHi.value.copy(lin(L.teal));
    arcs.uni.uGlow.value = L.glow;
    arcs.uni.uDim.value = dark ? 0.18 : 0.26;
    const arcC = lin(L.arc);
    const ringC = lin(L.ring);
    // Big families: hundreds of arcs would weave a curtain, so each one is fainter (the lineage stays full strength).
    const arcA = L.arcA * (big ? (dark ? 0.6 : 0.42) : 1);
    recolourInk(inkGeo, inkKinds, (k) => (k === 1 ? [ringC, L.ringA] : [arcC, arcA]));
    floor.uni.uFloor.value.copy(lin(L.floor));
    floor.uni.uLine.value.copy(lin(L.floorLine));
    floor.uni.uShadow.value.copy(lin(L.shadow));
    floor.setLight(!dark);
    motes.uni.uCol.value.copy(lin(L.mote));
    motes.setLight(!dark);
    ctx.look(L.bloom, L.exposure);
  };

  // Default view: the whole helix, a little from above; Arabic looks from the mirrored side.
  const target = new Vector3(0, H * 0.48, 0);
  const dist = (H * 0.5 + P * 0.55 + 3) / Math.tan((21 * Math.PI) / 180) / 1.12;
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
    hiTargets: [{ geo: slabGeo }, { geo: inkGeo }],
    focus: [rib.uni.uFocus, slabs.uni.uFocus, arcs.uni.uFocus],
    view,
    follow: big ? 30 : 27,
  };
};
