import {
  type Business,
  type BusinessInput,
  type BusinessRole,
  type BusinessStatus,
  type BusinessType,
  businessInput,
  businessRole,
  matchesSearch,
  normalizeSearch,
  type Person,
  type PersonBusiness,
} from '@family-tree/shared';
import { commit, getDb, newId, nowIso } from '#/mock/db.ts';
import { familyPersonIds, redactBusiness, redactPerson, requireFamily, requirePersonInFamily } from '#/mock/guard.ts';
import { ApiError, handle } from './core.ts';

// Businesses of one family (spec §3.2.1). A business is stored once and linked
// to many people through PersonBusiness (e.g. brothers as partners). Shaped like
// the REST API that will replace it:
//   GET    /families/:familyId/businesses?q&type&city&status&personId
//   GET    /families/:familyId/businesses/:businessId
//   POST   /families/:familyId/businesses
//   PATCH  /families/:familyId/businesses/:businessId
//   DELETE /families/:familyId/businesses/:businessId            (soft delete)
//   PUT    /families/:familyId/businesses/:businessId/people/:personId  { role }
//   DELETE /families/:familyId/businesses/:businessId/people/:personId
// Viewers of the family see contact details but never the registration number.

export interface BusinessFilters {
  q?: string | undefined;
  type?: BusinessType | undefined;
  city?: string | undefined;
  status?: BusinessStatus | undefined;
  /** Only businesses this person is linked to. */
  personId?: string | undefined;
}

export interface LinkedPerson {
  person: Person;
  role: BusinessRole | null;
}

export interface BusinessWithPeople {
  business: Business;
  people: LinkedPerson[];
}

export interface BusinessLinkInput {
  personId: string;
  role: BusinessRole | null;
}

function liveBusiness(familyId: string, businessId: string): Business {
  const b = getDb().businesses.find((x) => x.id === businessId && x.familyId === familyId && !x.deletedAt);
  if (!b) throw new ApiError('NOT_FOUND');
  return b;
}

function linkedPeople(businessId: string, familyId: string, role: Parameters<typeof redactPerson>[1]): LinkedPerson[] {
  const db = getDb();
  const ids = familyPersonIds(familyId);
  const order: Record<string, number> = { OWNER: 0, CO_FOUNDER: 1, PARTNER: 2, DIRECTOR: 3, MANAGER: 4 };
  return db.personBusiness
    .filter((pb) => pb.businessId === businessId && ids.has(pb.personId))
    .flatMap((pb) => {
      const person = db.people.find((p) => p.id === pb.personId);
      return person ? [{ person: redactPerson(person, role), role: pb.role }] : [];
    })
    .sort((a, b) => (order[a.role ?? ''] ?? 9) - (order[b.role ?? ''] ?? 9));
}

const emptyToNull = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/** Validates and tidies an input: blank strings become null, typeOther only for OTHER. */
function cleanInput(raw: BusinessInput): BusinessInput {
  const parsed = businessInput.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION', parsed.error.message);
  const b = parsed.data;
  const name = b.name.trim();
  if (!name) throw new ApiError('VALIDATION', 'name');
  if (b.startedYear != null && b.endedYear != null && b.endedYear < b.startedYear) {
    throw new ApiError('VALIDATION', 'endedYear');
  }
  if (b.lat != null && (b.lat < -90 || b.lat > 90)) throw new ApiError('VALIDATION', 'lat');
  if (b.lng != null && (b.lng < -180 || b.lng > 180)) throw new ApiError('VALIDATION', 'lng');
  return {
    ...b,
    name,
    nameAr: emptyToNull(b.nameAr),
    typeOther: b.type === 'OTHER' ? emptyToNull(b.typeOther) : null,
    description: emptyToNull(b.description),
    address: emptyToNull(b.address),
    city: emptyToNull(b.city),
    state: emptyToNull(b.state),
    country: emptyToNull(b.country),
    phone: emptyToNull(b.phone),
    email: emptyToNull(b.email),
    website: emptyToNull(b.website),
    registrationNo: emptyToNull(b.registrationNo),
    socialLinks: {
      instagram: emptyToNull(b.socialLinks.instagram),
      facebook: emptyToNull(b.socialLinks.facebook),
      linkedin: emptyToNull(b.socialLinks.linkedin),
      whatsapp: emptyToNull(b.socialLinks.whatsapp),
    },
    branches: b.branches.map((x) => x.trim()).filter(Boolean),
  };
}

