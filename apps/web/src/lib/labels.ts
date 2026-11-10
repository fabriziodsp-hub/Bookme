/**
 * Names of services, phases and variants. The salon's own name (services editor, D-048) wins
 * over the translated default; unknown keys fall back to the key itself.
 */
import { lookup } from '@salon/i18n';
import { durationRange, findService, formatHm, type Audience, type SalonConfig, type Service } from '@salon/engine';
import { useMemo } from 'react';
import { useT } from './i18n';
import { useSalon } from './salon';

type T = ReturnType<typeof useT>;

/** 45 → "45 Min.", 150 → "2 Std. 30 Min.", 240 → "4 Std." */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/** 30, 45 → "30–45 Min."; 135, 150 → "2 Std. 15 Min. – 2 Std. 30 Min." */
export function formatRange(min: number, max: number): string {
  if (min === max) return formatDuration(min);
  return max < 60 ? `${min}–${max} Min.` : `${formatDuration(min)} – ${formatDuration(max)}`;
}

export function makeLabels(cfg: SalonConfig, t: T) {
  const dict = (key: string) => {
    const v = lookup(t.locale, key);
    return typeof v === 'string' ? v : undefined;
  };
  const service = (id: string) => findService(cfg, id)?.label ?? dict(`service.${id}`) ?? id;
  const phase = (key: string, serviceId?: string) =>
    (serviceId ? findService(cfg, serviceId)?.phases.find((p) => p.key === key)?.label : undefined) ??
    dict(`phase.${key}`) ??
    cfg.services.flatMap((s) => s.phases).find((p) => p.key === key && p.label)?.label ??
    key;
  const variant = (v: string) => dict(`variant.${v}`) ?? v;
  /** Booking hint computed from the configured durations, e.g. "30–45 Min." or "4 Std. · Beginn 08:00 oder 13:00 Uhr". */
  const hint = (s: Service, audience: Audience) => {
    const r = durationRange(s, audience);
    const parts = [formatRange(r.min, r.max)];
    if (r.hasFree) parts.push(t('ui.inclProcessing'));
    if (s.fixedStarts?.length) parts.push(t('ui.fixedStarts', { times: s.fixedStarts.join(t('ui.or')) }));
    return parts.join(' · ');
  };
  /** Styling with and without the finish option, from the phase that has a finish duration. */
  const finishHint = (s: Service) => {
    const p = s.phases.find((x) => x.finishMinutes !== undefined);
    return p ? t('ui.finishHint', { a: p.minutes, b: p.finishMinutes! }) : '';
  };
  return { service, phase, variant, hint, finishHint, formatHm };
}

export function useLabels() {
  const t = useT();
  const salon = useSalon();
  return useMemo(() => makeLabels(salon.config, t), [salon.config, t]);
}
