import type { Db } from '../db.ts';
import { audit, emergencyStop, getState } from './state.ts';
import { createTask } from './tasks.ts';
import { requestApproval } from './approvals.ts';
import { AI_ACCOUNT, think } from './brain.ts';
import { dial, saveContact } from './phone.ts';
import { buildReport, spokenReport } from './report.ts';
import { addAgenda, cancelAgenda, describe, owner, parseAgenda, upcoming } from './agenda.ts';

// Modo demostración (sin IA): interpreta un conjunto fijo de órdenes en español.
// No puede aprobar, gastar ni reanudar: esas acciones solo existen como botones del panel.
// Cuando se conecte Claude (Etapa E), este módulo pasa a ser la vía de respaldo.

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\W*((hey|oye|ey)\W+)?(kratos|jarvis)(\W+kratos)?\b\W*/, '').trim();

export type Reply = { text: string; spoken: string; action?: string };

export async function handleMessage(db: Db, raw: string, channel: 'texto' | 'voz' = 'texto'): Promise<Reply> {
  const text = raw.slice(0, 2000);
  await db.query(`INSERT INTO messages (role, channel, content) VALUES ('usuario', $1, $2)`, [channel, text]);
  const t = norm(text);
  // Seguridad primero y sin IA: parar, reanudar y aprobar se resuelven siempre igual.
  const SAFETY = /\b(deten|detener|detenga|parar|alto)\b.*\b(todo|todas|acciones)\b|emergencia|\b(reanuda|reanudar)\b|(aprueba|autoriza|autorizo|apruebo)/;
  let reply: Reply;
  if (SAFETY.test(t)) reply = await interpret(db, t, text);
  else {
    const agenda = (await reportIntent(db, t)) ?? (await phoneIntent(db, t, text)) ?? (await agendaIntent(db, t, text));
    if (agenda) reply = agenda;
    else {
    const ai = await think(db, channel);
    if ('text' in ai) reply = ai;
    else {
      reply = await interpret(db, t, text);
      const why = ai.unavailable === 'sin_clave' ? 'IA sin conectar: falta la clave de Claude' :
        ai.unavailable.startsWith('presupuesto') ? `IA en pausa: sin presupuesto disponible en «${AI_ACCOUNT}»` : `IA no disponible (${ai.unavailable})`;
      reply = { ...reply, text: `[${why}; respondo en modo demostración]\n${reply.text}` };
    }
    }
  }
  await db.query(`INSERT INTO messages (role, channel, content) VALUES ('jarvis', $1, $2)`, [channel, reply.text]);
  return reply;
}

