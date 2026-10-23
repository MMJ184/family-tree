import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch } from './arabic.ts';
import { formatPartialDate, lifeSpan, makePartialDate } from './dates.ts';
import { branchOf, checkParentLink, generations, scopeIds, siblingsOf } from './kinship.ts';
import type { Marriage, ParentChild } from './schemas.ts';

const pc = (parentId: string, childId: string): ParentChild => ({
  id: `${parentId}-${childId}`,
  parentId,
  childId,
  type: 'BIOLOGICAL',
});
const mar = (a: string, b: string): Marriage => ({
  id: `${a}-${b}`,
  personAId: a,
  personBId: b,
  status: 'MARRIED',
  startDate: null,
  endDate: null,
});

describe('normalizeSearch', () => {
  it('folds alef, hamza, ta marbuta and alef maqsura variants', () => {
    expect(normalizeSearch('أحمد')).toBe(normalizeSearch('احمد'));
    expect(normalizeSearch('إيمان')).toBe(normalizeSearch('ايمان'));
    expect(normalizeSearch('فاطمة')).toBe(normalizeSearch('فاطمه'));
    expect(normalizeSearch('مصطفى')).toBe(normalizeSearch('مصطفي'));
    expect(normalizeSearch('آمنة')).toBe(normalizeSearch('امنه'));
  });
  it('strips diacritics and the Latin "Al" article', () => {
    expect(normalizeSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeSearch('Al Mansouri')).toBe('mansouri');
  });
  it('matches every word in any field', () => {
    expect(matchesSearch('خالد المنصوري', ['خالد المنصوري'])).toBe(true);
    expect(matchesSearch('منصوري', ['المنصوري'])).toBe(true);
    expect(matchesSearch('khalid 1905', ['Khalid Al Mansouri', '1905'])).toBe(true);
    expect(matchesSearch('sara', ['Khalid'])).toBe(false);
  });
});

describe('dates', () => {
  it('formats by precision', () => {
    expect(formatPartialDate(makePartialDate(1957), 'en')).toBe('1957');
    expect(formatPartialDate(makePartialDate(1957, 3), 'en')).toBe('March 1957');
    expect(formatPartialDate(makePartialDate(1957, 3, 9, true), 'en', 'c.')).toBe('c. March 9, 1957');
  });
  it('builds life spans', () => {
    expect(lifeSpan(makePartialDate(1905), makePartialDate(1978))).toBe('1905–1978');
    expect(lifeSpan(makePartialDate(1990), null)).toBe('1990');
    expect(lifeSpan(null, null)).toBe('');
  });
});

describe('kinship', () => {
  const edges = {
    parentChild: [pc('k', 'a'), pc('f', 'a'), pc('k', 'm'), pc('f', 'm'), pc('a', 'r')],
    marriages: [mar('k', 'f'), mar('a', 'w')],
  };
  it('builds a branch from parents, spouses and descendants, without siblings', () => {
    expect([...branchOf(edges, 'a')].sort()).toEqual(['a', 'f', 'k', 'r', 'w']);
    expect([...branchOf(edges, 'k')].sort()).toEqual(['a', 'f', 'k', 'm', 'r', 'w']);
  });
  it('narrows to descendants, or to the whole line with ancestors', () => {
    expect([...scopeIds(edges, 'a', 'down')].sort()).toEqual(['a', 'r', 'w']);
    expect([...scopeIds(edges, 'a', 'line')].sort()).toEqual(['a', 'f', 'k', 'r', 'w']);
    expect([...scopeIds(edges, 'r', 'line')].sort()).toEqual(['a', 'f', 'k', 'r']);
  });
  it('derives siblings from shared parents', () => {
    expect(siblingsOf(edges, 'a')).toEqual(['m']);
  });
  it('rejects cycles, duplicates and a third biological parent', () => {
    expect(checkParentLink(edges, 'r', 'k', 'BIOLOGICAL')).toBe('CYCLE');
    expect(checkParentLink(edges, 'k', 'a', 'BIOLOGICAL')).toBe('DUPLICATE');
    expect(checkParentLink(edges, 'x', 'a', 'BIOLOGICAL')).toBe('TOO_MANY_BIOLOGICAL_PARENTS');
    expect(checkParentLink(edges, 'x', 'a', 'STEP')).toBeNull();
    expect(checkParentLink(edges, 'a', 'a', 'BIOLOGICAL')).toBe('SELF');
  });
  it('numbers generations and seats married-in spouses beside their partner', () => {
    const g = generations(edges, ['k', 'f', 'a', 'm', 'r', 'w']);
    expect([g.get('k'), g.get('f'), g.get('a'), g.get('w'), g.get('r')]).toEqual([0, 0, 1, 1, 2]);
  });
});
