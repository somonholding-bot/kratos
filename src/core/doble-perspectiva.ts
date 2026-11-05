import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { instantiatePlaybook } from './playbooks.ts';

// Protocolo de investigación de doble perspectiva (propietario, 5-nov-2026). El propietario conversa con dos grandes tradiciones:
// la hermética (Hermes Trismegisto, como interpretación de sus enseñanzas, nunca palabras históricas) y la científica (Albert Einstein,
// desde sus teorías documentadas; lo descubierto después, separado). La respuesta visible es breve y natural; la investigación real
// (fuentes, afirmaciones con nivel, pregunta e hipótesis ACD, revisión de Saturno) la hace Sol y queda guardada.

export const PREGUNTAS = [
  { numero: 1, linea: 'A1', titulo: 'Origen y composición de la materia', texto: '¿Qué es realmente la materia, de dónde viene y de qué está hecha antes de manifestarse?' },
  { numero: 2, linea: 'A3', titulo: 'Inteligencia y organización de la materia', texto: '¿Hay una inteligencia u orden que organiza la materia, o la organización surge sola?' },
  { numero: 3, linea: 'A5', titulo: 'Conciencia e influencia sobre la materia', texto: '¿Qué es la conciencia y puede influir sobre la materia?' },
  { numero: 4, linea: 'A2', titulo: 'Leyes desconocidas de la naturaleza', texto: '¿Existen leyes de la naturaleza que todavía no conocemos? ¿Cómo podríamos descubrirlas?' },
  { numero: 5, linea: 'A2', titulo: 'Naturaleza del tiempo', texto: '¿Qué es el tiempo? ¿Existe de verdad o es una forma de percibir?' },
  { numero: 6, linea: 'A4', titulo: 'Transformación interior, conocimiento y verdad frente a ilusión', texto: '¿Cómo se transforma una persona por dentro, cómo se llega al conocimiento verdadero y cómo distinguir la verdad de la ilusión?' },
];
const AREA: Record<string, string> = { A1: 'materia-fisica', A2: 'leyes-fundamentales', A3: 'vibracion-informacion', A4: 'conciencia', A5: 'intencion-fisica', A6: 'hermetismo', A7: 'modelos-originales', A8: 'preguntas-abiertas' };

export async function sembrarPreguntasDP(db: Db) {
  for (const p of PREGUNTAS) await db.query(`INSERT INTO dp_preguntas (numero, titulo, texto, linea) VALUES ($1,$2,$3,$4) ON CONFLICT (numero) DO UPDATE SET titulo = EXCLUDED.titulo, texto = EXCLUDED.texto, linea = EXCLUDED.linea`, [p.numero, p.titulo, p.texto, p.linea]);
  return PREGUNTAS.length;
}

export async function listar(db: Db) {
  const ps = (await db.query(`SELECT p.*, (SELECT json_agg(json_build_object('sesion', s.id, 'estado', s.estado, 'tarea_sol', s.tarea_sol, 'tarea_saturno', s.tarea_saturno) ORDER BY s.id) FROM dp_sesiones s WHERE s.numero = p.numero) AS sesiones FROM dp_preguntas p ORDER BY numero`)).rows;
  const actual = ps.find((p) => p.estado === 'en_dialogo') ?? null;
  return { preguntas: ps, en_dialogo: actual ? actual.numero : null, siguiente: ps.find((p) => p.estado === 'pendiente')?.numero ?? null,
    regla: 'Una pregunta por vez: se profundiza y se debate antes de pasar a la siguiente (solo cuando el propietario lo diga).' };
}

