import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Agenda de KRATOS: alarmas, recordatorios y eventos.
// A su hora, la app nativa reclama los avisos vencidos (/api/agenda/claim), abre el universo y los dice en voz alta.

export type Owner = { name: string; address: string };
export type AgendaItem = { id: number; at: Date; kind: string; text: string; repeat: string | null };

export async function owner(db: Db): Promise<Owner> {
  const v = (await db.query(`SELECT value FROM system_state WHERE key = 'owner'`)).rows[0]?.value;
  return { name: v?.name ?? 'propietario', address: v?.address ?? 'señor' };
}

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const part = (d = new Date()) => (d.getHours() < 6 ? 'noches' : d.getHours() < 12 ? 'días' : d.getHours() < 20 ? 'tardes' : 'noches');
export const hhmm = (d: Date) => d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });

// Bienvenida al oír «Hey Kratos» sin orden detrás
export async function greeting(db: Db): Promise<string> {
  const o = await owner(db);
  const today = new Date().toDateString();
  const last = (await db.query(`SELECT value FROM system_state WHERE key = 'last_greeting'`)).rows[0]?.value;
  if (last === today) return pick(['Dígame.', 'Le escucho.', 'Aquí estoy.', '¿Sí?', 'Adelante.']);   // ya saludó hoy: sin nombre
  await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('last_greeting', $1, 'kratos')
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify(today)]);
  const h = new Date().getHours();
  return h < 12 ? `Buenos días, señor ${o.name}. Dígame.` : h < 20 ? `¿Qué tal, ${o.name}? Dígame.` : `Buenas noches, ${o.name}. Dígame.`;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const NUM: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };

