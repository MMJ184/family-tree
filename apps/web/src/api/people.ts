import {
  type Business,
  type BusinessRole,
  type EffectiveRole,
  type Family,
  type Marriage,
  type Membership,
  type ParentChildType,
  type Person,
  type PersonInput,
  personInput,
} from '@family-tree/shared';
import { commit, getDb, newId } from '#/mock/db.ts';
import {
  accessibleFamilies,
  currentUser,
  familyPersonIds,
  redactBusiness,
  redactPerson,
  requireFamily,
  requirePersonInFamily,
} from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';

// People service: GET/POST/PATCH/DELETE /families/:familyId/people[/:personId].
// A person can belong to several families on the same account (born in one,
// married into another). They are one record, so an edit made by an admin of
// either family shows in both trees (spec §3.3).

/** A relative, with the family it should be opened in (always one the user can access). */
export interface RelativeRef {
  person: Person;
  familyId: string;
}

export interface ParentLink extends RelativeRef {
  edgeId: string;
  type: ParentChildType;
}

export interface SpouseLink extends RelativeRef {
  marriage: Marriage;
}

export interface PersonBusinessLink {
  business: Business;
  role: BusinessRole | null;
}

export interface PersonFamilyLink {
  family: Family;
  membership: Membership;
  role: EffectiveRole;
}

export interface PersonDetail {
  person: Person;
  /** How the person belongs to the family the profile was opened in. */
  membership: Membership;
  role: EffectiveRole;
  parents: ParentLink[];
  children: ParentLink[];
  spouses: SpouseLink[];
  /** Derived from shared parents; never stored. */
  siblings: RelativeRef[];
  businesses: PersonBusinessLink[];
  /** Families on this account the person belongs to, limited to those the user can access. */
  families: PersonFamilyLink[];
  /** Father and paternal grandfather (biological), for the nasab line when not typed in. */
  nasab: { father: Person | null; grandfather: Person | null };
}

/** Accessible families keyed by id, with the set of people in each. */
function accessibleIndex() {
  const user = currentUser();
  return accessibleFamilies(user).map(({ family, role }) => ({ family, role, ids: familyPersonIds(family.id) }));
}

export function getPerson(familyId: string, personId: string): Promise<PersonDetail> {
  return handle(() => {
    const { role } = requireFamily(familyId);
    const person = requirePersonInFamily(familyId, personId);
    const db = getDb();
    const index = accessibleIndex();
    const current = index.find((f) => f.family.id === familyId);

    // Resolve a relative to a family the user may open them in, preferring the current family.
    const ref = (id: string): RelativeRef | null => {
      const fam = current?.ids.has(id) ? current : index.find((f) => f.ids.has(id));
      const p = fam && db.people.find((x) => x.id === id && !x.deletedAt);
      if (!fam || !p) return null;
      return { person: redactPerson(p, fam.role), familyId: fam.family.id };
    };

    const parents: ParentLink[] = [];
    const children: ParentLink[] = [];
    for (const e of db.parentChild) {
      if (e.childId === personId) {
        const r = ref(e.parentId);
        if (r) parents.push({ ...r, edgeId: e.id, type: e.type });
      } else if (e.parentId === personId) {
        const r = ref(e.childId);
        if (r) children.push({ ...r, edgeId: e.id, type: e.type });
      }
    }

    const spouses: SpouseLink[] = [];
    for (const m of db.marriages) {
      if (m.personAId !== personId && m.personBId !== personId) continue;
      const r = ref(m.personAId === personId ? m.personBId : m.personAId);
      if (r) spouses.push({ ...r, marriage: m });
    }

    // Siblings share a live parent; a deleted parent no longer links anyone.
    const deleted = new Set(db.people.filter((p) => p.deletedAt).map((p) => p.id));
    const parentIds = new Set(
      db.parentChild.filter((e) => e.childId === personId && !deleted.has(e.parentId)).map((e) => e.parentId),
    );
    const siblingIds = new Set(
      db.parentChild.filter((e) => parentIds.has(e.parentId) && e.childId !== personId).map((e) => e.childId),
    );
    const siblings = [...siblingIds].map(ref).filter((r): r is RelativeRef => r !== null);

    const byBirth = (a: RelativeRef, b: RelativeRef) =>
      (a.person.birth?.value ?? '9999').localeCompare(b.person.birth?.value ?? '9999');
    children.sort(byBirth);
    siblings.sort(byBirth);

    const businesses: PersonBusinessLink[] = [];
    for (const pb of db.personBusiness) {
      if (pb.personId !== personId) continue;
      const b = db.businesses.find((x) => x.id === pb.businessId && !x.deletedAt);
      const fam = b && index.find((f) => f.family.id === b.familyId);
      if (b && fam) businesses.push({ business: redactBusiness(b, fam.role), role: pb.role });
    }

    const families: PersonFamilyLink[] = [];
    for (const fp of db.familyPeople) {
      if (fp.personId !== personId) continue;
      const fam = index.find((f) => f.family.id === fp.familyId);
      if (fam) families.push({ family: fam.family, membership: fp.membership, role: fam.role });
    }

    const fatherOf = (id: string) => {
      const ids = db.parentChild.filter((e) => e.childId === id && e.type === 'BIOLOGICAL').map((e) => e.parentId);
      const f = ids.map(ref).find((r) => r?.person.gender === 'MALE');
      return f?.person ?? null;
    };
    const father = fatherOf(personId);
    const nasab = { father, grandfather: father ? fatherOf(father.id) : null };

    const membership =
      db.familyPeople.find((fp) => fp.familyId === familyId && fp.personId === personId)?.membership ?? 'BORN';

    return {
      person: redactPerson(person, role),
      membership,
      role,
      parents,
      children,
      spouses,
      siblings,
      businesses,
      families,
      nasab,
    };
  });
}

