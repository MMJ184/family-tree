import {
  type BusinessRole,
  type BusinessStatus,
  type BusinessType,
  businessStatus,
  businessType,
  type EffectiveRole,
  normalizeSearch,
  type Person,
} from '@family-tree/shared';
import { Button, cn, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@family-tree/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, CalendarDays, MapPin, Plus, Search, SearchX, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ErrorState } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PageHeader } from '#/components/shared/PageHeader.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { businessAltName, businessName, businessTypeColor } from '#/entities/business/display.ts';
import { type BusinessWithPeople, useBusinesses } from '#/entities/business/queries.ts';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { canEdit } from '#/entities/session/queries.ts';
import { personName } from '#/lib/display.ts';
import { BusinessFormSheet } from './BusinessForm.tsx';
import { BusinessLogo, StatusBadge, TYPE_ICONS, TypeBadge, useCityLabel, useTypeLabel } from './parts.tsx';

/** URL search params of the directory, so "businesses in Dubai" is a shareable link. */
export const directorySearch = z.object({
  q: z.string().optional().catch(undefined),
  type: businessType.optional().catch(undefined),
  city: z.string().optional().catch(undefined),
  status: businessStatus.optional().catch(undefined),
  person: z.string().optional().catch(undefined),
  view: z.enum(['businesses', 'members']).optional().catch(undefined),
});
export type DirectorySearch = z.infer<typeof directorySearch>;

const ALL = '__all';

interface BusinessDirectoryProps {
  familyId: string;
  role: EffectiveRole | null;
  search: DirectorySearch;
  onSearch: (patch: Partial<DirectorySearch>) => void;
}

