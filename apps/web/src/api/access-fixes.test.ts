import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteBusiness } from '#/entities/business/queries.ts';
import { familyKeys } from '#/entities/family/queries.ts';
import { useDeletePerson } from '#/entities/person/queries.ts';
import { csvCell, fileSlug } from '#/features/people/csv.ts';
import { getDb, resetDemo } from '#/mock/db.ts';
import { login } from './auth.ts';
import { ApiError } from './core.ts';
import { archiveFamily } from './families.ts';
import { getFamilyGraph } from './graph.ts';
import { changeRole, inviteMember } from './members.ts';
import { getPerson, softDeletePerson } from './people.ts';
import {
  addParent,
  addSibling,
  addSpouse,
  listLinkCandidates,
  type RelativeSource,
  removeMarriage,
  removeParentChild,
  updateMarriage,
} from './relationships.ts';

// Regression tests for the access and data-integrity review fixes.

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
}

async function errorOf(p: Promise<unknown>): Promise<ApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
}

const newPerson = (nameEn: string): RelativeSource => ({
  kind: 'new',
  input: {
    firstName: nameEn,
    middleName: null,
    lastName: null,
    maidenName: null,
    nameAr: 'اختبار',
    nameEn,
    fatherName: null,
    grandfatherName: null,
    tribeName: null,
    kunya: null,
    laqab: null,
    gender: 'MALE',
    birth: null,
    death: null,
    isLiving: true,
    birthPlace: null,
    currentCity: null,
    photoUrl: null,
    phone: null,
    email: null,
    occupation: null,
    education: null,
    notes: null,
    marriedIntoNote: null,
    customFields: {},
  },
});

const marriageInput = { status: 'MARRIED' as const, startDate: null, endDate: null };

function k1f1MarriageId(): string {
  const m = getDb().marriages.find(
    (x) => (x.personAId === 'k1' && x.personBId === 'f1') || (x.personAId === 'f1' && x.personBId === 'k1'),
  );
  if (!m) throw new Error('seed marriage k1–f1 missing');
  return m.id;
}

describe('1. addSibling uses only live parents in the current family', () => {
  beforeEach(() => resetDemo());

  it('rejects a sibling for a married-in person whose parents are in another family', async () => {
    await login('u-admin-two');
    const before = getDb().people.length;
    const err = await errorOf(addSibling('fam-mansouri', 'f1', { sibling: newPerson('Nobody') }));
    expect(err?.code).toBe('VALIDATION');
    expect(err?.message).toBe('noParents');
    expect(getDb().people.length).toBe(before);
    expect(getDb().parentChild.some((e) => e.parentId === 'ob' && e.childId !== 'f1' && e.childId !== 'ju')).toBe(
      false,
    );
  });

  it('adds the sibling in the family the parents belong to', async () => {
    await login('u-admin-two');
    const sib = await addSibling('fam-kaabi', 'f1', { sibling: newPerson('Sib') });
    const kaabi = await getFamilyGraph('fam-kaabi');
    const mansouri = await getFamilyGraph('fam-mansouri');
    expect(kaabi.people.some((p) => p.id === sib.id)).toBe(true);
    expect(mansouri.people.some((p) => p.id === sib.id)).toBe(false);
    const parents = getDb()
      .parentChild.filter((e) => e.childId === sib.id)
      .map((e) => e.parentId)
      .sort();
    expect(parents).toEqual(['ob', 'sl']);
  });

  it('ignores soft-deleted parents', async () => {
    await login('u-super');
    await softDeletePerson('fam-kaabi', 'ob');
    await softDeletePerson('fam-kaabi', 'sl');
    const err = await errorOf(addSibling('fam-kaabi', 'f1', { sibling: newPerson('Late') }));
    expect(err?.code).toBe('VALIDATION');
    expect(err?.message).toBe('noParents');
  });
});

describe('2. edges must have both ends in the family', () => {
  beforeEach(() => resetDemo());

  it('hides a parent–child edge whose parent is outside the family', async () => {
    await login('u-admin-two');
    expect(await codeOf(removeParentChild('fam-mansouri', 'pc-ob-f1'))).toBe('NOT_FOUND');
    expect(getDb().parentChild.some((e) => e.id === 'pc-ob-f1')).toBe(true);
    await removeParentChild('fam-kaabi', 'pc-ob-f1');
    expect(getDb().parentChild.some((e) => e.id === 'pc-ob-f1')).toBe(false);
  });

  it('hides a marriage whose spouse is outside the family', async () => {
    await login('u-admin-two');
    const id = k1f1MarriageId();
    expect(await codeOf(updateMarriage('fam-kaabi', id, { ...marriageInput, status: 'DIVORCED' }))).toBe('NOT_FOUND');
    expect(await codeOf(removeMarriage('fam-kaabi', id))).toBe('NOT_FOUND');
    expect(getDb().marriages.find((m) => m.id === id)?.status).toBe('MARRIED');
    await updateMarriage('fam-mansouri', id, { ...marriageInput, status: 'WIDOWED' });
    expect(getDb().marriages.find((m) => m.id === id)?.status).toBe('WIDOWED');
  });

  it('still removes a married-in spouse from the family when the marriage is removed there', async () => {
    await login('u-super');
    // Fatima's children keep her in Al Mansouri, so drop those links first.
    for (const kid of ['a1', 'm1', 's1']) await removeParentChild('fam-mansouri', `pc-f1-${kid}`);
    await removeMarriage('fam-mansouri', k1f1MarriageId());
    expect((await getFamilyGraph('fam-mansouri')).people.some((p) => p.id === 'f1')).toBe(false);
    expect((await getFamilyGraph('fam-kaabi')).people.some((p) => p.id === 'f1')).toBe(true);
  });
});

