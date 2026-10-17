import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LoadingState({ className = 'py-24' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center justify-center gap-2 text-muted-foreground ${className}`} role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{t('states.loading')}</span>
    </div>
  );
}
