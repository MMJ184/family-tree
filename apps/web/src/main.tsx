import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import { onExternalChange } from './api/demo.ts';
import { applyDocumentLocale, initI18n } from './lib/i18n.ts';
import { applyTheme, usePrefs } from './lib/prefs.ts';
import { queryClient } from './lib/query.ts';
import { routeTree } from './routeTree.gen';
import './styles.css';

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

onExternalChange(() => void queryClient.invalidateQueries());

const { locale, theme } = usePrefs.getState();
applyDocumentLocale(locale);
applyTheme(theme);

void initI18n(locale).then(() => {
  const rootElement = document.getElementById('app');
  if (rootElement && !rootElement.innerHTML) {
    ReactDOM.createRoot(rootElement).render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }
});