// Empieza (o retoma) una pregunta: guarda la respuesta visible que dio KRATOS y encarga a Sol la investigación real
export async function iniciar(db: Db, i: { numero?: number; pregunta?: string; respuesta_visible?: string; continuar?: boolean; linea?: string }, actor: string) {
  let numero = i.numero ? Number(i.numero) : null, texto = String(i.pregunta ?? '').trim(), linea = i.linea ?? 'A8';
  if (numero) {
    const p = (await db.query(`SELECT * FROM dp_preguntas WHERE numero = $1`, [numero])).rows[0];
    if (!p) throw new Error('Las preguntas de estudio van del 1 al 6');
    const otra = (await db.query(`SELECT numero, titulo FROM dp_preguntas WHERE estado = 'en_dialogo' AND numero <> $1`, [numero])).rows[0];
    if (otra && !i.continuar) return { iniciada: false, motivo: `Seguimos con la pregunta ${otra.numero} («${otra.titulo}»). Pasamos a la ${numero} cuando el propietario diga que quiere continuar (continuar=true).` };
    if (otra) await db.query(`UPDATE dp_preguntas SET estado = 'estudiada' WHERE numero = $1`, [otra.numero]);
    await db.query(`UPDATE dp_preguntas SET estado = 'en_dialogo' WHERE numero = $1`, [numero]);
    texto = texto || p.texto; linea = p.linea;
  }
  if (!texto) throw new Error('Falta la pregunta (o el número 1–6)');
  // Si ya hay una investigación en curso de la misma pregunta, no se duplica
  const ya = (await db.query(`SELECT id, tarea_sol, estado FROM dp_sesiones WHERE (numero = $1 OR lower(pregunta) = lower($2)) AND estado IN ('investigando','revision') ORDER BY id DESC LIMIT 1`, [numero, texto])).rows[0];
  if (ya) {
    if (i.respuesta_visible) await db.query(`UPDATE dp_sesiones SET respuesta_visible = coalesce(respuesta_visible, $2), updated_at = now() WHERE id = $1`, [ya.id, i.respuesta_visible]);
    return { iniciada: false, sesion: ya.id, tarea_sol: ya.tarea_sol, motivo: `Ya está en investigación (sesión ${ya.id}, ${ya.estado})` };
  }
  const negocio = (await db.query(`SELECT id FROM businesses WHERE NOT is_demo ORDER BY id LIMIT 1`)).rows[0]?.id ?? 1;
  const r: any = await instantiatePlaybook(db, { id: 'sol-doble-perspectiva', negocioId: negocio, parametros: { pregunta: texto.slice(0, 600), linea }, version: null, soloValidar: false, creadoPor: 'kratos (IA)' });
  if (!r?.ok) throw new Error(`No pude encargar la investigación a Sol: ${r?.error ?? 'error'}`);
  const s = (await db.query(`INSERT INTO dp_sesiones (numero, pregunta, linea, respuesta_visible, tarea_sol) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [numero, texto, linea, i.respuesta_visible ?? null, r.tarea])).rows[0];
  await audit(db, actor, 'doble_perspectiva.inicio', { sesion: s.id, numero, tarea: r.tarea });
  return { iniciada: true, sesion: s.id, tarea_sol: r.tarea, area_acd: AREA[linea] ?? 'preguntas-abiertas',
    nota: 'Sol investiga con fuentes herméticas y científicas, registra la pregunta y la hipótesis en ACD, y luego Saturno revisa las afirmaciones científicas.' };
}

export async function profundizar(db: Db, sesion: number, comentario: string, actor: string) {
  const s = (await db.query(`SELECT id FROM dp_sesiones WHERE id = $1`, [sesion])).rows[0];
  if (!s) throw new Error(`No existe la sesión ${sesion}`);
  await db.query(`UPDATE dp_sesiones SET profundizaciones = profundizaciones || $2::jsonb, updated_at = now() WHERE id = $1`, [sesion, JSON.stringify([{ at: new Date().toISOString(), actor, comentario: String(comentario).slice(0, 2000) }])]);
  return { sesion, guardado: true };
}

export async function ver(db: Db, sesion?: number) {
  const s = (await db.query(sesion ? `SELECT * FROM dp_sesiones WHERE id = $1` : `SELECT * FROM dp_sesiones ORDER BY id DESC LIMIT 1`, sesion ? [sesion] : [])).rows[0];
  if (!s) return { nota: 'Todavía no hay sesiones de doble perspectiva' };
  const t = s.tarea_sol ? (await db.query(`SELECT status, result->>'deliverable' AS informe, last_error FROM tasks WHERE id = $1`, [s.tarea_sol])).rows[0] : null;
  const sat = s.tarea_saturno ? (await db.query(`SELECT status, result->>'deliverable' AS informe FROM tasks WHERE id = $1`, [s.tarea_saturno])).rows[0] : null;
  return { sesion: s.id, numero: s.numero, pregunta: s.pregunta, estado: s.estado, respuesta_dada: s.respuesta_visible,
    investigacion_de_sol: t ? (t.status === 'completada' ? String(t.informe ?? '').slice(0, 9000) : `Sol aún trabaja (${t.status})${t.last_error ? `: ${t.last_error}` : ''}`) : null,
    revision_de_saturno: sat ? (sat.status === 'completada' ? String(sat.informe ?? '').slice(0, 5000) : `Saturno aún revisa (${sat.status})`) : 'pendiente de que Sol termine',
    profundizaciones: s.profundizaciones,
    como_contarlo: 'Cuéntaselo al propietario como una conversación: las dos perspectivas en lenguaje natural y breve, y qué podemos investigar. Sin códigos ni porcentajes salvo que los pida.' };
}

// Planificador (worker): cuando Sol termina, encarga a Saturno la revisión de las afirmaciones científicas; cuando Saturno termina, queda lista
export async function avanzarDP(db: Db) {
  const ss = (await db.query(`SELECT s.*, t.status AS st_sol, t.verified_at AS ver_sol, t.started_at AS ini_sol, t.completed_at AS fin_sol, k.status AS st_sat FROM dp_sesiones s LEFT JOIN tasks t ON t.id = s.tarea_sol LEFT JOIN tasks k ON k.id = s.tarea_saturno WHERE s.estado IN ('investigando','revision')`)).rows;
  for (const s of ss) {
    if (s.estado === 'investigando' && ['fallida', 'cancelada'].includes(s.st_sol)) { await db.query(`UPDATE dp_sesiones SET estado = 'fallida', updated_at = now() WHERE id = $1`, [s.id]); continue; }
    if (s.estado === 'investigando' && s.st_sol === 'completada') {
      const hs = (await db.query(`SELECT id FROM acd_hipotesis WHERE created_by LIKE '%sol%' AND created_at BETWEEN $1 AND coalesce($2, now()) ORDER BY id`, [s.ini_sol ?? s.created_at, s.fin_sol])).rows.map((h) => `#${h.id}`);
      const negocio = (await db.query(`SELECT id FROM businesses WHERE NOT is_demo ORDER BY id LIMIT 1`)).rows[0]?.id ?? 1;
      const r: any = await instantiatePlaybook(db, { id: 'acd-critica', negocioId: negocio, parametros: { campana: '', alcance: `Doble perspectiva, sesión ${s.id} («${String(s.pregunta).slice(0, 160)}»): hipótesis ${hs.join(', ') || 'de la tarea #' + s.tarea_sol} y las afirmaciones científicas importantes del informe de Sol (tarea #${s.tarea_sol}); que no se atribuya a Einstein nada que no defendió y que nada hermético se presente como ley física.`.slice(0, 600) }, version: null, soloValidar: false, creadoPor: 'kratos (IA)' }).catch((e: any) => ({ ok: false, error: e.message }));
      if (r?.ok && r.tarea) await db.query(`UPDATE dp_sesiones SET tarea_saturno = $2, estado = 'revision', updated_at = now() WHERE id = $1`, [s.id, r.tarea]);
      continue;
    }
    if (s.estado === 'revision' && ['completada', 'fallida', 'cancelada'].includes(s.st_sat)) await db.query(`UPDATE dp_sesiones SET estado = 'lista', updated_at = now() WHERE id = $1`, [s.id]);
  }
}

