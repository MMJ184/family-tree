import {
  type Business,
  type BusinessInput,
  type BusinessRole,
  type BusinessStatus,
  type BusinessType,
  businessRole,
  businessStatus,
  businessType,
  type EmployeesRange,
  employeesRange,
} from '@family-tree/shared';
import { z } from 'zod';
import type { BusinessLinkInput, LinkedPerson } from '#/entities/business/queries.ts';

// Form values are plain strings (what the inputs hold); `toBusinessInput`
// turns them into the API shape. Error messages are keys under business:form.errors.

export interface BusinessFormValues {
  name: string;
  nameAr: string;
  type: BusinessType;
  typeOther: string;
  status: BusinessStatus;
  description: string;
  logoUrl: string;
  startedYear: string;
  endedYear: string;
  employeesRange: EmployeesRange | '';
  branches: string;
  address: string;
  city: string;
  state: string;
  country: string;
  lat: string;
  lng: string;
  phone: string;
  email: string;
  website: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  whatsapp: string;
  registrationNo: string;
  links: BusinessLinkInput[];
}

const opt = z.string();
const year = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{4}$/.test(v) && Number(v) <= new Date().getFullYear() + 1), 'year');
const coord = (limit: number, key: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit), key);

export const businessFormSchema = z
  .object({
    name: z.string().trim().min(1, 'required'),
    nameAr: opt,
    type: businessType,
    typeOther: opt,
    status: businessStatus,
    description: opt,
    logoUrl: opt,
    startedYear: year,
    endedYear: year,
    employeesRange: z.union([employeesRange, z.literal('')]),
    branches: opt,
    address: opt,
    city: opt,
    state: opt,
    country: opt,
    lat: coord(90, 'lat'),
    lng: coord(180, 'lng'),
    phone: opt,
    email: z
      .string()
      .trim()
      .refine((v) => v === '' || z.email().safeParse(v).success, 'email'),
    website: z
      .string()
      .trim()
      .refine((v) => v === '' || /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(v), 'url'),
    instagram: opt,
    facebook: opt,
    linkedin: opt,
    whatsapp: opt,
    registrationNo: opt,
    links: z.array(z.object({ personId: z.string(), role: businessRole.nullable() })),
  })
  .superRefine((v, ctx) => {
    if (v.startedYear && v.endedYear && Number(v.endedYear) < Number(v.startedYear)) {
      ctx.addIssue({ code: 'custom', path: ['endedYear'], message: 'endedBeforeStarted' });
    }
  });

/** TanStack Form validator: maps Zod issues to `{ fields }`. */
export function validateBusinessForm({ value }: { value: BusinessFormValues }) {
  const r = businessFormSchema.safeParse(value);
  if (r.success) return undefined;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[issue.path.join('.')] ??= issue.message;
  return { fields };
}

const s = (v: string | null | undefined) => v ?? '';

export function toFormValues(b: Business | null, people: LinkedPerson[] = []): BusinessFormValues {
  return {
    name: s(b?.name),
    nameAr: s(b?.nameAr),
    type: b?.type ?? 'TRADING',
    typeOther: s(b?.typeOther),
    status: b?.status ?? 'ACTIVE',
    description: s(b?.description),
    logoUrl: s(b?.logoUrl),
    startedYear: b?.startedYear != null ? String(b.startedYear) : '',
    endedYear: b?.endedYear != null ? String(b.endedYear) : '',
    employeesRange: b?.employeesRange ?? '',
    branches: (b?.branches ?? []).join(', '),
    address: s(b?.address),
    city: s(b?.city),
    state: s(b?.state),
    country: s(b?.country),
    lat: b?.lat != null ? String(b.lat) : '',
    lng: b?.lng != null ? String(b.lng) : '',
    phone: s(b?.phone),
    email: s(b?.email),
    website: s(b?.website),
    instagram: s(b?.socialLinks.instagram),
    facebook: s(b?.socialLinks.facebook),
    linkedin: s(b?.socialLinks.linkedin),
    whatsapp: s(b?.socialLinks.whatsapp),
    registrationNo: s(b?.registrationNo),
    links: people.map(({ person, role }) => ({ personId: person.id, role })),
  };
}

const n = (v: string) => (v.trim() ? v.trim() : null);
const num = (v: string) => (v.trim() ? Number(v) : null);

export function toBusinessInput(v: BusinessFormValues): BusinessInput {
  const website = n(v.website);
  return {
    name: v.name.trim(),
    nameAr: n(v.nameAr),
    type: v.type,
    typeOther: v.type === 'OTHER' ? n(v.typeOther) : null,
    status: v.status,
    description: n(v.description),
    logoUrl: n(v.logoUrl),
    startedYear: num(v.startedYear),
    endedYear: num(v.endedYear),
    employeesRange: v.employeesRange || null,
    branches: v.branches
      .split(/[,،\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
    address: n(v.address),
    city: n(v.city),
    state: n(v.state),
    country: n(v.country),
    lat: num(v.lat),
    lng: num(v.lng),
    phone: n(v.phone),
    email: n(v.email),
    website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
    socialLinks: {
      instagram: n(v.instagram),
      facebook: n(v.facebook),
      linkedin: n(v.linkedin),
      whatsapp: n(v.whatsapp),
    },
    registrationNo: n(v.registrationNo),
  };
}

export const ROLE_OPTIONS: ReadonlyArray<BusinessRole> = businessRole.options;
