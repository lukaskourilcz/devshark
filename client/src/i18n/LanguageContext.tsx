import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { en, shellEn, type TranslationKey } from './translations';

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

/** Synchronous access to the complete English dictionary outside the application shell. */
export function translateStatic(key: TranslationKey, vars?: Vars): string {
  return interpolate(en[key] ?? key, vars);
}

type EnglishWords = Partial<Record<TranslationKey, string>>;

const shellWords: EnglishWords = shellEn;

export function translateShell(key: TranslationKey, vars?: Vars): string {
  return interpolate(shellWords[key] ?? key, vars);
}

function LanguageRoot({ children, t }: { children: ReactNode; t: LanguageContextValue['t'] }) {
  // The document is English once the app runs. A prerendered public guide
  // arrives with its own `lang` and `data-public-locale` (vite.config.ts); the
  // guide's article keeps its own `lang` attribute, and the document goes back
  // to English as soon as React mounts.
  useEffect(() => {
    document.documentElement.lang = 'en';
    delete document.documentElement.dataset.publicLocale;
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({ t }), [t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  return <LanguageRoot t={translateStatic}>{children}</LanguageRoot>;
}

export function ShellLanguageProvider({ children }: { children: ReactNode }) {
  return <LanguageRoot t={translateShell}>{children}</LanguageRoot>;
}

export function useLanguage(words?: EnglishWords): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  const value = useMemo(() => {
    if (!ctx || !words) return ctx;
    const t: LanguageContextValue['t'] = (key, vars) => {
      const template = words[key];
      return template === undefined ? ctx.t(key, vars) : interpolate(template, vars);
    };
    return { t };
  }, [ctx, words]);
  if (!value) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return value;
}

// Convenience hook for components that only need the translate function.
export function useT(words?: EnglishWords): LanguageContextValue['t'] {
  return useLanguage(words).t;
}
