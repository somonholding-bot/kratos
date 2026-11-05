import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { ROOT } from '../config.ts';
import { audit, getState } from './state.ts';

// Expansión cognitiva C01 — automodelo funcional de KRATOS (docs/kratos-cognitive-expansion/DIRECTIVA.md).
// Se construye con observaciones reales: herramientas registradas, código presente, pruebas ejecutadas y su resultado, tareas y fallos.
// Tres niveles distintos por capacidad: INSTALADA (existe el código o binario), DISPONIBLE (registrada y con dependencias) y PROBADA
// (la última prueba real salió bien y no hay un fallo posterior). La confianza sale del historial de pruebas, nunca de una autodescripción.

export type NivelCapacidad = 'no_existe' | 'instalada' | 'disponible' | 'probada' | 'degradada';
const VENTANA_DIAS = 30;

// Subsistemas y dependencias que KRATOS dice tener: se comprueba que el código o el binario exista de verdad
const SUBSISTEMAS: { capacidad: string; descripcion: string; archivo: string }[] = [
  { capacidad: 'subsistema:acd', descripcion: 'Motor ACD de descubrimiento (hipótesis, modelos, experimentos aislados, críticas)', archivo: 'src/core/acd.ts' },
  { capacidad: 'subsistema:ejecutor_aislado', descripcion: 'Ejecutor de experimentos sin red ni escritura fuera de su carpeta (sandbox-exec)', archivo: 'scripts/acd/sandbox.sb' },
  { capacidad: 'subsistema:conectores', descripcion: 'Conectores de investigación legal R01–R16', archivo: 'src/core/conectores.ts' },
  { capacidad: 'subsistema:curriculo_sol', descripcion: 'Currículo de 56 materias con exámenes independientes', archivo: 'src/core/curriculo.ts' },
  { capacidad: 'subsistema:rastreador_sol', descripcion: 'Rastreador de requisitos SOL/ACD', archivo: 'src/core/requisitos.ts' },
  { capacidad: 'subsistema:q_lab', descripcion: 'Q-LAB (subsistema de optimización experimental citado en la directiva)', archivo: 'src/core/qlab.ts' },
];
const DEPENDENCIAS: { capacidad: string; descripcion: string; ruta: string | string[] }[] = [
  { capacidad: 'dependencia:python_acd', descripcion: 'Python 3.11 con numpy/scipy/sympy para experimentos', ruta: '.jarvis/acd/venv/bin/python' },
  { capacidad: 'dependencia:sandbox_exec', descripcion: 'sandbox-exec de macOS', ruta: '/usr/bin/sandbox-exec' },
  { capacidad: 'dependencia:ollama', descripcion: 'Ollama local (modelo de respaldo)', ruta: ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app'] },
  { capacidad: 'dependencia:ffmpeg', descripcion: 'ffmpeg (vídeo y audio)', ruta: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] },
  { capacidad: 'dependencia:cuda', descripcion: 'GPU NVIDIA con CUDA', ruta: '/usr/local/cuda/bin/nvcc' },
];
const existe = (p: string) => fs.existsSync(path.isAbsolute(p) ? p : path.join(ROOT, p));

async function upsert(db: Db, c: { capacidad: string; tipo: string; descripcion?: string | null; instalada: boolean; disponible: boolean; evidencia?: string | null }) {
  await db.query(`INSERT INTO cog_capacidades (capacidad, tipo, descripcion, instalada, disponible, evidencia) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (capacidad) DO UPDATE SET tipo = EXCLUDED.tipo, descripcion = coalesce(EXCLUDED.descripcion, cog_capacidades.descripcion), instalada = EXCLUDED.instalada,
        disponible = EXCLUDED.disponible, evidencia = coalesce(EXCLUDED.evidencia, cog_capacidades.evidencia), updated_at = now()`,
    [c.capacidad, c.tipo, c.descripcion ?? null, c.instalada, c.disponible, c.evidencia ?? null]);
}

