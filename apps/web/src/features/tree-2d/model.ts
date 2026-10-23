import { type FamilyGraph, type MarriageStatus, type Person, partialYear } from '@family-tree/shared';

// The tree model shared by the 2D views: one "union" per couple (or single
// parent) that children hang from, the same idea as docs/prototypes/tree-views.html.

export interface Union {
  id: string;
  a: string;
  /** null for a child recorded with a single parent. */
  b: string | null;
  year: number | null;
  status: MarriageStatus | null;
  kids: string[];
}

export interface TreeModel {
  people: Map<string, Person>;
  unions: Union[];
  unionById: Map<string, Union>;
  /** Unions a person is a partner in, ordered by marriage year. */
  unionsOf: Map<string, Union[]>;
  /** The union a child hangs from. */
  parentUnion: Map<string, Union>;
  /** Person and union ids in a stable model order (parents before children, siblings by birth). */
  order: string[];
  born: Map<string, number | null>;
  marriedIn: Set<string>;
  /** Started year of each business a person is linked to (null = unknown, always shown). */
  businessYears: Map<string, Array<number | null>>;
}

const byBirth = (born: Map<string, number | null>) => (x: string, y: string) =>
  (born.get(x) ?? 9999) - (born.get(y) ?? 9999) || x.localeCompare(y);

export function buildModel(graph: FamilyGraph): TreeModel {
  const people = new Map(graph.people.map((p) => [p.id, p]));
  const born = new Map(graph.people.map((p) => [p.id, partialYear(p.birth)]));
  const marriedIn = new Set(graph.memberships.filter((m) => m.membership === 'MARRIED_IN').map((m) => m.personId));
  const unions: Union[] = [];
  const unionById = new Map<string, Union>();
  const unionsOf = new Map<string, Union[]>();
  const pairKey = (a: string, b: string | null) => (b == null ? a : a < b ? `${a}|${b}` : `${b}|${a}`);
  const byPair = new Map<string, Union>();

  const addUnion = (u: Union) => {
    unions.push(u);
    unionById.set(u.id, u);
    byPair.set(pairKey(u.a, u.b), u);
    for (const pid of [u.a, u.b]) {
      if (pid == null) continue;
      const list = unionsOf.get(pid) ?? [];
      list.push(u);
      unionsOf.set(pid, list);
    }
  };

  for (const m of graph.marriages) {
    if (!people.has(m.personAId) || !people.has(m.personBId)) continue;
    if (byPair.has(pairKey(m.personAId, m.personBId))) continue;
    addUnion({
      id: `u:${m.id}`,
      a: m.personAId,
      b: m.personBId,
      year: partialYear(m.startDate),
      status: m.status,
      kids: [],
    });
  }

  // Each child hangs from one union: the couple of its (preferably biological) parents.
  const parentsByChild = new Map<string, typeof graph.parentChild>();
  for (const e of graph.parentChild) {
    if (!people.has(e.parentId) || !people.has(e.childId)) continue;
    const list = parentsByChild.get(e.childId) ?? [];
    list.push(e);
    parentsByChild.set(e.childId, list);
  }
  const parentUnion = new Map<string, Union>();
  for (const [childId, edges] of parentsByChild) {
    const sorted = [...edges].sort((x, y) => Number(y.type === 'BIOLOGICAL') - Number(x.type === 'BIOLOGICAL'));
    const [p1, p2] = sorted.map((e) => e.parentId) as [string, string | undefined];
    const key = pairKey(p1, p2 ?? null);
    let u = byPair.get(key);
    if (!u) {
      u = { id: `s:${key}`, a: p1, b: p2 ?? null, year: null, status: null, kids: [] };
      addUnion(u);
    }
    u.kids.push(childId);
    parentUnion.set(childId, u);
  }

  const cmp = byBirth(born);
  for (const u of unions) u.kids.sort(cmp);
  for (const list of unionsOf.values()) list.sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));

  // Model order: depth-first from the earliest roots, so ELK keeps siblings in birth order.
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (pid: string) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    order.push(pid);
    visitUnions(pid);
  };
  const visitUnions = (pid: string) => {
    for (const u of unionsOf.get(pid) ?? []) {
      if (seen.has(u.id)) continue;
      const partner = u.a === pid ? u.b : u.a;
      if (partner && !seen.has(partner)) {
        seen.add(partner);
        order.push(partner);
      }
      seen.add(u.id);
      order.push(u.id);
      for (const k of u.kids) visit(k);
      if (partner) visitUnions(partner);
    }
  };
  const roots = graph.people
    .map((p) => p.id)
    .filter((id) => !parentUnion.has(id))
    .sort((x, y) => Number(marriedIn.has(x)) - Number(marriedIn.has(y)) || cmp(x, y));
  for (const r of roots) visit(r);
  for (const p of graph.people) visit(p.id);

  const businessStart = new Map(graph.businesses.map((b) => [b.id, b.startedYear]));
  const businessYears = new Map<string, Array<number | null>>();
  for (const pb of graph.personBusiness) {
    if (!businessStart.has(pb.businessId)) continue;
    const list = businessYears.get(pb.personId) ?? [];
    list.push(businessStart.get(pb.businessId) ?? null);
    businessYears.set(pb.personId, list);
  }

  return { people, unions, unionById, unionsOf, parentUnion, order, born, marriedIn, businessYears };
}

