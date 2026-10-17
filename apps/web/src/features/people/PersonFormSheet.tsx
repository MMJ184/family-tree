import type { Gender, Person } from '@family-tree/shared';
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
} from '@family-tree/ui';
import { useForm } from '@tanstack/react-form';
import { Camera, Plus, Trash2, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { PersonAvatar } from '#/components/shared/PersonAvatar.tsx';
import { useCreatePerson, useUpdatePerson } from '#/entities/person/queries.ts';
import { personName } from '#/lib/display.ts';
import { FieldShell, PartialDateInput, SelectField, TextField } from './fields.tsx';
import { type PersonFormValues, personFormSchema, toFormValues, toPersonInput } from './personFormModel.ts';
import { downscalePhoto } from './photo.ts';

interface PersonFormSheetProps {
  familyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person to edit; omit to create a new person in the family. */
  person?: Person | null;
  onSaved?: (person: Person) => void;
}

/** Create / edit a person: every spec §3.2 field, grouped in sections. Admins only. */
export function PersonFormSheet({ familyId, open, onOpenChange, person, onSaved }: PersonFormSheetProps) {
  const { t } = useTranslation('people');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="font-display text-xl">
            {person ? t('form.editTitle') : t('form.createTitle')}
          </SheetTitle>
          <SheetDescription>{t('form.subtitle')}</SheetDescription>
        </SheetHeader>
        {open && (
          <PersonForm
            key={person?.id ?? 'new'}
            familyId={familyId}
            person={person ?? null}
            onDone={(p) => {
              onOpenChange(false);
              onSaved?.(p);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-gold">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function PersonForm({
  familyId,
  person,
  onDone,
  onCancel,
}: {
  familyId: string;
  person: Person | null;
  onDone: (p: Person) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation('people');
  const tc = useTranslation().t;
  const create = useCreatePerson(familyId);
  const update = useUpdatePerson(familyId);
  const [apiError, setApiError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: toFormValues(person),
    validators: {
      onSubmit: ({ value }) => {
        const r = personFormSchema.safeParse(value);
        if (r.success) return undefined;
        const fields: Record<string, string> = {};
        for (const issue of r.error.issues) {
          const path = issue.path.join('.');
          fields[path] ??= issue.message;
        }
        return { fields };
      },
    },
    onSubmit: async ({ value }) => {
      setApiError(null);
      try {
        const input = toPersonInput(value);
        const saved = person
          ? await update.mutateAsync({ personId: person.id, input })
          : await create.mutateAsync({ input });
        toast.success(
          person
            ? t('toast.updated', { name: personName(saved, i18n.language) })
            : t('toast.created', { name: personName(saved, i18n.language) }),
        );
        onDone(saved);
      } catch (e) {
        setApiError(errorMessage(e, tc));
      }
    },
  });

  const text = (
    name: Exclude<keyof PersonFormValues, 'gender' | 'birth' | 'death' | 'isLiving' | 'custom' | 'photoUrl'>,
    extra?: Partial<Parameters<typeof TextField>[0]>,
  ) => (
    <form.Field name={name}>{(field) => <TextField field={field} label={t(`fields.${name}`)} {...extra} />}</form.Field>
  );

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      noValidate
    >
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
        {/* Photo */}
        <form.Field name="photoUrl">
          {(field) => (
            <PhotoPicker
              value={field.state.value}
              onChange={(v) => field.handleChange(v)}
              gender={form.getFieldValue('gender')}
              name={form.getFieldValue('nameAr') || form.getFieldValue('nameEn') || form.getFieldValue('firstName')}
            />
          )}
        </form.Field>

        <Section title={t('form.sections.names')}>
          {text('nameAr', { dir: 'rtl' })}
          {text('nameEn', { dir: 'ltr' })}
          {text('firstName')}
          {text('middleName')}
          {text('lastName')}
          {text('maidenName')}
        </Section>

        <Section title={t('form.sections.nasab')}>
          {text('fatherName')}
          {text('grandfatherName')}
          {text('tribeName')}
          {text('kunya', { placeholder: t('form.kunyaHint') })}
          {text('laqab')}
          <form.Field name="gender">
            {(field) => (
              <SelectField<Gender>
                label={t('fields.gender')}
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                options={(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => ({ value: g, label: tc(`gender.${g}`) }))}
              />
            )}
          </form.Field>
        </Section>

        <section className="space-y-4">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-gold">
            {t('form.sections.dates')}
          </h3>
          <form.Field name="birth">
            {(field) => (
              <form.Subscribe selector={(s) => s.fieldMeta}>
                {(meta) => (
                  <PartialDateInput
                    label={t('fields.birth')}
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    errors={{
                      year: firstMeta(meta, 'birth.year'),
                      month: firstMeta(meta, 'birth.month'),
                      day: firstMeta(meta, 'birth.day'),
                    }}
                  />
                )}
              </form.Subscribe>
            )}
          </form.Field>
          <form.Field name="isLiving">
            {(field) => (
              <form.Subscribe selector={(s) => Boolean(s.values.death.year.trim())}>
                {(hasDeath) => (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                    <Label htmlFor="isLiving" className="flex flex-col gap-0.5">
                      <span>{t('fields.isLiving')}</span>
                      {hasDeath && (
                        <span className="text-xs font-normal text-muted-foreground">{t('form.livingLocked')}</span>
                      )}
                    </Label>
                    <Switch
                      id="isLiving"
                      checked={hasDeath ? false : field.state.value}
                      disabled={hasDeath}
                      onCheckedChange={(c) => field.handleChange(c)}
                    />
                  </div>
                )}
              </form.Subscribe>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.isLiving && !s.values.death.year.trim()}>
            {(living) =>
              !living && (
                <form.Field name="death">
                  {(field) => (
                    <form.Subscribe selector={(s) => s.fieldMeta}>
                      {(meta) => (
                        <PartialDateInput
                          label={t('fields.death')}
                          value={field.state.value}
                          onChange={(v) => {
                            field.handleChange(v);
                            if (v.year.trim()) form.setFieldValue('isLiving', false);
                          }}
                          errors={{
                            year: firstMeta(meta, 'death.year'),
                            month: firstMeta(meta, 'death.month'),
                            day: firstMeta(meta, 'death.day'),
                          }}
                        />
                      )}
                    </form.Subscribe>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
        </section>

        <Section title={t('form.sections.places')}>
          {text('birthPlace')}
          {text('currentCity')}
        </Section>

        <Section title={t('form.sections.contact')}>
          {text('phone', { type: 'tel', dir: 'ltr', hint: t('form.contactHint') })}
          {text('email', { type: 'email', dir: 'ltr' })}
        </Section>

        <Section title={t('form.sections.work')}>
          {text('occupation')}
          {text('education')}
        </Section>

        <section className="space-y-4">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-gold">
            {t('form.sections.notes')}
          </h3>
          {text('notes', { multiline: true })}
          {text('marriedIntoNote', { hint: t('form.marriedIntoHint') })}
        </section>

        <section className="space-y-3">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-gold">
            {t('form.sections.custom')}
          </h3>
          <form.Field name="custom" mode="array">
            {(field) => (
              <div className="space-y-2">
                {field.state.value.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('form.customEmpty')}</p>
                )}
                {field.state.value.map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; TanStack Form addresses them by index.
                  <div key={i} className="flex items-center gap-2">
                    <form.Field name={`custom[${i}].key`}>
                      {(sub) => (
                        <Input
                          className="flex-1"
                          placeholder={t('form.customKey')}
                          aria-label={t('form.customKey')}
                          value={sub.state.value}
                          onChange={(e) => sub.handleChange(e.target.value)}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`custom[${i}].value`}>
                      {(sub) => (
                        <Input
                          className="flex-1"
                          placeholder={t('form.customValue')}
                          aria-label={t('form.customValue')}
                          value={sub.state.value}
                          onChange={(e) => sub.handleChange(e.target.value)}
                        />
                      )}
                    </form.Field>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => field.removeValue(i)}
                      aria-label={tc('actions.remove')}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => field.pushValue({ key: '', value: '' })}
                >
                  <Plus /> {t('form.customAdd')}
                </Button>
              </div>
            )}
          </form.Field>
        </section>
      </div>

      <div className="border-t border-border bg-popover px-6 py-4">
        {apiError && (
          <p
            className="mb-3 rounded-md border border-destructive-border/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
            role="alert"
          >
            {apiError}
          </p>
        )}
        <form.Subscribe selector={(s) => [s.isSubmitting, s.errorMap.onSubmit] as const}>
          {([submitting, submitError]) => (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {Boolean(submitError) && !apiError && (
                <p className="me-auto text-sm text-destructive-text">{tc('errors.VALIDATION')}</p>
              )}
              <Button type="button" variant="outline" onClick={onCancel}>
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? tc('actions.saving') : tc('actions.save')}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

function firstMeta(meta: Record<string, { errors?: unknown[] } | undefined>, key: string): string | null {
  const e = meta[key]?.errors?.find(Boolean);
  return typeof e === 'string' ? e : null;
}

function PhotoPicker({
  value,
  onChange,
  gender,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  gender: Gender;
  name: string;
}) {
  const { t } = useTranslation('people');
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <PersonAvatar photoUrl={value || null} gender={gender} name={name} size={88} />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('fields.photo')}</span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Camera /> {value ? t('form.photoChange') : t('form.photoUpload')}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              <X /> {t('form.photoRemove')}
            </Button>
          )}
        </div>
        <FieldShell label={<span className="sr-only">{t('fields.photo')}</span>} hint={t('form.photoHint')}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('fields.photo')}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              try {
                onChange(await downscalePhoto(file));
              } catch {
                toast.error(t('form.photoError'));
              } finally {
                setBusy(false);
              }
            }}
          />
        </FieldShell>
      </div>
    </div>
  );
}
