import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Translations live in src/locales/<lang>/<namespace>.json, one namespace per
// feature (common, auth, families, people, ...). Every file is bundled; the
// file name is the namespace. No UI string is hard-coded (CLAUDE.md).

const files = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json', { eager: true });

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, mod] of Object.entries(files)) {
  const match = path.match(/locales\/(\w+)\/([\w-]+)\.json$/);
  if (!match) continue;
  const [, lang, ns] = match as unknown as [string, string, string];
  resources[lang] ??= {};
  resources[lang][ns] = mod.default;
}

export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function initI18n(locale: AppLocale) {
  return i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: Object.keys(resources.en ?? {}),
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function applyDocumentLocale(locale: AppLocale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

export { i18n };
