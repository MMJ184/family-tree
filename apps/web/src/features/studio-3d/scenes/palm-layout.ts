import type { StudioModel, StudioPerson } from '../model.ts';
import { spouseIndex } from '../model.ts';
import { rng } from '../palette.ts';

// Date Palm Oasis layout: the founder's mother palm stands at the centre; each child is an offshoot
// planted outward in its parent's sector, one ring per generation, so the grove spreads generation by
// generation. Spouses stand beside each other on the same ring.

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
}

/** Height of a palm for a generation: the founder is tallest, each generation shorter. */
export const heightOf = (H0: number, gen: number) => H0 * Math.max(0.42, 0.85 ** gen);

export function layoutGrove(M: StudioModel, big: boolean): Grove {
  const H0 = big ? 15 : 12;
  const rnd = rng(17);
  const span = (g: number) => heightOf(H0, g) * 0.62; // crown spread a palm needs
  const line = M.people.filter((p) => !p.mi);
  const spouses = new Map<string, number>();
  for (const p of M.people) if (p.mi && p.anchor) spouses.set(p.anchor, (spouses.get(p.anchor) ?? 0) + 1);

  // Ring step: wide enough that neighbours on each ring (with their spouses) mostly clear each other.
  const byGen = new Map<number, StudioPerson[]>();
  for (const p of line) if (p.gen > 0) byGen.set(p.gen, [...(byGen.get(p.gen) ?? []), p]);
  const need: number[] = [];
  for (const [g, list] of byGen) {
    list.sort((a, b) => a.ang - b.ang);
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as StudioPerson;
      const b = list[(i + 1) % list.length] as StudioPerson;
      let gap = b.ang - a.ang;
      if (gap <= 0) gap += 1;
      const w = (1 + 0.8 * ((spouses.get(a.id) ?? 0) + (spouses.get(b.id) ?? 0)) * 0.5) * span(g);
      need.push(w / (g * TAU * Math.max(gap, 1e-4)));
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
  // Siblings alternate slightly in and out so crowns interleave.
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
    const r = p.gen * ring + (k % 2 ? 0.16 : -0.1) * ring * Math.min(1, p.gen / 2) + (rnd() - 0.5) * ring * 0.08;
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
  // Spouses: a palm beside their partner, slightly shorter, on the same ring.
  for (let pass = 0; pass < 3; pass++)
    for (const p of M.people) {
      if (byId.has(p.id)) continue;
      const a = byId.get(p.anchor ?? M.root.id);
      if (!a) continue;
      const k = spouseIndex(M, p);
      const side = k % 2 ? -1 : 1;
      const d = span(a.p.gen) * (0.62 + Math.floor(k / 2) * 0.55);
      const ox = a.r > 0.01 ? -Math.sin(a.th) : 1;
      const oz = a.r > 0.01 ? Math.cos(a.th) : 0;
      const x = a.x + ox * d * side;
      const z = a.z + oz * d * side;
      const th = Math.atan2(z, x);
      add({
        p,
        x,
        z,
        h: a.h * 0.88,
        lx: ox * side * 0.05,
        lz: oz * side * 0.05,
        th,
        r: Math.hypot(x, z),
        phase: rnd() * 100,
      });
    }
  const G = Math.max(...palms.map((q) => q.r)) + span(1) + 6;
  return { palms, byId, G, H0 };
}
