import type { Family } from '@family-tree/shared';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  TooltipProvider,
} from '@family-tree/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ChevronDown, Plus, TreePine } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { PageHeader } from '#/components/shared/PageHeader.tsx';
import { useArchivedFamilies, useArchiveFamily, useRestoreFamily } from '#/entities/family/mutations.ts';
import { useFamilies } from '#/entities/family/queries.ts';
import { familyName } from '#/lib/display.ts';
import { FamilyCard } from './FamilyCard.tsx';
import { FamilyFormDialog } from './FamilyFormDialog.tsx';

/** Super Admin's list of every family on the client account (spec §3.1). */
export function FamiliesPage({ clientName }: { clientName: string }) {
  const { t, i18n } = useTranslation(['families', 'common']);
  const active = useFamilies();
  const archived = useArchivedFamilies();
  const archive = useArchiveFamily();
  const restore = useRestoreFamily();
  const [dialog, setDialog] = useState<{ family?: Family } | null>(null);
  const [toArchive, setToArchive] = useState<Family | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const tc = (k: string) => t(`common:${k}`);

  const doRestore = (f: Family) =>
    restore.mutate(f.id, {
      onSuccess: (r) => toast.success(t('toast.restored', { name: familyName(r, i18n.language) })),
      onError: (e) => toast.error(errorMessage(e, tc)),
    });

  if (active.isPending) return <LoadingState />;
  if (active.error) return <ErrorState error={active.error} />;
  const archivedList = archived.data ?? [];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle', { client: clientName })}
          actions={
            <Button onClick={() => setDialog({})}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          }
        />

        {active.data.length === 0 ? (
          <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
            <TreePine className="size-10 text-primary" aria-hidden />
            <p className="max-w-sm text-muted-foreground">{t('empty')}</p>
            <Button onClick={() => setDialog({})}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {active.data.map((s, i) => (
                <FamilyCard
                  key={s.family.id}
                  summary={s}
                  index={i}
                  onEdit={() => setDialog({ family: s.family })}
                  onArchive={() => setToArchive(s.family)}
                  onRestore={() => doRestore(s.family)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {archivedList.length > 0 && (
          <Collapsible open={showArchived} onOpenChange={setShowArchived} className="mt-10">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-start hover:text-foreground"
              >
                <Archive className="size-5 text-muted-foreground" aria-hidden />
                <span className="font-display text-lg font-bold">{t('archivedTitle')}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                  {archivedList.length}
                </span>
                <span className="hidden text-sm text-muted-foreground sm:inline">{t('archivedHint')}</span>
                <ChevronDown
                  className={`ms-auto size-5 text-muted-foreground transition-transform ${showArchived ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 grid gap-5 opacity-90 sm:grid-cols-2 xl:grid-cols-3"
              >
                {archivedList.map((s, i) => (
                  <FamilyCard
                    key={s.family.id}
                    summary={s}
                    index={i}
                    onEdit={() => {}}
                    onArchive={() => {}}
                    onRestore={() => doRestore(s.family)}
                  />
                ))}
              </motion.div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <FamilyFormDialog
          open={dialog != null}
          onOpenChange={(o) => !o && setDialog(null)}
          {...(dialog?.family ? { family: dialog.family } : {})}
        />

        <AlertDialog open={toArchive != null} onOpenChange={(o) => !o && setToArchive(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('archiveConfirmTitle', { name: toArchive ? familyName(toArchive, i18n.language) : '' })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('archiveConfirmBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  if (!toArchive) return;
                  archive.mutate(toArchive.id, {
                    onSuccess: (f) => {
                      toast.success(t('toast.archived', { name: familyName(f, i18n.language) }));
                      setShowArchived(true);
                    },
                    onError: (e) => toast.error(errorMessage(e, tc)),
                  });
                }}
              >
                {t('archive')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
