import { de, type Messages } from './de.js';
import { en } from './en.js';
import { it } from './it.js';

export type Locale = 'de' | 'it' | 'en';
export const LOCALES: Locale[] = ['de', 'it', 'en'];
export type { Messages };

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type PartialMessages = DeepPartial<Messages>;

const dictionaries: Record<Locale, PartialMessages> = { de, it, en };

/** Resolve "a.b.c" in the locale, falling back to German, then to the key itself. */
export function lookup(locale: Locale, key: string): unknown {
  for (const dict of [dictionaries[locale], de]) {
    let cur: unknown = dict;
    for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
    if (cur !== undefined) return cur;
  }
  return undefined;
}

/** Translate with {placeholder} interpolation. */
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const v = lookup(locale, key);
  if (typeof v !== 'string') return key;
  return params ? v.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : v;
}

export function createT(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
}

export { de };
