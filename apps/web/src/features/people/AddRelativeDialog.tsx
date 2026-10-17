import {
  type Gender,
  type MarriageStatus,
  makePartialDate,
  matchesSearch,
  type ParentChildType,
  type PersonInput,
} from '@family-tree/shared';
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from '@family-tree/ui';
import { Baby, Check, Heart, Search, UserPlus, Users } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import {
  type AddRelativeRequest,
  type RelationKind,
  type RelativeSource,
  useAddRelative,
  useLinkCandidates,
  usePerson,
} from '#/entities/person/queries.ts';
import { familyName, personName, personYears } from '#/lib/display.ts';
import { FieldShell, SelectField } from './fields.tsx';
import { firstWord } from './format.ts';
import { toFormValues, toPersonInput } from './personFormModel.ts';

interface AddRelativeDialogProps {
  familyId: string;
  personId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRelation?: RelationKind;
  onAdded?: (personId: string) => void;
}

const RELATIONS: Array<{ kind: RelationKind; icon: typeof Users }> = [
  { kind: 'parent', icon: Users },
  { kind: 'spouse', icon: Heart },
  { kind: 'child', icon: Baby },
  { kind: 'sibling', icon: UserPlus },
];

/** Add a parent, child, spouse or sibling: a new person, or someone who already exists. */
export function AddRelativeDialog(props: AddRelativeDialogProps) {
  const { t } = useTranslation('people');
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{t('relative.title')}</DialogTitle>
          <DialogDescription>{t('relative.subtitle')}</DialogDescription>
        </DialogHeader>
        {props.open && <AddRelativeBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; disabled?: boolean; icon?: ReactNode }>;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="flex min-w-0 flex-wrap gap-1 rounded-xl border-0 bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40',
            o.value === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </fieldset>
  );
}

