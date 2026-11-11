/** Staff routes (/api/staff/…): salon from the session; owner-only routes marked. */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { addDays } from '@salon/engine';
import { salonNow } from '../../clock.js';
import { createAbsence, deleteAbsence, listAbsences } from '../../domain/absences.js';
import {
  activeStylists,
  createAppointment,
  eventsOf,
  getById,
  listInRange,
  listOpenRequests,
  staffAgeCheck,
  saveClientNoteDraft,
  staffDecide,
  staffSetFee,
  staffSetNote,
  staffSetStatus,
  staffUpdateBlocks,
  toDtos,
  type Actor,
} from '../../domain/appointments.js';
import { availability } from '../../domain/availability.js';
import { getCatalog, setCatalog } from '../../domain/catalog.js';
import type { Deps } from '../../domain/context.js';
import { addCustomerEntry, anonymizeCustomer, deleteCustomerEntry, exportCustomer, getCustomerCard, searchCustomers, setCustomerHealth } from '../../domain/customers.js';
import { Errors } from '../../domain/errors.js';
import { dayRange } from '../../domain/occupancy.js';
import { listPrices, setPrices } from '../../domain/prices.js';
import { ACCENTS, setHomepage, setOpeningHours, setTheme, THEME_PRESETS } from '../../domain/tenants.js';
import { createStaff, deleteStaff, listStaff, setStylistActive, setStylistPublic, setUsername, teamLogins } from '../../domain/staff.js';
import { requireOwner, requireStaff, type AppEnv } from '../middleware.js';
import {
  AbsenceSchema,
  AppointmentSchema,
  BlockSchema,
  CustomerInputSchema,
  CustomerSummarySchema,
  DayAvailabilitySchema,
  errorResponses,
  json,
  LocalDate,
  Minute,
  SelectionQuery,
  SelectionSchema,
  StatusEnum,
} from '../schemas.js';

const IdParam = z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const actorOf = (c: { get(k: 'user'): { id: string } }): Actor => `staff:${c.get('user').id}`;

