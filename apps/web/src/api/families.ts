import { type EffectiveRole, type Family, type FamilyInput, familyInput } from '@family-tree/shared';
import { commit, getDb, newId, nowIso } from '#/mock/db.ts';
import {
  accessibleFamilies,
  currentUser,
  familyPersonIds,
  isAdminRole,
  requireFamily,
  requireSuperAdmin,
} from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';

export interface FamilyAdminRef {
  id: string;
  name: string;
}

export interface FamilySummary {
  family: Family;
  role: EffectiveRole;
  peopleCount: number;
  businessCount: number;
  /** The family's admins. Empty for Viewers, who do not see the access list. */
  admins: FamilyAdminRef[];
}

function summarize(family: Family, role: EffectiveRole): FamilySummary {
  const db = getDb();
  const admins = isAdminRole(role)
    ? db.familyMembers
        .filter((m) => m.familyId === family.id && m.role === 'ADMIN')
        .flatMap((m) => {
          const u = db.users.find((x) => x.id === m.userId);
          return u ? [{ id: u.id, name: u.name }] : [];
        })
    : [];
  return {
    family,
    role,
    peopleCount: familyPersonIds(family.id).size,
    businessCount: db.businesses.filter((b) => b.familyId === family.id && !b.deletedAt).length,
    admins,
  };
}

/**
 * GET /families — active families the signed-in user can see. A Family Admin
 * gets only their own; archived families are listed separately (Super Admin only).
 */
export function listFamilies(): Promise<FamilySummary[]> {
  return handle(() =>
    accessibleFamilies(currentUser())
      .filter(({ family }) => !family.archivedAt)
      .map(({ family, role }) => summarize(family, role)),
  );
}

/** GET /families?archived=true — Super Admin only. */
export function listArchivedFamilies(): Promise<FamilySummary[]> {
  return handle(() => {
    const user = requireSuperAdmin();
    return accessibleFamilies(user)
      .filter(({ family }) => family.archivedAt)
      .map(({ family, role }) => summarize(family, role));
  });
}

/** GET /families/:id — NOT_FOUND when the user has no access. */
export function getFamily(familyId: string): Promise<FamilySummary> {
  return handle(() => {
    const { family, role } = requireFamily(familyId);
    return summarize(family, role);
  });
}

function parseInput(input: FamilyInput): FamilyInput {
  const blank = (s: string | null) => (s?.trim() ? s.trim() : null);
  const result = familyInput.safeParse({
    ...input,
    name: input.name.trim(),
    nameAr: blank(input.nameAr),
    surname: blank(input.surname),
    nativePlace: blank(input.nativePlace),
    description: blank(input.description),
    coverUrl: blank(input.coverUrl),
  });
  if (!result.success) throw new ApiError('VALIDATION', result.error.message);
  return result.data;
}

/** POST /families — Super Admin only. */
export function createFamily(input: FamilyInput): Promise<Family> {
  return handle(() => {
    const user = requireSuperAdmin();
    const data = parseInput(input);
    const family: Family = { id: newId('fam'), clientId: user.clientId, ...data, archivedAt: null };
    const db = getDb();
    db.families = [...db.families, family];
    commit();
    return family;
  });
}

/** PATCH /families/:id — Super Admin, or an admin of that family. */
export function updateFamily(familyId: string, input: FamilyInput): Promise<Family> {
  return handle(() => {
    const { family } = requireFamily(familyId, 'EDIT');
    return replaceFamily({ ...family, ...parseInput(input) });
  });
}

/** Writes replace rows rather than mutate them, so the seed objects behind "Reset demo" stay pristine. */
function replaceFamily(next: Family): Family {
  const db = getDb();
  db.families = db.families.map((f) => (f.id === next.id ? next : f));
  commit();
  return next;
}

function superAdminFamily(familyId: string): Family {
  const user = requireSuperAdmin();
  const family = getDb().families.find((f) => f.id === familyId && f.clientId === user.clientId);
  if (!family) throw new ApiError('NOT_FOUND');
  return family;
}

/** POST /families/:id/archive — Super Admin only; soft delete. */
export function archiveFamily(familyId: string): Promise<Family> {
  return handle(() => {
    const family = superAdminFamily(familyId);
    return replaceFamily({ ...family, archivedAt: family.archivedAt ?? nowIso() });
  });
}

/** POST /families/:id/restore — Super Admin only. */
export function restoreFamily(familyId: string): Promise<Family> {
  return handle(() => {
    const family = superAdminFamily(familyId);
    return replaceFamily({ ...family, archivedAt: null });
  });
}