describe('3. deleting a person who is in several families', () => {
  beforeEach(() => resetDemo());

  it('only removes a married-in person from this family, with the links that existed only here', async () => {
    await login('u-admin-mansouri');
    await softDeletePerson('fam-mansouri', 'f1');
    expect(await codeOf(getPerson('fam-mansouri', 'f1'))).toBe('NOT_FOUND');
    const db = getDb();
    expect(db.people.find((p) => p.id === 'f1')?.deletedAt).toBeNull();
    expect(db.familyPeople.some((fp) => fp.personId === 'f1' && fp.familyId === 'fam-mansouri')).toBe(false);
    expect(db.parentChild.some((e) => e.id === 'pc-f1-a1')).toBe(false);
    expect(db.marriages.some((m) => m.personAId === 'f1' || m.personBId === 'f1')).toBe(false);
    expect(db.parentChild.some((e) => e.id === 'pc-ob-f1')).toBe(true);

    await login('u-admin-kaabi');
    const detail = await getPerson('fam-kaabi', 'f1');
    expect(detail.parents.map((p) => p.person.id).sort()).toEqual(['ob', 'sl']);
    expect((await getFamilyGraph('fam-kaabi')).people.some((p) => p.id === 'f1')).toBe(true);
  });

  it('soft-deletes a person whose last family this is', async () => {
    await login('u-admin-mansouri');
    await softDeletePerson('fam-mansouri', 'a1');
    expect(getDb().people.find((p) => p.id === 'a1')?.deletedAt).not.toBeNull();
    expect(getDb().familyPeople.some((fp) => fp.personId === 'a1')).toBe(true);
  });
});

describe('4. existing-person candidates', () => {
  beforeEach(() => resetDemo());

  it('offers spouses from other families only where the user is an admin', async () => {
    await login('u-admin-two');
    expect((await listLinkCandidates('fam-mansouri', 'spouse')).some((c) => c.person.id === 'ob')).toBe(true);

    // Rashid becomes a Viewer of Al Kaabi: its people must not be offered to him.
    await login('u-super');
    await inviteMember('fam-kaabi', { name: 'Rashid', email: 'rashid@example.ae', role: 'VIEWER' });
    await login('u-admin-mansouri');
    const candidates = await listLinkCandidates('fam-mansouri', 'spouse');
    expect(candidates.some((c) => c.family.id === 'fam-kaabi')).toBe(false);
    expect(candidates.some((c) => c.person.id === 'ob')).toBe(false);
    expect(candidates.some((c) => c.person.id === 'f1')).toBe(true);
    expect(
      await codeOf(addSpouse('fam-mansouri', 'he', { ...marriageInput, spouse: { kind: 'existing', personId: 'ob' } })),
    ).toBe('NOT_FOUND');
  });

  it('never offers people from an archived family, Super Admin included', async () => {
    await login('u-super');
    await archiveFamily('fam-kaabi');
    const candidates = await listLinkCandidates('fam-mansouri', 'spouse');
    expect(candidates.some((c) => c.family.id === 'fam-kaabi')).toBe(false);
    expect(candidates.some((c) => c.person.id === 'ob')).toBe(false);
    expect(
      await codeOf(addSpouse('fam-mansouri', 'he', { ...marriageInput, spouse: { kind: 'existing', personId: 'ob' } })),
    ).toBe('NOT_FOUND');
  });
});