// Registra una prueba real de una capacidad (ok o fallo). Un fallo posterior a un éxito la deja «degradada».
export async function registrarPrueba(db: Db, capacidad: string, ok: boolean, evidencia: string, origen: string, at?: Date) {
  if (!String(evidencia ?? '').trim()) throw new Error('Una prueba necesita evidencia (qué se ejecutó y qué salió)');
  const ex = (await db.query(`SELECT 1 FROM cog_capacidades WHERE capacidad = $1`, [capacidad])).rows[0];
  if (!ex) throw new Error(`No existe la capacidad «${capacidad}» en el automodelo`);
  const cuando = at ?? new Date();
  await db.query(`INSERT INTO cog_capacidad_pruebas (capacidad, ok, evidencia, origen, at) VALUES ($1,$2,$3,$4,$5)`, [capacidad, ok, String(evidencia).slice(0, 600), origen, cuando]);
  await db.query(ok
    ? `UPDATE cog_capacidades SET pruebas_ok = pruebas_ok + 1, ultima_ok = greatest(coalesce(ultima_ok, $2), $2), updated_at = now() WHERE capacidad = $1`
    : `UPDATE cog_capacidades SET pruebas_fallo = pruebas_fallo + 1, ultimo_fallo = greatest(coalesce(ultimo_fallo, $2), $2), detalle_fallo = $3, updated_at = now() WHERE capacidad = $1`,
    ok ? [capacidad, cuando] : [capacidad, cuando, String(evidencia).slice(0, 300)]);
}

// Nivel real de una capacidad: un éxito antiguo no cuenta si hay un fallo más reciente
export function nivel(c: any): NivelCapacidad {
  if (!c) return 'no_existe';
  if (!c.instalada) return 'no_existe';
  if (!c.disponible) return 'instalada';
  const ok = c.ultima_ok ? new Date(c.ultima_ok).getTime() : 0, ko = c.ultimo_fallo ? new Date(c.ultimo_fallo).getTime() : 0;
  if (ko && ko >= ok) return 'degradada';
  if (ok && Date.now() - ok < VENTANA_DIAS * 86_400_000) return 'probada';
  return 'disponible';
}
// Confianza = estimación de Laplace sobre las pruebas recientes (sin pruebas: 0,5 = no se sabe)
export function confianza(c: any) { const ok = Number(c?.pruebas_ok ?? 0), ko = Number(c?.pruebas_fallo ?? 0); return Math.round(((ok + 1) / (ok + ko + 2)) * 100) / 100; }

// Sincroniza el automodelo con lo que existe de verdad: herramientas registradas, subsistemas, dependencias y pruebas observadas
export async function sincronizarCapacidades(db: Db) {
  const tools = (await db.query(`SELECT name, description, active FROM tool_registry`)).rows;
  for (const t of tools) await upsert(db, { capacidad: `herramienta:${t.name}`, tipo: 'herramienta', descripcion: String(t.description ?? '').slice(0, 300), instalada: true, disponible: !!t.active });
  for (const s of SUBSISTEMAS) { const i = existe(s.archivo); await upsert(db, { capacidad: s.capacidad, tipo: 'subsistema', descripcion: s.descripcion, instalada: i, disponible: i, evidencia: i ? `archivo ${s.archivo}` : `no existe ${s.archivo}` }); }
  for (const d of DEPENDENCIAS) { const rutas = Array.isArray(d.ruta) ? d.ruta : [d.ruta]; const r = rutas.find(existe); await upsert(db, { capacidad: d.capacidad, tipo: 'dependencia', descripcion: d.descripcion, instalada: !!r, disponible: !!r, evidencia: r ?? `no existe ${rutas.join(' ni ')}` }); }
  // Uso real de herramientas (audit_log): cada llamada sin error posterior de esa herramienta cuenta como prueba superada; cada error, como fallo
  const desde = (await db.query(`SELECT coalesce(max(at), 'epoch') AS d FROM cog_capacidad_pruebas WHERE origen = 'audit'`)).rows[0].d;
  const usos = (await db.query(`SELECT action, details, at FROM audit_log WHERE at > $1 AND (action LIKE 'herramienta.%') ORDER BY at LIMIT 5000`, [desde])).rows;
  for (const u of usos) {
    const err = u.action === 'herramienta.error', nombre = err ? u.details?.herramienta : String(u.action).slice('herramienta.'.length);
    if (!nombre) continue;
    const cap = `herramienta:${nombre}`;
    if (!(await db.query(`SELECT 1 FROM cog_capacidades WHERE capacidad = $1`, [cap])).rows[0]) continue;
    await registrarPrueba(db, cap, !err, err ? `error: ${String(u.details?.error ?? '').slice(0, 200)}` : 'llamada registrada sin error', 'audit', new Date(u.at));
  }
  // Pruebas en vivo de los conectores de Sol
  const probes = (await db.query(`SELECT DISTINCT ON (codigo) codigo, ok, detalle, probado_en FROM sol_conectores_pruebas ORDER BY codigo, probado_en DESC`).catch(() => ({ rows: [] as any[] }))).rows;
  for (const p of probes) {
    await upsert(db, { capacidad: `conector:${p.codigo}`, tipo: 'conector', descripcion: `Conector de investigación ${p.codigo}`, instalada: existe('src/core/conectores.ts'), disponible: true });
    const ya = (await db.query(`SELECT 1 FROM cog_capacidad_pruebas WHERE capacidad = $1 AND at = $2`, [`conector:${p.codigo}`, p.probado_en])).rows[0];
    if (!ya) await registrarPrueba(db, `conector:${p.codigo}`, !!p.ok, String(p.detalle ?? '').slice(0, 300) || (p.ok ? 'prueba en vivo ok' : 'prueba en vivo fallida'), 'sol_conectores_pruebas', new Date(p.probado_en));
  }
  const exps = (await db.query(`SELECT count(*) FILTER (WHERE estado = 'ok')::int AS ok, count(*) FILTER (WHERE estado <> 'ok' AND estado <> 'ejecutando')::int AS ko, max(fin) FILTER (WHERE estado = 'ok') AS ult FROM acd_experimentos`).catch(() => ({ rows: [{ ok: 0, ko: 0 }] }))).rows[0];
  if (exps.ok > 0) await db.query(`UPDATE cog_capacidades SET ultima_ok = greatest(coalesce(ultima_ok, $1), $1), pruebas_ok = greatest(pruebas_ok, $2), evidencia = 'acd_experimentos ok: ' || $2 WHERE capacidad = 'subsistema:ejecutor_aislado'`, [exps.ult, exps.ok]);
}

