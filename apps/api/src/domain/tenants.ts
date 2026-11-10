/** Salons (tenants): lookup, platform-admin management, owner settings (hours, prices, theme). */
import { rawSalonConfig, salonProfile, type SalonProfile } from '@salon/config';
import { checkPlacement, loadSalonConfig, type SalonConfig } from '@salon/engine';
import { listInRange } from './appointments.js';
import { createHash } from 'node:crypto';
import { withTx, type Queryable } from '../db/pool.js';
import type { Ctx, Deps, Homepage, Tenant, Theme } from './context.js';
import { AppError, Errors } from './errors.js';

interface Row {
  id: string;
  slug: string;
  name: string;
  profile: SalonProfile;
  config: unknown;
  theme: Theme;
  logo_asset_id: string | null;
  homepage: Partial<Homepage> | null;
  active: boolean;
}

function toTenant(r: Row, today: string): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    profile: r.profile,
    cfg: loadSalonConfig(r.config, today),
    theme: r.theme,
    logoAssetId: r.logo_asset_id,
    homepage: { tagline: r.homepage?.tagline ?? '', about: r.homepage?.about ?? '' },
    active: r.active,
  };
}

// Tiny cache: config parsing (incl. DST validation) is not free. Invalidated on every write.
const cache = new Map<string, { tenant: Tenant; at: number }>();
const TTL = 30_000;
export const invalidateTenant = (slugOrId?: string) => {
  if (!slugOrId) return cache.clear();
  // Writes know the slug; drop every entry of that salon (by slug and by id).
  for (const [k, v] of cache) if (k === slugOrId || v.tenant.slug === slugOrId || v.tenant.id === slugOrId) cache.delete(k);
};

export async function tenantBySlug(deps: Deps, slug: string): Promise<Tenant> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.tenant;
  const { rows } = await deps.db.query<Row>('SELECT * FROM tenant WHERE slug = $1 AND active', [slug]);
  if (!rows[0]) throw Errors.notFound();
  const t = toTenant(rows[0], deps.clock.now().toISOString().slice(0, 10));
  cache.set(slug, { tenant: t, at: Date.now() });
  return t;
}

