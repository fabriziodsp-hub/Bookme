/**
 * Salon configuration schema. Every business rule lives in data validated here,
 * never hard-coded in the engine.
 */
import { z } from 'zod';
import { parseHm, WEEKDAYS, type Weekday } from './time.js';
import { dstTransitions } from './tz.js';

const Hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const DayHoursSchema = z
  .object({
    open: Hm,
    close: Hm,
    breaks: z.array(z.tuple([Hm, Hm])).default([]),
  })
  .nullable();

export const AudienceSchema = z.enum(['women', 'men']);
export type Audience = z.infer<typeof AudienceSchema>;

export const PhaseSchema = z.object({
  /** Stable key used for i18n labels and persistence, e.g. "processing". */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** Name set by the salon (services editor); wins over the i18n label of `key`. */
  label: z.string().trim().min(1).max(40).optional(),
  /** busy = stylist occupied; free = stylist can serve someone else (Einwirkzeit). */
  kind: z.enum(['busy', 'free']),
  minutes: z.number().int().positive(),
  /** Duration override per service variant (e.g. cut without/with wash). */
  variantMinutes: z.record(z.string(), z.number().int().positive()).optional(),
  /**
   * Per-audience override of variantMinutes (e.g. men's cut 30′ with or without wash).
   * Wins over variantMinutes for that audience; finishMinutes still wins over both.
   */
  audienceVariantMinutes: z
    .object({
      women: z.record(z.string(), z.number().int().positive()).optional(),
      men: z.record(z.string(), z.number().int().positive()).optional(),
    })
    .optional(),
  /** Duration when the optional finish (Veredelung) is selected. */
  finishMinutes: z.number().int().positive().optional(),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const ServiceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** Name set by the salon (services editor); wins over the i18n label of `id`. */
  label: z.string().trim().min(1).max(60).optional(),
  /**
   * Hidden services cannot be booked any more (online or by staff) but stay in the catalogue,
   * so existing appointments keep their name and durations (D-048).
   */
  hidden: z.boolean().default(false),
  audiences: z.array(AudienceSchema).min(1),
  /** Not offered to minors (colour, highlights, balayage, perm). */
  adultOnly: z.boolean(),
  /** Ask the optional colour notes (length, current colour, previous treatments). */
  collectsColorNotes: z.boolean().default(false),
  variants: z.array(z.string().min(1)).optional(),
  defaultVariant: z.string().optional(),
  /** Offers the single finish option (Glossing/Mattierung). */
  finishOption: z.boolean().default(false),
  /** Allowed start times (client booking). Combined with all other rules. */
  fixedStarts: z.array(Hm).optional(),
  /**
   * Cancellation/no-show fee (Balayage: 150 €). Requires explicit client consent at booking.
   * Online changes close `lateCancelHours` before start; later cancellations and no-shows make the fee due.
   */
  feeRule: z
    .object({
      lateCancelHours: z.number().int().positive(),
      /** Fixed amount … */
      amountCents: z.number().int().positive().optional(),
      /**
       * … or derived from the typical damage (D-020): staff cost of the blocked time
       * plus a share of the lost revenue (price from the salon's price list).
       */
      formula: z
        .object({
          laborHours: z.number().positive(),
          hourlyWageCents: z.number().int().positive(),
          /** Employer social-security share on top of gross wage, in percent. */
          employerSharePercent: z.number().min(0).max(100),
          /** Share of the service price counted as lost profit, in percent. */
          revenuePercent: z.number().min(0).max(100),
          /** Round up to this many cents (100 = full euro). */
          roundUpToCents: z.number().int().positive().default(100),
        })
        .optional(),
    })
    .refine((r) => (r.amountCents === undefined) !== (r.formula === undefined), 'set exactly one of amountCents or formula')
    .optional(),
  phases: z.array(PhaseSchema).min(1),
});
export type Service = z.infer<typeof ServiceSchema>;

