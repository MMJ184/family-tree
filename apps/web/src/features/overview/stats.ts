import { type FamilyGraph, generations, type Person, partialYear } from '@family-tree/shared';

// Pure numbers behind the family overview, all derived from the family graph.

export interface Birthday {
  person: Person;
  /** Days from today; 0 = today. */
  inDays: number;
  turns: number;
  date: Date;
}

export interface RecentAddition {
  person: Person;
  /** When the record was created, if known (ids from the API embed a timestamp). */
  addedAt: Date | null;
}

export interface OverviewStats {
  people: number;
  living: number;
  deceased: number;
  generationCount: number;
  /** People per generation, earliest (0) first. */
  perGeneration: Array<{ gen: number; count: number }>;
  businesses: number;
  activeBusinesses: number;
  marriedIn: number;
  birthdays: Birthday[];
  recent: RecentAddition[];
  oldestLiving: Person | null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const DAY_MS = 86_400_000;

/** Next birthdays for living people whose birth date is known to the day. */
export function upcomingBirthdays(people: ReadonlyArray<Person>, today = new Date(), limit = 5): Birthday[] {
  const base = startOfDay(today);
  const out: Birthday[] = [];
  for (const p of people) {
    if (!p.isLiving || p.birth?.precision !== 'DAY') continue;
    const [y, m, d] = p.birth.value.split('-').map(Number) as [number, number, number];
    let next = new Date(base.getFullYear(), m - 1, d);
    if (next < base) next = new Date(base.getFullYear() + 1, m - 1, d);
    out.push({
      person: p,
      inDays: Math.round((next.getTime() - base.getTime()) / DAY_MS),
      turns: next.getFullYear() - y,
      date: next,
    });
  }
  return out.sort((a, b) => a.inDays - b.inDays).slice(0, limit);
}

/** Creation time embedded in ids made by the API (`prefix-<base36 ms><counter><random>`); null for seeded ids. */
export function idTimestamp(id: string): Date | null {
  const m = /^[a-z]+-([0-9a-z]{8})[0-9a-z]{6}$/.exec(id);
  if (!m?.[1]) return null;
  const ms = Number.parseInt(m[1], 36);
  const year = new Date(ms).getFullYear();
  return year >= 2020 && ms <= Date.now() + DAY_MS ? new Date(ms) : null;
}

/** People added most recently; topped up with the latest births when few records carry a creation time. */
export function recentAdditions(people: ReadonlyArray<Person>, limit = 5): RecentAddition[] {
  const withTime = people
    .map((p) => ({ person: p, addedAt: idTimestamp(p.id) }))
    .filter((r): r is { person: Person; addedAt: Date } => r.addedAt != null)
    .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  const taken = new Set(withTime.map((r) => r.person.id));
  const byBirth = people
    .filter((p) => !taken.has(p.id) && p.birth)
    .sort((a, b) => (b.birth?.value ?? '').localeCompare(a.birth?.value ?? ''))
    .map((p) => ({ person: p, addedAt: null }));
  return [...withTime, ...byBirth].slice(0, limit);
}

export function computeStats(graph: FamilyGraph, today = new Date()): OverviewStats {
  const { people } = graph;
  const gen = generations(
    graph,
    people.map((p) => p.id),
  );
  const counts: number[] = [];
  for (const g of gen.values()) counts[g] = (counts[g] ?? 0) + 1;
  const perGeneration = Array.from({ length: counts.length }, (_, g) => ({ gen: g, count: counts[g] ?? 0 }));

  const living = people.filter((p) => p.isLiving);
  const oldestLiving =
    living
      .filter((p) => partialYear(p.birth) != null)
      .sort((a, b) => (a.birth?.value ?? '').localeCompare(b.birth?.value ?? ''))[0] ?? null;

  return {
    people: people.length,
    living: living.length,
    deceased: people.length - living.length,
    generationCount: perGeneration.length,
    perGeneration,
    businesses: graph.businesses.length,
    activeBusinesses: graph.businesses.filter((b) => b.status === 'ACTIVE').length,
    marriedIn: graph.memberships.filter((m) => m.membership === 'MARRIED_IN').length,
    birthdays: upcomingBirthdays(people, today),
    recent: recentAdditions(people),
    oldestLiving,
  };
}
