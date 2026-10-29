import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { readNote, VAULT, writeNote } from './vault.ts';
import { apiKey, aiStatus } from './brain.ts';
import { subStatus } from './subscription.ts';
import { appleCredentials } from './apple.ts';
import { naturalVoiceAvailable } from '../voice.ts';
import { ROOT } from '../config.ts';

// Registro central de KRATOS: informes de las tareas, agentes y herramientas.
// Así KRATOS consulta datos reales en vez de suponer.

// ---------- Informes ----------

// Guarda el informe de una tarea como nota en la bóveda (Tareas/) y comprueba que se puede leer.
// Si no se puede guardar o leer, la tarea NO se da por completada.
export function saveReport(task: { id: number; title: string; owner_function: string }, deliverable: string): string {
  const text = String(deliverable ?? '').trim();
  if (text.length < 20) throw new Error('El agente no produjo un informe utilizable');
  const rel = writeNote('Tareas', `Informe tarea ${task.id} · ${task.owner_function}`, text, { tarea: String(task.id), agente: task.owner_function, titulo: task.title });
  const back = readNote(rel);
  if (!back.includes(text.slice(0, 40))) throw new Error('El informe se guardó pero no se pudo leer de vuelta');
  return rel;
}

export async function taskResult(db: Db, id: number) {
  const t = (await db.query(`SELECT t.id, t.title, t.objective, t.owner_function AS agente, t.status, t.created_at, t.updated_at, t.last_error,
      t.result->>'deliverable' AS informe, t.result->>'report' AS archivo, t.result->>'model' AS motor
    FROM tasks t WHERE t.id = $1`, [id])).rows[0];
  if (!t) return { error: `No existe la tarea ${id}` };
  if (t.status !== 'completada') return { ...t, informe: null, nota: t.status === 'fallida' ? `Falló: ${t.last_error}` : `Aún no está terminada (estado: ${t.status})` };
  if (!t.informe) return { ...t, error: 'La tarea figura completada pero no tiene informe guardado. Se puede reintentar.' };
  return { ...t, informe: t.informe.slice(0, 12_000), recortado: t.informe.length > 12_000 };
}

// Busca entre los informes (título, objetivo y contenido), opcionalmente de un agente
export async function searchReports(db: Db, query: string, agent?: string) {
  const q = (query ?? '').trim();
  const rows = (await db.query(`SELECT id, owner_function AS agente, title, status, updated_at,
      left(result->>'deliverable', 300) AS extracto
    FROM tasks WHERE type IN ('agente','claude_code') AND ($2::text IS NULL OR owner_function = $2)
      AND ($1 = '' OR to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(objective,'') || ' ' || coalesce(result->>'deliverable',''))
           @@ plainto_tsquery('spanish', $1) OR title ILIKE '%' || $1 || '%')
    ORDER BY updated_at DESC LIMIT 10`, [q, agent || null])).rows;
  return { informes: rows, total: rows.length };
}

// ---------- Agentes ----------

export async function agentsRegistry(db: Db, id?: string) {
  const agents = (await db.query(`SELECT f.id, f.name, f.purpose, f.deliverables, f.prohibited, f.escalation,
      (SELECT count(*)::int FROM tasks t WHERE t.owner_function = f.id AND t.status IN ('pendiente','en_ejecucion','esperando_ia','esperando_permiso')) AS activas,
      (SELECT count(*)::int FROM tasks t WHERE t.owner_function = f.id AND t.status = 'completada') AS completadas,
      (SELECT count(*)::int FROM tasks t WHERE t.owner_function = f.id AND t.status = 'fallida' AND t.updated_at > now() - interval '7 days') AS fallos_7d,
      (SELECT json_agg(x) FROM (SELECT t.id, t.title, t.status, t.updated_at FROM tasks t WHERE t.owner_function = f.id ORDER BY t.updated_at DESC LIMIT 5) x) AS recientes
    FROM agent_functions f WHERE ($1::text IS NULL OR f.id = $1) ORDER BY f.id`, [id ?? null])).rows;
  const skillsDir = path.join(ROOT, 'skills');
  for (const a of agents) {
    try { a.skills = fs.readdirSync(path.join(skillsDir, a.id)).filter((n) => fs.existsSync(path.join(skillsDir, a.id, n, 'SKILL.md'))); } catch { a.skills = []; }
    a.herramientas = a.id === 'kratos' ? 'todas las de KRATOS' : 'búsqueda y lectura web (solo lectura); sin archivos, programas ni contacto con terceros';
  }
  return agents;
}

// Línea compacta para el contexto de cada conversación (no carga la base de datos entera)
export async function agentsContext(db: Db): Promise<string> {
  const rows = (await db.query(`SELECT f.id, f.name, f.purpose,
      (SELECT count(*)::int FROM tasks t WHERE t.owner_function = f.id AND t.status IN ('pendiente','en_ejecucion')) AS activas
    FROM agent_functions f WHERE f.id <> 'kratos' ORDER BY f.id`)).rows;
  const recent = (await db.query(`SELECT id, owner_function, title, status FROM tasks WHERE type = 'agente' ORDER BY updated_at DESC LIMIT 6`)).rows;
  return `\n\nTus agentes: ${rows.map((r) => `${r.name} (${r.id}): ${String(r.purpose).slice(0, 90)}${r.activas ? ` · ${r.activas} en curso` : ''}`).join(' | ')}.` +
    `\nTareas recientes de agentes: ${recent.map((t) => `#${t.id} ${t.owner_function} «${String(t.title).slice(0, 60)}» ${t.status}`).join('; ') || 'ninguna'}.` +
    `\nPara ver lo que entregó un agente usa ver_resultado_tarea (por id) o buscar_informes; nunca digas que no existe sin consultarlo.`;
}

