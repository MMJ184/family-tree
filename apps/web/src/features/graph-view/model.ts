import { type Business, type FamilyGraph, type Person, partialYear } from '@family-tree/shared';

// Graph model for the Obsidian-style view: one node per person and per business,
// links for parent-child, marriage and business ownership. Node objects are kept
// stable across year changes so the force layout keeps its positions.

interface NodeBase {
  id: string;
  deg: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface PersonNode extends NodeBase {
  kind: 'p';
  person: Person;
  marriedIn: boolean;
  born: number | null;
  died: number | null;
}

export interface BizNode extends NodeBase {
  kind: 'b';
  biz: Business;
  started: number | null;
}

export type GNode = PersonNode | BizNode;

export type LinkKind = 'pc' | 'sp' | 'bz';

export interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: LinkKind;
  /** Year the link appears (marriage start, business founding); null = always. */
  since: number | null;
}

export interface GraphStore {
  nodes: GNode[];
  links: GLink[];
  byId: Map<string, GNode>;
  /** Person id → founding years of their businesses (null = unknown). */
  bizYears: Map<string, Array<number | null>>;
}

export interface VisibleData {
  nodes: GNode[];
  links: GLink[];
  /** Changes only when the set of shown nodes or links changes. */
  sig: string;
  /** Neighbour ids of every shown node, for hover highlighting. */
  nb: Map<string, Set<string>>;
}

export const nid = (x: string | GNode): string => (typeof x === 'string' ? x : x.id);

/** Builds stable node and link objects; positions are carried over from `prev` when given. */
export function buildStore(graph: FamilyGraph, prev?: GraphStore | null): GraphStore {
  const marriedIn = new Set(graph.memberships.filter((m) => m.membership === 'MARRIED_IN').map((m) => m.personId));
  const nodes: GNode[] = [];
  for (const p of graph.people) {
    nodes.push({
      id: p.id,
      kind: 'p',
      person: p,
      marriedIn: marriedIn.has(p.id),
      born: partialYear(p.birth),
      died: partialYear(p.death),
      deg: 0,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const b of graph.businesses) {
    if (b.deletedAt) continue;
    nodes.push({ id: `biz:${b.id}`, kind: 'b', biz: b, started: b.startedYear, deg: 0 });
  }
  const links: GLink[] = [];
  for (const e of graph.parentChild) {
    if (ids.has(e.parentId) && ids.has(e.childId))
      links.push({ source: e.parentId, target: e.childId, kind: 'pc', since: null });
  }
  for (const m of graph.marriages) {
    if (ids.has(m.personAId) && ids.has(m.personBId))
      links.push({ source: m.personAId, target: m.personBId, kind: 'sp', since: partialYear(m.startDate) });
  }
  const bizById = new Map(graph.businesses.map((b) => [b.id, b]));
  const bizYears = new Map<string, Array<number | null>>();
  for (const pb of graph.personBusiness) {
    const b = bizById.get(pb.businessId);
    if (!b || b.deletedAt || !ids.has(pb.personId)) continue;
    links.push({ source: pb.personId, target: `biz:${b.id}`, kind: 'bz', since: b.startedYear });
    const list = bizYears.get(pb.personId) ?? [];
    list.push(b.startedYear);
    bizYears.set(pb.personId, list);
  }
  const deg = new Map<string, number>();
  for (const l of links) {
    deg.set(nid(l.source), (deg.get(nid(l.source)) ?? 0) + 1);
    deg.set(nid(l.target), (deg.get(nid(l.target)) ?? 0) + 1);
  }
  for (const n of nodes) {
    n.deg = deg.get(n.id) ?? 0;
    const old = prev?.byId.get(n.id);
    if (old?.x !== undefined) {
      n.x = old.x;
      n.y = old.y ?? 0;
      if (old.z !== undefined) n.z = old.z;
    }
  }
  return { nodes, links, byId: new Map(nodes.map((n) => [n.id, n])), bizYears };
}

const shownAt = (y: number | null, year: number | null) => year == null || y == null || y <= year;

export function isNodeShown(n: GNode, year: number | null): boolean {
  return n.kind === 'p' ? shownAt(n.born, year) : shownAt(n.started, year);
}

/** Deceased as of the slider year (or today when year is null). */
export function isDeadAt(n: PersonNode, year: number | null): boolean {
  if (year == null) return !n.person.isLiving || n.died != null;
  return n.died != null && n.died <= year;
}

export function hasBizAt(store: GraphStore, personId: string, year: number | null): boolean {
  return (store.bizYears.get(personId) ?? []).some((y) => shownAt(y, year));
}

/** What exists in the chosen year. Newcomers start beside a shown relative so the family grows outward. */
export function visibleData(store: GraphStore, year: number | null): VisibleData {
  const keep = new Set<string>();
  for (const n of store.nodes) if (isNodeShown(n, year)) keep.add(n.id);
  // Married-in people join the family with their (first) marriage, not at birth.
  for (const n of store.nodes) {
    if (n.kind !== 'p' || !n.marriedIn || !keep.has(n.id)) continue;
    const ms = store.links.filter((l) => l.kind === 'sp' && (nid(l.source) === n.id || nid(l.target) === n.id));
    if (ms.length && !ms.some((l) => shownAt(l.since, year))) keep.delete(n.id);
  }
  const links = store.links.filter((l) => keep.has(nid(l.source)) && keep.has(nid(l.target)) && shownAt(l.since, year));
  const nodes = store.nodes.filter((n) => keep.has(n.id));
  const nb = new Map<string, Set<string>>();
  for (const l of links) {
    const a = nid(l.source);
    const b = nid(l.target);
    if (!nb.has(a)) nb.set(a, new Set());
    if (!nb.has(b)) nb.set(b, new Set());
    nb.get(a)?.add(b);
    nb.get(b)?.add(a);
  }
  for (const n of nodes) {
    if (n.x !== undefined) continue;
    for (const other of nb.get(n.id) ?? []) {
      const o = store.byId.get(other);
      if (o?.x === undefined) continue;
      n.x = o.x + (Math.random() - 0.5) * 12;
      n.y = (o.y ?? 0) + (Math.random() - 0.5) * 12;
      if (o.z !== undefined) n.z = o.z + (Math.random() - 0.5) * 12;
      break;
    }
  }
  return { nodes, links, nb, sig: `${nodes.length}|${links.length}` };
}
