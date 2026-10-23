import { beforeEach, describe, expect, it } from 'vitest';
import { login } from '#/api/auth.ts';
import { ApiError } from '#/api/core.ts';
import { listFamilies } from '#/api/families.ts';
import { getFamilyGraph } from '#/api/graph.ts';
import { resetDemo } from './db.ts';

// Tenant and family isolation (CLAUDE.md): what each demo role can reach.

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
}

describe('family isolation', () => {
  beforeEach(() => resetDemo());

  it('shows a Family Admin only their own family, and hides others as NOT_FOUND', async () => {
    await login('u-admin-mansouri');
    expect((await listFamilies()).map((f) => f.family.id)).toEqual(['fam-mansouri']);
    expect(await codeOf(getFamilyGraph('fam-kaabi'))).toBe('NOT_FOUND');
    expect(await codeOf(getFamilyGraph('fam-nuaimi'))).toBe('NOT_FOUND');
  });

  it('gives an admin of two families exactly those two', async () => {
    await login('u-admin-two');
    expect((await listFamilies()).map((f) => f.family.id).sort()).toEqual(['fam-kaabi', 'fam-mansouri']);
  });

  it('gives Super Admin every family on the account', async () => {
    await login('u-super');
    expect((await listFamilies()).length).toBe(5);
  });

  it('shows a married-in person in both trees as one record', async () => {
    await login('u-super');
    const mansouri = await getFamilyGraph('fam-mansouri');
    const kaabi = await getFamilyGraph('fam-kaabi');
    expect(mansouri.people.some((p) => p.id === 'f1')).toBe(true);
    expect(kaabi.people.some((p) => p.id === 'f1')).toBe(true);
    expect(mansouri.memberships.find((m) => m.personId === 'f1')?.membership).toBe('MARRIED_IN');
    expect(kaabi.memberships.find((m) => m.personId === 'f1')?.membership).toBe('BORN');
  });

  it('hides personal contacts and registration numbers from Viewers', async () => {
    await login('u-admin-mansouri');
    const admin = await getFamilyGraph('fam-mansouri');
    expect(admin.people.some((p) => p.phone)).toBe(true);
    expect(admin.businesses.some((b) => b.registrationNo)).toBe(true);
    await login('u-viewer');
    const viewer = await getFamilyGraph('fam-mansouri');
    expect(viewer.people.every((p) => p.phone === null && p.email === null)).toBe(true);
    expect(viewer.businesses.every((b) => b.registrationNo === null)).toBe(true);
    expect(viewer.businesses.some((b) => b.phone)).toBe(true);
  });
});
