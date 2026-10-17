import {
  checkParentLink,
  type Edges,
  type EffectiveRole,
  type Family,
  type Marriage,
  type MarriageStatus,
  type Membership,
  type ParentChild,
  type ParentChildType,
  type PartialDate,
  type Person,
  type PersonInput,
  partialDate,
} from '@family-tree/shared';
import { commit, getDb, newId } from '#/mock/db.ts';
import {
  accessibleFamilies,
  currentUser,
  familyPersonIds,
  isAdminRole,
  redactPerson,
  requireFamily,
  requirePersonInFamily,
} from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';
import { insertPerson } from './people.ts';

// Relationship service: POST /families/:familyId/people/:personId/{parents,children,spouses,siblings},
// DELETE /families/:familyId/parent-child/:edgeId, PATCH/DELETE /families/:familyId/marriages/:id.
// Invariants (spec §5): no one is their own ancestor, at most two biological
// parents, no duplicate edges. Siblings are never stored: adding a sibling links
// the new person as a child of the same parents.

/** Either a brand-new person, or someone who already exists. */
export type RelativeSource = { kind: 'new'; input: PersonInput } | { kind: 'existing'; personId: string };

export interface AddParentInput {
  parent: RelativeSource;
  type: ParentChildType;
  /** Also record a marriage between the new parent and the child's existing parent. */
  marryParentId?: string;
}

export interface AddChildInput {
  child: RelativeSource;
  type: ParentChildType;
  /** The child's other parent (usually a spouse of the person). */
  otherParentId?: string;
}

export interface MarriageInput {
  status: MarriageStatus;
  startDate: PartialDate | null;
  endDate: PartialDate | null;
}

export interface AddSpouseInput extends MarriageInput {
  spouse: RelativeSource;
}

export interface AddSiblingInput {
  sibling: RelativeSource;
}

export interface LinkCandidate {
  person: Person;
  family: Family;
  membership: Membership;
}

export type RelationKind = 'parent' | 'child' | 'spouse' | 'sibling';

/**
 * Every stored edge, including those of soft-deleted people. Cycle and duplicate
 * checks span the whole account and count deleted people too, so restoring a
 * record can never bring back a cycle.
 */
function allEdges(): Edges {
  const db = getDb();
  return { parentChild: db.parentChild, marriages: db.marriages };
}

function assertParentLink(parentId: string, childId: string, type: ParentChildType, extra: ParentChild[] = []) {
  const edges = allEdges();
  const parentChild = [...edges.parentChild, ...extra];
  const err = checkParentLink({ ...edges, parentChild }, parentId, childId, type);
  if (err === 'SELF') throw new ApiError('VALIDATION', 'self');
  if (err === 'CYCLE') throw new ApiError('CYCLE');
  if (err === 'DUPLICATE') throw new ApiError('CONFLICT');
  if (err === 'TOO_MANY_BIOLOGICAL_PARENTS') {
    // The two-parent limit only counts parents who are not deleted.
    const deleted = new Set(
      getDb()
        .people.filter((p) => p.deletedAt)
        .map((p) => p.id),
    );
    const live = parentChild.filter(
      (e) => e.childId === childId && e.type === 'BIOLOGICAL' && !deleted.has(e.parentId),
    );
    if (live.length >= 2) throw new ApiError('TOO_MANY_PARENTS');
  }
}

function validDate(d: PartialDate | null): PartialDate | null {
  if (!d) return null;
  const parsed = partialDate.safeParse(d);
  if (!parsed.success) throw new ApiError('VALIDATION');
  return parsed.data;
}

/**
 * Resolves the relative. Parents, children and siblings must already be in this
 * family; a spouse may come from any family the user can access on this account
 * (married-in flow, spec §6 flow 4) and is then added to this family as MARRIED_IN.
 */
function resolveExisting(familyId: string, personId: string, kind: RelationKind): Person {
  if (kind !== 'spouse' || familyPersonIds(familyId).has(personId)) return requirePersonInFamily(familyId, personId);
  const user = currentUser();
  const fam = spouseSourceFamilies(familyId).find(({ family }) => familyPersonIds(family.id).has(personId));
  const person = fam && getDb().people.find((p) => p.id === personId && !p.deletedAt);
  if (!person || person.clientId !== user.clientId) throw new ApiError('NOT_FOUND');
  return person;
}

/**
 * Families an existing spouse may be picked from: the current family, plus other
 * families where the user is an admin (Super Admin or Family Admin). Archived
 * families are never a source, for Super Admin too.
 */
function spouseSourceFamilies(familyId: string): Array<{ family: Family; role: EffectiveRole }> {
  return accessibleFamilies(currentUser()).filter(
    ({ family, role }) => family.id === familyId || (isAdminRole(role) && !family.archivedAt),
  );
}

