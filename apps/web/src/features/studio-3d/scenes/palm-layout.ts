import type { StudioModel, StudioPerson } from '../model.ts';
import { spouseIndex } from '../model.ts';
import { rng } from '../palette.ts';

// Date Palm Oasis layout: the founder's mother palm stands at the centre; each child is an offshoot
// planted outward in its parent's sector, one ring per generation, so the grove spreads generation by
// generation. Spouses stand close around their partner (a man with several wives gets them in a small
// circle), on shorter palms, so no two portraits touch. Arabic mirrors the whole grove.

const TAU = Math.PI * 2;

export interface Palm {
  p: StudioPerson;
  x: number;
  z: number;
  /** Full-grown height. */
  h: number;
  /** Lean of the crown relative to the base, as a fraction of the height (offshoots grow curved, outward). */
  lx: number;
  lz: number;
  /** Angle and radius on the grove (for the falaj that runs to it). */
  th: number;
  r: number;
  phase: number;
}

export interface Grove {
  palms: Palm[];
  byId: Map<string, Palm>;
  /** Grove radius (outermost palm plus margin). */
  G: number;
  H0: number;
  /** Distance between generation rings (the ring paths in the sand). */
  ring: number;
  /** Outermost generation ring with a palm on it. */
  gens: number;
}

/** Height of a palm for a generation: the founder is tallest, each generation shorter. */
export const heightOf = (H0: number, gen: number) => H0 * Math.max(0.42, 0.85 ** gen);

export function layoutGrove(M: StudioModel, big: boolean, rtl: boolean): Grove {
  const H0 = big ? 15 : 12;
  const rnd = rng(17);
  const span = (g: number) => heightOf(H0, g) * 0.62; // crown spread a palm needs
  // Portraits float above the crowns: neighbours closer than this would touch on screen.
  const gap = big ? 3.2 : 2.8;
  const slot = (g: number) => Math.max(span(g) * 0.62, gap);
  const line = M.people.filter((p) => !p.mi);
  const spouses = new Map<string, number>();
  for (const p of M.people) if (p.mi && p.anchor) spouses.set(p.anchor, (spouses.get(p.anchor) ?? 0) + 1);
  const half = (id: string) => Math.ceil((spouses.get(id) ?? 0) / 2);

  // Ring step: wide enough that neighbours on each ring, with the spouses standing between them, mostly clear.
  const byGen = new Map<number, StudioPerson[]>();
  for (const p of line) if (p.gen > 0) byGen.set(p.gen, [...(byGen.get(p.gen) ?? []), p]);
  const need: number[] = [];
  for (const [g, list] of byGen) {
    list.sort((a, b) => a.ang - b.ang);
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as StudioPerson;
      const b = list[(i + 1) % list.length] as StudioPerson;
      let gp = b.ang - a.ang;
      if (gp <= 0) gp += 1;
      const w = span(g) + (half(a.id) + half(b.id)) * slot(g);
      need.push(w / (g * TAU * Math.max(gp, 1e-4)));
    }
  }
  need.sort((a, b) => a - b);
  const pick = need[Math.floor(need.length * (big ? 0.8 : 0.9))] ?? 0;
  const ring = Math.min(big ? 46 : 30, Math.max(big ? 15 : 11, pick));

  const palms: Palm[] = [];
  const byId = new Map<string, Palm>();
  const add = (pl: Palm) => {
    palms.push(pl);
    byId.set(pl.p.id, pl);
  };
  // Siblings alternate slightly in and out of the ring path so crowns interleave.
  const stagger = new Map<number, number>();
  for (const p of line) {
    const ph = rnd() * 100;
    if (p === M.root || p.gen === 0) {
      add({ p, x: 0, z: 0, h: H0, lx: 0.02, lz: -0.015, th: 0, r: 0, phase: ph });
      continue;
    }
    const k = stagger.get(p.gen) ?? 0;
    stagger.set(p.gen, k + 1);
    const th = p.ang * TAU * 0.992 + 0.35 + (rnd() - 0.5) * 0.02;
    const r = p.gen * ring + (k % 2 ? 0.12 : -0.08) * ring * Math.min(1, p.gen / 2) + (rnd() - 0.5) * ring * 0.05;
    const lean = 0.05 + rnd() * 0.06; // offshoots are curved, leaning away from the mother
    add({
      p,
      x: Math.cos(th) * r,
      z: Math.sin(th) * r,
      h: heightOf(H0, p.gen) * (0.94 + rnd() * 0.12),
      lx: Math.cos(th) * lean,
      lz: Math.sin(th) * lean,
      th,
      r,
      phase: ph,
    });
  }
  // Spouses: around their partner on a small circle. One spouse stands beside the partner on the ring path,
  // two on either side; more spread evenly (four make an X clear of the channels that run in and out along
  // the radius). Their palms are shorter, so their portraits sit lower than the partner's and stay clear of
  // it from every side the camera can orbit to.
  const mates = new Map<string, StudioPerson[]>();
  for (const p of M.people)
    if (p.mi) {
      const key = p.anchor ?? M.root.id;
      mates.set(key, [...(mates.get(key) ?? []), p]);
    }
  for (const list of mates.values()) list.sort((x, y) => spouseIndex(M, x) - spouseIndex(M, y));
  for (let pass = 0; pass < 3; pass++)
    for (const p of M.people) {
      if (byId.has(p.id)) continue;
      const a = byId.get(p.anchor ?? M.root.id);
      if (!a) continue;
      const list = mates.get(a.p.id) ?? [p];
      const n = list.length;
      const j = Math.max(0, list.indexOf(p));
      // Evenly spaced angles, ordered so consecutive spouses alternate sides.
      const order = n < 3 ? j : j % 2 ? Math.floor(n / 2) + Math.floor(j / 2) : j / 2;
      const phi = n < 3 ? order * Math.PI : Math.PI / n + (order * TAU) / n;
      const tx = a.r > 0.01 ? -Math.sin(a.th) : 1;
      const tz = a.r > 0.01 ? Math.cos(a.th) : 0;
      const rx = a.r > 0.01 ? Math.cos(a.th) : 0;
      const rz = a.r > 0.01 ? Math.sin(a.th) : 1;
      const dx = tx * Math.cos(phi) + rx * Math.sin(phi);
      const dz = tz * Math.cos(phi) + rz * Math.sin(phi);
      // Close and clearly lower: from any side the camera orbits to, the two portraits stay apart.
      const root = a.r < 0.01;
      const rho = root ? (big ? 3 : 2.6) : Math.max(slot(a.p.gen) * 0.7, big ? 2.6 : 2.3);
      const drop = (big ? 1.2 : 1) * (root ? 3.4 : 2.8);
      const x = a.x + dx * rho;
      const z = a.z + dz * rho;
      add({
        p,
        x,
        z,
        h: Math.max(a.h * 0.45, a.h - drop) * (0.98 + rnd() * 0.04),
        lx: dx * 0.05,
        lz: dz * 0.05,
        th: Math.atan2(z, x),
        r: Math.hypot(x, z),
        phase: rnd() * 100,
      });
    }
  relax(palms, gap);
  if (rtl)
    for (const pl of palms) {
      pl.x = -pl.x;
      pl.lx = -pl.lx;
      pl.th = Math.atan2(pl.z, pl.x);
    }
  const G = Math.max(...palms.map((q) => q.r)) + span(1) + 6;
  const gens = Math.max(0, ...line.map((p) => p.gen));
  return { palms, byId, G, H0, ring, gens };
}

