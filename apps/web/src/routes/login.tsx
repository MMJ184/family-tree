import { Button, cn } from '@family-tree/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { ArrowRight, Globe, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LoadingState } from '#/components/shared/LoadingState.tsx';
import { useDemoUsers, useLogin } from '#/entities/session/queries.ts';
import { initials } from '#/lib/display.ts';
import { usePrefs } from '#/lib/prefs.ts';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: LoginPage,
});

const ROLE_TONE: Record<string, string> = {
  SUPER_ADMIN: 'bg-gold/15 text-gold',
  ADMIN: 'bg-primary/12 text-primary',
  VIEWER: 'bg-muted text-muted-foreground',
};

function LoginPage() {
  const { t, i18n } = useTranslation(['auth', 'common']);
  const { locale, setLocale } = usePrefs();
  const users = useDemoUsers();
  const login = useLogin();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <TreeBackdrop />
      <Button
        variant="ghost"
        size="sm"
        className="absolute end-4 top-4 gap-1.5"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      >
        <Globe className="size-4" />
        {locale === 'ar' ? t('common:topbar.english') : t('common:topbar.arabic')}
      </Button>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass relative w-full max-w-xl rounded-3xl p-6 shadow-2xl sm:p-10"
      >
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-11" />
          <div>
            <div className="font-display text-xl font-bold">{t('common:appName')}</div>
            <div className="text-xs text-gold">{t('common:topbar.demoBadge')}</div>
          </div>
        </div>
        <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>

        <div className="mt-6 flex flex-col gap-2.5">
          {users.isPending && <LoadingState className="py-8" />}
          {users.data?.map(({ user, roles }) => {
            const busy = login.isPending && login.variables === user.id;
            return (
              <button
                key={user.id}
                type="button"
                disabled={login.isPending}
                onClick={() =>
                  login.mutate(user.id, {
                    onSuccess: () => {
                      if (redirect && redirect !== '/login') void navigate({ to: redirect });
                      else void navigate({ to: '/' });
                    },
                  })
                }
                aria-label={t('signInAs', { name: user.name })}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:opacity-60"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 font-bold text-primary">
                  {initials(user.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{user.name}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {roles.length === 0 && <span className="text-xs text-muted-foreground">{t('noAccess')}</span>}
                    {roles.map((r) => (
                      <span
                        key={`${r.role}-${r.familyId}`}
                        className={cn('rounded-full px-2 py-0.5 text-xs font-medium', ROLE_TONE[r.role])}
                      >
                        {t(`common:roles.${r.role}`)} · {r.familyName ?? t('allFamilies')}
                      </span>
                    ))}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(`roleHints.${roles[0]?.role ?? 'VIEWER'}`)}
                  </span>
                </span>
                {busy ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : (
                  <ArrowRight className="size-5 text-muted-foreground transition group-hover:text-primary rtl:-scale-x-100" />
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground" lang={i18n.language}>
          {t('client')}: Al Mansouri Family Office
        </p>
      </motion.div>
    </div>
  );
}

/** Soft drifting branches behind the sign-in card. */
function TreeBackdrop() {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative backdrop, hidden from assistive tech.
    <svg
      className="pointer-events-none absolute inset-0 size-full opacity-[0.18]"
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
    >
      <g fill="none" stroke="var(--ft-primary)" strokeWidth="2" strokeLinecap="round">
        <path d="M600 820C600 640 600 560 600 470M600 560C520 500 430 470 330 460M600 520C690 470 790 440 900 440M330 460C260 420 220 360 200 290M330 460C300 380 330 320 380 260M900 440C960 390 1000 330 1010 260M900 440C880 360 830 300 780 250M600 470C580 380 560 320 520 250M600 470C630 380 660 320 700 250" />
      </g>
      <g fill="var(--ft-gold)">
        {[
          [200, 290],
          [380, 260],
          [1010, 260],
          [780, 250],
          [520, 250],
          [700, 250],
          [330, 460],
          [900, 440],
          [600, 470],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="9" />
        ))}
      </g>
    </svg>
  );
}