async function interpret(db: Db, t: string, original: string): Promise<Reply> {
  if (/\b(deten|detener|detenga|parar|alto)\b.*\b(todo|todas|acciones)\b|emergencia/.test(t)) {
    const r = await emergencyStop(db, 'propietario (conversación)');
    return {
      text: `Parada de emergencia activada. Tareas canceladas: ${r.cancelled.length ? r.cancelled.join(', ') : 'ninguna en curso'}. ${r.external.campanas_externas} Para reanudar, usa el botón «Reanudar» del panel.`,
      spoken: 'Parada de emergencia activada. Todo detenido.', action: 'emergency_stop',
    };
  }
  if (/\b(reanuda|reanudar|continua|activa)\b/.test(t)) {
    return { text: 'Reanudar exige confirmación en el panel (botón «Reanudar»). Por seguridad no lo hago desde la conversación.', spoken: 'Confírmalo en el panel, por favor.' };
  }
  if (/(aprueba|autoriza|autorizo|apruebo)/.test(t)) {
    return { text: 'No acepto aprobaciones por conversación ni por voz. Revisa la pantalla «Aprobaciones» y decide allí.', spoken: 'Las aprobaciones se confirman en el panel.' };
  }

  const money = t.match(/tienes?\s+(\d+(?:[.,]\d{1,2})?)\s*(?:usd|dolares|\$)?\s+(?:para|en)\s+(.+)/);
  if (money) {
    const cents = Math.round(Number(money[1].replace(',', '.')) * 100);
    let purpose = original.slice(original.toLowerCase().lastIndexOf(money[2].split(' ')[0])).trim().slice(0, 120) || money[2];
    if (/\b(ia|claude|inteligencia|api)\b/.test(money[2])) purpose = AI_ACCOUNT;
    const a = await requestApproval(db, {
      kind: 'asignacion_presupuesto', description: `Asignar ${(cents / 100).toFixed(2)} USD a «${purpose}»`,
      accountLabel: purpose, maxAmountCents: cents, validDays: 7, requestedBy: 'propietario (conversación)',
      scope: { origen: 'conversación', valid_until: new Date(Date.now() + 30 * 86400_000).toISOString() },
    });
    return {
      text: `He registrado la propuesta #${a.id}: ${a.description}. No tendrá efecto hasta que la confirmes en «Aprobaciones» (vigencia de la asignación: 30 días).`,
      spoken: `Propuesta registrada. Confírmala en el panel.`, action: 'approval_requested',
    };
  }

  if (/(me oyes|me escuchas|estas ahi|hola)/.test(t)) {
    return { text: 'Sí, te escucho. Estoy en modo demostración porque aún no tengo la clave de Claude; cuando la guardes y apruebes mi presupuesto, podré conversar de verdad.', spoken: 'Sí, te escucho. Aún me falta la clave de Claude para pensar contigo.' };
  }
  if (/(que puedes hacer|que sabes hacer|ayuda|como funcionas)/.test(t)) {
    return {
      text: 'Ahora mismo, sin IA, puedo: decirte cómo van tus negocios, contarte qué hice, mostrar el presupuesto, registrar una asignación («tienes 50 dólares para…»), crear una tarea («crea una tarea: …»), listar aprobaciones pendientes y detener todo («detén todas las acciones»). Con la clave de Claude podré conversar libremente, investigar, recordar en Obsidian y repartir trabajo entre mis siete especialistas.',
      spoken: 'Sin IA puedo resumir tus negocios, crear tareas, mostrar el presupuesto y detener todo. Con la clave de Claude podré hacer mucho más.',
    };
  }
  if (/(como van|resumen|estado|negocios)/.test(t)) return { ...(await summary(db)) };
  if (/(que hiciste|actividad|registro|historial)/.test(t)) {
    const { rows } = await db.query(`SELECT at, actor, action FROM audit_log ORDER BY id DESC LIMIT 8`);
    const lines = rows.map((r) => `· ${new Date(r.at).toLocaleString('es')} — ${r.actor}: ${r.action}`).join('\n');
    return { text: `Últimas acciones registradas:\n${lines}\nCoste observado: 0 USD (sin servicios de pago conectados).`, spoken: `Te muestro las últimas ${rows.length} acciones en pantalla.` };
  }
  if (/(presupuesto|dinero|saldo|gasto)/.test(t)) {
    const { rows } = await db.query(`SELECT label, limit_cents, reserved_cents, spent_cents FROM budget_accounts ORDER BY id`);
    const total = rows.reduce((s, r) => s + Number(r.limit_cents), 0);
    return { text: `Presupuesto asignado en total: ${(total / 100).toFixed(2)} USD.\n${rows.map((r) => `· ${r.label}: límite ${(r.limit_cents / 100).toFixed(2)}, reservado ${(r.reserved_cents / 100).toFixed(2)}, gastado ${(r.spent_cents / 100).toFixed(2)}`).join('\n')}\nPara asignar, dime por ejemplo: «tienes 50 dólares para pruebas de anuncios».`, spoken: total ? `Hay ${(total / 100).toFixed(0)} dólares asignados.` : 'No hay dinero asignado. No puedo gastar nada.' };
  }
  if (/(pendiente|aprobaciones)/.test(t)) {
    const { rows } = await db.query(`SELECT id, description FROM approvals WHERE status = 'pendiente' ORDER BY id`);
    return { text: rows.length ? rows.map((r) => `#${r.id} ${r.description}`).join('\n') : 'No hay aprobaciones pendientes.', spoken: `${rows.length} aprobaciones pendientes.` };
  }
  const nt = t.match(/^(?:crea|anade|agrega|nueva)\s+(?:una\s+)?tarea\s*:?\s*(.+)/);
  if (nt) {
    const biz = (await db.query(`SELECT id FROM businesses ORDER BY is_demo, id LIMIT 1`)).rows[0];
    const title = original.slice(original.length - nt[1].length).trim();
    const { task } = await createTask(db, {
      businessId: biz.id, ownerFunction: 'kratos', type: 'agente', title, objective: title, status: 'esperando_ia',
      expectedResult: 'Por definir con el Director cuando haya IA conectada', verification: 'Revisión del propietario', createdBy: 'propietario (conversación)',
    });
    return { text: `Tarea #${task.id} creada: «${title}». Queda en estado «esperando IA» porque Kratos aún no tiene Claude conectado.`, spoken: 'Tarea creada.' };
  }
  if (/(nueva app|nueva aplicacion|lanzamiento)/.test(t)) {
    return { text: 'Para preparar un lanzamiento necesito el expediente de la app: nombre, enlace, plataformas, audiencia, mercado e ingresos. Créala en «Negocios y productos». La planificación automática llegará al conectar Claude.', spoken: 'Necesito los datos de la app. Te dejo los detalles en pantalla.' };
  }
  await audit(db, 'jarvis', 'conversacion.no_entendida', { texto: original.slice(0, 200) });
  return {
    text: 'Estoy en modo demostración, sin IA conectada. Entiendo: «¿cómo van mis negocios?», «¿qué hiciste?», «presupuesto», «tienes N dólares para X», «crea una tarea: …», «aprobaciones pendientes» y «detén todas las acciones».',
    spoken: 'Aún no entiendo eso. Te dejo en pantalla lo que puedo hacer.',
  };
}

