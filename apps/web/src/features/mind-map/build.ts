import { type FamilyGraph, type Marriage, type Person, partialYear } from '@family-tree/shared';
import type { NodeObj, TagObj } from 'mind-elixir';
import { familyName, personName, personYears } from '#/lib/display.ts';

// Turns a FamilyGraph into Mind Elixir data: either the whole family branching
// from its founders, or one person's relatives. Each node carries the person id
// in `metadata` so a click can select that person.

export interface MindMeta {
  personId?: string;
}

export interface MindLabels {
  t: (key: string, opts?: Record<string, unknown>) => string;
  lang: string;
  rtl: boolean;
  mutedColor: string;
}

export interface BuiltMind {
  root: NodeObj;
  /** First map node shown for each person, for highlighting and scrolling. */
  firstNode: Map<string, string>;
}

interface Ctx {
  graph: FamilyGraph;
  year: number | null;
  L: MindLabels;
  byId: Map<string, Person>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  marriages: Map<string, Marriage[]>;
  firstNode: Map<string, string>;
  seq: number;
}

const born = (p: Person) => partialYear(p.birth);

function makeCtx(graph: FamilyGraph, year: number | null, L: MindLabels): Ctx {
  const byId = new Map(graph.people.map((p) => [p.id, p]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of graph.parentChild) {
    if (!byId.has(e.parentId) || !byId.has(e.childId)) continue;
    parents.set(e.childId, [...(parents.get(e.childId) ?? []), e.parentId]);
    children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.childId]);
  }
  const marriages = new Map<string, Marriage[]>();
  for (const m of graph.marriages) {
    if (!byId.has(m.personAId) || !byId.has(m.personBId)) continue;
    marriages.set(m.personAId, [...(marriages.get(m.personAId) ?? []), m]);
    marriages.set(m.personBId, [...(marriages.get(m.personBId) ?? []), m]);
  }
  return { graph, year, L, byId, parents, children, marriages, firstNode: new Map(), seq: 0 };
}

const visible = (c: Ctx, id: string) => {
  const p = c.byId.get(id);
  if (!p) return false;
  const b = born(p);
  return c.year == null || b == null || b <= c.year;
};
const deadAt = (c: Ctx, p: Person) => {
  const d = partialYear(p.death);
  return c.year == null ? !p.isLiving || d != null : d != null && d <= c.year;
};
const marriageVisible = (c: Ctx, m: Marriage) => {
  const y = partialYear(m.startDate);
  return visible(c, m.personAId) && visible(c, m.personBId) && (c.year == null || y == null || y <= c.year);
};
const other = (m: Marriage, id: string) => (m.personAId === id ? m.personBId : m.personAId);
const byBirth = (c: Ctx) => (a: string, b: string) => {
  const ya = born(c.byId.get(a) as Person) ?? 9999;
  const yb = born(c.byId.get(b) as Person) ?? 9999;
  return ya - yb;
};

const nameOf = (c: Ctx, id: string) => {
  const p = c.byId.get(id);
  return p ? personName(p, c.L.lang) : '';
};

// Digits stay left-to-right inside Arabic; names follow the language.
const yearTag = (text: string): TagObj => ({ text, style: { direction: 'ltr', unicodeBidi: 'isolate' } });
const textTag = (c: Ctx, text: string): TagObj => ({
  text,
  style: { direction: c.L.rtl ? 'rtl' : 'ltr', unicodeBidi: 'isolate' },
});

function nodeId(c: Ctx, kind: string, id: string) {
  c.seq += 1;
  return `${kind}_${id.replace(/[^\w-]/g, '')}_${c.seq}`;
}

function personNode(c: Ctx, id: string, extraTags: TagObj[] = []): NodeObj {
  const p = c.byId.get(id) as Person;
  const uid = nodeId(c, 'p', id);
  if (!c.firstNode.has(id)) c.firstNode.set(id, uid);
  const years = personYears(p);
  const node: NodeObj = {
    id: uid,
    topic: personName(p, c.L.lang),
    tags: [...(years ? [yearTag(years)] : []), ...extraTags],
    children: [],
    metadata: { personId: id } satisfies MindMeta,
  };
  if (deadAt(c, p)) node.style = { color: c.L.mutedColor };
  return node;
}

