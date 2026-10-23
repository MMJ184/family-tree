import type { FamilyGraph, Person } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { branchIds, buildModel } from './model.ts';

const person = (id: string): Person =>
  ({ id, firstName: id, gender: 'MALE', birth: null, isLiving: true }) as unknown as Person;

// grandpa + grandma -> dad (+ mum) -> kid1 (+ wife1) -> grandkid; dad's brother uncle -> cousin.
function graph(): FamilyGraph {
  const ids = ['grandpa', 'grandma', 'dad', 'mum', 'uncle', 'cousin', 'kid1', 'wife1', 'grandkid', 'kid2'];
  const pc = (parentId: string, childId: string) => ({
    id: `${parentId}>${childId}`,
    parentId,
    childId,
    type: 'BIOLOGICAL' as const,
  });
  const m = (a: string, b: string) => ({
    id: `${a}+${b}`,
    personAId: a,
    personBId: b,
    status: 'MARRIED' as const,
    startDate: null,
    endDate: null,
  });
  return {
    family: { id: 'f' } as FamilyGraph['family'],
    people: ids.map(person),
    memberships: [],
    parentChild: [
      pc('grandpa', 'dad'),
      pc('grandma', 'dad'),
      pc('grandpa', 'uncle'),
      pc('grandma', 'uncle'),
      pc('uncle', 'cousin'),
      pc('dad', 'kid1'),
      pc('mum', 'kid1'),
      pc('dad', 'kid2'),
      pc('mum', 'kid2'),
      pc('kid1', 'grandkid'),
      pc('wife1', 'grandkid'),
    ],
    marriages: [m('grandpa', 'grandma'), m('dad', 'mum'), m('kid1', 'wife1')],
    businesses: [],
    personBusiness: [],
  };
}

describe('branchIds', () => {
  it('covers parents, spouse and all descendants with their spouses, not siblings or cousins', () => {
    const people = [...branchIds(buildModel(graph()), 'dad')].filter((id) => !id.includes(':'));
    expect(people.sort()).toEqual(['dad', 'grandkid', 'grandma', 'grandpa', 'kid1', 'kid2', 'mum', 'wife1']);
  });

  it('includes the union nodes the edges run through', () => {
    const ids = branchIds(buildModel(graph()), 'kid1');
    expect(ids.has('u:dad+mum')).toBe(true);
    expect(ids.has('u:kid1+wife1')).toBe(true);
    expect(ids.has('uncle')).toBe(false);
  });
});
