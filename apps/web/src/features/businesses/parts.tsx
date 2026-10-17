import type { Business, BusinessStatus, BusinessType } from '@family-tree/shared';
import { cn } from '@family-tree/ui';
import {
  Briefcase,
  Building2,
  ConciergeBell,
  Factory,
  Gem,
  Handshake,
  HardHat,
  Laptop,
  type LucideIcon,
  Shapes,
  Ship,
  Shirt,
  Store,
  Wheat,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { businessName, businessTypeColor } from '#/entities/business/display.ts';
import { initials } from '#/lib/display.ts';

export const TYPE_ICONS: Record<BusinessType, LucideIcon> = {
  MANUFACTURING: Factory,
  TRADING: Handshake,
  RETAIL: Store,
  DIAMOND: Gem,
  TEXTILE: Shirt,
  AGRICULTURE: Wheat,
  IT_SOFTWARE: Laptop,
  REAL_ESTATE: Building2,
  CONSTRUCTION: HardHat,
  SERVICES: ConciergeBell,
  PROFESSIONAL: Briefcase,
  IMPORT_EXPORT: Ship,
  OTHER: Shapes,
};

/** Industry label; for OTHER, the admin's own description when there is one. */
export function useTypeLabel() {
  const { t } = useTranslation('business');
  return (b: Pick<Business, 'type' | 'typeOther'>) =>
    b.type === 'OTHER' && b.typeOther ? b.typeOther : t(`types.${b.type}`);
}

/** City names are stored as typed; the common UAE ones get a translated label. */
export function useCityLabel() {
  const { t } = useTranslation('business');
  return (city: string | null | undefined) => (city ? t(`cities.${city}`, { defaultValue: city }) : '');
}

/** The business logo, or a monogram tinted with the industry colour. */
export function BusinessLogo({
  business,
  size = 56,
  className,
}: {
  business: Pick<Business, 'name' | 'nameAr' | 'type' | 'logoUrl'>;
  size?: number;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const name = businessName(business, i18n.language);
  if (business.logoUrl) {
    return (
      <span
        className={cn('inline-flex shrink-0 overflow-hidden rounded-2xl border border-border bg-card', className)}
        style={{ width: size, height: size }}
      >
        <img src={business.logoUrl} alt={name} className="size-full object-contain" loading="lazy" />
      </span>
    );
  }
  const Icon = TYPE_ICONS[business.type];
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display font-bold text-white shadow-sm',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${businessTypeColor(business.type)}, ${businessTypeColor(business.type, 0.7)})`,
      }}
    >
      <Icon
        className="absolute -end-1 -bottom-1 opacity-25"
        style={{ width: size * 0.55, height: size * 0.55 }}
        aria-hidden
      />
      <span className="relative">{initials(name) || name.slice(0, 1)}</span>
    </span>
  );
}

export function TypeBadge({
  business,
  className,
}: {
  business: Pick<Business, 'type' | 'typeOther'>;
  className?: string;
}) {
  const label = useTypeLabel();
  const Icon = TYPE_ICONS[business.type];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        className,
      )}
      style={{ background: businessTypeColor(business.type, 0.15), color: 'var(--ft-foreground)' }}
    >
      <Icon className="size-3.5 shrink-0" style={{ color: businessTypeColor(business.type) }} aria-hidden />
      <span className="truncate">{label(business)}</span>
    </span>
  );
}

export function StatusBadge({ status, className }: { status: BusinessStatus; className?: string }) {
  const { t } = useTranslation('business');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        status === 'ACTIVE' ? 'border-success/40 text-success-text' : 'border-border text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', status === 'ACTIVE' ? 'bg-success' : 'bg-muted-foreground')}
        aria-hidden
      />
      {t(`status.${status}`)}
    </span>
  );
}
