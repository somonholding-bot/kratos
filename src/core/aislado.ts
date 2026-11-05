import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA_DIR } from '../config.ts';
import { SANDBOX } from './acd.ts';

// Ejecutor aislado genérico para código de investigación que no pertenece a una hipótesis ACD (p. ej. demostraciones del laboratorio C06).
// Mismo perfil de sandbox que ACD (sin red, sin escribir fuera de su carpeta, sin leer la carpeta personal, sin procesos hijos), mismos
// límites del núcleo (CPU y tamaño de archivo) y tiempo máximo. Sin credenciales: entorno mínimo. Carpeta nueva por ejecución.
const PY = () => process.env.KRATOS_ACD_PYTHON ?? path.join(DATA_DIR, 'acd', 'venv', 'bin', 'python');
export const sha256 = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');

export async function ejecutarAislado(codigo: string, carpetaBase: string, opts: { timeoutS?: number } = {}) {
  const py = PY();
  if (!fs.existsSync(py)) throw new Error(`No está el Python aislado (${py})`);
  if (!fs.existsSync('/usr/bin/sandbox-exec') || !fs.existsSync(SANDBOX)) throw new Error('Sin sandbox-exec o sin su perfil no se ejecuta nada');
  fs.mkdirSync(carpetaBase, { recursive: true });
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(carpetaBase), 'run-'));
  fs.writeFileSync(path.join(dir, 'modelo.py'), codigo);
  const pyReal = fs.realpathSync(py), venv = path.resolve(path.dirname(py), '..'), pyBase = path.resolve(path.dirname(pyReal), '..');
  const timeoutS = Math.min(300, Math.max(1, opts.timeoutS ?? 120));
  const args = ['-n', '19', '/usr/bin/sandbox-exec', '-f', SANDBOX, '-D', `DIR=${dir}`, '-D', `HOME_REAL=${fs.realpathSync(os.homedir())}`, '-D', `PYENV=${fs.realpathSync(venv)}`, '-D', `PYBASE=${pyBase}`, '-D', `PYREAL=${pyReal}`, py, '-I', '-B', 'modelo.py'];
  const cmd = ['/bin/sh', '-c', 'ulimit -t "$1" && ulimit -f "$2" && shift 2 && exec "$@"', 'aislado', String(timeoutS * 2 + 10), String(Math.ceil((50 * 1024 * 1024) / 512)), '/usr/bin/nice', ...args];
  const out = fs.openSync(path.join(dir, 'stdout.txt'), 'w'), err = fs.openSync(path.join(dir, 'stderr.txt'), 'w');
  const t0 = Date.now(); let agotado = false;
  const fin: { code: number | null; signal: string | null } = await new Promise((resolve) => {
    const ch = spawn(cmd[0], cmd.slice(1), { cwd: dir, detached: true, stdio: ['ignore', out, err],
      env: { HOME: dir, MPLCONFIGDIR: dir, TMPDIR: dir, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', VECLIB_MAXIMUM_THREADS: '1' } });
    const matar = () => { try { process.kill(-ch.pid!, 'SIGKILL'); } catch { try { ch.kill('SIGKILL'); } catch {} } };
    const reloj = setTimeout(() => { agotado = true; matar(); }, timeoutS * 1000);
    ch.on('error', () => { clearTimeout(reloj); resolve({ code: null, signal: 'error' }); });
    ch.on('exit', (code, signal) => { clearTimeout(reloj); matar(); resolve({ code, signal }); });
  });
  fs.closeSync(out); fs.closeSync(err);
  const f = path.join(dir, 'salida.json');
  let salida: any = null, estado: 'ok' | 'error' | 'timeout' = 'ok', detalle = 'ejecutado en el sandbox';
  const regular = (p: string) => { try { const s = fs.lstatSync(p); return s.isFile() && s.nlink === 1; } catch { return false; } };
  if (agotado) { estado = 'timeout'; detalle = `superó ${timeoutS} s`; }
  else if (fin.code !== 0) { estado = 'error'; detalle = `código ${fin.code ?? fin.signal}: ${fs.readFileSync(path.join(dir, 'stderr.txt'), 'utf8').slice(-600)}`; }
  else if (!regular(f)) { estado = 'error'; detalle = 'no hay salida.json regular'; }
  else { try { salida = JSON.parse(fs.readFileSync(f, 'utf8').slice(0, 5_000_000)); } catch { estado = 'error'; detalle = 'salida.json no es JSON'; } }
  return { estado, detalle, salida, carpeta: dir, duracion_ms: Date.now() - t0, sha256_codigo: sha256(codigo), sha256_salida: estado === 'ok' ? sha256(fs.readFileSync(f)) : null };
}
