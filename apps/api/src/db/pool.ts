import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

// Return timestamptz as Date (default) and bigint/count as number.
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max });
  // An idle client can die (DB restart, network). Without this handler Node would crash the process.
  pool.on('error', (err) => console.error(`[db] idle client error: ${err.message}`));
  return pool;
}

/** SQLSTATE codes we react to. */
export const PG = {
  EXCLUSION_VIOLATION: '23P01',
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK: '40P01',
} as const;

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

/**
 * Run `fn` in a transaction. Retries on serialization failures / deadlocks
 * (never on business errors).
 */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = pgCode(err);
      if (attempt < retries && (code === PG.SERIALIZATION_FAILURE || code === PG.DEADLOCK)) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Serialise writes per stylist and local day (in addition to the exclusion constraint). */
export async function lockStylistDay(tx: Tx, stylistId: string, date: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${stylistId}:${date}`]);
}
