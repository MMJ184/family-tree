import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { softTex } from '../gl.ts';
import { spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { bonsaiLayout } from './bonsai-layout.ts';
import {
  domeMaterial,
  dustMaterial,
  glazeMaterial,
  juniperMaterial,
  LOOK,
  mossMaterial,
  padMaterial,
  plinthMaterial,
  setStudio,
  stoneMaterial,
  studioRig,
  sweepMaterial,
} from './bonsai-mat.ts';
import { bakeWood, fitView, trackPointScale, tube, untone, woodBuilder } from './tree-gl.ts';
import { isRoot, type SceneBuilder } from './types.ts';

// Bonsai: the family as a juniper in an informal upright (moyogi) style, shown like a gallery
// piece. The founder sits where the trunk opens into the crown, each line of descent is a wired
// branch, and the youngest generations sit on the outer foliage pads. Night: black lacquer stage,
// oxblood glaze, dust in the key light. Day: white gallery plinth, celadon glaze, soft shadows.

export const bonsaiScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const pos = new Float32Array(M.n * 3);
  const m = ctx.rtl() ? -1 : 1;
  const size = big ? 0.66 : 1.05;
  const disc = size * 2.3 * 0.685; // visible medal diameter
  const S = disc * (big ? 1.3 : 1.5); // spacing between portraits
  const rnd = rng(17);
  const L = bonsaiLayout(M, S, big, rng(5));
  const { R, Cy, Cz } = L;
  const C = new Vector3(0, Cy, Cz);
  const at = (i: number) => new Vector3((L.X[i] ?? 0) * m, L.Y[i] ?? 0, L.Z[i] ?? 0);
  for (let i = 0; i < M.n; i++) pos.set(at(i).toArray(), i * 3);
  const atId = (id: string) => at(M.get(id).idx);
  const Rg = studioRig();

  // ---- wood: an S-curved trunk with a shari vein, surface roots, jin stubs and wired branches ----
  const W = woodBuilder();
  let cx0 = 0;
  let cx1 = 0;
  for (const pad of L.pads) {
    cx0 = Math.min(cx0, pad.x - pad.rx);
    cx1 = Math.max(cx1, pad.x + pad.rx);
  }
  const potW = Math.max(R * 0.28, (cx1 - cx0) * 0.22);
  const rT = 0.11 * potW + 0.2;
  const leaderTop = new Vector3(-0.04 * R * m, Cy + R * 0.2, Cz * 1.1);
  const spine = new CatmullRomCurve3(
    [
      new Vector3(0, -0.2, 0),
      new Vector3(0.32 * potW * m, Cy * 0.22, 0.03 * R),
      new Vector3(-0.26 * potW * m, Cy * 0.52, 0.06 * R),
      new Vector3(0.12 * potW * m, Cy * 0.8, 0.09 * R),
      C,
      leaderTop,
    ],
    false,
    'centripetal',
  );
  const root = M.root;
  tube(W, spine, rT, rT * 0.22, big ? 40 : 64, big ? 12 : 18, {
    birth: root.born - 1,
    grow: 2.6,
    key: root.id,
    kind: 3,
    shape: (t) => 1 + 0.35 * Math.exp(-t * 10) + 0.06 * Math.sin(t * 23),
  });
  for (let k = 0; k < 7; k++) {
    // Nebari: surface roots flaring into the moss.
    const a = (k / 7) * Math.PI * 2 + 0.4 + rnd() * 0.4;
    const len = potW * (0.4 + rnd() * 0.28);
    tube(
      W,
      new CatmullRomCurve3([
        new Vector3(0, rT * 0.9, 0),
        new Vector3(Math.cos(a) * len * 0.4, 0.05, Math.sin(a) * len * 0.3),
        new Vector3(Math.cos(a) * len, -0.15, Math.sin(a) * len * 0.62),
      ]),
      rT * 0.55,
      0.05,
      10,
      8,
      { birth: root.born - 2, grow: 2.4, key: '', kind: 2 },
    );
  }
  // Jin: bleached dead stubs on the trunk, the mark of an old juniper.
  for (const [t0, side, len] of [
    [0.58, 1, 0.55],
    [0.78, -1, 0.42],
    [0.93, 1, 0.3],
  ] as const) {
    const P = spine.getPointAt(t0);
    const dir = new Vector3(side * m * 0.8, 0.55 + rnd() * 0.3, (rnd() - 0.4) * 0.6).normalize();
    const E = P.clone().addScaledVector(dir, potW * len);
    const mid = P.clone()
      .lerp(E, 0.5)
      .add(new Vector3((rnd() - 0.5) * 0.3, 0.12, (rnd() - 0.5) * 0.3).multiplyScalar(potW * 0.3));
    tube(W, new CatmullRomCurve3([P, mid, E]), rT * 0.32, 0.015, 8, 6, {
      birth: root.born + 6,
      grow: 2,
      key: '',
      kind: 5,
    });
  }
  const sp = spine.getSpacedPoints(80);
  const startFor = (child: Vector3) => {
    // side branches leave low on the trunk, upper ones higher up the leader
    const up = Math.max(0, (child.y - Cy) / R);
    const hy = Cy + Math.min(1, up) * (leaderTop.y - Cy) * 0.9;
    for (const q of sp) if (q.y >= hy - 1e-3 && q.y >= Cy * 0.98) return q.clone();
    return (sp[sp.length - 1] ?? C).clone();
  };
  const maxLeaves = Math.max(1, root.leaves);
  const rad = (leaves: number) => 0.03 + S * 0.03 + rT * 0.5 * Math.sqrt(leaves / maxLeaves);
  const down = new Vector3(0, -1, 0);
  for (const p of M.people) {
    if (p.mi || !p.parent || p.virt) continue;
    const par = M.get(p.parent);
    const c = atId(p.id);
    const a = isRoot(par) ? startFor(c) : atId(par.id);
    const d = c.clone().sub(a);
    const len = d.length();
    const short = len < S * 2.2;
    // wired look: dips out from the parent, then the tip rises to the pad
    const side = new Vector3(-d.y, d.x, 0).normalize().multiplyScalar(len * 0.07 * (rnd() < 0.5 ? -1 : 1));
    const curve = short
      ? new CatmullRomCurve3([
          a,
          a
            .clone()
            .lerp(c, 0.5)
            .addScaledVector(down, len * 0.12),
          c,
        ])
      : new CatmullRomCurve3(
          [
            a,
            a
              .clone()
              .addScaledVector(d, 0.33)
              .addScaledVector(down, len * 0.08)
              .add(side),
            a
              .clone()
              .addScaledVector(d, 0.72)
              .addScaledVector(down, len * 0.02),
            c,
          ],
          false,
          'centripetal',
        );
    tube(W, curve, rad(par.leaves) * 0.85, rad(p.leaves) * 0.7, short ? 5 : big ? 10 : 16, big ? 5 : 7, {
      birth: p.born,
      grow: short ? 1 : 1.6,
      key: p.id,
    });
  }
  for (const p of M.people) {
    // Marriage twig, gold: from the partner across to the spouse.
    if (!p.mi || !p.anchor) continue;
    const a = atId(p.anchor);
    const c = atId(p.id);
    tube(
      W,
      new CatmullRomCurve3([
        a,
        a
          .clone()
          .lerp(c, 0.5)
          .addScaledVector(down, S * 0.2),
        c,
      ]),
      rad(1) * 0.42,
      rad(1) * 0.34,
      6,
      5,
      { birth: spouseYear(M, p), grow: 1, key: p.id, kind: 1 },
    );
  }
  const barkGeo = bakeWood(W);
  const bark = juniperMaterial(U, Rg);
  bark.uni.uThick.value.set(rT * 0.35, rT * 0.8);
  group.add(new Mesh(barkGeo, bark.mat));

  // ---- foliage pads: lumpy clouds behind every slot of every pad; one instanced mesh ----
  const perCell = big ? 1 : 2;
  const puffH = big ? 0.78 : 0.62;
  let count = 0;
  for (const pad of L.pads) count += pad.cells.length * perCell;
  const puffGeo = new IcosahedronGeometry(1, 2);
  const pb = new Float32Array(count);
  const pd = new Float32Array(count);
  const ps = new Float32Array(count);
  const keys: string[] = [];
  const pads = padMaterial(U, Rg);
  const puffs = new InstancedMesh(puffGeo, pads.mat, Math.max(1, count));
  const mtx = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const v = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  let k = 0;
  for (const pad of L.pads) {
    const first = pad.members.reduce((y, p) => Math.min(y, p.born), 9999);
    const rootId = pad.roots[0] ?? root.id;
    for (const cell of pad.cells) {
      const p = cell.id ? M.get(cell.id) : null;
      for (let j = 0; j < perCell; j++, k++) {
        const edge = Math.min(1, ((cell.x - pad.x) / pad.rx) ** 2 + ((cell.y - pad.y) / pad.ry) ** 2);
        v.set(
          (cell.x + (rnd() - 0.5) * S * (j ? 0.9 : 0.3)) * m,
          cell.y - S * (0.2 + rnd() * 0.12) - j * S * 0.12,
          cell.z - S * (0.5 + rnd() * 0.25),
        );
        q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
        const s = S * (j ? 0.5 : big ? 0.74 : 0.66) * (0.85 + rnd() * 0.3) * (1 - edge * 0.25);
        sc.set(s * 1.3, s * puffH, s * 1.1);
        mtx.compose(v, q, sc);
        puffs.setMatrixAt(k, mtx);
        pb[k] = (p ? (p.mi ? spouseYear(M, p) : p.born) : first + 4) + rnd();
        pd[k] = (p?.died ?? 9999) + rnd();
        ps[k] = rnd();
        keys.push(p ? p.id : rootId);
      }
    }
  }
  puffGeo.setAttribute('aBirth', new InstancedBufferAttribute(pb, 1));
  puffGeo.setAttribute('aDeath', new InstancedBufferAttribute(pd, 1));
  puffGeo.setAttribute('aSeed', new InstancedBufferAttribute(ps, 1));
  puffGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(count), 1));
  puffGeo.userData.keys = keys;
  puffs.count = count;
  puffs.frustumCulled = false;
  group.add(puffs);

  // ---- shallow oval pot with a glossy glaze ----
  const PX = potW;
  const PZ = 0.64 * potW;
  const PH = 0.27 * potW;
  const potTop = 0.05 * potW;
  const prof = [
    [0.0, 0],
    [0.86, 0],
    [0.9, 0.03],
    [0.93, 0.12],
    [0.97, 0.78],
    [1.0, 0.9],
    [1.035, 0.94],
    [1.03, 1.0],
    [0.95, 1.0],
    [0.93, 0.86],
    [0.0, 0.86],
  ].map(([r, y]) => new Vector2(r ?? 0, y ?? 0));
  const potGeo = new LatheGeometry(prof, 96);
  potGeo.scale(PX, PH, PZ);
  potGeo.translate(0, potTop - PH, 0);
  potGeo.computeVertexNormals();
  const glaze = glazeMaterial(Rg);
  glaze.uni.uSize.value.set(PX, potTop - PH, PH);
  group.add(new Mesh(potGeo, glaze.mat));
  // Moss over the soil with gravel at the rim, and two small stones.
  const soilY = potTop - PH * 0.14;
  const mossGeo = new RingGeometry(0, 1, 72, 10);
  mossGeo.rotateX(-Math.PI / 2);
  {
    const mp = mossGeo.getAttribute('position');
    for (let i = 0; i < mp.count; i++) {
      const r2 = mp.getX(i) ** 2 + mp.getZ(i) ** 2;
      mp.setY(i, 0.012 * potW + (1 - r2) * 0.07 * potW);
    }
  }
  mossGeo.scale(PX * 0.94, 1, PZ * 0.92);
  mossGeo.translate(0, soilY, 0);
  const moss = mossMaterial(Rg);
  moss.uni.uRad.value.set(PX * 0.94, PZ * 0.92, 0);
  group.add(new Mesh(mossGeo, moss.mat));
  const stone = stoneMaterial(Rg);
  const stones = new InstancedMesh(new IcosahedronGeometry(1, 2), stone.mat, 2);
  mtx.compose(
    new Vector3(-0.42 * PX * m, soilY + 0.03 * potW, 0.25 * PZ),
    new Quaternion().setFromAxisAngle(yAxis, 0.6),
    new Vector3(0.2 * potW, 0.11 * potW, 0.15 * potW),
  );
  stones.setMatrixAt(0, mtx);
  mtx.compose(
    new Vector3(-0.27 * PX * m, soilY + 0.015 * potW, 0.42 * PZ),
    new Quaternion().setFromAxisAngle(yAxis, 1.9),
    new Vector3(0.09 * potW, 0.05 * potW, 0.075 * potW),
  );
  stones.setMatrixAt(1, mtx);
  group.add(stones);

  // ---- plinth (lacquer by night, gallery white by day) on a seamless sweep ----
  const floorY = potTop - PH;
  const plW = PX * 2.7;
  const plD = PZ * 2.7;
  const plH = R * 2.2;
  const plinthGeo = new RoundedBoxGeometry(plW, plH, plD, 4, Math.min(plW, plD) * 0.025);
  plinthGeo.translate(0, floorY - plH / 2, 0);
  const plinth = plinthMaterial(Rg);
  plinth.uni.uPot.value.set(PX * 1.02, PZ * 1.02, floorY);
  group.add(new Mesh(plinthGeo, plinth.mat));
  const baseY = floorY - plH;
  const back = -1.6 * R;
  const bend = 2.2 * R;
  const prof2: Array<[number, number]> = [];
  for (let j = 0; j <= 10; j++) prof2.push([baseY, 600 - (j / 10) * (600 - back)]);
  for (let j = 1; j <= 24; j++) {
    const a = (j / 24) * (Math.PI / 2);
    prof2.push([baseY + bend * (1 - Math.cos(a)), back - bend * Math.sin(a)]);
  }
  for (let j = 1; j <= 8; j++) prof2.push([baseY + bend + (j / 8) * 1400, back - bend]);
  const sv: number[] = [];
  const si: number[] = [];
  const cols = 24;
  prof2.forEach(([y, z], j) => {
    for (let c = 0; c <= cols; c++) {
      sv.push((c / cols - 0.5) * 2000, y, z);
      if (j > 0 && c < cols) {
        const a = (j - 1) * (cols + 1) + c;
        const b = j * (cols + 1) + c;
        si.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  const sweepGeo = new BufferGeometry();
  sweepGeo.setAttribute('position', new Float32BufferAttribute(sv, 3));
  sweepGeo.setIndex(si);
  const sweep = sweepMaterial();
  sweep.uni.uCentre.value.set(0, Cy * 0.75, back - bend);
  sweep.uni.uSpan.value = R * 4.2;
  group.add(new Mesh(sweepGeo, sweep.mat));
  const dome = domeMaterial();
  const domeMesh = new Mesh(new SphereGeometry(2600, 16, 8), dome.mat);
  domeMesh.renderOrder = -2;
  group.add(domeMesh);

  // ---- night: dust motes drifting through the key light above the crown ----
  const dN = big ? 70 : 50;
  const dp = new Float32Array(dN * 3);
  const dph = new Float32Array(dN);
  for (let i = 0; i < dN; i++) {
    dp.set([(rnd() - 0.5) * R * 3, Cy + (rnd() - 0.3) * R * 1.4, Cz + (rnd() - 0.5) * R * 1.6], i * 3);
    dph[i] = rnd() * 40;
  }
  const dg = new BufferGeometry();
  dg.setAttribute('position', new BufferAttribute(dp, 3));
  dg.setAttribute('aPh', new BufferAttribute(dph, 1));
  const dust = dustMaterial(
    U,
    softTex([
      [0, 'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
  );
  const motes = new Points(dg, dust.mat);
  trackPointScale(motes, dust.uni.uPx);
  motes.frustumCulled = false;
  group.add(motes);

  const tint = () => {
    const lk = ctx.dark() ? LOOK.dark : LOOK.light;
    const flat = (hex: string) => untone(hex, lk.exposure);
    setStudio(Rg, lk, lin, flat);
    bark.uni.uBarkA.value.copy(lin(lk.barkA));
    bark.uni.uBarkB.value.copy(lin(lk.barkB));
    bark.uni.uShari.value.copy(lin(lk.shari));
    pads.uni.uLow.value.copy(lin(lk.leafA));
    pads.uni.uTop.value.copy(lin(lk.leafB));
    pads.uni.uDead.value.copy(lin(lk.dead));
    glaze.uni.uA.value.copy(lin(lk.glazeA));
    glaze.uni.uB.value.copy(lin(lk.glazeB));
    glaze.uni.uClay.value.copy(lin(lk.clay));
    glaze.uni.uCrackle.value = lk.crackle;
    moss.uni.uMoss.value.copy(lin(lk.moss));
    moss.uni.uSoil.value.copy(lin(lk.soil));
    moss.uni.uGravel.value.copy(lin(lk.gravel));
    stone.uni.uC.value.copy(lin(lk.stone));
    plinth.uni.uBody.value.copy(lin(lk.stand));
    plinth.uni.uEdge.value.copy(lin(lk.standEdge));
    plinth.uni.uGloss.value = lk.dark ? 1 : 0;
    plinth.uni.uShade.value.copy(lk.dark ? lin('#000000') : lin('#9d9d9d'));
    sweep.uni.uIn.value.copy(flat(lk.wallIn));
    sweep.uni.uOut.value.copy(flat(lk.wallOut));
    dome.uni.uC.value.copy(flat(lk.wallOut));
    dust.uni.uCol.value.copy(lin(lk.dust));
    motes.visible = lk.dark;
    ctx.look(lk.bloom, lk.exposure);
  };
  tint();

  // Default camera: the whole tree, the pot and the plinth's top edge, slightly from above and to the key-light side.
  const frame: Vector3[] = [];
  for (let i = 0; i < M.n; i++) frame.push(at(i));
  for (const pad of L.pads) for (const c of pad.cells) frame.push(new Vector3(c.x * m, c.y, c.z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(new Vector3(sx * PX, floorY - PH * 0.5, sz * PZ));
  const dir = new Vector3(-0.14 * m, 0.24, 1).normalize();
  const view = fitView(frame, disc * 0.9, dir, 1.45, 0.86);
  return {
    key: 'bonsai',
    group,
    pos,
    size,
    style: 0,
    lift: 3,
    tint,
    hiTargets: [{ geo: barkGeo }, { geo: puffGeo, perPerson: true }],
    focus: [Rg.uFocus],
    view,
    follow: big ? 22 : 34,
    labelScale: 0.78,
  };
};