// Interpreta en español «despiértame a las 8», «recuérdame a las 3 y media de la tarde llamar a Ana», «alarma todos los días a las 7:30».
export function parseAgenda(raw: string, now = new Date()): { at: Date; kind: 'alarma' | 'recordatorio'; text: string; repeat: 'diaria' | 'laborables' | null } | null {
  const t = norm(raw);
  const alarm = /\b(despiertame|despiertame|levantame|alarma|pon(me)? (una )?alarma)\b/.test(t);
  const remind = /\b(recuerdame|recordarme|avisame|hablame)\b/.test(t);
  if (!alarm && !remind) return null;
  const m = t.match(/a las? (\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:[:.](\d{2})| y (media|cuarto)| (?:con )?(\d{1,2}) minutos?)?\s*(de la manana|de la tarde|de la noche|de la madrugada|am|a\.?m\.?|pm|p\.?m\.?)?/);
  const rel = t.match(/en (\d{1,3}) (minutos?|horas?)/);
  let at: Date;
  if (m) {
    let h = Number(m[1]) || NUM[m[1]] || 0;
    const min = m[2] ? Number(m[2]) : m[3] === 'media' ? 30 : m[3] === 'cuarto' ? 15 : m[4] ? Number(m[4]) : 0;
    const ap = m[5] ?? '';
    if (/tarde|noche|pm|p\.?m/.test(ap) && h < 12) h += 12;
    if (/manana|madrugada|am|a\.?m/.test(ap) && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    at = new Date(now); at.setHours(h, min, 0, 0);
    // sin «de la mañana/tarde»: la próxima vez que llegue esa hora (8 → 8:00 o 20:00)
    if (!ap && h < 12 && at <= now) { const pm = new Date(at); pm.setHours(h + 12); if (pm > now && !alarm) at = pm; }
    if (/\bpasado manana\b/.test(t)) at.setDate(at.getDate() + 2);
    else if (/\bmanana\b/.test(t.replace(/de la manana/g, ''))) at.setDate(at.getDate() + 1);
    else if (at <= now) at.setDate(at.getDate() + 1);
  } else if (rel) {
    at = new Date(now.getTime() + Number(rel[1]) * (rel[2].startsWith('hora') ? 3_600_000 : 60_000));
  } else return null;
  const repeat = /todos los dias|cada dia|diario|diariamente/.test(t) ? 'diaria' : /entre semana|dias laborables|de lunes a viernes/.test(t) ? 'laborables' : null;
  // Texto del recordatorio: lo que va después de «que», o lo que queda tras quitar la hora
  const original = raw.replace(/^\W*((hey|oye|ey)\W+)?kratos\W*/i, '').trim();
  const que = original.match(/\b(?:que|para)\s+(.+)$/i)?.[1];
  let text = (que ?? original)
    .replace(/\b(despiértame|despiertame|levántame|levantame|recuérdame|recuerdame|avísame|avisame|háblame|hablame|pon(me)? (una )?alarma)\b/gi, '')
    .replace(/a las? \S+( y (media|cuarto)| con \d+ minutos?)?( de la (mañana|manana|tarde|noche|madrugada)| [ap]\.?m\.?)?/gi, '')
    .replace(/\b(pasado )?mañana\b|\btodos los días\b|\bcada día\b|\ben \d+ (minutos?|horas?)\b/gi, '')
    .replace(/\s+/g, ' ').replace(/^[\s,.:]+|[\s,.:]+$/g, '');
  if (alarm && !text) text = 'Despertar';
  if (!text) text = 'Recordatorio';
  return { at, kind: alarm ? 'alarma' : 'recordatorio', text: text.slice(0, 300), repeat };
}

export async function addAgenda(db: Db, i: { at: Date; kind: string; text: string; repeat?: string | null }, by = 'propietario'): Promise<AgendaItem> {
  const r = (await db.query(`INSERT INTO agenda (at, kind, text, repeat, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, at, kind, text, repeat`,
    [i.at, i.kind, i.text.slice(0, 300), i.repeat ?? null, by])).rows[0];
  await audit(db, by, 'agenda.creada', { id: r.id, at: r.at, kind: r.kind, repeat: r.repeat });
  return r;
}

export async function upcoming(db: Db, hours = 36): Promise<AgendaItem[]> {
  return (await db.query(`SELECT id, at, kind, text, repeat FROM agenda WHERE status = 'pendiente' AND at < now() + make_interval(hours => $1) ORDER BY at LIMIT 20`, [hours])).rows;
}

export async function cancelAgenda(db: Db, id?: number, kind?: string): Promise<AgendaItem | null> {
  const r = (await db.query(`UPDATE agenda SET status = 'cancelada' WHERE id = (
      SELECT id FROM agenda WHERE status = 'pendiente' AND ($1::int IS NULL OR id = $1) AND ($2::text IS NULL OR kind = $2) ORDER BY at LIMIT 1)
    RETURNING id, at, kind, text, repeat`, [id ?? null, kind ?? null])).rows[0] ?? null;
  if (r) await audit(db, 'propietario', 'agenda.cancelada', { id: r.id });
  return r;
}

const when = (d: Date) => {
  const today = new Date(); const tom = new Date(); tom.setDate(tom.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'hoy' : d.toDateString() === tom.toDateString() ? 'mañana' : d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
  return `${day} a las ${hhmm(d)}`;
};
export const describe = (i: AgendaItem) => `${i.kind === 'alarma' ? 'Alarma' : i.kind === 'evento' ? 'Evento' : 'Recordatorio'} ${when(new Date(i.at))}${i.repeat ? ` (${i.repeat})` : ''}: ${i.text}`;

function nextOccurrence(at: Date, repeat: string): Date {
  const n = new Date(at);
  do {
    n.setDate(n.getDate() + (repeat === 'semanal' ? 7 : 1));
  } while (repeat === 'laborables' && (n.getDay() === 0 || n.getDay() === 6) || n <= new Date());
  return n;
}

// Lo que KRATOS dice cuando llega la hora
async function speech(db: Db, i: AgendaItem): Promise<string> {
  const o = await owner(db);
  const now = new Date();
  if (i.kind === 'alarma') {
    const rest = (await upcoming(db, 16)).filter((x) => x.id !== i.id && new Date(x.at).toDateString() === now.toDateString());
    const pend = (await db.query(`SELECT count(*)::int AS n FROM approvals WHERE status = 'pendiente'`)).rows[0].n;
    const day = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    const lines = [`Buenos ${part(now) === 'días' ? 'días' : part(now) === 'tardes' ? 'tardes' : 'noches'}, ${now.getHours() < 12 ? `señor ${o.name}` : o.name}. Son las ${hhmm(now)}, ${day}.`];
    if (i.text && !/^despertar$/i.test(i.text)) lines.push(`Es hora de: ${i.text}.`);
    lines.push(rest.length ? `Hoy tiene ${rest.length === 1 ? 'una cosa' : `${rest.length} cosas`} en la agenda: ${rest.map((x) => `a las ${hhmm(new Date(x.at))}, ${x.text}`).join('; ')}.` : 'No tiene nada más en la agenda de hoy.');
    if (pend) lines.push(`Tiene ${pend} ${pend === 1 ? 'aprobación pendiente' : 'aprobaciones pendientes'} en el panel.`);
    lines.push('Vamos a por el día.');
    return lines.join(' ');
  }
  if (i.kind === 'aviso') return `${o.address.charAt(0).toUpperCase() + o.address.slice(1)}, ${i.text}`;
  return `${o.address.charAt(0).toUpperCase() + o.address.slice(1)}, le recuerdo: ${i.text}.`;
}

// La app nativa reclama los avisos vencidos: cada uno se entrega una sola vez (las repeticiones se reprograman).
export async function claimDue(db: Db): Promise<{ id: number; kind: string; spoken: string }[]> {
  const due: AgendaItem[] = (await db.query(`UPDATE agenda SET status = 'dada', delivered_at = now()
      WHERE id IN (SELECT id FROM agenda WHERE status = 'pendiente' AND at <= now() ORDER BY at FOR UPDATE SKIP LOCKED LIMIT 5)
      RETURNING id, at, kind, text, repeat`)).rows;
  const out = [];
  for (const i of due.sort((a, b) => +new Date(a.at) - +new Date(b.at))) {
    // Un aviso de hace más de 6 horas (Mac apagado) no se dice como si fuera ahora
    const late = Date.now() - +new Date(i.at) > 6 * 3_600_000;
    if (i.repeat) await addAgenda(db, { at: nextOccurrence(new Date(i.at), i.repeat), kind: i.kind, text: i.text, repeat: i.repeat }, 'agenda (repetición)');
    if (!late) out.push({ id: i.id, kind: i.kind, spoken: await speech(db, i) });
  }
  return out;
}
