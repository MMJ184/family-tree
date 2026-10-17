import type { Family, FamilyInput } from '@family-tree/shared';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@family-tree/ui';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Check, Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { useCreateFamily, useUpdateFamily } from '#/entities/family/mutations.ts';
import { familyName } from '#/lib/display.ts';
import { FAMILY_COLORS } from './colors.ts';

const formSchema = z.object({
  name: z.string().trim().min(1, 'required'),
  nameAr: z.string().trim().min(1, 'required'),
  surname: z.string(),
  nativePlace: z.string(),
  description: z.string(),
  color: z.string().min(1),
});
type FormValues = z.infer<typeof formSchema>;

function toInput(v: FormValues, coverUrl: string | null): FamilyInput {
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: v.name.trim(),
    nameAr: v.nameAr.trim(),
    surname: opt(v.surname),
    nativePlace: opt(v.nativePlace),
    description: opt(v.description),
    coverUrl,
    color: v.color,
  };
}

interface FamilyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent: create a new family. */
  family?: Family;
}

/** Create or edit a family's details: names in both languages, surname, native place, description, colour. */
export function FamilyFormDialog({ open, onOpenChange, family }: FamilyFormDialogProps) {
  const { t } = useTranslation('families');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            {family ? t('form.editTitle') : t('form.createTitle')}
          </DialogTitle>
          <DialogDescription>{family ? t('form.editBody') : t('form.createBody')}</DialogDescription>
        </DialogHeader>
        {/* Keyed so each opening starts from the family's current values. */}
        {open && <FamilyForm key={family?.id ?? 'new'} family={family} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FamilyForm({ family, onDone }: { family: Family | undefined; onDone: () => void }) {
  const { t, i18n } = useTranslation(['families', 'common']);
  const create = useCreateFamily();
  const update = useUpdateFamily();
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      name: family?.name ?? '',
      nameAr: family?.nameAr ?? '',
      surname: family?.surname ?? '',
      nativePlace: family?.nativePlace ?? '',
      description: family?.description ?? '',
      color: family?.color ?? FAMILY_COLORS[0],
    } satisfies FormValues as FormValues,
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const input = toInput(value, family?.coverUrl ?? null);
      try {
        if (family) {
          await update.mutateAsync({ familyId: family.id, input });
          toast.success(t('toast.updated'));
          onDone();
        } else {
          const created = await create.mutateAsync(input);
          toast.success(t('toast.created', { name: familyName(created, i18n.language) }));
          onDone();
          void navigate({ to: '/f/$familyId/members', params: { familyId: created.id } });
        }
      } catch (e) {
        toast.error(errorMessage(e, (k) => t(`common:${k}`)));
      }
    },
  });

  const fieldError = (errors: unknown[]) =>
    errors.length > 0 ? (
      <p className="text-xs text-destructive-text" role="alert">
        {t('form.required')}
      </p>
    ) : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="family-name">{t('form.name')}</Label>
              <Input
                id="family-name"
                dir="ltr"
                lang="en"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('form.namePlaceholder')}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                autoFocus
              />
              {fieldError(field.state.meta.errors)}
            </div>
          )}
        </form.Field>
        <form.Field name="nameAr">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="family-name-ar">{t('form.nameAr')}</Label>
              <Input
                id="family-name-ar"
                dir="rtl"
                lang="ar"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('form.nameArPlaceholder')}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
              />
              {fieldError(field.state.meta.errors)}
            </div>
          )}
        </form.Field>
        <form.Field name="surname">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="family-surname">{t('form.surname')}</Label>
              <Input
                id="family-surname"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('form.surnamePlaceholder')}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="nativePlace">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="family-native">{t('form.nativePlace')}</Label>
              <Input
                id="family-native"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('form.nativePlacePlaceholder')}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="family-description">{t('form.description')}</Label>
              <Textarea
                id="family-description"
                rows={3}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="color">
          {(field) => (
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">{t('form.color')}</legend>
              <div className="flex flex-wrap gap-2.5">
                {FAMILY_COLORS.map((c, i) => {
                  const selected = field.state.value === c;
                  return (
                    <label
                      key={c}
                      className={cn(
                        'relative flex size-9 cursor-pointer items-center justify-center rounded-full shadow-sm transition-transform hover:scale-110 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
                        selected && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover',
                      )}
                      style={{ background: c }}
                    >
                      <input
                        type="radio"
                        name="family-color"
                        value={c}
                        checked={selected}
                        onChange={() => field.handleChange(c)}
                        className="sr-only"
                        aria-label={t('form.colorOption', { n: i + 1 })}
                      />
                      {selected && <Check className="size-4 text-white" aria-hidden />}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </form.Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common:actions.cancel')}
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              {submitting ? t('common:actions.saving') : family ? t('common:actions.save') : t('form.create')}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

/** "Edit family" button + dialog, styled for the coloured overview hero (Super Admin and the family's admins). */
export function EditFamilyButton({ family }: { family: Family }) {
  const { t } = useTranslation('families');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-white/35 bg-white/15 text-white backdrop-blur hover:bg-white/25 hover:text-white"
        onClick={() => setOpen(true)}
      >
        <Pencil aria-hidden />
        {t('editFamily')}
      </Button>
      <FamilyFormDialog open={open} onOpenChange={setOpen} family={family} />
    </>
  );
}
