import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { withTx, type Db } from '../db.ts';
import { audit } from './state.ts';
import { cancelTask, createTask } from './tasks.ts';
import { requestApproval } from './approvals.ts';
import { skillsFor } from './skills.ts';
import { CHECK_TYPES, NUMERIC_KEYS, describeChecks, hoy, jsonBlock, markers, norm, substitute, validNumExpr, type PlaybookCheck } from './playbookchecks.ts';

// Playbooks (fase D del sistema híbrido): procedimientos reutilizables, versionados y verificables en código.
// Ciclo: ENTREVISTA (missingInputs: KRATOS pregunta solo lo que falta) → CREAR (createPlaybook / archivo semilla) →
// VALIDAR (validateShape + validatePlaybook contra agentes, skills y registro de herramientas) → EJECUTAR (instantiatePlaybook:
// una tarea «agente» con el procedimiento en el brief) → PROBAR (verify.ts corre «verificacion») → MEJORAR (recordPlaybookOutcome,
// proposeVersion, activateVersion, revertPlaybook; nunca se reescribe un playbook de producción por un solo fallo).
// Regla: el archivo playbooks/<agente>/<id>.json es la semilla; la base de datos es la verdad. Este módulo nunca escribe en el repo.
// No importa brain.ts ni toolregistry.ts (ciclos ESM): consulta tool_registry por SQL.

export const AGENTES = ['sol', 'luna', 'mercurio', 'venus', 'marte', 'jupiter', 'saturno'];
const ROOT_KEYS = new Set(['id', 'nombre', 'version', 'descripcion', 'objetivo', 'agentes', 'skill', 'palabras_clave', 'entradas', 'herramientas', 'pasos', 'salidas',
  'ubicacion_artefactos', 'criterios_exito', 'verificacion', 'recuperacion', 'reintentos', 'aprobaciones', 'coste', 'programacion', 'tras_completar', 'idioma_entregable']);
const REQUIRED = ['id', 'nombre', 'version', 'objetivo', 'agentes', 'entradas', 'herramientas', 'pasos', 'salidas', 'criterios_exito', 'verificacion', 'recuperacion', 'reintentos'];
const INPUT_KEYS = new Set(['tipo', 'descripcion', 'pregunta', 'requerida', 'defecto', 'min', 'max', 'max_caracteres', 'opciones']);
const INPUT_TYPES = ['texto', 'numero', 'booleano', 'fecha', 'opcion'];
const APPROVAL_KINDS = ['asignacion_presupuesto', 'accion_externa', 'nuevo_acceso', 'publicacion', 'otro'];
const TERMINAL = ['completada', 'fallida', 'cancelada'];

export type Playbook = Record<string, any>;
export type Validation = { ok: boolean; errores: string[]; avisos: string[] };

