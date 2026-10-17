import { Button } from '@family-tree/ui';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Sprout } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Shown to a signed-in user who has no family yet. Says nothing about other families on the account. */
export function NoFamily() {
  const { t } = useTranslation('families');
  return (
    <div className="mx-auto flex w-full max-w-xl p-4 py-16 sm:p-6 sm:py-24">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass flex w-full flex-col items-center gap-4 rounded-3xl px-6 py-12 text-center shadow-xl"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Sprout className="size-8" aria-hidden />
        </span>
        <h1 className="font-display text-2xl font-bold">{t('noFamily.title')}</h1>
        <p className="max-w-sm text-muted-foreground">{t('noFamily.body')}</p>
        <Button asChild variant="outline">
          <Link to="/login">{t('noFamily.switchUser')}</Link>
        </Button>
      </motion.div>
    </div>
  );
}
