import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

// Sesión local: un token largo vive en .jarvis/session-token (permisos 600).
// Para entrar, `npm run open` crea un código de un solo uso que caduca en 2 minutos.

const TOKEN_FILE = path.join(DATA_DIR, 'session-token');
const CODE_FILE = path.join(DATA_DIR, 'login-code');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function sessionToken(): string {
  ensureDir();
  if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

export function issueLoginCode(): string {
  ensureDir();
  const code = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(CODE_FILE, JSON.stringify({ code, expires: Date.now() + 120_000 }), { mode: 0o600 });
  return code;
}

export function consumeLoginCode(code: string): boolean {
  try {
    const saved = JSON.parse(fs.readFileSync(CODE_FILE, 'utf8'));
    fs.rmSync(CODE_FILE, { force: true });
    return saved.expires > Date.now() && safeEqual(saved.code, code);
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Acceso remoto (opcional): enlace propio por un túnel cifrado de Cloudflare hacia este Mac.
// .jarvis/remote.json guarda el dominio público y el hash scrypt de la clave remota; la clave nunca se guarda en claro.
const REMOTE_FILE = path.join(DATA_DIR, 'remote.json');
type Remote = { host: string; salt: string; hash: string };
export function remoteConfig(): Remote | null {
  try { const r = JSON.parse(fs.readFileSync(REMOTE_FILE, 'utf8')); return r.host && r.salt && r.hash ? r : null; } catch { return null; }
}
export function setRemote(host: string, passphrase: string) {
  if (passphrase.length < 10) throw new Error('La clave remota debe tener al menos 10 caracteres');
  ensureDir();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passphrase, salt, 64).toString('hex');
  fs.writeFileSync(REMOTE_FILE, JSON.stringify({ host, salt, hash }), { mode: 0o600 });
}
const tries: number[] = [];
export function checkRemotePassphrase(passphrase: string): boolean | 'bloqueado' {
  const r = remoteConfig();
  if (!r) return false;
  const now = Date.now();
  while (tries.length && now - tries[0] > 15 * 60_000) tries.shift();
  if (tries.length >= 5) return 'bloqueado';   // 5 intentos fallidos cada 15 minutos
  const ok = safeEqual(crypto.scryptSync(passphrase.slice(0, 200), r.salt, 64).toString('hex'), r.hash);
  if (!ok) tries.push(now);
  return ok;
}
