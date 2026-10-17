import type { Person } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { idTimestamp, recentAdditions, upcomingBirthdays } from './stats.ts';

const person = (id: string, birth: Person['birth'], isLiving = true) => ({ id, birth, isLiving }) as Person;

describe('overview stats', () => {
  it('lists upcoming birthdays only for living people with a full date, soonest first', () => {
    const today = new Date(2026, 9, 17);
    const people = [
      person('a', { value: '1980-10-20', precision: 'DAY', approx: false }),
      person('b', { value: '1990-10-17', precision: 'DAY', approx: false }),
      person('c', { value: '1970-01-05', precision: 'DAY', approx: false }),
      person('d', { value: '1960-10-01', precision: 'MONTH', approx: false }),
      person('e', { value: '1950-10-18', precision: 'DAY', approx: false }, false),
    ];
    const out = upcomingBirthdays(people, today);
    expect(out.map((b) => [b.person.id, b.inDays, b.turns])).toEqual([
      ['b', 0, 36],
      ['a', 3, 46],
      ['c', 80, 57],
    ]);
  });

  it('reads creation time from API ids and falls back to latest births', () => {
    const ts = Date.UTC(2026, 9, 1);
    const id = `p-${ts.toString(36)}01abcd`;
    expect(idTimestamp(id)?.getTime()).toBe(ts);
    expect(idTimestamp('k1')).toBeNull();
    const out = recentAdditions([
      person('k1', { value: '1905-01-01', precision: 'YEAR', approx: false }),
      person('k2', { value: '2001-01-01', precision: 'YEAR', approx: false }),
      person(id, null),
    ]);
    expect(out.map((r) => r.person.id)).toEqual([id, 'k2', 'k1']);
  });
});
