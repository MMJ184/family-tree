import {
  type FamilyGraph,
  generations,
  type Membership,
  matchesSearch,
  type Person,
  partialYear,
} from '@family-tree/shared';
import { Button, cn, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  GitFork,
  LayoutGrid,
  MapPin,
  Rows3,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '#/components/shared/PageHeader.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { familyName, personName, personYears } from '#/lib/display.ts';
import { downloadCsv, fileSlug } from './csv.ts';
import { formatDate, otherScriptName, useFamilyRole } from './format.ts';
import { PersonFormSheet } from './PersonFormSheet.tsx';

interface Row {
  person: Person;
  name: string;
  generation: number;
  membership: Membership;
  city: string | null;
  birthYear: number | null;
}

type Status = 'all' | 'living' | 'deceased';
type ViewMode = 'table' | 'cards';
const PAGE = 60;
const VIEW_KEY = 'ft:people-view';

function readView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'table' || v === 'cards') return v;
  } catch {
    // Storage blocked: use the default.
  }
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'cards' : 'table';
}

/** People page: searchable, sortable, filterable list of a family's members (spec §3.4 list view). */
export function PeopleList({ graph, onAdded }: { graph: FamilyGraph; onAdded?: (id: string) => void }) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const locale = i18n.language;
  const familyId = graph.family.id;
  const { editable } = useFamilyRole(familyId);

  const [query, setQuery] = useState('');
  const [generation, setGeneration] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  const [gender, setGender] = useState('all');
  const [city, setCity] = useState('all');
  const [membership, setMembership] = useState('all');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'generation', desc: false }]);
  const [view, setView] = useState<ViewMode>(readView);
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Ignore: only a convenience.
    }
  }, [view]);

  const rows = useMemo<Row[]>(() => {
    const gen = generations(
      graph,
      graph.people.map((p) => p.id),
    );
    const mem = new Map(graph.memberships.map((m) => [m.personId, m.membership]));
    return graph.people.map((p) => ({
      person: p,
      name: personName(p, locale),
      generation: (gen.get(p.id) ?? 0) + 1,
      membership: mem.get(p.id) ?? 'BORN',
      city: p.currentCity || p.birthPlace,
      birthYear: partialYear(p.birth),
    }));
  }, [graph, locale]);

  const genOptions = useMemo(() => [...new Set(rows.map((r) => r.generation))].sort((a, b) => a - b), [rows]);
  const cityOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.city).filter((c): c is string => Boolean(c)))].sort((a, b) =>
        a.localeCompare(b, locale),
      ),
    [rows, locale],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const p = r.person;
        if (generation !== 'all' && r.generation !== Number(generation)) return false;
        if (status === 'living' && !p.isLiving) return false;
        if (status === 'deceased' && p.isLiving) return false;
        if (gender !== 'all' && p.gender !== gender) return false;
        if (city !== 'all' && p.currentCity !== city && p.birthPlace !== city) return false;
        if (membership !== 'all' && r.membership !== membership) return false;
        return matchesSearch(query, [
          p.nameAr,
          p.nameEn,
          p.firstName,
          p.lastName,
          p.maidenName,
          p.laqab,
          p.kunya,
          p.currentCity,
          p.birthPlace,
          p.occupation,
          r.birthYear != null ? String(r.birthYear) : null,
        ]);
      }),
    [rows, generation, status, gender, city, membership, query],
  );

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: () => t('list.columns.name'),
        sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, locale),
        cell: ({ row }) => {
          const p = row.original.person;
          const alt = otherScriptName(p, locale);
          return (
            <Link
              to="/f/$familyId/people/$personId"
              params={{ familyId, personId: p.id }}
              className="flex min-w-0 items-center gap-3 text-foreground"
            >
              <PersonAvatar
                photoUrl={p.photoUrl}
                gender={p.gender}
                name={row.original.name}
                isLiving={p.isLiving}
                size={36}
              />
              <span className="min-w-0">
                <span className="block truncate font-medium hover:text-primary">{row.original.name}</span>
                {alt && <span className="block truncate text-xs text-muted-foreground">{alt}</span>}
              </span>
            </Link>
          );
        },
      },
      {
        id: 'born',
        accessorFn: (r) => r.person.birth?.value ?? '',
        header: () => t('list.columns.years'),
        sortUndefined: 'last',
        cell: ({ row }) => (
          <span className="ltr-isolate whitespace-nowrap tabular-nums">{personYears(row.original.person) || '—'}</span>
        ),
      },
      {
        id: 'generation',
        accessorFn: (r) => r.generation,
        header: () => t('list.columns.generation'),
        sortingFn: (a, b) =>
          a.original.generation - b.original.generation ||
          (a.original.person.birth?.value ?? '9999').localeCompare(b.original.person.birth?.value ?? '9999'),
        cell: ({ row }) => (
          <span className="inline-grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {row.original.generation}
          </span>
        ),
      },
      {
        id: 'gender',
        accessorFn: (r) => r.person.gender,
        header: () => t('fields.gender'),
        cell: ({ row }) => tc(`gender.${row.original.person.gender}`),
      },
      {
        id: 'status',
        accessorFn: (r) => (r.person.isLiving ? 0 : 1),
        header: () => t('list.columns.status'),
        cell: ({ row }) => <StatusPill living={row.original.person.isLiving} />,
      },
      {
        id: 'city',
        accessorFn: (r) => r.city ?? '',
        header: () => t('list.columns.city'),
        cell: ({ row }) => row.original.city ?? '—',
      },
      {
        id: 'membership',
        accessorFn: (r) => r.membership,
        header: () => t('list.columns.membership'),
        cell: ({ row }) => (
          <span
            className={cn(
              'text-xs font-medium',
              row.original.membership === 'MARRIED_IN' ? 'text-gold' : 'text-muted-foreground',
            )}
          >
            {t(`membership.${row.original.membership}`)}
          </span>
        ),
      },
      {
        id: 'occupation',
        accessorFn: (r) => r.person.occupation ?? '',
        header: () => t('fields.occupation'),
        cell: ({ row }) => <span className="line-clamp-1">{row.original.person.occupation ?? '—'}</span>,
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">{t('list.columns.actions')}</span>,
        cell: ({ row }) => <TreeLink familyId={familyId} personId={row.original.person.id} />,
      },
    ],
    [t, tc, locale, familyId],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const sortedRows = table.getRowModel().rows;
  const visible = sortedRows.slice(0, limit);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging whenever the result set changes.
  useEffect(() => setLimit(PAGE), [query, generation, status, gender, city, membership]);

  const activeFilters =
    [generation, status, gender, city, membership].filter((v) => v !== 'all').length + (query ? 1 : 0);
  const clearFilters = () => {
    setQuery('');
    setGeneration('all');
    setStatus('all');
    setGender('all');
    setCity('all');
    setMembership('all');
  };

  const exportCsv = () => {
    const header = [
      t('csv.nameAr'),
      t('csv.nameEn'),
      t('fields.gender'),
      t('fields.birth'),
      t('fields.death'),
      t('list.columns.status'),
      t('list.columns.generation'),
      t('fields.currentCity'),
      t('fields.birthPlace'),
      t('list.columns.membership'),
      t('fields.occupation'),
      ...(editable ? [t('fields.phone'), t('fields.email')] : []),
    ];
    const data = sortedRows.map(({ original: r }) => {
      const p = r.person;
      return [
        p.nameAr,
        p.nameEn,
        tc(`gender.${p.gender}`),
        formatDate(p.birth, locale, t),
        formatDate(p.death, locale, t),
        p.isLiving ? tc('dates.living') : tc('dates.deceased'),
        r.generation,
        p.currentCity,
        p.birthPlace,
        t(`membership.${r.membership}`),
        p.occupation,
        ...(editable ? [p.phone, p.email] : []),
      ];
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const family = fileSlug(familyName(graph.family, locale)) || fileSlug(t('csv.familyFallback'));
    const fileName = fileSlug(t('csv.fileName', { family, date: stamp }));
    downloadCsv(`${fileName}.csv`, header, data);
  };

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle', { family: familyName(graph.family, locale), count: graph.people.length })}
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={sortedRows.length === 0}>
              <Download /> {t('list.exportCsv')}
            </Button>
            {editable && (
              <Button onClick={() => setCreating(true)}>
                <UserPlus /> {t('actions.addPerson')}
              </Button>
            )}
          </>
        }
      />

      {/* Toolbar */}
      <div className="glass mb-4 space-y-3 rounded-2xl p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-60">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('list.searchPlaceholder')}
              aria-label={t('list.searchPlaceholder')}
              className="h-10 rounded-full bg-card ps-9"
            />
          </div>
          <fieldset className="flex rounded-full border border-border bg-card p-0.5" aria-label={t('list.viewMode')}>
            {(['table', 'cards'] as const).map((m) => {
              const Icon = m === 'table' ? Rows3 : LayoutGrid;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={view === m}
                  title={t(`list.views.${m}`)}
                  onClick={() => setView(m)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                    view === m
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t(`list.views.${m}`)}</span>
                </button>
              );
            })}
          </fieldset>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect
            label={t('list.filters.generation')}
            value={generation}
            onChange={setGeneration}
            options={genOptions.map((g) => ({ value: String(g), label: t('list.generationN', { n: g }) }))}
          />
          <FilterSelect
            label={t('list.filters.status')}
            value={status}
            onChange={(v) => setStatus(v as Status)}
            options={[
              { value: 'living', label: tc('dates.living') },
              { value: 'deceased', label: tc('dates.deceased') },
            ]}
          />
          <FilterSelect
            label={t('list.filters.gender')}
            value={gender}
            onChange={setGender}
            options={(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => ({ value: g, label: tc(`gender.${g}`) }))}
          />
          <FilterSelect
            label={t('list.filters.city')}
            value={city}
            onChange={setCity}
            options={cityOptions.map((c) => ({ value: c, label: c }))}
          />
          <FilterSelect
            label={t('list.filters.membership')}
            value={membership}
            onChange={setMembership}
            options={(['BORN', 'MARRIED_IN'] as const).map((m) => ({ value: m, label: t(`membership.${m}`) }))}
          />
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="col-span-2 sm:col-span-1">
              <X /> {t('list.clearFilters')}
            </Button>
          )}
          <span className="col-span-2 text-sm text-muted-foreground sm:ms-auto">
            {t('list.showing', { shown: sortedRows.length, total: rows.length })}
          </span>
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <div className="glass rounded-2xl px-6 py-16 text-center text-muted-foreground">
          <p>{t('list.noResults')}</p>
          {activeFilters > 0 && (
            <Button variant="link" onClick={clearFilters}>
              {t('list.clearFilters')}
            </Button>
          )}
        </div>
      ) : view === 'table' ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      const canSort = h.column.getCanSort();
                      return (
                        <th
                          key={h.id}
                          className="px-4 py-3 text-start font-semibold"
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        >
                          {canSort ? (
                            <button
                              type="button"
                              onClick={h.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                            >
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3.5" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3.5" />
                              ) : (
                                <ArrowUpDown className="size-3.5 opacity-40" />
                              )}
                            </button>
                          ) : (
                            flexRender(h.column.columnDef.header, h.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-border transition-colors hover:bg-accent/40">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map(({ original: r }, i) => (
            <motion.div
              key={r.person.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.02 }}
            >
              <PersonCard row={r} familyId={familyId} />
            </motion.div>
          ))}
        </div>
      )}

      {sortedRows.length > limit && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
            {t('list.showMore', { count: sortedRows.length - limit })}
          </Button>
        </div>
      )}

      {editable && (
        <PersonFormSheet
          familyId={familyId}
          open={creating}
          onOpenChange={setCreating}
          onSaved={(p) => onAdded?.(p.id)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useTranslation('people');
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-9 w-full rounded-full bg-card sm:w-auto sm:min-w-36',
          value !== 'all' && 'border-primary text-primary',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {label}: {t('list.filters.all')}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusPill({ living }: { living: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        living ? 'bg-success/15 text-success-text' : 'bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', living ? 'bg-success' : 'bg-muted-foreground')} aria-hidden />
      {living ? t('dates.living') : t('dates.deceased')}
    </span>
  );
}

function TreeLink({ familyId, personId }: { familyId: string; personId: string }) {
  const { t } = useTranslation('people');
  return (
    <Button asChild size="sm" variant="ghost" className="text-muted-foreground" title={t('actions.viewInTree')}>
      <Link
        to="/f/$familyId/tree"
        params={{ familyId }}
        search={{ view: 'tree', person: personId }}
        aria-label={t('actions.viewInTree')}
      >
        <GitFork /> <span className="hidden whitespace-nowrap sm:inline">{t('actions.viewInTree')}</span>
      </Link>
    </Button>
  );
}

function PersonCard({ row, familyId }: { row: Row; familyId: string }) {
  const { t, i18n } = useTranslation('people');
  const p = row.person;
  const alt = otherScriptName(p, i18n.language);
  return (
    <div className="group relative flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center gap-3">
        <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={row.name} isLiving={p.isLiving} size={52} />
        <div className="min-w-0 flex-1">
          <Link
            to="/f/$familyId/people/$personId"
            params={{ familyId, personId: p.id }}
            className="block truncate font-display text-base font-semibold text-foreground after:absolute after:inset-0 hover:text-primary"
          >
            {row.name}
          </Link>
          {alt && <p className="truncate text-xs text-muted-foreground">{alt}</p>}
          <p className="ltr-isolate text-sm text-muted-foreground">{personYears(p) || '—'}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="whitespace-nowrap rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">
          {t('list.generationN', { n: row.generation })}
        </span>
        <StatusPill living={p.isLiving} />
        {row.membership === 'MARRIED_IN' && (
          <span className="rounded-full bg-gold/15 px-2 py-0.5 font-medium text-gold">
            {t('membership.MARRIED_IN')}
          </span>
        )}
      </div>
      {(p.occupation || row.city) && (
        <div className="space-y-0.5 text-sm text-muted-foreground">
          {p.occupation && <p className="line-clamp-1">{p.occupation}</p>}
          {row.city && (
            <p className="flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden /> {row.city}
            </p>
          )}
        </div>
      )}
      <div className="relative z-10 mt-auto flex justify-end">
        <TreeLink familyId={familyId} personId={p.id} />
      </div>
    </div>
  );
}
