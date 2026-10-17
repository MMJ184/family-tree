import { childrenOf, type FamilyGraph, type Person, parentsOf, siblingsOf } from '@family-tree/shared';
import { Button } from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Briefcase, Building2, GraduationCap, MapPin, Pencil, UserPlus, UserRound, X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { personName, personYears } from '#/lib/display.ts';
import { AddRelativeDialog } from './AddRelativeDialog.tsx';
import { otherScriptName, personAge, useFamilyRole } from './format.ts';
import { PersonFormSheet } from './PersonFormSheet.tsx';
import { RelativeChip } from './RelativeChip.tsx';

interface PersonQuickPanelProps {
  graph: FamilyGraph;
  personId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}

/** Glass side panel on the tree page: who this is, their immediate family and businesses. */
export function PersonQuickPanel({ graph, personId, onClose, onSelect }: PersonQuickPanelProps) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const locale = i18n.language;
  const familyId = graph.family.id;
  const { editable } = useFamilyRole(familyId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const data = useMemo(() => {
    const byId = new Map(graph.people.map((p) => [p.id, p]));
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p));
    const spouses = graph.marriages
      .filter((m) => m.personAId === personId || m.personBId === personId)
      .map((m) => ({ marriage: m, person: byId.get(m.personAId === personId ? m.personBId : m.personAId) }))
      .filter((s): s is { marriage: (typeof graph.marriages)[number]; person: Person } => Boolean(s.person));
    const businesses = graph.personBusiness
      .filter((pb) => pb.personId === personId)
      .map((pb) => ({ role: pb.role, business: graph.businesses.find((b) => b.id === pb.businessId) }))
      .filter((b) => b.business);
    return {
      person: byId.get(personId),
      membership: graph.memberships.find((m) => m.personId === personId)?.membership ?? 'BORN',
      parents: pick(parentsOf(graph, personId)),
      children: pick(childrenOf(graph, personId)),
      siblings: pick(siblingsOf(graph, personId)),
      spouses,
      businesses,
    };
  }, [graph, personId]);

  const p = data.person;
  if (!p) return null;
  const name = personName(p, locale);
  const alt = otherScriptName(p, locale);
  const age = personAge(p);
  const years = personYears(p);

  return (
    <div className="glass flex h-full flex-col overflow-hidden rounded-2xl shadow-2xl">
      {/* Hero */}
      <div
        className="relative shrink-0 px-5 pt-5 pb-4"
        style={{
          background: `linear-gradient(160deg, color-mix(in oklab, ${graph.family.color} 22%, transparent), transparent 75%)`,
        }}
      >
        <Button
          size="icon"
          variant="ghost"
          className="absolute end-2 top-2 size-8 rounded-full"
          onClick={onClose}
          aria-label={tc('actions.close')}
        >
          <X />
        </Button>
        <motion.div
          key={personId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4"
        >
          <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={name} isLiving={p.isLiving} size={72} />
          <div className="min-w-0 pe-6">
            <h2 className="font-display text-xl font-bold leading-tight">{name}</h2>
            {alt && (
              <p className="truncate text-sm text-muted-foreground">
                <bdi>{alt}</bdi>
              </p>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {years && <span className="ltr-isolate font-medium text-foreground">{years}</span>}
              {age != null && <span>· {tc('dates.age', { age })}</span>}
              {!p.isLiving && <span>· {tc('dates.deceased')}</span>}
            </p>
          </div>
        </motion.div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.membership === 'MARRIED_IN' && <Tag>{t('membership.MARRIED_IN')}</Tag>}
          {p.kunya && <Tag>{p.kunya}</Tag>}
          {p.laqab && <Tag>{p.laqab}</Tag>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <ul className="space-y-1.5 text-sm">
          {p.occupation && <Fact icon={<Briefcase />}>{p.occupation}</Fact>}
          {p.education && <Fact icon={<GraduationCap />}>{p.education}</Fact>}
          {(p.currentCity || p.birthPlace) && <Fact icon={<MapPin />}>{p.currentCity || p.birthPlace}</Fact>}
        </ul>

        <Group title={t('family.parents')} people={data.parents} onSelect={onSelect} />
        {data.spouses.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('family.spouses')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {data.spouses.map((s) => (
                <RelativeChip
                  key={s.marriage.id}
                  person={s.person}
                  onClick={() => onSelect(s.person.id)}
                  meta={
                    <>
                      {t(`marriage.statuses.${s.marriage.status}`)}
                      {s.marriage.startDate && (
                        <span className="ltr-isolate"> · {s.marriage.startDate.value.slice(0, 4)}</span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </div>
        )}
        <Group title={t('family.siblings')} people={data.siblings} onSelect={onSelect} />
        <Group title={t('family.children')} people={data.children} onSelect={onSelect} />

        {data.businesses.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('profile.businesses')}
            </h3>
            <ul className="space-y-1.5">
              {data.businesses.map(({ business, role }) =>
                business ? (
                  <li key={business.id}>
                    <Link
                      to="/f/$familyId/businesses/$businessId"
                      params={{ familyId, businessId: business.id }}
                      className="flex items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3 py-2 text-foreground transition-colors hover:border-gold/50"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
                        <Building2 className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {(locale === 'ar' && business.nameAr) || business.name}
                        </span>
                        {role && (
                          <span className="block text-xs text-muted-foreground">{t(`businessRole.${role}`)}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
        <Button asChild size="sm" className="flex-1">
          <Link to="/f/$familyId/people/$personId" params={{ familyId, personId }}>
            <UserRound /> {t('actions.openProfile')}
          </Link>
        </Button>
        {editable && (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> {tc('actions.edit')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <UserPlus /> {t('actions.addRelative')}
            </Button>
          </>
        )}
      </div>

      {editable && (
        <>
          <PersonFormSheet familyId={familyId} open={editing} onOpenChange={setEditing} person={p} />
          <AddRelativeDialog
            familyId={familyId}
            personId={personId}
            open={adding}
            onOpenChange={setAdding}
            onAdded={onSelect}
          />
        </>
      )}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-gold">{children}</span>;
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-foreground [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Group({ title, people, onSelect }: { title: string; people: Person[]; onSelect: (id: string) => void }) {
  if (people.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {people.map((p) => (
          <RelativeChip key={p.id} person={p} onClick={() => onSelect(p.id)} />
        ))}
      </div>
    </div>
  );
}
