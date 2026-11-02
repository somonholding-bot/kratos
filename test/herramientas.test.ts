// Fase C: registro central de herramientas y permisos reales por agente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { agentAllowedTools, AGENT_SAFE_TOOLS, syncToolRegistry, toolRegistry } from '../src/core/toolregistry.ts';
import { agentsRegistry } from '../src/core/registry.ts';
import { TOOLS } from '../src/core/brain.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); });

test('el registro se sincroniza desde el código y sabe quién ve cada herramienta', async () => {
  const n = await syncToolRegistry(db);
  assert.ok(n >= TOOLS.length + 2);
  const all = await toolRegistry(db);
  assert.equal(all.length, n);
  const crear = all.find((t: any) => t.name === 'crear_tarea');
  assert.ok(crear.toolsets.includes('ceo') && crear.toolsets.includes('voz'));
  assert.ok(crear.agentes.includes('marte'), 'Marte tiene crear_tarea en allowed_tools');
  assert.ok(!crear.agentes.includes('sol'));
  assert.equal(all.find((t: any) => t.name === 'publicar_video_youtube').requiere_aprobacion, true);
  assert.equal(all.find((t: any) => t.name === 'WebSearch').origen, 'web');
  assert.ok(all.every((t: any) => ['ok', 'degradada', 'con error', 'retirada'].includes(t.salud)));
});

test('un especialista solo recibe sus herramientas permitidas y seguras, nunca las de gasto o publicación', async () => {
  const sol = await agentAllowedTools(db, 'sol');
  assert.ok(sol.includes('resumen_negocios') && sol.includes('buscar_informes'));
  assert.ok(!sol.includes('crear_tarea') && !sol.includes('publicar_video_youtube') && !sol.includes('solicitar_aprobacion'));
  const marte = await agentAllowedTools(db, 'marte');
  assert.ok(marte.includes('crear_tarea'));
  for (const t of marte) assert.ok(AGENT_SAFE_TOOLS.has(t), `${t} no es segura para un especialista`);
  assert.deepEqual(await agentAllowedTools(db, 'no-existe'), []);
});

test('el registro de agentes responde con datos reales: herramientas, modelo y salud', async () => {
  const [venus] = await agentsRegistry(db, 'venus');
  assert.equal(venus.id, 'venus');
  assert.ok(Array.isArray(venus.herramientas) && venus.herramientas.includes('guardar_nota'));
  assert.ok(venus.modelo);
  assert.ok(['ok', 'con fallos'].includes(venus.salud));
  const filtered = await toolRegistry(db, { agent: 'venus' });
  assert.deepEqual(filtered.map((t: any) => t.name).filter((n: string) => n !== 'WebSearch' && n !== 'WebFetch').sort(), venus.herramientas.slice().sort());
});
