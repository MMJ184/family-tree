import { type EffectiveRole, type FamilyRole, familyRole, type User } from '@family-tree/shared';
import { z } from 'zod';
import { commit, getDb, newId } from '#/mock/db.ts';
import { requireFamily } from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';

// Who can open a family (spec §2). Super Admin assigns and removes Family Admins;
// a Family Admin can only invite and remove Viewers. Viewers cannot see this list.

export interface FamilyAccessEntry {
  userId: string;
  name: string;
  email: string;
  role: EffectiveRole;
  isYou: boolean;
}

export const inviteInput = z.object({
  name: z.string().trim().min(1),
  email: z.email().trim().toLowerCase(),
  role: familyRole,
});
export type InviteInput = z.infer<typeof inviteInput>;

function requireAccessManager(familyId: string) {
  const ctx = requireFamily(familyId, 'EDIT');
  return { ...ctx, isSuper: ctx.role === 'SUPER_ADMIN' };
}

function entries(familyId: string, me: User): FamilyAccessEntry[] {
  const db = getDb();
  const supers = db.users
    .filter((u) => u.clientId === me.clientId && u.isSuperAdmin)
    .map((u) => ({ userId: u.id, name: u.name, email: u.email, role: 'SUPER_ADMIN' as const, isYou: u.id === me.id }));
  const members = db.familyMembers
    .filter((m) => m.familyId === familyId)
    .flatMap((m) => {
      const u = db.users.find((x) => x.id === m.userId && x.clientId === me.clientId);
      return u ? [{ userId: u.id, name: u.name, email: u.email, role: m.role, isYou: u.id === me.id }] : [];
    })
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'ADMIN' ? -1 : 1));
  return [...supers, ...members];
}

/** GET /families/:id/access — admins of the family and Super Admin. */
export function listFamilyAccess(familyId: string): Promise<FamilyAccessEntry[]> {
  return handle(() => {
    const { user } = requireAccessManager(familyId);
    return entries(familyId, user);
  });
}

/**
 * POST /families/:id/access — invite by email. A new email creates a user on the
 * same client account. Only Super Admin may grant ADMIN.
 */
export function inviteMember(familyId: string, input: InviteInput): Promise<FamilyAccessEntry> {
  return handle(() => {
    const { user: me, isSuper } = requireAccessManager(familyId);
    const parsed = inviteInput.safeParse(input);
    if (!parsed.success) throw new ApiError('VALIDATION', parsed.error.message);
    const { name, email, role } = parsed.data;
    if (role === 'ADMIN' && !isSuper) throw new ApiError('FORBIDDEN');

    const db = getDb();
    let target = db.users.find((u) => u.email.toLowerCase() === email);
    // A user of another client account must not be distinguishable from a bad email.
    if (target && target.clientId !== me.clientId) throw new ApiError('VALIDATION', 'emailUnavailable');
    // Super Admins and existing members get the same generic answer.
    if (target?.isSuperAdmin || db.familyMembers.some((m) => m.familyId === familyId && m.userId === target?.id)) {
      throw new ApiError('CONFLICT', 'alreadyHasAccess');
    }
    if (!target) {
      target = { id: newId('u'), clientId: me.clientId, name, email, isSuperAdmin: false, locale: 'ar' };
      db.users = [...db.users, target];
    }
    db.familyMembers = [...db.familyMembers, { userId: target.id, familyId, role }];
    commit();
    // Only Super Admin sees the stored name of an existing user; others get back what they typed.
    return { userId: target.id, name: isSuper ? target.name : name, email, role, isYou: false };
  });
}

function requireMembership(familyId: string, userId: string) {
  const db = getDb();
  const m = db.familyMembers.find((x) => x.familyId === familyId && x.userId === userId);
  if (!m) throw new ApiError('NOT_FOUND');
  return m;
}

/** PATCH /families/:id/access/:userId — any change involving ADMIN is Super Admin only. */
export function changeRole(familyId: string, userId: string, role: FamilyRole): Promise<void> {
  return handle(() => {
    const { isSuper } = requireAccessManager(familyId);
    const parsedRole = familyRole.safeParse(role);
    if (!parsedRole.success) throw new ApiError('VALIDATION');
    const next = parsedRole.data;
    const m = requireMembership(familyId, userId);
    if (!isSuper && (next === 'ADMIN' || m.role === 'ADMIN')) throw new ApiError('FORBIDDEN');
    // Replace, not mutate, so the seed rows behind "Reset demo" stay pristine.
    const db = getDb();
    db.familyMembers = db.familyMembers.map((x) => (x === m ? { ...m, role: next } : x));
    commit();
  });
}

/** DELETE /families/:id/access/:userId — admins may remove Viewers; only Super Admin removes admins. */
export function removeMember(familyId: string, userId: string): Promise<void> {
  return handle(() => {
    const { isSuper } = requireAccessManager(familyId);
    const db = getDb();
    if (db.users.find((u) => u.id === userId)?.isSuperAdmin) throw new ApiError('FORBIDDEN');
    const m = requireMembership(familyId, userId);
    if (m.role === 'ADMIN' && !isSuper) throw new ApiError('FORBIDDEN');
    db.familyMembers = db.familyMembers.filter((x) => x !== m);
    commit();
  });
}