/** Normalises and validates a person payload. A date of death means the person is not living. */
export function parsePersonInput(input: PersonInput): PersonInput {
  const prepared = { ...input, isLiving: input.death ? false : input.isLiving };
  const parsed = personInput.safeParse(prepared);
  if (!parsed.success) throw new ApiError('VALIDATION', parsed.error.issues[0]?.message);
  return parsed.data;
}

/** Inserts a person and their family membership. Caller has already checked EDIT access. */
export function insertPerson(familyId: string, input: PersonInput, membership: Membership): Person {
  const db = getDb();
  const user = currentUser();
  const person: Person = { ...parsePersonInput(input), id: newId('p'), clientId: user.clientId, deletedAt: null };
  db.people.push(person);
  db.familyPeople.push({ familyId, personId: person.id, membership });
  return person;
}

export function createPerson(familyId: string, input: PersonInput, membership: Membership = 'BORN'): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const person = insertPerson(familyId, input, membership);
    commit();
    return person;
  });
}

/** PATCH: merges the given fields into the stored person. Admins of any family the person is in may edit. */
export function updatePerson(familyId: string, personId: string, input: Partial<PersonInput>): Promise<Person> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const person = requirePersonInFamily(familyId, personId);
    // The schema strips id / clientId / deletedAt, so they cannot be changed here.
    const next = parsePersonInput({ ...person, ...input });
    Object.assign(person, next);
    commit();
    return person;
  });
}

/**
 * DELETE /families/:familyId/people/:personId. When the person also belongs to
 * another family on the account, they are only removed from this family: its
 * membership row goes, and so do the edges and business links that existed only
 * through this family. Otherwise it is a soft delete (deleted_at) and every tree
 * stops showing them. The response is the same either way, so it never reveals
 * families the caller cannot access.
 */
export function softDeletePerson(familyId: string, personId: string): Promise<void> {
  return handle(() => {
    const { user } = requireFamily(familyId, 'EDIT');
    const person = requirePersonInFamily(familyId, personId);
    const db = getDb();
    const sameClient = new Set(db.families.filter((f) => f.clientId === user.clientId).map((f) => f.id));
    const remaining = new Set(
      db.familyPeople
        .filter((fp) => fp.personId === personId && fp.familyId !== familyId && sameClient.has(fp.familyId))
        .map((fp) => fp.familyId),
    );
    if (remaining.size === 0) {
      person.deletedAt = new Date().toISOString();
      commit();
      return;
    }
    db.familyPeople = db.familyPeople.filter((fp) => !(fp.familyId === familyId && fp.personId === personId));
    // An edge survives if the other person shares one of the families the person is still in.
    const sharesFamily = (otherId: string) =>
      db.familyPeople.some((fp) => fp.personId === otherId && remaining.has(fp.familyId));
    db.parentChild = db.parentChild.filter((e) => {
      if (e.parentId === personId) return sharesFamily(e.childId);
      if (e.childId === personId) return sharesFamily(e.parentId);
      return true;
    });
    db.marriages = db.marriages.filter((m) => {
      if (m.personAId === personId) return sharesFamily(m.personBId);
      if (m.personBId === personId) return sharesFamily(m.personAId);
      return true;
    });
    const familyBusinesses = new Set(db.businesses.filter((b) => b.familyId === familyId).map((b) => b.id));
    db.personBusiness = db.personBusiness.filter(
      (pb) => !(pb.personId === personId && familyBusinesses.has(pb.businessId)),
    );
    commit();
  });
}
