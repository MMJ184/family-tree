import type { EffectiveRole, SessionInfo } from '@family-tree/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSession, listDemoUsers, login, logout } from '#/api/auth.ts';

export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: getSession });

export function useSession() {
  return useQuery(sessionQuery);
}

export function useDemoUsers() {
  return useQuery({ queryKey: ['demo-users'], queryFn: listDemoUsers });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (session) => {
      qc.clear();
      qc.setQueryData(sessionQuery.queryKey, session);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(sessionQuery.queryKey, null);
    },
  });
}

export function roleForFamily(session: SessionInfo | null | undefined, familyId: string): EffectiveRole | null {
  return session?.families.find((f) => f.familyId === familyId)?.role ?? null;
}

export function canEdit(role: EffectiveRole | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}
