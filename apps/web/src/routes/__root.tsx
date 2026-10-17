import { Direction, UiLabelsProvider } from '@family-tree/ui';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import { NotFound } from '#/components/shared/NotFound.tsx';
import { usePrefs } from '#/lib/prefs.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  const locale = usePrefs((s) => s.locale);
  const { t } = useTranslation();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    // Radix menus, selects and tabs read the direction from this provider.
    <Direction.Provider dir={dir}>
      <UiLabelsProvider labels={{ close: t('actions.close') }}>
        <Outlet />
      </UiLabelsProvider>
      <Toaster richColors position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} dir={dir} />
    </Direction.Provider>
  );
}