describe('5. inviting members does not leak other users', () => {
  beforeEach(() => resetDemo());

  it('returns the typed name, not the stored one, to a Family Admin', async () => {
    await login('u-admin-mansouri');
    const e = await inviteMember('fam-mansouri', {
      name: 'Typed Name',
      email: 'hamad.kaabi@example.ae',
      role: 'VIEWER',
    });
    expect(e.userId).toBe('u-admin-kaabi');
    expect(e.name).toBe('Typed Name');
  });

  it('returns the stored name to Super Admin', async () => {
    await login('u-super');
    const e = await inviteMember('fam-shamsi', { name: 'Typed', email: 'hamad.kaabi@example.ae', role: 'VIEWER' });
    expect(e.name).toBe('Hamad Al Kaabi');
  });

  it('answers a Super Admin email and an existing member the same way', async () => {
    await login('u-admin-mansouri');
    const sup = await errorOf(inviteMember('fam-mansouri', { name: 'X', email: 'hamad@example.ae', role: 'VIEWER' }));
    const member = await errorOf(
      inviteMember('fam-mansouri', { name: 'X', email: 'rashid@example.ae', role: 'VIEWER' }),
    );
    expect(sup?.code).toBe('CONFLICT');
    expect(member?.code).toBe('CONFLICT');
    expect(sup?.message).toBe(member?.message);
  });

  it('treats a user of another client account as an invalid email', async () => {
    const db = getDb();
    db.users = [
      ...db.users,
      {
        id: 'u-other',
        clientId: 'other-client',
        name: 'Secret',
        email: 'other@example.com',
        isSuperAdmin: false,
        locale: 'en',
      },
    ];
    await login('u-admin-mansouri');
    const err = await errorOf(inviteMember('fam-mansouri', { name: 'X', email: 'other@example.com', role: 'VIEWER' }));
    expect(err?.code).toBe('VALIDATION');
    expect(err?.message).not.toContain('Secret');
    expect(getDb().familyMembers.some((m) => m.userId === 'u-other')).toBe(false);
  });

  it('rejects an unknown role as VALIDATION', async () => {
    await login('u-super');
    expect(await codeOf(changeRole('fam-mansouri', 'u-viewer', 'OWNER' as never))).toBe('VALIDATION');
  });
});

describe('6. cycle checks count soft-deleted people; parent limits and siblings do not', () => {
  beforeEach(() => resetDemo());

  it('rejects a cycle through a soft-deleted person', async () => {
    await login('u-super');
    // k1 → a1 → ra. With a1 deleted, ra as k1's parent would still close a loop on restore.
    await softDeletePerson('fam-mansouri', 'a1');
    expect(
      await codeOf(
        addParent('fam-mansouri', 'k1', { parent: { kind: 'existing', personId: 'ra' }, type: 'BIOLOGICAL' }),
      ),
    ).toBe('CYCLE');
  });

  it('counts only live biological parents toward the limit of two', async () => {
    await login('u-super');
    expect(await codeOf(addParent('fam-mansouri', 'ra', { parent: newPerson('Third'), type: 'BIOLOGICAL' }))).toBe(
      'TOO_MANY_PARENTS',
    );
    await softDeletePerson('fam-mansouri', 'a1');
    const p = await addParent('fam-mansouri', 'ra', { parent: newPerson('Replacement'), type: 'BIOLOGICAL' });
    expect(getDb().parentChild.some((e) => e.parentId === p.id && e.childId === 'ra')).toBe(true);
  });

  it('does not derive siblings through a deleted parent', async () => {
    await login('u-super');
    const before = (await getPerson('fam-mansouri', 'ra')).siblings.map((s) => s.person.id).sort();
    expect(before).toEqual(['he', 'om']);
    await softDeletePerson('fam-mansouri', 'a1');
    const after = (await getPerson('fam-mansouri', 'ra')).siblings.map((s) => s.person.id);
    expect(after).toEqual(['he']);
  });
});

describe('7. CSV export', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+971 50')).toBe("'+971 50");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
    expect(csvCell('Dubai')).toBe('Dubai');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
  });

  it('keeps Arabic letters in file names and strips only unsafe characters', () => {
    expect(fileSlug('عائلة المنصوري')).toBe('عائلة-المنصوري');
    expect(fileSlug('Al Mansouri / Family: "A"?')).toBe('Al-Mansouri-Family-A');
    expect(fileSlug('عائلة-المنصوري-الأفراد-2026-10-17')).toBe('عائلة-المنصوري-الأفراد-2026-10-17');
  });
});

describe('8. people and business writes refresh each other', () => {
  beforeEach(() => resetDemo());

  function setup() {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const keys = () => spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    return { wrapper, keys };
  }

  const expected = [['graph'], familyKeys.all, ['person'], ['businesses']].map((k) => JSON.stringify(k));

  it('a business write invalidates graph, families, person and business queries', async () => {
    await login('u-admin-mansouri');
    const businessId = (await getFamilyGraph('fam-mansouri')).businesses[0]?.id;
    expect(businessId).toBeDefined();
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useDeleteBusiness('fam-mansouri'), { wrapper });
    await result.current.mutateAsync(businessId as string);
    for (const k of expected) expect(keys()).toContain(k);
  });

  it('a person write invalidates graph, families, person and business queries', async () => {
    await login('u-admin-mansouri');
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useDeletePerson('fam-mansouri'), { wrapper });
    await result.current.mutateAsync('mz');
    for (const k of expected) expect(keys()).toContain(k);
  });
});
