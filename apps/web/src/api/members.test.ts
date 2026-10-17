import { beforeEach, describe, expect, it } from 'vitest';
import { resetDemo } from '#/mock/db.ts';
import { getSession, login } from './auth.ts';
import { ApiError } from './core.ts';
import {
  archiveFamily,
  createFamily,
  getFamily,
  listArchivedFamilies,
  listFamilies,
  restoreFamily,
  updateFamily,
} from './families.ts';
import { changeRole, inviteMember, listFamilyAccess, removeMember } from './members.ts';

// Family management and access rules (spec §2, §3.1).

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
}

const input = {
  name: 'Al Hashimi Family',
  nameAr: 'عائلة الهاشمي',
  surname: 'Al Hashimi',
  nativePlace: 'Al Ain',
  description: '',
  coverUrl: null,
  color: '#3f8f4f',
};

describe('family management', () => {
  beforeEach(() => resetDemo());

  it('lets only Super Admin create, archive and restore', async () => {
    await login('u-admin-mansouri');
    expect(await codeOf(createFamily(input))).toBe('FORBIDDEN');
    expect(await codeOf(archiveFamily('fam-mansouri'))).toBe('FORBIDDEN');
    await login('u-super');
    const f = await createFamily(input);
    expect(f.description).toBeNull();
    expect((await listFamilies()).some((s) => s.family.id === f.id)).toBe(true);
    await archiveFamily(f.id);
    expect((await listFamilies()).some((s) => s.family.id === f.id)).toBe(false);
    expect((await listArchivedFamilies()).map((s) => s.family.id)).toEqual([f.id]);
    await restoreFamily(f.id);
    expect((await listFamilies()).some((s) => s.family.id === f.id)).toBe(true);
  });

  it('hides archived families from their admins and lets admins edit only their own family', async () => {
    await login('u-admin-mansouri');
    await updateFamily('fam-mansouri', { ...input, name: 'Renamed' });
    expect((await getFamily('fam-mansouri')).family.name).toBe('Renamed');
    expect(await codeOf(updateFamily('fam-kaabi', input))).toBe('NOT_FOUND');
    expect(await codeOf(getFamily('fam-kaabi'))).toBe('NOT_FOUND');
    await login('u-super');
    await archiveFamily('fam-mansouri');
    await login('u-admin-mansouri');
    expect(await listFamilies()).toEqual([]);
    expect(await codeOf(getFamily('fam-mansouri'))).toBe('NOT_FOUND');
  });
});

describe('access management', () => {
  beforeEach(() => resetDemo());

  it('lets a Family Admin invite Viewers but not admins', async () => {
    await login('u-admin-mansouri');
    expect(await codeOf(inviteMember('fam-mansouri', { name: 'X', email: 'x@example.ae', role: 'ADMIN' }))).toBe(
      'FORBIDDEN',
    );
    const v = await inviteMember('fam-mansouri', { name: 'Mariam', email: 'Mariam@Example.ae', role: 'VIEWER' });
    expect(v.email).toBe('mariam@example.ae');
    expect(
      await codeOf(inviteMember('fam-mansouri', { name: 'Mariam', email: 'mariam@example.ae', role: 'VIEWER' })),
    ).toBe('CONFLICT');
    expect(await codeOf(inviteMember('fam-kaabi', { name: 'Y', email: 'y@example.ae', role: 'VIEWER' }))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(changeRole('fam-mansouri', v.userId, 'ADMIN'))).toBe('FORBIDDEN');
    expect(await codeOf(removeMember('fam-mansouri', 'u-admin-two'))).toBe('FORBIDDEN');
    expect(await codeOf(removeMember('fam-mansouri', 'u-super'))).toBe('FORBIDDEN');
    await removeMember('fam-mansouri', v.userId);
    expect((await listFamilyAccess('fam-mansouri')).some((e) => e.userId === v.userId)).toBe(false);
  });

  it('lets Super Admin assign an admin, who then sees only that family', async () => {
    await login('u-super');
    const a = await inviteMember('fam-shamsi', { name: 'Salem', email: 'salem@example.ae', role: 'ADMIN' });
    await login(a.userId);
    const session = await getSession();
    expect(session?.families).toEqual([{ familyId: 'fam-shamsi', role: 'ADMIN' }]);
    await login('u-super');
    await changeRole('fam-shamsi', a.userId, 'VIEWER');
    expect((await listFamilyAccess('fam-shamsi')).find((e) => e.userId === a.userId)?.role).toBe('VIEWER');
  });

  it('keeps the access list from Viewers', async () => {
    await login('u-viewer');
    expect(await codeOf(listFamilyAccess('fam-mansouri'))).toBe('FORBIDDEN');
    expect(await codeOf(listFamilyAccess('fam-kaabi'))).toBe('NOT_FOUND');
  });
});