export async function tenantById(deps: Deps, id: string, includeInactive = false): Promise<Tenant> {
  const key = `id:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL && (includeInactive || hit.tenant.active)) return hit.tenant;
  const { rows } = await deps.db.query<Row>(`SELECT * FROM tenant WHERE id = $1 ${includeInactive ? '' : 'AND active'}`, [id]);
  if (!rows[0]) throw Errors.notFound();
  const t = toTenant(rows[0], deps.clock.now().toISOString().slice(0, 10));
  cache.set(key, { tenant: t, at: Date.now() });
  return t;
}

export async function listTenants(db: Queryable) {
  const { rows } = await db.query<{ id: string; slug: string; name: string; active: boolean; logo_asset_id: string | null }>(
    'SELECT id, slug, name, active, logo_asset_id FROM tenant ORDER BY name',
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, active: r.active, hasLogo: !!r.logo_asset_id }));
}

/** Platform admin: create a salon from the template config, with one stylist. */
export async function createTenant(
  deps: Deps,
  input: { slug: string; name: string; profile?: Partial<SalonProfile>; config?: unknown; stylistName: string },
): Promise<Tenant> {
  const cfg = loadSalonConfig(input.config ?? rawSalonConfig, deps.clock.now().toISOString().slice(0, 10));
  const profile = { ...salonProfile, name: input.name, ...input.profile };
  return withTx(deps.db, async (tx) => {
    const exists = await tx.query('SELECT 1 FROM tenant WHERE slug = $1', [input.slug]);
    if (exists.rowCount) throw new AppError('SLUG_TAKEN', 409, 'Diese Adresse ist bereits vergeben.');
    const { rows } = await tx.query<Row>(
      'INSERT INTO tenant (slug, name, profile, config) VALUES ($1, $2, $3, $4) RETURNING *',
      [input.slug, input.name, JSON.stringify(profile), JSON.stringify(cfg)],
    );
    await tx.query('INSERT INTO stylist (tenant_id, display_name) VALUES ($1, $2)', [rows[0]!.id, input.stylistName]);
    return toTenant(rows[0]!, deps.clock.now().toISOString().slice(0, 10));
  });
}

async function saveConfig(ctx: Ctx, cfg: SalonConfig): Promise<void> {
  await ctx.db.query('UPDATE tenant SET config = $2 WHERE id = $1', [ctx.tenantId, JSON.stringify(cfg)]);
  invalidateTenant(ctx.tenant.slug);
}

/**
 * Owner: change opening hours. Never moves appointments; returns the appointments that would
 * lie outside the new hours so the UI can show them (preview with `dryRun`).
 */
export async function setOpeningHours(ctx: Ctx, weeklyHours: unknown, dryRun: boolean) {
  let cfg: SalonConfig;
  try {
    cfg = loadSalonConfig({ ...ctx.cfg, weeklyHours }, ctx.clock.now().toISOString().slice(0, 10));
  } catch (e) {
    throw Errors.validation({ weeklyHours: (e as Error).message });
  }
  const now = ctx.clock.now();
  const future = await listInRange(ctx.db, ctx, now, new Date(now.getTime() + 400 * 86_400_000));
  const conflicts = future
    .filter((a) => ['requested', 'discuss', 'confirmed'].includes(a.status))
    .filter((a) => checkPlacement({ config: cfg, date: a.date, blocks: a.blocks, occupancy: { busy: [], absences: [] }, mode: 'staff' }).length > 0)
    .map((a) => ({ id: a.id, refCode: a.refCode, date: a.date, start: a.start, customer: `${a.customer.firstName} ${a.customer.lastName}` }));
  if (!dryRun) await saveConfig(ctx, cfg);
  return { conflicts, weeklyHours: cfg.weeklyHours };
}

export const THEME_PRESETS: Theme['preset'][] = ['dark', 'light', 'warm', 'contrast'];
export const ACCENTS: Theme['accent'][] = ['emerald', 'violet', 'rose', 'amber', 'sky', 'slate'];

export async function setTheme(ctx: Ctx, theme: Theme): Promise<Theme> {
  if (!THEME_PRESETS.includes(theme.preset) || !ACCENTS.includes(theme.accent)) throw Errors.validation({ theme: 'unknown' });
  await ctx.db.query('UPDATE tenant SET theme = $2 WHERE id = $1', [ctx.tenantId, JSON.stringify(theme)]);
  invalidateTenant(ctx.tenant.slug);
  return theme;
}

/** Owner: texts of the public homepage (D-052). Plain text only – rendered as text, never as HTML. */
export async function setHomepage(ctx: Ctx, input: Homepage): Promise<Homepage> {
  const clean = (v: string, max: number) => v.replace(/\r\n?/g, '\n').trim().slice(0, max);
  const h = { tagline: clean(input.tagline, 120), about: clean(input.about, 1500) };
  await ctx.db.query('UPDATE tenant SET homepage = $2 WHERE id = $1', [ctx.tenantId, JSON.stringify(h)]);
  invalidateTenant(ctx.tenant.slug);
  return h;
}

export async function setProfile(ctx: Ctx, profile: SalonProfile): Promise<void> {
  await ctx.db.query('UPDATE tenant SET profile = $2, name = $3 WHERE id = $1', [ctx.tenantId, JSON.stringify(profile), profile.name]);
  invalidateTenant(ctx.tenant.slug);
}

export async function setTenantActive(deps: Deps, id: string, active: boolean): Promise<void> {
  const r = await deps.db.query<{ slug: string }>('UPDATE tenant SET active = $2 WHERE id = $1 RETURNING slug', [id, active]);
  if (!r.rows[0]) throw Errors.notFound();
  invalidateTenant(r.rows[0].slug);
}

// ---------- logo (platform admin only) ----------

const MAX_LOGO = 512 * 1024;

/** Reject SVGs with scripts, event handlers, external references or foreign objects. */
export function assertSafeSvg(svg: string): void {
  const bad = /<script|on[a-z]+\s*=|javascript:|<foreignObject|<iframe|<embed|<object|xlink:href\s*=\s*["'](?!#)|href\s*=\s*["'](?!#)|<!ENTITY/i;
  if (bad.test(svg)) throw Errors.validation({ logo: 'SVG enthält nicht erlaubte Elemente.' });
}

function sniff(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

export async function setLogo(deps: Deps, tenantId: string, bytes: Buffer): Promise<{ assetId: string }> {
  if (bytes.length === 0 || bytes.length > MAX_LOGO) throw Errors.validation({ logo: 'Maximal 512 KB.' });
  const type = sniff(bytes);
  if (!type) throw Errors.validation({ logo: 'Erlaubt: PNG, JPEG, WebP, SVG.' });
  if (type === 'image/svg+xml') assertSafeSvg(bytes.toString('utf8'));
  return withTx(deps.db, async (tx) => {
    const a = await tx.query<{ id: string }>('INSERT INTO asset (content_type, bytes, sha256) VALUES ($1, $2, $3) RETURNING id', [
      type,
      bytes,
      createHash('sha256').update(bytes).digest('hex'),
    ]);
    const t = await tx.query<{ slug: string }>('UPDATE tenant SET logo_asset_id = $2 WHERE id = $1 RETURNING slug', [tenantId, a.rows[0]!.id]);
    if (!t.rows[0]) throw Errors.notFound();
    invalidateTenant(t.rows[0].slug);
    return { assetId: a.rows[0]!.id };
  });
}

export async function getLogo(db: Queryable, tenant: Tenant) {
  if (!tenant.logoAssetId) return null;
  const { rows } = await db.query<{ content_type: string; bytes: Buffer; sha256: string }>('SELECT content_type, bytes, sha256 FROM asset WHERE id = $1', [
    tenant.logoAssetId,
  ]);
  return rows[0] ?? null;
}
