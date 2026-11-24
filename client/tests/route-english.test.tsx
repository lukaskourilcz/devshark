import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ShellLanguageProvider, translateShell, translateStatic, useT } from '../src/i18n/LanguageContext';
import { en, shellEn, type TranslationKey } from '../src/i18n/translations';
import { checkoutEn } from '../src/i18n/translations.checkoutRoute';
import { codingEn } from '../src/i18n/translations.codingRoute';
import { operationsEn } from '../src/i18n/translations.operationsRoute';
import { playEn } from '../src/i18n/translations.playRoute';

const scopes = [checkoutEn, codingEn, operationsEn, playEn] as const;
type Words = Partial<Record<TranslationKey, string>>;

it('renders every route label on direct entry and after switching features, without modifying shell copy', () => {
  for (const key of ['play.title', 'play.hostFallback', 'play.playerFallback'] as const) {
    expect(shellEn).not.toHaveProperty([key]);
    expect(playEn[key]).toBe(en[key]);
  }
  const baseKeys = Object.keys(shellEn);
  const seen = new Set(baseKeys);
  for (const words of scopes) {
    const direct = renderHook(() => useT(words), { wrapper: ShellLanguageProvider });
    for (const key of Object.keys(words) as TranslationKey[]) {
      expect(direct.result.current(key)).toBe(en[key]);
    }
    direct.unmount();
  }
  const initialProps: { words: Words } = { words: playEn };
  const { result, rerender } = renderHook(({ words }) => useT(words), {
    initialProps, wrapper: ShellLanguageProvider,
  });
  for (const words of [playEn, checkoutEn, operationsEn, codingEn]) {
    rerender({ words });
    for (const key of Object.keys(words) as TranslationKey[]) {
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(result.current(key, { n: 3 })).toBe(translateStatic(key, { n: 3 }));
    }
    expect(result.current('nav.menu')).toBe(shellEn['nav.menu']);
  }
  expect(Object.keys(shellEn)).toEqual(baseKeys);
  expect(seen.size).toBe(Object.keys(en).length);
});

it('keeps pre-rendered metadata, API failures and phone entry text on the initial navigation', () => {
  for (const key of ['nav.menu', 'footer.darkMode', 'footer.lightMode', 'coding.phoneNotice', 'coding.verdict.graderUnavailable', 'billing.cancel.lead'] as const) {
    expect(translateShell(key)).toBe(en[key]);
    expect(translateShell(key)).not.toBe(key);
  }
});
