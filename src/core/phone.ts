import { execFile } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Llamadas desde el iPhone del propietario a través del Mac (Continuidad).
// KRATOS solo prepara la llamada cuando el propietario lo ordena; FaceTime muestra el botón «Llamar» y él confirma.
// Nunca llama por iniciativa propia: ni el ciclo del CEO ni los especialistas tienen esta herramienta.

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

// Mensaje de texto: abre Mensajes con el borrador listo (sale por el iPhone/iMessage); el propietario pulsa «Enviar».
export async function textMessage(db: Db, target: string, body: string, by = 'propietario'): Promise<{ ok: boolean; name?: string; phone?: string; error?: string }> {
  let name: string | undefined, phone = digits(target);
  if (phone.replace('+', '').length < 7) {
    const c = await findContact(db, target);
    if (!c) return { ok: false, error: `No tengo el número de «${target}». Dígame: «guarda el número de ${target}: …»` };
    name = c.name; phone = c.phone;
  }
  const text = body.trim().slice(0, 1000);
  await audit(db, by, 'mensaje.borrador', { name: name ?? null, phone: phone.slice(0, 4) + '…', chars: text.length });
  if (process.env.KRATOS_DISABLE_AI !== '1') execFile('/usr/bin/open', [`sms:${phone}&body=${encodeURIComponent(text)}`], () => {});
  return { ok: true, name, phone };
}