export function listBusinesses(familyId: string, filters: BusinessFilters = {}): Promise<BusinessWithPeople[]> {
  return handle(() => {
    const { role } = requireFamily(familyId);
    const db = getDb();
    const city = filters.city ? normalizeSearch(filters.city) : null;
    const linkedTo = filters.personId
      ? new Set(db.personBusiness.filter((pb) => pb.personId === filters.personId).map((pb) => pb.businessId))
      : null;
    return db.businesses
      .filter((b) => b.familyId === familyId && !b.deletedAt)
      .filter((b) => !filters.type || b.type === filters.type)
      .filter((b) => !filters.status || b.status === filters.status)
      .filter((b) => !city || normalizeSearch(b.city ?? '') === city)
      .filter((b) => !linkedTo || linkedTo.has(b.id))
      .map((b) => ({ business: redactBusiness(b, role), people: linkedPeople(b.id, familyId, role) }))
      .filter(
        ({ business: b, people }) =>
          !filters.q ||
          matchesSearch(filters.q, [
            b.name,
            b.nameAr,
            b.typeOther,
            b.description,
            b.city,
            b.country,
            ...b.branches,
            ...people.flatMap(({ person: p }) => [p.nameAr, p.nameEn, p.firstName, p.lastName]),
          ]),
      )
      .sort((a, b) => a.business.name.localeCompare(b.business.name));
  });
}

export function getBusiness(familyId: string, businessId: string): Promise<BusinessWithPeople> {
  return handle(() => {
    const { role } = requireFamily(familyId);
    const b = liveBusiness(familyId, businessId);
    return { business: redactBusiness(b, role), people: linkedPeople(b.id, familyId, role) };
  });
}

export function createBusiness(familyId: string, input: BusinessInput): Promise<Business> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const business: Business = { ...cleanInput(input), id: newId('biz'), familyId, deletedAt: null };
    getDb().businesses.push(business);
    commit();
    return business;
  });
}

export function updateBusiness(familyId: string, businessId: string, input: BusinessInput): Promise<Business> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    const current = liveBusiness(familyId, businessId);
    Object.assign(current, cleanInput(input));
    commit();
    return current;
  });
}

export function softDeleteBusiness(familyId: string, businessId: string): Promise<void> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    liveBusiness(familyId, businessId).deletedAt = nowIso();
    commit();
  });
}

/** Links a family member to the business, or changes their role if already linked. */
export function linkPerson(
  familyId: string,
  businessId: string,
  personId: string,
  role: BusinessRole | null,
): Promise<PersonBusiness> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    liveBusiness(familyId, businessId);
    requirePersonInFamily(familyId, personId);
    if (role !== null && !businessRole.safeParse(role).success) throw new ApiError('VALIDATION', 'role');
    const db = getDb();
    const existing = db.personBusiness.find((pb) => pb.businessId === businessId && pb.personId === personId);
    if (existing) existing.role = role;
    else db.personBusiness.push({ businessId, personId, role });
    commit();
    return existing ?? { businessId, personId, role };
  });
}

export function unlinkPerson(familyId: string, businessId: string, personId: string): Promise<void> {
  return handle(() => {
    requireFamily(familyId, 'EDIT');
    liveBusiness(familyId, businessId);
    requirePersonInFamily(familyId, personId);
    const db = getDb();
    const before = db.personBusiness.length;
    db.personBusiness = db.personBusiness.filter((pb) => !(pb.businessId === businessId && pb.personId === personId));
    if (db.personBusiness.length === before) throw new ApiError('NOT_FOUND');
    commit();
  });
}
