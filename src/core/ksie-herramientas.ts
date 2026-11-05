import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { sincronizarCapacidades, nivel, confianza, registrarPrueba } from './automodelo.ts';

// KSIE TAREAS 01–02 — inteligencia de herramientas. El registro se sincroniza con las herramientas REALES (tool_registry + automodelo C01)
// y solo añade lo que falta: operaciones, autenticación, permisos, coste, latencia, privacidad y estado DISCOVERED…UNAVAILABLE.
// El enrutado elige el conjunto mínimo eficaz por operación con fiabilidad medida, coste, velocidad y privacidad; nunca una herramienta
// solo porque esté instalada. Cada selección se registra y su resultado alimenta el aprendizaje (y el automodelo si falla).

type Meta = { operaciones: string[]; coste?: string; latencia?: string; privacidad?: string; autenticacion?: { servicio: string; cuenta?: string } | null; entradas?: string; salidas?: string; limitaciones?: string; recursos?: string };
// Operaciones que una herramienta resuelve (taxonomía de KSIE). Lo no listado no se enruta: se registra pero no se elige.
export const META: Record<string, Meta> = {
  WebSearch: { operaciones: ['buscar_web', 'investigar_mercado', 'investigar_competencia', 'buscar_precios', 'buscar_literatura'], coste: 'suscripcion', privacidad: 'externo_publico', salidas: 'resultados con URL', limitaciones: 'resultados generales; requiere contrastar fuentes' },
  WebFetch: { operaciones: ['leer_web', 'investigar_competencia', 'buscar_precios'], coste: 'suscripcion', privacidad: 'externo_publico', entradas: 'URL pública', salidas: 'texto de la página' },
  investigar_sol: { operaciones: ['buscar_literatura', 'buscar_literatura_cientifica'], coste: 'gratis_externo', privacidad: 'externo_publico', salidas: 'registros con DOI y procedencia', limitaciones: 'OpenAlex y Semantic Scholar limitan sin clave (429)' },
  biblioteca_sol: { operaciones: ['leer_fuente', 'buscar_literatura_cientifica'], latencia: 'instantanea', salidas: 'fuentes ya guardadas con procedencia' },
  consultar_bd: { operaciones: ['consultar_datos_internos', 'leer_metricas_internas'], latencia: 'instantanea' },
  resumen_negocios: { operaciones: ['consultar_datos_internos', 'leer_finanzas_internas'], latencia: 'instantanea' },
  ver_plan: { operaciones: ['consultar_estrategia'], latencia: 'instantanea' },
  buscar_informes: { operaciones: ['consultar_datos_internos', 'buscar_memoria'], latencia: 'instantanea' },
  memoria_autobiografica: { operaciones: ['buscar_memoria', 'consultar_errores_previos', 'registrar_aprendizaje'], latencia: 'instantanea' },
  buscar_conocimiento: { operaciones: ['buscar_memoria'], latencia: 'instantanea' },
  buscar_notas: { operaciones: ['buscar_memoria'], latencia: 'instantanea' },
  estado_youtube: { operaciones: ['leer_metricas_youtube'], coste: 'gratis_externo', privacidad: 'externo_privado', autenticacion: { servicio: 'kratos-google', cuenta: 'refresh_token' } },
  estado_apple: { operaciones: ['leer_metricas_appstore'], coste: 'gratis_externo', privacidad: 'externo_privado', autenticacion: { servicio: 'kratos-appstore', cuenta: 'p8' } },
  ciclo_cognitivo: { operaciones: ['calcular', 'simular', 'modelo_financiero'], latencia: 'segundos', recursos: 'sandbox Python, 1 hilo', limitaciones: 'sin red; datos que se le pasen' },
  acd: { operaciones: ['calcular', 'simular', 'generar_hipotesis'], recursos: 'sandbox Python' },
  prediccion: { operaciones: ['predecir', 'registrar_prediccion'], latencia: 'instantanea' },
  metacognicion: { operaciones: ['registrar_decision', 'calibrar_confianza'], latencia: 'instantanea' },
  espacio_global: { operaciones: ['coordinar_objetivo'], latencia: 'instantanea' },
  automodelo: { operaciones: ['comprobar_capacidades'], latencia: 'instantanea' },
  crear_tarea: { operaciones: ['delegar'], latencia: 'instantanea' },
  ejecutar_playbook: { operaciones: ['delegar'], latencia: 'instantanea' },
  solicitar_aprobacion: { operaciones: ['pedir_autorizacion'], latencia: 'horas' },
  correo_enviar: { operaciones: ['contactar_personas'], privacidad: 'externo_privado', limitaciones: 'solo con orden del propietario' },
  correo_borrador: { operaciones: ['redactar_contacto'], privacidad: 'local' },
  mensaje_texto: { operaciones: ['contactar_personas'], privacidad: 'externo_privado', limitaciones: 'solo con orden del propietario' },
  encargar_a_claude_code: { operaciones: ['programar', 'crear_pagina'], coste: 'suscripcion', latencia: 'horas' },
  fn_clima: { operaciones: ['consultar_clima'], coste: 'gratis_externo', privacidad: 'externo_publico' },
  fn_tiempo_de_viaje: { operaciones: ['calcular_ruta'], coste: 'gratis_externo', privacidad: 'externo_publico' },
};
// Operaciones que se resuelven razonando con lo que ya se tiene: no necesitan ninguna herramienta
export const OPERACIONES_INTERNAS = new Set(['razonar', 'resumir', 'comparar_opciones', 'redactar', 'criticar', 'aritmetica_simple', 'clasificar']);
const COSTE: Record<string, number> = { gratis_local: 1, gratis_externo: 0.85, suscripcion: 0.75, api_pago: 0.2 };
const VELOCIDAD: Record<string, number> = { instantanea: 1, segundos: 0.85, minutos: 0.5, horas: 0.2 };
const PRIVACIDAD: Record<string, number> = { local: 1, externo_publico: 0.8, externo_privado: 0.6 };
const USABLES = ['VERIFIED', 'AVAILABLE', 'CONFIGURED', 'DEGRADED'];
const DESCUBRIBLES = [{ nombre: 'sistema:ollama', rutas: ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'], operaciones: ['modelo_local_texto'], descripcion: 'LLM local (Ollama) instalado en el equipo, sin herramienta de KRATOS que lo use' },
  { nombre: 'sistema:yt-dlp', rutas: ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp'], operaciones: ['descargar_video_publico'], descripcion: 'Descargador de vídeo instalado' },
  { nombre: 'sistema:postiz', rutas: ['/opt/homebrew/bin/postiz', '/usr/local/bin/postiz'], operaciones: ['programar_redes_sociales'], descripcion: 'CLI de Postiz para redes sociales' }];

// Comprueba que existe la credencial en el llavero SIN leer su valor (sin -w)
export function credencialPresente(servicio: string, cuenta?: string): boolean {
  if (process.env.KRATOS_SIN_LLAVERO) return false;
  try { execFileSync('/usr/bin/security', ['find-generic-password', '-s', servicio, ...(cuenta ? ['-a', cuenta] : [])], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
}

export function estadoDe(t: { active: boolean } | null, cap: any, meta: Meta | undefined, auth: boolean | null): { estado: string; motivo: string } {
  if (!t) return { estado: 'UNAVAILABLE', motivo: 'no registrada' };
  if (!t.active) return { estado: 'UNAVAILABLE', motivo: 'desactivada en el registro' };
  if (meta?.autenticacion && auth === false) return { estado: 'UNAVAILABLE', motivo: `falta la credencial ${meta.autenticacion.servicio} en el llavero` };
  const n = nivel(cap);
  if (n === 'no_existe') return { estado: 'UNAVAILABLE', motivo: 'el automodelo no la encuentra' };
  if (n === 'instalada') return { estado: 'INSTALLED', motivo: 'código presente pero sin dependencias o sin registrar' };
  if (n === 'degradada') return { estado: 'DEGRADED', motivo: `último fallo posterior al último éxito: ${cap.detalle_fallo ?? ''}`.slice(0, 200) };
  if (n === 'probada') return { estado: 'VERIFIED', motivo: 'éxito reciente sin fallos posteriores' };
  if (meta?.autenticacion && auth) return { estado: 'CONFIGURED', motivo: 'credencial presente; sin prueba reciente' };
  return { estado: 'AVAILABLE', motivo: 'registrada y activa; sin prueba reciente' };
}

export async function sincronizarRegistro(db: Db) {
  await sincronizarCapacidades(db);
  const tools = (await db.query(`SELECT t.name, t.description, t.active, t.needs_approval, c.* FROM tool_registry t LEFT JOIN cog_capacidades c ON c.capacidad = 'herramienta:' || t.name`)).rows;
  const vistos = new Set<string>();
  for (const t of tools) {
    const m = META[t.name], auth = m?.autenticacion ? credencialPresente(m.autenticacion.servicio, m.autenticacion.cuenta) : null;
    const e = estadoDe(t, t.capacidad ? t : null, m, auth);
    vistos.add(t.name);
    await db.query(`INSERT INTO ksie_herramientas (nombre, descripcion, operaciones, entradas, salidas, autenticacion, autenticacion_ok, permisos, coste, latencia, recursos, limitaciones, privacidad, estado, estado_motivo, ultimo_exito, ultimo_fallo, fiabilidad, evidencia, actualizado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       ON CONFLICT (nombre) DO UPDATE SET descripcion = EXCLUDED.descripcion, operaciones = EXCLUDED.operaciones, entradas = EXCLUDED.entradas, salidas = EXCLUDED.salidas, autenticacion = EXCLUDED.autenticacion, autenticacion_ok = EXCLUDED.autenticacion_ok,
         permisos = EXCLUDED.permisos, coste = EXCLUDED.coste, latencia = EXCLUDED.latencia, recursos = EXCLUDED.recursos, limitaciones = EXCLUDED.limitaciones, privacidad = EXCLUDED.privacidad, estado = EXCLUDED.estado, estado_motivo = EXCLUDED.estado_motivo,
         ultimo_exito = EXCLUDED.ultimo_exito, ultimo_fallo = EXCLUDED.ultimo_fallo, fiabilidad = EXCLUDED.fiabilidad, evidencia = EXCLUDED.evidencia, actualizado = now()`,
      [t.name, String(t.description ?? '').slice(0, 400), m?.operaciones ?? [], m?.entradas ?? null, m?.salidas ?? null, m?.autenticacion ? `llavero ${m.autenticacion.servicio}` : 'ninguna', auth,
        t.needs_approval ? 'aprobacion_propietario' : (m?.limitaciones ?? '').includes('orden del propietario') ? 'solo_propietario' : 'libre',
        m?.coste ?? 'gratis_local', m?.latencia ?? 'segundos', m?.recursos ?? null, m?.limitaciones ?? null, m?.privacidad ?? 'local', e.estado, e.motivo,
        t.ultima_ok ?? null, t.ultimo_fallo ?? null, t.capacidad ? confianza(t) : null, t.capacidad ? `cog_capacidades: ${t.pruebas_ok ?? 0} ok / ${t.pruebas_fallo ?? 0} fallos` : 'sin observaciones']);
  }
  for (const d of DESCUBRIBLES) {
    const r = d.rutas.find((p) => fs.existsSync(p));
    if (!r) { await db.query(`DELETE FROM ksie_herramientas WHERE nombre = $1`, [d.nombre]); continue; }
    vistos.add(d.nombre);
    await db.query(`INSERT INTO ksie_herramientas (nombre, descripcion, operaciones, estado, estado_motivo, evidencia) VALUES ($1,$2,$3,'DISCOVERED','encontrada en el equipo; ninguna herramienta de KRATOS la integra: no se usa sin evaluarla',$4)
       ON CONFLICT (nombre) DO UPDATE SET estado = 'DISCOVERED', evidencia = EXCLUDED.evidencia, actualizado = now()`, [d.nombre, d.descripcion, d.operaciones, r]);
  }
  // Lo que ya no existe deja de figurar como disponible (no se borra: queda UNAVAILABLE con el motivo)
  await db.query(`UPDATE ksie_herramientas SET estado = 'UNAVAILABLE', estado_motivo = 'ya no existe en tool_registry ni en el equipo', actualizado = now() WHERE NOT (nombre = ANY($1))`, [[...vistos]]);
  return (await db.query(`SELECT estado, count(*)::int AS n FROM ksie_herramientas GROUP BY 1 ORDER BY 1`)).rows;
}

// Historial de selecciones: tasa de éxito por herramienta y operación (aprendizaje)
async function historialHerramienta(db: Db, nombre: string, ops: string[]) {
  const r = (await db.query(`SELECT count(*) FILTER (WHERE resultado = 'exito')::int AS ok, count(*) FILTER (WHERE resultado IN ('fallo','insuficiente'))::int AS ko FROM ksie_selecciones WHERE herramienta_resultado = $1 AND operaciones && $2`, [nombre, ops])).rows[0];
  return { ok: r.ok, ko: r.ko, tasa: (r.ok + 1) / (r.ok + r.ko + 2) };
}

export type Necesidad = { descripcion: string; operaciones: string[]; privacidad?: 'local' | 'cualquiera'; presupuesto?: 'gratis' | 'suscripcion' | 'pago_autorizado'; excluir?: string[]; calidad_minima?: number };
// Enrutado: qué falta saber → qué operaciones → candidatas del registro → comparación → conjunto mínimo eficaz → plan (sin ejecutar nada)
export async function enrutar(db: Db, n: Necesidad, actor: string, replanificada_de: number | null = null) {
  const ops = [...new Set((n.operaciones ?? []).map(String))];
  const externas = ops.filter((o) => !OPERACIONES_INTERNAS.has(o));
  if (!externas.length) {
    const r = (await db.query(`INSERT INTO ksie_selecciones (actor, necesidad, operaciones, candidatas, elegidas, sin_herramientas, motivo, resultado, replanificada_de) VALUES ($1,$2,$3,'[]','{}',true,$4,'exito',$5) RETURNING id`,
      [actor, n.descripcion, ops, 'Todas las operaciones son internas (razonar, resumir, comparar…): no hace falta llamar a ninguna herramienta', replanificada_de])).rows[0];
    return { seleccion_id: r.id, sin_herramientas: true, elegidas: [], plan: [], huecos: [], motivo: 'No hace falta ninguna herramienta externa: se resuelve razonando con la información disponible.' };
  }
  const regs = (await db.query(`SELECT * FROM ksie_herramientas WHERE operaciones && $1`, [externas])).rows;
  const candidatas = [] as any[];
  for (const h of regs) {
    const cubre = h.operaciones.filter((o: string) => externas.includes(o));
    const hist = await historialHerramienta(db, h.nombre, cubre);
    const descartes: string[] = [];
    if (!USABLES.includes(h.estado)) descartes.push(`estado ${h.estado}: ${h.estado_motivo ?? ''}`);
    if ((n.excluir ?? []).includes(h.nombre)) descartes.push('excluida (falló o fue insuficiente antes en este plan)');
    if (n.privacidad === 'local' && h.privacidad !== 'local') descartes.push(`privacidad ${h.privacidad} y se pidió local`);
    if (n.presupuesto === 'gratis' && !['gratis_local', 'gratis_externo'].includes(h.coste)) descartes.push(`coste ${h.coste} y el presupuesto es gratis`);
    if (h.coste === 'api_pago' && n.presupuesto !== 'pago_autorizado') descartes.push('API de pago sin autorización');
    if (h.permisos === 'solo_propietario') descartes.push('solo con orden expresa del propietario');
    const fiab = h.fiabilidad == null ? 0.5 : Number(h.fiabilidad);
    const fiabilidad = 0.6 * fiab + 0.4 * hist.tasa - (h.estado === 'DEGRADED' ? 0.25 : 0);
    if (n.calidad_minima != null && fiabilidad < n.calidad_minima) descartes.push(`fiabilidad ${fiabilidad.toFixed(2)} < calidad mínima ${n.calidad_minima}`);
    const puntos = 0.4 * fiabilidad + 0.25 * (cubre.length / externas.length) + 0.15 * (COSTE[h.coste] ?? 0.5) + 0.1 * (VELOCIDAD[h.latencia] ?? 0.5) + 0.1 * (PRIVACIDAD[h.privacidad] ?? 0.5);
    candidatas.push({ herramienta: h.nombre, estado: h.estado, cubre, coste: h.coste, latencia: h.latencia, privacidad: h.privacidad, fiabilidad: Math.round(fiabilidad * 100) / 100, historial: { ok: hist.ok, ko: hist.ko },
      permisos: h.permisos, puntos: Math.round(puntos * 1000) / 1000, descartada: descartes.length ? descartes : null });
  }
  // Conjunto mínimo: cobertura voraz por puntos entre las no descartadas
  const validas = candidatas.filter((c) => !c.descartada).sort((a, b) => b.puntos - a.puntos || a.herramienta.localeCompare(b.herramienta));
  const pendientes = new Set(externas), elegidas: any[] = [];
  while (pendientes.size) {
    const mejor = validas.filter((c) => !elegidas.includes(c)).map((c) => ({ c, nuevas: c.cubre.filter((o: string) => pendientes.has(o)).length })).filter((x) => x.nuevas > 0)
      .sort((a, b) => b.nuevas * b.c.puntos - a.nuevas * a.c.puntos)[0];
    if (!mejor) break;
    elegidas.push(mejor.c); for (const o of mejor.c.cubre) pendientes.delete(o);
  }
  const huecos = [...pendientes].map((o) => analizarHueco(o, candidatas.filter((c) => c.cubre.includes(o))));
  const plan = elegidas.map((c, k) => ({ paso: k + 1, herramienta: c.herramienta, operaciones: c.cubre.filter((o: string) => externas.includes(o)), requiere_autorizacion: c.permisos !== 'libre', verificar: 'comprobar que la salida responde a la necesidad antes de darla por buena' }));
  const motivo = elegidas.length ? `Elegidas por fiabilidad medida, cobertura, coste, velocidad y privacidad: ${elegidas.map((c) => `${c.herramienta} (${c.puntos})`).join(', ')}${huecos.length ? `; sin cubrir: ${[...pendientes].join(', ')}` : ''}` : `Ninguna herramienta usable cubre ${[...pendientes].join(', ')}`;
  const r = (await db.query(`INSERT INTO ksie_selecciones (actor, necesidad, operaciones, candidatas, elegidas, huecos, motivo, replanificada_de) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [actor, n.descripcion, ops, JSON.stringify(candidatas), elegidas.map((c) => c.herramienta), JSON.stringify(huecos), motivo, replanificada_de])).rows[0];
  return { seleccion_id: r.id, sin_herramientas: false, elegidas: elegidas.map((c) => c.herramienta), plan, candidatas, huecos, motivo, operaciones_internas: ops.filter((o) => OPERACIONES_INTERNAS.has(o)) };
}

// 3.3 Huecos: capacidad que falta, si alguna existente sirve, alternativas y coste; nunca instala ni compra
export function analizarHueco(op: string, candidatas: any[]) {
  const noUsables = candidatas.filter((c) => c.descartada);
  return { operacion: op, existentes_no_usables: noUsables.map((c) => ({ herramienta: c.herramienta, motivo: c.descartada.join('; ') })),
    recomendacion: noUsables.length ? `Reparar o autorizar una existente antes de buscar otra (${noUsables.map((c) => c.herramienta).join(', ')})` : `No hay herramienta para «${op}»: investigar alternativas (gratuitas primero) y estimar instalación y mantenimiento antes de proponerla`,
    accion_permitida: 'recomendar al propietario; no se instala, no se crean cuentas y no se compra nada automáticamente' };
}

// Resultado de usar una selección; si no fue un éxito, el fallo rebaja la herramienta (C01) y se replanifica sin ella
export async function registrarResultado(db: Db, seleccion_id: number, herramienta: string, resultado: 'exito' | 'insuficiente' | 'fallo', detalle: string, actor: string) {
  const s = (await db.query(`SELECT * FROM ksie_selecciones WHERE id = $1`, [seleccion_id])).rows[0];
  if (!s) throw new Error(`No existe la selección ${seleccion_id}`);
  if (s.resultado !== 'pendiente') throw new Error(`La selección ${seleccion_id} ya tiene resultado (${s.resultado})`);
  if (!s.elegidas.includes(herramienta)) throw new Error(`${herramienta} no estaba en la selección ${seleccion_id}`);
  if (!String(detalle ?? '').trim()) throw new Error('El resultado necesita detalle (qué devolvió la herramienta)');
  await db.query(`UPDATE ksie_selecciones SET resultado = $2, herramienta_resultado = $3, detalle = $4, resuelta_at = now() WHERE id = $1`, [seleccion_id, resultado, herramienta, detalle.slice(0, 1000)]);
  const cap = `herramienta:${herramienta}`;
  if ((await db.query(`SELECT 1 FROM cog_capacidades WHERE capacidad = $1`, [cap])).rows[0]) await registrarPrueba(db, cap, resultado !== 'fallo', `${resultado}: ${detalle}`.slice(0, 300), 'ksie');
  await audit(db, actor, 'ksie.herramienta', { seleccion: seleccion_id, herramienta, resultado });
  if (resultado === 'exito') return { seleccion_id, resultado };
  await sincronizarRegistro(db);
  const excluir = [...new Set([...(s.candidatas ?? []).filter((c: any) => (c.descartada ?? []).some((d: string) => /excluida/.test(d))).map((c: any) => c.herramienta), herramienta])];
  const nueva = await enrutar(db, { descripcion: s.necesidad, operaciones: s.operaciones, excluir, calidad_minima: resultado === 'insuficiente' ? 0.4 : undefined }, actor, seleccion_id);
  return { seleccion_id, resultado, replanificacion: nueva };
}

// Aprendizaje medido: tasa de éxito de las selecciones por operación y por herramienta, y si mejora con el tiempo
export async function aprendizaje(db: Db) {
  const porOp = (await db.query(`SELECT unnest(operaciones) AS operacion, count(*) FILTER (WHERE resultado = 'exito')::int AS exito, count(*) FILTER (WHERE resultado IN ('fallo','insuficiente'))::int AS fallo FROM ksie_selecciones WHERE resultado <> 'pendiente' AND NOT sin_herramientas GROUP BY 1 ORDER BY 1`)).rows;
  const serie = (await db.query(`SELECT resultado = 'exito' AS ok FROM ksie_selecciones WHERE resultado <> 'pendiente' AND NOT sin_herramientas ORDER BY id`)).rows.map((x) => (x.ok ? 1 : 0));
  const h = Math.floor(serie.length / 2), m = (a: number[]) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100 : null);
  const mejores = (await db.query(`SELECT DISTINCT ON (op) op, herramienta_resultado, n FROM (SELECT unnest(operaciones) AS op, herramienta_resultado, count(*) FILTER (WHERE resultado = 'exito') AS n FROM ksie_selecciones WHERE herramienta_resultado IS NOT NULL GROUP BY 1, 2) x ORDER BY op, n DESC`)).rows;
  return { por_operacion: porOp, exito_primera_mitad: m(serie.slice(0, h)), exito_segunda_mitad: m(serie.slice(h)), selecciones_resueltas: serie.length, mejor_herramienta_por_operacion: mejores,
    sin_herramientas: (await db.query(`SELECT count(*)::int AS n FROM ksie_selecciones WHERE sin_herramientas`)).rows[0].n };
}
