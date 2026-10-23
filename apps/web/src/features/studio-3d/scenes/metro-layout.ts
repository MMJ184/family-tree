import type { StudioModel, StudioPerson } from '../model.ts';

// Family Metro layout. The x axis is a timeline (birth year, before mirroring for Arabic).
// Every couple's children make one line: siblings are consecutive stations in birth order,
// nudged apart when births are close. A child who has children of their own branches off
// their station onto a new parallel track (a lane). Spouses sit beside their partner on the
// same track as an interchange.
//
// Lanes are packed like Reingold–Tilford, with time bins standing in for tree levels: each
// family keeps a contour (top and bottom lane per bin) and child families are pushed out just
// far enough not to touch. Children's families alternate above and below their parents' line,
// and on each side the youngest sits closest, so the branch connectors never cross a track.

export interface MetroFamily {
  /** The parent whose children ride this line. */
  head: StudioPerson;
  kids: StudioPerson[];
  lane: number;
  /** x where the line leaves the head's station (the head's last spouse when married). */
  from: number;
  /** Lane the head sits on. */
  headLane: number;
  /** A tree root: the line starts at the head's own station, on the same lane. */
  root: boolean;
  /** Colour slot (0 is the founder's line). */
  col: number;
}

export interface MetroLayout {
  x: Map<string, number>;
  lane: Map<string, number>;
  laneMin: number;
  laneMax: number;
  xMin: number;
  xMax: number;
  fams: MetroFamily[];
  /** Spouses beside each person, in wedding order. */
  wed: Map<string, StudioPerson[]>;
}

interface Contour {
  top: Map<number, number>;
  bot: Map<number, number>;
}

export interface MetroOpts {
  /** x units per year. */
  k: number;
  /** Smallest gap between two stations on a line. */
  gap: number;
  /** Width of one spouse slot along the line. */
  wedGap: number;
  /** Chamfer of a branch (x units). */
  C: number;
  /** Bin width for packing. */
  bin: number;
  mid: number;
}

