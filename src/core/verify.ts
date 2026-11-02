import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { readNote } from './vault.ts';
import { runChecks } from './playbookchecks.ts';
import { loadTaskPlaybook } from './playbooks.ts';

// Verificación objetiva de cada tarea antes de darla por completada (fase B del sistema híbrido).
// Una respuesta «bonita» del modelo no es prueba de nada: aquí se comprueban hechos (archivos, tamaños, duraciones,
// informes leídos de vuelta). Si falla, la tarea no se completa: se reintenta o queda fallida con el motivo.
// Fase D: si la tarea nace de un playbook, se ejecutan además las comprobaciones declaradas en la versión exacta
// con la que se creó («playbook · nombre»); las de nivel «aviso» se registran pero no bloquean.

export type Check = { nombre: string; ok: boolean; detalle?: string; nivel?: 'bloqueante' | 'aviso' };
export type Artifact = { tipo: string; ruta?: string; url?: string; bytes?: number; nota?: string };
export type Verification = { ok: boolean; comprobaciones: Check[]; artefactos: Artifact[]; verificado_en: string };

const size = (p: string) => { try { return fs.statSync(p).size; } catch { return -1; } };
const seconds = (p: string) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim()); } catch { return NaN; } };
// Frases que afirman acciones externas que un especialista no puede haber hecho (solo produce análisis)
const FAKE_ACTIONS = /(?<!\p{L})(he enviado|envié|he publicado|publiqué|he comprado|compré|he contratado|contraté|he borrado|borré|he llamado|llamé)(?!\p{L})/iu;

const file = (nombre: string, ruta: string | undefined, min = 1): Check =>
  !ruta ? { nombre, ok: false, detalle: 'sin ruta' } : size(ruta) >= min ? { nombre, ok: true, detalle: `${size(ruta)} bytes` } : { nombre, ok: false, detalle: `no existe o está vacío: ${ruta}` };

export async function verifyTask(_db: Db, task: any, result: Record<string, any>): Promise<Verification> {
  const checks: Check[] = [];
  const artifacts: Artifact[] = [];
  const r = result ?? {};
  switch (task.type) {
    case 'agente': {
      const text = String(r.deliverable ?? '');
      checks.push({ nombre: 'informe con contenido', ok: text.trim().length >= 200, detalle: `${text.trim().length} caracteres (mínimo 200)` });
      let back = '';
      try { back = r.report ? readNote(String(r.report)) : ''; } catch { back = ''; }
      checks.push({ nombre: 'informe guardado y legible', ok: !!r.report && back.includes(text.slice(0, 40)), detalle: r.report ? String(r.report) : 'sin archivo' });
      const fake = text.match(FAKE_ACTIONS);
      checks.push({ nombre: 'sin acciones externas inventadas', ok: !fake, detalle: fake ? `afirma «${fake[0]}»: un especialista solo entrega análisis` : undefined });
      if (r.report) artifacts.push({ tipo: 'informe', ruta: String(r.report), bytes: Buffer.byteLength(text) });
      break;
    }
    case 'produccion_video': {
      checks.push(file('vídeo', r.video, 100_000));
      const dur = r.video ? seconds(r.video) : NaN;
      const esperado = Number(r.duracion_s);
      checks.push({ nombre: 'duración coherente', ok: Number.isFinite(dur) && esperado > 0 && Math.abs(dur - esperado) <= Math.max(2, esperado * 0.1), detalle: `${Math.round(dur)} s (esperados ${esperado})` });
      checks.push(file('miniatura', r.miniatura, 10_000));
      checks.push(file('subtítulos', r.subtitulos, 20));
      if (task.inputs?.subir) checks.push({ nombre: 'subido a YouTube (privado)', ok: !!r.youtube?.id, detalle: r.youtube?.url ?? 'sin id de vídeo' });
      for (const [tipo, ruta] of [['video', r.video], ['miniatura', r.miniatura], ['subtitulos', r.subtitulos]] as const) if (ruta && size(ruta) > 0) artifacts.push({ tipo, ruta, bytes: size(ruta) });
      if (r.youtube?.url) artifacts.push({ tipo: 'youtube', url: r.youtube.url, nota: 'privado' });
      break;
    }
    case 'ciclo_ceo':
      checks.push({ nombre: 'resumen del ciclo', ok: typeof r.resumen === 'string' ? r.resumen.length > 20 : !!r.saltado, detalle: r.saltado ? `saltado: ${r.saltado}` : undefined });
      break;
    case 'claude_code':
      checks.push({ nombre: 'proyecto y resumen', ok: !!r.proyecto && typeof r.resumen === 'string' && r.resumen.length > 20 });
      if (r.proyecto) artifacts.push({ tipo: 'proyecto', ruta: String(r.proyecto) });
      break;
    default:   // tipos sin comprobación específica (apple_sync, auto_mejora…): basta con que el manejador haya terminado sin error
      checks.push({ nombre: 'manejador terminado sin error', ok: true, detalle: result == null ? 'sin datos de resultado' : undefined });
  }
  // Fase D: comprobaciones declaradas por el playbook (texto del informe y bloques JSON extraídos)
  if (task.playbook_id && task.type === 'agente') {
    const pb = await loadTaskPlaybook(_db, task);
    if (!pb) checks.push({ nombre: 'playbook · versión', ok: false, detalle: `no existe el playbook ${task.playbook_id} v${task.playbook_version ?? '?'}` });
    else {
      const ctx = { texto: String(r.deliverable ?? ''), params: (task.inputs?.parametros ?? {}) as Record<string, unknown>, extraido: {} as Record<string, any>, task, db: _db };
      checks.push(...await runChecks(pb.verificacion ?? [], ctx));
      if (Object.keys(ctx.extraido).length) r.extraido = ctx.extraido;   // queda en tasks.result para el encadenado (producir_video)
    }
  }
  return { ok: checks.every((c) => c.ok || c.nivel === 'aviso'), comprobaciones: checks, artefactos: artifacts, verificado_en: new Date().toISOString() };
}

export const failedChecks = (v: Verification) => v.comprobaciones.filter((c) => !c.ok && c.nivel !== 'aviso').map((c) => `${c.nombre}${c.detalle ? ` (${c.detalle})` : ''}`).join('; ');
