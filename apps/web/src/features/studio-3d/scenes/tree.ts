import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { softTex } from '../gl.ts';
import { type StudioPerson, spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { bakeWood, fitView, trackPointScale, tube, untone, woodBuilder } from './tree-gl.ts';
import { ghafLayout, hashId } from './tree-layout.ts';
import {
  backdropMaterial,
  fireflyMaterial,
  foliageAtlas,
  foliageMaterial,
  groundMaterial,
  LOOK,
  setRig,
  treeRig,
  woodMaterial,
} from './tree-mat.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Living Tree: the family as an old Ghaf, the UAE's national tree, growing upward like a classic
// family tree. The founder sits at the top of the leaning, S-curved trunk; each line of descent is a
// gnarled limb forking off its parent's limb in age order (the eldest lowest, reaching furthest), every
// generation higher than the last. Twigs, broken stubs and uneven foliage make each family's tree its
// own (seeded by the family). Night: a garden under warm uplights with fireflies. Day: a botanical plate.

const UP = new Vector3(0, 1, 0);

export const treeScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const m = ctx.rtl() ? -1 : 1;
  const size = big ? 1.1 : 1.7;
  const disc = size * 2.3 * 0.685;
  const S = disc * 1.55;
  // The default camera's azimuth (left-to-right); the layout keeps the founder's partners off its side of him.
  const AZ = 0.62;
  const EL = (38 * Math.PI) / 180;
  const L = ghafLayout(M, {
    S,
    rise: 3,
    flare: 1.6,
    trunk: 0.18,
    face: Math.atan2(Math.cos(AZ), Math.sin(AZ)),
    el: EL,
    disc,
  });
  const { T, Rmax } = L;
  const rnd = rng(L.seed ^ 0x9e3779b9);
  /** Randomness stable per family and person (or any other key): the same family always grows the same tree. */
  const prng = (id: string, salt: string) => rng(L.seed ^ hashId(`${id}:${salt}`));
  const pos = new Float32Array(M.n * 3);
  for (let i = 0; i < M.n; i++) pos.set([(L.X[i] ?? 0) * m, L.Y[i] ?? 0, L.Z[i] ?? 0], i * 3);
  const at = (p: StudioPerson) => new Vector3(pos[p.idx * 3], pos[p.idx * 3 + 1], pos[p.idx * 3 + 2]);
  const root = M.root;

  // ---- wood: an S-curved, leaning trunk of fused stems on a flared foot and irregular roots ----
  const W = woodBuilder();
  const rT = S * (0.42 + 0.1 * Math.log2(1 + M.n / 30));
  const radial = big ? 6 : 10;
  const tr = prng(root.id, 'trunk');
  const foot = new Vector3(0, -0.6, 0);
  const crown = at(root).addScaledVector(UP, -S * 0.35);
  const span = crown.clone().sub(foot);
  const flat = new Vector3(span.x, 0, span.z);
  const across = flat.lengthSq() > 1e-6 ? new Vector3(-flat.z, 0, flat.x).normalize() : new Vector3(1, 0, 0);
  const sway = rT * (0.55 + tr() * 0.5) * (tr() < 0.5 ? -1 : 1);
  const spine = new CatmullRomCurve3(
    [
      foot,
      foot.clone().addScaledVector(span, 0.28).addScaledVector(across, sway),
      foot
        .clone()
        .addScaledVector(span, 0.6)
        .addScaledVector(across, -sway * 0.8),
      foot
        .clone()
        .addScaledVector(span, 0.86)
        .addScaledVector(across, sway * 0.3),
      crown,
    ],
    false,
    'centripetal',
  );
  const P = new Vector3();
  const strands = 5;
  for (let k = 0; k < strands; k++) {
    const phi = (k / strands) * Math.PI * 2 + 0.4 + tr() * 0.3;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      spine.getPointAt(t, P);
      const o = rT * (0.5 + 0.9 * Math.exp(-(P.y + 0.6) / (rT * 0.9)) - 0.32 * t);
      const ang = phi + t * 1.3 + Math.sin(t * 4 + k) * 0.12;
      pts.push(new Vector3(P.x + Math.cos(ang) * o, P.y, P.z + Math.sin(ang) * o));
    }
    tube(W, new CatmullRomCurve3(pts), rT * 0.5, rT * 0.34, big ? 18 : 30, radial, {
      birth: root.born - 4 + k * 0.4,
      grow: 3.5,
      key: root.id,
      shape: (t) => 1 + 0.6 * Math.exp(-t * 14) + 0.08 * Math.sin(t * 19 + k),
    });
  }
  tube(W, spine, rT * 0.7, rT * 0.5, big ? 14 : 22, radial, { birth: root.born - 4, grow: 3.5, key: root.id });
  const roots = 7 + Math.floor(tr() * 4);
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * Math.PI * 2 + (tr() - 0.5) * 0.9;
    const len = rT * (2.4 + tr() * 4.6);
    const bend = (tr() - 0.5) * 0.7;
    const curve = new CatmullRomCurve3([
      new Vector3(Math.cos(a) * rT * 0.55, rT * (0.7 + tr() * 0.5), Math.sin(a) * rT * 0.55),
      new Vector3(Math.cos(a + bend * 0.3) * len * 0.35, 0.05 + tr() * 0.15, Math.sin(a + bend * 0.3) * len * 0.35),
      new Vector3(Math.cos(a + bend) * len * 0.7, -0.1, Math.sin(a + bend) * len * 0.7),
      new Vector3(Math.cos(a + bend * 1.4) * len, -0.45, Math.sin(a + bend * 1.4) * len),
    ]);
    const r0 = rT * (0.3 + tr() * 0.2);
    tube(W, curve, r0, 0.04, big ? 10 : 16, big ? 5 : 7, { birth: root.born - 4, grow: 3.5, key: '', kind: 2 });
    if (tr() < 0.35) {
      // A side root splitting off and snaking away.
      const s0 = curve.getPointAt(0.45);
      const b2 = a + (tr() < 0.5 ? -1 : 1) * (0.5 + tr() * 0.4);
      const l2 = len * (0.3 + tr() * 0.3);
      tube(
        W,
        new CatmullRomCurve3([
          s0,
          s0.clone().add(new Vector3(Math.cos(b2) * l2 * 0.5, -0.1, Math.sin(b2) * l2 * 0.5)),
          s0.clone().add(new Vector3(Math.cos(b2 + bend) * l2, -0.4, Math.sin(b2 + bend) * l2)),
        ]),
        r0 * 0.45,
        0.03,
        big ? 6 : 10,
        5,
        { birth: root.born - 3, grow: 3.5, key: '', kind: 2 },
      );
    }
  }

  // ---- limbs: one per line of descent, forking off along the parent's limb in age order ----
  const maxLeaves = Math.max(1, root.leaves);
  const rad = (leaves: number) => S * (big ? 0.05 : 0.06) + rT * 0.62 * Math.sqrt(leaves / maxLeaves);
  type Limb = { curve: CatmullRomCurve3; r0: number; r1: number };
  const radAt = (l: Limb, t: number) => l.r0 + (l.r1 - l.r0) * t ** 0.8;
  const limbOf = new Map<string, Limb>();
  const trunkLimb: Limb = { curve: spine, r0: rT * 0.7, r1: rT * 0.5 };
  /** A gnarled limb rising toward the light: some sweep out sideways first, others climb steeply; random bends and a kink. */
  const gnarled = (a: Vector3, c: Vector3, r: () => number) => {
    const d = c.clone().sub(a);
    const len = d.length();
    const hor = new Vector3(d.x, 0, d.z);
    const side = hor.lengthSq() > 1e-6 ? new Vector3(-hor.z, 0, hor.x).normalize() : new Vector3(1, 0, 0);
    const rise = Math.max(d.y, 0);
    const sweep = r() < 0.45;
    const h1 = sweep ? 0.42 : 0.1;
    const v1 = sweep ? 0.12 : 0.42;
    const h2 = sweep ? 0.74 : 0.46;
    const v2 = sweep ? 0.52 : 0.8;
    const bend = () => (r() - 0.5) * len * 0.22;
    const p1 = a
      .clone()
      .addScaledVector(hor, h1)
      .addScaledVector(UP, rise * v1 + len * 0.03)
      .addScaledVector(side, bend());
    const kink = a
      .clone()
      .addScaledVector(hor, (h1 + h2) / 2)
      .addScaledVector(UP, rise * ((v1 + v2) / 2) + (r() - 0.5) * len * 0.08)
      .addScaledVector(side, bend() * 1.3);
    const p2 = a
      .clone()
      .addScaledVector(hor, h2)
      .addScaledVector(UP, rise * v2 + len * 0.04)
      .addScaledVector(side, bend() * 0.6);
    return new CatmullRomCurve3([a.clone(), p1, kink, p2, c.clone()], false, 'centripetal');
  };
  /** Where foliage and pods hang: points along limbs and twigs, with the owner's years. */
  const hangs: Array<{ p: Vector3; owner: StudioPerson; twig: boolean }> = [];
  const segs = big ? 10 : 22;
  const rad2 = big ? 5 : 8;
  const order = M.people.filter((p) => !p.mi && p.parent && !p.virt).sort((a, b) => a.gen - b.gen || a.born - b.born);
  for (const p of order) {
    const par = M.get(p.parent as string);
    const pl = isRoot(par) ? trunkLimb : limbOf.get(par.id);
    const sibs = par.kids.filter((k) => !M.get(k).virt);
    const rank = Math.max(0, sibs.indexOf(p.id));
    const u = sibs.length > 1 ? rank / (sibs.length - 1) : 0.5;
    const r = prng(p.id, 'limb');
    // The eldest forks lowest on the parent's limb, each younger sibling a little higher.
    const tf = Math.min(0.97, Math.max(0.05, (isRoot(par) ? 0.55 + 0.38 * u : 0.42 + 0.46 * u) + (r() - 0.5) * 0.05));
    const c = at(p);
    let a: Vector3;
    let rFork: number;
    if (pl) {
      a = pl.curve.getPointAt(tf);
      rFork = radAt(pl, tf);
    } else {
      a = at(par);
      rFork = rad(par.leaves) * 0.8;
    }
    const out = new Vector3(c.x - a.x, 0, c.z - a.z);
    if (out.lengthSq() > 1e-6) a.addScaledVector(out.normalize(), rFork * 0.55);
    const curve = gnarled(a, c, r);
    const thick = 0.85 + r() * 0.3;
    const r1 = rad(p.leaves) * 0.7 * thick;
    const r0 = Math.max(r1 * 1.15, Math.min(rFork * 0.85, rad(p.leaves) * 1.25 * thick));
    tube(W, curve, r0, r1, segs, rad2, { birth: p.born, grow: 1.6, key: p.id });
    const limb: Limb = { curve, r0, r1 };
    limbOf.set(p.id, limb);
    // Decorative side twigs and dead-end branchlets (no one sits on them): they break the pattern.
    const len = curve.getLength();
    const twigs = big ? (r() < 0.6 ? 1 : 0) : 1 + Math.floor(r() * (len > S * 3 ? 3 : 2));
    for (let k = 0; k < twigs; k++) {
      const t0 = 0.2 + r() * 0.65;
      const s0 = curve.getPointAt(t0);
      const tan = curve.getTangentAt(t0);
      const n0 = new Vector3().crossVectors(tan, UP);
      if (n0.lengthSq() < 1e-6) n0.set(1, 0, 0);
      n0.normalize().applyAxisAngle(tan, r() * Math.PI * 2);
      const droop = r() < 0.35;
      const tl = S * (0.35 + r() * 0.65);
      const e = s0
        .clone()
        .addScaledVector(n0, tl)
        .addScaledVector(tan, tl * 0.35)
        .addScaledVector(UP, droop ? -tl * 0.3 : tl * (0.2 + r() * 0.35));
      const m2 = s0
        .clone()
        .lerp(e, 0.5)
        .addScaledVector(n0, (r() - 0.5) * tl * 0.3)
        .addScaledVector(UP, tl * 0.1);
      const tw = radAt(limb, t0) * (0.32 + r() * 0.15);
      tube(W, new CatmullRomCurve3([s0, m2, e]), tw, 0.02, big ? 4 : 6, big ? 4 : 5, {
        birth: p.born + 2 + r() * 10,
        grow: 2,
        key: '',
      });
      if (r() < 0.65) hangs.push({ p: e, owner: p, twig: true });
      if (r() < 0.4) hangs.push({ p: m2, owner: p, twig: true });
      if (!big && r() < 0.3) {
        // A tiny fork near the twig's end.
        const f0 = m2.clone().lerp(e, 0.4);
        const f1 = f0
          .clone()
          .addScaledVector(n0, tl * 0.25)
          .addScaledVector(UP, tl * 0.25);
        const fm = f0
          .clone()
          .lerp(f1, 0.5)
          .addScaledVector(UP, tl * 0.05);
        tube(W, new CatmullRomCurve3([f0, fm, f1]), tw * 0.4, 0.015, 4, 4, {
          birth: p.born + 4 + r() * 10,
          grow: 2,
          key: '',
        });
      }
    }
    const nh = big ? 1 : 1 + Math.floor(r() * 3);
    for (let k = 0; k < nh; k++) hangs.push({ p: curve.getPointAt(0.35 + r() * 0.6), owner: p, twig: false });
  }
  // A few broken stubs on the trunk: an old tree has lost limbs.
  const stubs = 2 + Math.floor(tr() * 2);
  for (let k = 0; k < stubs; k++) {
    const s0 = spine.getPointAt(0.3 + tr() * 0.5);
    const az = tr() * Math.PI * 2;
    const dir = new Vector3(Math.cos(az), 0.35 + tr() * 0.4, Math.sin(az)).normalize();
    s0.add(new Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(rT * 0.5));
    const l0 = rT * (0.8 + tr() * 1.2);
    const stub = new CatmullRomCurve3([
      s0,
      s0.clone().addScaledVector(dir, l0 * 0.5),
      s0.clone().addScaledVector(dir, l0),
    ]);
    tube(W, stub, rT * 0.28, rT * 0.12, 5, 6, { birth: root.born + 10 + tr() * 30, grow: 3, key: '' });
  }
  // Marriage twigs, gold: from the partner across to the spouse.
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    const anc = M.get(p.anchor);
    const a = at(anc);
    const c = at(p);
    const mid = a
      .clone()
      .lerp(c, 0.5)
      .addScaledVector(UP, -S * 0.22);
    tube(W, new CatmullRomCurve3([a, mid, c]), S * 0.045, S * 0.035, big ? 5 : 8, 5, {
      birth: spouseYear(M, p),
      grow: 1,
      key: p.id,
      kind: 1,
    });
  }
  const R = treeRig();
  const woodGeo = bakeWood(W);
  const wood = woodMaterial(U, R);
  wood.uni.uThick.value.set(S * 0.12, S * 0.3);
  group.add(new Mesh(woodGeo, wood.mat));

  // ---- foliage: drooping sprays under every person and along the limbs, pods on the adults ----
  const per = big ? 4 : 11;
  type Leaf = { p: Vector3; owner: StudioPerson; kind: number; len: number };
  const items: Leaf[] = [];
  for (const p of M.people) {
    if (p.mi || isRoot(p)) continue;
    const c = at(p);
    // Uneven clusters: some people carry a full head of sprays, some a few, off to one side.
    const r = prng(p.id, 'leaves');
    const n = Math.max(2, Math.round(per * (0.45 + r() * 1.1)));
    const spread = S * (0.3 + r() * 0.5);
    const offA = r() * Math.PI * 2;
    const off = S * r() * 0.35;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const rr = spread * (0.35 + r() * 0.65);
      items.push({
        p: new Vector3(
          c.x + Math.cos(offA) * off + Math.cos(a) * rr,
          c.y - S * (0.36 + r() * 0.22),
          c.z + Math.sin(offA) * off + Math.sin(a) * rr,
        ),
        owner: p,
        kind: r() < 0.5 ? 0 : 1,
        len: S * (0.3 + r() * 0.42),
      });
    }
  }
  for (const h of hangs) {
    const n = h.twig
      ? big
        ? 1 + Math.floor(rnd() * 2)
        : 2 + Math.floor(rnd() * 4)
      : big
        ? 1
        : 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const j = new Vector3((rnd() - 0.5) * S * 0.5, -S * 0.08, (rnd() - 0.5) * S * 0.5);
      items.push({ p: h.p.clone().add(j), owner: h.owner, kind: rnd() < 0.5 ? 0 : 1, len: S * (0.32 + rnd() * 0.3) });
    }
    if (h.twig && !big && rnd() < 0.55)
      items.push({
        p: h.p.clone().addScaledVector(UP, -S * 0.05),
        owner: h.owner,
        kind: 2,
        len: S * (0.32 + rnd() * 0.12),
      });
  }
  const leafGeo = new PlaneGeometry(1, 1, 1, 4);
  leafGeo.translate(0, -0.5, 0);
  const count = items.length;
  const iB = new Float32Array(count);
  const iD = new Float32Array(count);
  const iP = new Float32Array(count);
  const iV = new Float32Array(count);
  const iK = new Float32Array(count);
  const keys: string[] = [];
  const atlas = foliageAtlas();
  const leaf = foliageMaterial(U, R, atlas);
  const leaves = new InstancedMesh(leafGeo, leaf.mat, Math.max(1, count));
  const mtx = new Matrix4();
  const q = new Quaternion();
  const tilt = new Quaternion();
  const sc = new Vector3();
  items.forEach((it, i) => {
    const out = new Vector3(it.p.x, 0, it.p.z);
    if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
    out.normalize();
    q.setFromAxisAngle(UP, rnd() * Math.PI * 2);
    // Lean the spray a little away from the trunk so the crown's skirt flares.
    tilt.setFromAxisAngle(new Vector3(-out.z, 0, out.x), 0.4 + rnd() * 0.45);
    q.premultiply(tilt);
    const w = it.kind === 2 ? it.len * 0.55 : it.len * 0.62;
    sc.set(w, it.len, w);
    mtx.compose(it.p, q, sc);
    leaves.setMatrixAt(i, mtx);
    const owner = it.owner;
    iB[i] = it.kind === 2 ? owner.born + 20 + rnd() * 6 : owner.born + 0.4 + rnd() * 1.6;
    iD[i] = (owner.died ?? 9999) + rnd() * 1.4;
    iP[i] = rnd() * 100;
    iV[i] = rnd();
    iK[i] = it.kind;
    keys.push(owner.id);
  });
  const ia = (a: Float32Array) => new InstancedBufferAttribute(a, 1);
  leafGeo.setAttribute('aBirth', ia(iB));
  leafGeo.setAttribute('aDeath', ia(iD));
  leafGeo.setAttribute('aPhase', ia(iP));
  leafGeo.setAttribute('aVar', ia(iV));
  leafGeo.setAttribute('aKind', ia(iK));
  leafGeo.setAttribute('aHi', ia(new Float32Array(count)));
  leafGeo.userData.keys = keys;
  leaves.count = count;
  leaves.frustumCulled = false;
  group.add(leaves);

  // ---- ground, fireflies, backdrop ----
  const ground = groundMaterial(U, R);
  const floor = new Mesh(new CircleGeometry(Math.max(500, Rmax * 9), 72), ground.mat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  ground.uni.uCan.value.set(Rmax * 0.4, Rmax, rT);
  R.uUp.value.set(rT * 2.6, 0.35, Math.max(8, T * 0.55));

  const fN = big ? 150 : 110;
  const fp = new Float32Array(fN * 3);
  const fph = new Float32Array(fN);
  for (let i = 0; i < fN; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * Rmax * 1.15;
    const y = 1.5 + rnd() * (L.top - 1) * (0.4 + 0.6 * (r / (Rmax * 1.15)));
    fp.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    fph[i] = rnd() * 60;
  }
  const fg = new BufferGeometry();
  fg.setAttribute('position', new BufferAttribute(fp, 3));
  fg.setAttribute('aPh', new BufferAttribute(fph, 1));
  const fly = fireflyMaterial(
    U,
    softTex([
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  const flies = new Points(fg, fly.mat);
  trackPointScale(flies, fly.uni.uPx);
  flies.frustumCulled = false;
  flies.renderOrder = 4;
  group.add(flies);

  const back = backdropMaterial();
  const dome = new Mesh(new SphereGeometry(2400, 24, 12), back.mat);
  dome.renderOrder = -2;
  group.add(dome);

  // ---- canopy shadow follows the family as it spreads ----
  let canTarget = Rmax * 0.4;
  let lastT = U.uTime.value;
  const yearHook = (yr: number) => {
    let r = rT * 3;
    for (const p of M.people) if (!p.mi && p.born <= yr) r = Math.max(r, (L.ring[p.gen] ?? 0) + S);
    canTarget = r;
  };

  // ---- default view: the whole crown and the trunk's foot, from a little above ----
  const pts: Vector3[] = M.people.map((p) => at(p));
  pts.push(new Vector3(0, 0, 0));
  const az = AZ * m;
  // 38 degrees: looking a little down into the rising crown (the layout keeps portraits apart from here).
  const el = EL;
  const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const view = fitView(pts, disc * 0.75, dir, 1.45, 0.88);
  const dist = view.cam.distanceTo(view.target);

  const tint = () => {
    const lk = ctx.dark() ? LOOK.dark : LOOK.light;
    setRig(R, lk, lin);
    R.uFogNear.value = dist * 1.3;
    R.uFogFar.value = dist * 4;
    wood.uni.uBarkA.value.copy(lin(lk.barkA));
    // Night only (the shader multiplies these by the dark-theme flag): the moon's silver-blue light.
    wood.uni.uRimCol.value.copy(lin('#9aa6b8'));
    wood.uni.uSpan.value.set(T, L.top);
    wood.uni.uBarkB.value.copy(lin(lk.barkB));
    leaf.uni.uLeafA.value.copy(lin(lk.leafA));
    leaf.uni.uLeafB.value.copy(lin(lk.leafB));
    leaf.uni.uDry.value.copy(lin(lk.dry));
    leaf.uni.uPod.value.copy(lin(lk.pod));
    ground.uni.uIn.value.copy(untone(lk.groundIn, lk.exposure));
    ground.uni.uOut.value.copy(untone(lk.groundOut, lk.exposure));
    ground.uni.uLitter.value.copy(lk.dark ? lin(lk.litter).multiplyScalar(0.35) : untone(lk.litter, lk.exposure));
    ground.uni.uShadow.value.copy(untone(lk.shadow, lk.exposure));
    back.uni.uTop.value.copy(untone(lk.bgTop, lk.exposure));
    back.uni.uHor.value.copy(untone(lk.bgHor, lk.exposure));
    fly.uni.uCol.value.copy(lin(lk.fly));
    flies.visible = lk.dark;
    ctx.look(lk.bloom, lk.exposure);
  };
  tint();

  return {
    key: 'tree',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    tint,
    hiTargets: [{ geo: woodGeo }, { geo: leafGeo, perPerson: true }],
    focus: [R.uFocus],
    view,
    follow: big ? 30 : 34,
    labelScale: 0.9,
    yearHook,
    update: () => {
      // Ease by elapsed time (the scene has no frame delta), so the shadow grows alike at any refresh rate.
      const t = U.uTime.value;
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const u = ground.uni.uCan.value;
      u.x += (canTarget - u.x) * (1 - Math.exp(-dt * 3));
    },
  };
};
