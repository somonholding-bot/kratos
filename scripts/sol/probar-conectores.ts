// PROJECT SOL (A04): prueba EN VIVO cada conector R01–R16 con una consulta fija y deja la evidencia en sol_conectores_pruebas.
// Uso: node scripts/sol/probar-conectores.ts            (base de datos configurada; por defecto la de producción «jarvis», porque registra evidencia)
//      JARVIS_DB=jarvis_t_conectores node scripts/sol/probar-conectores.ts
// No aplica migraciones: si falta la tabla, pide ejecutar antes «npm run migrate».
import { createPool } from '../../src/db.ts';
import { config } from '../../src/config.ts';
import { probarConectores } from '../../src/core/conectores.ts';

const db = createPool();
try {
  const t = (await db.query(`SELECT to_regclass('sol_conectores_pruebas') AS t`)).rows[0].t;
  if (!t) { console.error('Falta la tabla sol_conectores_pruebas: aplica antes las migraciones (npm run migrate)'); process.exitCode = 1; }
  else {
    const t0 = Date.now();
    const r = await probarConectores(db);
    console.log(`BD ${config.db.database} · ${r.ok}/${r.probados} conectores OK · ${Math.round((Date.now() - t0) / 1000)} s${r.fallidos.length ? ` · fallan: ${r.fallidos.join(', ')}` : ''}`);
    console.log('cód. estado  res.      ms  conector — detalle');
    for (const p of r.pruebas) console.log(`${p.codigo}  ${p.ok ? 'OK    ' : 'FALLO '} ${String(p.resultados).padStart(4)} ${String(p.ms).padStart(7)}  ${p.nombre} — ${p.detalle.replace(/\s+/g, ' ').slice(0, 260)}`);
  }
} finally { await db.end(); }
