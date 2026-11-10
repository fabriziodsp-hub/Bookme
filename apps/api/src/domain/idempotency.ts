import type { Tx } from '../db/pool.js';
import { Errors } from './errors.js';
import { sha256 } from './util.js';

export type Stored = { status: number; body: unknown };

/**
 * Claim an idempotency key inside the caller's transaction.
 * - new key → returns null (caller proceeds and must call `remember`)
 * - known key with same request → returns the stored response
 * - known key with different request → 422
 * A concurrent request with the same key blocks on the primary key until the first commits.
 */
export async function claimKey(tx: Tx, tenantId: string, key: string, request: unknown): Promise<Stored | null> {
  const hash = sha256(JSON.stringify(request));
  const ins = await tx.query(
    'INSERT INTO idempotency_key (tenant_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key',
    [tenantId, key, hash],
  );
  if (ins.rowCount) return null;
  const { rows } = await tx.query<{ request_hash: string; status_code: number | null; response: unknown }>(
    'SELECT request_hash, status_code, response FROM idempotency_key WHERE tenant_id = $1 AND key = $2',
    [tenantId, key],
  );
  const row = rows[0]!;
  if (row.request_hash !== hash) throw Errors.idempotencyMismatch();
  return { status: row.status_code ?? 200, body: row.response };
}

export async function remember(tx: Tx, tenantId: string, key: string, stored: Stored): Promise<void> {
  await tx.query('UPDATE idempotency_key SET status_code = $3, response = $4 WHERE tenant_id = $1 AND key = $2', [
    tenantId,
    key,
    stored.status,
    JSON.stringify(stored.body),
  ]);
}
