import { formatPartialDate, type PartialDate, type Person, partialYear } from '@family-tree/shared';
import type { TFunction } from 'i18next';
import { canEdit, roleForFamily, useSession } from '#/entities/session/queries.ts';

/** The user's role in a family and whether they may edit it. */
export function useFamilyRole(familyId: string) {
  const { data } = useSession();
  const role = roleForFamily(data, familyId);
  return { role, editable: canEdit(role) };
}

export function formatDate(d: PartialDate | null | undefined, locale: string, t: TFunction): string {
  return formatPartialDate(d, locale, t('dates.approx', { ns: 'common' }));
}

/** Age today for the living, or age at death. Null when the birth year is unknown. */
export function personAge(p: Pick<Person, 'birth' | 'death' | 'isLiving'>): number | null {
  const born = partialYear(p.birth);
  if (born == null) return null;
  const end = partialYear(p.death) ?? (p.isLiving ? new Date().getFullYear() : null);
  return end == null ? null : Math.max(0, end - born);
}

/**
 * The nasab line: "bin Ahmed bin Khalid" / "بن أحمد بن خالد" (bint / بنت for women).
 * Uses the stored father and grandfather names when given.
 */
export function nasabLine(
  p: Pick<Person, 'gender' | 'fatherName' | 'grandfatherName'>,
  fallback: { father?: string | null; grandfather?: string | null },
  t: TFunction,
): string {
  const father = p.fatherName || fallback.father;
  const grandfather = p.grandfatherName || fallback.grandfather;
  if (!father) return '';
  const first = t(p.gender === 'FEMALE' ? 'profile.bint' : 'profile.bin', { ns: 'people' });
  const second = t('profile.bin', { ns: 'people' });
  return [first, father, grandfather ? `${second} ${grandfather}` : ''].filter(Boolean).join(' ');
}

/** The name in the other script, shown under the main one. */
export function otherScriptName(p: Pick<Person, 'nameAr' | 'nameEn'>, locale: string): string | null {
  const name = locale === 'ar' ? p.nameEn : p.nameAr;
  const main = locale === 'ar' ? p.nameAr : p.nameEn;
  return name && main && name !== main ? name : null;
}

/** First word of a full name, without the "Al"/"ال" article. */
export function firstWord(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? '';
}
