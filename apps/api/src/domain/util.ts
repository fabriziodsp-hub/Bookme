import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { de } from '@salon/i18n';
import { findService, type SalonConfig, type Selection } from '@salon/engine';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/**
 * Management-link token: HMAC of the appointment id with the server secret. Deterministic, so every
 * e-mail can carry the same working link without storing the token; the DB keeps only its SHA-256
 * for lookup, and setting that hash to NULL revokes the link (e.g. after anonymisation).
 */
export const manageTokenFor = (secret: string, appointmentId: string) =>
  createHmac('sha256', secret).update(`manage:${appointmentId}`).digest('base64url');

/** Unsubscribe link for the birthday offer – same scheme as management links. */
export const unsubscribeTokenFor = (secret: string, customerId: string) =>
  createHmac('sha256', secret).update(`unsubscribe:${customerId}`).digest('base64url');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function newRefCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** Normalise to E.164 with Germany as default region; null if invalid. */
export function normalizePhone(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), 'DE');
  return p?.isValid() ? p.format('E.164') : null;
}

/** Name of a booked service: the salon's own name (services editor) wins over the German default. */
export function serviceLabel(cfg: SalonConfig, sel: Pick<Selection, 'serviceId' | 'variant' | 'finish'>): string {
  const name = findService(cfg, sel.serviceId)?.label ?? (de.service as Record<string, string>)[sel.serviceId] ?? sel.serviceId;
  const variant = sel.variant ? ` (${(de.variant as Record<string, string>)[sel.variant] ?? sel.variant})` : '';
  const finish = sel.finish ? ` + ${de.finish}` : '';
  return `${name}${variant}${finish}`;
}
