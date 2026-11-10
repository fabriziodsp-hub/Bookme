import { createT, lookup, type Locale } from '@salon/i18n';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

const Ctx = createContext<Locale>('de');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

/** t('ui.submit'), t('ui.minutes', { n: 30 }); list(key) for arrays. */
export function useT() {
  const locale = useContext(Ctx);
  return useMemo(() => {
    const t = createT(locale);
    const list = (key: string) => (lookup(locale, key) as readonly string[]) ?? [];
    return Object.assign(t, { list, locale });
  }, [locale]);
}
