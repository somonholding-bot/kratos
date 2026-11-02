// Servidor MCP de KRATOS: ofrece sus herramientas a Claude Code (`claude -p`) para que la conversación y el CEO
// trabajen con la suscripción del propietario en vez de la API. Transporte stdio (JSON-RPC, una línea por mensaje).
// Variables: KRATOS_TOOLSET = voz | texto | ceo | agente:<id> (especialista: solo sus herramientas permitidas) · KRATOS_LAST_USER (último mensaje del propietario) ·
// KRATOS_EFFECTS_FILE (lo que la app debe hacer al terminar, p. ej. poner música).
import fs from 'node:fs';
import readline from 'node:readline';
import { createPool } from './db.ts';
import { CEO_TOOLS, TOOLS, VOICE_TOOLS, type ToolCtx, type ToolDef } from './core/brain.ts';
import { activePlugins, runPlugin } from './core/plugins.ts';
import { audit } from './core/state.ts';
import { toolsForAgentServer } from './core/toolregistry.ts';

const db = createPool();
const set = process.env.KRATOS_TOOLSET ?? 'texto';
const ctx: ToolCtx = { lastUser: process.env.KRATOS_LAST_USER ?? '', effects: {} };
const effectsFile = process.env.KRATOS_EFFECTS_FILE;

const agentId = set.startsWith('agente:') ? set.slice(7) : null;
const actor = agentId ? `agente:${agentId}` : set === 'ceo' ? 'kratos (ciclo CEO)' : 'kratos (IA)';
async function tools(): Promise<ToolDef[]> {
  if (agentId) return toolsForAgentServer(db, agentId);   // fase C: allowed_tools del agente, aplicadas de verdad
  const base = TOOLS.filter((t) => set === 'ceo' ? CEO_TOOLS.includes(t.name) : set === 'voz' ? VOICE_TOOLS.has(t.name) : true);
  if (set === 'ceo') return base;
  const plugins = (await activePlugins(db)).map((p: any) => ({ name: `fn_${p.slug}`, description: `${p.description} Úsala cuando: ${p.when_to_use}`.slice(0, 1000),
    input_schema: p.input_schema, run: (d: any, i: any) => runPlugin(d, p.slug, i) }));
  return [...base, ...plugins];
}

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id: unknown, result: unknown) => send({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

let pending = 0, closing = false;
const done = () => { if (closing && pending === 0) db.end().finally(() => process.exit(0)); };
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  pending++;
  try { await handle(line); } finally { pending--; done(); }
});
async function handle(line: string) {
  let req: any; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kratos', version: '1.0.0' } });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: (await tools()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    if (method === 'tools/call') {
      const tool = (await tools()).find((t) => t.name === params?.name);
      if (!tool) return reply(id, { content: [{ type: 'text', text: 'Herramienta desconocida' }], isError: true });
      try {
        const out = await tool.run(db, params?.arguments ?? {}, ctx);
        await audit(db, actor, `herramienta.${tool.name}`, { input: params?.arguments ?? {}, via: 'suscripción' });
        if (effectsFile && ctx.effects && Object.keys(ctx.effects).length) fs.writeFileSync(effectsFile, JSON.stringify(ctx.effects));
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out ?? null).slice(0, 30_000) }] });
      } catch (e: any) {
        await audit(db, actor, 'herramienta.error', { herramienta: tool.name, error: String(e?.message ?? e).slice(0, 300) }).catch(() => {});
        return reply(id, { content: [{ type: 'text', text: `Error: ${e?.message ?? e}` }], isError: true });
      }
    }
    if (id !== undefined) fail(id, -32601, `Método no soportado: ${method}`);   // las notificaciones (sin id) se ignoran
  } catch (e: any) { if (id !== undefined) fail(id, -32603, String(e?.message ?? e)); }
}
process.stdin.on('end', () => { closing = true; done(); });