export function parsePlaybook(input: unknown): Playbook {
  if (input && typeof input === 'object') return input as Playbook;
  if (typeof input === 'string') { try { const o = JSON.parse(input); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (e: any) { throw new Error(`JSON no válido: ${e.message}`); } }
  throw new Error('El playbook debe ser un objeto JSON');
}

// ---------- VALIDAR: forma (sin base de datos) ----------
export function validateShape(pb: any): { ok: boolean; errores: string[] } {
  const e: string[] = [];
  if (!pb || typeof pb !== 'object' || Array.isArray(pb)) return { ok: false, errores: ['playbook: debe ser un objeto'] };
  for (const k of Object.keys(pb)) if (!ROOT_KEYS.has(k)) e.push(`${k}: clave desconocida`);
  for (const k of REQUIRED) if (pb[k] === undefined) e.push(`${k}: obligatorio`);
  if (pb.id !== undefined && !(typeof pb.id === 'string' && /^[a-z0-9][a-z0-9-]{2,60}$/.test(pb.id))) e.push('id: minúsculas, números y guiones (3–61 caracteres)');
  if (pb.nombre !== undefined && !(typeof pb.nombre === 'string' && pb.nombre.trim().length >= 3)) e.push('nombre: texto de al menos 3 caracteres');
  if (pb.version !== undefined && !(Number.isInteger(pb.version) && pb.version >= 1)) e.push('version: entero ≥ 1');
  if (pb.objetivo !== undefined && !(typeof pb.objetivo === 'string' && pb.objetivo.trim().length >= 10)) e.push('objetivo: texto de al menos 10 caracteres');
  if (pb.descripcion !== undefined && typeof pb.descripcion !== 'string') e.push('descripcion: texto');
  const agente = pb.agentes?.responsable;
  if (pb.agentes !== undefined) {
    if (!AGENTES.includes(agente)) e.push(`agentes.responsable: debe ser uno de ${AGENTES.join(', ')} (nunca kratos)`);
    if (pb.agentes.apoyo !== undefined && !(Array.isArray(pb.agentes.apoyo) && pb.agentes.apoyo.every((a: any) => AGENTES.includes(a)))) e.push('agentes.apoyo: lista de agentes');
  }
  if (pb.skill !== undefined && typeof pb.skill !== 'string') e.push('skill: nombre de una skill del agente');
  if (pb.palabras_clave !== undefined && !(Array.isArray(pb.palabras_clave) && pb.palabras_clave.every((k: any) => typeof k === 'string'))) e.push('palabras_clave: lista de textos');
  // entradas
  const inputs: Record<string, any> = pb.entradas && typeof pb.entradas === 'object' && !Array.isArray(pb.entradas) ? pb.entradas : {};
  if (pb.entradas !== undefined && (typeof pb.entradas !== 'object' || Array.isArray(pb.entradas))) e.push('entradas: objeto {clave: definición}');
  const numeric = new Set<string>();
  for (const [k, d] of Object.entries(inputs)) {
    if (!/^[a-z][a-z0-9_]*$/.test(k)) e.push(`entradas.${k}: clave en minúsculas (letras, números, _)`);
    if (!d || typeof d !== 'object') { e.push(`entradas.${k}: definición inválida`); continue; }
    for (const kk of Object.keys(d)) if (!INPUT_KEYS.has(kk)) e.push(`entradas.${k}.${kk}: clave desconocida`);
    if (!INPUT_TYPES.includes(d.tipo)) e.push(`entradas.${k}.tipo: uno de ${INPUT_TYPES.join(', ')}`);
    if (typeof d.descripcion !== 'string' || !d.descripcion) e.push(`entradas.${k}.descripcion: obligatoria`);
    if (typeof d.requerida !== 'boolean') e.push(`entradas.${k}.requerida: true o false`);
    if (d.tipo === 'opcion' && !(Array.isArray(d.opciones) && d.opciones.length)) e.push(`entradas.${k}.opciones: lista no vacía`);
    if (d.tipo === 'numero') numeric.add(k);
    if (d.requerida && d.defecto !== undefined) e.push(`entradas.${k}: una entrada requerida no lleva defecto`);
  }
  const allowedMarkers = new Set([...Object.keys(inputs), 'hoy']);
  const checkMarkers = (text: unknown, ruta: string) => { for (const m of markers(String(text ?? ''))) if (!allowedMarkers.has(m)) e.push(`${ruta}: marcador {{${m}}} no es una entrada`); };
  checkMarkers(pb.objetivo, 'objetivo');
  // herramientas
  const tools: string[] = Array.isArray(pb.herramientas) ? pb.herramientas : [];
  if (pb.herramientas !== undefined && !(Array.isArray(pb.herramientas) && pb.herramientas.every((t: any) => typeof t === 'string'))) e.push('herramientas: lista de nombres');
  // pasos
  if (pb.pasos !== undefined) {
    if (!Array.isArray(pb.pasos) || !pb.pasos.length) e.push('pasos: lista no vacía');
    else pb.pasos.forEach((p: any, i: number) => {
      if (!p || typeof p !== 'object') { e.push(`pasos[${i}]: objeto {n, titulo, instruccion}`); return; }
      if (p.n !== i + 1) e.push(`pasos[${i}].n: debe ser ${i + 1} (orden consecutivo)`);
      if (typeof p.titulo !== 'string' || !p.titulo.trim()) e.push(`pasos[${i}].titulo: obligatorio`);
      if (typeof p.instruccion !== 'string' || p.instruccion.trim().length < 10) e.push(`pasos[${i}].instruccion: texto de al menos 10 caracteres`);
      if (p.herramienta !== undefined && !tools.includes(p.herramienta)) e.push(`pasos[${i}].herramienta: «${p.herramienta}» no está en herramientas`);
      checkMarkers(p.instruccion, `pasos[${i}].instruccion`); checkMarkers(p.titulo, `pasos[${i}].titulo`);
    });
  }
  // salidas
  if (pb.salidas !== undefined) {
    if (!Array.isArray(pb.salidas) || !pb.salidas.length) e.push('salidas: lista no vacía');
    else pb.salidas.forEach((s: any, i: number) => {
      if (!s || typeof s !== 'object') { e.push(`salidas[${i}]: objeto`); return; }
      if (typeof s.nombre !== 'string' || !s.nombre) e.push(`salidas[${i}].nombre: obligatorio`);
      if (!['informe', 'bloque_json', 'archivo'].includes(s.tipo)) e.push(`salidas[${i}].tipo: informe, bloque_json o archivo`);
      if (typeof s.descripcion !== 'string') e.push(`salidas[${i}].descripcion: obligatoria`);
      if (typeof s.obligatoria !== 'boolean') e.push(`salidas[${i}].obligatoria: true o false`);
      checkMarkers(s.descripcion, `salidas[${i}].descripcion`);
    });
  }
  if (pb.ubicacion_artefactos !== undefined && !(pb.ubicacion_artefactos && typeof pb.ubicacion_artefactos.boveda === 'string')) e.push('ubicacion_artefactos.boveda: carpeta de la bóveda (p. ej. Tareas)');
  if (pb.criterios_exito !== undefined && !(Array.isArray(pb.criterios_exito) && pb.criterios_exito.length && pb.criterios_exito.every((c: any) => typeof c === 'string'))) e.push('criterios_exito: lista de textos no vacía');
  // verificación
  let bloqueantes = 0;
  if (pb.verificacion !== undefined) {
    if (!Array.isArray(pb.verificacion)) e.push('verificacion: lista de comprobaciones');
    else pb.verificacion.forEach((c: any, i: number) => {
      const r = `verificacion[${i}]`;
      if (!c || typeof c !== 'object') { e.push(`${r}: objeto {nombre, tipo, …}`); return; }
      if (typeof c.nombre !== 'string' || !c.nombre) e.push(`${r}.nombre: obligatorio`);
      const keys = CHECK_TYPES[c.tipo];
      if (!keys) { e.push(`${r}.tipo: tipo desconocido «${c.tipo}»`); return; }
      for (const k of Object.keys(c)) if (!['nombre', 'tipo', 'nivel'].includes(k) && !keys.includes(k)) e.push(`${r}.${k}: clave desconocida para ${c.tipo}`);
      if (c.nivel !== undefined && !['bloqueante', 'aviso'].includes(c.nivel)) e.push(`${r}.nivel: bloqueante o aviso`);
      const need = (k: string) => { if (c[k] === undefined) e.push(`${r}.${k}: obligatorio para ${c.tipo}`); };
      const arr = (k: string) => { if (!(Array.isArray(c[k]) && c[k].length && c[k].every((x: any) => typeof x === 'string'))) e.push(`${r}.${k}: lista de textos no vacía`); };
      switch (c.tipo) {
        case 'longitud_minima': case 'longitud_maxima': need('caracteres'); break;
        case 'secciones': arr('titulos'); break;
        case 'tabla_filas': case 'numero_de_items': case 'fuentes_citadas': case 'lista_minima': need('minimo'); if (c.tipo === 'lista_minima') need('campo'); break;
        case 'sin_frases': arr('frases'); break;
        case 'entradas_reflejadas': arr('entradas'); if (Array.isArray(c.entradas)) for (const k of c.entradas) if (!inputs[k]) e.push(`${r}.entradas: «${k}» no es una entrada`); break;
        case 'bloque_json': need('bloque'); if (c.campos !== undefined) arr('campos'); break;
        case 'campo_longitud': need('campo'); if (c.minimo === undefined && c.maximo === undefined) e.push(`${r}: hace falta minimo o maximo`); break;
        case 'palabras': if (c.minimo === undefined && c.maximo === undefined) e.push(`${r}: hace falta minimo o maximo`); break;
        case 'ritmo': need('campo'); need('duracion'); if (c.ppm_min === undefined && c.ppm_max === undefined) e.push(`${r}: hace falta ppm_min o ppm_max`); break;
        case 'idioma': if (!['en', 'es'].includes(c.idioma)) e.push(`${r}.idioma: en o es`); break;
        case 'herramienta_usada': need('herramienta'); if (c.herramienta && !tools.includes(c.herramienta)) e.push(`${r}.herramienta: «${c.herramienta}» no está en herramientas`); break;
        case 'archivo_existe': if (c.campo === undefined && c.ruta === undefined) e.push(`${r}: hace falta campo o ruta`); break;
      }
      for (const k of keys) if (NUMERIC_KEYS.has(k) && c[k] !== undefined) { const err = validNumExpr(c[k], numeric); if (err) e.push(`${r}.${k}: ${err}`); }
      const esAviso = c.nivel === 'aviso' || (c.tipo === 'idioma' && c.nivel === undefined);
      if (!esAviso) bloqueantes++;
    });
    if (Array.isArray(pb.verificacion) && !bloqueantes) e.push('verificacion: hace falta al menos una comprobación bloqueante (las de idioma son avisos)');
  }
  if (pb.recuperacion !== undefined) {
    if (!['reintentar', 'revisar', 'fallar'].includes(pb.recuperacion?.si_falla_verificacion)) e.push('recuperacion.si_falla_verificacion: reintentar, revisar o fallar');
    if (!['revisar', 'fallar'].includes(pb.recuperacion?.si_falta_herramienta)) e.push('recuperacion.si_falta_herramienta: revisar o fallar');
  }
  if (pb.reintentos !== undefined && !(Number.isInteger(pb.reintentos?.max) && pb.reintentos.max >= 0 && pb.reintentos.max <= 5)) e.push('reintentos.max: entero de 0 a 5');
  if (pb.aprobaciones !== undefined) {
    if (!Array.isArray(pb.aprobaciones)) e.push('aprobaciones: lista');
    else pb.aprobaciones.forEach((a: any, i: number) => {
      if (!['antes', 'despues'].includes(a?.cuando)) e.push(`aprobaciones[${i}].cuando: antes o despues`);
      if (!APPROVAL_KINDS.includes(a?.tipo)) e.push(`aprobaciones[${i}].tipo: uno de ${APPROVAL_KINDS.join(', ')}`);
      if (typeof a?.descripcion !== 'string' || !a.descripcion) e.push(`aprobaciones[${i}].descripcion: obligatoria`);
    });
  }
  if (pb.coste !== undefined) {
    if (typeof pb.coste !== 'object') e.push('coste: objeto');
    else { for (const k of ['duracion_estimada_min', 'usd_estimado']) if (pb.coste[k] !== undefined && !(typeof pb.coste[k] === 'number' && pb.coste[k] >= 0)) e.push(`coste.${k}: número ≥ 0`); if (pb.coste.nota !== undefined && typeof pb.coste.nota !== 'string') e.push('coste.nota: texto'); }
  }
  if (pb.programacion !== undefined && !(Number.isInteger(pb.programacion?.recurrencia_minutos) && pb.programacion.recurrencia_minutos >= 60)) e.push('programacion.recurrencia_minutos: entero ≥ 60');
  if (pb.tras_completar !== undefined) {
    const t = pb.tras_completar;
    if (!['producir_video', 'instruccion_ceo'].includes(t?.accion)) e.push('tras_completar.accion: producir_video o instruccion_ceo');
    if (t?.accion === 'instruccion_ceo' && (typeof t.instruccion !== 'string' || !t.instruccion)) e.push('tras_completar.instruccion: obligatoria');
    if (t?.accion === 'producir_video' && !(Array.isArray(pb.verificacion) && pb.verificacion.some((c: any) => c?.tipo === 'bloque_json' && c.bloque === 'encargo'))) e.push('tras_completar: producir_video exige una comprobación bloque_json con bloque «encargo»');
    checkMarkers(t?.instruccion, 'tras_completar.instruccion');
  }
  if (pb.idioma_entregable !== undefined && !['es', 'en', 'mixto'].includes(pb.idioma_entregable)) e.push('idioma_entregable: es, en o mixto');
  return { ok: !e.length, errores: e };
}

// ---------- VALIDAR: contra la base de datos (agente, skill, herramientas del registro y permisos del agente) ----------
async function checkTools(db: Db, tools: string[], agente: string): Promise<{ errores: string[]; registroVacio: boolean }> {
  const total = (await db.query(`SELECT count(*)::int AS n FROM tool_registry`)).rows[0].n;
  if (!total) return { errores: [], registroVacio: true };
  const rows = (await db.query(`SELECT name, agents, active FROM tool_registry WHERE name = ANY($1)`, [tools])).rows;
  const errores: string[] = [];
  for (const t of tools) {
    const r = rows.find((x: any) => x.name === t);
    if (!r || !r.active) errores.push(`herramientas: «${t}» no existe en el registro`);
    else if (!(r.agents ?? []).includes(agente)) errores.push(`herramientas: «${t}» no está permitida para ${agente} (allowed_tools ∩ seguras)`);
  }
  return { errores, registroVacio: false };
}

export async function validatePlaybook(db: Db, pb: any): Promise<Validation> {
  const shape = validateShape(pb);
  const errores = [...shape.errores], avisos: string[] = [];
  if (!shape.ok) return { ok: false, errores, avisos };
  const agente = pb.agentes.responsable;
  if (!(await db.query(`SELECT 1 FROM agent_functions WHERE id = $1`, [agente])).rows.length) errores.push(`agentes.responsable: el agente «${agente}» no existe`);
  if (pb.skill && !skillsFor(agente).some((s) => s.name === pb.skill)) errores.push(`skill: «${pb.skill}» no existe para ${agente} (skills/${agente}/)`);
  const t = await checkTools(db, pb.herramientas, agente);
  errores.push(...t.errores);
  if (t.registroVacio) avisos.push('registro de herramientas vacío: las herramientas se comprobarán al ejecutar');
  return { ok: !errores.length, errores, avisos };
}

// ---------- almacenamiento ----------
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
// El hash ignora «version»: así una reversión tiene el mismo hash que la versión restaurada
export const hashOf = (pb: Playbook) => crypto.createHash('sha256').update(canonical({ ...pb, version: undefined })).digest('hex');

export async function createPlaybook(db: Db, pb: Playbook, opts: { origen?: string; autor?: string; archivo?: string | null; estado?: 'prueba' | 'produccion' } = {}) {
  const v = validateShape(pb);
  if (!v.ok) throw new Error(v.errores.join('; '));
  if ((await db.query(`SELECT 1 FROM playbooks WHERE id = $1`, [pb.id])).rows.length) throw new Error(`Ya existe el playbook ${pb.id}`);
  const contenido = { ...pb, version: 1 };
  return withTx(db, async (tx) => {
    const row = (await tx.query(`INSERT INTO playbooks (id, nombre, agente, estado, version_activa, archivo, creado_por) VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING *`,
      [pb.id, pb.nombre, pb.agentes.responsable, opts.estado ?? 'prueba', opts.archivo ?? null, opts.autor ?? 'sistema'])).rows[0];
    await tx.query(`INSERT INTO playbook_versions (playbook_id, version, contenido, hash, estado, origen, causa, autor, activated_at) VALUES ($1,1,$2,$3,'activa',$4,'creacion',$5,now())`,
      [pb.id, JSON.stringify(contenido), hashOf(contenido), opts.origen ?? 'ceo', opts.autor ?? 'sistema']);
    await audit(tx, opts.autor ?? 'sistema', 'playbook.creado', { id: pb.id, agente: pb.agentes.responsable, origen: opts.origen ?? 'ceo' });
    return row;
  });
}

export async function getPlaybook(db: Db, id: string, version?: number | null) {
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id])).rows[0];
  if (!row) return null;
  const v = (await db.query(`SELECT * FROM playbook_versions WHERE playbook_id = $1 AND version = $2`, [id, version ?? row.version_activa])).rows[0];
  if (!v) return null;
  return { ...row, version: v, contenido: v.contenido as Playbook };
}
// La versión exacta con la que nació la tarea (verify.ts y el brief la usan; no la activa)
export async function loadTaskPlaybook(db: Db, task: any): Promise<Playbook | null> {
  if (!task?.playbook_id) return null;
  const pb = await getPlaybook(db, task.playbook_id, task.playbook_version ?? null);
  return pb?.contenido ?? null;
}
export async function listPlaybooks(db: Db) {
  return (await db.query(`SELECT p.id, p.nombre, p.agente, p.estado, p.version_activa, p.exitos, p.fallos, p.fallos_seguidos, p.coste_medido, p.archivo, p.updated_at,
      v.contenido->'palabras_clave' AS palabras_clave, v.contenido->'entradas' AS entradas, v.contenido->>'objetivo' AS objetivo, v.contenido->'coste' AS coste_estimado,
      v.contenido->'programacion' AS programacion
    FROM playbooks p JOIN playbook_versions v ON v.playbook_id = p.id AND v.version = p.version_activa WHERE p.estado <> 'retirado' ORDER BY p.id`)).rows;
}
export async function playbookVersions(db: Db, id: string) {
  return (await db.query(`SELECT version, estado, origen, causa, motivo, revierte_a, autor, created_at, activated_at, hash FROM playbook_versions WHERE playbook_id = $1 ORDER BY version`, [id])).rows;
}

