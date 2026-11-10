/** Platform admin routes (/api/platform/…): salons, logos, services. Only role platform_admin. */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { tenantCtx, type Deps } from '../../domain/context.js';
import { createStaff, listStaff } from '../../domain/staff.js';
import { getCatalog, setCatalog, setServicesConfig } from '../../domain/catalog.js';
import { createTenant, listTenants, setLogo, setTenantActive, tenantById } from '../../domain/tenants.js';
import { requirePlatformAdmin, type AppEnv } from '../middleware.js';
import { errorResponses, json } from '../schemas.js';

const IdParam = z.object({ id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }) });

export function platformRoutes(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>();
  app.use('*', requirePlatformAdmin(deps));

  app.openapi(
    createRoute({ method: 'get', path: '/tenants', tags: ['platform'], summary: 'All salons', responses: { 200: json(z.object({ tenants: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), active: z.boolean(), hasLogo: z.boolean() })) }), 'Salons') } }),
    async (c) => c.json({ tenants: await listTenants(deps.db) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tenants',
      tags: ['platform'],
      summary: 'Create a salon from the template, with an owner account',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({
                slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
                name: z.string().min(1).max(80),
                ownerName: z.string().min(1).max(60),
                ownerEmail: z.string().email(),
                ownerPassword: z.string().min(12).max(200),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 201: json(z.object({ id: z.string(), slug: z.string() }), 'Created'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const t = await createTenant(deps, { slug: b.slug, name: b.name, stylistName: b.ownerName });
      // The template creates one stylist; attach the owner login to it.
      const [stylist] = await listStaff(deps.db, t.id);
      await deps.db.query('DELETE FROM stylist WHERE id = $1', [stylist!.id]);
      await createStaff(deps.db, t.id, { displayName: b.ownerName, email: b.ownerEmail, password: b.ownerPassword, role: 'owner' });
      return c.json({ id: t.id, slug: t.slug }, 201);
    },
  );

  app.post('/tenants/:id/active', async (c) => {
    const { active } = await c.req.json<{ active: boolean }>();
    await setTenantActive(deps, c.req.param('id'), !!active);
    return c.body(null, 204);
  });

  // Logo upload: raw body (image/png, image/webp, image/jpeg, image/svg+xml), max 512 KB.
  app.openapi(
    createRoute({
      method: 'put',
      path: '/tenants/{id}/logo',
      tags: ['platform'],
      summary: 'Upload the salon logo (only platform admins)',
      request: { params: IdParam },
      responses: { 200: json(z.object({ assetId: z.string() }), 'Stored'), ...errorResponses },
    }),
    async (c) => {
      const buf = Buffer.from(await c.req.arrayBuffer());
      return c.json(await setLogo(deps, c.req.valid('param').id, buf), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/tenants/{id}/services',
      tags: ['platform'],
      summary: 'Replace services and rules of a salon (validated by the engine; opening hours stay)',
      request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ config: z.any() }) } }, required: true } },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Saved'), ...errorResponses },
    }),
    async (c) => {
      const ctx = tenantCtx(deps, await tenantById(deps, c.req.valid('param').id, true));
      await setServicesConfig(ctx, c.req.valid('json').config);
      return c.json({ ok: true }, 200);
    },
  );

  // Services editor for any salon (same rules as the owner's editor, D-048).
  const Catalog = z.object({ services: z.array(z.any()), version: z.string(), inUse: z.array(z.string()), step: z.number() });
  app.openapi(
    createRoute({ method: 'get', path: '/tenants/{id}/catalog', tags: ['platform'], summary: 'Services of a salon (editor format)', request: { params: IdParam }, responses: { 200: json(Catalog, 'Catalogue'), ...errorResponses } }),
    async (c) => c.json(await getCatalog(tenantCtx(deps, await tenantById(deps, c.req.valid('param').id, true))), 200),
  );
  app.openapi(
    createRoute({
      method: 'put',
      path: '/tenants/{id}/catalog',
      tags: ['platform'],
      summary: 'Replace the services of a salon (optimistic lock via version)',
      request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ services: z.array(z.any()).max(60), version: z.string().max(64) }) } }, required: true } },
      responses: { 200: json(Catalog, 'Saved'), ...errorResponses },
    }),
    async (c) => {
      const ctx = tenantCtx(deps, await tenantById(deps, c.req.valid('param').id, true));
      const b = c.req.valid('json');
      return c.json(await setCatalog(ctx, b.services, b.version), 200);
    },
  );

  app.post('/tenants/:id/staff', async (c) => {
    const b = await c.req.json<{ displayName: string; email?: string; password?: string; role?: 'owner' | 'stylist' }>();
    return c.json(await createStaff(deps.db, (await tenantById(deps, c.req.param('id'), true)).id, b), 201);
  });

  return app;
}
