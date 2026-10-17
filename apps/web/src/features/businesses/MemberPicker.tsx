import { type BusinessRole, matchesSearch, type Person } from '@family-tree/shared';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@family-tree/ui';
import { Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import type { BusinessLinkInput } from '#/entities/business/queries.ts';
import { personName, personYears } from '#/lib/display.ts';
import { ROLE_OPTIONS } from './formModel.ts';

const NONE = 'NONE';

export function RoleSelect({
  value,
  onChange,
  className,
}: {
  value: BusinessRole | null;
  onChange: (role: BusinessRole | null) => void;
  className?: string;
}) {
  const { t } = useTranslation('business');
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : (v as BusinessRole))}>
      <SelectTrigger aria-label={t('form.role')} className={className ?? 'h-8 w-36 rounded-full text-sm'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((r) => (
          <SelectItem key={r} value={r}>
            {t(`roles.${r}`)}
          </SelectItem>
        ))}
        <SelectItem value={NONE}>{t('roles.NONE')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Search over the family's people (Arabic-normalised); picks one at a time. */
export function PeopleSearchList({
  people,
  exclude,
  onPick,
  autoFocus,
}: {
  people: ReadonlyArray<Person>;
  exclude: ReadonlySet<string>;
  onPick: (personId: string) => void;
  autoFocus?: boolean;
}) {
  const { t, i18n } = useTranslation('business');
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return people
      .filter((p) => !exclude.has(p.id))
      .filter((p) => matchesSearch(q, [p.nameAr, p.nameEn, p.firstName, p.lastName, p.laqab, p.kunya, p.currentCity]))
      .slice(0, 8);
  }, [q, people, exclude]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('form.searchPeople')}
          aria-label={t('form.searchPeople')}
          // biome-ignore lint/a11y/noAutofocus: the picker opens on demand, so focus belongs in its search box.
          autoFocus={autoFocus}
          className="h-10 w-full rounded-full border border-input bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {q.trim() && (
        <ul className="max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('form.noPeopleMatch')}</li>
          )}
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p.id);
                  setQ('');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-accent"
              >
                <PersonAvatar
                  photoUrl={p.photoUrl}
                  gender={p.gender}
                  name={personName(p, i18n.language)}
                  isLiving={p.isLiving}
                  size={28}
                />
                <span className="min-w-0 flex-1 truncate">{personName(p, i18n.language)}</span>
                <span className="ltr-isolate text-xs text-muted-foreground">{personYears(p)}</span>
                <Plus className="size-4 text-primary" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The form's link-members field: linked people with a role each, plus a search to add more. */
export function MemberPicker({
  people,
  value,
  onChange,
}: {
  people: ReadonlyArray<Person>;
  value: BusinessLinkInput[];
  onChange: (links: BusinessLinkInput[]) => void;
}) {
  const { t, i18n } = useTranslation('business');
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const linked = useMemo(() => new Set(value.map((l) => l.personId)), [value]);
  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((link) => {
            const p = byId.get(link.personId);
            if (!p) return null;
            const name = personName(p, i18n.language);
            return (
              <li key={link.personId} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2">
                <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={name} isLiving={p.isLiving} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                <RoleSelect
                  value={link.role}
                  onChange={(role) => onChange(value.map((l) => (l.personId === link.personId ? { ...l, role } : l)))}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-full"
                  aria-label={`${t('detail.unlink')}: ${name}`}
                  onClick={() => onChange(value.filter((l) => l.personId !== link.personId))}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <PeopleSearchList
        people={people}
        exclude={linked}
        onPick={(personId) => onChange([...value, { personId, role: value.length === 0 ? 'OWNER' : 'PARTNER' }])}
      />
    </div>
  );
}
