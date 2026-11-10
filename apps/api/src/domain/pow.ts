/**
 * Self-hosted proof-of-work challenge (ALTCHA-style, D-026): the browser must find `number` such that
 * sha256(salt + number) === challenge. Costs a phone well under a second, costs a bot farm real CPU.
 * Stateless: the challenge is HMAC-signed and expires; no cookies, no third party.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Errors } from './errors.js';

const hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function createChallenge(secret: string, now: Date, maxNumber = 50_000, ttlMs = 15 * 60_000) {
  const expires = now.getTime() + ttlMs;
  const salt = `${randomBytes(12).toString('hex')}?expires=${expires}`;
  const number = randomInt(maxNumber);
  const challenge = hex(`${salt}${number}`);
  const signature = createHmac('sha256', secret).update(challenge).digest('hex');
  return { algorithm: 'SHA-256' as const, challenge, salt, maxNumber, signature };
}

export function verifySolution(secret: string, now: Date, s: { challenge: string; salt: string; number: number; signature: string }): void {
  const expected = createHmac('sha256', secret).update(s.challenge).digest('hex');
  const okSig = expected.length === s.signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(s.signature));
  const expires = Number(/expires=(\d+)/.exec(s.salt)?.[1] ?? 0);
  if (!okSig || expires < now.getTime() || hex(`${s.salt}${s.number}`) !== s.challenge) {
    throw Errors.validation({ pow: 'Sicherheitsprüfung fehlgeschlagen. Bitte erneut versuchen.' });
  }
}

/** Test/dev helper: solve a challenge (what the browser does). */
export function solveChallenge(c: { challenge: string; salt: string; maxNumber: number }): number {
  for (let n = 0; n <= c.maxNumber; n++) if (hex(`${c.salt}${n}`) === c.challenge) return n;
  throw new Error('unsolvable');
}
