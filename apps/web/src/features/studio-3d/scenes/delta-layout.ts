import { QuadraticBezierCurve3, Vector3 } from 'three';
import { type StudioModel, type StudioPerson, spouseYear } from '../model.ts';
import { rng } from '../palette.ts';

// River Delta layout. The founder sits at the apex where the river leaves the hills; every
// person born in is a settlement at the fork where their children's channels split off.
// Channels run in polar space (angle from the main flow, radius from the apex): each person
// owns an angular sector sized by their leaf count, so channels nest and never cross. A
// node is pushed downstream until its sector is wide enough for a portrait, so big
// branches fork near the apex and small ones near the coast, as in a real fan delta.
// Childless lines run on to the sea. Married-in spouses arrive along a side tributary.

export interface Channel {
  pts: Vector3[];
  hw0: number;
  hw1: number;
  birth: number;
  grow: number;
  key: string;
  col: string;
  tint: number;
  /** Distance from the spring at pts[0] (flow animation runs on it). */
  s0: number;
  /** Draw levee banks along it. */
  bank: boolean;
}

export interface DeltaLayout {
  /** Ground point under each portrait. */
  ground: Vector3[];
  channels: Channel[];
  /** Coast radius of the delta lobe, half spread, mainland coast z, hill depth and height. */
  Rc: number;
  half: number;
  zMain: number;
  T: number;
  H: number;
  height(x: number, z: number): number;
  /** Ground grid: extents and resolution (the valley is carved at least a cell wider than the trunk). */
  grid: { x0: number; x1: number; z0: number; z1: number; nx: number; nz: number };
}

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const fbm = (x: number, y: number) => {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
};
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Channel width from the number of people whose line flows through it (hydraulic width ~ sqrt of discharge). */
export const widthOf = (D: number, big: boolean) => (big ? 0.28 : 0.32) + (big ? 0.2 : 0.42) * D ** 0.6;

