import pg from 'pg';
import { config } from './config.ts';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(user = config.db.user): Db {
  const pool = new pg.Pool({ ...config.db, user, max: 8 });
  pool.on('error', (err) => console.error('[db] error de conexión:', err.message));
  return pool;
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const out = await fn(tx);
    await tx.query('COMMIT');
    return out;
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
