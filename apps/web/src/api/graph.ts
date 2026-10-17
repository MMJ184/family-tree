import type { FamilyGraph } from '@family-tree/shared';
import { getDb } from '#/mock/db.ts';
import { familyPersonIds, redactBusiness, redactPerson, requireFamily } from '#/mock/guard.ts';
import { handle } from './core.ts';

/**
 * Everything the tree views need for one family: its people (born and married
 * in), the relationship edges between them, and its businesses. Edges to people
 * outside the family are left out, so a married-in spouse's own parents only
 * appear in their birth family's tree.
 */
export function getFamilyGraph(familyId: string): Promise<FamilyGraph> {
  return handle(() => {
    const { family, role } = requireFamily(familyId);
    const db = getDb();
    const ids = familyPersonIds(familyId);
    const businesses = db.businesses.filter((b) => b.familyId === familyId && !b.deletedAt);
    const businessIds = new Set(businesses.map((b) => b.id));
    return {
      family,
      people: db.people.filter((p) => ids.has(p.id)).map((p) => redactPerson(p, role)),
      memberships: db.familyPeople.filter((fp) => fp.familyId === familyId && ids.has(fp.personId)),
      parentChild: db.parentChild.filter((e) => ids.has(e.parentId) && ids.has(e.childId)),
      marriages: db.marriages.filter((m) => ids.has(m.personAId) && ids.has(m.personBId)),
      businesses: businesses.map((b) => redactBusiness(b, role)),
      personBusiness: db.personBusiness.filter((pb) => businessIds.has(pb.businessId) && ids.has(pb.personId)),
    };
  });
}