export function layoutDelta(M: StudioModel, big: boolean, rtl: boolean, size: number): DeltaLayout {
  const sx = rtl ? -1 : 1;
  const S = big ? 2.5 : 2.1; // fan spread (radians): an arcuate, Nile-like fan
  const sp = size * (big ? 1.85 : 2.7); // room each settlement needs across the fan
  const step = big ? 12 : 15;
  const lane = big ? 0.62 : sp * 0.55; // channel spacing across the fan
  const L = Math.max(1, M.root.leaves);
  const rnd = rng(23);

  // ---- who flows through whom ----
  const spousesOf = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    spousesOf.set(p.anchor, [...(spousesOf.get(p.anchor) ?? []), p]);
  }
  for (const list of spousesOf.values()) list.sort((a, b) => spouseYear(M, a) - spouseYear(M, b));
  const D = new Map<string, number>();
  const count = (id: string): number => {
    const p = M.get(id);
    const n = 1 + (spousesOf.get(id)?.length ?? 0) + p.kids.reduce((s, k) => s + count(k), 0);
    D.set(id, n);
    return n;
  };
  count(M.root.id);
  const hwOf = (id: string) => widthOf(D.get(id) ?? 1, big) / 2;

  // ---- polar placement: thin angular slots for channels; settlements slide downstream until clear ----
  const R = new Map<string, number>([[M.root.id, 0]]);
  const TH = new Map<string, number>([[M.root.id, 0]]);
  const grid = new Map<string, Array<[number, number]>>();
  const cellOf = (v: number) => Math.floor(v / sp);
  const free = (x: number, z: number) => {
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const [px, pz] of grid.get(`${cellOf(x) + a},${cellOf(z) + b}`) ?? [])
          if (Math.hypot(px - x, pz - z) < sp) return false;
    return true;
  };
  const mark = (x: number, z: number) => {
    const k = `${cellOf(x)},${cellOf(z)}`;
    grid.set(k, [...(grid.get(k) ?? []), [x, z]]);
  };
  mark(0, 0);
  const back = sp * 1.05; // spouse settlements sit upstream on the person's own channel
  const order: StudioPerson[] = [];
  const q = [M.root];
  while (q.length) {
    const p = q.shift() as StudioPerson;
    order.push(p);
    for (const k of p.kids) {
      const kid = M.get(k);
      const th = (kid.ang - 0.5) * S * sx;
      const nsp = spousesOf.get(k)?.length ?? 0;
      const r0 = R.get(p.id) ?? 0;
      const slot = (lane * L) / (Math.max(1, kid.leaves) * S);
      let r = Math.max(r0 + step * Math.max(1, kid.gen - p.gen), r0 + back * (nsp + 1) + sp * 0.4, slot);
      const ok = (rr: number) => {
        for (let j = 0; j <= nsp; j++) {
          const r1 = rr - back * j;
          if (!free(r1 * Math.sin(th), r1 * Math.cos(th))) return false;
        }
        return true;
      };
      for (let it = 0; it < 400 && !ok(r); it++) r += sp * 0.3;
      for (let j = 0; j <= nsp; j++) mark((r - back * j) * Math.sin(th), (r - back * j) * Math.cos(th));
      R.set(k, r);
      TH.set(k, th);
      q.push(kid);
    }
  }
  const rMax = Math.max(step, ...R.values());
  const Rc = rMax + step * 0.75;
  const half = S / 2 + 0.06;
  const zMain = Rc * 0.14;
  const T = Rc * 0.5 + 20;
  const H = Rc * 0.13 + 8;
  const polar = (th: number, r: number, y = 0, out = new Vector3()) => out.set(r * Math.sin(th), y, r * Math.cos(th));

  // ---- the trunk: spring in the hills down a valley to the apex ----
  const trunkX = (z: number) => {
    const u = Math.max(0, -z / T);
    return sx * T * 0.1 * Math.sin(u * Math.PI * 1.7) * Math.min(1, u * 3);
  };
  const floorH = (z: number) => H * 0.3 * sstep(0.04, 1, -z / T);
  const hwRoot = hwOf(M.root.id);
  const mesh = { x0: -Rc * 2.4, x1: Rc * 2.4, z0: -T * 2, z1: Rc * 2.4, nx: 260, nz: 230 };
  const cell = Math.max((mesh.x1 - mesh.x0) / mesh.nx, (mesh.z1 - mesh.z0) / mesh.nz);
  const height = (x: number, z: number) => {
    const u = -z / T;
    if (u <= 0) return 0;
    const ridge = 1 - Math.abs(fbm(x * 0.012 + 5, z * 0.012) * 2 - 1);
    const base = sstep(0.02, 0.6, u) * H * (0.35 + 0.55 * fbm(x * 0.02, z * 0.02) + 0.45 * ridge);
    const fl = floorH(z);
    const flat = hwRoot * (0.4 + 0.6 * Math.min(1, u)) + 1.6 * cell + 1;
    const vf = sstep(flat, flat + Math.max(6, T * 0.16), Math.abs(x - trunkX(z)));
    return fl + Math.max(0, base - fl) * vf;
  };
  const trunk: Vector3[] = [];
  const tn = 60;
  for (let i = 0; i <= tn; i++) {
    const z = -T * 0.92 * (1 - i / tn);
    trunk.push(new Vector3(trunkX(z), floorH(z) + 0.28, z));
  }
  trunk.push(new Vector3(0, 0.06, 0), new Vector3(0, 0.06, step * 0.18));
  const lenOf = (pts: Vector3[]) => pts.reduce((s, p, i) => s + (i ? p.distanceTo(pts[i - 1] as Vector3) : 0), 0);
  const channels: Channel[] = [];
  const sAt = new Map<string, number>();
  const trunkLen = lenOf(trunk);
  channels.push({
    pts: trunk,
    hw0: hwRoot * 0.3,
    hw1: hwRoot,
    birth: M.root.born - 4,
    grow: 3.5,
    key: M.root.id,
    col: '#ffffff',
    tint: 0,
    s0: 0,
    bank: true,
  });
  sAt.set(M.root.id, trunkLen);
  const pathOf = new Map<string, Vector3[]>([[M.root.id, trunk]]);

  // ---- distributaries ----
  const polarPath = (th0: number, r0: number, th1: number, r1: number, amp: number) => {
    const len = Math.abs(r1 - r0) + Math.abs(th1 - th0) * (r0 + r1) * 0.5;
    const n = Math.min(56, Math.max(8, Math.ceil(len / 1.5)));
    const k = 1 + Math.floor(len / 26);
    const ph = rnd() * Math.PI * 2;
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      const th = th0 + (th1 - th0) * e;
      const r = r0 + (r1 - r0) * t;
      const m = amp * Math.sin(Math.PI * t) * Math.sin(Math.PI * 2 * k * t + ph);
      const v = polar(th, r, 0.06);
      v.x += Math.cos(th) * m;
      v.z -= Math.sin(th) * m;
      pts.push(v);
    }
    return pts;
  };
  for (const p of order) {
    if (p === M.root) continue;
    const parent = p.parent ? M.get(p.parent) : M.root;
    const r1 = R.get(p.id) ?? 0;
    const th1 = TH.get(p.id) ?? 0;
    const hw = hwOf(p.id);
    const roomAt = (r: number) => Math.max(0, ((p.leaves / L) * S * r) / 2 - hw * 2);
    let pts: Vector3[];
    let s0: number;
    if (p.virt) {
      // No real parent here: a channel from its own spring on the delta plain.
      const r0 = Math.max(step * 0.5, r1 - step * 1.2);
      pts = polarPath(th1, r0, th1, r1, Math.min(1.2, roomAt(r0) * 0.3));
      s0 = r0;
    } else {
      const r0 = R.get(parent.id) ?? 0;
      const th0 = parent === M.root ? 0 : (TH.get(parent.id) ?? 0);
      pts = polarPath(th0, r0, th1, r1, Math.min((r1 - r0) * 0.06, roomAt((r0 + r1) / 2) * 0.35));
      s0 = sAt.get(parent.id) ?? 0;
    }
    pathOf.set(p.id, pts);
    sAt.set(p.id, s0 + lenOf(pts));
    channels.push({
      pts,
      hw0: hw,
      hw1: hw,
      birth: p.born,
      grow: 1.4,
      key: p.id,
      col: '#ffffff',
      tint: 0,
      s0,
      bank: true,
    });
    // Childless lines run on to the sea and flare into a mouth.
    if (!p.kids.length) {
      const drift = (rnd() - 0.5) * (p.leaves / L) * S * 0.5;
      const ext = polarPath(th1, r1, th1 + drift, Rc + step * 0.45, Math.min(2.2, roomAt(r1) * 0.45 + 0.4));
      channels.push({
        pts: ext,
        hw0: hw,
        hw1: hw * (big ? 1.2 : 1.9),
        birth: p.born + 0.8,
        grow: 2 + ((Rc - r1) / step) * 1.2,
        key: p.id,
        col: '#ffffff',
        tint: 0,
        s0: sAt.get(p.id) ?? 0,
        bank: !big,
      });
    }
  }

  // ---- settlements ----
  const ground: Vector3[] = M.people.map(() => new Vector3());
  for (const p of order) {
    if (p === M.root) ground[p.idx]?.set(0, 0, 0);
    else polar(TH.get(p.id) ?? 0, R.get(p.id) ?? 0, 0, ground[p.idx]);
  }

  // ---- marriages: a tributary from "another river" joining just upstream of the fork ----
  const tangentAt = (pts: Vector3[], i: number) => {
    const a = pts[Math.max(0, i - 1)] as Vector3;
    const b = pts[Math.min(pts.length - 1, i + 1)] as Vector3;
    return new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  };
  const tl = sp * (big ? 1.25 : 1.45);
  for (const p of order) {
    const sps = spousesOf.get(p.id);
    const pts = pathOf.get(p.id);
    if (!sps?.length || !pts) continue;
    const total = lenOf(pts);
    const sideBase = (Math.sign(TH.get(p.id) ?? 0) || 1) * (p === M.root ? 1 : sx);
    sps.forEach((s, k) => {
      const want = Math.min(total * 0.8, back * (k + 1) * (p === M.root ? 1.6 : 1));
      let acc = 0;
      let j = pts.length - 1;
      while (j > 0 && acc < want) {
        acc += (pts[j] as Vector3).distanceTo(pts[j - 1] as Vector3);
        j--;
      }
      const J = (pts[j] as Vector3).clone();
      const d = tangentAt(pts, j);
      const n = new Vector3(-d.z, 0, d.x);
      const side = k % 2 === 0 ? sideBase : -sideBase;
      const yJ = J.y;
      const Q = J.clone()
        .addScaledVector(d, -tl * 0.8)
        .addScaledVector(n, side * tl * 1.1);
      const C = J.clone()
        .addScaledVector(d, -tl * 0.1)
        .addScaledVector(n, side * tl * 0.6);
      Q.y = C.y = yJ;
      const curve = new QuadraticBezierCurve3(Q, C, J);
      const tp = curve.getPoints(14);
      ground[s.idx]?.set(J.x + n.x * side * sp * 0.12, yJ > 0.1 ? yJ - 0.28 : 0, J.z + n.z * side * sp * 0.12);
      const len = lenOf(tp);
      const yr = spouseYear(M, s);
      channels.push({
        pts: tp,
        hw0: widthOf(1, big) * 0.3,
        hw1: widthOf(1, big) * 0.5,
        birth: yr - 1,
        grow: 1.2,
        key: s.id,
        col: s.color,
        tint: 1,
        s0: (sAt.get(p.id) ?? 0) - acc - len,
        bank: true,
      });
    });
  }
  // Spouses of married-in people (rare): beside their anchor.
  for (let pass = 0; pass < 3; pass++)
    for (const p of M.people) {
      if (!p.mi || !p.anchor) continue;
      const a = M.get(p.anchor);
      if (!a.mi) continue;
      const g = ground[a.idx];
      if (g) ground[p.idx]?.copy(g).add(new Vector3(sx * sp * 0.8, 0, -sp * 0.4));
    }

  return { ground, channels, Rc, half, zMain, T, H, height, grid: mesh };
}
