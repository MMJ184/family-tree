import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spouseYear } from '../model.ts';
import { lin, rng } from '../palette.ts';
import { type Channel, layoutDelta } from './delta-layout.ts';
import {
  backdropMat,
  groundMat,
  houseMat,
  LOOK,
  makeLight,
  mangroveMat,
  pinMat,
  poolMat,
  waterMat,
} from './delta-mat.ts';
import type { SceneBuilder } from './types.ts';

// River Delta: a Gulf khor seen from a drone. The founder's river leaves the hills and splits again
// and again into distributaries, one per line of descent, across white salt flats (sabkha) lined with
// mangroves, out to the sea. Each settlement is a small village at a fork; channel width follows how
// many people flow through it; spouses settle on gold tributaries that join just above their
// partner's fork, alternating sides. Arabic mirrors the fan.
// Draw calls: backdrop, ground, channels (one mesh), village pools, houses, mangroves, pins.

interface Ribbon {
  pos: number[];
  t: number[];
  u: number[];
  s: number[];
  w: number[];
  birth: number[];
  grow: number[];
  tint: number[];
  bank: number[];
  fade: number[];
  key: string[];
  idx: number[];
}

/** Flat ribbon along a centre line (two vertices per sample, u = -1..1 across). */
function ribbon(B: Ribbon, c: Channel, extra: number, bank: boolean) {
  const { pts } = c;
  const n = pts.length;
  if (n < 2) return;
  const base = B.pos.length / 3;
  let s = c.s0;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as Vector3;
    const a = pts[Math.max(0, i - 1)] as Vector3;
    const b = pts[Math.min(n - 1, i + 1)] as Vector3;
    if (i) s += p.distanceTo(a);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const t = i / (n - 1);
    const hw = c.hw0 + (c.hw1 - c.hw0) * t * t;
    const w = hw + extra;
    for (const side of [-1, 1]) {
      B.pos.push(p.x - tz * w * side, p.y - (bank ? 0.02 : 0), p.z + tx * w * side);
      B.t.push(t);
      B.u.push(side);
      B.s.push(s);
      B.w.push(hw * 2);
      B.birth.push(c.birth);
      B.grow.push(c.grow);
      B.tint.push(c.tint);
      B.bank.push(bank ? 1 : 0);
      B.fade.push(c.fade);
      B.key.push(c.key);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    B.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

/** Spatial hash of channel centre lines: is a ground point on (or too near) the water? */
function waterIndex(channels: Channel[]) {
  let maxHw = 0;
  for (const c of channels) maxHw = Math.max(maxHw, c.hw0, c.hw1);
  const cell = Math.max(2, maxHw + 1.5);
  const map = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const c of channels) {
    const n = c.pts.length;
    for (let i = 0; i < n - 1; i++) {
      const a = c.pts[i] as Vector3;
      const b = c.pts[i + 1] as Vector3;
      const k = Math.max(1, Math.ceil(a.distanceTo(b) / (cell * 0.25)));
      for (let j = 0; j < k; j++) {
        const f = j / k;
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        const t = (i + f) / (n - 1);
        const list = map.get(key(x, z)) ?? [];
        list.push(x, z, c.hw0 + (c.hw1 - c.hw0) * t * t);
        map.set(key(x, z), list);
      }
    }
  }
  return (x: number, z: number, margin: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = map.get(`${cx + a},${cz + b}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i += 3)
          if (Math.hypot((list[i] as number) - x, (list[i + 1] as number) - z) < (list[i + 2] as number) + margin)
            return true;
      }
    return false;
  };
}

/** Points near which nothing busy may grow (under the portraits). */
function pointIndex(pts: Vector3[], cell: number) {
  const map = new Map<string, Vector3[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const p of pts) map.set(key(p.x, p.z), [...(map.get(key(p.x, p.z)) ?? []), p]);
  return (x: number, z: number, r: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const p of map.get(`${cx + a},${cz + b}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < r) return true;
    return false;
  };
}

/** A mangrove clump: three faceted, squashed blobs. */
function clumpGeometry() {
  const parts = [
    [0, 0.34, 0, 0.62, 0.42],
    [0.42, 0.24, 0.18, 0.44, 0.32],
    [-0.3, 0.22, -0.28, 0.42, 0.3],
  ].map(([x, y, z, r, h]) => {
    const g = new IcosahedronGeometry(1, 0);
    g.scale(r as number, h as number, r as number);
    g.translate(x as number, y as number, z as number);
    return g;
  });
  const g = mergeGeometries(parts) ?? new BufferGeometry();
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  return g;
}

export const deltaScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const size = big ? 0.82 : 1.1;
  const rtl = ctx.rtl();
  const D = layoutDelta(M, big, rtl, size);
  const { Rc, H } = D;
  const L = makeLight();

  // ---- ground: hills, salt flats, tidal flats and sea in one shaded grid ----
  const { x0, x1, z0, z1, nx, nz } = D.grid;
  const gp = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      gp.set([x, D.height(x, z), z], (j * (nx + 1) + i) * 3);
    }
  const gi: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      gi.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const gg = new BufferGeometry();
  gg.setAttribute('position', new Float32BufferAttribute(gp, 3));
  gg.setIndex(gi);
  gg.computeVertexNormals();
  const ground = groundMat(U, L);
  ground.uni.uRc.value = Rc;
  ground.uni.uHalf.value = D.half;
  ground.uni.uZm.value = D.zMain;
  ground.uni.uH.value = H;
  ground.uni.uCentre.value.set(0, Rc * 0.28);
  ground.uni.uWorld.value.set(Rc * 1.6, Rc * 1.35);
  const groundMesh = new Mesh(gg, ground.mat);
  group.add(groundMesh);

  // ---- channels: every levee first, then every water surface, in one mesh ----
  const B: Ribbon = {
    pos: [],
    t: [],
    u: [],
    s: [],
    w: [],
    birth: [],
    grow: [],
    tint: [],
    bank: [],
    fade: [],
    key: [],
    idx: [],
  };
  // Levees first, then the gold tributaries, then the channels they flow into (drawn over their ends).
  for (const c of D.channels) if (c.bank) ribbon(B, c, (big ? 0.35 : 0.45) + (c.hw0 + c.hw1) * 0.2, true);
  for (const c of D.channels) if (c.tint) ribbon(B, c, 0, false);
  for (const c of D.channels) if (!c.tint) ribbon(B, c, 0, false);
  const wg = new BufferGeometry();
  wg.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
  wg.setAttribute('aT', new Float32BufferAttribute(B.t, 1));
  wg.setAttribute('aU', new Float32BufferAttribute(B.u, 1));
  wg.setAttribute('aS', new Float32BufferAttribute(B.s, 1));
  wg.setAttribute('aW', new Float32BufferAttribute(B.w, 1));
  wg.setAttribute('aBirth', new Float32BufferAttribute(B.birth, 1));
  wg.setAttribute('aGrow', new Float32BufferAttribute(B.grow, 1));
  wg.setAttribute('aTint', new Float32BufferAttribute(B.tint, 1));
  wg.setAttribute('aBank', new Float32BufferAttribute(B.bank, 1));
  wg.setAttribute('aFade', new Float32BufferAttribute(B.fade, 1));
  wg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  wg.setIndex(B.idx);
  wg.userData.keys = B.key;
  const water = waterMat(U, L);
  const waterMesh = new Mesh(wg, water.mat);
  waterMesh.renderOrder = 1;
  group.add(waterMesh);

  const wet = waterIndex(D.channels);
  const nearHome = pointIndex(D.ground, Math.max(2, size * 2));
  const born = (p: (typeof M.people)[number]) => (p.mi ? spouseYear(M, p) : p.born);

  // ---- villages: a few flat-roofed houses on the banks just above each fork ----
  const hr = rng(31);
  const plan: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; a: number; i: number }> = [];
  M.people.forEach((p, i) => {
    const f = D.frames[i];
    if (!f) return;
    const root = p === M.root;
    const n = root ? 9 : p.mi ? (big ? 2 : 3) : big ? 3 : 5;
    const nx2 = -f.dz;
    const nz2 = f.dx;
    for (let h = 0; h < n; h++) {
      for (let tries = 0; tries < 10; tries++) {
        const side = (h + tries) % 2 ? 1 : -1;
        const lat = f.hw + size * (0.5 + hr() * (root ? 1.6 : 1.05));
        const along = -size * (0.1 + hr() * (root ? 2 : 1.35));
        const x = f.x + nx2 * side * lat + f.dx * along;
        const z = f.z + nz2 * side * lat + f.dz * along;
        if (wet(x, z, 0.32 * size)) continue;
        const w = size * (0.3 + hr() * 0.2) * (root && h === 0 ? 1.6 : 1);
        plan.push({
          x,
          y: Math.max(0, D.height(x, z)),
          z,
          w,
          d: size * (0.28 + hr() * 0.18) * (root && h === 0 ? 1.4 : 1),
          h: size * (0.2 + hr() * 0.14) * (root && h === 0 ? 1.5 : 1),
          a: Math.atan2(f.dx, f.dz) + (hr() - 0.5) * 0.35,
          i,
        });
        break;
      }
    }
  });
  const boxGeo = new BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const houses = new InstancedMesh(boxGeo, undefined, Math.max(1, plan.length));
  const hBirth = new Float32Array(houses.count).fill(9999);
  const hSeed = new Float32Array(houses.count);
  const hKeys: string[] = [];
  const m4 = new Matrix4();
  const qy = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const v3 = new Vector3();
  const sc = new Vector3();
  plan.forEach((h, k) => {
    const p = M.people[h.i];
    if (!p) return;
    qy.setFromAxisAngle(up, h.a);
    m4.compose(v3.set(h.x, h.y - 0.02, h.z), qy, sc.set(h.w, h.h, h.d));
    houses.setMatrixAt(k, m4);
    hBirth[k] = born(p);
    hSeed[k] = hr();
    hKeys.push(p.id);
  });
  if (!plan.length) hKeys.push('');
  boxGeo.setAttribute('aBirth', new InstancedBufferAttribute(hBirth, 1));
  boxGeo.setAttribute('aSeed', new InstancedBufferAttribute(hSeed, 1));
  boxGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(houses.count), 1));
  boxGeo.userData.keys = hKeys;
  const house = houseMat(U, L);
  houses.material = house.mat;
  houses.frustumCulled = false;
  group.add(houses);

  // ---- a light pool (night) or soft shadow (day) under each village ----
  const poolGeo = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(2, 2);
  poolGeo.index = quad.index;
  poolGeo.setAttribute('position', quad.getAttribute('position'));
  const aPool = new Float32Array(M.n * 4);
  const aPoolBirth = new Float32Array(M.n);
  M.people.forEach((p, i) => {
    const f = D.frames[i];
    if (!f) return;
    const r = size * (p === M.root ? 3.2 : p.mi ? 1.1 : 2.1);
    aPool.set([f.x - f.dx * size * 0.5, f.y, f.z - f.dz * size * 0.5, r], i * 4);
    aPoolBirth[i] = born(p);
  });
  poolGeo.setAttribute('aPool', new InstancedBufferAttribute(aPool, 4));
  poolGeo.setAttribute('aBirth', new InstancedBufferAttribute(aPoolBirth, 1));
  poolGeo.setAttribute('aHi', new InstancedBufferAttribute(new Float32Array(M.n), 1));
  poolGeo.userData.keys = M.people.map((p) => p.id);
  poolGeo.instanceCount = M.n;
  const pool = poolMat(U, L);
  const poolMesh = new Mesh(poolGeo, pool.mat);
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 0;
  group.add(poolMesh);

  // ---- mangroves: fringes along the lower channels, thickening toward the coast ----
  const mr = rng(77);
  const cap = big ? 2600 : 1700;
  const mPlan: number[] = [];
  const spacing = big ? 1.1 : 0.55;
  for (const c of D.channels) {
    if (c.tint || c.fade) continue;
    const n = c.pts.length;
    for (let i = 0; i < n - 1 && mPlan.length / 6 < cap; i++) {
      const a = c.pts[i] as Vector3;
      const b = c.pts[i + 1] as Vector3;
      const len = a.distanceTo(b);
      const k = Math.max(1, Math.round(len / spacing));
      const tx = (b.x - a.x) / (len || 1);
      const tz = (b.z - a.z) / (len || 1);
      for (let j = 0; j < k; j++) {
        const f = j / k;
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        const r = Math.hypot(x, z) / Rc;
        if (z < 0 || r < 0.4 || r > 1.01 || Math.abs(Math.atan2(x, z)) > D.half) continue;
        const prob = Math.min(1, Math.max(0, (r - 0.42) / 0.45)) ** 1.2 * (big ? 0.55 : 0.95);
        if (mr() > prob) continue;
        const t = (i + f) / (n - 1);
        const hw = c.hw0 + (c.hw1 - c.hw0) * t * t;
        const side = mr() < 0.5 ? -1 : 1;
        const lat = hw + 0.22 + mr() ** 2 * (big ? 0.7 : 0.9);
        const px = x - tz * lat * side;
        const pz = z + tx * lat * side;
        if (wet(px, pz, 0.18) || nearHome(px, pz, size * 1.9)) continue;
        const s = (0.32 + mr() * 0.45) * (big ? 1.15 : 1) * (0.7 + r * 0.4);
        mPlan.push(px, pz, s, mr() * Math.PI * 2, c.birth + t * c.grow + 2 + mr() * 3, mr());
      }
    }
  }
  const mN = Math.max(1, mPlan.length / 6);
  const clump = clumpGeometry();
  const mangroves = new InstancedMesh(clump, undefined, mN);
  const mBirth = new Float32Array(mN).fill(9999);
  const mTone = new Float32Array(mN);
  for (let k = 0; k < mPlan.length / 6; k++) {
    const [px, pz, s, rot, yb, tone] = mPlan.slice(k * 6, k * 6 + 6) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    qy.setFromAxisAngle(up, rot);
    m4.compose(v3.set(px, -0.04, pz), qy, sc.set(s, s * (0.85 + tone * 0.3), s));
    mangroves.setMatrixAt(k, m4);
    mBirth[k] = yb;
    mTone[k] = tone;
  }
  clump.setAttribute('aBirth', new InstancedBufferAttribute(mBirth, 1));
  clump.setAttribute('aTone', new InstancedBufferAttribute(mTone, 1));
  const mang = mangroveMat(U, L);
  mangroves.material = mang.mat;
  mangroves.frustumCulled = false;
  group.add(mangroves);

  // ---- portraits above their villages, on thin pins ----
  const lift = size * 2.1 + 0.4;
  const pos = new Float32Array(M.n * 3);
  const pins: number[] = [];
  const pinT: number[] = [];
  const pinB: number[] = [];
  const pinKeys: string[] = [];
  M.people.forEach((p, i) => {
    const g = D.ground[i] ?? new Vector3();
    const y = g.y + lift * (p === M.root ? 1.25 : 1);
    pos.set([g.x, y, g.z], i * 3);
    pins.push(g.x, g.y + 0.1, g.z, g.x, y - size * 1.05, g.z);
    pinT.push(0, 1);
    pinB.push(born(p), born(p));
    pinKeys.push(p.id, p.id);
  });
  const pg = new BufferGeometry();
  pg.setAttribute('position', new Float32BufferAttribute(pins, 3));
  pg.setAttribute('aT', new Float32BufferAttribute(pinT, 1));
  pg.setAttribute('aBirth', new Float32BufferAttribute(pinB, 1));
  pg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(pinKeys.length), 1));
  pg.userData.keys = pinKeys;
  const pin = pinMat(U, L);
  const pinLines = new LineSegments(pg, pin.mat);
  pinLines.renderOrder = 2;
  group.add(pinLines);

  // ---- backdrop: the stage colour all round ----
  const back = backdropMat(L);
  const backMesh = new Mesh(new SphereGeometry(1400, 16, 8), back.mat);
  backMesh.renderOrder = -2;
  backMesh.frustumCulled = false;
  group.add(backMesh);

  const sunDir = () => {
    const night = ctx.dark();
    // Day: a high sun from the upper start side (hillshade convention). Night: the moon behind the hills.
    L.uSun.value.set(night ? -0.3 : -0.42, night ? 0.62 : 0.86, night ? -0.72 : -0.12).normalize();
    if (ctx.rtl()) L.uSun.value.x *= -1;
  };
  const tint = () => {
    const K = ctx.dark() ? LOOK.dark : LOOK.light;
    sunDir();
    L.uNight.value = K.night ? 1 : 0;
    L.uExpo.value = K.exposure;
    L.uAmb.value = K.amb;
    L.uDim.value = K.dim;
    L.uBg.value.copy(lin(K.bg));
    L.uLightCol.value.copy(lin(K.light));
    const G = ground.uni;
    G.uSalt.value.copy(lin(K.salt));
    G.uSaltShade.value.copy(lin(K.saltShade));
    G.uCrack.value.copy(lin(K.crack));
    G.uRock.value.copy(lin(K.rock));
    G.uRockShade.value.copy(lin(K.rockShade));
    G.uRim.value.copy(lin(K.rim));
    G.uFlat.value.copy(lin(K.flat));
    G.uSeaNear.value.copy(lin(K.seaNear));
    G.uSeaFar.value.copy(lin(K.seaFar));
    G.uGlint.value.copy(lin(K.glint));
    const W = water.uni;
    W.uShallow.value.copy(lin(K.shallow));
    W.uDeep.value.copy(lin(K.deep));
    W.uStreak.value.copy(lin(K.streak));
    W.uFront.value.copy(lin(K.front));
    W.uBank.value.copy(lin(K.bank));
    W.uGold.value.copy(lin(K.gold));
    W.uTeal.value.copy(lin(K.teal));
    house.uni.uWall.value.copy(lin(K.wall));
    house.uni.uRoof.value.copy(lin(K.roof));
    house.uni.uWin.value.copy(lin(K.window));
    pool.uni.uWin.value.copy(lin(K.window));
    pool.setNight(K.night);
    mang.uni.uLeaf.value.copy(lin(K.mangrove));
    mang.uni.uLeafLit.value.copy(lin(K.mangroveLit));
    mang.uni.uRim.value.copy(lin(K.rim));
    pin.uni.uC.value.copy(lin(K.pin));
    ctx.look(K.bloom, K.exposure);
  };

  // Default view: a drone over the sea looking back up the delta to the hills.
  const target = new Vector3(0, 0, Rc * 0.36);
  const dist = Rc * (big ? 1.95 : 1.7) + 12;
  const pitch = 0.98;
  const az = 0.16;
  const camAt = (r: boolean) =>
    new Vector3(
      (r ? -1 : 1) * Math.sin(az) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      target.z + Math.cos(az) * Math.cos(pitch) * dist,
    );
  const view = { target, cam: camAt(rtl) };

  return {
    key: 'delta',
    group,
    pos,
    size,
    style: 0,
    lift: 5,
    labelScale: 0.85,
    tint,
    hiTargets: [
      { geo: wg },
      { geo: boxGeo, perPerson: true },
      { geo: poolGeo, perPerson: true },
      { geo: pg, perPerson: true },
    ],
    focus: [L.uFocus],
    view,
    follow: big ? 36 : 34,
    dir: rtl ? -1 : 1,
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
      sunDir();
    },
  };
};
