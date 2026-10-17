import { type FamilyGraph, type Person, partialYear } from '@family-tree/shared';
import { NOW, PORTRAIT_COLOURS } from './palette.ts';

// Adapter from the API's FamilyGraph to the studio's layout model (the shape the
// accepted prototype used): people with born/died/sex/family colour, layout
// parent and children, spouses with a wedding year, generation, leaf count and
// angular sector, plus businesses with their owners.

export interface StudioSpouse {
  id: string;
  year: number;
}

export interface StudioPerson {
  id: string;
  idx: number;
  person: Person;
  sex: 'M' | 'F';
  /** Birth year; estimated from relatives when unknown (see bornKnown). */
  born: number;
  bornKnown: boolean;
  /** Death year, or null while alive. Estimated when the person is deceased without a date. */
  died: number | null;
  /** Portrait / rim colour: the family's colour for people born in, the birth family's for people married in. */
  color: string;
  /** Membership is MARRIED_IN (shown in the tooltip). */
  marriedIn: boolean;
  /** Laid out beside a spouse instead of on a line of descent (married in, or a founder's partner). */
  mi: boolean;
  /** Attached to the founder only for layout; no real parent link is drawn. */
  virt: boolean;
  /** Real parents and children in this family (for lineage and the hourglass). */
  parents: string[];
  children: string[];
  spouses: StudioSpouse[];
  /** Layout parent (on the born-in line) and layout children. */
  parent: string | null;
  kids: string[];
  /** For people laid out beside a spouse: that spouse. */
  anchor: string | null;
  gen: number;
  leaves: number;
  ang: number;
}

export interface StudioBusiness {
  id: string;
  en: string;
  ar: string;
  year: number;
  owners: string[];
}

export interface StudioModel {
  people: StudioPerson[];
  byId: Map<string, StudioPerson>;
  root: StudioPerson;
  maxGen: number;
  biz: StudioBusiness[];
  minYear: number;
  n: number;
  homeColor: string;
  get(id: string): StudioPerson;
}

const GAP = 25; // assumed years between a parent's and a child's birth

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.replace(/./g, (c) => c + c) : m.padEnd(6, '0');
  const r = Number.parseInt(v.slice(0, 2), 16) / 255;
  const g = Number.parseInt(v.slice(2, 4), 16) / 255;
  const b = Number.parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** The family colour lifted so it reads (and blooms) on the dark stage, like the prototype's palette. */
export function brighten(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, Math.max(s, 0.45), Math.min(0.62, Math.max(l, 0.46)));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a)[0] - hexToHsl(b)[0]) % 360;
  return Math.min(d, 360 - d);
}

