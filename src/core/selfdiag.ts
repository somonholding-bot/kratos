import type { Db } from '../db.ts';
import { diagnose } from './selfimprove.ts';

// Diagnóstico propio con el motivo de cada mejora (solo lectura).
// selfimprove.ts está protegido y guarda las reversiones como «fallida» con result.revertida = true;
// aquí se distinguen («revertida») y se muestra el error real de las que sí fallaron.

export function failureReason(error: string) {
  if (/Las pruebas fallaron/.test(error)) return 'pruebas no pasaron';
  if (/No se pudo aplicar sobre la rama principal/.test(error)) return 'no se pudo aplicar';
  if (/partes protegidas|borrar archivos/.test(error)) return 'tocó partes protegidas o borró archivos';
  if (/No se hizo ningún cambio/.test(error)) return 'no hizo ningún cambio';
  return 'error general';
}

export function describeJob(j: { id: number; status: string; mejora: string; finished_at: any; result: string | null }) {
  let info: any = {}; try { info = JSON.parse(j.result ?? '{}'); } catch { info = { error: j.result ?? '' }; }
  const base = { id: j.id, mejora: j.mejora, finished_at: j.finished_at };
  if (j.status === 'fallida' && info.revertida) return { ...base, status: 'revertida', motivo: 'revertida a propósito con aprobación del propietario' };
  if (j.status === 'fallida') {
    const error = String(info.error ?? '');
    return { ...base, status: 'fallida', motivo: failureReason(error), error: error.slice(0, 300) || 'sin detalle registrado' };
  }
  return { ...base, status: j.status };
}

export async function diagnoseSelf(db: Db) {
  const d = await diagnose(db);
  const jobs = (await db.query(`SELECT id, status, left(instructions, 120) AS mejora, finished_at, result FROM code_jobs WHERE project = '__kratos__' ORDER BY id DESC LIMIT 5`)).rows;
  return { ...d, mejoras: jobs.map(describeJob) };
}
