import { Button } from '@family-tree/ui';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '#/api/core.ts';
import { NotFound } from './NotFound.tsx';

/** Route error boundary body: a NOT_FOUND from the API shows the not-found page. */
export function ErrorState({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.code === 'NOT_FOUND') return <NotFound />;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <AlertTriangle className="size-10 text-destructive-text" aria-hidden />
      <h1 className="font-display text-2xl">{t('states.error')}</h1>
      <p className="text-muted-foreground">{errorMessage(error, t)}</p>
      {reset && (
        <Button variant="outline" onClick={reset}>
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}

export function errorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) return t(`errors.${error.code}`);
  // Anything else is a bug, not a message for the user: log it, show a generic line.
  console.error(error);
  return t('states.error');
}