// Archivo = semilla, BD = verdad. Editar el archivo y reiniciar crea y activa una versión «archivo» (autoría del propietario).
export async function syncPlaybooksFromFiles(db: Db, dir = path.join(ROOT, 'playbooks')) {
  const out = { importados: [] as string[], actualizados: [] as string[], sin_cambios: [] as string[], invalidos: [] as { archivo: string; errores: string[] }[] };
  if (!fs.existsSync(dir)) return out;
  for (const folder of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const f of fs.readdirSync(path.join(dir, folder)).filter((n) => n.endsWith('.json')).sort()) {
      const file = path.join(dir, folder, f);
      const rel = file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file;
      try {
        const pb = parsePlaybook(fs.readFileSync(file, 'utf8'));
        const errores: string[] = [];
        if (pb.agentes?.responsable !== folder) errores.push(`carpeta «${folder}» ≠ agentes.responsable «${pb.agentes?.responsable}»`);
        if (pb.id && `${pb.id}.json` !== f) errores.push(`archivo «${f}» ≠ id «${pb.id}»`);
        errores.push(...(await validatePlaybook(db, pb)).errores);
        if (errores.length) throw new Error(errores.join('; '));
        const hash = hashOf(pb);
        const row = (await db.query(`SELECT p.id, p.archivo, v.hash FROM playbooks p JOIN playbook_versions v ON v.playbook_id = p.id AND v.version = p.version_activa WHERE p.id = $1`, [pb.id])).rows[0];
        if (!row) { await createPlaybook(db, pb, { origen: 'archivo', autor: 'propietario (archivo)', archivo: rel }); out.importados.push(pb.id); }
        else if (row.hash === hash) { if (row.archivo !== rel) await db.query(`UPDATE playbooks SET archivo = $2 WHERE id = $1`, [pb.id, rel]); out.sin_cambios.push(pb.id); }
        else { await proposeVersion(db, pb.id, pb, { causa: 'archivo', origen: 'archivo', autor: 'propietario (archivo)', motivo: `archivo ${rel} modificado` }); await db.query(`UPDATE playbooks SET archivo = $2 WHERE id = $1`, [pb.id, rel]); out.actualizados.push(pb.id); }
      } catch (e: any) {
        const errores = String(e?.message ?? e).split('; ');
        out.invalidos.push({ archivo: rel, errores });
        await audit(db, 'sistema', 'playbook.invalido', { archivo: rel, errores: errores.slice(0, 10) }).catch(() => {});
      }
    }
  }
  if (out.importados.length || out.actualizados.length || out.invalidos.length) await audit(db, 'sistema', 'playbooks.sincronizados', { importados: out.importados, actualizados: out.actualizados, invalidos: out.invalidos.map((i) => i.archivo) }).catch(() => {});
  return out;
}

