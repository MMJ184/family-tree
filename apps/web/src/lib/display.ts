import { type Family, lifeSpan, type Person } from '@family-tree/shared';

// Picks the name in the active language, falling back to the other script.

export function personName(p: Pick<Person, 'nameAr' | 'nameEn' | 'firstName' | 'lastName'>, locale: string): string {
  const primary = locale === 'ar' ? p.nameAr : p.nameEn;
  const secondary = locale === 'ar' ? p.nameEn : p.nameAr;
  return primary || secondary || [p.firstName, p.lastName].filter(Boolean).join(' ');
}

/** First name only, in the active language (for compact tree cards). */
export function personShortName(p: Pick<Person, 'nameAr' | 'nameEn' | 'firstName'>, locale: string): string {
  const full = locale === 'ar' ? p.nameAr : p.nameEn;
  return full?.split(' ')[0] || p.firstName;
}

export function familyName(f: Pick<Family, 'name' | 'nameAr'>, locale: string): string {
  return (locale === 'ar' ? f.nameAr : null) || f.name;
}

export function personYears(p: Pick<Person, 'birth' | 'death'>): string {
  return lifeSpan(p.birth, p.death);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w && !/^(al|ال)$/i.test(w))
    .slice(0, 2)
    .map((w) => w.replace(/^ال/, '')[0] ?? '')
    .join('')
    .toUpperCase();
}
