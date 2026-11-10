import { DEFAULT_PREFS, type VisitorPrefs } from '../theme/palette';

const KEY = 'salon.viewPrefs.v1';

/** Visitor accessibility settings live only on this device (localStorage, guarded). */
export function loadPrefs(): VisitorPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<VisitorPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
export function savePrefs(p: VisitorPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode – settings apply for this visit only */
  }
}
