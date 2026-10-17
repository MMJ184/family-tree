import type { BusinessInput } from '@family-tree/shared';
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BusinessFilters,
  type BusinessLinkInput,
  createBusiness,
  getBusiness,
  linkPerson,
  listBusinesses,
  softDeleteBusiness,
  unlinkPerson,
  updateBusiness,
} from '#/api/businesses.ts';
import { familyKeys } from '#/entities/family/queries.ts';
import { personKeys } from '#/entities/person/queries.ts';

export type { BusinessFilters, BusinessLinkInput, BusinessWithPeople, LinkedPerson } from '#/api/businesses.ts';

export const businessKeys = {
  all: ['businesses'] as const,
  family: (familyId: string) => ['businesses', familyId] as const,
  list: (familyId: string, filters: BusinessFilters) => ['businesses', familyId, 'list', filters] as const,
  detail: (familyId: string, businessId: string) => ['businesses', familyId, 'detail', businessId] as const,
};

export const businessesQuery = (familyId: string, filters: BusinessFilters = {}) =>
  queryOptions({
    queryKey: businessKeys.list(familyId, filters),
    queryFn: () => listBusinesses(familyId, filters),
    placeholderData: keepPreviousData,
  });

export const businessQuery = (familyId: string, businessId: string) =>
  queryOptions({
    queryKey: businessKeys.detail(familyId, businessId),
    queryFn: () => getBusiness(familyId, businessId),
  });

export function useBusinesses(familyId: string, filters: BusinessFilters = {}) {
  return useQuery(businessesQuery(familyId, filters));
}

export function useBusiness(familyId: string, businessId: string) {
  return useQuery(businessQuery(familyId, businessId));
}

/**
 * After any business write. Person profiles list businesses and a person can sit
 * in several families, so every graph, every person and every business query is
 * refreshed (the same set people writes refresh).
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['graph'] }),
      qc.invalidateQueries({ queryKey: familyKeys.all }),
      qc.invalidateQueries({ queryKey: personKeys.all }),
      qc.invalidateQueries({ queryKey: businessKeys.all }),
    ]);
}

export interface SaveBusinessVars {
  /** Omit to create. */
  businessId?: string | undefined;
  input: BusinessInput;
  /** When given, the business's linked people are made to match this list. */
  links?: BusinessLinkInput[] | undefined;
  /** Current links, to compute what to add, change and remove. */
  currentLinks?: BusinessLinkInput[] | undefined;
}

/** Creates or updates a business, then syncs its linked family members. Resolves to the business id. */
export function useSaveBusiness(familyId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ businessId, input, links, currentLinks = [] }: SaveBusinessVars) => {
      const saved = businessId
        ? await updateBusiness(familyId, businessId, input)
        : await createBusiness(familyId, input);
      if (links) {
        const wanted = new Map(links.map((l) => [l.personId, l.role]));
        for (const cur of currentLinks) {
          if (!wanted.has(cur.personId)) await unlinkPerson(familyId, saved.id, cur.personId);
        }
        const had = new Map(currentLinks.map((l) => [l.personId, l.role]));
        for (const [personId, role] of wanted) {
          if (!had.has(personId) || had.get(personId) !== role) await linkPerson(familyId, saved.id, personId, role);
        }
      }
      return saved.id;
    },
    onSettled: invalidate,
  });
}

export function useDeleteBusiness(familyId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (businessId: string) => softDeleteBusiness(familyId, businessId),
    onSettled: invalidate,
  });
}

export function useLinkPerson(familyId: string, businessId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ personId, role }: BusinessLinkInput) => linkPerson(familyId, businessId, personId, role),
    onSettled: invalidate,
  });
}

export function useUnlinkPerson(familyId: string, businessId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (personId: string) => unlinkPerson(familyId, businessId, personId),
    onSettled: invalidate,
  });
}