function ensureMembership(familyId: string, personId: string, membership: Membership) {
  const db = getDb();
  if (!db.familyPeople.some((fp) => fp.familyId === familyId && fp.personId === personId)) {
    db.familyPeople.push({ familyId, personId, membership });
  }
}

/** Returns the existing person's id, or creates the new person in this family. */
function materialise(familyId: string, source: RelativeSource, kind: RelationKind, membership: Membership): string {
  if (source.kind === 'new') return insertPerson(familyId, source.input, membership).id;
  const person = resolveExisting(familyId, source.personId, kind);
  ensureMembership(familyId, person.id, membership);
  return person.id;
}

function pushEdge(parentId: string, childId: string, type: ParentChildType): ParentChild {
  const edge: ParentChild = { id: newId('pc'), parentId, childId, type };
  getDb().parentChild.push(edge);
  return edge;
}

function pushMarriage(aId: string, bId: string, m: MarriageInput): Marriage {
  const db = getDb();
  if (aId === bId) throw new ApiError('VALIDATION', 'self');
  if (
    db.marriages.some(
      (x) => (x.personAId === aId && x.personBId === bId) || (x.personAId === bId && x.personBId === aId),
    )
  ) {
    throw new ApiError('CONFLICT');
  }
  const marriage: Marriage = {
    id: newId('mar'),
    personAId: aId,
    personBId: bId,
    status: m.status,
    startDate: validDate(m.startDate),
    endDate: validDate(m.endDate),
  };
  db.marriages.push(marriage);
  return marriage;
}

const PLACEHOLDER = '__new__';

export function addParent(familyId: string, childId: string, input: AddParentInput): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    requirePersonInFamily(familyId, childId);
    const existingId = input.parent.kind === 'existing' ? input.parent.personId : PLACEHOLDER;
    // Check before creating anything, so a rejected link leaves no stray person behind.
    assertParentLink(existingId, childId, input.type);
    if (input.marryParentId) requirePersonInFamily(familyId, input.marryParentId);
    const parentId = materialise(familyId, input.parent, 'parent', 'BORN');
    pushEdge(parentId, childId, input.type);
    if (input.marryParentId && input.marryParentId !== parentId) {
      const db = getDb();
      const married = db.marriages.some(
        (m) =>
          (m.personAId === parentId && m.personBId === input.marryParentId) ||
          (m.personBId === parentId && m.personAId === input.marryParentId),
      );
      if (!married) pushMarriage(input.marryParentId, parentId, { status: 'MARRIED', startDate: null, endDate: null });
    }
    commit();
    return getDb().people.find((p) => p.id === parentId) as Person;
  });
}

export function addChild(familyId: string, parentId: string, input: AddChildInput): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    requirePersonInFamily(familyId, parentId);
    if (input.otherParentId) requirePersonInFamily(familyId, input.otherParentId);
    const childKey = input.child.kind === 'existing' ? input.child.personId : PLACEHOLDER;
    assertParentLink(parentId, childKey, input.type);
    if (input.otherParentId) {
      assertParentLink(input.otherParentId, childKey, input.type, [
        { id: PLACEHOLDER, parentId, childId: childKey, type: input.type },
      ]);
    }
    const childId = materialise(familyId, input.child, 'child', 'BORN');
    pushEdge(parentId, childId, input.type);
    if (input.otherParentId) pushEdge(input.otherParentId, childId, input.type);
    commit();
    return getDb().people.find((p) => p.id === childId) as Person;
  });
}

export function addSpouse(familyId: string, personId: string, input: AddSpouseInput): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    requirePersonInFamily(familyId, personId);
    if (input.spouse.kind === 'existing') {
      const otherId = input.spouse.personId;
      if (otherId === personId) throw new ApiError('VALIDATION', 'self');
      resolveExisting(familyId, otherId, 'spouse');
      const db = getDb();
      if (
        db.marriages.some(
          (m) =>
            (m.personAId === personId && m.personBId === otherId) ||
            (m.personAId === otherId && m.personBId === personId),
        )
      ) {
        throw new ApiError('CONFLICT');
      }
    }
    const spouseId = materialise(familyId, input.spouse, 'spouse', 'MARRIED_IN');
    pushMarriage(personId, spouseId, input);
    commit();
    return getDb().people.find((p) => p.id === spouseId) as Person;
  });
}