async function summary(db: Db): Promise<Reply> {
  const s = await getState(db);
  const biz = (await db.query(`SELECT b.name, b.is_demo,
      (SELECT count(*) FROM tasks t WHERE t.business_id = b.id AND t.status IN ('pendiente','en_ejecucion','esperando_ia')) AS abiertas,
      (SELECT count(*) FROM tasks t WHERE t.business_id = b.id AND t.status = 'completada' AND t.updated_at > now() - interval '24 hours') AS hechas24
    FROM businesses b ORDER BY b.is_demo, b.id`)).rows;
  const pend = (await db.query(`SELECT count(*)::int AS n FROM approvals WHERE status = 'pendiente'`)).rows[0].n;
  const lines = biz.map((b) => `· ${b.name}${b.is_demo ? ' [DEMO]' : ''}: ${b.abiertas} tareas abiertas, ${b.hechas24} completadas en 24 h`).join('\n');
  const flags = [s.emergency_stop ? 'PARADA DE EMERGENCIA ACTIVA' : null, s.automations_paused ? 'automatizaciones en pausa' : null].filter(Boolean).join(' · ');
  return {
    text: `${flags ? flags + '\n' : ''}${lines}\nAprobaciones pendientes: ${pend}. Modo: demostración (sin IA, 0 USD). No hay negocios reales con datos conectados todavía.`,
    spoken: `Tienes ${biz.length} negocios registrados y ${pend} aprobaciones pendientes. Los detalles están en pantalla.`,
  };
}

