import { type FamilyGraph, formatPartialDate, type Person, partialYear } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Box,
  Building2,
  Cake,
  GitFork,
  HeartHandshake,
  Hourglass,
  Layers,
  MapPin,
  Network,
  Sparkles,
  User,
  UserPlus,
  Users,
  Waypoints,
} from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { familyName, personName } from '#/lib/display.ts';
import { computeStats } from './stats.ts';

const VIEWS = [
  { view: 'tree', icon: GitFork },
  { view: 'person', icon: User },
  { view: 'generation', icon: Layers },
  { view: 'graph', icon: Waypoints },
  { view: 'mindmap', icon: Network },
  { view: 'studio', icon: Box },
] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.05 * i, ease: 'easeOut' as const } }),
};

function Card({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <motion.section
      custom={i}
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className={cn('glass rounded-2xl p-5 shadow-sm', className)}
    >
      {children}
    </motion.section>
  );
}

function CardTitle({ icon: Icon, children, action }: { icon: typeof Users; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="size-4.5 text-gold" aria-hidden />
      <h2 className="font-display text-base font-bold">{children}</h2>
      {action && <div className="ms-auto">{action}</div>}
    </div>
  );
}

interface FamilyOverviewProps {
  graph: FamilyGraph;
  /** Extra hero buttons the route adds for admins (e.g. edit family). */
  heroActions?: ReactNode;
}