// ---------- Herramientas (inventario real, comprobado) ----------

const up = async (url: string) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.status < 500; } catch { return false; } };

export async function systemInventory(db: Db) {
  const ai = await aiStatus(db);
  const sub = await subStatus(db);
  const ext = (await db.query(`SELECT extname FROM pg_extension`)).rows.map((r) => r.extname);
  const plugins = (await db.query(`SELECT slug FROM plugins WHERE status = 'activa'`)).rows.map((r) => r.slug);
  const conn = (await db.query(`SELECT service, status FROM connections WHERE status = 'conectado'`)).rows.map((r) => r.service);
  const claudeBin = [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude'].some((p) => fs.existsSync(p));
  const has = (cmd: string) => ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')].some((d) => fs.existsSync(path.join(d, cmd)));
  const tools: { nombre: string; estado: 'OPERATIVA' | 'CONFIGURADA' | 'INSTALADA' | 'NO INSTALADA' | 'CON ERROR'; detalle: string }[] = [
    { nombre: 'Claude API (conversación y CEO)', estado: ai.keyPresent ? (ai.active ? 'OPERATIVA' : 'CON ERROR') : 'NO INSTALADA', detalle: ai.keyPresent ? `${ai.active ? 'activa' : 'sin presupuesto o detenida'} · disponible ${(ai.availableCents / 100).toFixed(2)} USD` : 'sin clave' },
    { nombre: 'Suscripción de Claude (agentes, claude -p)', estado: !claudeBin ? 'NO INSTALADA' : sub?.status === 'sin_sesion' ? 'CON ERROR' : sub?.status === 'rejected' ? 'CON ERROR' : sub ? 'OPERATIVA' : 'CONFIGURADA', detalle: sub ? `estado ${sub.status}${sub.resetsAt ? `, reinicio ${sub.resetsAt}` : ''}` : 'sin usar aún' },
    { nombre: 'Búsqueda y lectura web (Claude)', estado: ai.active || (sub && sub.status !== 'sin_sesion') ? 'OPERATIVA' : 'CONFIGURADA', detalle: 'web_search y web_fetch en conversación y agentes' },
    { nombre: 'Reconocimiento de voz (whisper.cpp + Silero VAD)', estado: (await up('http://127.0.0.1:7432/')) ? 'OPERATIVA' : 'CON ERROR', detalle: 'servicio local 127.0.0.1:7432' },
    { nombre: 'Voz natural (Kokoro / Piper)', estado: (await up('http://127.0.0.1:7431/')) ? 'OPERATIVA' : naturalVoiceAvailable() ? 'INSTALADA' : 'NO INSTALADA', detalle: 'servicio local 127.0.0.1:7431' },
    { nombre: 'PostgreSQL (memoria, tareas, informes)', estado: 'OPERATIVA', detalle: 'base de datos local' },
    { nombre: 'pgvector (memoria semántica)', estado: ext.includes('vector') ? 'INSTALADA' : 'NO INSTALADA', detalle: ext.includes('vector') ? 'extensión activa; aún no se usa (falta modelo de embeddings)' : '' },
    { nombre: 'Bóveda Obsidian (notas e informes)', estado: fs.existsSync(VAULT) ? 'OPERATIVA' : 'CON ERROR', detalle: VAULT },
    { nombre: 'App Store Connect', estado: appleCredentials() ? 'OPERATIVA' : 'NO INSTALADA', detalle: appleCredentials() ? 'solo lectura' : 'falta la clave de Apple' },
    { nombre: 'Funciones aprobadas (fn_*)', estado: plugins.length ? 'OPERATIVA' : 'CONFIGURADA', detalle: plugins.join(', ') || 'ninguna activa' },
    { nombre: 'Conexiones activas', estado: 'OPERATIVA', detalle: conn.join(', ') || 'ninguna' },
    { nombre: 'n8n (automatizaciones)', estado: has('n8n') ? 'INSTALADA' : 'NO INSTALADA', detalle: 'no se usa todavía' },
    { nombre: 'LangGraph / CrewAI', estado: 'NO INSTALADA', detalle: 'la coordinación la hace la cola de tareas de KRATOS en PostgreSQL' },
    { nombre: 'LiveKit / Pipecat (voz en tiempo real)', estado: 'NO INSTALADA', detalle: 'evaluado; pendiente de decisión' },
    { nombre: 'Langfuse', estado: 'NO INSTALADA', detalle: 'se usa la bitácora propia (fallas y rendimiento)' },
    { nombre: 'OpenAI API', estado: 'NO INSTALADA', detalle: 'no configurada' },
  ];
  return { herramientas: tools, comprobado: new Date().toISOString() };
}
