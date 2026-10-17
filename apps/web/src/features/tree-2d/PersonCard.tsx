import type { Person } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import { motion } from 'framer-motion';
import { Briefcase, HeartHandshake } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { personName, personYears } from '#/lib/display.ts';
import { genderColor } from './nodes.tsx';

interface PersonCardProps {
  person: Person;
  onClick: () => void;
  selected?: boolean;
  /** Relationship label shown above the name ("Father", "Daughter"…). */
  label?: string | undefined;
  marriedIn?: boolean;
  business?: boolean;
  /** framer-motion shared layout id, so a card glides to its new place when the view re-centres. */
  layoutId?: string;
  size?: 'md' | 'lg';
  className?: string;
}

/** A clickable person card for the HTML (non-canvas) views. */
export function PersonCard({
  person,
  onClick,
  selected = false,
  label,
  marriedIn = false,
  business = false,
  layoutId,
  size = 'md',
  className,
}: PersonCardProps) {
  const { t, i18n } = useTranslation('tree2d');
  const name = personName(person, i18n.language);
  const years = personYears(person);
  const lg = size === 'lg';
  return (
    <motion.button
      type="button"
      layout={layoutId ? 'position' : false}
      {...(layoutId
        ? {
            layoutId,
            initial: { opacity: 0, scale: 0.92 },
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0, scale: 0.92 },
          }
        : {})}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-2xl border border-border text-start shadow-sm outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring',
        person.isLiving ? 'bg-card text-card-foreground' : 'bg-muted text-muted-foreground',
        selected ? 'shadow-xl ring-2 ring-primary' : 'hover:shadow-md',
        lg ? 'min-h-24 p-4 ps-5' : 'min-h-16 px-3 py-2.5',
        className,
      )}
      style={{ borderInlineStartWidth: 4, borderInlineStartColor: genderColor(person.gender) }}
      title={person.isLiving ? undefined : t('badges.deceased')}
    >
      <PersonAvatar
        photoUrl={person.photoUrl}
        gender={person.gender}
        name={name}
        isLiving={person.isLiving}
        size={lg ? 60 : 38}
      />
      <span className="min-w-0 flex-1">
        {label && (
          <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-primary">{label}</span>
        )}
        <span className={cn('block truncate font-semibold leading-tight', lg ? 'font-display text-xl' : 'text-sm')}>
          {name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {years && <span className="ltr-isolate tabular-nums">{years}</span>}
          {marriedIn && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-foreground"
              title={t('badges.marriedIn')}
            >
              <HeartHandshake className="size-3" aria-hidden />
              {lg ? t('badges.marriedIn') : <span className="sr-only">{t('badges.marriedIn')}</span>}
            </span>
          )}
        </span>
      </span>
      {business && (
        <span
          className="-top-2 absolute end-3 grid size-5 place-items-center rounded-full bg-gold text-gold-foreground shadow ring-2 ring-card"
          title={t('badges.business')}
        >
          <Briefcase className="size-3" aria-hidden />
          <span className="sr-only">{t('badges.business')}</span>
        </span>
      )}
    </motion.button>
  );
}
