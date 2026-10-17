import { businessStatus, businessType, employeesRange } from '@family-tree/shared';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@family-tree/ui';
import { type AnyFieldApi, useForm, useStore } from '@tanstack/react-form';
import { ImagePlus, Lock, Trash2 } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { type BusinessWithPeople, useSaveBusiness } from '#/entities/business/queries.ts';
import { useFamilyGraph } from '#/entities/family/queries.ts';
import { type BusinessFormValues, toBusinessInput, toFormValues, validateBusinessForm } from './formModel.ts';
import { downscaleLogo } from './logo.ts';
import { MemberPicker } from './MemberPicker.tsx';
import { BusinessLogo, TYPE_ICONS } from './parts.tsx';

interface BusinessFormSheetProps {
  familyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The business to edit (with its linked people); omit to create. */
  existing?: BusinessWithPeople | null;
  onSaved?: (businessId: string) => void;
}

/** Create / edit a business with every spec §3.2.1 field. Admins only; partial data is fine. */
export function BusinessFormSheet({ familyId, open, onOpenChange, existing, onSaved }: BusinessFormSheetProps) {
  const { t } = useTranslation('business');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="font-display text-xl">
            {existing ? t('form.editTitle') : t('form.createTitle')}
          </SheetTitle>
          <SheetDescription>{t('form.hint')}</SheetDescription>
        </SheetHeader>
        {open && (
          <BusinessForm
            key={existing?.business.id ?? 'new'}
            familyId={familyId}
            existing={existing ?? null}
            onDone={(id) => {
              onOpenChange(false);
              onSaved?.(id);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold tracking-wide text-gold uppercase">
        {icon}
        {title}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FieldShell({
  field,
  label,
  hint,
  wide,
  children,
}: {
  field: AnyFieldApi;
  label: string;
  hint?: string | undefined;
  wide?: boolean | undefined;
  children: (id: string, invalid: boolean) => ReactNode;
}) {
  const { t } = useTranslation('business');
  const id = useId();
  const raw = field.state.meta.errors[0] as unknown;
  const err =
    field.state.meta.isTouched && raw ? (typeof raw === 'string' ? raw : (raw as { message?: string }).message) : null;
  return (
    <div className={wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children(id, Boolean(err))}
      {err ? (
        <p className="text-xs text-destructive-text" role="alert">
          {t(`form.errors.${err}`, { defaultValue: err })}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

type TextKey = Exclude<keyof BusinessFormValues, 'type' | 'status' | 'employeesRange' | 'links' | 'logoUrl'>;

function BusinessForm({
  familyId,
  existing,
  onDone,
  onCancel,
}: {
  familyId: string;
  existing: BusinessWithPeople | null;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('business');
  const tc = useTranslation().t;
  const save = useSaveBusiness(familyId);
  const graph = useFamilyGraph(familyId);
  const [apiError, setApiError] = useState<string | null>(null);
  const initial = toFormValues(existing?.business ?? null, existing?.people);

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: validateBusinessForm, onSubmit: validateBusinessForm },
    onSubmit: async ({ value }) => {
      setApiError(null);
      try {
        const id = await save.mutateAsync({
          businessId: existing?.business.id,
          input: toBusinessInput(value),
          links: value.links,
          currentLinks: initial.links,
        });
        toast.success(existing ? t('form.saved') : t('form.created'));
        onDone(id);
      } catch (e) {
        setApiError(errorMessage(e, tc));
      }
    },
  });
  const type = useStore(form.store, (s) => s.values.type);
  const previewName = useStore(form.store, (s) => s.values.name);
  const previewNameAr = useStore(form.store, (s) => s.values.nameAr);

  const text = (
    name: TextKey,
    opts: {
      wide?: boolean;
      hint?: string;
      type?: string;
      dir?: 'ltr' | 'rtl' | 'auto';
      inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
      multiline?: boolean;
    } = {},
  ) => (
    <form.Field name={name}>
      {(field) => (
        <FieldShell field={field} label={t(`form.${name}`)} hint={opts.hint} wide={opts.wide}>
          {(id, invalid) =>
            opts.multiline ? (
              <Textarea
                id={id}
                rows={4}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={invalid || undefined}
              />
            ) : (
              <Input
                id={id}
                type={opts.type ?? 'text'}
                dir={opts.dir}
                inputMode={opts.inputMode}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={invalid || undefined}
              />
            )
          }
        </FieldShell>
      )}
    </form.Field>
  );

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
        <Section title={t('form.sections.basics')}>
          <form.Field name="logoUrl">
            {(field) => (
              <div className="flex items-center gap-4 sm:col-span-2">
                <BusinessLogo
                  business={{
                    name: previewName || '?',
                    nameAr: previewNameAr || null,
                    type,
                    logoUrl: field.state.value || null,
                  }}
                  size={72}
                />
                <LogoPicker value={field.state.value} onChange={(v) => field.handleChange(v)} />
              </div>
            )}
          </form.Field>
          {text('name', { dir: 'ltr' })}
          {text('nameAr', { dir: 'rtl' })}
          <form.Field name="type">
            {(field) => (
              <FieldShell field={field} label={t('form.type')}>
                {(id) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {businessType.options.map((v) => {
                        const Icon = TYPE_ICONS[v];
                        return (
                          <SelectItem key={v} value={v}>
                            <span className="flex items-center gap-2">
                              <Icon className="size-4 text-muted-foreground" aria-hidden />
                              {t(`types.${v}`)}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            )}
          </form.Field>
          <form.Field name="status">
            {(field) => (
              <FieldShell field={field} label={t('form.status')}>
                {(id) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {businessStatus.options.map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`status.${v}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            )}
          </form.Field>
          {type === 'OTHER' && text('typeOther', { wide: true })}
          {text('description', { wide: true, multiline: true })}
        </Section>

        <Section title={t('form.sections.timeline')}>
          {text('startedYear', { inputMode: 'numeric', dir: 'ltr' })}
          {text('endedYear', { inputMode: 'numeric', dir: 'ltr' })}
          <form.Field name="employeesRange">
            {(field) => (
              <FieldShell field={field} label={t('form.employeesRange')}>
                {(id) => (
                  <Select
                    value={field.state.value || 'NONE'}
                    onValueChange={(v) => field.handleChange((v === 'NONE' ? '' : v) as typeof field.state.value)}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">{t('form.notSet')}</SelectItem>
                      {employeesRange.options.map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`employees.${v}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            )}
          </form.Field>
          {text('branches', { hint: t('form.branchesHint') })}
        </Section>

        <Section title={t('form.sections.location')}>
          {text('address', { wide: true })}
          {text('city')}
          {text('state')}
          {text('country')}
          <div className="hidden sm:block" />
          {text('lat', { inputMode: 'decimal', dir: 'ltr', hint: t('form.mapHint') })}
          {text('lng', { inputMode: 'decimal', dir: 'ltr' })}
        </Section>

        <Section title={t('form.sections.contact')}>
          {text('phone', { type: 'tel', inputMode: 'tel', dir: 'ltr' })}
          {text('email', { type: 'email', inputMode: 'email', dir: 'ltr' })}
          {text('website', { type: 'url', inputMode: 'url', dir: 'ltr', wide: true })}
        </Section>

        <Section title={t('form.sections.social')}>
          {text('instagram', { dir: 'ltr' })}
          {text('facebook', { dir: 'ltr' })}
          {text('linkedin', { dir: 'ltr' })}
          {text('whatsapp', { dir: 'ltr' })}
        </Section>

        <Section title={t('form.sections.admin')} icon={<Lock className="size-3.5" aria-hidden />}>
          {text('registrationNo', { dir: 'ltr', hint: t('form.registrationHint'), wide: true })}
        </Section>

        <section className="space-y-3">
          <h3 className="font-display text-sm font-semibold tracking-wide text-gold uppercase">
            {t('form.sections.members')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('form.membersHint')}</p>
          {graph.data ? (
            <form.Field name="links">
              {(field) => (
                <MemberPicker
                  people={graph.data.people}
                  value={field.state.value}
                  onChange={(v) => field.handleChange(v)}
                />
              )}
            </form.Field>
          ) : (
            <LoadingState className="py-4" />
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-popover px-6 py-3">
        {apiError && (
          <p className="me-auto text-sm text-destructive-text" role="alert">
            {apiError}
          </p>
        )}
        <div className="ms-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc('actions.cancel')}
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button type="submit" disabled={submitting}>
                {submitting ? tc('actions.saving') : tc('actions.save')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </form>
  );
}

function LogoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('business');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('form.uploadLogo')}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onChange(await downscaleLogo(file));
          } catch {
            toast.error(t('form.errors.image'));
          }
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <ImagePlus className="size-4" aria-hidden />
        {t('form.uploadLogo')}
      </Button>
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
          <Trash2 className="size-4" aria-hidden />
          {t('form.removeLogo')}
        </Button>
      )}
    </div>
  );
}
