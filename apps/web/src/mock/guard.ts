import type { Business, EffectiveRole, Family, Person, User } from '@family-tree/shared';
import { ApiError } from '#/api/core.ts';
import { getDb } from './db.ts';

// Access rules the real API will enforce (CLAUDE.md "Cross-cutting rules").
// Families a user cannot access are reported as NOT_FOUND, never FORBIDDEN,
// so a Family Admin cannot learn that other families exist.

export function currentUser(): User {
  const db = getDb();
  const user = db.users.find((u) => u.id === db.sessionUserId);
  if (!user) throw new ApiError('UNAUTHENTICATED');
  return user;
}

/** The user's role in a family, or null when they have no access to it. */
export function roleIn(user: User, family: Family): EffectiveRole | null {
  if (family.clientId !== user.clientId) return null;
  if (user.isSuperAdmin) return 'SUPER_ADMIN';
  const m = getDb().familyMembers.find((fm) => fm.userId === user.id && fm.familyId === family.id);
  return m?.role ?? null;
}

export function isAdminRole(role: EffectiveRole | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** Families the signed-in user may see. Archived families are visible only to Super Admin. */
export function accessibleFamilies(user: User): Array<{ family: Family; role: EffectiveRole }> {
  const out: Array<{ family: Family; role: EffectiveRole }> = [];
  for (const family of getDb().families) {
    const role = roleIn(user, family);
    if (!role) continue;
    if (family.archivedAt && role !== 'SUPER_ADMIN') continue;
    out.push({ family, role });
  }
  return out;
}

/** Loads a family the user may access, or throws NOT_FOUND. */
export function requireFamily(
  familyId: string,
  need: 'VIEW' | 'EDIT' = 'VIEW',
): { user: User; family: Family; role: EffectiveRole } {
  const user = currentUser();
  const family = getDb().families.find((f) => f.id === familyId);
  const role = family ? roleIn(user, family) : null;
  if (!family || !role || (family.archivedAt && role !== 'SUPER_ADMIN')) throw new ApiError('NOT_FOUND');
  if (need === 'EDIT' && !isAdminRole(role)) throw new ApiError('FORBIDDEN');
  return { user, family, role };
}

export function requireSuperAdmin(): User {
  const user = currentUser();
  if (!user.isSuperAdmin) throw new ApiError('FORBIDDEN');
  return user;
}

/** Person ids that belong to a family (born or married in), excluding soft-deleted people. */
export function familyPersonIds(familyId: string): Set<string> {
  const db = getDb();
  const live = new Set(db.people.filter((p) => !p.deletedAt).map((p) => p.id));
  return new Set(
    db.familyPeople.filter((fp) => fp.familyId === familyId && live.has(fp.personId)).map((fp) => fp.personId),
  );
}

/** Loads a person who belongs to the family, or throws NOT_FOUND. */
export function requirePersonInFamily(familyId: string, personId: string): Person {
  if (!familyPersonIds(familyId).has(personId)) throw new ApiError('NOT_FOUND');
  const person = getDb().people.find((p) => p.id === personId);
  if (!person) throw new ApiError('NOT_FOUND');
  return person;
}

/** Viewers do not see personal phone and email (spec §3.2). */
export function redactPerson(person: Person, role: EffectiveRole): Person {
  if (isAdminRole(role)) return person;
  return { ...person, phone: null, email: null };
}

/** GST / registration number is admin-only (spec §3.2.1). */
export function redactBusiness(business: Business, role: EffectiveRole): Business {
  if (isAdminRole(role)) return business;
  return { ...business, registrationNo: null };
}