export async function capacidad(db: Db, nombre: string) {
  const n = String(nombre ?? '').trim();
  const c = (await db.query(`SELECT * FROM cog_capacidades WHERE capacidad = $1 OR capacidad = 'herramienta:' || $1 OR capacidad = 'subsistema:' || $1 OR capacidad = 'conector:' || upper($1) OR capacidad = 'dependencia:' || $1 LIMIT 1`, [n])).rows[0];
  const ult = c ? (await db.query(`SELECT ok, evidencia, origen, at FROM cog_capacidad_pruebas WHERE capacidad = $1 ORDER BY at DESC LIMIT 3`, [c.capacidad])).rows : [];
  const nv = nivel(c);
  return { capacidad: c?.capacidad ?? n, nivel: nv, existe: nv !== 'no_existe', instalada: !!c?.instalada, disponible: !!c?.disponible, probada: nv === 'probada',
    confianza: nv === 'no_existe' ? 0 : confianza(c), pruebas: c ? { ok: c.pruebas_ok, fallo: c.pruebas_fallo } : null, ultimas_pruebas: ult, evidencia: c?.evidencia ?? null,
    explicacion: nv === 'no_existe' ? `No tengo «${n}»: no hay código, binario ni herramienta registrada con ese nombre.`
      : nv === 'instalada' ? 'El código existe, pero no está disponible (no registrada o faltan dependencias).'
      : nv === 'degradada' ? `Falló en su última prueba (${c.detalle_fallo ?? 'sin detalle'}): no la doy por operativa.`
      : nv === 'disponible' ? 'Está disponible, pero no tengo una prueba reciente que demuestre que funciona.' : 'Probada con éxito recientemente y sin fallos posteriores.' };
}

