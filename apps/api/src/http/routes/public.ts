/** Public routes of one salon: /api/s/{slug}/… (no login). */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { feeAmountCents, findService, parseHm, type Selection } from '@salon/engine';
import { salonNow } from '../../clock.js';
import { withTx } from '../../db/pool.js';
import {
  cancelByToken,
  createAppointment,
  feeConsentText,
  getByToken,
  rescheduleByToken,
  selectionOf,
  selfServiceState,
  toDtos,
  type AppointmentDto,
  type AppointmentRow,
} from '../../domain/appointments.js';
import { availability, daysWithSlots, nextFree } from '../../domain/availability.js';
import { salonUrl, type Ctx, type Deps } from '../../domain/context.js';
import { unsubscribe } from '../../domain/customers.js';
import { publicTeam } from '../../domain/staff.js';
import { Errors } from '../../domain/errors.js';
import { claimKey, remember } from '../../domain/idempotency.js';
import { createChallenge, verifySolution } from '../../domain/pow.js';
import { listPrices, priceFor } from '../../domain/prices.js';
import { getLogo } from '../../domain/tenants.js';
import { buildIcs, eventDescription } from '../../messages/ics.js';
import { rateLimit, salonFromSlug, type AppEnv } from '../middleware.js';
import {
  BookingRequestSchema,
  BookingResponseSchema,
  DayAvailabilitySchema,
  errorResponses,
  Hm,
  json,
  LocalDate,
  Minute,
  PublicAppointmentSchema,
  SelectionQuery,
} from '../schemas.js';

const SlugParam = z.object({ slug: z.string().openapi({ param: { name: 'slug', in: 'path' }, example: 'salon-beispiel' }) });
const TokenParam = SlugParam.extend({ token: z.string().min(20).max(100).openapi({ param: { name: 'token', in: 'path' } }) });

function toPublic(ctx: Ctx, a: AppointmentDto, row: Pick<AppointmentRow, 'status' | 'start_at' | 'service_id' | 'fee_cents' | 'fee_late_cancel_hours' | 'client_note'>) {
  const s = selfServiceState(ctx, row);
  return {
    refCode: a.refCode,
    date: a.date,
    start: a.start,
    end: a.end,
    blocks: a.blocks,
    status: a.status,
    serviceId: a.serviceId,
    serviceLabel: a.serviceLabel,
    price: a.price,
    fee: row.fee_cents ? { cents: row.fee_cents, lateCancelHours: row.fee_late_cancel_hours ?? 48 } : null,
    firstName: a.customer.firstName,
    lastName: a.customer.lastName,
    contact: [a.customer.phone, a.customer.email].filter(Boolean).join(' / '),
    restricted: !!findService(ctx.cfg, a.serviceId)?.adultOnly,
    canChange: s.canChange,
    cutoffAt: s.cutoffAt.toISOString(),
    salonPhone: ctx.profile.phoneDisplay,
    clientNote: a.status === 'declined' || a.status === 'confirmed' || a.status === 'discuss' ? row.client_note : null,
  };
}

const selectionFrom = (q: z.infer<typeof SelectionQuery>): Selection => ({
  serviceId: q.serviceId,
  audience: q.audience,
  adult: q.adult,
  variant: q.variant,
  finish: q.finish || undefined,
});