/** The family's home page: who they are, how big, what's coming up, and the way into the tree. */
export function FamilyOverview({ graph, heroActions }: FamilyOverviewProps) {
  const { t, i18n } = useTranslation(['overview', 'tree', 'common']);
  const lang = i18n.language;
  const { family } = graph;
  const stats = useMemo(() => computeStats(graph), [graph]);
  const familyId = family.id;
  const otherName = lang === 'ar' ? family.name : family.nameAr;
  const name = familyName(family, lang);
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(`${lang}-u-nu-latn`, { numeric: 'auto' }), [lang]);
  const monthDay = useMemo(
    () => new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { month: 'short', day: 'numeric' }),
    [lang],
  );
  const maxGen = Math.max(1, ...stats.perGeneration.map((x) => x.count));

  const statCards = [
    { key: 'people', icon: Users, value: stats.people, hint: t('stats.peopleHint') },
    { key: 'living', icon: Sparkles, value: stats.living, hint: t('stats.livingHint', { deceased: stats.deceased }) },
    { key: 'generations', icon: Layers, value: stats.generationCount, hint: t('stats.generationsHint') },
    {
      key: 'businesses',
      icon: Building2,
      value: stats.businesses,
      hint: t('stats.businessesHint', { active: stats.activeBusinesses }),
    },
    { key: 'marriedIn', icon: HeartHandshake, value: stats.marriedIn, hint: t('stats.marriedInHint') },
  ] as const;

  const personLink = (p: Person, children: ReactNode) => (
    <Link
      to="/f/$familyId/people/$personId"
      params={{ familyId, personId: p.id }}
      className="flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-foreground no-underline transition-colors hover:bg-accent"
    >
      {children}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      {/* Hero */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative mb-6 overflow-hidden rounded-3xl shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${family.color} 0%, color-mix(in oklab, ${family.color} 50%, #000000) 100%)`,
        }}
      >
        <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.14]" aria-hidden="true">
          <defs>
            <pattern id="ov-dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="13" cy="13" r="1.5" fill="#fff" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ov-dots)" />
        </svg>
        <GitFork
          className="pointer-events-none absolute -bottom-10 end-4 size-56 rotate-180 text-white/10 sm:size-72"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 p-6 text-white sm:p-8 lg:p-10">
          <span className="text-xs font-semibold tracking-wider text-white/75 uppercase">{t('kicker')}</span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">{name}</h1>
            {otherName && otherName !== name && (
              <p className="mt-1 text-lg text-white/75" lang={lang === 'ar' ? 'en' : 'ar'}>
                {otherName}
              </p>
            )}
          </div>
          {family.description && (
            <p className="max-w-2xl leading-relaxed text-white/85">
              <bdi>{family.description}</bdi>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {family.surname && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-sm backdrop-blur">
                <span className="text-white/70">{t('surname')}: </span>
                {family.surname}
              </span>
            )}
            {family.nativePlace && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm backdrop-blur">
                <MapPin className="size-3.5" aria-hidden />
                <span className="text-white/70">{t('nativePlace')}: </span>
                {family.nativePlace}
              </span>
            )}
            <div className="flex-1" />
            <div className="flex flex-wrap gap-2">
              {heroActions}
              <Link
                to="/f/$familyId/tree"
                params={{ familyId }}
                search={{ view: 'tree' }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-[#0a0a0a] no-underline shadow transition hover:bg-white/90"
              >
                <GitFork className="size-4" aria-hidden />
                {t('openTree.title')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((s, i) => (
          <Card key={s.key} i={i + 1} className={cn('p-4', i === 4 && 'col-span-2 sm:col-span-1')}>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <s.icon className="size-4 text-primary" aria-hidden />
              {t(`stats.${s.key}`)}
            </div>
            <div className="ltr-isolate mt-1.5 font-display text-3xl font-bold tabular-nums">
              {s.value.toLocaleString('en')}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.hint}</div>
          </Card>
        ))}
      </div>

      {stats.people === 0 && (
        <Card i={6} className="mb-6 text-center text-muted-foreground">
          {t('emptyFamily')}
        </Card>
      )}

      {/* Quick links into the tree views */}
      <Card i={6} className="mb-6">
        <CardTitle icon={GitFork}>{t('openTree.title')}</CardTitle>
        <p className="-mt-3 mb-4 text-sm text-muted-foreground">{t('openTree.subtitle')}</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {VIEWS.map(({ view, icon: Icon }) => (
            <Link
              key={view}
              to="/f/$familyId/tree"
              params={{ familyId }}
              search={{ view }}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3 text-foreground no-underline transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="text-sm font-semibold">{t(`tree:views.${view}`)}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{t(`tree:viewHints.${view}`)}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Generations: one bar per generation; the row follows the reading direction, so in Arabic the earliest is on the right. */}
        <Card i={7} className="lg:col-span-2">
          <CardTitle icon={Layers}>{t('generations.title')}</CardTitle>
          <p className="-mt-3 mb-4 text-sm text-muted-foreground">{t('generations.subtitle')}</p>
          <div
            className="flex h-44 items-end gap-2 border-b border-border px-1"
            role="img"
            aria-label={t('generations.table')}
          >
            {stats.perGeneration.map(({ gen: g, count }) => (
              <div
                key={g}
                className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={t('generations.tooltip', { n: g + 1, count })}
              >
                <span className="ltr-isolate text-xs font-semibold tabular-nums text-muted-foreground group-hover:text-foreground">
                  {count}
                </span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(count / maxGen) * 100}%` }}
                  transition={{ duration: 0.6, delay: 0.3 + g * 0.06, ease: 'easeOut' }}
                  className="w-full max-w-12 rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ minHeight: count ? 3 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 px-1">
            {stats.perGeneration.map(({ gen: g }) => (
              <span key={g} className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
                {t('generations.label', { n: g + 1 })}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <caption>{t('generations.table')}</caption>
            <tbody>
              {stats.perGeneration.map(({ gen: g, count }) => (
                <tr key={g}>
                  <th scope="row">{t('generations.label', { n: g + 1 })}</th>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Oldest living member */}
        <Card i={8}>
          <CardTitle icon={Hourglass}>{t('oldest.title')}</CardTitle>
          {stats.oldestLiving ? (
            <Link
              to="/f/$familyId/people/$personId"
              params={{ familyId, personId: stats.oldestLiving.id }}
              className="flex flex-col items-center gap-3 rounded-xl p-3 text-center text-foreground no-underline transition-colors hover:bg-accent"
            >
              <PersonAvatar
                photoUrl={stats.oldestLiving.photoUrl}
                gender={stats.oldestLiving.gender}
                name={personName(stats.oldestLiving, lang)}
                size={88}
              />
              <div>
                <div className="font-display text-lg font-bold">{personName(stats.oldestLiving, lang)}</div>
                <div className="text-sm text-muted-foreground">
                  {t('oldest.born', {
                    date: formatPartialDate(stats.oldestLiving.birth, lang, t('common:dates.approx')),
                  })}
                </div>
              </div>
              <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold text-gold">
                {t('common:dates.age', {
                  age: new Date().getFullYear() - (partialYear(stats.oldestLiving.birth) ?? 0),
                })}
              </span>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{t('oldest.empty')}</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming birthdays (only full dates) */}
        <Card i={9}>
          <CardTitle icon={Cake}>{t('birthdays.title')}</CardTitle>
          {stats.birthdays.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('birthdays.empty')}</p>
          ) : (
            <ul className="grid gap-1">
              {stats.birthdays.map((b) => (
                <li key={b.person.id}>
                  {personLink(
                    b.person,
                    <>
                      <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-primary/10 py-1 text-primary">
                        <span className="text-[10px] font-semibold uppercase">
                          {monthDay.formatToParts(b.date).find((p) => p.type === 'month')?.value}
                        </span>
                        <span className="ltr-isolate text-base leading-none font-bold">{b.date.getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{personName(b.person, lang)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {rtf.format(b.inDays, 'day')} · {t('birthdays.turns', { age: b.turns })}
                        </span>
                      </span>
                    </>,
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent additions */}
        <Card i={10}>
          <CardTitle icon={UserPlus}>{t('recent.title')}</CardTitle>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('recent.empty')}</p>
          ) : (
            <ul className="grid gap-1">
              {stats.recent.map((r) => (
                <li key={r.person.id}>
                  {personLink(
                    r.person,
                    <>
                      <PersonAvatar
                        photoUrl={r.person.photoUrl}
                        gender={r.person.gender}
                        name={personName(r.person, lang)}
                        isLiving={r.person.isLiving}
                        size={36}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{personName(r.person, lang)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.addedAt
                            ? t('recent.added', { when: relativeDays(rtf, r.addedAt) })
                            : t('recent.born', { year: partialYear(r.person.birth) })}
                        </span>
                      </span>
                    </>,
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Businesses teaser */}
        <Card i={11}>
          <CardTitle
            icon={Building2}
            action={
              graph.businesses.length > 0 && (
                <Link
                  to="/f/$familyId/businesses"
                  params={{ familyId }}
                  className="inline-flex items-center gap-1 text-sm font-medium"
                >
                  {t('common:actions.viewAll')}
                  <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              )
            }
          >
            {t('businesses.title')}
          </CardTitle>
          {graph.businesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('businesses.empty')}</p>
          ) : (
            <ul className="grid gap-1">
              {graph.businesses.slice(0, 4).map((b) => (
                <li key={b.id}>
                  <Link
                    to="/f/$familyId/businesses/$businessId"
                    params={{ familyId, businessId: b.id }}
                    className="flex min-w-0 items-center gap-3 rounded-xl p-1.5 text-foreground no-underline transition-colors hover:bg-accent"
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-bold text-white"
                      style={{ background: family.color }}
                    >
                      {b.logoUrl ? (
                        <img src={b.logoUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <Building2 className="size-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{(lang === 'ar' && b.nameAr) || b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[b.city, b.startedYear ? t('businesses.since', { year: b.startedYear }) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        b.status === 'ACTIVE' ? 'bg-success/15 text-success-text' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {t(`businesses.${b.status}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function relativeDays(rtf: Intl.RelativeTimeFormat, date: Date): string {
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (Math.abs(days) < 1) {
    const hours = Math.round((date.getTime() - Date.now()) / 3_600_000);
    return Math.abs(hours) < 1 ? rtf.format(0, 'minute') : rtf.format(hours, 'hour');
  }
  return rtf.format(days, 'day');
}