// ¿Qué agente hace esta tarea? Puntuación por solapamiento de términos con su función, estatuto y herramientas; si nadie encaja, lo dice.
const VACIAS = new Set('de la el los las un una y o en para por con que del al se su sus lo es como más sin sobre este esta tarea hacer quiero'.split(' '));
const terminos = (s: string) => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !VACIAS.has(w)));
export async function quienHace(db: Db, descripcion: string, opts: { excluir?: string[] } = {}) {
  const q = terminos(descripcion);
  if (!q.size) return { agente: null, motivo: 'La descripción no tiene términos suficientes para decidir', candidatos: [] };
  const ags = (await db.query(`SELECT id, name, purpose, charter, allowed_tools FROM agent_functions WHERE id <> 'kratos' AND NOT (id = ANY($1))`, [opts.excluir ?? []])).rows;
  // La función principal (purpose) pesa el doble que el estatuto y las herramientas: un agente se elige por lo que ES, no por lo que puede tocar
  const coincide = (t: Set<string>, w: string) => t.has(w) || (w.length >= 6 && [...t].some((x) => x.startsWith(w.slice(0, 6))));
  const cands = ags.map((a) => {
    const prop = terminos(a.purpose), resto = terminos(`${a.charter ?? ''} ${(a.allowed_tools ?? []).join(' ')}`);
    const enProp = [...q].filter((w) => coincide(prop, w)), enResto = [...q].filter((w) => !enProp.includes(w) && coincide(resto, w));
    return { agente: a.id, nombre: a.name, puntos: Math.min(1, (2 * enProp.length + enResto.length) / (2 * q.size)), terminos: [...enProp, ...enResto].slice(0, 8) };
  }).sort((a, b) => b.puntos - a.puntos);
  const top = cands[0];
  if (!top || top.puntos < 0.15) return { agente: null, motivo: 'Ningún agente registrado cubre esta tarea con claridad: no la asigno a ciegas; habría que crear la capacidad o pedir más detalle', candidatos: cands.slice(0, 3) };
  const empate = cands[1] && cands[1].puntos >= top.puntos * 0.9;
  return { agente: top.agente, motivo: `Su función y herramientas coinciden en: ${top.terminos.join(', ')}${empate ? ` (casi empata con ${cands[1].nombre}: conviene que KRATOS lo decida o lo divida)` : ''}`, candidatos: cands.slice(0, 3) };
}

// ¿Puedo hacer algo que necesita estas capacidades? Si falta alguna, lo reconoce y dice cuál.
export async function puedo(db: Db, requisitos: string[]) {
  const det = [] as any[];
  for (const r of requisitos) det.push(await capacidad(db, r));
  const faltan = det.filter((d) => d.nivel === 'no_existe' || d.nivel === 'instalada' || d.nivel === 'degradada');
  const sinProbar = det.filter((d) => d.nivel === 'disponible');
  return { puedo: faltan.length === 0, requisitos: det.map((d) => ({ capacidad: d.capacidad, nivel: d.nivel, confianza: d.confianza })),
    respuesta: faltan.length ? `No puedo completarlo ahora: falta o falla ${faltan.map((d) => `${d.capacidad} (${d.nivel})`).join(', ')}.`
      : sinProbar.length ? `Puedo intentarlo, pero ${sinProbar.map((d) => d.capacidad).join(', ')} no tiene prueba reciente: el resultado necesita verificación.` : 'Sí: todas las capacidades necesarias están probadas.' };
}