export function partnerOf(u: Union, pid: string): string | null {
  return u.a === pid ? u.b : u.a;
}

/** The partner who carries a union's collapse toggle: the one born into the tree (else the first). */
export function unionOwner(model: TreeModel, u: Union): string {
  return u.b != null && model.parentUnion.has(u.b) && !model.parentUnion.has(u.a) ? u.b : u.a;
}

/** Whether the person's card shows a collapse toggle (one per couple, on the born-in partner). */
export function hasChildren(model: TreeModel, pid: string): boolean {
  return (model.unionsOf.get(pid) ?? []).some((u) => u.kids.length > 0 && unionOwner(model, u) === pid);
}

/** Everyone hidden because an ancestor's branch is collapsed: descendants plus their married-in spouses. */
export function collapsedHidden(model: TreeModel, collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  const hideSubtree = (pid: string) => {
    if (hidden.has(pid)) return;
    hidden.add(pid);
    for (const u of model.unionsOf.get(pid) ?? []) {
      const partner = partnerOf(u, pid);
      if (partner && !model.parentUnion.has(partner) && !collapsed.has(partner)) {
        hidden.add(partner);
        for (const pu of model.unionsOf.get(partner) ?? []) for (const k of pu.kids) hideSubtree(k);
      }
      for (const k of u.kids) hideSubtree(k);
    }
  };
  for (const c of collapsed) {
    if (hidden.has(c)) continue;
    for (const u of model.unionsOf.get(c) ?? []) for (const k of u.kids) hideSubtree(k);
  }
  // A collapsed root's married-in partner stays; everything below it goes.
  for (const c of collapsed) hidden.delete(c);
  return hidden;
}

/**
 * Who is shown at `year`: born by then, and married-in spouses only once their
 * marriage has happened. Returns hidden people and hidden unions.
 */
export function yearHidden(model: TreeModel, year: number | null, base: ReadonlySet<string>) {
  const people = new Set(base);
  const unions = new Set<string>();
  if (year != null) {
    for (const [id, b] of model.born) if (b != null && b > year) people.add(id);
  }
  for (const u of model.unions) {
    const aGone = people.has(u.a);
    const bGone = u.b != null && people.has(u.b);
    const notYet = year != null && u.year != null && u.year > year;
    if (
      notYet ||
      (aGone && (u.b == null || bGone)) ||
      ((aGone || bGone || u.b == null) && u.kids.every((k) => people.has(k)))
    ) {
      unions.add(u.id);
    }
  }
  // A married-in spouse with no parents here appears with their first visible marriage.
  for (const [id] of model.people) {
    if (people.has(id) || model.parentUnion.has(id)) continue;
    const us = model.unionsOf.get(id);
    if (us?.length && us.every((u) => unions.has(u.id))) people.add(id);
  }
  return { people, unions };
}

export function hasBusinessBy(model: TreeModel, pid: string, year: number | null): boolean {
  const years = model.businessYears.get(pid);
  if (!years) return false;
  return year == null || years.some((y) => y == null || y <= year);
}

export function countDescendants(model: TreeModel, pid: string): number {
  const seen = new Set<string>();
  const stack = [pid];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const u of model.unionsOf.get(cur) ?? []) {
      for (const k of u.kids) {
        if (!seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
    }
  }
  return seen.size;
}

/**
 * The people and unions that make up `pid`'s branch: the person, their parents,
 * their spouses and every descendant with the descendants' spouses. The tree
 * zooms to fit this set when a person is selected.
 */
export function branchIds(model: TreeModel, pid: string): Set<string> {
  const out = new Set<string>([pid]);
  const parents = model.parentUnion.get(pid);
  if (parents) {
    out.add(parents.id);
    out.add(parents.a);
    if (parents.b != null) out.add(parents.b);
  }
  const stack = [pid];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const u of model.unionsOf.get(cur) ?? []) {
      out.add(u.id);
      const partner = partnerOf(u, cur);
      if (partner) out.add(partner);
      for (const k of u.kids) {
        if (out.has(k)) continue;
        out.add(k);
        stack.push(k);
      }
    }
  }
  return out;
}

/** Collapsed people whose branch currently hides `pid` (its ancestors along union links). */
export function collapsedAncestors(model: TreeModel, pid: string, collapsed: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [pid];
  // A married-in spouse is hidden through their partner's line.
  for (const u of model.unionsOf.get(pid) ?? []) {
    const partner = partnerOf(u, pid);
    if (partner && !model.parentUnion.has(pid)) stack.push(partner);
  }
  while (stack.length) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const u = model.parentUnion.get(cur);
    if (!u) continue;
    for (const p of [u.a, u.b]) {
      if (p == null) continue;
      if (collapsed.has(p)) out.add(p);
      stack.push(p);
    }
  }
  return [...out];
}