/** A person with their descendants; several marriages get one branch each. */
function descendantNode(c: Ctx, id: string, seen: Set<string>): NodeObj {
  seen.add(id);
  const node = personNode(c, id);
  const kids = (c.children.get(id) ?? []).filter((k) => visible(c, k) && !seen.has(k)).sort(byBirth(c));
  const ms = (c.marriages.get(id) ?? []).filter((m) => marriageVisible(c, m));
  const kidNode = (k: string) => (seen.has(k) ? null : descendantNode(c, k, seen));
  if (ms.length <= 1) {
    const m = ms[0];
    if (m) node.tags?.push(textTag(c, `⚭ ${nameOf(c, other(m, id))}`));
    node.children = kids.map(kidNode).filter((n): n is NodeObj => !!n);
    return node;
  }
  const placed = new Set<string>();
  const branches: NodeObj[] = ms.map((m) => {
    const s = other(m, id);
    const mine = kids.filter((k) => (c.parents.get(k) ?? []).includes(s));
    for (const k of mine) placed.add(k);
    const y = partialYear(m.startDate);
    const uid = nodeId(c, 'p', s);
    return {
      id: uid,
      topic: `⚭ ${nameOf(c, s)}`,
      tags: y ? [yearTag(String(y))] : [],
      metadata: { personId: s } satisfies MindMeta,
      children: mine.map(kidNode).filter((n): n is NodeObj => !!n),
    };
  });
  const rest = kids
    .filter((k) => !placed.has(k))
    .map(kidNode)
    .filter((n): n is NodeObj => !!n);
  node.children = [...branches, ...rest];
  return node;
}

function businessesBranch(c: Ctx): NodeObj | null {
  const owners = new Map<string, string[]>();
  for (const pb of c.graph.personBusiness)
    owners.set(pb.businessId, [...(owners.get(pb.businessId) ?? []), pb.personId]);
  const items = c.graph.businesses
    .filter((b) => !b.deletedAt && (c.year == null || b.startedYear == null || b.startedYear <= c.year))
    .map<NodeObj>((b) => ({
      id: nodeId(c, 'b', b.id),
      topic: (c.L.lang === 'ar' ? b.nameAr : null) || b.name,
      tags: b.startedYear ? [yearTag(String(b.startedYear))] : [],
      children: (owners.get(b.id) ?? []).filter((o) => visible(c, o)).map((o) => personNode(c, o)),
    }));
  if (!items.length) return null;
  return { id: nodeId(c, 'g', 'biz'), topic: c.L.t('groups.businesses'), children: items };
}

/**
 * Branch order for the SIDE layout, mirrored by language: English starts on the
 * right and grows rightwards (reading direction); Arabic starts on the left and
 * grows leftwards. Mind Elixir alternates sides from there.
 */
function sideOrder(root: NodeObj, rtl: boolean) {
  (root.children ?? []).forEach((n, i) => {
    const first = rtl ? 0 : 1;
    n.direction = i % 2 === 0 ? first : first === 1 ? 0 : 1;
  });
}

