import type { FamilyInput } from '@family-tree/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveFamily,
  createFamily,
  getFamily,
  listArchivedFamilies,
  restoreFamily,
  updateFamily,
} from '#/api/families.ts';
import { familyKeys } from './queries.ts';

// Family management (Super Admin) and the queries it needs beyond queries.ts.
// Keys sit under familyKeys.all so every family write refreshes them too.

export const archivedFamiliesQuery = queryOptions({
  queryKey: [...familyKeys.all, 'archived'] as const,
  queryFn: listArchivedFamilies,
});

export function useArchivedFamilies(enabled = true) {
  return useQuery({ ...archivedFamiliesQuery, enabled });
}

export const familyQuery = (familyId: string) =>
  queryOptions({ queryKey: [...familyKeys.all, 'one', familyId] as const, queryFn: () => getFamily(familyId) });

export function useFamily(familyId: string) {
  return useQuery(familyQuery(familyId));
}

/** After a family write: lists, the session's family list and that family's graph change. */
function useInvalidateFamilies() {
  const qc = useQueryClient();
  return (familyId?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: familyKeys.all }),
      qc.invalidateQueries({ queryKey: ['session'] }),
      ...(familyId ? [qc.invalidateQueries({ queryKey: familyKeys.graph(familyId) })] : []),
    ]);
}

export function useCreateFamily() {
  const invalidate = useInvalidateFamilies();
  return useMutation({ mutationFn: (input: FamilyInput) => createFamily(input), onSuccess: () => invalidate() });
}

export function useUpdateFamily() {
  const invalidate = useInvalidateFamilies();
  return useMutation({
    mutationFn: ({ familyId, input }: { familyId: string; input: FamilyInput }) => updateFamily(familyId, input),
    onSuccess: (f) => invalidate(f.id),
  });
}

export function useArchiveFamily() {
  const invalidate = useInvalidateFamilies();
  return useMutation({ mutationFn: archiveFamily, onSuccess: (f) => invalidate(f.id) });
}

export function useRestoreFamily() {
  const invalidate = useInvalidateFamilies();
  return useMutation({ mutationFn: restoreFamily, onSuccess: (f) => invalidate(f.id) });
}
