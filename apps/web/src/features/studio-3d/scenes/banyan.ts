import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { softTex } from '../gl.ts';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { bakeWood, banyanLayout, leafTexture, wood, woodBuilder } from './banyan-geo.ts';
import {
  backdropMat,
  barkMat,
  figMat,
  glowMat,
  groundMat,
  LOOK,
  leafMat,
  lightRig,
  rootletMat,
  setRig,
  stoneMat,
  threadMat,
} from './banyan-mat.ts';
import { fitView, trackPointScale, untone } from './tree-gl.ts';
import type { SceneBuilder } from './types.ts';

// Banyan: the family hangs from the banyan like its aerial roots. The founder hangs just under
// the broad canopy beside the great trunk; each generation hangs a row lower on roots dropping
// from its parents, and every household's own root reaches the ground behind it and thickens over
// the years into a pillar of the grove. Rootlet curtains sway at the back; at night warm lanterns
// hang among the family, by day the light filters green through the leaves onto pale ground.
// A large family hangs in rings right round the trunk instead of in rows.

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);

export const banyanScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const m = ctx.rtl() ? -1 : 1;
  const size = big ? 1.05 : 1.4;
  const disc = size * 2.3 * 0.685;
  const rnd = rng(17);
  const trunkR = disc * (0.62 + 0.3 * Math.log2(1 + M.n / 30));
  // Rings: the founder hangs in front of the trunk, his partners beside him.
  const L = banyanLayout(M, disc, big, trunkR + disc * 0.9);
  const { Hc } = L;
  const root = M.root;
  const pos = new Float32Array(M.n * 3);
  for (let i = 0; i < M.n; i++) pos.set([(L.X[i] ?? 0) * m, L.Y[i] ?? 0, L.Z[i] ?? 0], i * 3);
  const at = (p: StudioPerson) => new Vector3(pos[p.idx * 3], pos[p.idx * 3 + 1], pos[p.idx * 3 + 2]);
  const maxLeaves = Math.max(1, root.leaves);
  // The great trunk stands behind the founder (rows) or at the centre of the rings.
  const zT = L.ring ? 0 : Math.min(...M.people.map((p) => L.Z[p.idx] ?? 0)) - trunkR - disc * 1.4;
  const trunk = new Vector3(0, 0, zT);
  // Canopy footprint: an ellipse over the family with a margin.
  // Rings leave a wider rim outside the family, where the rootlet curtain hangs.
  const cx = L.ring ? L.Rmax + disc * 8 : L.hw + disc * 4;
  const cz = L.ring ? cx : Math.max(L.hd + disc * 4 - zT * 0.5, cx * 0.42);
  const czC = L.ring ? 0 : zT * 0.5;
  const follow = big ? 30 : 24;

  // ---- wood: the great trunk, canopy limbs, the family's hanging roots, household pillars ----
  const W = woodBuilder();
  const radial = big ? 7 : 11;
  const strands = 6;
  const crown = Hc + disc * 0.6;
  for (let k = 0; k < strands; k++) {
    // Fused strands: a banyan trunk is many old roots grown together.
    const phi = (k / strands) * TAU + 0.3;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 7; i++) {
      const s = i / 7;
      const y = -0.5 + s * (crown + 0.5);
      const o = trunkR * (0.42 + 1.1 * Math.exp(-y / 1.1) - 0.18 * s);
      const a = phi + s * 0.9 + Math.sin(s * 5 + k) * 0.06;
      pts.push(new Vector3(trunk.x + Math.cos(a) * o, y, trunk.z + Math.sin(a) * o));
    }
    wood(W, new CatmullRomCurve3(pts), trunkR * 0.46, trunkR * 0.3, 26, radial, {
      birth: root.born - 3 + k * 0.3,
      grow: 3,
      key: root.id,
      thin: 0.5,
      shape: (t) => 1 + 0.7 * Math.exp(-t * 16),
    });
  }
  wood(
    W,
    new CatmullRomCurve3([trunk.clone().setY(-0.5), trunk.clone().setY(crown * 0.5), trunk.clone().setY(crown + 0.4)]),
    trunkR * 0.66,
    trunkR * 0.42,
    16,
    radial,
    { birth: root.born - 3, grow: 3, key: root.id, thin: 0.5 },
  );
  for (let k = 0; k < 9; k++) {
    // Buttress roots snaking over the ground.
    const a = (k / 9) * TAU + rnd() * 0.4;
    const len = trunkR * (2.6 + rnd() * 2.2);
    const c = new CatmullRomCurve3([
      trunk.clone().add(new Vector3(Math.cos(a) * trunkR * 0.6, 1.2, Math.sin(a) * trunkR * 0.6)),
      trunk.clone().add(new Vector3(Math.cos(a + 0.1) * len * 0.45, 0.05, Math.sin(a + 0.1) * len * 0.45)),
      trunk.clone().add(new Vector3(Math.cos(a - 0.05) * len, -0.45, Math.sin(a - 0.05) * len)),
    ]);
    wood(W, c, trunkR * 0.32, 0.05, 12, 7, { birth: root.born - 3, grow: 3, key: '', thin: 0.5 });
  }
  // Canopy limbs: out from the trunk's crown along the underside of the leaves to the footprint's edge.
  const limbN = big ? 14 : 11;
  for (let k = 0; k < limbN; k++) {
    const a = (k / limbN) * TAU + 0.2 + rnd() * 0.25;
    const ex = Math.cos(a) * cx * (0.78 + rnd() * 0.18);
    const ez = czC + Math.sin(a) * cz * (0.78 + rnd() * 0.18);
    const s0 = new Vector3(trunk.x, crown - disc * 0.2, trunk.z);
    const end = new Vector3(ex, Hc + disc * (0.9 + rnd() * 0.6), ez);
    const mid = s0
      .clone()
      .lerp(end, 0.5)
      .add(new Vector3((rnd() - 0.5) * disc * 2, disc * (0.9 + rnd() * 0.6), (rnd() - 0.5) * disc * 2));
    wood(
      W,
      new CatmullRomCurve3([s0, mid, end], false, 'centripetal'),
      trunkR * 0.42,
      disc * 0.12,
      big ? 12 : 18,
      big ? 6 : 8,
      {
        birth: root.born + 2 + k * 1.5,
        grow: 40 + rnd() * 30,
        key: '',
        thin: 0.45,
      },
    );
  }
  const rootR = (leaves: number) => disc * (0.06 + 0.16 * Math.sqrt(leaves / maxLeaves));
  const hang = disc * 0.47;
  {
    // The founder hangs from the trunk's crown.
    const f = at(root);
    const a = new Vector3(trunk.x, crown - disc * 0.4, trunk.z + trunkR * 0.6);
    const b = f.clone().addScaledVector(UP, hang);
    const mid = a
      .clone()
      .lerp(b, 0.5)
      .add(new Vector3(0, disc * 0.3, disc * 0.3));
    wood(W, new CatmullRomCurve3([a, mid, b]), rootR(maxLeaves) * 1.1, rootR(maxLeaves), 12, 8, {
      birth: root.born,
      grow: 1.4,
      key: root.id,
      thin: 0.6,
    });
  }
  const pillars: StudioPerson[] = [];
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    // A child hangs on a root dropping from its parent.
    const par = M.get(p.parent);
    const P = at(par);
    const C = at(p);
    const A = P.clone().addScaledVector(UP, -hang);
    const D = C.clone().addScaledVector(UP, hang);
    const d = D.clone().sub(A);
    const curve = new CatmullRomCurve3(
      [
        A,
        A.clone().add(new Vector3(d.x * 0.12, d.y * 0.42, d.z * 0.2)),
        D.clone().add(new Vector3(-d.x * 0.08, -d.y * 0.22 + disc * 0.25, -d.z * 0.1)),
        D,
      ],
      false,
      'centripetal',
    );
    wood(W, curve, rootR(par.leaves) * 0.9, rootR(p.leaves), big ? 8 : 16, big ? 5 : 7, {
      birth: p.born,
      grow: 1.6,
      key: p.id,
      thin: 0.6,
    });
    if (par.kids[0] === p.id && (big ? par.gen < 2 : par.gen < 3) && par !== root) pillars.push(par);
  }
  // Married-in spouses drop a root of their own from the canopy: a new root that joined the tree.
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const C = at(p);
    const top = new Vector3(C.x + (rnd() - 0.5) * disc, Hc + disc * 0.5, C.z - disc * 0.3);
    const D = C.clone().addScaledVector(UP, hang * 0.9);
    const mid = top
      .clone()
      .lerp(D, 0.5)
      .add(new Vector3((rnd() - 0.5) * disc * 0.4, 0, -disc * 0.2));
    wood(W, new CatmullRomCurve3([top, mid, D]), disc * 0.05, disc * 0.06, big ? 6 : 10, 5, {
      birth: spouseYear(M, p) - 1,
      grow: 3,
      key: p.id,
      thin: 0.7,
    });
  }
  // Household pillars: the first child's arrival sends the parent's root down; it thickens into a trunk.
  const household = (p: StudioPerson) => {
    const first = p.kids.map((k) => M.get(k).born).sort((x, y) => x - y)[0];
    return first != null ? first - 2 : p.born + 24;
  };
  for (const p of pillars) {
    const P = at(p);
    const back = L.ring
      ? new Vector3(P.x, 0, P.z).normalize().multiplyScalar(disc * 1.2)
      : new Vector3(0, 0, -disc * 2.6);
    const x = P.x + back.x + (rnd() - 0.5) * disc * 0.6;
    const z = P.z + back.z;
    const share = Math.sqrt(p.leaves / maxLeaves);
    const r = disc * (0.16 + 0.42 * share) * (big ? 1.2 : 1);
    const pts: Vector3[] = [];
    const seed = rnd() * TAU;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = Hc + disc * 0.8 - t * (Hc + disc * 1.1);
      const wob = Math.sin(t * 6 + seed) * r * 0.3;
      pts.push(new Vector3(x + wob, y, z - wob * 0.5));
    }
    wood(W, new CatmullRomCurve3(pts), r * 0.8, r * 1.05, big ? 10 : 16, big ? 6 : 9, {
      birth: household(p),
      grow: 7,
      key: p.id,
      thin: 0.25,
      shape: (t) => 1 + 0.9 * Math.exp(-(1 - t) * 12),
    });
  }
  const rig = lightRig();
  rig.uCanY.value = Hc + disc * 1.5;
  const barkGeo = bakeWood(W);
  const bark = barkMat(U, rig);
  bark.uni.uThick.value.set(disc * 0.18, disc * 0.4);
  group.add(new Mesh(barkGeo, bark.mat));

  // ---- rootlet curtains at the back and sides of the grove ----
  const RB = woodBuilder();
  const famZ = Math.min(...M.people.map((p) => pos[p.idx * 3 + 2] ?? 0));
  const curtain = big ? 150 : 90;
  for (let k = 0, tries = 0; k < curtain && tries < curtain * 8; tries++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * 0.95;
    const x = Math.cos(a) * cx * rr;
    const z = czC + Math.sin(a) * cz * rr;
    // Keep the curtain off the family: behind it, or beyond its ends.
    if (!L.ring && z > famZ - disc * 1.2 && Math.abs(x) < L.hw + disc * 2) continue;
    if (L.ring && Math.hypot(x, z) < L.Rmax + disc * 2) continue;
    k++;
    const top = new Vector3(x, Hc + disc * (0.3 + rnd() * 0.5), z);
    const long = rnd() < 0.2;
    const len = (Hc + disc) * (long ? 0.75 + rnd() * 0.2 : 0.15 + rnd() * rnd() * 0.55);
    const w = rnd() * TAU;
    wood(
      RB,
      new CatmullRomCurve3([
        top,
        top.clone().add(new Vector3(Math.cos(w) * 0.15, -len * 0.5, Math.sin(w) * 0.15)),
        top.clone().add(new Vector3(Math.cos(w) * 0.3, -len, Math.sin(w) * 0.3)),
      ]),
      disc * 0.035,
      disc * 0.015,
      big ? 3 : 5,
      3,
      { birth: root.born + 10 + rnd() * 40, grow: 5 + rnd() * 5, key: '', thin: 0.6 },
    );
  }
  const rootletGeo = bakeWood(RB);
  const rootlets = rootletMat(U, rig);
  group.add(new Mesh(rootletGeo, rootlets.mat));

  // ---- threads: kalava round the trunk, lantern cords, gold marriage twigs ----
  const TB = woodBuilder();
  const platH = 1.1;
  const kalava: Array<[number, number, number]> = [
    [0.62, 0.04, 0.03],
    [0.85, 0.42, 0.05],
    [0.62, 0.04, 0.03],
    [0.88, 0.84, 0.76],
  ];
  kalava.forEach((col, k) => {
    const pts: Vector3[] = [];
    const turns = 3;
    const y0 = platH + 1.1 + k * 0.12;
    for (let i = 0; i <= turns * 24; i++) {
      const a = (i / 24) * TAU + k;
      pts.push(
        new Vector3(trunk.x + Math.cos(a) * trunkR * 1.17, y0 + (i / 24) * 0.16, trunk.z + Math.sin(a) * trunkR * 1.17),
      );
    }
    wood(TB, new CatmullRomCurve3(pts), 0.05, 0.05, turns * 24, 4, {
      // Tied once the trunk has filled out (it thickens over its first decades), so they never float.
      birth: root.born + 30,
      grow: 2,
      key: '',
      col,
      thin: 1,
    });
  });
  for (const p of M.people) {
    // Gold: a short twig across a marriage.
    if (!p.mi || !p.anchor) continue;
    const a = at(M.get(p.anchor));
    const c = at(p);
    const mid = a
      .clone()
      .lerp(c, 0.5)
      .addScaledVector(UP, disc * 0.28);
    wood(TB, new CatmullRomCurve3([a, mid, c]), disc * 0.04, disc * 0.035, 8, 5, {
      birth: spouseYear(M, p),
      grow: 1,
      key: p.id,
      col: [-1, 0, 0],
      thin: 1,
    });
  }
  // Lanterns hang among the family, clear of every portrait.
  const lanterns: Array<{ p: Vector3; birth: number }> = [];
  const nL = big ? 30 : 16;
  const near = (v: Vector3, r: number) => {
    for (let i = 0; i < M.n; i++) {
      const dx = (pos[i * 3] ?? 0) - v.x;
      const dy = (pos[i * 3 + 1] ?? 0) - v.y;
      const dz = (pos[i * 3 + 2] ?? 0) - v.z;
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    return false;
  };
  for (let tries = 0; lanterns.length < nL && tries < nL * 40; tries++) {
    const p = M.people[Math.floor(rnd() * M.n)];
    if (!p) continue;
    const c = at(p);
    const v = c
      .clone()
      .add(new Vector3((rnd() - 0.5) * disc * 3, disc * (0.6 + rnd() * 1.4), -disc * (0.4 + rnd() * 0.8)));
    if (v.y > Hc - disc * 0.6 || near(v, disc * 1.15) || lanterns.some((l) => l.p.distanceTo(v) < disc * 2)) continue;
    lanterns.push({ p: v, birth: p.born + 6 });
    wood(
      TB,
      new CatmullRomCurve3([new Vector3(v.x, Hc + disc * 0.4, v.z), v.clone().addScaledVector(UP, disc * 0.3)]),
      0.02,
      0.02,
      2,
      3,
      { birth: p.born + 5, grow: 1, key: '', col: [0.16, 0.13, 0.11], thin: 1 },
    );
  }
  const threads = threadMat(U, rig);
  const threadGeo = bakeWood(TB);
  group.add(new Mesh(threadGeo, threads.mat));

  // ---- the stone chabutro round the trunk's foot ----
  const Rp = trunkR * 2.7;
  const prof = [
    [0.01, 0],
    [Rp, 0],
    [Rp, 0],
    [Rp, 0.6],
    [Rp, 0.6],
    [Rp * 0.84, 0.6],
    [Rp * 0.84, 0.6],
    [Rp * 0.84, platH],
    [Rp * 0.84, platH],
    [0.01, platH],
  ].map(([x, y]) => new Vector2(x, (y ?? 0) - 0.35));
  const stone = stoneMat(U, rig);
  stone.uni.uBandY.value = 0.6 - 0.35 - 0.16;
  stone.uni.uCentre.value.set(trunk.x, trunk.z);
  const plat = new Mesh(new LatheGeometry(prof, big ? 48 : 64), stone.mat);
  plat.position.set(trunk.x, 0, trunk.z);
  group.add(plat);

  // ---- leaves: one instanced mesh of clumps over the canopy's footprint ----
  const tex = leafTexture();
  const ls = big ? 1.25 : 0.82;
  const leafGeo = new PlaneGeometry(0.72 * ls, 1.1 * ls);
  leafGeo.translate(0, 0.5 * ls, 0);
  type Clump = { c: Vector3; rx: number; ry: number; n: number; birth: number; death: number; key: string };
  const clumps: Clump[] = [];
  const layerH = big ? 1.9 : 1.4;
  const owners = M.people.filter((p) => !p.mi);
  const nearest = (x: number, z: number) => {
    let best: StudioPerson = root;
    let bd = Number.POSITIVE_INFINITY;
    for (const p of owners) {
      const dd = ((pos[p.idx * 3] ?? 0) - x) ** 2 + (((pos[p.idx * 3 + 2] ?? 0) - z) * 0.5) ** 2;
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    return best;
  };
  const mound = (x: number, z: number) =>
    Math.max(0, Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) * 0.6 + Math.sin(x * 0.07 - z * 0.09) * 0.5);
  const step = big ? 6.5 : 3.1;
  for (let x = -cx; x <= cx; x += step)
    for (let z = czC - cz; z <= czC + cz; z += step) {
      const px = x + (rnd() - 0.5) * step * 0.9;
      const pz = z + (rnd() - 0.5) * step * 0.9;
      const e = Math.hypot(px / cx, (pz - czC) / cz);
      if (e > 1) continue;
      const own = nearest(px, pz);
      const dome = (1 - e * e) * disc * 1.6;
      clumps.push({
        c: new Vector3(px, Hc + disc * 0.9 + layerH + dome + mound(px, pz) * layerH * 1.4, pz),
        rx: step * 0.78,
        ry: layerH * (0.9 + mound(px, pz) * 0.8),
        n: big ? 16 : 26,
        birth: Math.max(root.born, own.born) + 1 + rnd() * 2 - (1 - e) * 4,
        death: own.died ?? 9999,
        key: own.id,
      });
    }
  const count = clumps.reduce((s, c) => s + c.n, 0);
  const iB = new Float32Array(count);
  const iD = new Float32Array(count);
  const iP = new Float32Array(count);
  const iV = new Float32Array(count);
  const iA = new Float32Array(count);
  const iN = new Float32Array(count * 3);
  const keys: string[] = [];
  const figs: number[] = [];
  const figB: number[] = [];
  const figV: number[] = [];
  const leaf = leafMat(U, rig, tex);
  rig.uNear.value.set(follow * 0.6, follow);
  const leaves = new InstancedMesh(leafGeo, leaf.mat, Math.max(1, count));
  const mtx = new Matrix4();
  const q = new Quaternion();
  const roll = new Quaternion();
  const sc = new Vector3();
  const d = new Vector3();
  const Z = new Vector3(0, 0, 1);
  let li = 0;
  for (const cl of clumps) {
    for (let k = 0; k < cl.n; k++, li++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * TAU;
      const s = Math.sqrt(1 - u * u);
      d.set(s * Math.cos(a), u * 0.8 + 0.2, s * Math.sin(a)).normalize();
      const reach = 0.4 + 0.6 * Math.cbrt(rnd());
      const P = cl.c.clone().add(new Vector3(d.x * cl.rx * reach, d.y * cl.ry * reach, d.z * cl.rx * reach));
      const n = d
        .clone()
        .add(new Vector3(0, 0.35, 0))
        .normalize();
      q.setFromUnitVectors(Z, n);
      roll.setFromAxisAngle(Z, rnd() * TAU);
      q.multiply(roll);
      const s2 = 0.75 + rnd() * 0.55;
      sc.set(s2, s2, s2);
      mtx.compose(P, q, sc);
      leaves.setMatrixAt(li, mtx);
      iB[li] = cl.birth + 0.6 + rnd() * 1.4;
      iD[li] = cl.death + rnd() * 2;
      iP[li] = rnd() * 100;
      iV[li] = rnd();
      iA[li] = reach * (0.55 + 0.45 * Math.max(0, n.y));
      iN.set([n.x, n.y, n.z], li * 3);
      keys.push(cl.key);
      if (rnd() < 0.015) {
        figs.push(P.x, P.y - 0.2, P.z);
        figB.push(cl.birth + 3 + rnd() * 6);
        figV.push(rnd());
      }
    }
  }
  const ia = (arr: Float32Array, k: number) => new InstancedBufferAttribute(arr, k);
  leafGeo.setAttribute('aBirth', ia(iB, 1));
  leafGeo.setAttribute('aDeath', ia(iD, 1));
  leafGeo.setAttribute('aPhase', ia(iP, 1));
  leafGeo.setAttribute('aVar', ia(iV, 1));
  leafGeo.setAttribute('aAO', ia(iA, 1));
  leafGeo.setAttribute('aN', ia(iN, 3));
  leafGeo.setAttribute('aHi', ia(new Float32Array(count), 1));
  leafGeo.userData.keys = keys;
  leaves.count = count;
  leaves.frustumCulled = false;
  group.add(leaves);

  const fg = new BufferGeometry();
  fg.setAttribute('position', new BufferAttribute(new Float32Array(figs), 3));
  fg.setAttribute('aBirth', new BufferAttribute(new Float32Array(figB), 1));
  fg.setAttribute('aVar', new BufferAttribute(new Float32Array(figV), 1));
  const fig = figMat(U, rig);
  const figPts = new Points(fg, fig.mat);
  trackPointScale(figPts, fig.uni.uPx);
  figPts.frustumCulled = false;
  group.add(figPts);

  // ---- glows: fireflies (night) or motes (day), diya flames on the platform, the lanterns ----
  const gN = big ? 160 : 90;
  const nDiya = 9;
  const total = gN + nDiya + lanterns.length;
  const gp = new Float32Array(total * 3);
  const gph = new Float32Array(total);
  const gk = new Float32Array(total);
  const gb = new Float32Array(total);
  for (let i = 0; i < gN; i++) {
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd());
    gp.set([Math.cos(a) * cx * r, 1 + rnd() * (Hc - 1), czC + Math.sin(a) * cz * r], i * 3);
    gph[i] = rnd() * 60;
    gb[i] = -9999;
  }
  for (let k = 0; k < nDiya; k++) {
    const a = (k / nDiya) * TAU + 0.2;
    gp.set([trunk.x + Math.cos(a) * Rp * 0.93, 0.6 - 0.35 + 0.25, trunk.z + Math.sin(a) * Rp * 0.93], (gN + k) * 3);
    gph[gN + k] = rnd() * 60;
    gk[gN + k] = 1;
    gb[gN + k] = -9999;
  }
  lanterns.forEach((l, k) => {
    const i = gN + nDiya + k;
    gp.set(l.p.toArray(), i * 3);
    gph[i] = rnd() * 60;
    gk[i] = 2;
    gb[i] = l.birth;
  });
  const gg = new BufferGeometry();
  gg.setAttribute('position', new BufferAttribute(gp, 3));
  gg.setAttribute('aPh', new BufferAttribute(gph, 1));
  gg.setAttribute('aKind', new BufferAttribute(gk, 1));
  gg.setAttribute('aBirth', new BufferAttribute(gb, 1));
  const glow = glowMat(
    U,
    softTex([
      [0, 'rgba(255,255,255,1)'],
      [0.22, 'rgba(255,255,255,0.65)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  const glowPts = new Points(gg, glow.mat);
  trackPointScale(glowPts, glow.uni.uPx);
  glowPts.frustumCulled = false;
  glowPts.renderOrder = 5;
  group.add(glowPts);

  // ---- ground and backdrop ----
  const ground = groundMat(rig, U, new Vector3(trunk.x, trunk.z, trunkR));
  const floor = new Mesh(new CircleGeometry(Math.max(900, cx * 10), 96), ground.mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  group.add(floor);
  const back = backdropMat();
  const dome = new Mesh(new SphereGeometry(2500, 24, 12), back.mat);
  dome.renderOrder = -2;
  group.add(dome);

  // ---- the canopy's shadow follows the family as it spreads ----
  const can = new Vector2(cx, cz);
  let lastT = U.uTime.value;
  rig.uCan.value.copy(can);
  const yearHook = (yr: number) => {
    let w = trunkR * 4;
    let dpt = trunkR * 4;
    for (const p of M.people) {
      if (p.born > yr) continue;
      w = Math.max(w, Math.abs(pos[p.idx * 3] ?? 0) + disc * 4);
      dpt = Math.max(dpt, Math.abs((pos[p.idx * 3 + 2] ?? 0) - czC) + disc * 4);
    }
    can.set(Math.min(cx, w), Math.min(cz, Math.max(dpt, L.ring ? w : w * 0.42)));
  };

  // ---- default view: rows from the front, a little below their middle looking up into the canopy; rings from a little above ----
  const frame: Vector3[] = M.people.map((p) => at(p));
  frame.push(new Vector3(trunk.x, 0.2, trunk.z));
  // The canopy's near edge closes the top of the frame like a ceiling.
  if (!L.ring) for (const f of [-0.7, 0, 0.7]) frame.push(new Vector3(f * cx, Hc + disc * 1.2, czC + cz * 0.55));
  const az = L.ring ? 0.45 * m : 0.1 * m;
  // Rings: 14 degrees looks a little down on them while the eye stays under the leaves.
  const el = ((L.ring ? 14 : -1) * Math.PI) / 180;
  const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const fit = fitView(frame, disc * 1.1, dir, 1.45, 0.86);
  const view = { target: fit.target, cam: fit.cam };
  const dist = view.cam.distanceTo(view.target);

  const tint = () => {
    const lk = ctx.dark() ? LOOK.dark : LOOK.light;
    const flat = (hex: string) => untone(hex, lk.exposure);
    setRig(rig, lk, lin, flat);
    rig.uFogNear.value = dist * 1.1;
    rig.uFogFar.value = dist * 3.6;
    bark.uni.uBarkA.value.copy(lin(lk.barkA));
    bark.uni.uBarkB.value.copy(lin(lk.barkB));
    bark.uni.uMoss.value.copy(lin(lk.moss));
    rootlets.uni.uRootA.value.copy(lin(lk.rootA));
    rootlets.uni.uRootB.value.copy(lin(lk.rootB));
    leaf.uni.uLeafA.value.copy(lin(lk.leafA));
    leaf.uni.uLeafB.value.copy(lin(lk.leafB));
    leaf.uni.uVein.value.copy(lin(lk.vein));
    leaf.uni.uOld.value.copy(lin(lk.old));
    ground.uni.uSoil.value.copy(lk.dark ? lin(lk.soil) : flat(lk.soil));
    ground.uni.uSoil2.value.copy(lk.dark ? lin(lk.soil2) : flat(lk.soil2));
    ground.uni.uGrass.value.copy(lk.dark ? lin(lk.grass) : flat(lk.grass));
    stone.uni.uStoneA.value.copy(lin(lk.stoneA));
    stone.uni.uStoneB.value.copy(lin(lk.stoneB));
    fig.uni.uFig.value.copy(lin(lk.fig));
    glow.uni.uFly.value.copy(lin(lk.fly));
    glow.uni.uFlame.value.copy(lin(lk.flame));
    glow.uni.uLantern.value.copy(lin(lk.lantern));
    glow.setAdd(lk.dark);
    back.uni.uTop.value.copy(flat(lk.top));
    back.uni.uHor.value.copy(flat(lk.hor));
    ctx.look(lk.bloom, lk.exposure);
  };
  tint();

  return {
    key: 'banyan',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    labelScale: 0.88,
    tint,
    hiTargets: [{ geo: barkGeo }, { geo: threadGeo }, { geo: leafGeo, perPerson: true }],
    focus: [rig.uFocus],
    view,
    follow,
    yearHook,
    update: () => {
      // Ease by elapsed time (the scene has no frame delta), so the shadow grows alike at any refresh rate.
      const t = U.uTime.value;
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      rig.uCan.value.lerp(can, 1 - Math.exp(-dt * 3));
    },
  };
};
