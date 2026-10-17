import type { Business, BusinessType } from '@family-tree/shared';

/** The business name in the active language, falling back to the other script. */
export function businessName(b: Pick<Business, 'name' | 'nameAr'>, locale: string): string {
  return (locale === 'ar' ? b.nameAr : null) || b.name;
}

/** The other script's name, when it differs (shown as a subtitle). */
export function businessAltName(b: Pick<Business, 'name' | 'nameAr'>, locale: string): string | null {
  const alt = locale === 'ar' ? b.name : b.nameAr;
  return alt && alt !== businessName(b, locale) ? alt : null;
}

/** Hue (oklch) per industry, used for badges, monograms and the summary strip. */
export const BUSINESS_TYPE_HUE: Record<BusinessType, number> = {
  MANUFACTURING: 250,
  TRADING: 175,
  RETAIL: 330,
  DIAMOND: 220,
  TEXTILE: 300,
  AGRICULTURE: 135,
  IT_SOFTWARE: 270,
  REAL_ESTATE: 30,
  CONSTRUCTION: 60,
  SERVICES: 195,
  PROFESSIONAL: 85,
  IMPORT_EXPORT: 150,
  OTHER: 100,
};

/** A mid-tone accent for the industry that reads on both light and dark surfaces. */
export function businessTypeColor(type: BusinessType, alpha = 1): string {
  return `oklch(0.62 0.13 ${BUSINESS_TYPE_HUE[type]} / ${alpha})`;
}
