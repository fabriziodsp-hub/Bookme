import { loadSalonConfig, type SalonConfig } from '@salon/engine';
import { salonConfig } from './salon.config.js';

export { salonConfig as rawSalonConfig };
export { salonProfile, type SalonProfile } from './profile.js';

let cached: SalonConfig | undefined;

/** Validated salon configuration (throws at startup if invalid). */
export function getSalonConfig(): SalonConfig {
  cached ??= loadSalonConfig(salonConfig);
  return cached;
}
