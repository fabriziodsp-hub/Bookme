import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadPrefs, savePrefs } from '../lib/prefs';
import { resolveTheme, type Accent, type Preset, type VisitorPrefs } from './palette';

interface ThemeCtx {
  prefs: VisitorPrefs;
  setPrefs: (p: VisitorPrefs) => void;
  reducedMotion: boolean;
}
const Ctx = createContext<ThemeCtx | null>(null);

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Applies salon theme + visitor accessibility preferences as CSS variables on <html>. */
export function ThemeProvider({ preset, accent, children }: { preset: Preset; accent: Accent; children: ReactNode }) {
  const [prefs, setPrefsState] = useState<VisitorPrefs>(loadPrefs);
  const osDark = useMedia('(prefers-color-scheme: dark)');
  const osReduced = useMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = prefs.reducedMotion ?? osReduced;

  useEffect(() => {
    const th = resolveTheme(preset, accent, prefs, osDark);
    const r = document.documentElement;
    const t = th.tokens;
    const vars: Record<string, string> = {
      '--bg': t.bg, '--surface': t.surface, '--surface2': t.surface2, '--text': t.text, '--muted': t.muted,
      '--border': t.border, '--border-strong': t.borderStrong, '--free': t.free, '--free-ink': t.freeInk,
      '--busy': t.busy, '--danger': t.danger, '--danger-ink': t.dangerInk, '--grid': t.grid,
      '--ac': th.ac, '--ac-ink': th.ink, '--scale': String(prefs.textScale / 100),
    };
    for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
    r.dataset.scheme = th.scheme;
    r.dataset.flavor = th.flavor;
    r.dataset.motion = prefs.reducedMotion === null ? '' : prefs.reducedMotion ? 'reduced' : 'full';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  }, [preset, accent, prefs, osDark]);

  const value = useMemo(
    () => ({ prefs, reducedMotion, setPrefs: (p: VisitorPrefs) => (setPrefsState(p), savePrefs(p)) }),
    [prefs, reducedMotion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
