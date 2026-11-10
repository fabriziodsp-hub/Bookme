/**
 * Theme tokens. Salons pick a flavour preset and an accent; visitors may switch scheme and contrast.
 * Every combination is checked for WCAG 2.2 AA contrast in palette.test.ts – so salons cannot
 * break accessibility by choosing colours.
 */
export type Scheme = 'light' | 'dark';
export type Flavor = 'neutral' | 'warm' | 'contrast';
export type Preset = 'dark' | 'light' | 'warm' | 'contrast';
export type Accent = 'emerald' | 'violet' | 'rose' | 'amber' | 'sky' | 'slate';

export interface Tokens {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  /** Borders of form controls and other UI components that must be identifiable (≥ 3:1). */
  borderStrong: string;
  free: string; // Einwirkzeit block
  freeInk: string;
  busy: string; // anonymous "belegt" shading
  danger: string;
  dangerInk: string;
  grid: string;
}

export const BASE: Record<Flavor, Record<Scheme, Tokens>> = {
  neutral: {
    dark: { bg: '#0b0b0c', surface: '#17171a', surface2: '#222228', text: '#f4f4f5', muted: '#a8a8b3', border: '#2e2e35', borderStrong: '#7c7c87', free: '#e9c46a', freeInk: '#241a02', busy: '#3a3a42', danger: '#f87171', dangerInk: '#2a0505', grid: 'rgba(255,255,255,.07)' },
    light: { bg: '#f5f5f3', surface: '#ffffff', surface2: '#ececea', text: '#111113', muted: '#55555f', border: '#dcdcd8', borderStrong: '#80808a', free: '#f3dfae', freeInk: '#2b2005', busy: '#d6d6d2', danger: '#b91c1c', dangerInk: '#ffffff', grid: 'rgba(0,0,0,.07)' },
  },
  warm: {
    dark: { bg: '#15110e', surface: '#201a15', surface2: '#2b231c', text: '#f7efe7', muted: '#c2b3a4', border: '#3a3027', borderStrong: '#8f7f70', free: '#e9c46a', freeInk: '#241a02', busy: '#43382e', danger: '#f87171', dangerInk: '#2a0505', grid: 'rgba(255,240,220,.07)' },
    light: { bg: '#faf6f1', surface: '#fffdf9', surface2: '#f1e9df', text: '#1f1712', muted: '#62523f', border: '#e3d7c8', borderStrong: '#8f7d6a', free: '#f3dfae', freeInk: '#2b2005', busy: '#e2d6c8', danger: '#b91c1c', dangerInk: '#ffffff', grid: 'rgba(60,30,0,.07)' },
  },
  contrast: {
    dark: { bg: '#000000', surface: '#000000', surface2: '#141414', text: '#ffffff', muted: '#e6e6e6', border: '#ffffff', borderStrong: '#ffffff', free: '#ffd84d', freeInk: '#000000', busy: '#4d4d4d', danger: '#ff6b6b', dangerInk: '#000000', grid: 'rgba(255,255,255,.25)' },
    light: { bg: '#ffffff', surface: '#ffffff', surface2: '#f0f0f0', text: '#000000', muted: '#1a1a1a', border: '#000000', borderStrong: '#000000', free: '#ffe08a', freeInk: '#000000', busy: '#bdbdbd', danger: '#a40000', dangerInk: '#ffffff', grid: 'rgba(0,0,0,.25)' },
  },
};

/** Accent with its text colour ("ink"), per scheme. */
export const ACCENTS: Record<Accent, Record<Scheme, { ac: string; ink: string }>> = {
  emerald: { dark: { ac: '#34d399', ink: '#04281c' }, light: { ac: '#047857', ink: '#ffffff' } },
  violet: { dark: { ac: '#c4b5fd', ink: '#1e1048' }, light: { ac: '#6d28d9', ink: '#ffffff' } },
  rose: { dark: { ac: '#fda4af', ink: '#4c0519' }, light: { ac: '#be123c', ink: '#ffffff' } },
  amber: { dark: { ac: '#fcd34d', ink: '#3b2300' }, light: { ac: '#92400e', ink: '#ffffff' } },
  sky: { dark: { ac: '#7dd3fc', ink: '#082f49' }, light: { ac: '#0369a1', ink: '#ffffff' } },
  slate: { dark: { ac: '#e2e8f0', ink: '#0f172a' }, light: { ac: '#334155', ink: '#ffffff' } },
};

export const PRESET_FLAVOR: Record<Preset, { flavor: Flavor; scheme: Scheme }> = {
  dark: { flavor: 'neutral', scheme: 'dark' },
  light: { flavor: 'neutral', scheme: 'light' },
  warm: { flavor: 'warm', scheme: 'light' },
  contrast: { flavor: 'contrast', scheme: 'dark' },
};

export interface VisitorPrefs {
  scheme: 'auto' | Scheme;
  contrast: boolean;
  textScale: 100 | 125 | 150;
  reducedMotion: boolean | null; // null = follow the OS
}

export const DEFAULT_PREFS: VisitorPrefs = { scheme: 'auto', contrast: false, textScale: 100, reducedMotion: null };

export function resolveTheme(preset: Preset, accent: Accent, prefs: VisitorPrefs, osDark: boolean) {
  const base = PRESET_FLAVOR[preset];
  const scheme: Scheme = prefs.scheme === 'auto' ? (preset === 'contrast' || preset === 'dark' || preset === 'light' || preset === 'warm' ? base.scheme : osDark ? 'dark' : 'light') : prefs.scheme;
  const flavor: Flavor = prefs.contrast ? 'contrast' : base.flavor;
  const a = ACCENTS[accent][scheme];
  // In high contrast the accent becomes the pure text colour (maximum contrast).
  const accentTokens = flavor === 'contrast' ? { ac: BASE.contrast[scheme].text, ink: BASE.contrast[scheme].bg } : a;
  return { scheme, flavor, tokens: BASE[flavor][scheme], ...accentTokens };
}

// ---- WCAG contrast ----
function lum(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
