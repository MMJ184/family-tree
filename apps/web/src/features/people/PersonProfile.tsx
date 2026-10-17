import type { Person } from '@family-tree/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
} from '@family-tree/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Briefcase,
  Building2,
  Cake,
  Flower2,
  GitFork,
  GraduationCap,
  Heart,
  Home,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import {
  type RelationKind,
  type RelativeRef,
  type SpouseLink,
  useDeletePerson,
  usePerson,
  useRemoveMarriage,
  useRemoveParentChild,
} from '#/entities/person/queries.ts';
import { familyName, personName, personShortName, personYears } from '#/lib/display.ts';
import { AddRelativeDialog } from './AddRelativeDialog.tsx';
import { formatDate, nasabLine, otherScriptName, personAge } from './format.ts';
import { MarriageDialog } from './MarriageDialog.tsx';
import { PersonFormSheet } from './PersonFormSheet.tsx';
import { chipClass, RelativeChipBody } from './RelativeChip.tsx';

type Confirm = { title: string; body: string; action: () => Promise<unknown>; done: string } | null;

/** A person's full profile page. Viewers get no edit controls, and phone / email are already redacted by the API. */
export function PersonProfile({ familyId, personId }: { familyId: string; personId: string }) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const locale = i18n.language;
  const navigate = useNavigate();
  const { data, isPending, error } = usePerson(familyId, personId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<RelationKind | null>(null);
  const [marriage, setMarriage] = useState<SpouseLink | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deleting, setDeleting] = useState(false);
  const del = useDeletePerson(familyId);
  const removeEdge = useRemoveParentChild(familyId);
  const removeMarriage = useRemoveMarriage(familyId);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const { person: p, role } = data;
  const editable = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const name = personName(p, locale);
  // Married in here: deleting only removes them from this family. Phrased from this family alone, so other
  // families the user cannot access are never hinted at.
  const removeOnly = data.membership === 'MARRIED_IN';
  const alt = otherScriptName(p, locale);
  const short = (x: Person | null) => (x ? personShortName(x, locale) : null);
  const nasab = nasabLine(p, { father: short(data.nasab.father), grandfather: short(data.nasab.grandfather) }, t);
  const age = personAge(p);
  const years = personYears(p);
  const currentFamily = data.families.find((f) => f.family.id === familyId)?.family;
  const color = currentFamily?.color ?? 'var(--ft-primary)';

  const ask = (c: NonNullable<Confirm>) => setConfirm(c);
  const runConfirm = async () => {
    if (!confirm) return;
    try {
      await confirm.action();
      toast.success(confirm.done);
    } catch (e) {
      toast.error(errorMessage(e, tc));
    }
    setConfirm(null);
  };

  const removeLink = (rel: RelativeRef & { edgeId: string }) =>
    ask({
      title: t('confirm.unlinkTitle'),
      body: t('confirm.unlinkBody', { a: name, b: personName(rel.person, locale) }),
      action: () => removeEdge.mutateAsync(rel.edgeId),
      done: t('toast.unlinked'),
    });

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2 text-muted-foreground">
        <Link to="/f/$familyId/people" params={{ familyId }}>
          <ArrowLeft className="rtl:-scale-x-100" /> {t('list.title')}
        </Link>
      </Button>

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-lg"
      >
        <div
          className="h-28 sm:h-36"
          style={{
            background: `radial-gradient(120% 140% at 85% 0%, color-mix(in oklab, ${color} 55%, transparent), transparent 60%), linear-gradient(120deg, color-mix(in oklab, ${color} 30%, transparent), color-mix(in oklab, var(--ft-gold) 22%, transparent))`,
          }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 sm:px-8">
          <div className="-mt-14 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end">
            <div className="w-fit shrink-0 self-start rounded-full bg-card p-1.5 shadow-xl sm:self-auto">
              <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={name} isLiving={p.isLiving} size={120} />
            </div>
            <div className="min-w-0 flex-1 sm:pb-2">
              <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{name}</h1>
              {alt && (
                <p className="mt-0.5 text-lg text-muted-foreground">
                  <bdi>{alt}</bdi>
                </p>
              )}
              {nasab && <p className="mt-1 text-sm text-foreground/80">{nasab}</p>}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {years && (
              <span className="ltr-isolate rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums">
                {years}
              </span>
            )}
            {age != null && <Pill>{tc('dates.age', { age })}</Pill>}
            <Pill tone={p.isLiving ? 'success' : 'muted'}>
              {p.isLiving ? tc('dates.living') : tc('dates.deceased')}
            </Pill>
            {p.kunya && <Pill tone="gold">{p.kunya}</Pill>}
            {p.laqab && <Pill tone="gold">{p.laqab}</Pill>}
            {p.tribeName && <Pill>{t('profile.tribe', { name: p.tribeName })}</Pill>}
            {data.membership === 'MARRIED_IN' && <Pill tone="gold">{t('membership.MARRIED_IN')}</Pill>}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/f/$familyId/tree" params={{ familyId }} search={{ view: 'tree', person: personId }}>
                <GitFork /> {t('actions.viewInTree')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/f/$familyId/tree" params={{ familyId }} search={{ view: 'person', person: personId }}>
                <User /> {t('actions.personView')}
              </Link>
            </Button>
            {editable && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> {tc('actions.edit')}
                </Button>
                <Button variant="outline" onClick={() => setAdding('child')}>
                  <UserPlus /> {t('actions.addRelative')}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive-text hover:text-destructive-text"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 /> {removeOnly ? t('actions.removeFromFamily') : tc('actions.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Family */}
          <Card title={t('profile.family')} icon={<Users />}>
            <div className="grid gap-5 sm:grid-cols-2">
              <RelGroup
                title={t('family.parents')}
                empty={t('family.noParents')}
                onAdd={editable ? () => setAdding('parent') : undefined}
              >
                {data.parents.map((r) => (
                  <RelLink
                    key={r.edgeId}
                    rel={r}
                    meta={r.type !== 'BIOLOGICAL' ? t(`parentChildType.${r.type}`) : undefined}
                    onRemove={editable ? () => removeLink(r) : undefined}
                  />
                ))}
              </RelGroup>
              <RelGroup
                title={t('family.spouses')}
                empty={t('family.noSpouses')}
                onAdd={editable ? () => setAdding('spouse') : undefined}
              >
                {data.spouses.map((s) => (
                  <RelLink
                    key={s.marriage.id}
                    rel={s}
                    meta={
                      <>
                        <span className={cn(s.marriage.status === 'MARRIED' ? 'text-primary' : '')}>
                          <Heart className="inline size-3 align-[-1px]" aria-hidden />{' '}
                          {t(`marriage.statuses.${s.marriage.status}`)}
                        </span>
                        {(s.marriage.startDate || s.marriage.endDate) && (
                          <span className="ltr-isolate">
                            {' · '}
                            {s.marriage.startDate?.value.slice(0, 4) ?? '?'}
                            {s.marriage.endDate ? `–${s.marriage.endDate.value.slice(0, 4)}` : ''}
                          </span>
                        )}
                      </>
                    }
                    otherFamily={
                      s.familyId !== familyId
                        ? data.families.find((f) => f.family.id === s.familyId)?.family
                        : undefined
                    }
                    onEdit={editable ? () => setMarriage(s) : undefined}
                    onRemove={
                      editable
                        ? () =>
                            ask({
                              title: t('confirm.unmarryTitle'),
                              body: t('confirm.unmarryBody', { a: name, b: personName(s.person, locale) }),
                              action: () => removeMarriage.mutateAsync(s.marriage.id),
                              done: t('toast.unlinked'),
                            })
                        : undefined
                    }
                  />
                ))}
              </RelGroup>
              <RelGroup
                title={t('family.siblings')}
                empty={t('family.noSiblings')}
                hint={t('family.siblingsDerived')}
                onAdd={editable && data.parents.length > 0 ? () => setAdding('sibling') : undefined}
              >
                {data.siblings.map((r) => (
                  <RelLink key={r.person.id} rel={r} />
                ))}
              </RelGroup>
              <RelGroup
                title={t('family.children')}
                empty={t('family.noChildren')}
                onAdd={editable ? () => setAdding('child') : undefined}
              >
                {data.children.map((r) => (
                  <RelLink
                    key={r.edgeId}
                    rel={r}
                    meta={r.type !== 'BIOLOGICAL' ? t(`parentChildType.${r.type}`) : undefined}
                    onRemove={editable ? () => removeLink(r) : undefined}
                  />
                ))}
              </RelGroup>
            </div>
          </Card>

          {(p.notes || p.marriedIntoNote) && (
            <Card title={t('profile.biography')} icon={<BookOpen />}>
              {p.notes && <p className="whitespace-pre-line leading-relaxed text-foreground/90">{p.notes}</p>}
              {p.marriedIntoNote && (
                <p className={cn('flex items-start gap-2 rounded-xl bg-gold/10 px-3 py-2 text-sm', p.notes && 'mt-4')}>
                  <Heart className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                  <span>
                    <span className="font-medium">{t('fields.marriedIntoNote')}: </span>
                    {p.marriedIntoNote}
                  </span>
                </p>
              )}
            </Card>
          )}

          {data.businesses.length > 0 && (
            <Card title={t('profile.businesses')} icon={<Building2 />}>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.businesses.map(({ business: b, role: r }) => (
                  <Link
                    key={b.id}
                    to="/f/$familyId/businesses/$businessId"
                    params={{ familyId: b.familyId, businessId: b.id }}
                    className="group flex gap-3 rounded-2xl border border-border bg-background/40 p-4 text-foreground transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-md"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
                      {b.logoUrl ? (
                        <img src={b.logoUrl} alt="" className="size-full rounded-xl object-cover" />
                      ) : (
                        <Building2 className="size-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold group-hover:text-primary">
                        {(locale === 'ar' && b.nameAr) || b.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {r ? t(`businessRole.${r}`) : null}
                        {b.startedYear && (
                          <span className="ltr-isolate">
                            {r ? ' · ' : ''}
                            {b.startedYear}
                            {b.endedYear ? `–${b.endedYear}` : ''}
                          </span>
                        )}
                      </span>
                      {b.city && <span className="mt-1 block text-xs text-muted-foreground">{b.city}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title={t('profile.facts')} icon={<User />}>
            <dl className="space-y-3 text-sm">
              <Fact icon={<User />} label={t('fields.gender')}>
                {tc(`gender.${p.gender}`)}
              </Fact>
              {p.birth && (
                <Fact icon={<Cake />} label={tc('dates.born')}>
                  {formatDate(p.birth, locale, t)}
                  {p.birthPlace && <span className="text-muted-foreground"> · {p.birthPlace}</span>}
                </Fact>
              )}
              {!p.birth && p.birthPlace && (
                <Fact icon={<MapPin />} label={t('fields.birthPlace')}>
                  {p.birthPlace}
                </Fact>
              )}
              {p.death && (
                <Fact icon={<Flower2 />} label={tc('dates.died')}>
                  {formatDate(p.death, locale, t)}
                </Fact>
              )}
              {p.currentCity && (
                <Fact icon={<Home />} label={t('fields.currentCity')}>
                  {p.currentCity}
                </Fact>
              )}
              {p.occupation && (
                <Fact icon={<Briefcase />} label={t('fields.occupation')}>
                  {p.occupation}
                </Fact>
              )}
              {p.education && (
                <Fact icon={<GraduationCap />} label={t('fields.education')}>
                  {p.education}
                </Fact>
              )}
              {p.maidenName && (
                <Fact icon={<User />} label={t('fields.maidenName')}>
                  {p.maidenName}
                </Fact>
              )}
              {p.phone && (
                <Fact icon={<Phone />} label={t('fields.phone')}>
                  <a href={`tel:${p.phone.replace(/\s/g, '')}`} className="ltr-isolate">
                    {p.phone}
                  </a>
                </Fact>
              )}
              {p.email && (
                <Fact icon={<Mail />} label={t('fields.email')}>
                  <a href={`mailto:${p.email}`} className="break-all">
                    {p.email}
                  </a>
                </Fact>
              )}
              {Object.entries(p.customFields).map(([k, v]) => (
                <Fact key={k} icon={<Plus />} label={k}>
                  {v}
                </Fact>
              ))}
            </dl>
            {!editable && <p className="mt-4 text-xs text-muted-foreground">{t('profile.contactsHidden')}</p>}
          </Card>

          {data.families.length > 0 && (
            <Card title={t('profile.appearsIn')} icon={<GitFork />}>
              <div className="flex flex-wrap gap-2">
                {data.families.map(({ family, membership }) => (
                  <Link
                    key={family.id}
                    to="/f/$familyId/people/$personId"
                    params={{ familyId: family.id, personId }}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:shadow-md',
                      family.id === familyId ? 'border-transparent' : 'border-border',
                    )}
                    style={
                      family.id === familyId
                        ? { background: `color-mix(in oklab, ${family.color} 18%, transparent)` }
                        : undefined
                    }
                  >
                    <span className="size-2.5 rounded-full" style={{ background: family.color }} aria-hidden />
                    {familyName(family, locale)}
                    <span className="text-xs text-muted-foreground">· {t(`membership.${membership}`)}</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {editable && (
        <>
          <PersonFormSheet familyId={familyId} open={editing} onOpenChange={setEditing} person={p} />
          <AddRelativeDialog
            familyId={familyId}
            personId={personId}
            open={adding !== null}
            onOpenChange={(o) => !o && setAdding(null)}
            initialRelation={adding ?? 'child'}
          />
          <MarriageDialog
            familyId={familyId}
            marriage={marriage?.marriage ?? null}
            spouseName={marriage ? personName(marriage.person, locale) : ''}
            onOpenChange={(o) => !o && setMarriage(null)}
          />
          <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void runConfirm()}>{tc('actions.confirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={deleting} onOpenChange={setDeleting}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {removeOnly ? t('confirm.removeTitle', { name }) : t('confirm.deleteTitle', { name })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {removeOnly ? t('confirm.removeBody') : t('confirm.deleteBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={async () => {
                    try {
                      await del.mutateAsync(personId);
                      toast.success(removeOnly ? t('toast.removed', { name }) : t('toast.deleted', { name }));
                      await navigate({ to: '/f/$familyId/people', params: { familyId } });
                    } catch (e) {
                      toast.error(errorMessage(e, tc));
                    }
                  }}
                >
                  {removeOnly ? t('actions.removeFromFamily') : tc('actions.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function Pill({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'gold' | 'success' | 'muted';
}) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1 text-sm font-medium',
        tone === 'gold' && 'bg-gold/15 text-gold',
        tone === 'success' && 'bg-success/15 text-success-text',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'default' && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="glass rounded-3xl p-5 shadow-sm sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold [&_svg]:size-5 [&_svg]:text-gold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-medium text-foreground">{children}</dd>
      </div>
    </div>
  );
}

function RelGroup({
  title,
  empty,
  hint,
  onAdd,
  children,
}: {
  title: string;
  empty: string;
  hint?: string;
  onAdd?: (() => void) | undefined;
  children: ReactNode[];
}) {
  const tc = useTranslation().t;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={hint}>
          {title}
          {children.length > 0 && <span className="ms-1.5 text-foreground/60">{children.length}</span>}
        </h3>
        {onAdd && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-primary" onClick={onAdd}>
            <Plus /> {tc('actions.add')}
          </Button>
        )}
      </div>
      {children.length ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function RelLink({
  rel,
  meta,
  otherFamily,
  onEdit,
  onRemove,
}: {
  rel: RelativeRef;
  meta?: ReactNode;
  otherFamily?: { name: string; nameAr: string | null; color: string } | undefined;
  onEdit?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const person: Person = rel.person;
  return (
    <div className="group flex min-w-0 items-center gap-1">
      <Link
        to="/f/$familyId/people/$personId"
        params={{ familyId: rel.familyId, personId: person.id }}
        className={cn(chipClass, 'min-w-0 flex-1 rounded-2xl py-1.5 text-foreground')}
      >
        <RelativeChipBody
          person={person}
          size={34}
          meta={
            <>
              {meta ?? <span className="ltr-isolate">{personYears(person)}</span>}
              {otherFamily && (
                <span className="ms-1" style={{ color: otherFamily.color }}>
                  · {familyName(otherFamily, i18n.language)}
                </span>
              )}
            </>
          }
        />
      </Link>
      {onEdit && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={onEdit}
          aria-label={t('marriage.edit')}
        >
          <Pencil />
        </Button>
      )}
      {onRemove && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive-text"
          onClick={onRemove}
          aria-label={tc('actions.remove')}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