export const DOBLE_TOOL = {
  description: 'Investigación de doble perspectiva: Hermes Trismegisto (tradición hermética) y Albert Einstein (física documentada). preguntas: las 6 preguntas de estudio y cuál está en diálogo. iniciar (numero 1–6 o pregunta libre, respuesta_visible = lo que acabas de responder, continuar=true solo si el propietario pidió pasar a otra): '
    + 'guarda la conversación y encarga a Sol la investigación real (fuentes, afirmaciones, pregunta e hipótesis en ACD) y luego a Saturno la revisión. profundizar (sesion, comentario). ver (sesion): respuesta, investigación de Sol y revisión de Saturno para contarlas en lenguaje natural.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['preguntas', 'iniciar', 'profundizar', 'ver'] }, numero: { type: 'number' }, pregunta: { type: 'string' }, respuesta_visible: { type: 'string' },
    continuar: { type: 'boolean' }, linea: { type: 'string' }, sesion: { type: 'number' }, comentario: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaDoble(db: Db, i: any, actor: string) {
  if (i.accion === 'preguntas') return await listar(db);
  if (i.accion === 'iniciar') return await iniciar(db, i, actor);
  if (i.accion === 'profundizar') return await profundizar(db, Number(i.sesion), String(i.comentario ?? ''), actor);
  if (i.accion === 'ver') return await ver(db, i.sesion ? Number(i.sesion) : undefined);
  return { error: 'Acción no válida' };
}
