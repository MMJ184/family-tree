import type { Membership, PersonInput } from '@family-tree/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPerson, getPerson, softDeletePerson, updatePerson } from '#/api/people.ts';
import {
  type AddChildInput,
  type AddParentInput,
  type AddSiblingInput,
  type AddSpouseInput,
  addChild,
  addParent,
  addSibling,
  addSpouse,
  listLinkCandidates,
  type MarriageInput,
  type RelationKind,
  removeMarriage,
  removeParentChild,
  updateMarriage,
} from '#/api/relationships.ts';
import { businessKeys } from '#/entities/business/queries.ts';
import { familyKeys } from '#/entities/family/queries.ts';

export type {
  ParentLink,
  PersonBusinessLink,
  PersonDetail,
  PersonFamilyLink,
  RelativeRef,
  SpouseLink,
} from '#/api/people.ts';
export type {
  LinkCandidate,
  MarriageInput,
  RelationKind,
  RelativeSource,
} from '#/api/relationships.ts';

export const personKeys = {
  all: ['person'] as const,
  detail: (familyId: string, personId: string) => ['person', familyId, personId] as const,
  candidates: (familyId: string, kind: RelationKind) => ['person-candidates', familyId, kind] as const,
};

export const personQuery = (familyId: string, personId: string) =>
  queryOptions({ queryKey: personKeys.detail(familyId, personId), queryFn: () => getPerson(familyId, personId) });

export function usePerson(familyId: string, personId: string) {
  return useQuery(personQuery(familyId, personId));
}

export function useLinkCandidates(familyId: string, kind: RelationKind, enabled = true) {
  return useQuery({
    queryKey: personKeys.candidates(familyId, kind),
    queryFn: () => listLinkCandidates(familyId, kind),
    enabled,
  });
}

/**
 * After any people write. A person can sit in two families, so every family
 * graph is refreshed (the `['graph']` prefix), not only the current one, along
 * with every person and business query.
 */
function useInvalidatePeople() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['graph'] }),
      qc.invalidateQueries({ queryKey: familyKeys.all }),
      qc.invalidateQueries({ queryKey: personKeys.all }),
      qc.invalidateQueries({ queryKey: ['person-candidates'] }),
      // Business pages list linked people (names, and links removed with a person).
      qc.invalidateQueries({ queryKey: businessKeys.all }),
    ]);
}

export function useCreatePerson(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ input, membership }: { input: PersonInput; membership?: Membership }) =>
      createPerson(familyId, input, membership),
    onSuccess: invalidate,
  });
}

export function useUpdatePerson(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ personId, input }: { personId: string; input: Partial<PersonInput> }) =>
      updatePerson(familyId, personId, input),
    onSuccess: invalidate,
  });
}

export function useDeletePerson(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (personId: string) => softDeletePerson(familyId, personId),
    onSuccess: invalidate,
  });
}

export type AddRelativeRequest =
  | { relation: 'parent'; personId: string; input: AddParentInput }
  | { relation: 'child'; personId: string; input: AddChildInput }
  | { relation: 'spouse'; personId: string; input: AddSpouseInput }
  | { relation: 'sibling'; personId: string; input: AddSiblingInput };

export function useAddRelative(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (req: AddRelativeRequest) => {
      switch (req.relation) {
        case 'parent':
          return addParent(familyId, req.personId, req.input);
        case 'child':
          return addChild(familyId, req.personId, req.input);
        case 'spouse':
          return addSpouse(familyId, req.personId, req.input);
        case 'sibling':
          return addSibling(familyId, req.personId, req.input);
      }
    },
    onSuccess: invalidate,
  });
}

export function useRemoveParentChild(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (edgeId: string) => removeParentChild(familyId, edgeId), onSuccess: invalidate });
}

export function useUpdateMarriage(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ marriageId, input }: { marriageId: string; input: MarriageInput }) =>
      updateMarriage(familyId, marriageId, input),
    onSuccess: invalidate,
  });
}

export function useRemoveMarriage(familyId: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (marriageId: string) => removeMarriage(familyId, marriageId),
    onSuccess: invalidate,
  });
}
