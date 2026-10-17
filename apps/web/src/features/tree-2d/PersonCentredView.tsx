import {
  type Edges,
  type FamilyGraph,
  type Marriage,
  type Person,
  parentsOf,
  partialYear,
  siblingsOf,
} from '@family-tree/shared';
import { Link } from '@tanstack/react-router';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Briefcase, ExternalLink, Info, MapPin } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeViewProps } from '#/entities/tree/types.ts';
import { personName } from '#/lib/display.ts';
import { buildModel, hasBusinessBy } from './model.ts';
import { PersonCard } from './PersonCard.tsx';

type RelKey =
  | 'father'
  | 'mother'
  | 'parent'
  | 'husband'
  | 'wife'
  | 'spouse'
  | 'exHusband'
  | 'exWife'
  | 'exSpouse'
  | 'lateHusband'
  | 'lateWife'
  | 'brother'
  | 'sister'
  | 'sibling'
  | 'halfBrother'
  | 'halfSister'
  | 'halfSibling'
  | 'son'
  | 'daughter'
  | 'child';

const byGender = (p: Person, male: RelKey, female: RelKey, other: RelKey): RelKey =>
  p.gender === 'MALE' ? male : p.gender === 'FEMALE' ? female : other;

function spouseRel(p: Person, m: Marriage): RelKey {
  if (m.status === 'DIVORCED') return byGender(p, 'exHusband', 'exWife', 'exSpouse');
  if (!p.isLiving) return byGender(p, 'lateHusband', 'lateWife', 'spouse');
  return byGender(p, 'husband', 'wife', 'spouse');
}

interface Rel {
  person: Person;
  rel: RelKey;
}

/** The person the view opens on when nothing is selected: the earliest-born member born into the family. */
function defaultFocus(graph: FamilyGraph): Person | null {
  const born = new Set(graph.memberships.filter((m) => m.membership === 'BORN').map((m) => m.personId));
  const pool = graph.people.filter((p) => born.has(p.id));
  const list = pool.length ? pool : graph.people;
  return [...list].sort((a, b) => (partialYear(a.birth) ?? 9999) - (partialYear(b.birth) ?? 9999))[0] ?? null;
}

