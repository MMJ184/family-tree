import { matchesSearch, type Person } from '@family-tree/shared';
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@family-tree/ui';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { personName, personYears } from '#/lib/display.ts';
import { PersonAvatar } from './PersonAvatar.tsx';

interface PersonSearchProps {
  people: ReadonlyArray<Person>;
  onPick: (personId: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Jump-to-person search over a family's people. Matches either script, and
 * folds Arabic spelling variants (أ/إ/ا, ة/ه, ى/ي) via `matchesSearch`.
 */
export function PersonSearch({ people, onPick, placeholder, className }: PersonSearchProps) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return people
      .filter((p) =>
        matchesSearch(q, [
          p.nameAr,
          p.nameEn,
          p.firstName,
          p.lastName,
          p.maidenName,
          p.laqab,
          p.kunya,
          p.currentCity,
          p.birthPlace,
          p.birth?.value.slice(0, 4),
        ]),
      )
      .slice(0, 12);
  }, [q, people]);

  return (
    <Popover open={open && results.length > 0} onOpenChange={setOpen}>
      <Command shouldFilter={false} className={className}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) {
                  onPick(results[0].id);
                  setOpen(false);
                }
              }}
              placeholder={placeholder ?? t('actions.search')}
              aria-label={placeholder ?? t('actions.search')}
              className="h-9 w-full rounded-full border border-input bg-card ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <CommandList>
            <CommandEmpty>{t('states.empty')}</CommandEmpty>
            {results.map((p) => (
              <CommandItem
                key={p.id}
                value={p.id}
                onSelect={() => {
                  onPick(p.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2.5"
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
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Command>
    </Popover>
  );
}
