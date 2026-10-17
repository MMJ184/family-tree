import {
  type DatePrecision,
  type Gender,
  makePartialDate,
  type PartialDate,
  type Person,
  type PersonInput,
} from '@family-tree/shared';
import { z } from 'zod';

// Form values for the person form: plain strings for every text input, a
// split-up partial date, and custom fields as an editable list. Converted to
// the API's PersonInput on submit.

export interface DateFields {
  precision: DatePrecision;
  year: string;
  month: string;
  day: string;
  approx: boolean;
}

export interface PersonFormValues {
  firstName: string;
  middleName: string;
  lastName: string;
  maidenName: string;
  nameAr: string;
  nameEn: string;
  fatherName: string;
  grandfatherName: string;
  tribeName: string;
  kunya: string;
  laqab: string;
  gender: Gender;
  birth: DateFields;
  death: DateFields;
  isLiving: boolean;
  birthPlace: string;
  currentCity: string;
  photoUrl: string;
  phone: string;
  email: string;
  occupation: string;
  education: string;
  notes: string;
  marriedIntoNote: string;
  custom: Array<{ key: string; value: string }>;
}

export type TextKey = {
  [K in keyof PersonFormValues]: PersonFormValues[K] extends string ? K : never;
}[keyof PersonFormValues];

export const emptyDate = (): DateFields => ({ precision: 'YEAR', year: '', month: '', day: '', approx: false });

export function dateToFields(d: PartialDate | null): DateFields {
  if (!d) return emptyDate();
  const [y = '', m = '', day = ''] = d.value.split('-');
  return {
    precision: d.precision,
    year: String(Number(y)),
    month: d.precision === 'YEAR' ? '' : String(Number(m)),
    day: d.precision === 'DAY' ? String(Number(day)) : '',
    approx: d.approx,
  };
}

export function fieldsToDate(f: DateFields): PartialDate | null {
  const year = Number(f.year);
  if (!f.year.trim() || !Number.isInteger(year)) return null;
  const month = f.precision !== 'YEAR' && f.month ? Number(f.month) : undefined;
  const day = f.precision === 'DAY' && month && f.day ? Number(f.day) : undefined;
  return makePartialDate(year, month, day, f.approx);
}

export function toFormValues(p: Partial<Person> | null): PersonFormValues {
  const s = (v: string | null | undefined) => v ?? '';
  return {
    firstName: s(p?.firstName),
    middleName: s(p?.middleName),
    lastName: s(p?.lastName),
    maidenName: s(p?.maidenName),
    nameAr: s(p?.nameAr),
    nameEn: s(p?.nameEn),
    fatherName: s(p?.fatherName),
    grandfatherName: s(p?.grandfatherName),
    tribeName: s(p?.tribeName),
    kunya: s(p?.kunya),
    laqab: s(p?.laqab),
    gender: p?.gender ?? 'MALE',
    birth: dateToFields(p?.birth ?? null),
    death: dateToFields(p?.death ?? null),
    isLiving: p?.isLiving ?? true,
    birthPlace: s(p?.birthPlace),
    currentCity: s(p?.currentCity),
    photoUrl: s(p?.photoUrl),
    phone: s(p?.phone),
    email: s(p?.email),
    occupation: s(p?.occupation),
    education: s(p?.education),
    notes: s(p?.notes),
    marriedIntoNote: s(p?.marriedIntoNote),
    custom: Object.entries(p?.customFields ?? {}).map(([key, value]) => ({ key, value })),
  };
}

export function toPersonInput(v: PersonFormValues): PersonInput {
  const n = (s: string) => (s.trim() ? s.trim() : null);
  const death = fieldsToDate(v.death);
  return {
    firstName: v.firstName.trim(),
    middleName: n(v.middleName),
    lastName: n(v.lastName),
    maidenName: n(v.maidenName),
    nameAr: n(v.nameAr),
    nameEn: n(v.nameEn),
    fatherName: n(v.fatherName),
    grandfatherName: n(v.grandfatherName),
    tribeName: n(v.tribeName),
    kunya: n(v.kunya),
    laqab: n(v.laqab),
    gender: v.gender,
    birth: fieldsToDate(v.birth),
    death,
    isLiving: death ? false : v.isLiving,
    birthPlace: n(v.birthPlace),
    currentCity: n(v.currentCity),
    photoUrl: n(v.photoUrl),
    phone: n(v.phone),
    email: n(v.email),
    occupation: n(v.occupation),
    education: n(v.education),
    notes: n(v.notes),
    marriedIntoNote: n(v.marriedIntoNote),
    customFields: Object.fromEntries(
      v.custom.filter((c) => c.key.trim()).map((c) => [c.key.trim(), c.value.trim()] as const),
    ),
  };
}

// Messages are translation keys under people:form.errors.
const dateSchema = z
  .object({
    precision: z.enum(['DAY', 'MONTH', 'YEAR']),
    year: z
      .string()
      .refine(
        (y) => !y.trim() || (/^\d{1,4}$/.test(y.trim()) && Number(y) >= 1 && Number(y) <= new Date().getFullYear() + 1),
        'year',
      ),
    month: z.string(),
    day: z.string(),
    approx: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (!d.year.trim()) return;
    if (d.precision !== 'YEAR' && !d.month) ctx.addIssue({ code: 'custom', message: 'month', path: ['month'] });
    if (d.precision === 'DAY') {
      const day = Number(d.day);
      const max = new Date(Date.UTC(Number(d.year), Number(d.month), 0)).getUTCDate();
      if (!Number.isInteger(day) || day < 1 || day > max)
        ctx.addIssue({ code: 'custom', message: 'day', path: ['day'] });
    }
  });

export const personFormSchema = z
  .object({
    firstName: z.string().trim().min(1, 'required'),
    email: z.string().refine((e) => !e.trim() || z.email().safeParse(e.trim()).success, 'email'),
    birth: dateSchema,
    death: dateSchema,
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const b = fieldsToDate(v.birth);
    const d = fieldsToDate(v.death);
    if (b && d && d.value < b.value)
      ctx.addIssue({ code: 'custom', message: 'deathBeforeBirth', path: ['death', 'year'] });
  });
