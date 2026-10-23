import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  Vector3,
} from 'three';
import { skyDome } from '../gl.ts';
import { lin } from '../palette.ts';
import { type Channel, layoutDelta } from './delta-layout.ts';
import { discMat, groundMat, LOOK, pinMat, waterMat } from './delta-mat.ts';
import type { SceneBuilder } from './types.ts';

// River Delta: the founder's river leaves the hills and splits again and again into
// distributaries, one per line of descent, fanning out to the sea. Settlements sit at each
// fork; channel width follows how many people flow through it; spouses join on side
// tributaries tinted with their own family's colour. Arabic mirrors the fan.
// Draw calls: ground, all channels (one mesh), settlements (instanced), pins, sky.

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
  col: number[];
  key: string[];
  idx: number[];
}

/** Flat ribbon along a centre line (two vertices per sample, u = -1..1 across). */
function ribbon(B: Ribbon, c: Channel, extra: number, bank: boolean) {
  const { pts } = c;
  const n = pts.length;
  if (n < 2) return;
  const base = B.pos.length / 3;
  const col = lin(c.col);
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
      B.col.push(col.r, col.g, col.b);
      B.key.push(c.key);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    B.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

export const deltaScene: SceneBuilder = (ctx) => {
  const { M, U, big } = ctx;
  const group = new Group();
  const size = big ? 0.82 : 1.1;
  const rtl = ctx.rtl();
  const D = layoutDelta(M, big, rtl, size);
  const { Rc, H } = D;

  // ---- ground: hills, wetlands and sea in one shaded grid ----
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
  const ground = groundMat(U);
  ground.uni.uRc.value = Rc;
  ground.uni.uHalf.value = D.half;
  ground.uni.uZm.value = D.zMain;
  ground.uni.uH.value = H;
  group.add(new Mesh(gg, ground.mat));

  // ---- channels: every bank first, then every water surface, in one mesh ----
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
    col: [],
    key: [],
    idx: [],
  };
  for (const c of D.channels) if (c.bank) ribbon(B, c, (big ? 0.4 : 0.5) + (c.hw0 + c.hw1) * 0.22, true);
  for (const c of D.channels) ribbon(B, c, 0, false);
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
  wg.setAttribute('aCol', new Float32BufferAttribute(B.col, 3));
  wg.setAttribute('aHi', new Float32BufferAttribute(new Float32Array(B.key.length), 1));
  wg.setIndex(B.idx);
  wg.userData.keys = B.key;
  const water = waterMat(U);
  const waterMesh = new Mesh(wg, water.mat);
  waterMesh.renderOrder = 1;
  group.add(waterMesh);

  // ---- settlements and portraits ----
  const lift = size * 2.1 + 0.4;
  const pos = new Float32Array(M.n * 3);
  const discGeo = new CylinderGeometry(1, 1, 1, 28, 1);
  discGeo.translate(0, 0.5, 0);
  const discs = new InstancedMesh(discGeo, undefined, M.n);
  const born = new Float32Array(M.n);
  const dcol = new Float32Array(M.n * 3);
  const m4 = new Matrix4();
  const pins: number[] = [];
  const pinT: number[] = [];
  const pinB: number[] = [];
  M.people.forEach((p, i) => {
    const g = D.ground[i] ?? new Vector3();
    const y = g.y + lift * (p === M.root ? 1.25 : 1);
    pos.set([g.x, y, g.z], i * 3);
    const r = size * (p === M.root ? 1.05 : p.mi ? 0.5 : 0.72);
    m4.makeScale(r, big ? 0.22 : 0.3, r).setPosition(g.x, g.y + 0.04, g.z);
    discs.setMatrixAt(i, m4);
    born[i] = p.born;
    const c = lin(p.color);
    dcol.set([c.r, c.g, c.b], i * 3);
    pins.push(g.x, g.y + 0.3, g.z, g.x, y - size * 1.05, g.z);
    pinT.push(0, 1);
    pinB.push(p.born, p.born);
  });
  discGeo.setAttribute('aBorn', new InstancedBufferAttribute(born, 1));
  discGeo.setAttribute('aCol', new InstancedBufferAttribute(dcol, 3));
  const disc = discMat(U);
  discs.material = disc.mat;
  discs.frustumCulled = false;
  group.add(discs);
  const pg = new BufferGeometry();
  pg.setAttribute('position', new Float32BufferAttribute(pins, 3));
  pg.setAttribute('aT', new Float32BufferAttribute(pinT, 1));
  pg.setAttribute('aBirth', new Float32BufferAttribute(pinB, 1));
  const pin = pinMat(U);
  const pinLines = new LineSegments(pg, pin.mat);
  pinLines.renderOrder = 2;
  group.add(pinLines);

  const sky = skyDome(LOOK.light.top, LOOK.light.hor, LOOK.light.haze);
  group.add(sky.mesh);

  const tint = () => {
    const L = ctx.dark() ? LOOK.dark : LOOK.light;
    const night = L.dark ? 1 : 0;
    sky.set(L.top, L.hor, L.haze);
    const G = ground.uni;
    G.uNight.value = night;
    G.uWetA.value.copy(lin(L.wetA));
    G.uWetB.value.copy(lin(L.wetB));
    G.uForest.value.copy(lin(L.forest));
    G.uSand.value.copy(lin(L.sand));
    G.uRock.value.copy(lin(L.rock));
    G.uLake.value.copy(lin(L.lake));
    G.uShal.value.copy(lin(L.shal));
    G.uDeep.value.copy(lin(L.deep));
    G.uTurbid.value.copy(lin(L.turbid));
    G.uFoam.value.copy(lin(L.foam));
    G.uHaze.value.copy(lin(L.haze));
    const W = water.uni;
    W.uNight.value = night;
    W.uShallow.value.copy(lin(L.shallow));
    W.uChannel.value.copy(lin(L.channel));
    W.uBankIn.value.copy(lin(L.bankIn));
    W.uBankOut.value.copy(lin(L.bankOut));
    W.uStreak.value.copy(lin(L.streak));
    W.uHi.value.copy(lin(L.hi));
    W.uHaze.value.copy(lin(L.haze));
    for (const u of [G, W]) {
      u.uHazeNear.value = Rc * 2.2 + 80;
      u.uHazeFar.value = Rc * 6 + 300;
    }
    disc.uni.uNight.value = night;
    disc.uni.uDisc.value.copy(lin(L.disc));
    disc.uni.uLight.value.copy(lin(L.light));
    pin.uni.uC.value.copy(lin(L.pin));
    pin.setAdd(L.dark);
    ctx.look(L.bloom, L.exposure);
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
    hiTargets: [{ geo: wg }],
    focus: [water.uni.uFocus, ground.uni.uFocus],
    view,
    follow: big ? 36 : 34,
    dir: rtl ? -1 : 1,
    relang: () => {
      view.cam.copy(camAt(ctx.rtl()));
    },
  };
};
