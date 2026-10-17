// Search normalisation for Arabic and English names (spec §3.4.1).
// Folds the alef, hamza, ta marbuta and alef maqsura variants people type
// interchangeably, strips diacritics and tatweel, and lower-cases Latin text.

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeSearch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/\bal[\s-]+/gi, '') // Latin "Al " / "al-" article
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of `query` appears, after normalisation, in one of `fields`. */
export function matchesSearch(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = fields
    .filter((f): f is string => Boolean(f))
    .map((f) => ` ${normalizeSearch(f)}`)
    .join(' ');
  return q.split(' ').every((word) => hay.includes(` ${word}`) || hay.includes(word));
}
