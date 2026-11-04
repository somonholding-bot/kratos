import { subscriptionAvailable } from './core/subscription.ts';
import os from 'node:os';
import { createPool, type Db } from './db.ts';
import { config } from './config.ts';
import { migrate } from './migrate.ts';
import { audit, getState, heartbeat, isHalted } from './core/state.ts';
import { claimNext, completeTask, deferTask, failTask, markVerifying, recoverStale } from './core/tasks.ts';
import { failedChecks, verifyTask } from './core/verify.ts';
import { syncToolRegistry } from './core/toolregistry.ts';
import { handlers } from './core/handlers.ts';
import { aiStatus } from './core/brain.ts';
import { reconcileProduction } from './core/fabrica.ts';
import { advanceChain } from './core/cadena.ts';
import { afterPlaybookTask, onPlaybookVerificationFailed, recordPlaybookOutcome, syncPlaybooksFromFiles } from './core/playbooks.ts';

// Ciclo: observar → (parada/pausa?) → reclamar → ejecutar → comprobar → registrar → esperar.
// Si no hay trabajo útil, solo late y espera.

export async function tick(db: Db, workerId: string): Promise<'parado' | 'sin_trabajo' | 'ejecutada' | 'fallida'> {
  await heartbeat(db, 'worker', { workerId });
  await recoverStale(db, workerId);
  const halt = await isHalted(db);
  if (halt.halted) return 'parado';
  const ai = await aiStatus(db);
  const sub = (await getState(db)).agents_engine !== 'api' && (await subscriptionAvailable(db)).ok;   // agentes con la suscripción
  if (ai.active || sub) {
    await db.query(`UPDATE tasks SET status = 'pendiente', updated_at = now()
      WHERE status = 'esperando_ia' AND type = 'agente'`);
  }
  const task = await claimNext(db, workerId, Object.keys(handlers));
  if (!task) return 'sin_trabajo';
  try {
    const result = await handlers[task.type](db, task);
    // Fase B: el resultado se verifica con hechos antes de dar la tarea por completada
    await markVerifying(db, task, workerId);
    const v = await verifyTask(db, task, result);
    if (!v.ok) {
      await audit(db, workerId, 'tarea.verificacion_fallida', { id: task.id, fallos: failedChecks(v) }, task.business_id);
      // Fase D: la política de recuperación del playbook decide (reintentar, revisar o fallar) y el fallo queda contado en el playbook
      if (task.playbook_id) await onPlaybookVerificationFailed(db, task, workerId, failedChecks(v));
      else await failTask(db, task, workerId, `Verificación fallida: ${failedChecks(v)}`);
      return 'fallida';
    }
    const done = await completeTask(db, task, workerId, result, v);
    if (done.completed && task.playbook_id) {
      await recordPlaybookOutcome(db, task, true, '', Number(result?.costUsd) || 0).catch((e) => audit(db, workerId, 'playbook.error', { id: task.id, error: String(e?.message ?? e).slice(0, 200) }));
      if (task.type === 'agente') await afterPlaybookTask(db, task, result).catch((e) => audit(db, workerId, 'playbook.encadenado_error', { id: task.id, error: String(e?.message ?? e).slice(0, 200) }));
    }
    return 'ejecutada';
  } catch (err: any) {
    if (err && 'retryAt' in err) {   // suscripción agotada o no disponible: vuelve a la cola sin contar como fallo
      const until = err.retryAt ? new Date(err.retryAt) : new Date(Date.now() + 30 * 60_000);
      await deferTask(db, task, workerId, until, String(err.message));
      return 'aplazada';
    }
    await failTask(db, task, workerId, String(err?.message ?? err));
    if (task.playbook_id) await recordPlaybookOutcome(db, task, false, String(err?.message ?? err)).catch(() => {});
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
  await syncToolRegistry(db).catch((e) => console.error('[worker] registro de herramientas:', e.message));
  await syncPlaybooksFromFiles(db).then((r) => { if (r.invalidos.length) console.error('[worker] playbooks inválidos:', r.invalidos.map((i) => `${i.archivo}: ${i.errores.join('; ')}`).join(' | ')); }).catch((e) => console.error('[worker] playbooks:', e.message));
  await audit(db, workerId, 'proceso.iniciado', {});
  console.log(`[worker] activo (${workerId})`);
  while (!stopping) {
    try {
      await reconcileProduction(db, workerId).catch((e) => console.error('[worker] vigilante de renders:', e.message));
      await advanceChain(db).catch((e) => console.error('[worker] cadena final:', e.message));
      let r = await tick(db, workerId);
      while (r === 'ejecutada' && !stopping) r = await tick(db, workerId);
    } catch (err: any) {
      console.error('[worker] error del ciclo:', err.message); // p. ej. Postgres caído: reintenta en el siguiente ciclo
    }
    await new Promise((res) => setTimeout(res, config.worker.pollMs));
  }
}