// ---------- ENTREVISTA: qué falta, qué no vale y las entradas normalizadas ----------
export type Missing = { faltan: { clave: string; pregunta: string; tipo: string; descripcion: string }[]; invalidos: { clave: string; motivo: string }[]; normalizados: Record<string, unknown> };
export function missingInputs(pb: Playbook, params: Record<string, unknown> = {}): Missing {
  const faltan: Missing['faltan'] = [], invalidos: Missing['invalidos'] = [], normalizados: Record<string, unknown> = {};
  for (const [k, d] of Object.entries((pb.entradas ?? {}) as Record<string, any>)) {
    let v: unknown = params[k];
    if (typeof v === 'string' && !v.trim()) v = undefined;
    if (v === undefined || v === null) {
      if (d.defecto !== undefined) v = d.tipo === 'fecha' && (d.defecto === 'hoy' || d.defecto === '{{hoy}}') ? hoy() : d.defecto;
      else { if (d.requerida) faltan.push({ clave: k, pregunta: d.pregunta ?? `¿${d.descripcion}?`, tipo: d.tipo, descripcion: d.descripcion }); else if (d.tipo === 'texto') normalizados[k] = ''; continue; }
    }
    switch (d.tipo) {
      case 'numero': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n)) { invalidos.push({ clave: k, motivo: `«${v}» no es un número` }); break; }
        if (d.min !== undefined && n < d.min) { invalidos.push({ clave: k, motivo: `mínimo ${d.min}` }); break; }
        if (d.max !== undefined && n > d.max) { invalidos.push({ clave: k, motivo: `máximo ${d.max}` }); break; }
        normalizados[k] = n; break;
      }
      case 'booleano': {
        const s = norm(String(v));
        if (v === true || ['true', '1', 'si', 'sí', 'yes'].includes(s)) normalizados[k] = true;
        else if (v === false || ['false', '0', 'no'].includes(s)) normalizados[k] = false;
        else invalidos.push({ clave: k, motivo: `«${v}» no es true/false` });
        break;
      }
      case 'fecha': {
        const s = String(v).trim();
        const d2 = new Date(`${s}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(+d2) || d2.toISOString().slice(0, 10) !== s) invalidos.push({ clave: k, motivo: `«${s}» no es una fecha AAAA-MM-DD válida` });
        else normalizados[k] = s;
        break;
      }
      case 'opcion': {
        const s = String(v).trim();
        if (!(d.opciones ?? []).includes(s)) invalidos.push({ clave: k, motivo: `«${s}» no está entre ${d.opciones.join(', ')}` });
        else normalizados[k] = s;
        break;
      }
      default: {
        const s = String(v).trim();
        if (d.max_caracteres && s.length > d.max_caracteres) { invalidos.push({ clave: k, motivo: `máximo ${d.max_caracteres} caracteres` }); break; }
        normalizados[k] = s;
      }
    }
  }
  return { faltan, invalidos, normalizados };
}

// ---------- el procedimiento en el brief del especialista (≤ 3.000 caracteres) ----------
// Objetivo, resultado esperado y verificación ya van en la cabecera de la tarea (task.objective, expected_result, verification):
// aquí van las entradas, las herramientas, los pasos, los criterios y, si es un reintento, el motivo del fallo anterior.
export function playbookBrief(pb: Playbook, task: any, max = 3000): string {
  const params = (task.inputs?.parametros ?? {}) as Record<string, unknown>;
  const lang = { es: 'español', en: 'inglés', mixto: 'mixto (informe en español; títulos, guion y textos publicables en inglés)' }[pb.idioma_entregable as string] ?? 'español';
  const head = [
    `PROCEDIMIENTO «${pb.nombre}» (playbook ${pb.id} v${task.playbook_version ?? pb.version})`,
    `Entradas: ${Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') || 'ninguna'}`,
    `Herramientas que debes usar: ${(pb.herramientas ?? []).join(', ') || 'ninguna'}`,
  ];
  if ((task.attempts ?? 0) > 1 && task.last_error) head.push(`INTENTO ${task.attempts}: el anterior no pasó la verificación por: ${String(task.last_error).slice(0, 400)}. Corrige exactamente eso sin perder lo demás.`);
  head.push('Pasos (en orden; cada sección pedida va con encabezado ## con ese título exacto):');
  const tail = [
    `Salidas: ${(pb.salidas ?? []).map((s: any) => `${s.nombre} (${s.tipo}${s.obligatoria ? ', obligatoria' : ''})`).join(', ')}`,
    `Criterios de éxito: ${(pb.criterios_exito ?? []).map((c: string) => substitute(c, params)).join('; ')}`,
    'Verificación automática en código: exactamente el «Criterio de verificación» de la cabecera; si falla, la tarea NO se completa.',
    `Idioma del entregable: ${lang}.`,
  ];
  const fixed = [...head, ...tail].join('\n').length + 1;
  const pasos: string[] = (pb.pasos ?? []).map((p: any) => ` ${p.n}. ${substitute(p.titulo, params)} — ${substitute(p.instruccion, params)}${p.herramienta ? ` [herramienta: ${p.herramienta}]` : ''}`);
  const budget = Math.max(200, max - fixed);
  const total = pasos.reduce((n, p) => n + p.length + 1, 0);
  const steps = total <= budget ? pasos : pasos.map((p) => { const cap = Math.max(60, Math.floor((p.length / total) * budget) - 2); return p.length > cap ? p.slice(0, cap) + '…' : p; });
  return [...head, ...steps, ...tail].join('\n');
}

// ---------- EJECUTAR: crear la tarea del agente a partir del playbook ----------
export type Instantiate = { id: string; negocioId: number; parametros?: Record<string, unknown>; version?: number | null; soloValidar?: boolean; creadoPor?: string; productoId?: number | null };
export async function instantiatePlaybook(db: Db, o: Instantiate): Promise<Record<string, any>> {
  const pb = await getPlaybook(db, o.id, o.version ?? null);
  if (!pb) return { ok: false, error: `No existe el playbook ${o.id}${o.version ? ` v${o.version}` : ''}` };
  if (pb.estado === 'retirado') return { ok: false, error: `El playbook ${o.id} está retirado` };
  if (pb.version.estado === 'rechazada') return { ok: false, error: `La versión ${pb.version.version} está rechazada` };
  const c = pb.contenido;
  const m = missingInputs(c, o.parametros ?? {});
  if (m.faltan.length || m.invalidos.length) return { ok: false, playbook: o.id, faltan: m.faltan, invalidos: m.invalidos, nota: m.faltan.length ? 'Pregunta al propietario solo estas entradas y vuelve a llamar' : 'Corrige las entradas no válidas' };
  const params = m.normalizados;
  if (!(await db.query(`SELECT 1 FROM businesses WHERE id = $1`, [o.negocioId])).rows.length) return { ok: false, error: `No existe el negocio ${o.negocioId}` };
  // las herramientas se vuelven a comprobar al instanciar (el registro puede haber cambiado o estar vacío al importar)
  const tools = await checkTools(db, c.herramientas ?? [], c.agentes.responsable);
  if (tools.errores.length && c.recuperacion?.si_falta_herramienta === 'fallar') return { ok: false, error: `Falta una herramienta: ${tools.errores.join('; ')}` };
  const version = pb.version.version as number;
  const checks = describeChecks(c.verificacion ?? [], params);
  const first = Object.entries((c.entradas ?? {}) as Record<string, any>).find(([k, d]) => d.tipo === 'texto' && d.requerida && params[k]);
  const title = `${c.nombre}${first ? `: ${String(params[first[0]]).slice(0, 80)}` : ''}`.slice(0, 150);
  const base: any = { businessId: o.negocioId, productId: o.productoId ?? null, ownerFunction: c.agentes.responsable, type: 'agente', title, objective: substitute(c.objetivo, params),
    priority: 2, inputs: { playbook: c.id, version, parametros: params }, expectedResult: (c.salidas ?? []).map((s: any) => `${s.nombre}: ${substitute(s.descripcion, params)}`).join(' | ').slice(0, 2000),
    verification: checks.slice(0, 4000), maxAttempts: (c.reintentos?.max ?? 0) + 1, recurrenceMinutes: c.programacion?.recurrencia_minutos ?? null,
    createdBy: o.creadoPor ?? 'kratos (IA)', playbookId: c.id, playbookVersion: version };
  if (o.soloValidar) {
    const preview = `${playbookBrief(c, { inputs: base.inputs, playbook_version: version, attempts: 0 })}\nVerificación: ${checks}`;
    return { ok: true, playbook: c.id, version, vista_previa: preview, tarea_prevista: { titulo: title, agente: base.ownerFunction, reintentos: c.reintentos?.max ?? 0, aprobacion_previa: (c.aprobaciones ?? []).some((a: any) => a.cuando === 'antes') }, avisos: tools.errores };
  }
  // idempotencia: mismos parámetros, mismo negocio y misma versión en el mismo día → la misma tarea mientras siga abierta
  const keyBase = `playbook:${c.id}:v${version}:${o.negocioId}:${crypto.createHash('sha1').update(canonical(params)).digest('hex').slice(0, 16)}:${hoy()}`;
  const prev = (await db.query(`SELECT id, status FROM tasks WHERE idempotency_key = $1 OR idempotency_key LIKE $2 ORDER BY id DESC`, [keyBase, `${keyBase}:%`])).rows;
  const open = prev.find((t: any) => !TERMINAL.includes(t.status));
  if (open) return { ok: true, creada: false, tarea: open.id, estado: open.status, playbook: c.id, version, nota: 'Ya existe una tarea abierta con estos mismos parámetros' };
  const key = prev.length ? `${keyBase}:${prev.length + 1}` : keyBase;
  const antes = (c.aprobaciones ?? []).find((a: any) => a.cuando === 'antes');
  const { task, created } = await createTask(db, { ...base, idempotencyKey: key, status: antes ? 'esperando_permiso' : 'pendiente' });
  if (!created) return { ok: true, creada: false, tarea: task.id, estado: task.status, playbook: c.id, version };
  let aprobacion: number | undefined;
  if (antes) {
    const a = await requestApproval(db, { businessId: o.negocioId, kind: APPROVAL_KINDS.includes(antes.tipo) ? antes.tipo : 'otro', description: `Playbook «${c.nombre}» (${c.id}): ${substitute(antes.descripcion, params)} — tarea #${task.id}`,
      scope: { tipo: 'playbook_ejecucion', tarea_id: task.id, playbook_id: c.id }, taskId: task.id, requestedBy: base.createdBy, validDays: 7 });
    aprobacion = a.id;
  }
  if (tools.errores.length) await db.query(`UPDATE tasks SET status = 'requiere_revision', last_error = $2, updated_at = now() WHERE id = $1`, [task.id, `Falta una herramienta: ${tools.errores.join('; ')}`.slice(0, 500)]);
  await audit(db, base.createdBy, 'playbook.instanciado', { playbook: c.id, version, tarea: task.id, parametros: params }, o.negocioId);
  const estado = tools.errores.length ? 'requiere_revision' : task.status;
  return { ok: true, creada: true, tarea: task.id, estado, playbook: c.id, version, agente: base.ownerFunction, titulo: title, aprobacion, ...(tools.errores.length ? { avisos: tools.errores } : {}),
    nota: antes ? 'Espera la aprobación del propietario en el panel' : 'El trabajador la toma en segundos; mira el resultado con ver_resultado_tarea' };
}

// Aprobación previa decidida en el panel (gancho llamado desde plugins.onApprovalDecided): la tarea arranca o se cancela
export async function onPlaybookApproval(db: Db, approval: any, approved: boolean) {
  if (approval?.scope?.tipo !== 'playbook_ejecucion') return;
  const id = Number(approval.scope.tarea_id);
  if (!approved) { await cancelTask(db, id, 'propietario'); return; }
  const r = await db.query(`UPDATE tasks SET status = 'pendiente', run_at = now(), updated_at = now() WHERE id = $1 AND status = 'esperando_permiso' RETURNING id`, [id]);
  if (r.rowCount) { await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [approval.id]); await audit(db, 'propietario', 'playbook.aprobado', { tarea: id, playbook: approval.scope.playbook_id }); }
}
// Aprobaciones caducadas → las tareas en espera se cancelan (lo llama la revisión de salud del trabajador)
export async function cancelExpiredPlaybookTasks(db: Db) {
  const rows = (await db.query(`SELECT t.id FROM tasks t JOIN approvals a ON a.task_id = t.id WHERE t.status = 'esperando_permiso' AND a.status = 'caducada'`)).rows;
  for (const r of rows) await cancelTask(db, r.id, 'sistema (aprobación caducada)');
  return rows.length;
}

