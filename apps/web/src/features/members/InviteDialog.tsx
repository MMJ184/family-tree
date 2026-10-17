import type { FamilyRole } from '@family-tree/shared';
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
} from '@family-tree/ui';
import { useForm } from '@tanstack/react-form';
import { Eye, Info, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError } from '#/api/core.ts';
import { errorMessage } from '#/components/shared/ErrorState.tsx';
import { useInviteMember } from '#/entities/members/queries.ts';

const schema = z.object({
  name: z.string().trim().min(1, 'required'),
  email: z.string().trim().min(1, 'required').pipe(z.email('invalidEmail')),
  role: z.enum(['ADMIN', 'VIEWER']),
});

interface InviteDialogProps {
  familyId: string;
  familyLabel: string;
  /** Only Super Admin may grant ADMIN (spec §2). */
  canInviteAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteDialog({ familyId, familyLabel, canInviteAdmin, open, onOpenChange }: InviteDialogProps) {
  const { t } = useTranslation('members');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.body', { family: familyLabel })}</DialogDescription>
        </DialogHeader>
        {open && <InviteForm familyId={familyId} canInviteAdmin={canInviteAdmin} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  familyId,
  canInviteAdmin,
  onDone,
}: {
  familyId: string;
  canInviteAdmin: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation(['members', 'common']);
  const invite = useInviteMember(familyId);
  const roles: FamilyRole[] = canInviteAdmin ? ['ADMIN', 'VIEWER'] : ['VIEWER'];

  const form = useForm({
    defaultValues: { name: '', email: '', role: (canInviteAdmin ? 'ADMIN' : 'VIEWER') as FamilyRole },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const entry = await invite.mutateAsync({
          name: value.name.trim(),
          email: value.email.trim(),
          role: value.role,
        });
        toast.success(t('toast.invited', { name: entry.name, role: t(`common:roles.${entry.role}`) }));
        onDone();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') toast.error(t('dialog.conflict'));
        else toast.error(errorMessage(e, (k) => t(`common:${k}`)));
      }
    },
  });

  const errorText = (errors: unknown[]) => {
    const first = errors[0] as { message?: string } | string | undefined;
    if (!first) return null;
    const key = typeof first === 'string' ? first : first.message;
    return (
      <p className="text-xs text-destructive-text" role="alert">
        {t(key === 'invalidEmail' ? 'dialog.invalidEmail' : 'dialog.required')}
      </p>
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 px-6 py-5">
        <form.Field name="name">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="invite-name">{t('dialog.name')}</Label>
              <Input
                id="invite-name"
                autoComplete="name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('dialog.namePlaceholder')}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                autoFocus
              />
              {errorText(field.state.meta.errors)}
            </div>
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">{t('dialog.email')}</Label>
              <Input
                id="invite-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                className="text-start"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={t('dialog.emailPlaceholder')}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
              />
              {errorText(field.state.meta.errors)}
            </div>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('dialog.role')}</legend>
              <div className={cn('grid gap-2', roles.length > 1 && 'sm:grid-cols-2')}>
                {roles.map((r) => {
                  const Icon = r === 'ADMIN' ? ShieldCheck : Eye;
                  const selected = field.state.value === r;
                  return (
                    <label
                      key={r}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        selected ? 'border-primary bg-primary/8' : 'border-border hover:bg-accent',
                      )}
                    >
                      <input
                        type="radio"
                        name="invite-role"
                        value={r}
                        checked={selected}
                        onChange={() => field.handleChange(r)}
                        className="mt-1 accent-[var(--ft-primary)]"
                      />
                      <span className="grid gap-0.5">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                          <Icon className="size-4 text-primary" aria-hidden />
                          {t(`common:roles.${r}`)}
                        </span>
                        <span className="text-xs text-muted-foreground">{t(`roles.${r}`)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {!canInviteAdmin && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-3.5 shrink-0" aria-hidden />
                  {t('dialog.onlySuperAdmin')}
                </p>
              )}
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
              {submitting ? t('common:actions.saving') : t('dialog.send')}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}