export function addSibling(familyId: string, personId: string, input: AddSiblingInput): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    requirePersonInFamily(familyId, personId);
    // Only live parents who are in this family: a married-in person's parents from
    // another family are never linked to, and the sibling joins the parents' family.
    const inFamily = familyPersonIds(familyId);
    const parents = getDb().parentChild.filter((e) => e.childId === personId && inFamily.has(e.parentId));
    if (parents.length === 0) throw new ApiError('VALIDATION', 'noParents');
    const key = input.sibling.kind === 'existing' ? input.sibling.personId : PLACEHOLDER;
    if (key === personId) throw new ApiError('VALIDATION', 'self');
    const pending: ParentChild[] = [];
    const toAdd = parents.filter(
      (e) => !getDb().parentChild.some((x) => x.parentId === e.parentId && x.childId === key),
    );
    if (toAdd.length === 0) throw new ApiError('CONFLICT');
    for (const e of toAdd) {
      assertParentLink(e.parentId, key, e.type, pending);
      pending.push({ id: PLACEHOLDER, parentId: e.parentId, childId: key, type: e.type });
    }
    const siblingId = materialise(familyId, input.sibling, 'sibling', 'BORN');
    for (const e of toAdd) pushEdge(e.parentId, siblingId, e.type);
    commit();
    return getDb().people.find((p) => p.id === siblingId) as Person;
  });
}

/** An edge belongs to a family only when both of its people are (live) members of it. */
function edgeInFamily(familyId: string, a: string, b: string) {
  const ids = familyPersonIds(familyId);
  if (!ids.has(a) || !ids.has(b)) throw new ApiError('NOT_FOUND');
}

export function removeParentChild(familyId: string, edgeId: string): Promise<void> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const db = getDb();
    const edge = db.parentChild.find((e) => e.id === edgeId);
    if (!edge) throw new ApiError('NOT_FOUND');
    edgeInFamily(familyId, edge.parentId, edge.childId);
    db.parentChild = db.parentChild.filter((e) => e.id !== edgeId);
    commit();
  });
}

export function updateMarriage(familyId: string, marriageId: string, input: MarriageInput): Promise<Marriage> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const m = getDb().marriages.find((x) => x.id === marriageId);
    if (!m) throw new ApiError('NOT_FOUND');
    edgeInFamily(familyId, m.personAId, m.personBId);
    m.status = input.status;
    m.startDate = validDate(input.startDate);
    m.endDate = validDate(input.endDate);
    commit();
    return m;
  });
}

/**
 * Removes a marriage. A married-in partner who is linked into this family only
 * through it, and who still belongs to another family, leaves this family's tree.
 */
export function removeMarriage(familyId: string, marriageId: string): Promise<void> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const db = getDb();
    const m = db.marriages.find((x) => x.id === marriageId);
    if (!m) throw new ApiError('NOT_FOUND');
    edgeInFamily(familyId, m.personAId, m.personBId);
    db.marriages = db.marriages.filter((x) => x.id !== marriageId);
    const ids = familyPersonIds(familyId);
    for (const pid of [m.personAId, m.personBId]) {
      const row = db.familyPeople.find((fp) => fp.familyId === familyId && fp.personId === pid);
      if (row?.membership !== 'MARRIED_IN') continue;
      const elsewhere = db.familyPeople.some((fp) => fp.personId === pid && fp.familyId !== familyId);
      const stillLinked =
        db.marriages.some(
          (x) => (x.personAId === pid && ids.has(x.personBId)) || (x.personBId === pid && ids.has(x.personAId)),
        ) ||
        db.parentChild.some(
          (e) => (e.parentId === pid && ids.has(e.childId)) || (e.childId === pid && ids.has(e.parentId)),
        );
      if (elsewhere && !stillLinked) db.familyPeople = db.familyPeople.filter((fp) => fp !== row);
    }
    commit();
  });
}

/**
 * People an admin may pick as an existing relative. For a spouse that is anyone in
 * the current family or in another non-archived family the user administers
 * (Super Admin: every family; a Family Admin: only their own), so no other family
 * is ever revealed. For the other relations it is the current family.
 */
export function listLinkCandidates(familyId: string, kind: RelationKind): Promise<LinkCandidate[]> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const db = getDb();
    const families = (
      kind === 'spouse'
        ? spouseSourceFamilies(familyId)
        : accessibleFamilies(currentUser()).filter(({ family }) => family.id === familyId)
    )
      // The current family first, so its people are listed before others.
      .sort((a, b) => Number(b.family.id === familyId) - Number(a.family.id === familyId));
    const seen = new Set<string>();
    const out: LinkCandidate[] = [];
    for (const { family, role } of families) {
      for (const fp of db.familyPeople) {
        if (fp.familyId !== family.id || seen.has(fp.personId)) continue;
        const p = db.people.find((x) => x.id === fp.personId && !x.deletedAt);
        if (!p) continue;
        seen.add(p.id);
        out.push({ person: redactPerson(p, role), family, membership: fp.membership });
      }
    }
    return out;
  });
}
