import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { en, type TranslationKey } from './translations';

// The app ships one language, English, and `en` in translations.ts is the one
// source of its copy. `t` resolves a key against it and fills in `{name}`
// placeholders; a key missing from the dictionary renders as the key itself.

type Vars = Record<string, string | number>;

interface LanguageContextValue {
  t: (key: TranslationKey, vars?: Vars) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/**
 * Translation for code outside the React tree (error boundaries, the api
 * layer). It reads the same dictionary as useT().
 */
export function translateStatic(key: TranslationKey, vars?: Vars): string {
  return interpolate(en[key] ?? key, vars);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // The document is English once the app runs. A prerendered public guide
  // arrives with its own `lang` and `data-public-locale` (vite.config.ts); the
  // guide's article keeps its own `lang` attribute, and the document goes back
  // to English as soon as React mounts.
  useEffect(() => {
    document.documentElement.lang = 'en';
    delete document.documentElement.dataset.publicLocale;
  }, []);

  const t = useCallback((key: TranslationKey, vars?: Vars): string => translateStatic(key, vars), []);

  const value = useMemo<LanguageContextValue>(() => ({ t }), [t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

// Convenience hook for components that only need the translate function.
export function useT(): LanguageContextValue['t'] {
  return useLanguage().t;
}
