import type { Db } from '../db.ts';
import { CEO_TOOLS, TOOLS, VOICE_TOOLS, isStrict, type ToolDef } from './brain.ts';
import { activePlugins, runPlugin } from './plugins.ts';

// Registro central de herramientas (fase C): qué existe, quién puede usarla y cómo le va.
// La fuente de verdad del código es TOOLS (brain.ts); la tabla tool_registry es su copia consultable, con uso y errores reales
// sacados de audit_log. Los especialistas reciben solo sus herramientas: allowed_tools (agent_functions) ∩ herramientas seguras.

// Herramientas que un especialista puede ejecutar: consultas y memoria; nada que gaste, publique o contacte a terceros
export const AGENT_SAFE_TOOLS = new Set(['resumen_negocios', 'buscar_conocimiento', 'buscar_notas', 'leer_nota', 'guardar_nota', 'listar_tareas', 'ver_resultado_tarea',
  'buscar_informes', 'ver_actividad', 'agentes', 'ver_skills', 'ver_playbooks', 'estado_youtube', 'estado_apple', 'consultar_bd', 'crear_tarea', 'registrar_leccion', 'ver_plan', 'biblioteca_sol', 'proyecto_sol', 'investigar_sol', 'acd', 'examen', 'grafo_sol', 'requisitos_sol', 'automodelo', 'estrategia_ksie', 'ciclo_cognitivo', 'conciencia_lab', 'prediccion', 'espacio_global', 'memoria_autobiografica', 'metacognicion']);
// Lo mínimo que todo especialista tiene para no trabajar a ciegas (solo lectura)
const AGENT_BASE_TOOLS = ['buscar_informes', 'ver_resultado_tarea', 'buscar_conocimiento', 'buscar_notas', 'leer_nota'];
// Las que piden aprobación del propietario o crean un efecto fuera de KRATOS
const NEEDS_APPROVAL = new Set(['solicitar_aprobacion', 'publicar_video_youtube', 'borrar_video_youtube', 'personalizar_canal_youtube', 'encargar_codigo', 'proponer_funcion', 'proponer_mejora']);

export async function agentAllowedTools(db: Db, agentId: string): Promise<string[]> {
  const a = (await db.query(`SELECT allowed_tools FROM agent_functions WHERE id = $1`, [agentId])).rows[0];
  if (!a) return [];
  const names = new Set([...AGENT_BASE_TOOLS, ...(a.allowed_tools ?? []).filter((t: string) => AGENT_SAFE_TOOLS.has(t))]);
  return TOOLS.filter((t) => names.has(t.name)).map((t) => t.name);
}
export async function agentTools(db: Db, agentId: string): Promise<ToolDef[]> {
  const names = new Set(await agentAllowedTools(db, agentId));
  return TOOLS.filter((t) => names.has(t.name));
}

// Copia del código a la tabla (idempotente): se llama al arrancar servidor y worker
export async function syncToolRegistry(db: Db) {
  const agents = (await db.query(`SELECT id FROM agent_functions WHERE id <> 'kratos'`)).rows.map((r) => r.id as string);
  const byAgent = new Map<string, string[]>();
  for (const id of agents) for (const n of await agentAllowedTools(db, id)) byAgent.set(n, [...(byAgent.get(n) ?? []), id]);
  const rows = TOOLS.map((t) => ({ name: t.name, origin: 'core', description: t.description.slice(0, 500),
    toolsets: ['texto', ...(VOICE_TOOLS.has(t.name) ? ['voz'] : []), ...(CEO_TOOLS.includes(t.name) ? ['ceo'] : [])],
    agents: byAgent.get(t.name) ?? [], strict: isStrict(t.name, t.input_schema), needs_approval: NEEDS_APPROVAL.has(t.name) }));
  for (const p of await activePlugins(db)) rows.push({ name: `fn_${p.slug}`, origin: 'plugin', description: String(p.description).slice(0, 500), toolsets: ['texto', 'voz'], agents: [], strict: false, needs_approval: false });
  rows.push({ name: 'WebSearch', origin: 'web', description: 'Búsqueda web de Claude', toolsets: ['texto', 'ceo'], agents, strict: false, needs_approval: false },
    { name: 'WebFetch', origin: 'web', description: 'Lectura de páginas web de Claude', toolsets: ['texto', 'ceo'], agents, strict: false, needs_approval: false });
  await db.query(`UPDATE tool_registry SET active = false WHERE name <> ALL($1)`, [rows.map((r) => r.name)]);
  for (const r of rows) await db.query(`INSERT INTO tool_registry (name, origin, description, toolsets, agents, strict, needs_approval, active, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT (name) DO UPDATE SET origin = EXCLUDED.origin, description = EXCLUDED.description, toolsets = EXCLUDED.toolsets,
    agents = EXCLUDED.agents, strict = EXCLUDED.strict, needs_approval = EXCLUDED.needs_approval, active = true, synced_at = now()`,
    [r.name, r.origin, r.description, r.toolsets, r.agents, r.strict, r.needs_approval]);
  return rows.length;
}

// Consulta del registro con uso real (7 días), último uso y último error, filtrable por agente o nombre
export async function toolRegistry(db: Db, f: { agent?: string; name?: string; onlyActive?: boolean } = {}) {
  const rows = (await db.query(`SELECT r.name, r.origin AS origen, r.description AS descripcion, r.toolsets, r.agents AS agentes, r.strict AS estricta, r.needs_approval AS requiere_aprobacion, r.active AS activa,
      (SELECT max(at) FROM audit_log a WHERE a.action = 'herramienta.' || r.name) AS ultimo_uso,
      (SELECT count(*)::int FROM audit_log a WHERE a.action = 'herramienta.' || r.name AND a.at > now() - interval '7 days') AS usos_7d,
      (SELECT details->>'error' FROM audit_log a WHERE a.action = 'herramienta.error' AND a.details->>'herramienta' = r.name ORDER BY a.at DESC LIMIT 1) AS ultimo_error,
      (SELECT count(*)::int FROM audit_log a WHERE a.action = 'herramienta.error' AND a.details->>'herramienta' = r.name AND a.at > now() - interval '7 days') AS errores_7d
    FROM tool_registry r WHERE ($1::text IS NULL OR $1 = ANY(r.agents)) AND ($2::text IS NULL OR r.name = $2) AND (NOT $3 OR r.active)
    ORDER BY r.origin, r.name`, [f.agent ?? null, f.name ?? null, f.onlyActive ?? true])).rows;
  return rows.map((r: any) => ({ ...r, salud: !r.activa ? 'retirada' : r.errores_7d > 0 && r.errores_7d >= r.usos_7d ? 'con error' : r.errores_7d > 0 ? 'degradada' : 'ok' }));
}

// Herramientas de un especialista listas para el servidor MCP (incluye las funciones aprobadas solo si el agente las tiene en allowed_tools)
export async function toolsForAgentServer(db: Db, agentId: string): Promise<ToolDef[]> {
  const base = await agentTools(db, agentId);
  const allowed = new Set(((await db.query(`SELECT allowed_tools FROM agent_functions WHERE id = $1`, [agentId])).rows[0]?.allowed_tools ?? []) as string[]);
  const plugins = (await activePlugins(db)).filter((p: any) => allowed.has(`fn_${p.slug}`)).map((p: any) => ({ name: `fn_${p.slug}`, description: `${p.description} Úsala cuando: ${p.when_to_use}`.slice(0, 1000),
    input_schema: p.input_schema, run: (d: Db, i: any) => runPlugin(d, p.slug, i) }));
  return [...base, ...plugins];
}
