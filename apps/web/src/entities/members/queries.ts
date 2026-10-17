import type { FamilyRole } from '@family-tree/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changeRole, type InviteInput, inviteMember, listFamilyAccess, removeMember } from '#/api/members.ts';
import { familyKeys } from '#/entities/family/queries.ts';

export const memberKeys = {
  list: (familyId: string) => ['members', familyId] as const,
};

export const familyAccessQuery = (familyId: string) =>
  queryOptions({ queryKey: memberKeys.list(familyId), queryFn: () => listFamilyAccess(familyId) });

export function useFamilyAccess(familyId: string) {
  return useQuery(familyAccessQuery(familyId));
}

/** Access changes alter the access list, family cards (admin avatars) and sessions' family lists. */
function useInvalidateAccess(familyId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: memberKeys.list(familyId) }),
      qc.invalidateQueries({ queryKey: familyKeys.all }),
      qc.invalidateQueries({ queryKey: ['session'] }),
    ]);
}

export function useInviteMember(familyId: string) {
  const invalidate = useInvalidateAccess(familyId);
  return useMutation({ mutationFn: (input: InviteInput) => inviteMember(familyId, input), onSuccess: invalidate });
}

export function useChangeRole(familyId: string) {
  const invalidate = useInvalidateAccess(familyId);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: FamilyRole }) => changeRole(familyId, userId, role),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(familyId: string) {
  const invalidate = useInvalidateAccess(familyId);
  return useMutation({ mutationFn: (userId: string) => removeMember(familyId, userId), onSuccess: invalidate });
}
