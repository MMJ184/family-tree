import { Button } from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="font-display text-2xl">{t('states.notFound')}</h1>
      <p className="text-muted-foreground">{t('states.notFoundBody')}</p>
      <Button asChild variant="outline">
        <Link to="/">{t('actions.back')}</Link>
      </Button>
    </div>
  );
}