export function metroLayout(M: StudioModel, o: MetroOpts): MetroLayout {
  const wed = new Map<string, StudioPerson[]>();
  for (const p of M.people) {
    if (!p.mi || !p.anchor) continue;
    wed.set(p.anchor, [...(wed.get(p.anchor) ?? []), p]);
  }
  for (const [id, list] of wed) {
    const order = M.get(id).spouses.map((s) => s.id);
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const U = (y: number) => (y - o.mid) * o.k;
  const x = new Map<string, number>();
  const kidsOf = (p: StudioPerson) => p.kids.map((k) => M.get(k)).filter((k) => !k.virt);
  const roots = [M.root, ...M.people.filter((p) => p.virt)];
  const fams = new Map<string, MetroFamily>();
  const end = (p: StudioPerson) => (x.get(p.id) ?? 0) + (wed.get(p.id)?.length ?? 0) * o.wedGap;

  // 1. Timeline positions, top-down: a station never sits closer than `gap` to the one before.
  const placeX = (p: StudioPerson, at: number) => {
    x.set(p.id, at);
    (wed.get(p.id) ?? []).forEach((s, j) => {
      x.set(s.id, at + (j + 1) * o.wedGap);
    });
    const kids = kidsOf(p);
    if (!kids.length) return;
    const root = roots.includes(p);
    const from = end(p);
    let prev = root ? from + o.gap : from + 2 * o.C + o.gap * 0.6;
    for (const k of kids) {
      const kx = Math.max(U(k.born), prev);
      placeX(k, kx);
      prev = end(k) + o.gap;
    }
    fams.set(p.id, { head: p, kids, lane: 0, from, headLane: 0, root, col: 0 });
  };
  for (const r of roots) placeX(r, U(r.born));

  // 2. Lane packing, bottom-up.
  const bin = (v: number) => Math.floor(v / o.bin);
  const rel = new Map<string, number>(); // family lane relative to the parents' family lane
  const put = (c: Contour, b: number, lo: number, hi: number) => {
    c.top.set(b, Math.min(c.top.get(b) ?? lo, lo));
    c.bot.set(b, Math.max(c.bot.get(b) ?? hi, hi));
  };
  const shape = (f: MetroFamily): Contour => {
    const c: Contour = { top: new Map(), bot: new Map() };
    const last = f.kids[f.kids.length - 1] ?? f.head;
    for (let b = bin(f.root ? (x.get(f.head.id) ?? 0) : f.from); b <= bin(end(last)); b++) put(c, b, 0, 0);
    const branching = f.kids.filter((k) => fams.has(k.id));
    const sides: Record<string, StudioPerson[]> = { '1': [], '-1': [] };
    branching.forEach((k, i) => {
      sides[i % 2 ? '-1' : '1']?.push(k);
    });
    for (const s of [1, -1]) {
      const list = [...(sides[String(s)] ?? [])].reverse(); // youngest first: closest to the line
      for (const k of list) {
        const kf = fams.get(k.id) as MetroFamily;
        const ks = shape(kf);
        const cx = kf.from;
        const cb = [bin(cx), bin(cx + o.C), bin(cx + 2 * o.C)];
        let off = 1;
        for (const [b, t] of ks.top) {
          const bt = ks.bot.get(b) ?? t;
          off = Math.max(off, s > 0 ? (c.bot.get(b) ?? -1e9) - t + 1 : bt - (c.top.get(b) ?? 1e9) + 1);
        }
        for (const b of cb) off = Math.max(off, s > 0 ? (c.bot.get(b) ?? 0) + 1 : 1 - (c.top.get(b) ?? 0));
        const L = s * off;
        rel.set(k.id, L);
        for (const [b, t] of ks.top) put(c, b, t + L, (ks.bot.get(b) ?? t) + L);
        for (const b of cb) put(c, b, Math.min(0, L), Math.max(0, L));
      }
    }
    return c;
  };

  // Several trees (the founder's, plus anyone not linked to it) stack below each other.
  const famLane = new Map<string, number>();
  const global: Contour = { top: new Map(), bot: new Map() };
  for (const r of roots) {
    const f = fams.get(r.id);
    let base = 0;
    const cs = f ? shape(f) : null;
    const cells: Array<[number, number, number]> = cs
      ? [...cs.top].map(([b, t]) => [b, t, cs.bot.get(b) ?? t])
      : [[bin(x.get(r.id) ?? 0), 0, 0]];
    if (r !== M.root) {
      base = Number.NEGATIVE_INFINITY;
      for (const [b, t] of cells) base = Math.max(base, (global.bot.get(b) ?? Number.NEGATIVE_INFINITY) - t + 2);
      if (base === Number.NEGATIVE_INFINITY) base = Math.max(0, ...global.bot.values()) + 2;
    }
    for (const [b, t, bt] of cells) put(global, b, t + base, bt + base);
    famLane.set(r.id, base);
  }

  // 3. Absolute lanes and colours, top-down.
  const lane = new Map<string, number>();
  let cols = 1;
  const placeLane = (p: StudioPerson, headLane: number, myLane: number, col: number) => {
    const f = fams.get(p.id);
    if (!f) return;
    f.lane = myLane;
    f.headLane = headLane;
    f.col = col;
    for (const k of f.kids) {
      lane.set(k.id, myLane);
      if (!fams.has(k.id)) continue;
      // Fresh colours for the founder's grandchildren's lines and above; deeper lines keep theirs.
      placeLane(k, myLane, myLane + (rel.get(k.id) ?? 1), p.gen < 2 ? cols++ : col);
    }
  };
  for (const r of roots) {
    const L = famLane.get(r.id) ?? 0;
    lane.set(r.id, L);
    placeLane(r, L, L, r === M.root ? 0 : cols++);
  }
  for (const p of M.people) {
    if (p.mi && p.anchor) lane.set(p.id, lane.get(p.anchor) ?? 0);
    if (!x.has(p.id)) x.set(p.id, U(p.born));
    if (!lane.has(p.id)) lane.set(p.id, 0);
  }
  let laneMin = 0;
  let laneMax = 0;
  for (const v of lane.values()) {
    laneMin = Math.min(laneMin, v);
    laneMax = Math.max(laneMax, v);
  }
  const xs = [...x.values()];
  return {
    x,
    lane,
    laneMin,
    laneMax,
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    fams: [...fams.values()],
    wed,
  };
}

type P2 = [number, number];

/** Rounds every interior corner of a polyline with a quadratic arc of up to `r`. */
export function roundCorners(pts: P2[], r: number, steps = 5): P2[] {
  if (pts.length < 3) return pts;
  const out: P2[] = [pts[0] as P2];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as P2;
    const b = pts[i] as P2;
    const c = pts[i + 1] as P2;
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const d = Math.min(r, l1 * 0.5, l2 * 0.5);
    if (d < 1e-4) {
      out.push(b);
      continue;
    }
    const s: P2 = [b[0] + ((a[0] - b[0]) / l1) * d, b[1] + ((a[1] - b[1]) / l1) * d];
    const e: P2 = [b[0] + ((c[0] - b[0]) / l2) * d, b[1] + ((c[1] - b[1]) / l2) * d];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * (1 - t) * t;
      const w2 = t * t;
      out.push([w0 * s[0] + w1 * b[0] + w2 * e[0], w0 * s[1] + w1 * b[1] + w2 * e[1]]);
    }
  }
  out.push(pts[pts.length - 1] as P2);
  return out;
}