export function buildModel(graph: FamilyGraph): StudioModel | null {
  const people = graph.people.filter((p) => !p.deletedAt);
  if (!people.length) return null;
  const ids = new Set(people.map((p) => p.id));
  const membership = new Map(graph.memberships.map((m) => [m.personId, m.membership]));
  const homeColor = brighten(graph.family.color || '#0f6b63');
  const homeSurname = (graph.family.surname ?? '').trim().toLowerCase();
  const others = PORTRAIT_COLOURS.filter((c) => hueDistance(c, homeColor) > 22);
  const palette = others.length ? others : PORTRAIT_COLOURS;
  const colourFor = (p: Person, marriedIn: boolean) => {
    if (!marriedIn) return homeColor;
    const key = (p.tribeName || p.lastName || p.maidenName || p.id).trim().toLowerCase();
    if (homeSurname && key === homeSurname) return homeColor;
    return palette[hash(key) % palette.length] ?? homeColor;
  };

  // Real relations, inside this family only.
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const edges = [...graph.parentChild].sort(
    (a, b) => (a.type === 'BIOLOGICAL' ? 0 : 1) - (b.type === 'BIOLOGICAL' ? 0 : 1),
  );
  for (const e of edges) {
    if (!ids.has(e.parentId) || !ids.has(e.childId) || e.parentId === e.childId) continue;
    const ps = parentsOf.get(e.childId) ?? [];
    if (ps.includes(e.parentId) || ps.length >= 2) continue; // max two parents
    ps.push(e.parentId);
    parentsOf.set(e.childId, ps);
    const cs = childrenOf.get(e.parentId) ?? [];
    cs.push(e.childId);
    childrenOf.set(e.parentId, cs);
  }

  // Birth years: known, else estimated from parents, children, spouses (a few passes so estimates spread).
  const born = new Map<string, number>();
  for (const p of people) {
    const y = partialYear(p.birth);
    if (y != null) born.set(p.id, y);
  }
  const spouseIds = new Map<string, string[]>();
  for (const m of graph.marriages) {
    if (!ids.has(m.personAId) || !ids.has(m.personBId) || m.personAId === m.personBId) continue;
    spouseIds.set(m.personAId, [...(spouseIds.get(m.personAId) ?? []), m.personBId]);
    spouseIds.set(m.personBId, [...(spouseIds.get(m.personBId) ?? []), m.personAId]);
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const p of people) {
      if (born.has(p.id)) continue;
      const fromParents = (parentsOf.get(p.id) ?? []).map((id) => born.get(id)).filter((y): y is number => y != null);
      const fromKids = (childrenOf.get(p.id) ?? []).map((id) => born.get(id)).filter((y): y is number => y != null);
      const fromSpouses = (spouseIds.get(p.id) ?? []).map((id) => born.get(id)).filter((y): y is number => y != null);
      let est: number | null = null;
      if (fromParents.length) est = Math.max(...fromParents) + GAP;
      else if (fromKids.length) est = Math.min(...fromKids) - GAP;
      else if (fromSpouses.length) est = Math.round(fromSpouses.reduce((s, y) => s + y, 0) / fromSpouses.length);
      if (est != null) {
        born.set(p.id, Math.min(NOW, est));
        changed = true;
      }
    }
    if (!changed) break;
  }
  const knownYears = [...born.values()];
  const fallbackBorn = knownYears.length ? Math.min(...knownYears) : NOW - 60;
  for (const p of people) {
    if (born.has(p.id)) continue;
    const d = partialYear(p.death);
    born.set(p.id, d != null ? d - 60 : fallbackBorn);
  }

  const list: StudioPerson[] = people.map((p, idx) => {
    const marriedIn = membership.get(p.id) === 'MARRIED_IN';
    const b = born.get(p.id) ?? fallbackBorn;
    const d = partialYear(p.death);
    const died = d != null ? Math.max(d, b) : p.isLiving ? null : Math.min(NOW, b + 70);
    return {
      id: p.id,
      idx,
      person: p,
      sex: p.gender === 'FEMALE' ? 'F' : 'M',
      born: b,
      bornKnown: p.birth != null,
      died,
      color: colourFor(p, marriedIn),
      marriedIn,
      mi: marriedIn,
      virt: false,
      parents: parentsOf.get(p.id) ?? [],
      children: [],
      spouses: [],
      parent: null,
      kids: [],
      anchor: null,
      gen: 0,
      leaves: 1,
      ang: 0,
    };
  });
  const byId = new Map(list.map((p) => [p.id, p]));
  const get = (id: string): StudioPerson => {
    const p = byId.get(id);
    if (!p) throw new Error(`studio: unknown person ${id}`);
    return p;
  };
  for (const p of list) p.children = [...(childrenOf.get(p.id) ?? [])].sort((a, b) => get(a).born - get(b).born);

  // Spouses with a wedding year (start date, else just before the first shared child, else ~22 years after birth).
  for (const m of graph.marriages) {
    const a = byId.get(m.personAId);
    const b = byId.get(m.personBId);
    if (!a || !b || a === b) continue;
    const shared = a.children.filter((c) => b.children.includes(c)).map((c) => get(c).born);
    const start = partialYear(m.startDate);
    const year =
      start ??
      Math.min(Math.max(a.born, b.born) + 22, shared.length ? Math.min(...shared) - 1 : Number.POSITIVE_INFINITY, NOW);
    if (!a.spouses.some((s) => s.id === b.id)) a.spouses.push({ id: b.id, year });
    if (!b.spouses.some((s) => s.id === a.id)) b.spouses.push({ id: a.id, year });
  }
  for (const p of list) p.spouses.sort((x, y) => x.year - y.year);

  // Layout tree. Root: the earliest-born person born into the family with no parent here.
  const lineParent = (p: StudioPerson): string | null => {
    const ps = p.parents.map(get);
    const line = ps.filter((q) => !q.mi).sort((x, y) => x.born - y.born)[0];
    if (line) return line.id;
    // Only a married-in parent here: hang the child off that parent's spouse on the line.
    for (const q of ps) if (q.anchor) return q.anchor;
    return null;
  };
  const pickAnchor = (p: StudioPerson, reached: Set<string>): string | null => {
    const sp = p.spouses.map((s) => get(s.id));
    return (sp.find((s) => !s.mi && reached.has(s.id)) ?? sp.find((s) => reached.has(s.id)))?.id ?? null;
  };
  const candidates = list.filter((p) => !p.mi && !p.parents.length);
  const pool = candidates.length ? candidates : list.filter((p) => !p.mi).length ? list.filter((p) => !p.mi) : list;
  const root =
    [...pool].sort((a, b) => a.born - b.born || b.children.length - a.children.length)[0] ?? (list[0] as StudioPerson);
  root.mi = false;

  let reached = new Set<string>();
  let lastSig = '';
  for (let iter = 0; iter < 12; iter++) {
    for (const p of list) p.parent = p.mi || p === root ? null : lineParent(p);
    // Reach from the root through layout parents.
    const kidsOf = new Map<string, string[]>();
    for (const p of list) if (p.parent) kidsOf.set(p.parent, [...(kidsOf.get(p.parent) ?? []), p.id]);
    reached = new Set([root.id]);
    const q = [root.id];
    while (q.length) {
      const id = q.shift() as string;
      for (const k of kidsOf.get(id) ?? []) {
        if (reached.has(k)) continue;
        reached.add(k);
        q.push(k);
      }
    }
    for (const p of list) if (p.mi) p.anchor = pickAnchor(p, reached);
    // Unreached line heads with a spouse on the tree (for example a founder's wife recorded as born in) sit beside them.
    for (const p of list) {
      if (p.mi || reached.has(p.id) || p.parent || p.parents.length) continue;
      const a = pickAnchor(p, reached);
      if (a) {
        p.mi = true;
        p.anchor = a;
      }
    }
    const sig = list
      .map((p) => `${p.mi ? 1 : 0}${p.parent ?? ''}|${p.anchor ?? ''}|${reached.has(p.id) ? 1 : 0}`)
      .join(',');
    if (sig === lastSig) break;
    lastSig = sig;
  }

  // Final tree, built breadth-first so every person appears once (safe even with bad data).
  for (const p of list) p.kids = [];
  const placed = new Set<string>([root.id]);
  const attach = (start: StudioPerson) => {
    const q = [start];
    while (q.length) {
      const cur = q.shift() as StudioPerson;
      const kids = list
        .filter((k) => !k.mi && k.parent === cur.id && !placed.has(k.id))
        .sort((a, b) => a.born - b.born);
      for (const k of kids) {
        placed.add(k.id);
        cur.kids.push(k.id);
        q.push(k);
      }
    }
  };
  attach(root);
  // Anyone still floating (no relative on the tree): a virtual child of the founder, with no branch drawn.
  const floating = () => list.filter((p) => !placed.has(p.id) && (!p.mi || !p.anchor || !placed.has(p.anchor)));
  for (let guard = 0; guard < list.length; guard++) {
    const rest = floating().filter((p) => !p.mi || !p.anchor);
    const pending = rest.length ? rest : floating();
    if (!pending.length) break;
    const head = [...pending].sort((a, b) => a.born - b.born)[0] as StudioPerson;
    head.mi = false;
    head.anchor = null;
    head.virt = true;
    head.parent = root.id;
    placed.add(head.id);
    root.kids.push(head.id);
    attach(head);
    for (const p of list) if (p.mi && !p.anchor) p.anchor = pickAnchor(p, placed);
  }
  for (const p of list) {
    if (!p.mi) continue;
    placed.add(p.id);
    if (!p.anchor || !byId.has(p.anchor)) p.anchor = root.id;
  }

  // Generations, leaf counts and angular sectors.
  const genOf = (id: string, g: number) => {
    const p = get(id);
    p.gen = g;
    for (const k of p.kids) {
      const kid = get(k);
      const step = kid.virt ? Math.max(1, Math.round((kid.born - p.born) / 28)) : 1;
      genOf(k, g + step);
    }
  };
  genOf(root.id, 0);
  const leavesOf = (id: string): number => {
    const p = get(id);
    p.leaves = p.kids.length ? p.kids.reduce((s, k) => s + leavesOf(k), 0) : 1;
    return p.leaves;
  };
  leavesOf(root.id);
  const assign = (id: string, a0: number, a1: number) => {
    const p = get(id);
    p.ang = (a0 + a1) / 2;
    let a = a0;
    for (const k of p.kids) {
      const w = ((a1 - a0) * get(k).leaves) / p.leaves;
      assign(k, a, a + w);
      a += w;
    }
  };
  assign(root.id, 0, 1);
  for (const p of list) {
    if (!p.mi || !p.anchor) continue;
    const a = get(p.anchor);
    p.gen = a.gen;
    p.ang = a.ang;
  }
  const maxGen = Math.max(...list.map((p) => p.gen));
  const minYear = Math.min(...list.map((p) => p.born));

  const owners = new Map<string, string[]>();
  for (const pb of graph.personBusiness) {
    if (!byId.has(pb.personId)) continue;
    owners.set(pb.businessId, [...(owners.get(pb.businessId) ?? []), pb.personId]);
  }
  const biz: StudioBusiness[] = graph.businesses
    .filter((b) => !b.deletedAt)
    .map((b) => {
      const os = owners.get(b.id) ?? [];
      const ownerBorn = os.map((o) => get(o).born);
      return {
        id: b.id,
        en: b.name,
        ar: b.nameAr || b.name,
        year: b.startedYear ?? (ownerBorn.length ? Math.min(...ownerBorn) + 25 : NOW),
        owners: os,
      };
    })
    .filter((b) => b.owners.length);

  return { people: list, byId, root, maxGen, biz, minYear, n: list.length, homeColor, get };
}

export function spouseIndex(M: StudioModel, p: StudioPerson): number {
  if (!p.anchor) return 0;
  return Math.max(
    0,
    M.get(p.anchor).spouses.findIndex((s) => s.id === p.id),
  );
}

export function spouseYear(M: StudioModel, p: StudioPerson): number {
  const y = p.anchor ? M.get(p.anchor).spouses.find((s) => s.id === p.id)?.year : undefined;
  return y ?? p.born + 22;
}
