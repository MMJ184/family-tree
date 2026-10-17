import type { SessionInfo, User } from '@family-tree/shared';
import { commit, getDb } from '#/mock/db.ts';
import { accessibleFamilies, currentUser } from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';

// Demo sign-in: the presenter picks a sample user instead of entering a password.
// The real API will use email + password and a server-side session (spec decision #8).

export interface DemoUserOption {
  user: User;
  /** Short role summary for the picker, e.g. "SUPER_ADMIN" or "ADMIN:fam-kaabi". */
  roles: Array<{ familyId: string | null; familyName: string | null; role: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER' }>;
}

export function listDemoUsers(): Promise<DemoUserOption[]> {
  return handle(() => {
    const db = getDb();
    return db.users.map((user) => ({
      user,
      roles: user.isSuperAdmin
        ? [{ familyId: null, familyName: null, role: 'SUPER_ADMIN' as const }]
        : db.familyMembers
            .filter((m) => m.userId === user.id)
            .map((m) => ({
              familyId: m.familyId,
              familyName: db.families.find((f) => f.id === m.familyId)?.name ?? null,
              role: m.role,
            })),
    }));
  });
}

export function login(userId: string): Promise<SessionInfo> {
  return handle(() => {
    const db = getDb();
    if (!db.users.some((u) => u.id === userId)) throw new ApiError('NOT_FOUND');
    db.sessionUserId = userId;
    commit();
    return sessionInfo();
  });
}

export function logout(): Promise<void> {
  return handle(() => {
    getDb().sessionUserId = null;
    commit();
  });
}

/** The current session, or null when nobody is signed in. */
export function getSession(): Promise<SessionInfo | null> {
  return handle(() => {
    const db = getDb();
    if (!db.sessionUserId) return null;
    // The user may be gone (e.g. an invited user after "reset demo"): sign out.
    if (!db.users.some((u) => u.id === db.sessionUserId)) {
      db.sessionUserId = null;
      commit();
      return null;
    }
    return sessionInfo();
  });
}

function sessionInfo(): SessionInfo {
  const user = currentUser();
  const client = getDb().clients.find((c) => c.id === user.clientId);
  if (!client) throw new ApiError('NOT_FOUND');
  return {
    user,
    client,
    families: accessibleFamilies(user).map(({ family, role }) => ({ familyId: family.id, role })),
  };
}
