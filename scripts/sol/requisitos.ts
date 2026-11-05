// PROJECT SOL / ACD: siembra la definición, recalcula los requisitos desde la evidencia, exporta el rastreador e imprime el informe.
// Uso: node scripts/sol/requisitos.ts [--dir=<carpeta>]
//   Con la base de producción («jarvis») escribe docs/SOL-REQUISITOS.md y docs/sol-requisitos.json. Con cualquier otra base
//   (pruebas) escribe en .jarvis/requisitos-<base>/ para no mezclar datos de prueba con el rastreador real, salvo que se pase --dir.
// No aplica migraciones: si falta el esquema (041_sol_acd.sql), avisa y termina.
import path from 'node:path';
import { DATA_DIR, config } from '../../src/config.ts';
import { createPool } from '../../src/db.ts';
import { seedSolDef } from '../../src/core/sol-def.ts';
import { exportRequisitos, informeSol, refreshRequisitos } from '../../src/core/requisitos.ts';

const base = config.db.database;
const arg = process.argv.slice(2).find((a) => a.startsWith('--dir='))?.slice(6);
const dir = arg ?? (base === 'jarvis' ? 'docs' : path.join(DATA_DIR, `requisitos-${base}`));
const db = createPool();
try {
  const esquema = (await db.query(`SELECT to_regclass('public.sol_requisitos') IS NOT NULL AND to_regclass('public.acd_hipotesis') IS NOT NULL AS ok`)).rows[0].ok;
  if (!esquema) throw new Error(`La base «${base}» no tiene el esquema de PROJECT SOL (041_sol_acd.sql): ejecuta antes npm run migrate`);
  const s = await seedSolDef(db);
  const r = await refreshRequisitos(db, { actor: 'kratos (requisitos)' });
  const ex = await exportRequisitos(db, dir);
  console.log(`[requisitos] base ${base} · ${s.requisitos} requisitos, ${s.unidades} unidades · ${r.cambios.length} cambio(s) de estado`);
  console.log(`[requisitos] ${Object.entries(r.por_estado).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  for (const c of r.cambios) console.log(`  ${c.id}: ${c.de ?? '—'} → ${c.a}`);
  console.log(`[requisitos] exportado: ${ex.md} y ${ex.json}\n`);
  console.log(await informeSol(db));
} catch (e: any) {
  console.error(`[requisitos] ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
