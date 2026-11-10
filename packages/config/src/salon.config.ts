/**
 * Template business rules for a salon (new tenants start from this; the platform admin adapts
 * services, the owner adapts opening hours in the admin UI). Business rules live here and in the
 * per-salon copy in the database – never in code. Validated by @salon/engine (loadSalonConfig).
 *
 * Values marked [A-xx] are assumptions to be confirmed by the owner (docs/spec.md §10).
 */
import type { SalonConfigInput } from '@salon/engine';

const workday = { open: '08:00', close: '17:00', breaks: [['12:00', '13:00']] as [string, string][] };

/** Colour chain: work → Einwirkzeit 30′ (stylist free) → Styling 30′ (45′ with finish). */
const colorChain = (workMinutes: number) => [
  { key: 'color_work', kind: 'busy' as const, minutes: workMinutes },
  { key: 'processing', kind: 'free' as const, minutes: 30 },
  { key: 'styling', kind: 'busy' as const, minutes: 30, finishMinutes: 45 },
];

export const salonConfig = {
  timeZone: 'Europe/Berlin',
  slotStepMinutes: 15,
  staffStepMinutes: 5,
  minPhaseMinutes: 5,
  leadTimeMinutes: 30, // [A-09] from prototype
  horizonDays: 364, // [A-09] from prototype
  selfServiceCutoffHours: 12, // A-05 confirmed (Balayage: 48 h via feeRule)
  reminderHoursBefore: 24, // A-06 confirmed: one reminder 24 h before
  rescheduleReconfirmMinMinutes: 60, // A-16 confirmed: re-confirm only appointments ≥ 1 h
  retentionMonths: 12, // A-07: booking data is not subject to the 10-year rule (§ 147 AO) – see docs/legal.md
  feeClaimRetentionYears: 3, // §§ 195, 199 BGB
  requestExpiryHours: 48, // D-027
  staffDigestHours: 6, // D-027
  birthdayDiscount: { enabled: true, percent: 10 }, // D-021
  enforceFixedStartsForStaff: false, // [A-15] prototype lets staff move Balayage freely
  weeklyHours: {
    mon: workday,
    tue: workday,
    wed: workday,
    thu: workday,
    fri: workday,
    sat: { open: '08:00', close: '14:00', breaks: [] },
    sun: null,
  },
  services: [
    {
      id: 'cut',
      audiences: ['women', 'men'],
      adultOnly: false,
      variants: ['dry', 'wash'],
      defaultVariant: 'wash',
      phases: [
        {
          key: 'cut',
          kind: 'busy',
          minutes: 45,
          // A-01 confirmed: women 30′ dry / 45′ with wash (incl. blow-dry); men 30′ either way
          variantMinutes: { dry: 30, wash: 45 },
          audienceVariantMinutes: { men: { dry: 30, wash: 30 } },
        },
      ],
    },
    {
      id: 'wash_set',
      audiences: ['women'],
      adultOnly: false,
      phases: [{ key: 'wash_set', kind: 'busy', minutes: 30 /* A-02 confirmed, without cut */ }],
    },
    {
      id: 'color_root',
      audiences: ['women', 'men'],
      adultOnly: true,
      collectsColorNotes: true,
      finishOption: true,
      phases: colorChain(45),
    },
    {
      id: 'color_full',
      audiences: ['women', 'men'],
      adultOnly: true,
      collectsColorNotes: true,
      finishOption: true,
      phases: colorChain(60),
    },
    {
      id: 'highlights',
      audiences: ['women', 'men'], // A-03 confirmed
      adultOnly: true,
      collectsColorNotes: true,
      finishOption: true,
      // A-04 confirmed: Oberkopf & Konturen 45′ / ganzer Kopf 60′, plus a 30′ cut.
      // Order (assumption): highlights → Einwirkzeit → cut → styling.
      variants: ['partial', 'full'],
      defaultVariant: 'full',
      phases: [
        { key: 'highlights_work', kind: 'busy', minutes: 60, variantMinutes: { partial: 45, full: 60 } },
        { key: 'processing', kind: 'free', minutes: 30 },
        { key: 'cut', kind: 'busy', minutes: 30 },
        { key: 'styling', kind: 'busy', minutes: 30, finishMinutes: 45 },
      ],
    },
    {
      id: 'balayage',
      audiences: ['women'], // A-03 confirmed: Balayage women only
      adultOnly: true,
      collectsColorNotes: true,
      // 4 h consecutive; morning or afternoon. Saturday afternoon is impossible (closes 14:00).
      fixedStarts: ['08:00', '13:00'],
      // D-020: fee for no-show or cancellation later than 48 h before start (consent required).
      // Typical damage: 4 h staff at the statutory minimum wage (13,90 €/h in 2026) + ~23 % employer
      // share, plus 15 % of the lost revenue. Balayage 190 € → 97 €. Update the wage each January.
      feeRule: {
        lateCancelHours: 48,
        formula: { laborHours: 4, hourlyWageCents: 1390, employerSharePercent: 23, revenuePercent: 15, roundUpToCents: 100 },
      },
      phases: [{ key: 'balayage', kind: 'busy', minutes: 240 }],
    },
    {
      id: 'perm',
      audiences: ['women', 'men'], // A-03 confirmed
      adultOnly: true,
      collectsColorNotes: true,
      // 120′ without free time: during Einwirkzeit the stylist prepares (busy).
      phases: [
        { key: 'perm_cut', kind: 'busy', minutes: 30 },
        { key: 'perm_rollers', kind: 'busy', minutes: 30 },
        { key: 'perm_processing', kind: 'busy', minutes: 15 },
        { key: 'perm_rinse', kind: 'busy', minutes: 15 },
        { key: 'styling', kind: 'busy', minutes: 30 },
      ],
    },
  ],
} satisfies SalonConfigInput;