/**
 * Pushes apart crowns whose portraits would touch: along the ring for palms on the same ring
 * (keeping the generation rings intact), along x around the founder. A few passes are enough.
 */
function relax(palms: Palm[], gap: number) {
  const n = palms.length;
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < n; i++) {
      const a = palms[i] as Palm;
      cx[i] = a.x + a.lx * a.h;
      cz[i] = a.z + a.lz * a.h;
    }
    let moved = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = palms[i] as Palm;
        const b = palms[j] as Palm;
        const dx = (cx[j] ?? 0) - (cx[i] ?? 0);
        const dz = (cz[j] ?? 0) - (cz[i] ?? 0);
        // Portraits float above the crowns: a spouse's lower portrait may stand closer on the ground.
        const d = Math.hypot(dx, dz, (b.h - a.h) * 1.16);
        if (d >= gap || Math.abs(a.r - b.r) > gap * 1.5) continue;
        const push = (gap - d) * 0.5 + 0.02;
        moved = true;
        if (a.r < 0.01 || b.r < 0.01) {
          const s = Math.sign(dx) || 1;
          if (a.r >= 0.01) shift(a, -s * push, 0);
          if (b.r >= 0.01) shift(b, s * push, 0);
          continue;
        }
        // Along the ring: the one further round (by angle) moves on, the other moves back.
        let dth = b.th - a.th;
        while (dth > Math.PI) dth -= TAU;
        while (dth < -Math.PI) dth += TAU;
        const s = Math.sign(dth) || 1;
        turn(a, (-s * push) / a.r);
        turn(b, (s * push) / b.r);
      }
    if (!moved) break;
  }
}

function turn(pl: Palm, dth: number) {
  pl.th += dth;
  const lean = Math.hypot(pl.lx, pl.lz);
  const lth = Math.atan2(pl.lz, pl.lx) + dth;
  pl.x = Math.cos(pl.th) * pl.r;
  pl.z = Math.sin(pl.th) * pl.r;
  pl.lx = Math.cos(lth) * lean;
  pl.lz = Math.sin(lth) * lean;
}

function shift(pl: Palm, dx: number, dz: number) {
  pl.x += dx;
  pl.z += dz;
  pl.r = Math.hypot(pl.x, pl.z);
  pl.th = Math.atan2(pl.z, pl.x);
}
