import type {
  Business,
  Client,
  Family,
  FamilyMember,
  FamilyPerson,
  Marriage,
  ParentChild,
  Person,
  PersonBusiness,
  User,
} from '@family-tree/shared';
import { buildSeed } from './seed.ts';

// In-browser stand-in for the database, used for the client demo (spec decision #9).
// Tables mirror the data model in docs/SPEC.md §5. The whole store is saved to
// localStorage after every write, so changes made during a demo survive a reload.

export interface DemoDb {
  version: number;
  clients: Client[];
  users: User[];
  familyMembers: FamilyMember[];
  families: Family[];
  people: Person[];
  familyPeople: FamilyPerson[];
  parentChild: ParentChild[];
  marriages: Marriage[];
  businesses: Business[];
  personBusiness: PersonBusiness[];
  /** The signed-in demo user; stands in for the server-side session. */
  sessionUserId: string | null;
}

/** Bump when the seed or table shapes change, so old saved demos are replaced. */
const DB_VERSION = 14;
const STORAGE_KEY = 'ft:demo-db';

function fresh(sessionUserId: string | null = null): DemoDb {
  // Clone so in-place writes never leak into the seed module's arrays.
  return { version: DB_VERSION, sessionUserId, ...structuredClone(buildSeed()) };
}

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    // Storage blocked or corrupt: fall back to a fresh seed in memory.
  }
  return fresh();
}

let db: DemoDb = load();

// Another tab saved: take its copy, so tabs don't overwrite each other's changes.
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    db = load();
    for (const fn of listeners) fn();
  });
}

/** Runs `fn` when another tab changed the demo data (the UI refetches). */
export function onExternalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDb(): DemoDb {
  return db;
}

/** Saves the store. Call after every write. */
export function commit(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Quota exceeded or storage blocked: the demo keeps working in memory.
  }
}

/** Restores the sample data. Keeps the current demo user signed in. */
export function resetDemo(): void {
  db = fresh(db.sessionUserId);
  commit();
}

let counter = 0;
/** Sortable unique id, in the spirit of the ULIDs the real API will use. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