// ---------- PROBAR / MEJORAR: resultado de cada ejecución ----------
export async function recordPlaybookOutcome(db: Db, task: any, ok: boolean, motivo = '', usd = 0) {
  if (!task?.playbook_id) return null;
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [task.playbook_id])).rows[0];
  if (!row) return null;
  const cm = row.coste_medido ?? {};
  const n = Number(cm.muestras ?? 0);
  const dur = task.started_at ? Math.max(0, (Date.now() - new Date(task.started_at).getTime()) / 60_000) : null;
  const coste = { muestras: n + 1, duracion_media_min: dur === null ? cm.duracion_media_min ?? null : Math.round(((Number(cm.duracion_media_min ?? 0) * n) + dur) / (n + 1) * 100) / 100,
    usd_medio: Math.round(((Number(cm.usd_medio ?? 0) * n) + (Number(usd) || 0)) / (n + 1) * 10000) / 10000, ultima: new Date().toISOString() };
  const upd = (await db.query(`UPDATE playbooks SET exitos = exitos + $2, fallos = fallos + $3, fallos_seguidos = CASE WHEN $4 THEN 0 ELSE fallos_seguidos + 1 END, coste_medido = $5, updated_at = now()
    WHERE id = $1 RETURNING fallos_seguidos, exitos, estado`, [row.id, ok ? 1 : 0, ok ? 0 : 1, ok, JSON.stringify(coste)])).rows[0];
  await audit(db, 'worker', ok ? 'playbook.exito' : 'playbook.fallo', { playbook: row.id, version: task.playbook_version, tarea: task.id, motivo: motivo.slice(0, 300) }, task.business_id);
  if (!ok && upd.fallos_seguidos >= 2) {
    await db.query(`INSERT INTO knowledge_items (business_id, kind, topic, content, source, created_by) VALUES ($1, 'observacion', $2, $3, 'worker (playbooks)', 'saturno')`,
      [task.business_id, `Playbook ${row.id} degradado`, `Playbook «${row.id}» v${task.playbook_version} degradado: ${upd.fallos_seguidos} fallos seguidos. Último motivo: ${motivo.slice(0, 400)}. No se reescribe por un fallo; con ≥ 2 seguidos se puede proponer una versión nueva (editar_playbook) o revisar las entradas.`]);
    await audit(db, 'worker', 'playbook.degradado', { playbook: row.id, fallos_seguidos: upd.fallos_seguidos, tarea: task.id }, task.business_id);
  }
  return upd;
}

