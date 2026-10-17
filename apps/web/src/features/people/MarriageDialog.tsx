import { type Marriage, type MarriageStatus, makePartialDate, partialYear } from '@family-tree/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@family-tree/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { useUpdateMarriage } from '#/entities/person/queries.ts';
import { FieldShell, SelectField } from './fields.tsx';

/** Edit a marriage's status and years. */
export function MarriageDialog({
  familyId,
  marriage,
  spouseName,
  onOpenChange,
}: {
  familyId: string;
  marriage: Marriage | null;
  spouseName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('people');
  return (
    <Dialog open={marriage !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader>
          <DialogTitle>{t('marriage.editTitle', { name: spouseName })}</DialogTitle>
        </DialogHeader>
        {marriage && <Body familyId={familyId} marriage={marriage} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ familyId, marriage, onDone }: { familyId: string; marriage: Marriage; onDone: () => void }) {
  const { t } = useTranslation('people');
  const tc = useTranslation().t;
  const update = useUpdateMarriage(familyId);
  const [status, setStatus] = useState<MarriageStatus>(marriage.status);
  const [start, setStart] = useState(String(partialYear(marriage.startDate) ?? ''));
  const [end, setEnd] = useState(String(partialYear(marriage.endDate) ?? ''));
  const [error, setError] = useState<string | null>(null);
  const y = (s: string) => (/^\d{3,4}$/.test(s.trim()) ? Number(s) : null);

  const save = async () => {
    setError(null);
    const s = y(start);
    const e = status === 'MARRIED' ? null : y(end);
    if (s && e && e < s) return setError(t('form.errors.endBeforeStart'));
    // Keep the stored precision when the year did not change.
    const keep = (orig: Marriage['startDate'], year: number | null) =>
      year == null ? null : orig && partialYear(orig) === year ? orig : makePartialDate(year);
    try {
      await update.mutateAsync({
        marriageId: marriage.id,
        input: { status, startDate: keep(marriage.startDate, s), endDate: keep(marriage.endDate, e) },
      });
      toast.success(t('toast.marriageUpdated'));
      onDone();
    } catch (err) {
      setError(errorMessage(err, tc));
    }
  };

  return (
    <>
      <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
        <SelectField<MarriageStatus>
          label={t('marriage.status')}
          value={status}
          onChange={setStatus}
          options={(['MARRIED', 'DIVORCED', 'WIDOWED'] as const).map((v) => ({
            value: v,
            label: t(`marriage.statuses.${v}`),
          }))}
        />
        <FieldShell label={t('marriage.startYear')} htmlFor="m-start">
          <Input
            id="m-start"
            dir="ltr"
            inputMode="numeric"
            value={start}
            onChange={(e) => setStart(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </FieldShell>
        {status !== 'MARRIED' && (
          <FieldShell label={t('marriage.endYear')} htmlFor="m-end">
            <Input
              id="m-end"
              dir="ltr"
              inputMode="numeric"
              value={end}
              onChange={(e) => setEnd(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </FieldShell>
        )}
        {error && (
          <p className="text-sm text-destructive-text sm:col-span-3" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {tc('actions.cancel')}
        </Button>
        <Button onClick={() => void save()} disabled={update.isPending}>
          {update.isPending ? tc('actions.saving') : tc('actions.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