export function staffRoutes(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('*', requireStaff(deps));
  app.use('/admin/*', requireOwner);
  app.use('/customers/:id/export', requireOwner);
  app.use('/customers/:id/anonymize', requireOwner);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/calendar',
      tags: ['staff'],
      summary: 'Appointments and absences in a date range (day/week, personal or team)',
      request: {
        query: z.object({
          from: LocalDate,
          days: z.coerce.number().int().min(1).max(31).default(1),
          stylistId: z.string().uuid().optional(),
          includeInactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
        }),
      },
      responses: {
        200: json(
          z.object({
            appointments: z.array(AppointmentSchema),
            absences: z.array(AbsenceSchema),
            stylists: z.array(z.object({ id: z.string(), displayName: z.string(), color: z.string() })),
            counts: z.record(z.string(), z.number()),
            openRequests: z.number(),
            now: z.object({ date: LocalDate, minute: Minute }),
          }),
          'Calendar',
        ),
        ...errorResponses,
      },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const q = c.req.valid('query');
      const from = dayRange(ctx.cfg, q.from).from;
      const to = dayRange(ctx.cfg, addDays(q.from, q.days - 1)).to;
      const stylists = q.stylistId ? [q.stylistId] : undefined;
      const [appointments, absences, open] = await Promise.all([
        listInRange(ctx.db, ctx, from, to, stylists, q.includeInactive),
        listAbsences(ctx.db, ctx, from, to),
        listOpenRequests(ctx.db, ctx),
      ]);
      // Counts for the 7-day strip around the range (Mon–Sun of the first date's week).
      const counts: Record<string, number> = {};
      for (const a of appointments) counts[a.date] = (counts[a.date] ?? 0) + 1;
      return c.json(
        {
          appointments,
          absences: stylists ? absences.filter((a) => stylists.includes(a.stylistId)) : absences,
          stylists: await activeStylists(ctx.db, ctx.tenantId),
          counts,
          openRequests: open.length,
          now: salonNow(ctx.clock, ctx.cfg.timeZone),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/requests',
      tags: ['staff'],
      summary: 'Open booking requests (requested + discuss)',
      responses: { 200: json(z.object({ requests: z.array(AppointmentSchema) }), 'Requests') },
    }),
    async (c) => c.json({ requests: await listOpenRequests(c.get('ctx').db, c.get('ctx')) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/appointments/{id}/client-note',
      tags: ['staff'],
      summary: 'Save the note to the client of an open request (sent with the answer, D-057)',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), note: z.string().max(500) })) },
      responses: { 200: json(AppointmentSchema, 'Saved'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await saveClientNoteDraft(c.get('ctx'), c.req.valid('param').id, b.version, b.note, actorOf(c)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/appointments/{id}/decision',
      tags: ['staff'],
      summary: 'Accept, decline or mark a request for discussion',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), decision: z.enum(['accept', 'decline', 'discuss']), reason: z.string().max(500).optional() })) },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await staffDecide(c.get('ctx'), c.req.valid('param').id, b.version, b.decision, actorOf(c), b.reason), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/appointments/{id}',
      tags: ['staff'],
      summary: 'One appointment with its history',
      request: { params: IdParam },
      responses: { 200: json(z.object({ appointment: AppointmentSchema, events: z.array(z.any()) }), 'Appointment'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const row = await getById(ctx.db, ctx, c.req.valid('param').id);
      return c.json({ appointment: (await toDtos(ctx.db, ctx, [row]))[0]!, events: await eventsOf(ctx.db, ctx, row.id) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/appointments',
      tags: ['staff'],
      summary: 'Create a confirmed appointment (phone / walk-in)',
      request: body(
        z.object({
          selection: SelectionSchema,
          date: LocalDate,
          start: Minute,
          stylistId: z.string().uuid(),
          /** An existing client card (D-064) – or `customer` for a new / matched client. */
          customerId: z.string().uuid().optional(),
          customer: CustomerInputSchema.optional(),
          colorNotes: z.string().max(500).optional(),
          internalNote: z.string().max(2000).optional(),
          notifyCustomer: z.boolean().default(true),
        }),
      ),
      responses: { 201: json(AppointmentSchema, 'Created'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      if (!b.customerId && !b.customer) throw Errors.validation({ customer: 'Bitte eine Kundin / einen Kunden wählen oder anlegen.' });
      const customer = b.customer ?? { firstName: '-', lastName: '-' }; // ignored when customerId is set
      const r = await createAppointment(c.get('ctx'), { ...b, customer, source: 'staff', actor: actorOf(c) });
      return c.json(r.appointment, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/appointments/{id}/blocks',
      tags: ['staff'],
      summary: 'Move / resize phases / reassign stylist (optimistic lock)',
      request: {
        params: IdParam,
        ...body(z.object({ version: z.number().int(), date: LocalDate, blocks: z.array(BlockSchema).min(1), stylistId: z.string().uuid().optional(), notifyCustomer: z.boolean().default(true) })),
      },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => c.json(await staffUpdateBlocks(c.get('ctx'), c.req.valid('param').id, c.req.valid('json'), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/appointments/{id}/status',
      tags: ['staff'],
      summary: 'Completed / no-show / cancel / undo',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), status: StatusEnum, reason: z.string().max(300).optional(), clientLateCancel: z.boolean().optional() })) },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => c.json(await staffSetStatus(c.get('ctx'), c.req.valid('param').id, c.req.valid('json'), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/appointments/{id}/fee',
      tags: ['staff'],
      summary: 'Record the Balayage fee as paid / waived / due',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), status: z.enum(['paid', 'waived', 'due']) })) },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await staffSetFee(c.get('ctx'), c.req.valid('param').id, b.version, b.status, actorOf(c)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/appointments/{id}/note',
      tags: ['staff'],
      summary: 'Internal note (never shown to clients)',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), note: z.string().max(2000) })) },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await staffSetNote(c.get('ctx'), c.req.valid('param').id, b.version, b.note, actorOf(c)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/appointments/{id}/age-check',
      tags: ['staff'],
      summary: 'Request an ID check or record its outcome (no document data stored)',
      request: { params: IdParam, ...body(z.object({ version: z.number().int(), action: z.enum(['request', 'verified', 'not_verified', 'not_presented']) })) },
      responses: { 200: json(AppointmentSchema, 'Updated'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await staffAgeCheck(c.get('ctx'), c.req.valid('param').id, b.version, b.action, c.get('user').id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/availability',
      tags: ['staff'],
      summary: 'Free slots for a new appointment (client rules, for orientation)',
      request: { query: SelectionQuery.extend({ from: LocalDate, days: z.coerce.number().int().min(1).max(14).default(1), stylistId: z.string().uuid().optional() }) },
      responses: { 200: json(z.object({ days: z.array(DayAvailabilitySchema) }), 'Availability'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      const q = c.req.valid('query');
      const sel = { serviceId: q.serviceId, audience: q.audience, adult: q.adult, variant: q.variant, finish: q.finish || undefined };
      return c.json({ days: await availability(ctx.db, ctx, sel, q.from, q.days, q.stylistId ? { stylistId: q.stylistId } : {}) }, 200);
    },
  );

  // ----- absences -----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/absences',
      tags: ['staff'],
      summary: 'Create an absence (rejected over existing appointments)',
      request: body(
        z.object({
          stylistId: z.string().uuid(),
          from: z.object({ date: LocalDate, minute: Minute }),
          to: z.object({ date: LocalDate, minute: Minute }),
          kind: z.enum(['vacation', 'sick', 'training', 'other']),
          note: z.string().max(500).optional(),
        }),
      ),
      responses: { 201: json(AbsenceSchema, 'Created'), ...errorResponses },
    }),
    async (c) => c.json(await createAbsence(c.get('ctx'), c.req.valid('json'), c.get('user').id), 201),
  );

  app.openapi(
    createRoute({ method: 'delete', path: '/absences/{id}', tags: ['staff'], summary: 'Delete an absence', request: { params: IdParam }, responses: { 204: { description: 'Deleted' }, ...errorResponses } }),
    async (c) => {
      await deleteAbsence(c.get('ctx'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  // ----- profile switch (D-055): colleagues with a login; names and user names only -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/team-logins',
      tags: ['staff'],
      summary: 'Colleagues with a login, for switching the profile on a shared device',
      responses: { 200: json(z.object({ logins: z.array(z.object({ id: z.string(), displayName: z.string(), username: z.string().nullable() })) }), 'Logins') },
    }),
    async (c) => c.json({ logins: await teamLogins(c.get('ctx').db, c.get('ctx').tenantId) }, 200),
  );

  // ----- customers -----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/customers',
      tags: ['staff'],
      summary: 'Client list (all clients without q) or search by name, phone or e-mail; sorted by name or next appointment',
      request: {
        query: z.object({
          q: z.string().max(100).default(''),
          sort: z.enum(['name', 'next']).default('name'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        }),
      },
      responses: { 200: json(z.object({ customers: z.array(CustomerSummarySchema), hasMore: z.boolean() }), 'Results') },
    }),
    async (c) => {
      const { q, sort, limit, offset } = c.req.valid('query');
      return c.json(await searchCustomers(c.get('ctx').db, c.get('ctx'), q, { sort, limit, offset }), 200);
    },
  );

  // Client card: contact, all appointments, recipes/notes, health data (only with explicit consent).
  app.get('/customers/:id', async (c) => c.json(await getCustomerCard(c.get('ctx').db, c.get('ctx'), c.req.param('id')), 200));

  const EntryInput = z.object({ kind: z.enum(['color', 'note']), body: z.string().min(1).max(2000) });
  app.post('/customers/:id/entries', async (c) => {
    const b = EntryInput.safeParse(await c.req.json().catch(() => null));
    if (!b.success) throw Errors.validation(b.error.flatten().fieldErrors);
    await addCustomerEntry(c.get('ctx'), c.req.param('id'), b.data, c.get('user').id);
    return c.json(await getCustomerCard(c.get('ctx').db, c.get('ctx'), c.req.param('id')), 201);
  });
  app.delete('/customers/:id/entries/:entryId', async (c) => {
    await deleteCustomerEntry(c.get('ctx'), c.req.param('id'), c.req.param('entryId'), c.get('user'));
    return c.body(null, 204);
  });

  const HealthInput = z.object({ consent: z.boolean(), notes: z.string().max(2000).nullable().optional() });
  app.put('/customers/:id/health', async (c) => {
    const b = HealthInput.safeParse(await c.req.json().catch(() => null));
    if (!b.success) throw Errors.validation(b.error.flatten().fieldErrors);
    await setCustomerHealth(c.get('ctx'), c.req.param('id'), b.data, c.get('user').id);
    return c.json(await getCustomerCard(c.get('ctx').db, c.get('ctx'), c.req.param('id')), 200);
  });

  app.get('/customers/:id/export', async (c) => {
    const data = await exportCustomer(c.get('ctx').db, c.get('ctx'), c.req.param('id'));
    return c.json(data, 200, { 'content-disposition': `attachment; filename="kunde-${c.req.param('id')}.json"` });
  });

  app.post('/customers/:id/anonymize', async (c) => {
    await anonymizeCustomer(c.get('ctx'), c.req.param('id'), 'request');
    return c.body(null, 204);
  });

  // ----- owner admin -----
  const PriceEntry = z.object({
    serviceId: z.string(),
    variant: z.string().default(''),
    priceCents: z.number().int().min(0).max(1_000_000),
    isFrom: z.boolean().default(false),
    finishSurchargeCents: z.number().int().min(0).max(100_000).nullable().default(null),
  });

  app.openapi(
    createRoute({ method: 'get', path: '/admin/prices', tags: ['owner'], summary: 'Price list', responses: { 200: json(z.object({ prices: z.array(PriceEntry) }), 'Prices') } }),
    async (c) => c.json({ prices: await listPrices(c.get('ctx').db, c.get('ctx').tenantId) }, 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/admin/prices', tags: ['owner'], summary: 'Replace price list', request: body(z.object({ prices: z.array(PriceEntry).max(200) })), responses: { 200: json(z.object({ prices: z.array(PriceEntry) }), 'Prices'), ...errorResponses } }),
    async (c) => c.json({ prices: await setPrices(c.get('ctx'), c.req.valid('json').prices) }, 200),
  );

  // Services editor (D-048): services, phases and durations; validated by the engine.
  const Catalog = z.object({ services: z.array(z.any()), version: z.string(), inUse: z.array(z.string()), step: z.number() });
  app.openapi(
    createRoute({ method: 'get', path: '/admin/services', tags: ['owner'], summary: 'Services, phases and durations (with version and ids that have appointments)', responses: { 200: json(Catalog, 'Catalogue') } }),
    async (c) => c.json(await getCatalog(c.get('ctx')), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/services',
      tags: ['owner'],
      summary: 'Replace services (optimistic lock via version; services with appointments can only be hidden)',
      request: body(z.object({ services: z.array(z.any()).max(60), version: z.string().max(64) })),
      responses: { 200: json(Catalog, 'Saved'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await setCatalog(c.get('ctx'), b.services, b.version), 200);
    },
  );

  const Hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const Day = z.object({ open: Hm, close: Hm, breaks: z.array(z.tuple([Hm, Hm])).max(4) }).nullable();
  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/opening-hours',
      tags: ['owner'],
      summary: 'Change opening hours (dryRun=true previews conflicting appointments)',
      request: body(z.object({ dryRun: z.boolean().default(true), weeklyHours: z.object({ mon: Day, tue: Day, wed: Day, thu: Day, fri: Day, sat: Day, sun: Day }) })),
      responses: { 200: json(z.object({ conflicts: z.array(z.any()), weeklyHours: z.any() }), 'Result'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await setOpeningHours(c.get('ctx'), b.weeklyHours, b.dryRun), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/theme',
      tags: ['owner'],
      summary: 'Theme preset and accent (contrast-checked palette)',
      request: body(z.object({ preset: z.enum(THEME_PRESETS as [string, ...string[]]), accent: z.enum(ACCENTS as [string, ...string[]]) })),
      responses: { 200: json(z.object({ preset: z.string(), accent: z.string() }), 'Theme'), ...errorResponses },
    }),
    async (c) => c.json(await setTheme(c.get('ctx'), c.req.valid('json') as never), 200),
  );

  app.get('/admin/staff', async (c) => c.json({ staff: await listStaff(c.get('ctx').db, c.get('ctx').tenantId) }));
  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/staff',
      tags: ['owner'],
      summary: 'Add a stylist (optionally with login)',
      request: body(z.object({ displayName: z.string().min(1).max(60), email: z.string().email().optional(), username: z.string().max(30).optional(), password: z.string().min(12).max(200).optional(), role: z.enum(['owner', 'stylist']).default('stylist') })),
      responses: { 201: json(z.object({ id: z.string() }), 'Created'), ...errorResponses },
    }),
    async (c) => c.json(await createStaff(c.get('ctx').db, c.get('ctx').tenantId, c.req.valid('json')), 201),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/staff/{id}/username',
      tags: ['owner'],
      summary: 'Set or remove the user name of a login (D-049)',
      request: { params: z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) }), ...body(z.object({ username: z.string().max(30).nullable() })) },
      responses: { 200: json(z.object({ username: z.string().nullable() }), 'Saved'), ...errorResponses },
    }),
    async (c) => c.json(await setUsername(c.get('ctx').db, c.get('ctx').tenantId, c.req.valid('param').id, c.req.valid('json').username), 200),
  );
  // D-052: public homepage texts and team (opt-in, public name only)
  const HomepageBody = z.object({ tagline: z.string().max(200), about: z.string().max(3000) });
  app.openapi(
    createRoute({ method: 'get', path: '/admin/homepage', tags: ['owner'], summary: 'Homepage texts', responses: { 200: json(HomepageBody, 'Texts') } }),
    async (c) => c.json(c.get('ctx').tenant.homepage, 200),
  );
  app.openapi(
    createRoute({ method: 'put', path: '/admin/homepage', tags: ['owner'], summary: 'Set homepage texts (plain text; empty hides the section)', request: body(HomepageBody), responses: { 200: json(HomepageBody, 'Saved'), ...errorResponses } }),
    async (c) => c.json(await setHomepage(c.get('ctx'), c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/staff/{id}/public',
      tags: ['owner'],
      summary: 'Show a stylist on the homepage under a public name (with their consent)',
      request: { params: z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) }), ...body(z.object({ show: z.boolean(), publicName: z.string().max(60).nullable() })) },
      responses: { 200: json(z.object({ show: z.boolean(), publicName: z.string().nullable() }), 'Saved'), ...errorResponses },
    }),
    async (c) => c.json(await setStylistPublic(c.get('ctx').db, c.get('ctx').tenantId, c.req.valid('param').id, c.req.valid('json')), 200),
  );
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/admin/staff/{id}',
      tags: ['owner'],
      summary: 'Delete a staff profile (D-054): fully, or keeping only the name for past appointments',
      request: { params: IdParam },
      responses: { 200: json(z.object({ removed: z.enum(['deleted', 'anonymized']) }), 'Removed'), ...errorResponses },
    }),
    async (c) => {
      const ctx = c.get('ctx');
      return c.json(await deleteStaff(ctx.db, { tenantId: ctx.tenantId, now: ctx.clock.now() }, c.req.valid('param').id, c.get('user').id), 200);
    },
  );
  app.post('/admin/staff/:id/active', async (c) => {
    const { active } = await c.req.json<{ active: boolean }>();
    await setStylistActive(c.get('ctx').db, c.get('ctx').tenantId, c.req.param('id'), !!active);
    return c.body(null, 204);
  });

  return app;
}