// Política de recuperación cuando la verificación declarada falla (lo llama el trabajador en vez de failTask)
export async function onPlaybookVerificationFailed(db: Db, task: any, workerId: string, motivo: string) {
  const pb = await loadTaskPlaybook(db, task);
  const policy = pb?.recuperacion?.si_falla_verificacion ?? 'reintentar';
  const error = `Verificación fallida: ${motivo}`.slice(0, 500);
  let estado: string;
  if (policy === 'reintentar' && task.attempts < task.max_attempts) {
    estado = 'pendiente';
    await db.query(`UPDATE tasks SET status = 'pendiente', last_error = $3, locked_by = NULL, locked_until = NULL, run_at = now() + make_interval(mins => $4), updated_at = now()
      WHERE id = $1 AND status IN ('en_ejecucion','verificando') AND locked_by = $2`, [task.id, workerId, error, 2 ** task.attempts]);
  } else {
    estado = policy === 'revisar' ? 'requiere_revision' : 'fallida';
    await db.query(`UPDATE tasks SET status = $3, last_error = $4, locked_by = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND status IN ('en_ejecucion','verificando') AND locked_by = $2`, [task.id, workerId, estado, error]);
  }
  await audit(db, workerId, estado === 'pendiente' ? 'tarea.reintento' : estado === 'fallida' ? 'tarea.fallida' : 'tarea.requiere_revision', { id: task.id, error: motivo.slice(0, 200), intento: task.attempts, politica: policy }, task.business_id);
  await recordPlaybookOutcome(db, task, false, motivo);
  return estado;
}

