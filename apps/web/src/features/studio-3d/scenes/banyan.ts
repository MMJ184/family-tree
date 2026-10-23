import {
  AdditiveBlending,
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
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import { skyDome, softTex } from '../gl.ts';
import { type StudioPerson, spouseIndex, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { bakeWood, leafTexture, wood, woodBuilder } from './banyan-geo.ts';
import {
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
import type { SceneBuilder } from './types.ts';

// Banyan: the founder is the great central trunk under a broad, low canopy. Every household
// (anyone with children) drops an aerial prop-root from the canopy that thickens over the
// years into its own pillar; a son's pillar is a full secondary trunk holding up his part of
// the canopy, and his descendants sit in the canopy above it. Limbs spread outward generation
// by generation, rootlet curtains hang from them, and spouses sit beside their partner.

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);

export const banyanScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const size = big ? 1.05 : 1.4;
  const spread = Math.max(1, Math.sqrt(M.n / 30));
  const maxGen = Math.max(1, M.maxGen);
  const maxLeaves = Math.max(1, M.root.leaves);
  const rnd = rng(17);
  const follow = big ? 30 : 22;

  // ---- layout: a low dome; generations ring outward, each line inside its own sector ----
  const gap = big ? 3.4 : 4.4;
  const Rmax = Math.max(12 + maxGen * 8.5, (maxLeaves * gap) / TAU);
  const Rg = (g: number) => (g <= 0 ? 0 : Rmax * (g / maxGen) ** 0.8);
  const Hc = Math.max(12.5 * spread ** 0.62, Rmax * (big ? 0.3 : 0.17));
  const dome = Math.max(4.5 + 2.2 * spread ** 0.8, Rmax * (big ? 0.14 : 0.1));
  const yAt = (r: number) => Hc + dome * (1 - Math.min(1, r / (Rmax + 4)) ** 1.5);
  const trunkR = 1.25 + 0.55 * spread;
  const th0 = 0.35 * Math.PI;

  const node = new Map<string, Vector3>();
  const nodeOf = (id: string | null | undefined) => (id ? node.get(id) : undefined) ?? new Vector3(0, yAt(0), 0);
  for (const p of M.people) {
    if (p.mi) continue;
    const r = Rg(p.gen);
    const th = th0 + p.ang * TAU;
    const j = (rnd() - 0.5) * 1.2;
    node.set(p.id, new Vector3(Math.cos(th) * r, yAt(r) + (p.gen ? j : 0), Math.sin(th) * r));
  }
  for (const p of M.people) {
    if (!p.mi) continue;
    const a = nodeOf(p.anchor);
    const out = new Vector3(a.x, 0, a.z);
    if (out.lengthSq() < 0.01) out.set(Math.cos(th0), 0, Math.sin(th0));
    out.normalize();
    const tan = new Vector3(-out.z, 0, out.x);
    const k = p.anchor ? spouseIndex(M, p) : 0;
    const side = k % 2 ? -1 : 1;
    node.set(
      p.id,
      a
        .clone()
        .addScaledVector(tan, side * (size * 2.05 + Math.floor(k / 2) * size * 1.9))
        .addScaledVector(out, size * 0.35)
        .add(new Vector3(0, -size * 0.45, 0)),
    );
  }
  // Portraits hang just under their limb; the leaves form a ceiling above, seen from below.
  const hang = size * 1.2;
  // The founder sits on top of the trunk, where the limbs fan out just below.
  const joint = (id: string | null | undefined) =>
    nodeOf(id)
      .clone()
      .add(new Vector3(0, id === M.root.id ? -hang * 1.45 : hang, 0));
  const pos = new Float32Array(M.n * 3);
  M.people.forEach((p, i) => {
    const v = nodeOf(p.id);
    pos.set([v.x, v.y, v.z], i * 3);
  });

  // ---- wood: central trunk, limbs, prop-root pillars ----
  const W = woodBuilder();
  const root = M.root;
  const trunkTop = joint(root.id).y;
  const radial = big ? 7 : 11;
  const strands = 6;
  for (let k = 0; k < strands; k++) {
    // Fused strands: a banyan trunk is many old roots grown together.
    const phi = (k / strands) * TAU + 0.3;
    const pts: Vector3[] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const y = -0.5 + s * (trunkTop + 0.5);
      const o = trunkR * (0.42 + 1.1 * Math.exp(-y / 1.1) - 0.18 * s);
      const a = phi + s * 0.9 + Math.sin(s * 5 + k) * 0.06;
      pts.push(new Vector3(Math.cos(a) * o, y, Math.sin(a) * o));
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
    new CatmullRomCurve3([
      new Vector3(0, -0.5, 0),
      new Vector3(0.1, trunkTop * 0.5, -0.1),
      new Vector3(0, trunkTop + 0.4, 0),
    ]),
    trunkR * 0.66,
    trunkR * 0.42,
    16,
    radial,
    { birth: root.born - 3, grow: 3, key: root.id, thin: 0.5 },
  );
  for (let k = 0; k < 9; k++) {
    // Buttress roots snaking over the ground.
    const a = (k / 9) * TAU + rnd() * 0.4;
    const L = trunkR * (2.6 + rnd() * 2.2);
    const curve = new CatmullRomCurve3([
      new Vector3(Math.cos(a) * trunkR * 0.6, 1.2, Math.sin(a) * trunkR * 0.6),
      new Vector3(Math.cos(a + 0.1) * L * 0.45, 0.05, Math.sin(a + 0.1) * L * 0.45),
      new Vector3(Math.cos(a - 0.05) * L, -0.45, Math.sin(a - 0.05) * L),
    ]);
    wood(W, curve, trunkR * 0.32, 0.05, 12, 7, { birth: root.born - 3, grow: 3, key: '', thin: 0.5 });
  }

  const limbR = (leaves: number) => (0.2 + 0.85 * Math.sqrt(leaves / maxLeaves)) * (big ? 1.5 : 1);
  const limbs: Array<{ curve: CatmullRomCurve3; p: StudioPerson; len: number }> = [];
  const limbOf = new Map<string, CatmullRomCurve3>();
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const a = joint(p.parent);
    const c = joint(p.id);
    const d = c.clone().sub(a);
    const len = d.length();
    // Organic limbs: rise out of the joint, wander sideways, settle onto the child.
    const side = new Vector3().crossVectors(d, UP).normalize();
    const w1 = (rnd() - 0.5) * len * 0.22;
    const w2 = (rnd() - 0.5) * len * 0.16;
    const curve = new CatmullRomCurve3(
      [
        a.clone(),
        a
          .clone()
          .addScaledVector(d, 0.28)
          .addScaledVector(side, w1)
          .addScaledVector(UP, 0.5 + len * 0.06),
        a
          .clone()
          .addScaledVector(d, 0.66)
          .addScaledVector(side, w2)
          .addScaledVector(UP, 0.3 + len * 0.035),
        c.clone(),
      ],
      false,
      'centripetal',
    );
    limbs.push({ curve, p, len });
    limbOf.set(p.id, curve);
    const pr = M.get(p.parent);
    wood(W, curve, limbR(pr.leaves) * 0.85, limbR(p.leaves) * 0.7, big ? 10 : 20, big ? 6 : 9, {
      birth: p.born,
      grow: 1.6,
      key: p.id,
      thin: 0.45,
    });
  }
  for (const p of M.people) {
    // Short twig to a spouse who married in.
    if (!p.mi || !p.anchor) continue;
    const a = nodeOf(p.anchor);
    const c = nodeOf(p.id);
    const m = a
      .clone()
      .lerp(c, 0.5)
      .add(new Vector3(0, 0.5, 0));
    wood(W, new CatmullRomCurve3([a, m, c]), 0.16, 0.1, 8, 6, {
      birth: spouseYear(M, p),
      grow: 1,
      key: p.id,
      thin: 0.6,
    });
  }

  // Prop roots: each household drops one; a son's becomes a fused secondary trunk.
  const household = (p: StudioPerson) => {
    const first = p.kids.map((k) => M.get(k).born).sort((x, y) => x - y)[0];
    return first != null ? first - 2 : p.born + 24;
  };
  const pillar = (
    x: number,
    z: number,
    yTop: number,
    r: number,
    n: number,
    birth: number,
    key: string,
    seed: number,
  ) => {
    for (let s = 0; s < n; s++) {
      const a = (s / n) * TAU + seed;
      const o = n > 1 ? r * 0.55 : 0;
      const pts: Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const y = yTop - 0.2 - t * (yTop + 0.3);
        const tw = a + t * 0.8;
        const wob = Math.sin(t * 7 + seed * 3) * r * 0.25;
        pts.push(new Vector3(x + Math.cos(tw) * o + wob, y, z + Math.sin(tw) * o - wob * 0.6));
      }
      wood(
        W,
        new CatmullRomCurve3(pts),
        r * (n > 1 ? 0.5 : 0.75),
        r * (n > 1 ? 0.62 : 0.95),
        big ? 10 : 16,
        big ? 6 : 8,
        {
          birth: birth + s * 0.6,
          grow: 6,
          key,
          thin: 0.22,
          shape: (t) => 1 + 0.9 * Math.exp(-(1 - t) * 14),
        },
      );
    }
  };
  for (const p of M.people) {
    if (p.mi || p === root || p.gen < 1) continue;
    if (!p.kids.length && !p.virt) continue;
    // Drop from the limb just before the person, so the pillar does not cross the portrait.
    const limb = limbOf.get(p.id);
    const c = limb ? limb.getPointAt(0.8) : joint(p.id).add(new Vector3(size * 1.6, 0, 0));
    const share = Math.sqrt(p.leaves / maxLeaves);
    const r = (p.gen === 1 ? 0.55 + 1.6 * share : 0.22 + 0.9 * share) * (big ? 1.3 : 1);
    pillar(c.x, c.z, c.y, r, p.gen === 1 && !big ? 3 : p.gen === 1 ? 2 : 1, household(p), p.id, rnd() * TAU);
  }
  if (root.kids.length) {
    // The founder's own extra pillars close to the trunk.
    const firstLimbs = limbs.filter((l) => l.p.parent === root.id);
    for (let k = 0; k < Math.min(5, firstLimbs.length * 2); k++) {
      const l = firstLimbs[k % firstLimbs.length];
      if (!l) continue;
      const P = l.curve.getPointAt(0.32 + (k >= firstLimbs.length ? 0.22 : 0));
      pillar(P.x, P.z, P.y, 0.3 + 0.2 * spread, 1, root.born + 32 + k * 6, root.id, k * 1.7);
    }
  }

  const rig = lightRig();
  rig.uCanY.value = Hc + dome * 0.4;
  const barkGeo = bakeWood(W);
  const bark = barkMat(U, rig);
  group.add(new Mesh(barkGeo, bark.mat));

  // ---- rootlet curtains hanging from the limbs ----
  const RB = woodBuilder();
  const rr = big ? 1.6 : 1;
  for (const { curve, p, len } of limbs) {
    const n = Math.max(1, Math.round(len / (big ? 7 : 2.6)));
    for (let k = 0; k < n; k++) {
      const P = curve.getPointAt(0.12 + rnd() * 0.85);
      P.y -= 0.2;
      const long = rnd() < 0.18;
      const L = P.y * (long ? 0.7 + rnd() * 0.2 : 0.15 + rnd() * rnd() * 0.5);
      const w = rnd() * TAU;
      const curve2 = new CatmullRomCurve3([
        P,
        P.clone().add(new Vector3(Math.cos(w) * 0.15, -L * 0.5, Math.sin(w) * 0.15)),
        P.clone().add(new Vector3(Math.cos(w) * 0.25, -L, Math.sin(w) * 0.25)),
      ]);
      wood(RB, curve2, 0.07 * rr, 0.03 * rr, big ? 3 : 5, 3, {
        birth: p.born + 3 + rnd() * 14,
        grow: 5 + rnd() * 5,
        key: p.id,
        thin: 0.6,
      });
    }
  }
  const rootletGeo = bakeWood(RB);
  const rootlets = rootletMat(U, rig);
  group.add(new Mesh(rootletGeo, rootlets.mat));

  // ---- prayer threads (kalava) and the stone chabutro ----
  const TB = woodBuilder();
  const threadCols: Array<[number, number, number]> = [
    [0.75, 0.05, 0.04],
    [0.95, 0.5, 0.05],
    [0.75, 0.05, 0.04],
    [0.92, 0.88, 0.8],
  ];
  const platH = 1.1;
  threadCols.forEach((col, k) => {
    const pts: Vector3[] = [];
    const turns = 3;
    const y0 = platH + 1.1 + k * 0.12;
    for (let i = 0; i <= turns * 24; i++) {
      const a = (i / 24) * TAU + k;
      pts.push(new Vector3(Math.cos(a) * trunkR * 1.04, y0 + (i / 24) * 0.16, Math.sin(a) * trunkR * 1.04));
    }
    wood(TB, new CatmullRomCurve3(pts), 0.05, 0.05, turns * 24, 4, {
      birth: root.born + 5,
      grow: 2,
      key: '',
      col,
      thin: 1,
    });
  });
  const threads = threadMat(U, rig);
  group.add(new Mesh(bakeWood(TB), threads.mat));
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
  const plat = new Mesh(new LatheGeometry(prof, big ? 48 : 64), stone.mat);
  group.add(plat);

  // ---- leaves: one instanced mesh of clumps on every node and along every limb ----
  const tex = leafTexture();
  const ls = big ? 1.25 : 0.82;
  const leafGeo = new PlaneGeometry(0.72 * ls, 1.1 * ls);
  leafGeo.translate(0, 0.5 * ls, 0);
  type Clump = { c: Vector3; rx: number; ry: number; n: number; birth: number; death: number; key: string };
  const clumps: Clump[] = [];
  // Leaf ceiling: a layer resting on the limbs.
  const layerH = big ? 1.9 : 1.4;
  const layerMid = hang + 0.6 + layerH;
  const per = big ? 22 : 56;
  const lineage = M.people.filter((p) => !p.mi);
  for (const p of lineage) {
    const c = nodeOf(p.id);
    const isR = p === root;
    clumps.push({
      c: c.clone().add(new Vector3(0, layerMid, 0)),
      rx: isR ? trunkR * 2.6 : 2.6,
      ry: layerH,
      n: isR ? per * 4 : per,
      birth: p.born,
      death: p.died ?? 9999,
      key: p.id,
    });
  }
  // Fill: a jittered grid over the crown; each patch belongs to the nearest person and opens after their birth.
  const mound = (x: number, z: number) =>
    Math.max(0, Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) * 0.6 + Math.sin(x * 0.07 - z * 0.09) * 0.5);
  const step = big ? 6.5 : 3.1;
  const reachMax = step * (big ? 2.4 : 2.6);
  for (let x = -Rmax - 3; x <= Rmax + 3; x += step)
    for (let z = -Rmax - 3; z <= Rmax + 3; z += step) {
      const px = x + (rnd() - 0.5) * step * 0.9;
      const pz = z + (rnd() - 0.5) * step * 0.9;
      const r = Math.hypot(px, pz);
      if (r > Rmax + 3) continue;
      let best: StudioPerson | null = null;
      let bd = Number.POSITIVE_INFINITY;
      for (const p of lineage) {
        const c = nodeOf(p.id);
        const dd = (c.x - px) ** 2 + (c.z - pz) ** 2;
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (!best || Math.sqrt(bd) > reachMax) continue;
      clumps.push({
        c: new Vector3(px, yAt(r) + layerMid + mound(px, pz) * layerH * 1.6, pz),
        rx: step * 0.75,
        ry: layerH * (0.9 + mound(px, pz) * 0.8),
        n: big ? 16 : 26,
        birth: best.born + 1 + rnd() * 2,
        death: best.died ?? 9999,
        key: best.id,
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
      if (rnd() < (big ? 0.06 : 0.05)) {
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
  figPts.frustumCulled = false;
  group.add(figPts);

  // ---- fireflies / sunbeam dust, and diya flames on the platform ----
  const gN = big ? 520 : 240;
  const nDiya = 9;
  const gp = new Float32Array((gN + nDiya) * 3);
  const gph = new Float32Array(gN + nDiya);
  const gk = new Float32Array(gN + nDiya);
  for (let i = 0; i < gN; i++) {
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd()) * (Rmax + 4);
    gp.set([Math.cos(a) * r, 1 + rnd() * (yAt(r) - 2), Math.sin(a) * r], i * 3);
    gph[i] = rnd() * 60;
  }
  for (let k = 0; k < nDiya; k++) {
    const a = (k / nDiya) * TAU + 0.2;
    gp.set([Math.cos(a) * Rp * 0.93, 0.6 - 0.35 + 0.25, Math.sin(a) * Rp * 0.93], (gN + k) * 3);
    gph[gN + k] = rnd() * 60;
    gk[gN + k] = 1;
  }
  const gg = new BufferGeometry();
  gg.setAttribute('position', new BufferAttribute(gp, 3));
  gg.setAttribute('aPh', new BufferAttribute(gph, 1));
  gg.setAttribute('aKind', new BufferAttribute(gk, 1));
  const glow = glowMat(
    U,
    softTex([
      [0, 'rgba(255,255,255,1)'],
      [0.22, 'rgba(255,255,255,0.65)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  const glowPts = new Points(gg, glow.mat);
  glowPts.frustumCulled = false;
  glowPts.renderOrder = 5;
  group.add(glowPts);

  // ---- ground, sky, sun or moon ----
  const reach = Rmax + 30;
  const ground = groundMat(rig, U, trunkR, reach);
  const floor = new Mesh(new CircleGeometry(reach * 4, 96), ground.mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  group.add(floor);
  const sky = skyDome(LOOK.light.top, LOOK.light.hor, LOOK.light.ground);
  group.add(sky.mesh);
  const orbMat = new SpriteMaterial({
    map: softTex([
      [0, 'rgba(255,255,255,1)'],
      [0.12, 'rgba(255,255,255,0.95)'],
      [0.2, 'rgba(255,255,255,0.35)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const orb = new Sprite(orbMat);
  group.add(orb);

  // ---- canopy shadow follows the family as it spreads ----
  const canTarget = { value: trunkR * 4 };
  rig.uCanR.value = canTarget.value;
  const yearHook = (yr: number) => {
    let r = trunkR * 4;
    for (const p of M.people) if (!p.mi && p.born <= yr) r = Math.max(r, Rg(p.gen) + 5);
    canTarget.value = r;
  };

  // ---- default view: the whole tree from a little above the canopy rim ----
  // ---- default view: from outside the crown, eye below the leaves, looking up into the canopy ----
  const fogDist = ((Rmax + 6) / Math.tan((27 * Math.PI) / 180)) * (big ? 0.72 : 0.86) + Rmax * 0.25;
  const target = new Vector3(0, Hc * 0.82, 0);
  const az = 0.5;
  const camAt = (rtl: boolean) =>
    new Vector3((rtl ? -1 : 1) * Math.sin(az) * fogDist, Hc * 0.5, Math.cos(az) * fogDist);
  const view = { target, cam: camAt(ctx.rtl()) };

  const tint = () => {
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    setRig(rig, L);
    rig.uFogNear.value = fogDist * 0.9;
    rig.uFogFar.value = fogDist * 3.4;
    bark.uni.uBarkA.value.copy(lin(L.barkA));
    bark.uni.uBarkB.value.copy(lin(L.barkB));
    bark.uni.uMoss.value.copy(lin(L.moss));
    rootlets.uni.uRootA.value.copy(lin(L.rootA));
    rootlets.uni.uRootB.value.copy(lin(L.rootB));
    leaf.uni.uLeafA.value.copy(lin(L.leafA));
    leaf.uni.uLeafB.value.copy(lin(L.leafB));
    leaf.uni.uVein.value.copy(lin(L.vein));
    leaf.uni.uOld.value.copy(lin(L.old));
    ground.uni.uSoil.value.copy(lin(L.soil));
    ground.uni.uSoil2.value.copy(lin(L.soil2));
    ground.uni.uGrass.value.copy(lin(L.grass));
    ground.uni.uHor.value.copy(lin(L.hor));
    stone.uni.uStoneA.value.copy(lin(L.stoneA));
    stone.uni.uStoneB.value.copy(lin(L.stoneB));
    fig.uni.uFig.value.copy(lin(L.fig));
    glow.uni.uFly.value.copy(lin(L.fly));
    glow.uni.uFlame.value.copy(lin(L.flame));
    glow.setAdd(L.dark);
    sky.set(L.top, L.hor, L.ground);
    orbMat.color.copy(lin(L.orb)).multiplyScalar(L.dark ? 0.9 : 1.1);
    orb.position
      .set(...L.sunDir)
      .normalize()
      .multiplyScalar(1150);
    orb.scale.setScalar(L.dark ? 120 : 360);
    ctx.look(L.bloom, L.exposure);
  };
  tint();

  return {
    key: 'banyan',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    labelScale: 0.85,
    tint,
    hiTargets: [{ geo: barkGeo }, { geo: rootletGeo }, { geo: leafGeo }],
    focus: [rig.uFocus],
    view,
    follow,
    yearHook,
    update: () => {
      rig.uCanR.value += (canTarget.value - rig.uCanR.value) * 0.05;
    },
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
    },
  };
};
