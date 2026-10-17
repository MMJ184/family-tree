import { z } from 'zod';

// Domain schemas shared by the web app, the demo mock API and (later) the Hono API.
// Field names follow the data model in docs/SPEC.md §5, in camelCase.

export const id = z.string().min(1);
export type Id = z.infer<typeof id>;

export const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
export type Gender = z.infer<typeof gender>;

export const datePrecision = z.enum(['DAY', 'MONTH', 'YEAR']);
export type DatePrecision = z.infer<typeof datePrecision>;

/**
 * A date that may be known only to the month or year. `value` is an ISO date
 * (YYYY-MM-DD); for MONTH or YEAR precision the unused parts are stored as 01
 * and ignored on display.
 */
export const partialDate = z.object({
  value: z.iso.date(),
  precision: datePrecision,
  approx: z.boolean(),
});
export type PartialDate = z.infer<typeof partialDate>;

export const familyRole = z.enum(['ADMIN', 'VIEWER']);
export type FamilyRole = z.infer<typeof familyRole>;

export const membership = z.enum(['BORN', 'MARRIED_IN']);
export type Membership = z.infer<typeof membership>;

export const parentChildType = z.enum(['BIOLOGICAL', 'ADOPTED', 'STEP']);
export type ParentChildType = z.infer<typeof parentChildType>;

export const marriageStatus = z.enum(['MARRIED', 'DIVORCED', 'WIDOWED']);
export type MarriageStatus = z.infer<typeof marriageStatus>;

export const businessType = z.enum([
  'MANUFACTURING',
  'TRADING',
  'RETAIL',
  'DIAMOND',
  'TEXTILE',
  'AGRICULTURE',
  'IT_SOFTWARE',
  'REAL_ESTATE',
  'CONSTRUCTION',
  'SERVICES',
  'PROFESSIONAL',
  'IMPORT_EXPORT',
  'OTHER',
]);
export type BusinessType = z.infer<typeof businessType>;

export const businessRole = z.enum(['OWNER', 'CO_FOUNDER', 'PARTNER', 'DIRECTOR', 'MANAGER']);
export type BusinessRole = z.infer<typeof businessRole>;

export const businessStatus = z.enum(['ACTIVE', 'CLOSED']);
export type BusinessStatus = z.infer<typeof businessStatus>;

export const employeesRange = z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']);
export type EmployeesRange = z.infer<typeof employeesRange>;

export const locale = z.enum(['ar', 'en']);
export type Locale = z.infer<typeof locale>;

// ---------- Accounts ----------

export const client = z.object({ id, name: z.string() });
export type Client = z.infer<typeof client>;

export const user = z.object({
  id,
  clientId: id,
  name: z.string(),
  email: z.email(),
  isSuperAdmin: z.boolean(),
  locale,
});
export type User = z.infer<typeof user>;

export const familyMember = z.object({ userId: id, familyId: id, role: familyRole });
export type FamilyMember = z.infer<typeof familyMember>;

// ---------- Families ----------

export const family = z.object({
  id,
  clientId: id,
  name: z.string().min(1),
  nameAr: z.string().nullable(),
  surname: z.string().nullable(),
  nativePlace: z.string().nullable(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  color: z.string(),
  archivedAt: z.iso.datetime().nullable(),
});
export type Family = z.infer<typeof family>;

export const familyInput = family.pick({
  name: true,
  nameAr: true,
  surname: true,
  nativePlace: true,
  description: true,
  coverUrl: true,
  color: true,
});
export type FamilyInput = z.infer<typeof familyInput>;

// ---------- People ----------

export const person = z.object({
  id,
  clientId: id,
  firstName: z.string().min(1),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  maidenName: z.string().nullable(),
  nameAr: z.string().nullable(),
  nameEn: z.string().nullable(),
  fatherName: z.string().nullable(),
  grandfatherName: z.string().nullable(),
  tribeName: z.string().nullable(),
  kunya: z.string().nullable(),
  laqab: z.string().nullable(),
  gender,
  birth: partialDate.nullable(),
  death: partialDate.nullable(),
  isLiving: z.boolean(),
  birthPlace: z.string().nullable(),
  currentCity: z.string().nullable(),
  photoUrl: z.string().nullable(),
  /** Personal contacts: null for Viewers (hidden by default, spec §3.2). */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  occupation: z.string().nullable(),
  education: z.string().nullable(),
  notes: z.string().nullable(),
  marriedIntoNote: z.string().nullable(),
  customFields: z.record(z.string(), z.string()),
  deletedAt: z.iso.datetime().nullable(),
});
export type Person = z.infer<typeof person>;

export const personInput = person
  .omit({ id: true, clientId: true, deletedAt: true })
  .refine((p) => !p.death || !p.isLiving, { message: 'deathRequiresNotLiving', path: ['isLiving'] });
export type PersonInput = z.infer<typeof personInput>;

export const familyPerson = z.object({ familyId: id, personId: id, membership });
export type FamilyPerson = z.infer<typeof familyPerson>;

export const parentChild = z.object({ id, parentId: id, childId: id, type: parentChildType });
export type ParentChild = z.infer<typeof parentChild>;

export const marriage = z.object({
  id,
  personAId: id,
  personBId: id,
  status: marriageStatus,
  startDate: partialDate.nullable(),
  endDate: partialDate.nullable(),
});
export type Marriage = z.infer<typeof marriage>;

// ---------- Businesses ----------

export const socialLinks = z.object({
  instagram: z.string().nullable(),
  facebook: z.string().nullable(),
  linkedin: z.string().nullable(),
  whatsapp: z.string().nullable(),
});
export type SocialLinks = z.infer<typeof socialLinks>;

export const business = z.object({
  id,
  familyId: id,
  name: z.string().min(1),
  nameAr: z.string().nullable(),
  type: businessType,
  typeOther: z.string().nullable(),
  description: z.string().nullable(),
  startedYear: z.number().int().nullable(),
  endedYear: z.number().int().nullable(),
  status: businessStatus,
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Only http(s) links, so a stored value can never become a script URL. */
  website: z
    .string()
    .regex(/^https?:\/\//i)
    .nullable(),
  socialLinks,
  /** GST / registration number: null for everyone except admins (spec §3.2.1). */
  registrationNo: z.string().nullable(),
  employeesRange: employeesRange.nullable(),
  branches: z.array(z.string()),
  logoUrl: z.string().nullable(),
  deletedAt: z.iso.datetime().nullable(),
});
export type Business = z.infer<typeof business>;

export const businessInput = business.omit({ id: true, familyId: true, deletedAt: true });
export type BusinessInput = z.infer<typeof businessInput>;

export const personBusiness = z.object({ personId: id, businessId: id, role: businessRole.nullable() });
export type PersonBusiness = z.infer<typeof personBusiness>;

// ---------- Session ----------

/** What the signed-in user may see: only the families they belong to (or all, for Super Admin). */
export const sessionInfo = z.object({
  user,
  client,
  families: z.array(z.object({ familyId: id, role: z.enum(['SUPER_ADMIN', 'ADMIN', 'VIEWER']) })),
});
export type SessionInfo = z.infer<typeof sessionInfo>;
export type EffectiveRole = SessionInfo['families'][number]['role'];

/** The whole graph of one family, as the tree views need it. */
export const familyGraph = z.object({
  family,
  people: z.array(person),
  memberships: z.array(familyPerson),
  parentChild: z.array(parentChild),
  marriages: z.array(marriage),
  businesses: z.array(business),
  personBusiness: z.array(personBusiness),
});
export type FamilyGraph = z.infer<typeof familyGraph>;
