/** Request/response schemas – the single source for validation AND the OpenAPI document. */
import { z } from '@hono/zod-openapi';
import { isLocalDate } from '@salon/engine';

export const LocalDate = z
  .string()
  .refine(isLocalDate, 'expected YYYY-MM-DD')
  .openapi({ example: '2026-11-03', description: 'Local date in Europe/Berlin' });

export const Minute = z.number().int().min(0).max(1440).openapi({ example: 555, description: 'Minutes since local midnight' });

export const Hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ example: '09:15' });

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'SLOT_TAKEN' }),
      message: z.string().openapi({ example: 'Dieser Termin ist leider nicht mehr frei.' }),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi('Error');

export const SelectionSchema = z
  .object({
    serviceId: z.string().min(1).max(40),
    audience: z.enum(['women', 'men']),
    /** No longer asked (D-062); kept for older clients, always treated as true. */
    adult: z.boolean().default(true),
    variant: z.string().max(40).optional(),
    finish: z.boolean().optional(),
  })
  .openapi('Selection');

/** Same selection, from query-string values. */
export const SelectionQuery = z.object({
  serviceId: z.string().min(1).max(40),
  audience: z.enum(['women', 'men']),
  adult: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  variant: z.string().max(40).optional(),
  finish: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const BlockSchema = z
  .object({
    phase: z.string(),
    kind: z.enum(['busy', 'free']),
    start: Minute,
    end: Minute,
  })
  .openapi('Block');

export const IntervalSchema = z.object({ start: Minute, end: Minute });

export const DayAvailabilitySchema = z
  .object({
    date: LocalDate,
    open: z.boolean(),
    hours: z.object({ open: Minute, close: Minute, breaks: z.array(IntervalSchema) }).nullable(),
    slots: z.array(z.object({ start: Minute, stylistIds: z.array(z.string()) })),
    busy: z.array(IntervalSchema),
  })
  .openapi('DayAvailability');

export const CustomerInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(254).optional(),
    /** Birthday discount opt-in (client confirms being at least 16, D-062): birth month 1–12. Omit = no consent. */
    birthMonth: z.number().int().min(1).max(12).optional(),
  })
  .openapi('CustomerInput');

export const BookingRequestSchema = z
  .object({
    selection: SelectionSchema,
    date: LocalDate,
    start: Hm,
    stylistId: z.string().uuid().optional(),
    customer: CustomerInputSchema,
    colorNotes: z.string().max(500).optional(),
    /** Mandatory `true` for services with a fee rule (Balayage). */
    feeConsent: z.boolean().optional(),
    privacyAck: z.boolean().optional(),
    /** Honeypot: must stay empty (bots fill every field). */
    website: z.string().max(200).optional(),
    /** Proof-of-work solution (anti-bot, self-hosted). */
    pow: z.object({ challenge: z.string(), salt: z.string(), number: z.number().int().nonnegative(), signature: z.string() }),
  })
  .openapi('BookingRequest');

export const StatusEnum = z.enum(['requested', 'discuss', 'confirmed', 'declined', 'expired', 'completed', 'no_show', 'cancelled']);
const Price = z.object({ cents: z.number().int(), isFrom: z.boolean(), birthdayDiscount: z.boolean() });
const Fee = z.object({ cents: z.number().int(), status: z.enum(['none', 'due', 'paid', 'waived']), consentAt: z.string().nullable() });

const AgeCheck = z.object({
  status: z.enum(['not_required', 'open', 'requested', 'verified', 'not_verified', 'not_presented']),
  at: z.string().nullable(),
});

export const AppointmentSchema = z
  .object({
    id: z.string(),
    refCode: z.string().openapi({ example: 'K7M-4QX' }),
    stylistId: z.string(),
    date: LocalDate,
    start: Minute,
    end: Minute,
    blocks: z.array(BlockSchema),
    status: StatusEnum,
    source: z.enum(['online', 'staff']),
    serviceId: z.string(),
    serviceLabel: z.string(),
    variant: z.string().nullable(),
    finish: z.boolean(),
    audience: z.enum(['women', 'men']),
    adultDeclared: z.boolean(),
    colorNotes: z.string().nullable(),
    internalNote: z.string().nullable(),
    ageCheck: AgeCheck,
    fee: Fee.nullable(),
    price: Price.nullable(),
    expiresAt: z.string().nullable(),
    clientNote: z.string().nullable(),
    /** Saved note not yet sent (requests inbox, D-057); staff only. */
    clientNoteDraft: z.string().nullable(),
    /** The stylist was deleted: give it to a colleague before confirming (D-054). */
    needsReassign: z.boolean(),
    createdAt: z.string(),
    version: z.number().int(),
    customer: z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      noShowCount: z.number().int(),
    }),
  })
  .openapi('Appointment');

/** What a client sees about their own appointment (no internal fields). */
export const PublicAppointmentSchema = z
  .object({
    refCode: z.string(),
    date: LocalDate,
    start: Minute,
    end: Minute,
    blocks: z.array(BlockSchema),
    status: StatusEnum,
    serviceId: z.string(),
    serviceLabel: z.string(),
    price: Price.nullable(),
    fee: z.object({ cents: z.number().int(), lateCancelHours: z.number().int() }).nullable(),
    firstName: z.string(),
    lastName: z.string(),
    contact: z.string(),
    restricted: z.boolean(),
    canChange: z.boolean(),
    cutoffAt: z.string(),
    salonPhone: z.string(),
    clientNote: z.string().nullable(),
  })
  .openapi('PublicAppointment');

export const BookingResponseSchema = z
  .object({
    appointment: PublicAppointmentSchema,
    manageToken: z.string(),
  })
  .openapi('BookingResponse');

export const AbsenceSchema = z
  .object({
    id: z.string(),
    stylistId: z.string(),
    kind: z.enum(['vacation', 'sick', 'training', 'other']),
    note: z.string().nullable(),
    from: z.object({ date: LocalDate, minute: Minute }),
    to: z.object({ date: LocalDate, minute: Minute }),
    startAt: z.string(),
    endAt: z.string(),
  })
  .openapi('Absence');

export const StaffUserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.enum(['platform_admin', 'owner', 'stylist']),
    displayName: z.string(),
    stylistId: z.string().nullable(),
    tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }).nullable(),
  })
  .openapi('StaffUser');

export const CustomerSummarySchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    noShowCount: z.number().int(),
    appointmentCount: z.number().int(),
    next: z.object({ id: z.string(), date: z.string(), start: z.number(), serviceLabel: z.string() }).nullable(),
    last: z.object({ id: z.string(), date: z.string(), start: z.number(), serviceLabel: z.string(), status: z.string() }).nullable(),
  })
  .openapi('CustomerSummary');

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});

export const errorResponses = {
  400: json(ErrorSchema, 'Validation error'),
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Conflict'),
  422: json(ErrorSchema, 'Rule violation'),
  429: json(ErrorSchema, 'Too many requests'),
} as const;
