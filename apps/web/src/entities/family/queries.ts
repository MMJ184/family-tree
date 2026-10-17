import { queryOptions, useQuery } from '@tanstack/react-query';
import { listFamilies } from '#/api/families.ts';
import { getFamilyGraph } from '#/api/graph.ts';

/** Query key roots. Mutations anywhere in the app invalidate these. */
export const familyKeys = {
  all: ['families'] as const,
  graph: (familyId: string) => ['graph', familyId] as const,
};

export const familiesQuery = queryOptions({ queryKey: familyKeys.all, queryFn: listFamilies });

export function useFamilies() {
  return useQuery(familiesQuery);
}

export const familyGraphQuery = (familyId: string) =>
  queryOptions({ queryKey: familyKeys.graph(familyId), queryFn: () => getFamilyGraph(familyId) });

export function useFamilyGraph(familyId: string) {
  return useQuery(familyGraphQuery(familyId));
}