// Agenda y alarmas sin IA: rápido, gratis y siempre igual.
async function agendaIntent(db: Db, t: string, original: string): Promise<Reply | null> {
  const o = await owner(db);
  if (/\b(cancela|quita|borra|elimina|desactiva|apaga)\b.*\b(alarma|recordatorio|aviso)/.test(t)) {
    const c = await cancelAgenda(db, undefined, /alarma/.test(t) ? 'alarma' : undefined);
    return c ? { text: `Cancelado: ${describe(c)}.`, spoken: `Listo, ${o.address}. Cancelé ${c.kind === 'alarma' ? 'la alarma' : 'el recordatorio'} de las ${new Date(c.at).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })}.` }
      : { text: 'No hay alarmas ni recordatorios pendientes.', spoken: `No tiene nada programado, ${o.address}.` };
  }
  if (/(que tengo (hoy|manana|programado)|mi agenda|mis alarmas|mis recordatorios|agenda de hoy)/.test(t)) {
    const items = await upcoming(db, 48);
    return items.length ? { text: items.map(describe).join('\n'), spoken: `Tiene ${items.length === 1 ? 'una cosa' : `${items.length} cosas`} en la agenda. ${items.slice(0, 3).map(describe).join('. ')}.` }
      : { text: 'La agenda de las próximas 48 horas está vacía.', spoken: `Su agenda está libre, ${o.address}.` };
  }
  const p = parseAgenda(original);
  if (!p) return null;
  const item = await addAgenda(db, p);
  const d = describe(item);
  return { text: `Programado: ${d}. A esa hora abriré el universo y se lo diré en voz alta.`, spoken: `Hecho, ${o.address}. ${d.replace(/: Despertar$/, '')}.`, action: 'agenda_creada' };
}

// Llamadas por el iPhone vía el Mac, solo por orden directa del propietario.
async function phoneIntent(db: Db, t: string, original: string): Promise<Reply | null> {
  const o = await owner(db);
  const clean = original.replace(/^\W*((hey|oye|ey)\W+)?kratos\W*/i, '');
  const save = clean.match(/(?:guarda|anota|apunta|agrega|añade)\s+(?:el\s+)?(?:numero|número|telefono|teléfono|contacto)\s+(?:de\s+)?([^:,\d+]+?)[\s:,]+(?:es\s+)?(\+?[\d][\d\s().-]{6,})/i)
    ?? clean.match(/el\s+(?:numero|número|telefono|teléfono)\s+de\s+([^:,\d+]+?)\s+es\s+(\+?[\d][\d\s().-]{6,})/i);
  if (save) {
    try {
      const c = await saveContact(db, save[1], save[2]);
      return { text: `Contacto guardado: ${c.name} · ${c.phone}.`, spoken: `Guardado, ${o.address}. Ya puedo llamar a ${c.name}.` };
    } catch (e: any) { return { text: e.message, spoken: 'Ese número no parece válido.' }; }
  }
  const call = t.match(/^(?:por favor\s+)?(?:llama|llamame a|marca|marcale|haz una llamada)\s+(?:a\s+|al\s+)?(.+?)[.!?]*$/);
  if (!call) return null;
  const target = clean.match(/(?:llama|llámame a|llamame a|marca|márcale|marcale|haz una llamada)\s+(?:a\s+|al\s+)?(.+?)[.!?]*$/i)?.[1] ?? call[1];
  const r = await dial(db, target);
  if (!r.ok) return { text: r.error!, spoken: r.error! };
  const who = r.name ?? r.phone;
  return { text: `Llamando a ${who} desde tu iPhone. Pulsa «Llamar» en la ventana de FaceTime para confirmar.`, spoken: `Llamando a ${who}, ${o.address}. Confirme en la pantalla.`, action: 'llamada' };
}

// «Dame un reporte»: dinero invertido y ganado, trabajo hecho y decisiones pendientes, en voz y en el panel izquierdo.
async function reportIntent(db: Db, t: string): Promise<Reply | null> {
  if (!/\b(reporte|informe|balance|reporte financiero|como vamos de dinero|cuanto hemos (gastado|ganado|invertido))\b/.test(t)) return null;
  const r = await buildReport(db);
  const o = await owner(db);
  const text = `Invertido: ${r.money.investedUsd.toFixed(2)} USD de ${r.money.assignedUsd.toFixed(2)} asignados · IA (30 días): ${r.money.aiCost30dUsd.toFixed(2)} USD\n` +
    `Ingresos: ${r.money.earnedUsd === null ? 'sin ventas registradas' : r.money.earnedUsd.toFixed(2) + ' USD'}\n` +
    `Tareas: ${r.work.done7} completadas en 7 días, ${r.work.running} en curso, ${r.work.queued} en cola · Aprobaciones pendientes: ${r.approvals.length}`;
  return { text, spoken: spokenReport(r, o.address), action: 'reporte' };
}
