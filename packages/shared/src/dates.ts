import type { DatePrecision, PartialDate } from './schemas.ts';

export function partialYear(d: PartialDate | null | undefined): number | null {
  if (!d) return null;
  return Number(d.value.slice(0, 4));
}

export function makePartialDate(year: number, month?: number, day?: number, approx = false): PartialDate {
  const precision: DatePrecision = day ? 'DAY' : month ? 'MONTH' : 'YEAR';
  const mm = String(month ?? 1).padStart(2, '0');
  const dd = String(day ?? 1).padStart(2, '0');
  return { value: `${String(year).padStart(4, '0')}-${mm}-${dd}`, precision, approx };
}

/**
 * Formats a partial date for display in the given locale, respecting its precision.
 * Year-only dates print just the year; approximate dates get a "c." / "حوالي" prefix
 * supplied by the caller's translation (`approxLabel`).
 */
export function formatPartialDate(d: PartialDate | null | undefined, locale: string, approxLabel = ''): string {
  if (!d) return '';
  const [y, m, day] = d.value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, day));
  const opts: Intl.DateTimeFormatOptions =
    d.precision === 'DAY'
      ? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : d.precision === 'MONTH'
        ? { year: 'numeric', month: 'long', timeZone: 'UTC' }
        : { year: 'numeric', timeZone: 'UTC' };
  // Gregorian calendar with Latin digits for now; Hijri display is an open question (spec §10).
  const text = new Intl.DateTimeFormat(`${locale}-u-ca-gregory-nu-latn`, opts).format(date);
  return d.approx && approxLabel ? `${approxLabel} ${text}` : text;
}

/** "1905–1978", "1957" (living) or "?–1990"; empty when nothing is known. */
export function lifeSpan(birth: PartialDate | null, death: PartialDate | null): string {
  const b = partialYear(birth);
  const d = partialYear(death);
  if (b == null && d == null) return '';
  if (d == null) return String(b);
  return `${b ?? '?'}–${d}`;
}