export function publicRoutes(deps: Deps, opts: { trustProxy: boolean; limitScale?: number }) {
  const app = new OpenAPIHono<AppEnv>();
  const t = opts.trustProxy;
  const k = opts.limitScale ?? 1;
  app.use('/:slug/*', salonFromSlug(deps));
  app.use('/:slug/availability*', rateLimit({ bucket: 'read', limit: 300 * k, windowMs: 60_000, trustProxy: t }));
  app.use('/:slug/bookings', rateLimit({ bucket: 'book', limit: 10 * k, windowMs: 10 * 60_000, trustProxy: t }));
  app.use('/:slug/appointments/*', rateLimit({ bucket: 'manage', limit: 30 * k, windowMs: 60_000, trustProxy: t }));
  app.use('/:slug/challenge', rateLimit({ bucket: 'pow', limit: 30 * k, windowMs: 60_000, trustProxy: t }));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/config',
      tags: ['public'],
      summary: 'Salon rules, profile, theme, prices, homepage texts and public team',
      request: { params: SlugParam },
      responses: {
        200: json(
          z.object({
            slug: z.string(),
            config: z.any(),
            profile: z.any(),
            theme: z.object({ preset: z.string(), accent: z.string() }),
            hasLogo: z.boolean(),
            prices: z.array(z.any()),
            homepage: z.object({ tagline: z.string(), about: z.string() }),
            team: z.array(z.object({ id: z.string(), publicName: z.string() })),
            feeConsentText: z.record(z.string(), z.string()),
            feeAmountCents: z.record(z.string(), z.number().int()),
            now: z.object({ date: LocalDate, minute: Minute }),
          }),
          'Configuration',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const prices = await listPrices(ctx.db, ctx.tenantId);
      const feeServices = ctx.cfg.services.filter((s) => s.feeRule);
      const feeAmounts = Object.fromEntries(
        feeServices.map((s) => [s.id, feeAmountCents(s.feeRule!, priceFor(prices, { serviceId: s.id, variant: s.defaultVariant })?.cents ?? null)]),
      );
      const feeTexts = Object.fromEntries(feeServices.map((s) => [s.id, feeConsentText(feeAmounts[s.id]!, s.feeRule!.lateCancelHours)]));
      return c.json(
        {
          slug: ctx.tenant.slug,
          config: ctx.cfg,
          profile: ctx.profile,
          theme: ctx.tenant.theme,
          hasLogo: !!ctx.tenant.logoAssetId,
          prices,
          homepage: ctx.tenant.homepage,
          // D-052: no staff names here except the public names of those who agreed
          team: await publicTeam(ctx.db, ctx.tenantId),
          feeConsentText: feeTexts,
          feeAmountCents: feeAmounts,
          now: salonNow(ctx.clock, ctx.cfg.timeZone),
        },
        200,
      );
    },
  );

  app.get('/:slug/logo', async (c) => {
    const ctx = c.get('ctx');
    const logo = await getLogo(ctx.db, ctx.tenant);
    if (!logo) throw Errors.notFound();
    if (c.req.header('if-none-match') === `"${logo.sha256}"`) return c.body(null, 304);
    return c.body(new Uint8Array(logo.bytes), 200, {
      'content-type': logo.content_type,
      etag: `"${logo.sha256}"`,
      'cache-control': 'public, max-age=3600',
      // SVG logos are sanitised on upload; this CSP is a second layer.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    });
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/challenge',
      tags: ['public'],
      summary: 'Proof-of-work challenge (anti-bot, self-hosted)',
      request: { params: SlugParam },
      responses: { 200: json(z.object({ algorithm: z.literal('SHA-256'), challenge: z.string(), salt: z.string(), maxNumber: z.number(), signature: z.string() }), 'Challenge') },
    }),
    (c) => c.json(createChallenge(deps.secret, deps.clock.now()), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/availability',
      tags: ['public'],
      summary: 'Bookable start times per day (client rules)',
      request: {
        params: SlugParam,
        query: SelectionQuery.extend({ from: LocalDate, days: z.coerce.number().int().min(1).max(14).default(7), stylistId: z.string().uuid().optional() }),
      },
      responses: { 200: json(z.object({ days: z.array(DayAvailabilitySchema) }), 'Availability'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const q = c.req.valid('query');
      return c.json({ days: await availability(ctx.db, ctx, selectionFrom(q), q.from, q.days, q.stylistId ? { stylistId: q.stylistId } : {}) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/availability/days',
      tags: ['public'],
      summary: 'Dates with at least one free slot (month picker dots)',
      request: { params: SlugParam, query: SelectionQuery.extend({ from: LocalDate, days: z.coerce.number().int().min(1).max(42).default(42), stylistId: z.string().uuid().optional() }) },
      responses: { 200: json(z.object({ dates: z.array(LocalDate) }), 'Dates'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const q = c.req.valid('query');
      return c.json({ dates: await daysWithSlots(ctx.db, ctx, selectionFrom(q), q.from, q.days, q.stylistId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/availability/next',
      tags: ['public'],
      summary: 'Next free slot ("Nächster freier Termin")',
      request: { params: SlugParam, query: SelectionQuery.extend({ from: LocalDate, stylistId: z.string().uuid().optional() }) },
      responses: { 200: json(z.object({ next: z.object({ date: LocalDate, start: Minute }).nullable() }), 'Next slot'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const q = c.req.valid('query');
      return c.json({ next: await nextFree(ctx.db, ctx, selectionFrom(q), q.from, q.stylistId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/{slug}/bookings',
      tags: ['public'],
      summary: 'Send a booking request (no account). The slot is reserved until the salon answers.',
      request: {
        params: SlugParam,
        headers: z.object({ 'idempotency-key': z.string().min(8).max(100).optional() }),
        body: { content: { 'application/json': { schema: BookingRequestSchema } }, required: true },
      },
      responses: { 201: json(BookingResponseSchema, 'Request created'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const body = c.req.valid('json');
      if (body.website) throw Errors.validation({ website: 'invalid' }); // honeypot
      const key = c.req.valid('header')['idempotency-key'];
      const result = await withTx(ctx.db, async (tx) => {
        if (key) {
          const stored = await claimKey(tx, ctx.tenantId, key, { ...body, pow: undefined });
          if (stored) return stored.body as z.infer<typeof BookingResponseSchema>;
        }
        verifySolution(deps.secret, deps.clock.now(), body.pow);
        const r = await createAppointment(
          ctx,
          {
            selection: body.selection,
            date: body.date,
            start: parseHm(body.start),
            stylistId: body.stylistId,
            customer: body.customer,
            colorNotes: body.colorNotes,
            feeConsent: body.feeConsent,
            privacyAck: body.privacyAck,
            source: 'online',
            actor: 'customer',
          },
          tx,
        );
        const row = await getByToken(tx, ctx, r.manageToken);
        const response = { appointment: toPublic(ctx, r.appointment, row), manageToken: r.manageToken };
        if (key) await remember(tx, ctx.tenantId, key, { status: 201, body: response });
        return response;
      });
      return c.json(result, 201);
    },
  );

  const loadPublic = async (ctx: Ctx, token: string) => {
    const row = await getByToken(ctx.db, ctx, token);
    const [dto] = await toDtos(ctx.db, ctx, [row]);
    return toPublic(ctx, dto!, row);
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/appointments/{token}',
      tags: ['public'],
      summary: 'View own appointment via management link',
      request: { params: TokenParam },
      responses: { 200: json(PublicAppointmentSchema, 'Appointment'), ...errorResponses },
    }),
    async (c) => c.json(await loadPublic(c.get('ctx'), c.req.valid('param').token), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/{slug}/appointments/{token}/availability',
      tags: ['public'],
      summary: 'Slots for rescheduling (same service and stylist)',
      request: { params: TokenParam, query: z.object({ from: LocalDate, days: z.coerce.number().int().min(1).max(14).default(7) }) },
      responses: { 200: json(z.object({ days: z.array(DayAvailabilitySchema) }), 'Availability'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const row = await getByToken(ctx.db, ctx, c.req.valid('param').token);
      const q = c.req.valid('query');
      const days = await availability(ctx.db, ctx, selectionOf(row), q.from, q.days, { stylistId: row.stylist_id, excludeAppointmentId: row.id });
      return c.json({ days }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/{slug}/appointments/{token}/cancel',
      tags: ['public'],
      summary: 'Cancel own appointment (until cut-off)',
      request: { params: TokenParam },
      responses: { 200: json(PublicAppointmentSchema, 'Cancelled'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const token = c.req.valid('param').token;
      await cancelByToken(ctx, token);
      return c.json(await loadPublic(ctx, token), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/{slug}/appointments/{token}/reschedule',
      tags: ['public'],
      summary: 'Move own appointment (until cut-off); needs re-confirmation by the salon',
      request: { params: TokenParam, body: { content: { 'application/json': { schema: z.object({ date: LocalDate, start: Hm }) } }, required: true } },
      responses: { 200: json(PublicAppointmentSchema, 'Rescheduled'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const token = c.req.valid('param').token;
      const b = c.req.valid('json');
      await rescheduleByToken(ctx, token, b.date, parseHm(b.start));
      return c.json(await loadPublic(ctx, token), 200);
    },
  );

  app.get('/:slug/appointments/:token/calendar.ics', async (c) => {
    const ctx = c.get('ctx');
    const row = await getByToken(ctx.db, ctx, c.req.param('token'));
    if (row.status !== 'confirmed') throw Errors.notFound(); // only confirmed appointments go into calendars
    const [dto] = await toDtos(ctx.db, ctx, [row]);
    const ics = buildIcs({
      uid: `${row.id}@salon-booking`,
      start: row.start_at,
      end: row.end_at,
      summary: dto!.serviceLabel,
      location: `${ctx.profile.street}, ${ctx.profile.postalCode} ${ctx.profile.city}`,
      description: eventDescription(salonUrl(ctx, `/termin/${c.req.param('token')}`), ctx.profile.phoneDisplay),
      now: ctx.clock.now(),
      sequence: row.version,
    });
    return c.body(ics, 200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="termin.ics"' });
  });

  app.post('/:slug/unsubscribe/:token', async (c) => {
    const ok = await unsubscribe(c.get('ctx'), c.req.param('token'));
    if (!ok) throw Errors.invalidLink();
    return c.json({ ok: true }, 200);
  });

  return app;
}
