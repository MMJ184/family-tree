import type { Id, Marriage, ParentChild } from './schemas.ts';

// Relationship helpers over the stored edges. Siblings are derived from shared
// parents and never stored (spec §3.3).

export interface Edges {
  parentChild: ReadonlyArray<ParentChild>;
  marriages: ReadonlyArray<Marriage>;
}

export function parentsOf(edges: Edges, personId: Id): Id[] {
  return edges.parentChild.filter((e) => e.childId === personId).map((e) => e.parentId);
}

export function childrenOf(edges: Edges, personId: Id): Id[] {
  return edges.parentChild.filter((e) => e.parentId === personId).map((e) => e.childId);
}

export function spousesOf(edges: Edges, personId: Id): Id[] {
  return edges.marriages
    .filter((m) => m.personAId === personId || m.personBId === personId)
    .map((m) => (m.personAId === personId ? m.personBId : m.personAId));
}

/** Full and half siblings: anyone else sharing at least one parent. */
export function siblingsOf(edges: Edges, personId: Id): Id[] {
  const parents = new Set(parentsOf(edges, personId));
  const out = new Set<Id>();
  for (const e of edges.parentChild) {
    if (parents.has(e.parentId) && e.childId !== personId) out.add(e.childId);
  }
  return [...out];
}

export function ancestorsOf(edges: Edges, personId: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [personId];
  while (stack.length) {
    const cur = stack.pop() as Id;
    for (const p of parentsOf(edges, cur)) {
      if (!out.has(p)) {
        out.add(p);
        stack.push(p);
      }
    }
  }
  return out;
}

export function descendantsOf(edges: Edges, personId: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [personId];
  while (stack.length) {
    const cur = stack.pop() as Id;
    for (const c of childrenOf(edges, cur)) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/**
 * A person's branch, as the tree views zoom to it: the person, their parents,
 * their spouses, and every descendant with the descendants' spouses.
 */
export function branchOf(edges: Edges, personId: Id): Set<Id> {
  const out = new Set<Id>([personId, ...parentsOf(edges, personId)]);
  for (const id of [personId, ...descendantsOf(edges, personId)]) {
    out.add(id);
    for (const s of spousesOf(edges, id)) out.add(s);
  }
  return out;
}

export type ParentLinkError = 'SELF' | 'CYCLE' | 'DUPLICATE' | 'TOO_MANY_BIOLOGICAL_PARENTS';

/**
 * Checks the invariants for a new ParentChild edge: no one is their own
 * ancestor, no duplicate edge, and at most two biological parents.
 */
export function checkParentLink(
  edges: Edges,
  parentId: Id,
  childId: Id,
  type: ParentChild['type'],
): ParentLinkError | null {
  if (parentId === childId) return 'SELF';
  if (edges.parentChild.some((e) => e.parentId === parentId && e.childId === childId)) return 'DUPLICATE';
  if (descendantsOf(edges, childId).has(parentId)) return 'CYCLE';
  if (type === 'BIOLOGICAL') {
    const bio = edges.parentChild.filter((e) => e.childId === childId && e.type === 'BIOLOGICAL');
    if (bio.length >= 2) return 'TOO_MANY_BIOLOGICAL_PARENTS';
  }
  return null;
}

/**
 * Generation number per person (0 = the earliest generation in the set).
 * People with no parents in the set take their spouse's generation (married-in
 * members sit beside the person they married), or 0 when the spouse has none either.
 */
export function generations(edges: Edges, personIds: ReadonlyArray<Id>): Map<Id, number> {
  const ids = new Set(personIds);
  const gen = new Map<Id, number>();
  const visiting = new Set<Id>();
  const parentsIn = (pid: Id) => parentsOf(edges, pid).filter((p) => ids.has(p));
  const visit = (pid: Id): number => {
    const known = gen.get(pid);
    if (known != null) return known;
    if (visiting.has(pid)) return 0;
    visiting.add(pid);
    const ps = parentsIn(pid);
    let g = 0;
    if (ps.length) {
      g = Math.max(...ps.map(visit)) + 1;
    } else {
      const spouse = spousesOf(edges, pid).find((s) => ids.has(s) && parentsIn(s).length > 0);
      if (spouse) g = visit(spouse);
    }
    visiting.delete(pid);
    gen.set(pid, g);
    return g;
  };
  for (const pid of ids) visit(pid);
  return gen;
}