export const SalonConfigSchema = z
  .object({
    timeZone: z.string().min(1),
    /** Grid for client slots. */
    slotStepMinutes: z.number().int().positive(),
    /** Grid for staff edits. */
    staffStepMinutes: z.number().int().positive(),
    /** Minimum length of a phase after staff resizing. */
    minPhaseMinutes: z.number().int().positive(),
    /** Same-day minimum distance between "now" and a client slot. */
    leadTimeMinutes: z.number().int().nonnegative(),
    /** How many days ahead clients can book (0 = today only). */
    horizonDays: z.number().int().positive(),
    /** Self-service reschedule/cancel allowed until this many hours before start. */
    selfServiceCutoffHours: z.number().int().nonnegative(),
    reminderHoursBefore: z.number().int().positive(),
    /**
     * A client reschedule of a confirmed appointment needs a new confirmation by the salon
     * only if the appointment lasts at least this many minutes (A-16). 0 = always.
     */
    rescheduleReconfirmMinMinutes: z.number().int().nonnegative().default(60),
    /** Customer data is anonymised this many months after the last appointment (A-07). */
    retentionMonths: z.number().int().min(1).max(120).default(12),
    /**
     * Customers with an open fee claim are kept until the end of the statutory limitation
     * period (§§ 195, 199 BGB: 3 years from the end of the year the claim arose).
     */
    feeClaimRetentionYears: z.number().int().min(0).max(10).default(3),
    /** An unanswered online request expires this many hours after it was sent (at the latest at its start). */
    requestExpiryHours: z.number().int().positive().default(48),
    /** Interval of the staff digest e-mail listing open requests. */
    staffDigestHours: z.number().int().positive().default(6),
    /** Birthday discount: one appointment in the birth month (opt-in, adults only). */
    birthdayDiscount: z
      .object({ enabled: z.boolean(), percent: z.number().int().min(1).max(100) })
      .default({ enabled: false, percent: 10 }),
    /** Whether fixedStarts also bind staff edits (prototype: no). */
    enforceFixedStartsForStaff: z.boolean().default(false),
    weeklyHours: z.object(
      Object.fromEntries(WEEKDAYS.map((d) => [d, DayHoursSchema])) as Record<
        Weekday,
        typeof DayHoursSchema
      >,
    ),
    services: z.array(ServiceSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    try {
      new Intl.DateTimeFormat('en', { timeZone: cfg.timeZone });
    } catch {
      issue(['timeZone'], `Unknown IANA time zone "${cfg.timeZone}"`);
    }
    if (cfg.slotStepMinutes % cfg.staffStepMinutes !== 0) {
      issue(['slotStepMinutes'], 'must be a multiple of staffStepMinutes');
    }

    for (const day of WEEKDAYS) {
      const h = cfg.weeklyHours[day];
      if (!h) continue;
      const open = parseHm(h.open);
      const close = parseHm(h.close);
      if (close <= open) issue(['weeklyHours', day], 'close must be after open');
      if (open % cfg.staffStepMinutes || close % cfg.staffStepMinutes) {
        issue(['weeklyHours', day], 'open/close must lie on the staff grid');
      }
      let last = open;
      h.breaks.forEach(([bs, be], i) => {
        const s = parseHm(bs);
        const e = parseHm(be);
        if (e <= s) issue(['weeklyHours', day, 'breaks', i], 'break end must be after start');
        if (s < last || e > close) {
          issue(['weeklyHours', day, 'breaks', i], 'breaks must be sorted and inside opening hours');
        }
        last = e;
      });
    }

    const ids = new Set<string>();
    cfg.services.forEach((s, si) => {
      if (ids.has(s.id)) issue(['services', si, 'id'], `duplicate service id ${s.id}`);
      ids.add(s.id);
      if (s.defaultVariant && !s.variants?.includes(s.defaultVariant)) {
        issue(['services', si, 'defaultVariant'], 'must be one of variants');
      }
      if (s.variants && !s.defaultVariant) {
        issue(['services', si, 'defaultVariant'], 'required when variants are defined');
      }
      const phaseKeys = new Set<string>();
      s.phases.forEach((p, pi) => {
        if (phaseKeys.has(p.key)) issue(['services', si, 'phases', pi, 'key'], `duplicate phase key ${p.key}`);
        phaseKeys.add(p.key);
        const all = [
          p.minutes,
          p.finishMinutes,
          ...Object.values(p.variantMinutes ?? {}),
          ...Object.values(p.audienceVariantMinutes?.women ?? {}),
          ...Object.values(p.audienceVariantMinutes?.men ?? {}),
        ];
        if (all.some((m) => m !== undefined && m % cfg.staffStepMinutes !== 0)) {
          issue(['services', si, 'phases', pi], 'durations must be multiples of staffStepMinutes');
        }
        if (p.variantMinutes) {
          for (const v of s.variants ?? []) {
            if (!(v in p.variantMinutes)) {
              issue(['services', si, 'phases', pi, 'variantMinutes'], `missing variant ${v}`);
            }
          }
          for (const v of Object.keys(p.variantMinutes)) {
            if (!s.variants?.includes(v)) {
              issue(['services', si, 'phases', pi, 'variantMinutes'], `unknown variant ${v}`);
            }
          }
        }
        for (const [aud, map] of Object.entries(p.audienceVariantMinutes ?? {})) {
          if (!map) continue;
          if (!s.audiences.includes(aud as Audience)) {
            issue(['services', si, 'phases', pi, 'audienceVariantMinutes', aud], 'audience not offered');
          }
          for (const v of Object.keys(map)) {
            if (!s.variants?.includes(v)) {
              issue(['services', si, 'phases', pi, 'audienceVariantMinutes', aud], `unknown variant ${v}`);
            }
          }
        }
        if (p.finishMinutes !== undefined && !s.finishOption) {
          issue(['services', si, 'phases', pi, 'finishMinutes'], 'finishOption is not enabled');
        }
      });
      if (s.phases[0]!.kind !== 'busy' || s.phases.at(-1)!.kind !== 'busy') {
        issue(['services', si, 'phases'], 'first and last phase must be busy');
      }
      s.fixedStarts?.forEach((t, ti) => {
        if (parseHm(t) % cfg.slotStepMinutes !== 0) {
          issue(['services', si, 'fixedStarts', ti], 'must lie on the client slot grid');
        }
      });
    });
  });

export type SalonConfig = z.infer<typeof SalonConfigSchema>;
export type SalonConfigInput = z.input<typeof SalonConfigSchema>;

/**
 * Returns opening-hour boundaries that fall into a DST gap/overlap within the next
 * `years` years. Non-empty result = configuration would produce invalid instants.
 */
export function findDstConflicts(
  cfg: SalonConfig,
  fromDate: string,
  years = 10,
): { date: string; detail: string }[] {
  const out: { date: string; detail: string }[] = [];
  for (const t of dstTransitions(fromDate, Math.ceil(years * 366), cfg.timeZone)) {
    const weekday = WEEKDAYS[(new Date(`${t.date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
    const h = cfg.weeklyHours[weekday];
    if (!h) continue;
    const open = parseHm(h.open);
    const close = parseHm(h.close);
    if (open < t.endMinute && t.startMinute < close) {
      out.push({ date: t.date, detail: `${h.open}-${h.close} overlaps DST change` });
    }
  }
  return out;
}

/** Parse + validate; throws a readable error listing every problem. */
export function loadSalonConfig(input: unknown, today = new Date().toISOString().slice(0, 10)): SalonConfig {
  const parsed = SalonConfigSchema.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid salon config:\n${lines.join('\n')}`);
  }
  const dst = findDstConflicts(parsed.data, today);
  if (dst.length) {
    throw new Error(
      `Invalid salon config: opening hours hit DST transitions:\n${dst.map((d) => `- ${d.date}: ${d.detail}`).join('\n')}`,
    );
  }
  return parsed.data;
}

export function findService(cfg: SalonConfig, id: string): Service | undefined {
  return cfg.services.find((s) => s.id === id);
}
