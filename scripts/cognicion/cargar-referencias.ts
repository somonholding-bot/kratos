// Expansión cognitiva, TAREA 01: carga referencias.json y repositorios.json en el registro buscable (cog_referencias, cog_repositorios).
// Cada referencia con URL se registra también en la biblioteca de Sol (sol_fuentes), donde el código abre la URL antes de darla por verificada.
// Uso: node scripts/cognicion/cargar-referencias.ts
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../../src/db.ts';
import { migrate } from '../../src/migrate.ts';
import { ROOT } from '../../src/config.ts';
import { addSource } from '../../src/core/omega.ts';

const D = path.join(ROOT, 'docs/kratos-cognitive-expansion');
const refs: any[] = JSON.parse(fs.readFileSync(path.join(D, 'referencias.json'), 'utf8'));
const repos: any[] = JSON.parse(fs.readFileSync(path.join(D, 'repositorios.json'), 'utf8'));
const db = createPool(); await migrate(db, () => {});
let fuentes = 0, abiertas = 0;
for (const r of refs) {
  let fuenteId: number | null = null, abierta = false;
  if (r.doi_url && /^https?:\/\//.test(r.doi_url)) {
    try {
      const f: any = await addSource(db, { url: r.doi_url, titulo: String(r.bibliografia).slice(0, 300), tipo: /arxiv|github|blog/i.test(r.doi_url) ? 'web' : 'articulo', temas: ['cognicion', String(r.grupo).toLowerCase()], acceso: r.acceso, notas: `Expansión cognitiva ${r.codigo}` }, 'expansion-cognitiva');
      fuenteId = f.id; abierta = !!f.verificada; fuentes++; if (abierta) abiertas++;
    } catch (e: any) { console.error(r.codigo, 'no se registró en la biblioteca:', e.message); }
  }
  await db.query(`INSERT INTO cog_referencias (codigo, grupo, bibliografia, doi_url, verificada, acceso, hipotesis, metodologia, evidencia, limitaciones, aplicacion, justificacion, fuente_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (codigo) DO UPDATE SET grupo=EXCLUDED.grupo, bibliografia=EXCLUDED.bibliografia, doi_url=EXCLUDED.doi_url, verificada=EXCLUDED.verificada, acceso=EXCLUDED.acceso, hipotesis=EXCLUDED.hipotesis,
        metodologia=EXCLUDED.metodologia, evidencia=EXCLUDED.evidencia, limitaciones=EXCLUDED.limitaciones, aplicacion=EXCLUDED.aplicacion, justificacion=EXCLUDED.justificacion, fuente_id=EXCLUDED.fuente_id`,
    [r.codigo, r.grupo, r.bibliografia, r.doi_url ?? null, !!r.verificada && abierta, r.acceso, r.hipotesis, r.metodologia, r.evidencia, r.limitaciones, r.aplicacion, r.justificacion, fuenteId]);
}
for (const p of repos) {
  await db.query(`INSERT INTO cog_repositorios (nombre, url, licencia, version, plataforma, dependencias, clasificacion, motivo, capacidad_que_resuelve, memoria_disco, riesgos, instalacion, prueba_minima)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (nombre) DO UPDATE SET url=EXCLUDED.url, licencia=EXCLUDED.licencia, version=EXCLUDED.version, plataforma=EXCLUDED.plataforma, dependencias=EXCLUDED.dependencias, clasificacion=EXCLUDED.clasificacion,
        motivo=EXCLUDED.motivo, capacidad_que_resuelve=EXCLUDED.capacidad_que_resuelve, memoria_disco=EXCLUDED.memoria_disco, riesgos=EXCLUDED.riesgos, instalacion=EXCLUDED.instalacion, prueba_minima=EXCLUDED.prueba_minima, verificado_en=now()`,
    [p.nombre, p.url, p.licencia ?? null, p.version ?? null, p.plataforma ?? null, p.dependencias ?? null, p.clasificacion, p.motivo, p.capacidad_que_resuelve ?? null, p.memoria_disco ?? null, p.riesgos ?? null, p.instalacion ?? null, p.prueba_minima ?? null]);
}
const v = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE verificada)::int AS v FROM cog_referencias`)).rows[0];
const c = (await db.query(`SELECT clasificacion, count(*)::int AS n FROM cog_repositorios GROUP BY 1 ORDER BY 1`)).rows;
console.log(JSON.stringify({ referencias: v.n, verificadas: v.v, en_biblioteca: fuentes, urls_abiertas_por_el_codigo: abiertas, repositorios: c }));
await db.end();