export function familyMind(graph: FamilyGraph, year: number | null, L: MindLabels): BuiltMind {
  const c = makeCtx(graph, year, L);
  const people = graph.people.filter((p) => visible(c, p.id));
  const hasParents = (id: string) => (c.parents.get(id) ?? []).length > 0;
  // Founders: no parents here, and not the spouse of someone who has parents (married-in people show as ⚭ tags).
  const roots = people
    .filter((p) => !hasParents(p.id))
    .filter((p) => !(c.marriages.get(p.id) ?? []).some((m) => hasParents(other(m, p.id))))
    .map((p) => p.id)
    .sort(byBirth(c));
  const anchors: string[] = [];
  for (const id of roots) {
    const taken = (c.marriages.get(id) ?? []).some((m) => anchors.includes(other(m, id)));
    // Of a founding couple, the elder partner leads the branch.
    if (!taken) anchors.push(id);
  }
  const seen = new Set<string>();
  const title = familyName(graph.family, L.lang);
  let root: NodeObj;
  const first = anchors[0];
  if (anchors.length === 1 && first) {
    const lead = descendantNode(c, first, seen);
    const founders = [
      nameOf(c, first),
      ...(c.marriages.get(first) ?? []).filter((m) => marriageVisible(c, m)).map((m) => nameOf(c, other(m, first))),
    ];
    root = {
      id: lead.id,
      topic: title,
      tags: [textTag(c, founders.join(' ⚭ '))],
      metadata: lead.metadata,
      children: lead.children ?? [],
    };
  } else {
    root = {
      id: nodeId(c, 'g', 'family'),
      topic: title,
      children: anchors.map((a) => descendantNode(c, a, seen)),
    };
  }
  const biz = businessesBranch(c);
  if (biz) root.children?.push(biz);
  sideOrder(root, L.rtl);
  return { root, firstNode: c.firstNode };
}

export function personMind(graph: FamilyGraph, personId: string, year: number | null, L: MindLabels): BuiltMind {
  const c = makeCtx(graph, year, L);
  const p = c.byId.get(personId);
  if (!p) return { root: { id: 'empty', topic: familyName(graph.family, L.lang) }, firstNode: c.firstNode };
  const parents = (c.parents.get(personId) ?? []).filter((id) => visible(c, id));
  const spouses = (c.marriages.get(personId) ?? []).filter((m) => marriageVisible(c, m));
  const kids = (c.children.get(personId) ?? []).filter((id) => visible(c, id)).sort(byBirth(c));
  const myParents = new Set(c.parents.get(personId) ?? []);
  const sibs = new Map<string, boolean>();
  for (const par of myParents)
    for (const k of c.children.get(par) ?? []) {
      if (k === personId || !visible(c, k)) continue;
      const theirs = c.parents.get(k) ?? [];
      const full = theirs.length === myParents.size && theirs.every((x) => myParents.has(x));
      sibs.set(k, (sibs.get(k) ?? true) && !full);
    }
  const sibIds = [...sibs.keys()].sort(byBirth(c));
  const bizIds = new Set(c.graph.personBusiness.filter((pb) => pb.personId === personId).map((pb) => pb.businessId));
  const biz = c.graph.businesses.filter(
    (b) => bizIds.has(b.id) && !b.deletedAt && (c.year == null || b.startedYear == null || b.startedYear <= c.year),
  );
  const groups: Array<[string, NodeObj[]]> = [
    ['parents', parents.map((id) => personNode(c, id))],
    [
      'spouses',
      spouses.map((m) => {
        const y = partialYear(m.startDate);
        return personNode(c, other(m, personId), y ? [yearTag(`⚭ ${y}`)] : []);
      }),
    ],
    ['children', kids.map((id) => personNode(c, id))],
    ['siblings', sibIds.map((id) => personNode(c, id, sibs.get(id) ? [textTag(c, L.t('half'))] : []))],
    [
      'businesses',
      biz.map<NodeObj>((b) => ({
        id: nodeId(c, 'b', b.id),
        topic: (L.lang === 'ar' ? b.nameAr : null) || b.name,
        tags: b.startedYear ? [yearTag(String(b.startedYear))] : [],
      })),
    ],
  ];
  const self = personNode(c, personId);
  if (!visible(c, personId)) self.tags = [textTag(c, L.t('notBorn', { year }))];
  const root = {
    ...self,
    children: groups
      .filter(([, items]) => items.length)
      .map(([k, items]) => ({ id: nodeId(c, 'g', k), topic: L.t(`groups.${k}`), children: items })),
  };
  sideOrder(root, L.rtl);
  return { root, firstNode: c.firstNode };
}
