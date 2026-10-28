import os from 'node:os';
import { createPool, type Db } from './db.ts';
import { config } from './config.ts';
import { migrate } from './migrate.ts';
import { audit, heartbeat, isHalted } from './core/state.ts';
import { claimNext, completeTask, failTask, recoverStale } from './core/tasks.ts';
import { handlers } from './core/handlers.ts';

// Ciclo: observar → (parada/pausa?) → reclamar → ejecutar → comprobar → registrar → esperar.
// Si no hay trabajo útil, solo late y espera.

export async function tick(db: Db, workerId: string): Promise<'parado' | 'sin_trabajo' | 'ejecutada' | 'fallida'> {
  await heartbeat(db, 'worker', { workerId });
  await recoverStale(db, workerId);
  const halt = await isHalted(db);
  if (halt.halted) return 'parado';
  const task = await claimNext(db, workerId, Object.keys(handlers));
  if (!task) return 'sin_trabajo';
  try {
    const result = await handlers[task.type](db, task);
    await completeTask(db, task, workerId, result);
    return 'ejecutada';
  } catch (err: any) {
    await failTask(db, task, workerId, String(err?.message ?? err));
    return 'fallida';
  }
}

if (import.meta.main) {
  const db = createPool();
  const workerId = `worker@${os.hostname()}:${process.pid}`;
  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${sig}: cerrando`);
    await audit(db, workerId, 'proceso.detenido', { sig }).catch(() => {});
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  await migrate(db);
  await audit(db, workerId, 'proceso.iniciado', {});
  console.log(`[worker] activo (${workerId})`);
  while (!stopping) {
    try {
      let r = await tick(db, workerId);
      while (r === 'ejecutada' && !stopping) r = await tick(db, workerId);
    } catch (err: any) {
      console.error('[worker] error del ciclo:', err.message); // p. ej. Postgres caído: reintenta en el siguiente ciclo
    }
    await new Promise((res) => setTimeout(res, config.worker.pollMs));
  }
}