export function BusinessDirectory({ familyId, role, search, onSearch }: BusinessDirectoryProps) {
  const { t, i18n } = useTranslation('business');
  const typeLabel = useTypeLabel();
  const cityLabel = useCityLabel();
  const admin = canEdit(role);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  // Search box: typed locally, pushed to the URL after a short pause.
  const [qInput, setQInput] = useState(search.q ?? '');
  // Follow the URL (back button, "clear filters") without eating a trailing space while typing.
  useEffect(() => setQInput((cur) => (cur.trim() === (search.q ?? '') ? cur : (search.q ?? ''))), [search.q]);
  useEffect(() => {
    const next = qInput.trim() || undefined;
    if (next === search.q) return;
    const timer = setTimeout(() => onSearch({ q: next }), 250);
    return () => clearTimeout(timer);
  }, [qInput, search.q, onSearch]);

  const all = useBusinesses(familyId);
  // City names are stored as typed (mostly English); let "دبي" find "Dubai".
  const apiQ = useMemo(() => {
    if (!search.q) return undefined;
    let q = normalizeSearch(search.q);
    const cities = i18n.getResource(i18n.language, 'business', 'cities') as Record<string, string> | undefined;
    for (const [stored, label] of Object.entries(cities ?? {})) {
      const l = normalizeSearch(label);
      if (l && l !== normalizeSearch(stored) && q.includes(l)) q = q.replace(l, stored);
    }
    return q;
  }, [search.q, i18n]);
  const results = useBusinesses(familyId, {
    q: apiQ,
    type: search.type,
    city: search.city,
    status: search.status,
    personId: search.person,
  });
  const graph = useFamilyGraph(familyId);

  const stats = useMemo(() => {
    const list = all.data ?? [];
    const byType = new Map<BusinessType, number>();
    const cities = new Map<string, string>();
    const members = new Set<string>();
    for (const { business: b, people } of list) {
      byType.set(b.type, (byType.get(b.type) ?? 0) + 1);
      if (b.city) cities.set(b.city.trim().toLowerCase(), b.city.trim());
      for (const lp of people) members.add(lp.person.id);
    }
    return {
      total: list.length,
      active: list.filter((x) => x.business.status === 'ACTIVE').length,
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
      cities: [...cities.values()].sort((a, b) => cityLabel(a).localeCompare(cityLabel(b), i18n.language)),
      members: members.size,
    };
  }, [all.data, cityLabel, i18n.language]);

  const filterPerson = search.person ? graph.data?.people.find((p) => p.id === search.person) : undefined;
  const hasFilters = Boolean(search.q || search.type || search.city || search.status || search.person);
  const view = search.view ?? 'businesses';

  if (all.isPending) return <LoadingState />;
  if (all.error) return <ErrorState error={all.error} />;

  const list = results.data ?? [];
  const heading =
    view === 'members'
      ? search.type
        ? t('membersIn', { type: t(`types.${search.type}`) })
        : search.city
          ? t('membersInCity', { city: cityLabel(search.city) })
          : t('membersAll')
      : search.city
        ? t('businessesIn', { city: cityLabel(search.city) })
        : search.type
          ? t(`types.${search.type}`)
          : t('views.businesses');

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { count: stats.total })}
        actions={
          admin && (
            <Button onClick={() => setCreating(true)} className="rounded-full shadow-md">
              <Plus className="size-4" aria-hidden />
              {t('add')}
            </Button>
          )
        }
      />

      {/* Summary strip */}
      <section className="mb-6 grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          <Stat icon={Building2} label={t('summary.total')} value={stats.total} />
          <Stat icon={CalendarDays} label={t('summary.active')} value={stats.active} />
          <Stat icon={MapPin} label={t('summary.cities')} value={stats.cities.length} />
          <Stat icon={Users} label={t('summary.members')} value={stats.members} />
        </div>
        <div className="glass min-w-0 rounded-2xl p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t('summary.title')}</h2>
          <div className="flex flex-wrap gap-2">
            {stats.byType.map(([type, count]) => {
              const Icon = TYPE_ICONS[type];
              const active = search.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSearch({ type: active ? undefined : type })}
                  className={cn(
                    'group flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                    active ? 'border-transparent text-white shadow-md' : 'border-border bg-card',
                  )}
                  style={active ? { background: businessTypeColor(type) } : undefined}
                >
                  <Icon
                    className="size-4"
                    style={active ? undefined : { color: businessTypeColor(type) }}
                    aria-hidden
                  />
                  <span className="font-medium">{t(`types.${type}`)}</span>
                  <span
                    className={cn(
                      'ltr-isolate min-w-5 rounded-full px-1.5 text-center text-xs font-bold tabular-nums',
                      active ? 'bg-white/25' : 'bg-muted',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            {stats.byType.length === 0 && <p className="text-sm text-muted-foreground">{t('noneYet')}</p>}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="glass sticky top-[calc(var(--topbar-height)+0.5rem)] z-10 mb-5 flex flex-wrap items-center gap-2 rounded-2xl p-2 shadow-sm">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-10 w-full rounded-full border border-input bg-card ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <FilterSelect
          label={t('filters.type')}
          value={search.type}
          allLabel={t('filters.allTypes')}
          options={businessType.options.map((v) => ({ value: v, label: t(`types.${v}`) }))}
          onChange={(v) => onSearch({ type: v as BusinessType | undefined })}
        />
        <FilterSelect
          label={t('filters.city')}
          value={search.city}
          allLabel={t('filters.allCities')}
          options={stats.cities.map((c) => ({ value: c, label: cityLabel(c) }))}
          onChange={(v) => onSearch({ city: v })}
        />
        <FilterSelect
          label={t('filters.status')}
          value={search.status}
          allLabel={t('filters.allStatuses')}
          options={businessStatus.options.map((v) => ({ value: v, label: t(`status.${v}`) }))}
          onChange={(v) => onSearch({ status: v as BusinessStatus | undefined })}
        />
        <div className="flex rounded-full bg-muted p-0.5" role="tablist" aria-label={t('filters.label')}>
          {(['businesses', 'members'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => onSearch({ view: v === 'businesses' ? undefined : v })}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                view === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'businesses' ? (
                <Building2 className="size-4" aria-hidden />
              ) : (
                <Users className="size-4" aria-hidden />
              )}
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-semibold">{heading}</h2>
        <span className="text-sm text-muted-foreground">
          {view === 'members'
            ? t('membersCount', { count: membersOf(list).length })
            : t('results', { count: list.length })}
        </span>
        {filterPerson && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            {t('filters.linkedTo', { name: personName(filterPerson, i18n.language) })}
            <button type="button" onClick={() => onSearch({ person: undefined })} aria-label={t('filters.clear')}>
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto rounded-full"
            onClick={() => {
              setQInput('');
              onSearch({ q: undefined, type: undefined, city: undefined, status: undefined, person: undefined });
            }}
          >
            <X className="size-4" aria-hidden />
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {results.error ? (
        <ErrorState error={results.error} />
      ) : list.length === 0 && !results.isPending ? (
        <Empty
          title={stats.total === 0 ? t('noneYet') : view === 'members' ? t('noMembersMatch') : t('empty')}
          body={stats.total === 0 ? t('noneYetBody') : t('emptyBody')}
        />
      ) : view === 'members' ? (
        <MembersGrid familyId={familyId} list={list} />
      ) : (
        <motion.ul
          layout
          className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', results.isFetching && 'opacity-70')}
        >
          <AnimatePresence initial={false}>
            {list.map((item, i) => (
              <motion.li
                key={item.business.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.03 } }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <BusinessCard familyId={familyId} item={item} typeLabel={typeLabel} cityLabel={cityLabel} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {admin && (
        <BusinessFormSheet
          familyId={familyId}
          open={creating}
          onOpenChange={setCreating}
          onSaved={(businessId) =>
            void navigate({ to: '/f/$familyId/businesses/$businessId', params: { familyId, businessId } })
          }
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm lg:min-w-44">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="ltr-isolate font-display text-2xl leading-none font-bold tabular-nums">{value}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-10 w-auto min-w-0 flex-1 basis-36 rounded-full bg-card sm:flex-none sm:basis-auto sm:min-w-36',
          value && 'border-primary text-primary',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden />
      <h3 className="font-display text-xl">{title}</h3>
      <p className="max-w-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function BusinessCard({
  familyId,
  item,
  typeLabel,
  cityLabel,
}: {
  familyId: string;
  item: BusinessWithPeople;
  typeLabel: ReturnType<typeof useTypeLabel>;
  cityLabel: ReturnType<typeof useCityLabel>;
}) {
  const { t, i18n } = useTranslation('business');
  const { business: b, people } = item;
  const name = businessName(b, i18n.language);
  const alt = businessAltName(b, i18n.language);
  const shown = people.slice(0, 4);
  return (
    <Link
      to="/f/$familyId/businesses/$businessId"
      params={{ familyId, businessId: b.id }}
      aria-label={`${name} · ${typeLabel(b)}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 text-card-foreground no-underline shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        className="pointer-events-none absolute -end-16 -top-16 size-40 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-100"
        style={{ background: businessTypeColor(b.type, 0.18) }}
        aria-hidden
      />
      <div className="relative flex items-start gap-4">
        <BusinessLogo business={b} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg leading-tight font-semibold">{name}</h3>
          {alt && <p className="truncate text-sm text-muted-foreground">{alt}</p>}
          <TypeBadge business={b} className="mt-2" />
        </div>
      </div>

      {b.description && <p className="relative mt-4 line-clamp-2 text-sm text-muted-foreground">{b.description}</p>}

      <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {b.city && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" aria-hidden />
            {cityLabel(b.city)}
          </span>
        )}
        {b.startedYear != null && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            <span>
              {t('founded')} <span className="ltr-isolate tabular-nums">{b.startedYear}</span>
            </span>
          </span>
        )}
        <StatusBadge status={b.status} />
      </div>

      <div className="relative mt-auto flex items-center gap-3 border-t border-border pt-4">
        {people.length > 0 ? (
          <>
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {shown.map(({ person: p }) => (
                <PersonAvatar
                  key={p.id}
                  photoUrl={p.photoUrl}
                  gender={p.gender}
                  name={personName(p, i18n.language)}
                  isLiving={p.isLiving}
                  size={30}
                  className="border-2 border-card"
                />
              ))}
              {people.length > shown.length && (
                <span className="ltr-isolate relative inline-flex size-[30px] items-center justify-center rounded-full border-2 border-card bg-muted text-[11px] font-bold">
                  {t('moreMembers', { count: people.length - shown.length })}
                </span>
              )}
            </div>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {people
                .slice(0, 2)
                .map(({ person }) => personName(person, i18n.language).split(' ')[0])
                .join(i18n.language === 'ar' ? '، ' : ', ')}
              {people.length > 2 && ` ${t('moreMembers', { count: people.length - 2 })}`}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{t('noMembers')}</span>
        )}
      </div>
    </Link>
  );
}

interface MemberRow {
  person: Person;
  items: Array<{ business: BusinessWithPeople['business']; role: BusinessRole | null }>;
}

function membersOf(list: BusinessWithPeople[]): MemberRow[] {
  const byPerson = new Map<string, MemberRow>();
  for (const { business, people } of list) {
    for (const { person, role } of people) {
      const row = byPerson.get(person.id) ?? { person, items: [] };
      row.items.push({ business, role });
      byPerson.set(person.id, row);
    }
  }
  return [...byPerson.values()].sort((a, b) => b.items.length - a.items.length);
}

function MembersGrid({ familyId, list }: { familyId: string; list: BusinessWithPeople[] }) {
  const { t, i18n } = useTranslation('business');
  const rows = membersOf(list);
  if (rows.length === 0) return <Empty title={t('noMembersMatch')} body={t('emptyBody')} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(({ person, items }, i) => (
        <motion.li
          key={person.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.025 } }}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <Link
            to="/f/$familyId/people/$personId"
            params={{ familyId, personId: person.id }}
            className="flex items-center gap-3 text-foreground no-underline hover:text-primary"
          >
            <PersonAvatar
              photoUrl={person.photoUrl}
              gender={person.gender}
              name={personName(person, i18n.language)}
              isLiving={person.isLiving}
              size={44}
            />
            <span className="min-w-0 truncate font-semibold">{personName(person, i18n.language)}</span>
          </Link>
          <ul className="flex flex-col gap-1.5">
            {items.map(({ business, role }) => (
              <li key={business.id}>
                <Link
                  to="/f/$familyId/businesses/$businessId"
                  params={{ familyId, businessId: business.id }}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent"
                >
                  <BusinessLogo business={business} size={26} className="rounded-lg" />
                  <span className="min-w-0 flex-1 truncate">{businessName(business, i18n.language)}</span>
                  {role && <span className="shrink-0 text-xs text-muted-foreground">{t(`roles.${role}`)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </motion.li>
      ))}
    </ul>
  );
}