function AddRelativeBody({
  familyId,
  personId,
  onOpenChange,
  initialRelation = 'child',
  onAdded,
}: AddRelativeDialogProps) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const locale = i18n.language;
  const { data: detail, isPending } = usePerson(familyId, personId);
  const [relation, setRelation] = useState<RelationKind>(initialRelation);
  const [source, setSource] = useState<'new' | 'existing'>('new');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [gender, setGender] = useState<Gender>('MALE');
  const [birthYear, setBirthYear] = useState('');
  const [birthApprox, setBirthApprox] = useState(false);
  const [living, setLiving] = useState(true);
  const [deathYear, setDeathYear] = useState('');
  const [marriedIntoNote, setMarriedIntoNote] = useState('');
  const [pcType, setPcType] = useState<ParentChildType>('BIOLOGICAL');
  const [otherParentId, setOtherParentId] = useState<string>('none');
  const [marryParent, setMarryParent] = useState(true);
  const [status, setStatus] = useState<MarriageStatus>('MARRIED');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAddRelative(familyId);
  const candidates = useLinkCandidates(familyId, relation, source === 'existing');

  const hasParents = (detail?.parents.length ?? 0) > 0;
  const excluded = useMemo(() => {
    const s = new Set<string>([personId]);
    if (!detail) return s;
    const rel =
      relation === 'parent'
        ? detail.parents
        : relation === 'child'
          ? detail.children
          : relation === 'spouse'
            ? detail.spouses
            : detail.siblings;
    for (const r of rel) s.add(r.person.id);
    return s;
  }, [detail, relation, personId]);

  const list = useMemo(
    () =>
      (candidates.data ?? [])
        .filter((c) => !excluded.has(c.person.id))
        .filter((c) =>
          matchesSearch(query, [
            c.person.nameAr,
            c.person.nameEn,
            c.person.firstName,
            c.person.lastName,
            c.person.maidenName,
            c.person.birth?.value.slice(0, 4),
          ]),
        )
        .slice(0, 80),
    [candidates.data, excluded, query],
  );

  if (isPending || !detail) return <LoadingState className="py-16" />;
  const me = detail.person;
  const myName = personName(me, locale);

  const changeRelation = (r: RelationKind) => {
    setRelation(r);
    setPickedId(null);
    setError(null);
    if (r === 'spouse') setGender(me.gender === 'MALE' ? 'FEMALE' : 'MALE');
  };

  const year = (y: string) => (y.trim() && /^\d{3,4}$/.test(y.trim()) ? Number(y) : null);

  const buildInput = (): PersonInput | null => {
    if (!nameAr.trim() && !nameEn.trim()) return null;
    const words = nameEn.trim().split(/\s+/);
    const base = toFormValues(null);
    const input = toPersonInput({
      ...base,
      firstName: firstWord(nameEn) || firstWord(nameAr),
      lastName: words.length > 1 ? words.slice(1).join(' ') : '',
      nameAr,
      nameEn,
      gender,
      isLiving: living,
      tribeName: relation === 'child' || relation === 'sibling' ? (me.tribeName ?? '') : '',
      marriedIntoNote: relation === 'spouse' ? marriedIntoNote : '',
    });
    const b = year(birthYear);
    const d = living ? null : year(deathYear);
    return {
      ...input,
      birth: b ? makePartialDate(b, undefined, undefined, birthApprox) : null,
      death: d ? makePartialDate(d) : null,
      isLiving: d ? false : living,
    };
  };

  const submit = async () => {
    setError(null);
    let src: RelativeSource;
    if (source === 'existing') {
      if (!pickedId) return setError(t('relative.pickSomeone'));
      src = { kind: 'existing', personId: pickedId };
    } else {
      const input = buildInput();
      if (!input) return setError(t('relative.nameRequired'));
      if (birthYear && !year(birthYear)) return setError(t('form.errors.year'));
      src = { kind: 'new', input };
    }
    const s = year(startYear);
    const e = year(endYear);
    const parentToMarry = detail.parents[0]?.person.id;
    const req: AddRelativeRequest =
      relation === 'parent'
        ? {
            relation,
            personId,
            input: {
              parent: src,
              type: pcType,
              ...(marryParent && detail.parents.length === 1 && parentToMarry ? { marryParentId: parentToMarry } : {}),
            },
          }
        : relation === 'child'
          ? {
              relation,
              personId,
              input: { child: src, type: pcType, ...(otherParentId !== 'none' ? { otherParentId } : {}) },
            }
          : relation === 'spouse'
            ? {
                relation,
                personId,
                input: {
                  spouse: src,
                  status,
                  startDate: s ? makePartialDate(s) : null,
                  endDate: status !== 'MARRIED' && e ? makePartialDate(e) : null,
                },
              }
            : { relation, personId, input: { sibling: src } };
    try {
      const added = await add.mutateAsync(req);
      toast.success(
        t('toast.relativeAdded', { name: personName(added, locale), relation: t(`relations.${relation}`) }),
      );
      onOpenChange(false);
      onAdded?.(added.id);
    } catch (err) {
      setError(errorMessage(err, tc));
    }
  };

  const currentSpouses = detail.spouses.filter((s) => s.familyId === familyId);

  return (
    <>
      <div className="space-y-5 px-6 py-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
          <PersonAvatar photoUrl={me.photoUrl} gender={me.gender} name={myName} isLiving={me.isLiving} size={40} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t('relative.relativeOf')}</p>
            <p className="truncate font-medium">{myName}</p>
          </div>
        </div>

        <Segmented<RelationKind>
          label={t('relative.relation')}
          value={relation}
          onChange={changeRelation}
          options={RELATIONS.map(({ kind, icon: Icon }) => ({
            value: kind,
            label: t(`relations.${kind}`),
            icon: <Icon className="size-4" aria-hidden />,
            disabled: kind === 'sibling' && !hasParents,
          }))}
        />
        {!hasParents && relation !== 'sibling' && (
          <p className="-mt-3 text-xs text-muted-foreground">{t('relative.siblingNeedsParents')}</p>
        )}

        <Segmented<'new' | 'existing'>
          label={t('relative.source')}
          value={source}
          onChange={(v) => {
            setSource(v);
            setError(null);
          }}
          options={[
            { value: 'new', label: t('relative.newPerson') },
            { value: 'existing', label: t('relative.existingPerson') },
          ]}
        />

        {source === 'new' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell label={t('fields.nameAr')} htmlFor="rel-ar">
              <Input id="rel-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </FieldShell>
            <FieldShell label={t('fields.nameEn')} htmlFor="rel-en">
              <Input id="rel-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </FieldShell>
            <SelectField<Gender>
              label={relation === 'parent' ? t('relative.parentRole') : t('fields.gender')}
              value={gender}
              onChange={setGender}
              options={(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => ({
                value: g,
                label:
                  relation === 'parent' && g !== 'OTHER'
                    ? t(g === 'MALE' ? 'relations.father' : 'relations.mother')
                    : tc(`gender.${g}`),
              }))}
            />
            <FieldShell label={t('relative.birthYear')} htmlFor="rel-by">
              <div className="flex items-center gap-2">
                <Input
                  id="rel-by"
                  className="w-24"
                  dir="ltr"
                  inputMode="numeric"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <Label className="flex items-center gap-1.5 text-sm font-normal">
                  <Checkbox checked={birthApprox} onCheckedChange={(c) => setBirthApprox(c === true)} />
                  {t('form.approx')}
                </Label>
              </div>
            </FieldShell>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:col-span-2">
              <Label htmlFor="rel-living">{t('fields.isLiving')}</Label>
              <Switch id="rel-living" checked={living} onCheckedChange={setLiving} />
            </div>
            {!living && (
              <FieldShell label={t('relative.deathYear')} htmlFor="rel-dy">
                <Input
                  id="rel-dy"
                  className="w-24"
                  dir="ltr"
                  inputMode="numeric"
                  value={deathYear}
                  onChange={(e) => setDeathYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </FieldShell>
            )}
            {relation === 'spouse' && (
              <FieldShell
                label={t('fields.marriedIntoNote')}
                htmlFor="rel-note"
                hint={t('relative.marriedIntoHint')}
                className="sm:col-span-2"
              >
                <Input id="rel-note" value={marriedIntoNote} onChange={(e) => setMarriedIntoNote(e.target.value)} />
              </FieldShell>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {relation === 'spouse' && (
              <p className="text-xs text-muted-foreground">{t('relative.spouseFromFamilies')}</p>
            )}
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="ps-9"
                placeholder={t('relative.searchPeople')}
                aria-label={t('relative.searchPeople')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="max-h-60 overflow-y-auto rounded-xl border border-border"
              role="listbox"
              aria-label={t('relative.existingPerson')}
            >
              {candidates.isPending ? (
                <LoadingState className="py-8" />
              ) : list.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">{tc('states.empty')}</p>
              ) : (
                list.map((c) => {
                  const name = personName(c.person, locale);
                  const picked = c.person.id === pickedId;
                  return (
                    <button
                      key={c.person.id}
                      type="button"
                      role="option"
                      aria-selected={picked}
                      onClick={() => setPickedId(c.person.id)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-border px-3 py-2 text-start last:border-b-0 transition-colors',
                        picked ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                      )}
                    >
                      <PersonAvatar
                        photoUrl={c.person.photoUrl}
                        gender={c.person.gender}
                        name={name}
                        isLiving={c.person.isLiving}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        <span className="ltr-isolate text-xs text-muted-foreground">{personYears(c.person)}</span>
                      </span>
                      {c.family.id !== familyId && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            background: `color-mix(in oklab, ${c.family.color} 16%, transparent)`,
                            color: c.family.color,
                          }}
                        >
                          {familyName(c.family, locale)}
                        </span>
                      )}
                      {picked && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {(relation === 'parent' || relation === 'child') && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField<ParentChildType>
              label={t('relative.parentChildType')}
              value={pcType}
              onChange={setPcType}
              options={(['BIOLOGICAL', 'ADOPTED', 'STEP'] as const).map((v) => ({
                value: v,
                label: t(`parentChildType.${v}`),
              }))}
            />
            {relation === 'child' && (
              <SelectField<string>
                label={t('relative.otherParent')}
                value={otherParentId}
                onChange={setOtherParentId}
                options={[
                  { value: 'none', label: t('relative.noOtherParent') },
                  ...currentSpouses.map((s) => ({ value: s.person.id, label: personName(s.person, locale) })),
                ]}
              />
            )}
            {relation === 'parent' && detail.parents.length === 1 && detail.parents[0] && (
              <Label className="flex items-center gap-2 self-end pb-2 text-sm font-normal">
                <Checkbox checked={marryParent} onCheckedChange={(c) => setMarryParent(c === true)} />
                {t('relative.marryParent', { name: personName(detail.parents[0].person, locale) })}
              </Label>
            )}
          </div>
        )}

        {relation === 'spouse' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField<MarriageStatus>
              label={t('marriage.status')}
              value={status}
              onChange={setStatus}
              options={(['MARRIED', 'DIVORCED', 'WIDOWED'] as const).map((v) => ({
                value: v,
                label: t(`marriage.statuses.${v}`),
              }))}
            />
            <FieldShell label={t('marriage.startYear')} htmlFor="rel-sy">
              <Input
                id="rel-sy"
                dir="ltr"
                inputMode="numeric"
                value={startYear}
                onChange={(e) => setStartYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </FieldShell>
            {status !== 'MARRIED' && (
              <FieldShell label={t('marriage.endYear')} htmlFor="rel-ey">
                <Input
                  id="rel-ey"
                  dir="ltr"
                  inputMode="numeric"
                  value={endYear}
                  onChange={(e) => setEndYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </FieldShell>
            )}
          </div>
        )}

        {error && (
          <p
            className="rounded-md border border-destructive-border/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {tc('actions.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={add.isPending}>
          {add.isPending ? tc('actions.saving') : t('relative.add', { relation: t(`relations.${relation}`) })}
        </Button>
      </DialogFooter>
    </>
  );
}
