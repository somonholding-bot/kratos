// Adenda del propietario: misión A (ciencia aunque no sea rentable), B (economía) y C (traducción sin exagerar); dos tableros separados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import * as M from '../src/core/misiones.ts';
import { sembrarPreguntas } from '../src/core/ksie.ts';

let db: Db; let h: number;
const limpiar = async () => {
  await db.query(`DELETE FROM conocimiento_aplicaciones`); await db.query(`DELETE FROM ksie_oportunidades WHERE creado_por = 'agente:prueba-mision'`);
  await db.query(`DELETE FROM acd_hipotesis WHERE created_by = 'prueba-mision'`); await db.query(`DELETE FROM acd_preguntas WHERE created_by = 'prueba-mision'`);
};
before(async () => {
  db = createPool(); await migrate(db, () => {}); await sembrarPreguntas(db); await M.sembrarLineas(db); await limpiar();
  const p = (await db.query(`INSERT INTO acd_preguntas (texto, area, origen, created_by) VALUES ('¿Influye la intención humana en un generador de números aleatorios físico?', 'intencion-fisica', 'propietario', 'prueba-mision') RETURNING id`)).rows[0].id;
  h = (await db.query(`INSERT INTO acd_hipotesis (pregunta_id, operacion, titulo, enunciado, mecanismo, created_by) VALUES ($1, 'imaginar', 'Intención y ruido cuántico', 'La intención focalizada desplaza la media de un generador aleatorio físico más allá del azar.', 'Mecanismo desconocido; se prueba solo el efecto.', 'prueba-mision') RETURNING id`, [p])).rows[0].id;
});
after(async () => { await limpiar(); await db.end(); });

test('Misión A: 8 líneas, incluida la hermética; la menos estudiada entra en el foco de la curiosidad de ACD', async () => {
  assert.equal(M.LINEAS_A.length, 8); assert.ok(M.LINEAS_A.some((l) => l.area === 'hermetismo') && M.LINEAS_A.some((l) => l.area === 'intencion-fisica'));
  const l = await M.lineaMenosEstudiada(db); assert.ok(l && l.codigo !== 'A5');   // A5 ya tiene una pregunta
  const t = await M.tableroCientifico(db);
  assert.ok(t.lineas_mision_a.find((x: any) => x.codigo === 'A5').preguntas >= 1);
});

test('naturalezas distinguibles: los niveles altos los exige la evidencia, nunca la palabra de quien clasifica', async () => {
  assert.equal((await M.clasificar(db, h, 'hipotesis_comprobable', 'tiene una predicción medible', 'agente:sol', 'A5')).naturaleza, 'hipotesis_comprobable');
  await assert.rejects(M.clasificar(db, h, 'hallazgo_experimental', 'creo que funciona', 'agente:sol'), /datos OBSERVADOS/);
  await assert.rejects(M.clasificar(db, h, 'hallazgo_replicado', 'x', 'agente:sol'), /≥ 2 experimentos/);
  await assert.rejects(M.clasificar(db, h, 'descubrimiento_verificado', 'x', 'kratos'), /solo lo declara el propietario/);
  await assert.rejects(M.clasificar(db, h, 'certeza_absoluta', 'x', 'agente:sol'), /naturaleza/);
  await assert.rejects(db.query(`UPDATE acd_hipotesis SET naturaleza = 'verdad' WHERE id = $1`, [h]), /naturaleza_check/);
  assert.equal((await M.clasificar(db, h, 'ensenanza_historica', 'principio hermético de mentalismo como fuente', 'agente:sol', 'A6')).naturaleza, 'ensenanza_historica');
});

test('Misión C: traducir es opcional y nunca presenta como demostrado lo que no lo está', async () => {
  await assert.rejects(M.traducir(db, { hipotesis_id: h, sector: 'tecnologia_invenciones', descripcion: 'Dispositivo probado que mueve el azar con la mente' }, 'agente:prueba-mision'), /exagera/);
  await assert.rejects(M.traducir(db, { hipotesis_id: h, sector: 'salud_cognicion', descripcion: 'Terapia que cura la ansiedad' }, 'agente:prueba-mision'), /exagera|validación clínica/);
  const r = await M.traducir(db, { hipotesis_id: h, sector: 'software_automatizacion_ia', descripcion: 'Software abierto para que laboratorios repliquen el experimento con protocolo preregistrado', oportunidad: { nombre: 'Kit de replicación de experimentos de intención (prueba)', tipo: 'producto_digital' } }, 'agente:prueba-mision');
  assert.match(r.aviso, /NO está demostrada/); assert.ok(r.oportunidad_id);
  const o = (await db.query(`SELECT descripcion, incertidumbre FROM ksie_oportunidades WHERE id = $1`, [r.oportunidad_id])).rows[0];
  assert.match(o.descripcion, /NO está demostrada/); assert.ok(Number(o.incertidumbre) >= 0.9);
});

test('dos tableros independientes: sin campos cruzados ni puntuación combinada', async () => {
  const c = await M.tableroCientifico(db), e = await M.tableroEconomico(db);
  const claves = (o: any) => JSON.stringify(Object.keys(o));
  assert.doesNotMatch(claves(c), /usd|ingreso|beneficio|coste|caja|oportunidad/i);
  assert.doesNotMatch(claves(e), /hipotesis|experimentos_ejecutados|modelos|replicad|descubrimiento/i);
  for (const t of [c, e]) assert.doesNotMatch(JSON.stringify(t), /puntuacion_total|score|rentabilidad_global|indice_combinado/i);
  assert.ok(c.hipotesis_formuladas.total >= 1 && typeof e.beneficio_neto_verificado_30d_usd === 'number');
});
