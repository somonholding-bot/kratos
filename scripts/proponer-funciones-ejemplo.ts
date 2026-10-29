// Propone (no activa) las funciones de ejemplo de plugins/: quedan pendientes de aprobación en el panel.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { proposePlugin } from '../src/core/plugins.ts';

const EX = [
  { file: 'clima.js', name: 'Clima', description: 'Clima actual y previsión de hoy de una ciudad', whenToUse: '«¿qué tiempo hace?», «¿va a llover hoy en…?»',
    inputSchema: { properties: { ciudad: { type: 'string', description: 'Ciudad, p. ej. New York' } }, required: ['ciudad'] } },
  { file: 'tiempo_de_viaje.js', name: 'Tiempo de viaje', description: 'Distancia y tiempo en coche entre dos lugares (sin tráfico)', whenToUse: '«¿cuánto tardo de Nueva York a New Jersey?»',
    inputSchema: { properties: { origen: { type: 'string' }, destino: { type: 'string' } }, required: ['origen', 'destino'] } },
];
const db = createPool();
for (const e of EX) {
  const exists = (await db.query(`SELECT 1 FROM plugins WHERE slug = $1 AND status IN ('propuesta','activa')`, [e.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_')])).rows[0];
  if (exists) { console.log(`Ya existe: ${e.name}`); continue; }
  console.log(e.name, await proposePlugin(db, { ...e, code: fs.readFileSync(path.join(ROOT, 'plugins', e.file), 'utf8') }, 'kratos (ejemplo)'));
}
await db.end();
