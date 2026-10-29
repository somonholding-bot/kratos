import { execFile } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Llamadas y mensajes desde el iPhone del propietario a través del Mac (Continuidad).
// KRATOS solo llama o escribe cuando el propietario lo ordena; FaceTime muestra el botón «Llamar» y él confirma.
// Con autonomía amplia los mensajes se envían directamente por Mensajes; con autonomía estricta se abre un borrador.
// Nunca por iniciativa propia: ni el ciclo del CEO ni los especialistas tienen estas herramientas.

export const digits = (s: string) => s.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');

export async function saveContact(db: Db, name: string, phone: string, notes?: string) {
  const p = digits(phone);
  if (p.replace('+', '').length < 7) throw new Error('Número no válido');
  const r = (await db.query(`INSERT INTO contacts (name, phone, notes) VALUES ($1,$2,$3)
      ON CONFLICT (lower(name)) DO UPDATE SET phone = EXCLUDED.phone, notes = coalesce(EXCLUDED.notes, contacts.notes) RETURNING id, name, phone`,
    [name.trim().slice(0, 80), p, notes ?? null])).rows[0];
  await audit(db, 'propietario', 'contacto.guardado', { id: r.id, name: r.name });
  return r;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export async function findContact(db: Db, who: string) {
  const rows = (await db.query(`SELECT id, name, phone FROM contacts`)).rows;
  const w = norm(who);
  return rows.find((r) => norm(r.name) === w) ?? rows.find((r) => norm(r.name).startsWith(w) || w.startsWith(norm(r.name))) ?? null;
}

// Abre la llamada en FaceTime (sale por el iPhone si está enlazado). En pruebas no marca nada.
export async function dial(db: Db, target: string, by = 'propietario'): Promise<{ ok: boolean; name?: string; phone?: string; error?: string }> {
  let name: string | undefined, phone = digits(target);
  if (phone.replace('+', '').length < 7) {
    const c = await findContact(db, target);
    if (!c) return { ok: false, error: `No tengo el número de «${target}». Dígame: «guarda el número de ${target}: …»` };
    name = c.name; phone = c.phone;
  }
  await audit(db, by, 'llamada.preparada', { name: name ?? null, phone: phone.slice(0, 4) + '…' });
  if (process.env.KRATOS_DISABLE_AI !== '1') execFile('/usr/bin/open', [`tel:${phone}`], () => {});
  return { ok: true, name, phone };
}

// Envío directo con la app Mensajes: primero iMessage y, si no, SMS por el iPhone enlazado.
// macOS pide una vez el permiso «controlar Mensajes» (Automatización).
const SEND = `on run argv
  set phone to item 1 of argv
  set msg to item 2 of argv
  tell application "Messages"
    try
      send msg to participant phone of (1st account whose service type = iMessage)
      return "imessage"
    on error
      send msg to participant phone of (1st account whose service type = SMS)
      return "sms"
    end try
  end tell
end run`;
function sendWithMessages(phone: string, text: string): Promise<string> {
  return new Promise((resolve, reject) => execFile('/usr/bin/osascript', ['-e', SEND, phone, text], { timeout: 30_000 }, (err, out, errOut) =>
    err ? reject(new Error(/not allowed|-1743/i.test(errOut) ? 'Falta tu permiso: Ajustes del Sistema › Privacidad y seguridad › Automatización › node › Mensajes' : (errOut || err.message).trim().slice(0, 200))) : resolve(out.trim())));
}

// Mensaje de texto: con send = true lo envía; si no (o si el envío falla), abre Mensajes con el borrador listo.
export async function textMessage(db: Db, target: string, body: string, by = 'propietario', send = false): Promise<{ ok: boolean; sent?: boolean; via?: string; name?: string; phone?: string; error?: string }> {
  let name: string | undefined, phone = digits(target);
  if (phone.replace('+', '').length < 7) {
    const c = await findContact(db, target);
    if (!c) return { ok: false, error: `No tengo el número de «${target}». Dígame: «guarda el número de ${target}: …»` };
    name = c.name; phone = c.phone;
  }
  const text = body.trim().slice(0, 1000);
  if (send && process.env.KRATOS_DISABLE_AI !== '1') {
    try {
      const via = await sendWithMessages(phone, text);
      await audit(db, by, 'mensaje.enviado', { name: name ?? null, phone: phone.slice(0, 4) + '…', chars: text.length, via });
      return { ok: true, sent: true, via, name, phone };
    } catch (e: any) {
      await audit(db, by, 'mensaje.envio_fallido', { error: String(e.message).slice(0, 200) });   // se cae al borrador
    }
  }
  await audit(db, by, 'mensaje.borrador', { name: name ?? null, phone: phone.slice(0, 4) + '…', chars: text.length });
  if (process.env.KRATOS_DISABLE_AI !== '1') execFile('/usr/bin/open', [`sms:${phone}&body=${encodeURIComponent(text)}`], () => {});
  return { ok: true, sent: false, name, phone };
}
