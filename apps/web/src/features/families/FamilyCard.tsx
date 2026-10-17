import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Archive, ArrowRight, Building2, MapPin, MoreVertical, Pencil, RotateCcw, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FamilySummary } from '#/api/families.ts';
import { familyName, initials } from '#/lib/display.ts';

interface FamilyCardProps {
  summary: FamilySummary;
  index: number;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

export function FamilyCard({ summary, index, onEdit, onArchive, onRestore }: FamilyCardProps) {
  const { t, i18n } = useTranslation(['families', 'common']);
  const { family, peopleCount, businessCount, admins } = summary;
  const name = familyName(family, i18n.language);
  const otherName = i18n.language === 'ar' ? family.name : family.nameAr;
  const archived = Boolean(family.archivedAt);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.05 }}
      className="group glass relative flex flex-col overflow-hidden rounded-2xl shadow-sm transition-shadow hover:shadow-xl"
      style={{ ['--fam' as string]: family.color }}
    >
      {/* Colour band with a soft monogram, the family's identity at a glance. */}
      <div
        className="relative h-24 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${family.color} 0%, color-mix(in oklab, ${family.color} 55%, #000) 100%)`,
          filter: archived ? 'grayscale(0.85)' : undefined,
        }}
      >
        <svg className="absolute inset-0 size-full opacity-20" aria-hidden="true">
          <defs>
            <pattern id={`p-${family.id}`} width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="14" cy="14" r="1.6" fill="#fff" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#p-${family.id})`} />
        </svg>
        <span className="pointer-events-none absolute -bottom-6 end-3 font-display text-7xl font-bold text-white/20 select-none">
          {initials(family.surname ?? family.name)}
        </span>
      </div>

      <div className="absolute end-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 rounded-full bg-black/20 text-white hover:bg-black/35 hover:text-white"
              aria-label={t('menu', { name })}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {archived ? (
              <DropdownMenuItem onSelect={onRestore}>
                <RotateCcw className="size-4" />
                {t('restore')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" />
                  {t('edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onArchive} className="text-destructive-text">
                  <Archive className="size-4" />
                  {t('archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-bold">{name}</h2>
          {otherName && otherName !== name && (
            <p className="truncate text-sm text-muted-foreground" lang={i18n.language === 'ar' ? 'en' : 'ar'}>
              {otherName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {family.surname && <span className="font-medium text-foreground/80">{family.surname}</span>}
            {family.nativePlace && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {t('nativePlace', { place: family.nativePlace })}
              </span>
            )}
            {archived && family.archivedAt && (
              <span>
                {t('archivedOn', {
                  date: new Intl.DateTimeFormat(`${i18n.language}-u-nu-latn`, { dateStyle: 'medium' }).format(
                    new Date(family.archivedAt),
                  ),
                })}
              </span>
            )}
          </div>
        </div>

        {family.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            <bdi>{family.description}</bdi>
          </p>
        )}

        <dl className="mt-auto grid grid-cols-3 gap-2 rounded-xl bg-muted/60 p-3 text-center">
          <Stat icon={Users} label={t('stats.people')} value={peopleCount} />
          <Stat icon={Building2} label={t('stats.businesses')} value={businessCount} />
          <div className="flex flex-col items-center gap-1">
            <dt className="text-[11px] text-muted-foreground">{t('stats.admins')}</dt>
            <dd className="flex items-center">
              {admins.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t('noAdmins')}</span>
              ) : (
                <span className="flex -space-x-2 rtl:space-x-reverse">
                  {admins.slice(0, 3).map((a) => (
                    <Tooltip key={a.id}>
                      <TooltipTrigger asChild>
                        <span
                          className="flex size-7 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white"
                          style={{ background: family.color }}
                          role="img"
                          aria-label={a.name}
                        >
                          {initials(a.name)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{a.name}</TooltipContent>
                    </Tooltip>
                  ))}
                  {admins.length > 3 && (
                    <span className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-bold">
                      {t('moreAdmins', { count: admins.length - 3 })}
                    </span>
                  )}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {archived ? (
          <Button variant="outline" onClick={onRestore}>
            <RotateCcw aria-hidden />
            {t('restore')}
          </Button>
        ) : (
          <Button asChild className="justify-between" style={{ background: family.color, color: '#fff' }}>
            <Link to="/f/$familyId" params={{ familyId: family.id }}>
              {t('open')}
              <ArrowRight
                className="transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
        )}
      </div>
    </motion.article>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <dt className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="ltr-isolate text-lg font-bold tabular-nums">{value.toLocaleString('en')}</dd>
    </div>
  );
}
