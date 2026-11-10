/** Solve the self-hosted proof-of-work challenge with Web Crypto (no third party, no cookies). */
export interface Challenge {
  challenge: string;
  salt: string;
  maxNumber: number;
  signature: string;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function solve(c: Challenge): Promise<{ challenge: string; salt: string; number: number; signature: string }> {
  const enc = new TextEncoder();
  for (let n = 0; n <= c.maxNumber; n++) {
    const h = hex(await crypto.subtle.digest('SHA-256', enc.encode(`${c.salt}${n}`)));
    if (h === c.challenge) return { challenge: c.challenge, salt: c.salt, number: n, signature: c.signature };
  }
  throw new Error('challenge not solvable');
}
