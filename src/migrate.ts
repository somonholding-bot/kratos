import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.ts';
import { createPool, withTx, type Db } from './db.ts';

// Aplica en orden los .sql de db/ que no estén registrados. Cada archivo, en una transacción.
export async function migrate(db: Db, log = console.log): Promise<string[]> {
  // Servidor y trabajador arrancan a la vez: un bloqueo asesor evita aplicar dos veces la misma migración.
  const lock = await db.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(7420)');
    return await applyPending(db, log);
  } finally {
    await lock.query('SELECT pg_advisory_unlock(7420)').catch(() => {});
    lock.release();
  }
}

async function applyPending(db: Db, log: (s: string) => void): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = fs.readdirSync(path.join(ROOT, 'db')).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(ROOT, 'db', file), 'utf8');
    await withTx(db, async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
    log(`[migrate] aplicado ${file}`);
    applied.push(file);
  }
  return applied;
}

if (import.meta.main) {
  const db = createPool();
  migrate(db)
    .then((a) => console.log(a.length ? `[migrate] ${a.length} migraciones aplicadas` : '[migrate] sin cambios'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => db.end());
}