export function PersonCentredView({ graph, selectedId, onSelect, year }: TreeViewProps) {
  const { t, i18n } = useTranslation('tree2d');
  const locale = i18n.language;
  const model = useMemo(() => buildModel(graph), [graph]);
  const fallback = useMemo(() => defaultFocus(graph), [graph]);
  const focus = (selectedId ? model.people.get(selectedId) : undefined) ?? fallback;

  const rels = useMemo(() => {
    if (!focus) return null;
    const edges: Edges = { parentChild: graph.parentChild, marriages: graph.marriages };
    const shown = (p: Person | undefined): p is Person => {
      if (!p) return false;
      const b = partialYear(p.birth);
      return year == null || b == null || b <= year;
    };
    const used = new Set<string>([focus.id]);
    const take = (p: Person | undefined): p is Person => {
      if (!shown(p) || used.has(p.id)) return false;
      used.add(p.id);
      return true;
    };
    const birth = (p: Person) => partialYear(p.birth) ?? 9999;

    const parentIds = parentsOf(edges, focus.id);
    const parents: Rel[] = parentIds
      .map((id) => model.people.get(id))
      .filter(take)
      .sort((a, b) => Number(a.gender === 'FEMALE') - Number(b.gender === 'FEMALE'))
      .map((p) => ({ person: p, rel: byGender(p, 'father', 'mother', 'parent') }));

    const spouses: Rel[] = graph.marriages
      .filter((m) => m.personAId === focus.id || m.personBId === focus.id)
      .filter((m) => year == null || (partialYear(m.startDate) ?? 0) <= year)
      .sort((a, b) => (partialYear(a.startDate) ?? 9999) - (partialYear(b.startDate) ?? 9999))
      .flatMap((m) => {
        const p = model.people.get(m.personAId === focus.id ? m.personBId : m.personAId);
        return take(p) ? [{ person: p, rel: spouseRel(p, m) }] : [];
      });

    const mine = new Set(parentIds);
    const siblings: Rel[] = siblingsOf(edges, focus.id)
      .map((id) => model.people.get(id))
      .filter(take)
      .sort((a, b) => birth(a) - birth(b))
      .map((p) => {
        const theirs = parentsOf(edges, p.id);
        const half = theirs.length !== mine.size || theirs.some((x) => !mine.has(x));
        return {
          person: p,
          rel: half
            ? byGender(p, 'halfBrother', 'halfSister', 'halfSibling')
            : byGender(p, 'brother', 'sister', 'sibling'),
        };
      });

    const children: Rel[] = graph.parentChild
      .filter((e) => e.parentId === focus.id)
      .map((e) => model.people.get(e.childId))
      .filter(take)
      .sort((a, b) => birth(a) - birth(b))
      .map((p) => ({ person: p, rel: byGender(p, 'son', 'daughter', 'child') }));

    return { parents, spouses, siblings, children };
  }, [focus, graph, model, year]);

  if (!focus || !rels) {
    return <div className="grid h-full place-items-center p-6 text-muted-foreground">{t('empty')}</div>;
  }

  const focusBorn = partialYear(focus.birth);
  const card = (r: Rel) => (
    <PersonCard
      key={r.person.id}
      layoutId={r.person.id}
      person={r.person}
      label={t(`rel.${r.rel}`)}
      marriedIn={model.marriedIn.has(r.person.id)}
      business={hasBusinessBy(model, r.person.id, year)}
      onClick={() => onSelect(r.person.id)}
    />
  );

  const businesses = graph.personBusiness
    .filter((pb) => pb.personId === focus.id)
    .map((pb) => graph.businesses.find((b) => b.id === pb.businessId))
    .filter((b) => b != null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-20 pb-32 sm:px-6">
        {!selectedId && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass mx-auto flex max-w-2xl items-start gap-2 rounded-2xl px-4 py-3 text-sm text-muted-foreground shadow-sm"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t('person.defaultHint', { name: personName(focus, locale) })}
          </motion.p>
        )}
        {year != null && focusBorn != null && focusBorn > year && (
          <p className="mx-auto rounded-full bg-warning/15 px-4 py-1.5 text-xs text-warning-text">
            {t('person.notBornYet', { name: personName(focus, locale), year })}
          </p>
        )}

        <LayoutGroup>
          <Section title={t('sections.parents')} empty={t('person.noParents')} count={rels.parents.length} center>
            {rels.parents.map(card)}
          </Section>

          <Connector />

          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(20rem,26rem)_1fr] lg:items-start">
            <Section
              title={t('sections.siblings')}
              empty={t('person.noSiblings')}
              count={rels.siblings.length}
              className="order-2 lg:order-none"
              stack
            >
              {rels.siblings.map(card)}
            </Section>

            <div className="order-1 flex flex-col gap-3 lg:order-none">
              <PersonCard
                key={focus.id}
                layoutId={focus.id}
                person={focus}
                size="lg"
                selected
                marriedIn={model.marriedIn.has(focus.id)}
                business={hasBusinessBy(model, focus.id, year)}
                onClick={() => onSelect(focus.id)}
              />
              <motion.div
                key={`details-${focus.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass flex flex-col gap-2 rounded-2xl p-4 text-sm"
              >
                {focus.occupation && (
                  <Detail icon={<Briefcase className="size-4" aria-hidden />} label={t('person.occupation')}>
                    {focus.occupation}
                  </Detail>
                )}
                {focus.currentCity && (
                  <Detail icon={<MapPin className="size-4" aria-hidden />} label={t('person.city')}>
                    {focus.currentCity}
                  </Detail>
                )}
                {businesses.length > 0 && (
                  <Detail icon={<Briefcase className="size-4 text-gold" aria-hidden />} label={t('person.businesses')}>
                    {businesses
                      .map((b) => (locale === 'ar' ? b.nameAr || b.name : b.name))
                      .join(locale === 'ar' ? '، ' : ', ')}
                  </Detail>
                )}
                <Link
                  to="/f/$familyId/people/$personId"
                  params={{ familyId: graph.family.id, personId: focus.id }}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
                >
                  <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden />
                  {t('person.openProfile')}
                </Link>
              </motion.div>
            </div>

            <Section
              title={t('sections.spouses')}
              empty={t('person.noSpouses')}
              count={rels.spouses.length}
              className="order-3 lg:order-none"
              stack
            >
              {rels.spouses.map(card)}
            </Section>
          </div>

          <Connector />

          <Section title={t('sections.children')} empty={t('person.noChildren')} count={rels.children.length} center>
            {rels.children.map(card)}
          </Section>
        </LayoutGroup>
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  count,
  children,
  center = false,
  stack = false,
  className,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
  center?: boolean;
  stack?: boolean;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3
        className={`mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground ${center ? 'justify-center' : ''}`}
      >
        {title}
        {count > 0 && (
          <span className="ltr-isolate rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{count}</span>
        )}
      </h3>
      {count === 0 ? (
        <p
          className={`rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground ${center ? 'mx-auto w-fit' : ''}`}
        >
          {empty}
        </p>
      ) : (
        <div
          className={
            stack
              ? 'flex flex-col gap-2.5'
              : 'mx-auto grid w-full max-w-4xl grid-cols-[repeat(auto-fit,minmax(13rem,15rem))] justify-center gap-2.5'
          }
        >
          <AnimatePresence mode="popLayout">{children}</AnimatePresence>
        </div>
      )}
    </section>
  );
}

function Connector() {
  return <div className="mx-auto h-5 w-px bg-gradient-to-b from-border via-primary/40 to-border" aria-hidden />;
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">{label}</span>
        <span className="block">{children}</span>
      </span>
    </div>
  );
}
