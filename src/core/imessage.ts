import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { recordIncoming } from './inbox.ts';
import { logFault } from './bitacora.ts';
import { digits } from './phone.ts';

// Vigilante de mensajes de texto: cada 2 s mira si llegó un iMessage o SMS nuevo a la app Mensajes del Mac
// (la base ~/Library/Messages/chat.db, en solo lectura) y lo deja en cola para que la app lo diga en voz alta.
// Requiere que el propietario dé «Acceso total al disco» a node (el servicio de KRATOS). Solo mensajes nuevos:
// la primera vez se marca el último existente y no se lee el historial.

const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const AB_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'AddressBook');

export type Announcement = { id: number; kind: 'mensaje'; spoken: string };
const queue: Announcement[] = [];
export const takeAnnouncements = () => queue.splice(0, queue.length);
export const watcherStatus: { state: 'apagado' | 'activo' | 'sin_permiso' | 'error'; detail?: string; lastAt?: string } = { state: 'apagado' };

// Desde Ventura el texto suele venir en attributedBody (NSAttributedString en formato typedstream):
// tras «NSString» hay 5 bytes de cabecera, la longitud (1 byte, o 0x81 + 2 bytes) y el texto UTF-8.
export function attributedText(blob: Uint8Array | null | undefined): string | null {
  if (!blob?.length) return null;
  const buf = Buffer.from(blob);
  const at = buf.indexOf('NSString');
  if (at < 0) return null;
  let i = at + 'NSString'.length + 5;
  if (i >= buf.length) return null;
  let len = buf[i++];
  if (len === 0x81) { len = buf.readUInt16LE(i); i += 2; }
  else if (len === 0x82) { len = buf.readUInt32LE(i); i += 4; }
  if (i + len > buf.length) return null;
  return buf.subarray(i, i + len).toString('utf8');
}

// Nombres de Contactos de macOS por los últimos 10 dígitos o por el correo (se recarga cada 10 minutos)
let names: { at: number; map: Map<string, string> } = { at: 0, map: new Map() };
const key = (handle: string) => handle.includes('@') ? handle.toLowerCase() : digits(handle).replace('+', '').slice(-10);
async function contactNames(): Promise<Map<string, string>> {
  if (Date.now() - names.at < 600_000) return names.map;
  const map = new Map<string, string>();
  const { DatabaseSync } = await import('node:sqlite');
  const files = [path.join(AB_DIR, 'AddressBook-v22.abcddb')];
  try { for (const s of fs.readdirSync(path.join(AB_DIR, 'Sources'))) files.push(path.join(AB_DIR, 'Sources', s, 'AddressBook-v22.abcddb')); } catch {}
  for (const f of files.filter((f) => fs.existsSync(f))) {
    try {
      const ab = new DatabaseSync(f, { readOnly: true });
      const rows = ab.prepare(`SELECT trim(coalesce(r.ZFIRSTNAME,'') || ' ' || coalesce(r.ZLASTNAME,'')) AS name, r.ZORGANIZATION AS org, p.ZFULLNUMBER AS v FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
        UNION ALL SELECT trim(coalesce(r.ZFIRSTNAME,'') || ' ' || coalesce(r.ZLASTNAME,'')), r.ZORGANIZATION, e.ZADDRESS FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK`).all() as any[];
      for (const r of rows) { const n = r.name || r.org; if (n && r.v) map.set(key(String(r.v)), String(n)); }
      ab.close();
    } catch { /* una fuente ilegible no impide las demás */ }
  }
  names = { at: Date.now(), map };
  return map;
}

export function startMessageWatcher(db: Db) {
  if (process.platform !== 'darwin' || process.env.KRATOS_DISABLE_AI === '1') return;
  let chat: any = null, last = -1, nextOpen = 0, busy = false, seq = 0;
  const tick = async () => {
    if (busy || Date.now() < nextOpen) return;
    busy = true;
    try {
      if (!chat) {
        const { DatabaseSync } = await import('node:sqlite');
        chat = new DatabaseSync(CHAT_DB, { readOnly: true });
        const saved = (await db.query(`SELECT value FROM system_state WHERE key = 'sms_last_rowid'`)).rows[0]?.value;
        const max = Number((chat.prepare('SELECT max(ROWID) AS m FROM message').get() as any)?.m ?? 0);
        last = Number.isFinite(Number(saved)) && Number(saved) > 0 && Number(saved) <= max ? Number(saved) : max;   // primera vez: solo lo nuevo
        watcherStatus.state = 'activo'; watcherStatus.detail = undefined;
      }
      const rows = chat.prepare(`SELECT m.ROWID AS rowid, m.text, m.attributedBody AS body, m.service, m.cache_has_attachments AS att, h.id AS sender
        FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.item_type = 0 AND coalesce(m.associated_message_type, 0) = 0
        ORDER BY m.ROWID LIMIT 20`).all(last) as any[];
      if (!rows.length) return;
      const book = await contactNames().catch(() => new Map<string, string>());
      for (const r of rows) {
        last = Number(r.rowid);
        const text = (r.text || attributedText(r.body) || '').replace(/￼/g, '').trim() || (r.att ? '(te envió una foto o un archivo)' : '');
        if (!text || !r.sender) continue;
        const said = await recordIncoming(db, { rowid: last, from: String(r.sender), name: book.get(key(String(r.sender))) ?? null, text, service: r.service ?? undefined });
        if (said.spoken) { queue.push({ id: ++seq, kind: 'mensaje', spoken: said.spoken }); watcherStatus.lastAt = new Date().toISOString(); }
      }
      await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('sms_last_rowid', $1, 'mensajes')
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify(last)]);
    } catch (e: any) {
      chat = null; nextOpen = Date.now() + 60_000;   // sin permiso o base ocupada: se reintenta en 1 minuto
      const denied = /authoriz|not permitted|EPERM|unable to open/i.test(String(e?.message));
      if (watcherStatus.state !== (denied ? 'sin_permiso' : 'error')) logFault(db, 'mensajes', 'aviso', denied ? 'Sin Acceso total al disco para leer Mensajes' : String(e?.message ?? e)).catch(() => {});
      watcherStatus.state = denied ? 'sin_permiso' : 'error';
      watcherStatus.detail = denied ? 'Ajustes del Sistema › Privacidad y seguridad › Acceso total al disco › añade node (' + process.execPath + ')' : String(e?.message ?? e).slice(0, 200);
    } finally { busy = false; }
  };
  setInterval(tick, 2_000);
  tick();
}
