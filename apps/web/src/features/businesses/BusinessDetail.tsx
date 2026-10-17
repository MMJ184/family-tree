import type { Business, BusinessRole, EffectiveRole } from '@family-tree/shared';
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
  CalendarDays,
  ExternalLink,
  Facebook,
  GitBranch,
  Globe,
  Instagram,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Trash2,
  Unlink,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { businessAltName, businessName, businessTypeColor } from '#/entities/business/display.ts';
import {
  type LinkedPerson,
  useBusiness,
  useDeleteBusiness,
  useLinkPerson,
  useUnlinkPerson,
} from '#/entities/business/queries.ts';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { canEdit } from '#/entities/session/queries.ts';
import { personName, personYears } from '#/lib/display.ts';
import { BusinessFormSheet } from './BusinessForm.tsx';
import { PeopleSearchList, RoleSelect } from './MemberPicker.tsx';
import { BusinessLogo, StatusBadge, TypeBadge, useCityLabel } from './parts.tsx';

interface BusinessDetailProps {
  familyId: string;
  businessId: string;
  role: EffectiveRole | null;
}

export function BusinessDetail({ familyId, businessId, role }: BusinessDetailProps) {
  const { t, i18n } = useTranslation('business');
  const tc = useTranslation().t;
  const navigate = useNavigate();
  const cityLabel = useCityLabel();
  const admin = canEdit(role);
  const { data, isPending, error } = useBusiness(familyId, businessId);
  const remove = useDeleteBusiness(familyId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const { business: b, people } = data;
  const name = businessName(b, i18n.language);
  const alt = businessAltName(b, i18n.language);
  const accent = businessTypeColor(b.type);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <Link
        to="/f/$familyId/businesses"
        params={{ familyId }}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {t('detail.back')}
      </Link>

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mb-6 overflow-hidden rounded-3xl border border-border bg-card shadow-lg"
      >
        <div
          className="h-28 sm:h-36"
          style={{
            background: `radial-gradient(600px 200px at 85% 0%, ${businessTypeColor(b.type, 0.55)}, transparent 70%), linear-gradient(135deg, ${businessTypeColor(b.type, 0.35)}, ${businessTypeColor(b.type, 0.08)})`,
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 px-5 pb-6 sm:flex-row sm:items-end sm:px-8">
          <BusinessLogo business={b} size={104} className="-mt-14 border-4 border-card shadow-xl sm:-mt-16" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl leading-tight font-bold tracking-tight break-words sm:text-4xl">
              {name}
            </h1>
            {alt && <p className="mt-0.5 text-muted-foreground">{alt}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <TypeBadge business={b} />
              <StatusBadge status={b.status} />
              {b.city && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MapPin className="size-4" aria-hidden />
                  {cityLabel(b.city)}
                </span>
              )}
              {b.startedYear != null && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden />
                  <YearRange business={b} />
                </span>
              )}
            </div>
          </div>
          {admin && (
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                {tc('actions.edit')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-destructive-text"
                aria-label={tc('actions.delete')}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </motion.section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Panel title={t('detail.about')}>
            {b.description ? (
              <p className="leading-relaxed whitespace-pre-line">{b.description}</p>
            ) : (
              <p className="text-muted-foreground">{t('detail.noDescription')}</p>
            )}
          </Panel>
          <LinkedMembers familyId={familyId} businessId={b.id} people={people} admin={admin} />
        </div>

        <div className="min-w-0 space-y-6">
          <ContactPanel business={b} />
          <LocationPanel business={b} />
          <Panel title={t('detail.facts')}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <Fact label={t('detail.started')}>
                {b.startedYear != null ? <span className="ltr-isolate">{b.startedYear}</span> : t('detail.unknown')}
              </Fact>
              <Fact label={t('detail.ended')}>
                {b.endedYear != null ? (
                  <span className="ltr-isolate">{b.endedYear}</span>
                ) : b.status === 'ACTIVE' ? (
                  t('detail.present')
                ) : (
                  t('detail.unknown')
                )}
              </Fact>
              <Fact label={t('detail.employees')} wide>
                {b.employeesRange ? t(`employees.${b.employeesRange}`) : t('detail.unknown')}
              </Fact>
              <Fact label={t('detail.branches')} wide>
                {b.branches.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {b.branches.map((br) => (
                      <span
                        key={br}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
                      >
                        <GitBranch className="size-3" style={{ color: accent }} aria-hidden />
                        {cityLabel(br)}
                      </span>
                    ))}
                  </span>
                ) : (
                  t('detail.unknown')
                )}
              </Fact>
              {admin && (
                <Fact
                  wide
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {t('detail.registrationNo')}
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
                        <Lock className="size-3" aria-hidden />
                        {t('detail.adminOnly')}
                      </span>
                    </span>
                  }
                >
                  {b.registrationNo ? (
                    <span className="ltr-isolate font-mono">{b.registrationNo}</span>
                  ) : (
                    t('detail.unknown')
                  )}
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
      </div>

      {admin && (
        <>
          <BusinessFormSheet familyId={familyId} open={editing} onOpenChange={setEditing} existing={data} />
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('detail.deleteBody', { name })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() =>
                    remove.mutate(b.id, {
                      onSuccess: () => {
                        toast.success(t('detail.deleted'));
                        void navigate({ to: '/f/$familyId/businesses', params: { familyId } });
                      },
                      onError: (e) => toast.error(errorMessage(e, tc)),
                    })
                  }
                >
                  {tc('actions.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function YearRange({ business: b }: { business: Business }) {
  const { t } = useTranslation('business');
  // Two years read left to right ("1950 – 1972"); with a word ("present") only the year is isolated.
  if (b.endedYear != null) return <span className="ltr-isolate">{`${b.startedYear} – ${b.endedYear}`}</span>;
  return (
    <span>
      <span className="ltr-isolate">{b.startedYear}</span>
      {b.status === 'ACTIVE' && ` – ${t('detail.present')}`}
    </span>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass rounded-2xl p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {action && <div className="ms-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, wide, children }: { label: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

function socialHref(kind: 'instagram' | 'facebook' | 'linkedin' | 'whatsapp', value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, '').trim();
  if (kind === 'whatsapp') return `https://wa.me/${handle.replace(/\D/g, '')}`;
  if (kind === 'linkedin') return `https://www.linkedin.com/company/${encodeURIComponent(handle)}`;
  return `https://www.${kind}.com/${encodeURIComponent(handle)}`;
}

function ContactRow({
  href,
  icon,
  label,
  value,
  external,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 text-foreground no-underline transition-colors hover:bg-accent"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-medium">
          <span className="ltr-isolate">{value}</span>
        </span>
      </span>
      {external && (
        <ExternalLink
          className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      )}
    </a>
  );
}

function ContactPanel({ business: b }: { business: Business }) {
  const { t } = useTranslation('business');
  const social = (
    [
      ['instagram', Instagram],
      ['facebook', Facebook],
      ['linkedin', Linkedin],
      ['whatsapp', MessageCircle],
    ] as const
  ).filter(([k]) => b.socialLinks[k]);
  const hasAny = b.phone || b.email || b.website || social.length > 0;
  return (
    <Panel title={t('detail.contact')}>
      {!hasAny && <p className="text-sm text-muted-foreground">{t('detail.noContact')}</p>}
      <div className="-mx-2 space-y-1">
        {b.phone && (
          <ContactRow
            href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}
            icon={<Phone className="size-4" />}
            label={t('detail.call')}
            value={b.phone}
          />
        )}
        {b.email && (
          <ContactRow
            href={`mailto:${b.email}`}
            icon={<Mail className="size-4" />}
            label={t('detail.email')}
            value={b.email}
          />
        )}
        {b.website && (
          <ContactRow
            href={b.website}
            external
            icon={<Globe className="size-4" />}
            label={t('detail.website')}
            value={b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          />
        )}
      </div>
      {social.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('detail.social')}</h3>
          <div className="flex flex-wrap gap-2">
            {social.map(([k, Icon]) => (
              <a
                key={k}
                href={socialHref(k, b.socialLinks[k] ?? '')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground no-underline transition-colors hover:border-primary hover:text-primary"
              >
                <Icon className="size-4" aria-hidden />
                {t(`detail.${k}`)}
              </a>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function LocationPanel({ business: b }: { business: Business }) {
  const { t } = useTranslation('business');
  const cityLabel = useCityLabel();
  const lines = [
    b.address,
    [b.city && cityLabel(b.city), b.state].filter(Boolean).join('، '),
    b.country && cityLabel(b.country),
  ].filter((x): x is string => Boolean(x));
  const mapHref =
    b.lat != null && b.lng != null
      ? `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=17/${b.lat}/${b.lng}`
      : lines.length
        ? `https://www.openstreetmap.org/search?query=${encodeURIComponent([b.address, b.city, b.state, b.country].filter(Boolean).join(', '))}`
        : null;
  return (
    <Panel title={t('detail.location')}>
      {lines.length ? (
        <address className="flex gap-3 not-italic">
          <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span className="space-y-0.5 text-sm">
            {lines.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </span>
        </address>
      ) : (
        <p className="text-sm text-muted-foreground">{t('detail.noLocation')}</p>
      )}
      {mapHref && (
        <Button asChild variant="outline" size="sm" className="mt-4 rounded-full">
          <a href={mapHref} target="_blank" rel="noopener noreferrer">
            <MapPin className="size-4" aria-hidden />
            {t('detail.openMap')}
            <ExternalLink className="size-3.5 opacity-60" aria-hidden />
          </a>
        </Button>
      )}
    </Panel>
  );
}

function LinkedMembers({
  familyId,
  businessId,
  people,
  admin,
}: {
  familyId: string;
  businessId: string;
  people: LinkedPerson[];
  admin: boolean;
}) {
  const { t, i18n } = useTranslation('business');
  const tc = useTranslation().t;
  const graph = useFamilyGraph(familyId);
  const link = useLinkPerson(familyId, businessId);
  const unlink = useUnlinkPerson(familyId, businessId);
  const [adding, setAdding] = useState(false);
  const [newRole, setNewRole] = useState<BusinessRole | null>('PARTNER');
  const linkedIds = useMemo(() => new Set(people.map((p) => p.person.id)), [people]);

  const onError = (e: unknown) => toast.error(errorMessage(e, tc));

  return (
    <Panel
      title={t('detail.people')}
      icon={<Users className="size-5 text-primary" aria-hidden />}
      action={
        admin && (
          <Button
            size="sm"
            variant={adding ? 'ghost' : 'outline'}
            className="rounded-full"
            onClick={() => setAdding((a) => !a)}
          >
            {adding ? <X className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            {adding ? tc('actions.close') : t('detail.linkMember')}
          </Button>
        )
      }
    >
      {admin && adding && graph.data && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4 space-y-2 overflow-hidden rounded-xl border border-dashed border-primary/40 bg-accent/40 p-3"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('form.role')}</span>
            <RoleSelect value={newRole} onChange={setNewRole} />
          </div>
          <PeopleSearchList
            autoFocus
            people={graph.data.people}
            exclude={linkedIds}
            onPick={(personId) => {
              const p = graph.data.people.find((x) => x.id === personId);
              link.mutate(
                { personId, role: newRole },
                {
                  onSuccess: () => p && toast.success(t('detail.linked', { name: personName(p, i18n.language) })),
                  onError,
                },
              );
            }}
          />
        </motion.div>
      )}

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noMembers')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {people.map(({ person: p, role }) => {
            const name = personName(p, i18n.language);
            return (
              <li
                key={p.id}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card p-2.5 sm:gap-3"
              >
                <Link
                  to="/f/$familyId/people/$personId"
                  params={{ familyId, personId: p.id }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-foreground no-underline hover:text-primary"
                >
                  <PersonAvatar photoUrl={p.photoUrl} gender={p.gender} name={name} isLiving={p.isLiving} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {!admin && role && <span>{t(`roles.${role}`)}</span>}
                      <span className="ltr-isolate">{personYears(p)}</span>
                    </span>
                  </span>
                </Link>
                {admin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <RoleSelect
                      value={role}
                      onChange={(r) => link.mutate({ personId: p.id, role: r }, { onError })}
                      className="h-8 w-28 rounded-full text-xs"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn('size-8 rounded-full text-muted-foreground hover:text-destructive-text')}
                      aria-label={`${t('detail.unlink')}: ${name}`}
                      title={t('detail.unlink')}
                      disabled={unlink.isPending}
                      onClick={() =>
                        unlink.mutate(p.id, {
                          onSuccess: () => toast.success(t('detail.unlinked', { name })),
                          onError,
                        })
                      }
                    >
                      <Unlink className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
