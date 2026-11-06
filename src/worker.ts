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
import { advanceCurriculum, advanceExams } from './core/curriculo.ts';
import { advanceAcd } from './core/acd.ts';
import { refreshRequisitos, exportRequisitos } from './core/requisitos.ts';
import { seedSolDef } from './core/sol-def.ts';
import { sincronizarCapacidades } from './core/automodelo.ts';
import { importarHistoria } from './core/autobiografia.ts';
import { sembrarTeorias } from './core/conciencia.ts';
import { recuperarCiclos } from './core/ciclo-cognitivo.ts';
import { sembrarPreguntas } from './core/ksie.ts';
import { sembrarLineas } from './core/misiones.ts';
import { sembrarPreguntasDP, avanzarDP } from './core/doble-perspectiva.ts';
import { avanzarMotor } from './core/motor-dinero.ts';
import { sincronizarVentas } from './core/stripe.ts';
import { pedirAsignacionMensual } from './core/presupuesto-pruebas.ts';
import { conectarDominioPendiente } from './core/paginas.ts';
import { sincronizar as sincronizarCorreo } from './core/correo-kratos.ts';
import { sincronizarRegistro } from './core/ksie-herramientas.ts';
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
  let ultimoRastreo = 0;
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
  await seedSolDef(db).catch((e) => console.error('[worker] semillas SOL:', e.message));
  await sembrarTeorias(db).catch((e) => console.error('[worker] teorías C06:', e.message));
  await sembrarPreguntas(db).catch((e) => console.error('[worker] preguntas KSIE:', e.message));
  await sembrarLineas(db).catch((e) => console.error('[worker] líneas de la Misión A:', e.message));
  await sembrarPreguntasDP(db).catch((e) => console.error('[worker] preguntas de doble perspectiva:', e.message));
  await syncPlaybooksFromFiles(db).then((r) => { if (r.invalidos.length) console.error('[worker] playbooks inválidos:', r.invalidos.map((i) => `${i.archivo}: ${i.errores.join('; ')}`).join(' | ')); }).catch((e) => console.error('[worker] playbooks:', e.message));
  await audit(db, workerId, 'proceso.iniciado', {});
  console.log(`[worker] activo (${workerId})`);
  while (!stopping) {
    try {
      await reconcileProduction(db, workerId).catch((e) => console.error('[worker] vigilante de renders:', e.message));
      await advanceChain(db).catch((e) => console.error('[worker] cadena final:', e.message));
      await advanceCurriculum(db).catch((e) => console.error('[worker] currículo de Sol:', e.message));
      await advanceExams(db).catch((e) => console.error('[worker] exámenes de Sol:', e.message));
      await advanceAcd(db).catch((e) => console.error('[worker] motor ACD:', e.message));
      await avanzarDP(db).catch((e) => console.error('[worker] doble perspectiva:', e.message));
      // Rastreador de requisitos de SOL/ACD: se recalcula con evidencia cada 10 minutos y se exporta a docs/
      if (Date.now() - ultimoRastreo > 10 * 60_000) { ultimoRastreo = Date.now(); await refreshRequisitos(db).then(() => exportRequisitos(db)).catch((e) => console.error('[worker] rastreador SOL:', e.message));
        await sincronizarRegistro(db).catch((e) => console.error('[worker] registro KSIE y automodelo C01:', e.message));
        await importarHistoria(db, 200).catch((e) => console.error('[worker] memoria C03:', e.message));
        // un ciclo dura minutos: si lleva más de 30 «en curso», el proceso que lo ejecutaba se interrumpió
        await recuperarCiclos(db, 30).catch((e) => console.error('[worker] recuperación de ciclos:', e.message));
        await avanzarMotor(db).catch((e) => console.error('[worker] motor de dinero:', e.message));   // cada 10 min; con cupo diario
        await sincronizarVentas(db).catch((e) => console.error('[worker] ventas de Stripe:', e.message));   // ingresos reales
        await pedirAsignacionMensual(db).catch((e) => console.error('[worker] presupuesto de pruebas:', e.message));   // pide la renovación mensual (un clic)
        await conectarDominioPendiente(db).catch((e) => console.error('[worker] dominio de las páginas:', e.message));   // en cuanto el DNS apunte
        await sincronizarCorreo(db).catch((e) => console.error('[worker] correo de KRATOS:', e.message));   // bandeja de streetlumos
      }
      let r = await tick(db, workerId);
      while (r === 'ejecutada' && !stopping) r = await tick(db, workerId);
    } catch (err: any) {
      console.error('[worker] error del ciclo:', err.message); // p. ej. Postgres caído: reintenta en el siguiente ciclo
    }
    await new Promise((res) => setTimeout(res, config.worker.pollMs));
  }
}
