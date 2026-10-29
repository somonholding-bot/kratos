import { execFile } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Correo a través de la app Mail de este Mac (las cuentas que el propietario ya tiene configuradas).
// macOS pide permiso la primera vez («Kratos quiere controlar Mail»): el propietario decide.
// KRATOS lee remitente, asunto y fecha; solo crea BORRADORES visibles: enviar es siempre un clic del propietario.

function jxa(script: string, args: string[] = []): Promise<string> {
  if (process.env.KRATOS_DISABLE_AI === '1') return Promise.reject(new Error('Correo desactivado en pruebas'));
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 60_000 }, (err, out, errOut) =>
      err ? reject(new Error(/not allowed|-1743|no autorizado/i.test(errOut) ? 'Falta tu permiso: Ajustes del Sistema › Privacidad y seguridad › Automatización › node (servicio de KRATOS) › Mail' : (errOut || err.message).trim().slice(0, 200))) : resolve(out.trim()));
  });
}

export async function mailInbox(db: Db, limit = 10, unreadOnly = true) {
  const out = await jxa(`function run(argv) {
    const Mail = Application('Mail'); const n = Number(argv[0]); const unread = argv[1] === '1';
    const msgs = Mail.inbox.messages; const total = Math.min(msgs.length, 200); const res = [];
    for (let i = 0; i < total && res.length < n; i++) { const m = msgs[i]; if (unread && m.readStatus()) continue;
      res.push({ from: m.sender(), subject: m.subject(), date: m.dateReceived().toISOString(), read: m.readStatus() }); }
    return JSON.stringify({ unread: Mail.inbox.unreadCount(), messages: res });
  }`, [String(Math.min(30, limit)), unreadOnly ? '1' : '0']);
  await audit(db, 'kratos', 'correo.leido', { mensajes: limit });
  return JSON.parse(out) as { unread: number; messages: { from: string; subject: string; date: string; read: boolean }[] };
}

export async function mailDraft(db: Db, to: string, subject: string, body: string, by = 'propietario') {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Dirección de correo no válida');
  await jxa(`function run(argv) {
    const Mail = Application('Mail'); Mail.activate();
    const m = Mail.OutgoingMessage({ subject: argv[1], content: argv[2], visible: true });
    Mail.outgoingMessages.push(m); m.toRecipients.push(Mail.Recipient({ address: argv[0] }));
    return 'ok';
  }`, [to, subject.slice(0, 200), body.slice(0, 20_000)]);
  await audit(db, by, 'correo.borrador', { to: to.replace(/^(.).*@/, '$1…@'), subject: subject.slice(0, 80) });
  return { borrador: true, nota: 'Borrador abierto en Mail: el propietario lo revisa y pulsa Enviar' };
}