// Tras completar y verificar: encadenado (un salto, idempotente), aprobaciones «despues» e instrucción al CEO
export async function afterPlaybookTask(db: Db, task: any, result: Record<string, any> = {}) {
  const pb = await loadTaskPlaybook(db, task);
  if (!pb) return { ok: false };
  const params = (task.inputs?.parametros ?? {}) as Record<string, any>;
  const out: Record<string, unknown> = { ok: true };
  const t = pb.tras_completar;
  if (t?.accion === 'producir_video') {
    const encargo = result.extraido?.encargo ?? task.result?.extraido?.encargo ?? jsonBlock(String(result.deliverable ?? task.result?.deliverable ?? ''), 'encargo');
    if (!encargo || typeof encargo !== 'object' || !encargo.titulo || !encargo.guion) { await audit(db, 'worker', 'playbook.encadenado_error', { playbook: pb.id, tarea: task.id, motivo: 'sin bloque encargo válido' }, task.business_id); out.ok = false; }
    else {
      const list = (v: unknown, sep: string, max: number) => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(sep)).map((x) => x.trim()).filter(Boolean).slice(0, max);
      const subir = !(params.subir === false || params.subir === 'false');
      const { task: next, created } = await createTask(db, { businessId: task.business_id, productId: task.product_id ?? null, ownerFunction: 'venus', type: 'produccion_video', title: `Vídeo: ${String(encargo.titulo).slice(0, 90)}`,
        objective: `Producir el vídeo del playbook ${pb.id} (tarea #${task.id}) y, si se pidió, subirlo como privado`, priority: 2, maxAttempts: 2,
        inputs: { titulo: String(encargo.titulo).slice(0, 100), guion: String(encargo.guion), imagenes: list(encargo.imagenes, '|', 30), musica: encargo.musica ? String(encargo.musica) : undefined, idioma: 'en',
          formato: encargo.formato === 'vertical' ? 'vertical' : 'horizontal', miniatura_texto: encargo.miniatura_texto ? String(encargo.miniatura_texto) : undefined, descripcion: encargo.descripcion ? String(encargo.descripcion) : undefined,
          etiquetas: list(encargo.etiquetas, ',', 30), subir, origen_tarea: task.id },
        expectedResult: 'video.mp4, subtítulos y miniatura en ~/Movies/Kratos; subido como privado si se pidió', verification: 'El archivo existe y dura lo esperado; en YouTube aparece como privado',
        idempotencyKey: `playbook:${pb.id}:tarea:${task.id}:siguiente`, createdBy: `playbook:${pb.id}`, playbookId: pb.id, playbookVersion: task.playbook_version ?? null });
      out.siguiente = next.id; out.creada = created;
      if (created) await audit(db, 'worker', 'playbook.encadenado', { playbook: pb.id, tarea: task.id, siguiente: next.id, subir }, task.business_id);
    }
  }
  if (t?.accion === 'instruccion_ceo') {
    const r = await db.query(`UPDATE tasks SET result = coalesce(result, '{}'::jsonb) || $2::jsonb WHERE id = $1 AND NOT coalesce(result ? 'siguiente_paso', false) RETURNING id`,
      [task.id, JSON.stringify({ siguiente_paso: substitute(t.instruccion, params).slice(0, 1000) })]);
    if (r.rowCount) await audit(db, 'worker', 'playbook.instruccion_ceo', { playbook: pb.id, tarea: task.id }, task.business_id);
    out.instruccion_ceo = true;
  }
  for (const a of (pb.aprobaciones ?? []).filter((x: any) => x.cuando === 'despues')) {
    const dup = (await db.query(`SELECT 1 FROM approvals WHERE task_id = $1 AND scope->>'tipo' = 'playbook_resultado'`, [task.id])).rows.length;
    if (!dup) await requestApproval(db, { businessId: task.business_id, kind: APPROVAL_KINDS.includes(a.tipo) ? a.tipo : 'otro', description: `Playbook «${pb.nombre}» (${pb.id}), tarea #${task.id} terminada: ${substitute(a.descripcion, params)}`,
      scope: { tipo: 'playbook_resultado', tarea_id: task.id, playbook_id: pb.id }, taskId: task.id, requestedBy: 'worker', validDays: 14 });
  }
  return out;
}

