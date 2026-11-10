import type { SalonProfile } from '@salon/config';
import type { SalonConfig } from '@salon/engine';
import type { Clock } from '../clock.js';
import type { Db } from '../db/pool.js';

/** Process-wide dependencies (injected → testable). */
export interface Deps {
  db: Db;
  clock: Clock;
  /** e.g. https://termine.example.de – salon pages live at /{slug} */
  publicBaseUrl: string;
  whatsappEnabled: boolean;
  /** Server secret for HMAC tokens (APP_SECRET, ≥ 32 chars). */
  secret: string;
}

export interface Theme {
  preset: 'dark' | 'light' | 'warm' | 'contrast';
  accent: 'emerald' | 'violet' | 'rose' | 'amber' | 'sky' | 'slate';
}

/** Texts of the public salon homepage, written by the salon (D-052). Empty = section hidden. */
export interface Homepage {
  tagline: string;
  about: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  profile: SalonProfile;
  cfg: SalonConfig;
  theme: Theme;
  logoAssetId: string | null;
  homepage: Homepage;
  active: boolean;
}

/** Request-scoped context: always bound to exactly one salon. */
export interface Ctx extends Deps {
  tenant: Tenant;
  tenantId: string;
  cfg: SalonConfig;
  profile: SalonProfile;
}

export function tenantCtx(deps: Deps, tenant: Tenant): Ctx {
  return { ...deps, tenant, tenantId: tenant.id, cfg: tenant.cfg, profile: tenant.profile };
}

export function salonUrl(ctx: Ctx, path = ''): string {
  return `${ctx.publicBaseUrl.replace(/\/$/, '')}/${ctx.tenant.slug}${path}`;
}
