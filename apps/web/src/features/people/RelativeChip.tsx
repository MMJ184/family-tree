import type { Person } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { personName, personYears } from '#/lib/display.ts';

/** A small person pill: avatar, name, years. Rendered as a button or wraps a link via `as`. */
export function RelativeChipBody({ person, meta, size = 28 }: { person: Person; meta?: ReactNode; size?: number }) {
  const { i18n } = useTranslation();
  const name = personName(person, i18n.language);
  return (
    <>
      <PersonAvatar
        photoUrl={person.photoUrl}
        gender={person.gender}
        name={name}
        isLiving={person.isLiving}
        size={size}
      />
      <span className="min-w-0 text-start">
        <span className="block truncate text-sm font-medium leading-tight">{name}</span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">
          {meta ?? <span className="ltr-isolate">{personYears(person)}</span>}
        </span>
      </span>
    </>
  );
}

export const chipClass = cn(
  'inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card/70 py-1 ps-1 pe-3 shadow-sm transition-all',
  'hover:-translate-y-px hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

export function RelativeChip({ person, meta, onClick }: { person: Person; meta?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={chipClass}>
      <RelativeChipBody person={person} meta={meta} />
    </button>
  );
}
