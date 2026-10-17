import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type AppLocale, applyDocumentLocale, i18n } from './i18n.ts';

// Per-viewer preferences: language and colour theme. index.html reads the same
// storage key before React mounts so the first paint has the right direction.

export type ThemeMode = 'auto' | 'light' | 'dark';

interface PrefsState {
  locale: AppLocale;
  theme: ThemeMode;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: ThemeMode) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      locale: 'ar',
      theme: 'auto',
      setLocale: (locale) => {
        applyDocumentLocale(locale);
        void i18n.changeLanguage(locale);
        set({ locale });
      },
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    { name: 'ft:prefs', partialize: (s) => ({ locale: s.locale, theme: s.theme }) },
  ),
);

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.colorScheme = isDark(theme) ? 'dark' : 'light';
}

export function isDark(theme: ThemeMode = usePrefs.getState().theme): boolean {
  return theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}
