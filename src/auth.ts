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
