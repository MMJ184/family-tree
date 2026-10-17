import type { DatePrecision } from '@family-tree/shared';
import {
  Checkbox,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@family-tree/ui';
import type { AnyFieldApi } from '@tanstack/react-form';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateFields } from './personFormModel.ts';

// Small form building blocks shared by the person form and the add-relative dialog.

export function fieldError(field: AnyFieldApi): string | null {
  const first = (field.state.meta.errors as unknown[]).find(Boolean);
  if (!first) return null;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first && 'message' in first) return String((first as { message: unknown }).message);
  return null;
}

export function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string | undefined;
  error?: string | null | undefined;
  hint?: ReactNode | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation('people');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive-text" role="alert">
          {t(`form.errors.${error}`, { defaultValue: error })}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({
  field,
  label,
  multiline,
  dir,
  type = 'text',
  placeholder,
  hint,
  className,
}: {
  field: AnyFieldApi;
  label: ReactNode;
  multiline?: boolean;
  dir?: 'rtl' | 'ltr' | 'auto';
  type?: string;
  placeholder?: string;
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const error = fieldError(field);
  const common = {
    id,
    name: field.name,
    value: (field.state.value as string) ?? '',
    onBlur: field.handleBlur,
    'aria-invalid': error ? true : undefined,
    ...(dir ? { dir } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint} className={className}>
      {multiline ? (
        <Textarea {...common} rows={4} onChange={(e) => field.handleChange(e.target.value)} />
      ) : (
        <Input {...common} type={type} onChange={(e) => field.handleChange(e.target.value)} />
      )}
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  label,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  label: ReactNode;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} htmlFor={id} className={className}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** A partial date: precision (year / month / full date), the parts, and an "approximate" flag. */
export function PartialDateInput({
  value,
  onChange,
  label,
  errors,
}: {
  value: DateFields;
  onChange: (v: DateFields) => void;
  label: ReactNode;
  errors?: { year?: string | null; month?: string | null; day?: string | null };
}) {
  const { t, i18n } = useTranslation('people');
  const id = useId();
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(`${i18n.language}-u-ca-gregory`, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, m - 1, 1)),
    );
  const set = (patch: Partial<DateFields>) => onChange({ ...value, ...patch });
  const error = errors?.year || errors?.month || errors?.day;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={value.precision} onValueChange={(v) => set({ precision: v as DatePrecision })}>
          <SelectTrigger className="w-32" aria-label={t('form.precision')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['YEAR', 'MONTH', 'DAY'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`form.precisions.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.precision === 'DAY' && (
          <Input
            className="w-16"
            inputMode="numeric"
            dir="ltr"
            placeholder={t('form.day')}
            aria-label={t('form.day')}
            aria-invalid={errors?.day ? true : undefined}
            value={value.day}
            onChange={(e) => set({ day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          />
        )}
        {value.precision !== 'YEAR' && (
          <Select value={value.month || undefined} onValueChange={(v) => set({ month: v })}>
            <SelectTrigger
              className="w-32"
              aria-label={t('form.month')}
              aria-invalid={errors?.month ? true : undefined}
            >
              <SelectValue placeholder={t('form.month')} />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {monthName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          id={id}
          className="w-20"
          inputMode="numeric"
          dir="ltr"
          placeholder={t('form.year')}
          aria-label={t('form.year')}
          aria-invalid={errors?.year ? true : undefined}
          value={value.year}
          onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
        />
        <Label className="flex items-center gap-1.5 text-sm font-normal">
          <Checkbox checked={value.approx} onCheckedChange={(c) => set({ approx: c === true })} />
          {t('form.approx')}
        </Label>
      </div>
      {error && (
        <p className="text-xs text-destructive-text" role="alert">
          {t(`form.errors.${error}`)}
        </p>
      )}
    </fieldset>
  );
}