// Automodelo completo (máquina legible). Se guarda una instantánea en cog_automodelo.
export async function construirAutomodelo(db: Db, guardar = true) {
  await sincronizarCapacidades(db);
  const st = await getState(db);
  const kratos = (await db.query(`SELECT purpose FROM agent_functions WHERE id = 'kratos'`)).rows[0];
  const plan = (await db.query(`SELECT left(content, 600) AS c FROM strategy_plan ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }))).rows[0];
  const agentes = (await db.query(`SELECT id, name, purpose, allowed_tools FROM agent_functions ORDER BY id`)).rows;
  const caps = (await db.query(`SELECT * FROM cog_capacidades ORDER BY capacidad`)).rows;
  const porNivel: Record<string, number> = {};
  for (const c of caps) { const n = nivel(c); porNivel[n] = (porNivel[n] ?? 0) + 1; }
  let disco: any = null; try { const s = fs.statfsSync('/'); disco = { libre_gb: Math.round((s.bavail * s.bsize) / 1e9) }; } catch { /* sin statfs */ }
  const exitos = (await db.query(`SELECT id, title, owner_function, completed_at FROM tasks WHERE status = 'completada' AND verified_at IS NOT NULL AND completed_at > now() - interval '7 days' ORDER BY completed_at DESC LIMIT 8`)).rows;
  const fallos = (await db.query(`SELECT id, title, owner_function, left(coalesce(last_error, ''), 200) AS error, updated_at FROM tasks WHERE status = 'fallida' AND updated_at > now() - interval '14 days' ORDER BY updated_at DESC LIMIT 8`)).rows;
  const abiertas = (await db.query(`SELECT id, title, owner_function, status FROM tasks WHERE status IN ('pendiente','en_ejecucion','verificando','requiere_revision','esperando_permiso','bloqueada') ORDER BY id LIMIT 20`)).rows;
  const req = (await db.query(`SELECT estado, count(*)::int AS n FROM sol_requisitos GROUP BY 1`).catch(() => ({ rows: [] as any[] }))).rows;
  const limitaciones = [
    'Los agentes se ejecutan de uno en uno (cola en serie) y comparten turno con el trabajo de la empresa.',
    `Memoria ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.cpus().length} núcleos, sin GPU CUDA: no ejecuta pipelines Linux/CUDA.`,
    'Sin gasto de API de pago sin autorización; el motor principal es la suscripción.',
    ...caps.filter((c) => nivel(c) === 'no_existe').map((c) => `No tiene ${c.capacidad}: ${c.descripcion ?? ''}`),
    ...caps.filter((c) => nivel(c) === 'degradada').map((c) => `Degradada ${c.capacidad}: ${c.detalle_fallo ?? ''}`),
  ];
  const modelo = {
    identidad: { nombre: 'KRATOS', funcion: kratos?.purpose ?? null, version_codigo: fs.existsSync(path.join(ROOT, '.git')) ? 'repositorio ~/Jarvis' : null },
    objetivos: { plan_maestro: plan?.c ?? null, meta: '10.000 USD/mes de beneficio neto como primer hito; 250.000 USD/mes como ambición' },
    agentes: agentes.map((a) => ({ id: a.id, nombre: a.name, responsabilidad: a.purpose, herramientas: a.allowed_tools })),
    herramientas: { total: caps.filter((c) => c.tipo === 'herramienta').length, por_nivel: porNivel },
    recursos: { memoria_gb: Math.round(os.totalmem() / 2 ** 30), nucleos: os.cpus().length, carga: os.loadavg().map((x) => Math.round(x * 10) / 10), disco },
    estado_operativo: { parada_emergencia: !!st.emergency_stop, automatizaciones_pausadas: !!st.automations_paused, tareas_abiertas: abiertas.length },
    confianza_en_capacidades: caps.filter((c) => c.pruebas_ok + c.pruebas_fallo > 0).map((c) => ({ capacidad: c.capacidad, nivel: nivel(c), confianza: confianza(c), pruebas: c.pruebas_ok + c.pruebas_fallo })).sort((a, b) => a.confianza - b.confianza).slice(0, 25),
    exitos_verificados_recientes: exitos, fallos_recientes: fallos, tareas_sin_resolver: abiertas,
    limitaciones, requisitos_sol: req,
    evidencia: 'cog_capacidades + cog_capacidad_pruebas (audit_log, sol_conectores_pruebas, acd_experimentos), tasks, agent_functions, tool_registry',
  };
  if (guardar) { await db.query(`INSERT INTO cog_automodelo (modelo) VALUES ($1)`, [JSON.stringify(modelo)]); await audit(db, 'automodelo', 'cog.automodelo', { por_nivel: porNivel }); }
  return modelo;
}

export const AUTOMODELO_TOOL = {
  description: 'Automodelo de KRATOS (C01): qué es, qué agentes tiene, qué herramientas existen y si están instaladas, disponibles o PROBADAS con éxito, con su confianza medida por pruebas reales. '
    + 'ver: automodelo completo. capacidad (nombre): nivel real de una herramienta/subsistema/conector/dependencia. quien_hace (descripcion): qué agente encaja y por qué, o reconoce que ninguno. '
    + 'puedo (requisitos [nombres]): si puede hacer algo o qué le falta. registrar_prueba (capacidad, ok, evidencia): anota una prueba real; un fallo rebaja la evaluación. No describas capacidades que el automodelo no respalde.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['ver', 'capacidad', 'quien_hace', 'puedo', 'registrar_prueba'] }, nombre: { type: 'string' }, descripcion: { type: 'string' },
    requisitos: { type: 'array', items: { type: 'string' } }, capacidad: { type: 'string' }, ok: { type: 'boolean' }, evidencia: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaAutomodelo(db: Db, i: any, actor: string) {
  if (i.accion === 'ver') return await construirAutomodelo(db);
  if (i.accion === 'capacidad') return await capacidad(db, String(i.nombre ?? i.capacidad ?? ''));
  if (i.accion === 'quien_hace') return await quienHace(db, String(i.descripcion ?? ''));
  if (i.accion === 'puedo') return await puedo(db, (i.requisitos ?? []).map(String));
  if (i.accion === 'registrar_prueba') { await registrarPrueba(db, String(i.capacidad), !!i.ok, String(i.evidencia ?? ''), actor); return await capacidad(db, String(i.capacidad)); }
  return { error: 'Acción no válida' };
}
