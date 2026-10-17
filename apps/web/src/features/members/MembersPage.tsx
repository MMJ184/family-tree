import type { EffectiveRole, FamilyRole } from '@family-tree/shared';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@family-tree/ui';
import { motion } from 'framer-motion';
import { Crown, Eye, MoreHorizontal, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { FamilyAccessEntry } from '#/api/members.ts';
import { ErrorState, errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PageHeader } from '#/components/shared/PageHeader.tsx';
import { useChangeRole, useFamilyAccess, useRemoveMember } from '#/entities/members/queries.ts';
import { initials } from '#/lib/display.ts';
import { InviteDialog } from './InviteDialog.tsx';

const ROLE_ICON: Record<EffectiveRole, typeof Eye> = { SUPER_ADMIN: Crown, ADMIN: ShieldCheck, VIEWER: Eye };
const ROLE_TONE: Record<EffectiveRole, string> = {
  SUPER_ADMIN: 'bg-gold/15 text-gold border-gold/30',
  ADMIN: 'bg-primary/12 text-primary border-primary/25',
  VIEWER: 'bg-muted text-muted-foreground border-border',
};

interface MembersPageProps {
  familyId: string;
  familyLabel: string;
  familyColor: string;
  /** The signed-in user's role here: SUPER_ADMIN or ADMIN (the route shows Viewers a not-found page). */
  myRole: EffectiveRole;
}

/** Who has access to one family; invite, change role and remove (spec §2, §3.1). */
export function MembersPage({ familyId, familyLabel, familyColor, myRole }: MembersPageProps) {
  const { t } = useTranslation(['members', 'common']);
  const access = useFamilyAccess(familyId);
  const changeRole = useChangeRole(familyId);
  const remove = useRemoveMember(familyId);
  const [inviting, setInviting] = useState(false);
  const [toRemove, setToRemove] = useState<FamilyAccessEntry | null>(null);
  const isSuper = myRole === 'SUPER_ADMIN';
  const tc = (k: string) => t(`common:${k}`);

  /** Super Admin manages everyone but other Super Admins; a Family Admin only Viewers. */
  const canManage = (e: FamilyAccessEntry) => e.role !== 'SUPER_ADMIN' && (isSuper || e.role === 'VIEWER');

  const setRole = (e: FamilyAccessEntry, role: FamilyRole) =>
    changeRole.mutate(
      { userId: e.userId, role },
      {
        onSuccess: () => toast.success(t('toast.roleChanged', { name: e.name, role: t(`common:roles.${role}`) })),
        onError: (err) => toast.error(errorMessage(err, tc)),
      },
    );

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { family: familyLabel })}
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden />
            {t('invite')}
          </Button>
        }
      />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="roles-title"
        className="mb-6"
      >
        <h2 id="roles-title" className="sr-only">
          {t('roles.title')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['SUPER_ADMIN', 'ADMIN', 'VIEWER'] as const).map((r, i) => {
            const Icon = ROLE_ICON[r];
            return (
              <motion.div
                key={r}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass rounded-2xl p-4"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn('flex size-8 items-center justify-center rounded-full border', ROLE_TONE[r])}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="font-semibold">{t(`common:roles.${r}`)}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`roles.${r}`)}</p>
              </motion.div>
            );
          })}
        </div>
      </motion.section>

      {access.isPending ? (
        <LoadingState />
      ) : access.error ? (
        <ErrorState error={access.error} reset={() => void access.refetch()} />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="glass overflow-hidden rounded-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ background: familyColor }} aria-hidden />
            {t('count', { count: access.data.length })}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2.5 text-start font-medium">
                  {t('table.person')}
                </th>
                <th scope="col" className="hidden px-4 py-2.5 text-start font-medium md:table-cell">
                  {t('table.email')}
                </th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">
                  {t('table.role')}
                </th>
                <th scope="col" className="w-12 px-2 py-2.5">
                  <span className="sr-only">{t('table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {access.data.map((e) => {
                const Icon = ROLE_ICON[e.role];
                return (
                  <tr key={e.userId} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="w-full max-w-0 px-4 py-3 md:w-auto md:max-w-none">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            'flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                            ROLE_TONE[e.role],
                          )}
                        >
                          {initials(e.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span className="truncate">{e.name}</span>
                            {e.isYou && (
                              <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                {t('you')}
                              </span>
                            )}
                          </div>
                          <div className="ltr-isolate truncate text-xs text-muted-foreground md:hidden">{e.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      <span className="ltr-isolate">{e.email}</span>
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold',
                          ROLE_TONE[e.role],
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {t(`common:roles.${e.role}`)}
                      </span>
                      {e.role === 'SUPER_ADMIN' && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{t('accountWide')}</div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-end">
                      {canManage(e) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label={t('actionsFor', { name: e.name })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isSuper && e.role === 'VIEWER' && (
                              <DropdownMenuItem onSelect={() => setRole(e, 'ADMIN')}>
                                <ShieldCheck className="size-4" />
                                {t('makeAdmin')}
                              </DropdownMenuItem>
                            )}
                            {isSuper && e.role === 'ADMIN' && (
                              <DropdownMenuItem onSelect={() => setRole(e, 'VIEWER')}>
                                <Eye className="size-4" />
                                {t('makeViewer')}
                              </DropdownMenuItem>
                            )}
                            {isSuper && <DropdownMenuSeparator />}
                            <DropdownMenuItem onSelect={() => setToRemove(e)} className="text-destructive-text">
                              <UserMinus className="size-4 rtl:-scale-x-100" />
                              {t('remove')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      <InviteDialog
        familyId={familyId}
        familyLabel={familyLabel}
        canInviteAdmin={isSuper}
        open={inviting}
        onOpenChange={setInviting}
      />

      <AlertDialog open={toRemove != null} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeConfirmTitle', { name: toRemove?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('removeConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = toRemove;
                if (!target) return;
                remove.mutate(target.userId, {
                  onSuccess: () => toast.success(t('toast.removed', { name: target.name })),
                  onError: (err) => toast.error(errorMessage(err, tc)),
                });
              }}
            >
              {t('common:actions.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