// ---------- versiones e historial ----------
export async function proposeVersion(db: Db, id: string, contenido: Playbook, o: { causa: 'mejora' | 'fallo' | 'archivo'; motivo?: string; autor?: string; origen?: string }) {
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error(`No existe el playbook ${id}`);
  const pb = { ...contenido, id };
  const shape = validateShape(pb);
  if (!shape.ok) throw new Error(shape.errores.join('; '));
  if (pb.agentes.responsable !== row.agente) throw new Error(`No se puede cambiar el agente responsable (${row.agente}); crea otro playbook`);
  const v = await validatePlaybook(db, pb);
  if (!v.ok) throw new Error(v.errores.join('; '));
  const active = (await db.query(`SELECT version, hash FROM playbook_versions WHERE playbook_id = $1 AND version = $2`, [id, row.version_activa])).rows[0];
  const hash = hashOf(pb);
  if (active && active.hash === hash) throw new Error(`contenido idéntico a la versión ${active.version}`);
  if (row.estado === 'produccion' && o.causa === 'fallo' && row.fallos_seguidos < 2 && !/^propietario:/i.test(o.motivo ?? ''))
    throw new Error(`Un solo fallo no justifica reescribir un playbook de producción (fallos seguidos: ${row.fallos_seguidos}); revisa la tarea o indica «propietario: motivo»`);
  const n = Number((await db.query(`SELECT max(version) AS m FROM playbook_versions WHERE playbook_id = $1`, [id])).rows[0].m) + 1;
  const directo = row.estado === 'prueba' || o.causa === 'archivo';
  const content = { ...pb, version: n };
  return withTx(db, async (tx) => {
    if (directo) await tx.query(`UPDATE playbook_versions SET estado = 'sustituida' WHERE playbook_id = $1 AND estado = 'activa'`, [id]);
    await tx.query(`INSERT INTO playbook_versions (playbook_id, version, contenido, hash, estado, origen, causa, motivo, autor, activated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, n, JSON.stringify(content), hash, directo ? 'activa' : 'borrador', o.origen ?? 'ceo', o.causa, (o.motivo ?? '').slice(0, 500), o.autor ?? 'kratos (IA)', directo ? new Date() : null]);
    if (directo) await tx.query(`UPDATE playbooks SET version_activa = $2, nombre = $3, fallos_seguidos = 0, updated_at = now() WHERE id = $1`, [id, n, pb.nombre]);
    await audit(tx, o.autor ?? 'kratos (IA)', directo ? 'playbook.version_activada' : 'playbook.version_propuesta', { playbook: id, version: n, causa: o.causa, motivo: (o.motivo ?? '').slice(0, 200) });
    return { version: n, estado: directo ? 'activa' : 'borrador', nota: directo ? 'Versión activa' : 'Borrador: pruébala con ejecutar_playbook (version=n) y actívala tras una ejecución verificada' };
  });
}

export async function promotePlaybook(db: Db, id: string, autor = 'kratos (IA)') {
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error(`No existe el playbook ${id}`);
  if (row.estado === 'produccion') return { estado: 'produccion', nota: 'ya estaba en producción' };
  if (row.exitos < 1) throw new Error('Para pasar a producción hace falta al menos una ejecución completada y verificada');
  await db.query(`UPDATE playbooks SET estado = 'produccion', updated_at = now() WHERE id = $1`, [id]);
  await audit(db, autor, 'playbook.produccion', { playbook: id, exitos: row.exitos });
  return { estado: 'produccion' };
}

export async function activateVersion(db: Db, id: string, version: number, autor = 'kratos (IA)') {
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error(`No existe el playbook ${id}`);
  const v = (await db.query(`SELECT * FROM playbook_versions WHERE playbook_id = $1 AND version = $2`, [id, version])).rows[0];
  if (!v) throw new Error(`No existe la versión ${version}`);
  if (v.estado === 'activa') return { version, estado: 'activa', nota: 'ya estaba activa' };
  if (v.estado !== 'borrador') throw new Error(`La versión ${version} está ${v.estado}; para volver a una versión anterior usa revertir`);
  const ok = (await db.query(`SELECT 1 FROM tasks WHERE playbook_id = $1 AND playbook_version = $2 AND status = 'completada' AND (verification_result->>'ok')::boolean LIMIT 1`, [id, version])).rows.length;
  if (!ok) throw new Error(`La versión ${version} no tiene ninguna ejecución verificada: ejecútala primero (ejecutar_playbook con version=${version})`);
  await withTx(db, async (tx) => {
    await tx.query(`UPDATE playbook_versions SET estado = 'sustituida' WHERE playbook_id = $1 AND estado = 'activa'`, [id]);
    await tx.query(`UPDATE playbook_versions SET estado = 'activa', activated_at = now() WHERE playbook_id = $1 AND version = $2`, [id, version]);
    await tx.query(`UPDATE playbooks SET version_activa = $2, nombre = $3, fallos_seguidos = 0, updated_at = now() WHERE id = $1`, [id, version, v.contenido.nombre]);
    await audit(tx, autor, 'playbook.version_activada', { playbook: id, version });
  });
  return { version, estado: 'activa' };
}

export async function revertPlaybook(db: Db, id: string, toVersion: number, autor = 'propietario') {
  const row = (await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error(`No existe el playbook ${id}`);
  const target = (await db.query(`SELECT * FROM playbook_versions WHERE playbook_id = $1 AND version = $2`, [id, toVersion])).rows[0];
  if (!target) throw new Error(`No existe la versión ${toVersion}`);
  if (target.estado === 'rechazada') throw new Error(`La versión ${toVersion} está rechazada: no se puede restaurar`);
  if (target.version === row.version_activa) return { version: toVersion, estado: 'activa', nota: 'ya es la versión activa' };
  const n = Number((await db.query(`SELECT max(version) AS m FROM playbook_versions WHERE playbook_id = $1`, [id])).rows[0].m) + 1;
  const content = { ...target.contenido, version: n };
  await withTx(db, async (tx) => {
    await tx.query(`UPDATE playbook_versions SET estado = 'sustituida' WHERE playbook_id = $1 AND estado = 'activa'`, [id]);
    await tx.query(`INSERT INTO playbook_versions (playbook_id, version, contenido, hash, estado, origen, causa, motivo, revierte_a, autor, activated_at) VALUES ($1,$2,$3,$4,'activa','reversion','reversion',$5,$6,$7,now())`,
      [id, n, JSON.stringify(content), target.hash, `reversión a la versión ${toVersion}`, toVersion, autor]);
    await tx.query(`UPDATE playbooks SET version_activa = $2, nombre = $3, fallos_seguidos = 0, updated_at = now() WHERE id = $1`, [id, n, content.nombre]);
    await audit(tx, autor, 'playbook.revertido', { playbook: id, version: n, revierte_a: toVersion });
  });
  return { version: n, estado: 'activa', revierte_a: toVersion };
}

export async function rejectVersion(db: Db, id: string, version: number, autor = 'kratos (IA)') {
  const r = await db.query(`UPDATE playbook_versions SET estado = 'rechazada' WHERE playbook_id = $1 AND version = $2 AND estado IN ('borrador','sustituida') RETURNING version`, [id, version]);
  if (!r.rowCount) throw new Error(`La versión ${version} no existe o está activa (no se puede rechazar la activa)`);
  await audit(db, autor, 'playbook.version_rechazada', { playbook: id, version });
  return { version, estado: 'rechazada' };
}

// ---------- SELECCIÓN: reutilizar antes que crear ----------
export function findPlaybook<T extends { id: string; nombre: string; palabras_clave?: string[] | null; agente?: string }>(list: T[], text: string): T | null {
  const t = ` ${norm(text).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best: T | null = null, bestScore = 0;
  for (const pb of list) {
    let score = 0;
    for (const k of pb.palabras_clave ?? []) { const kk = norm(k).trim(); if (kk && t.includes(` ${kk} `)) score += kk.includes(' ') ? 3 : 2; }
    for (const w of norm(pb.nombre).split(/\W+/)) if (w.length > 5 && t.includes(` ${w} `)) score += 1;
    if (score > bestScore) { best = pb; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}
// Línea para el contexto de la conversación (≤ 200 caracteres): si la petición encaja con un playbook, KRATOS lo reutiliza
export async function playbookContext(db: Db, text: string): Promise<string> {
  if (!text?.trim()) return '';
  const list = await listPlaybooks(db).catch(() => []);
  const pb = findPlaybook(list as any[], text);
  return pb ? `\n\nPlaybook aplicable: ${pb.id} (${pb.agente}). Ejecútalo con ejecutar_playbook; pregunta solo las entradas que falten.` : '';
}
// Un playbook casi igual a otro existente (mismo agente y palabras clave muy parecidas, o mismo nombre): se reutiliza, no se duplica
export function similarPlaybook<T extends { id: string; nombre: string; palabras_clave?: string[] | null; agente?: string }>(list: T[], pb: Playbook): T | null {
  const kws = new Set(((pb.palabras_clave ?? []) as string[]).map(norm));
  for (const x of list) {
    if (x.id === pb.id) continue;
    if (norm(x.nombre) === norm(pb.nombre)) return x;
    if (x.agente !== pb.agentes?.responsable || !kws.size) continue;
    const theirs = (x.palabras_clave ?? []).map(norm);
    const common = theirs.filter((k) => kws.has(k)).length;
    if (common >= Math.ceil(Math.max(kws.size, theirs.length) / 2) && common >= 3) return x;
  }
  return null;
}
