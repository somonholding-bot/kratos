import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Bóveda de Obsidian de Kratos: Markdown normal, legible y editable por ti en Obsidian.
// Kratos solo lee y escribe dentro de esta carpeta.
export const VAULT = process.env.KRATOS_VAULT ?? path.join(os.homedir(), 'Documents', 'Kratos');
const FOLDERS = ['Diario', 'Negocios', 'Notas', 'Tareas'];

export function ensureVault() {
  for (const f of FOLDERS) fs.mkdirSync(path.join(VAULT, f), { recursive: true });
  const readme = path.join(VAULT, 'Kratos.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, `# Kratos\n\nEsta bóveda es la memoria escrita de Kratos.\n\n- **Diario/**: un resumen por día de lo que hizo.\n- **Negocios/**: expedientes de cada negocio y producto.\n- **Notas/**: notas que Kratos guarda cuando se lo pides o cuando aprende algo útil.\n- **Tareas/**: seguimiento de tareas importantes.\n\nPuedes escribir tus propias notas aquí; Kratos podrá buscarlas. No guardes contraseñas ni claves.\n`);
  }
}

function inside(p: string) {
  const full = path.resolve(VAULT, p);
  if (!full.startsWith(path.resolve(VAULT) + path.sep)) throw new Error('Ruta fuera de la bóveda');
  return full;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Nota';

export function writeNote(folder: string, title: string, body: string, meta: Record<string, string> = {}): string {
  ensureVault();
  const dir = FOLDERS.includes(folder) ? folder : 'Notas';
  const rel = path.join(dir, `${safeName(title)}.md`);
  const fm = Object.entries({ creado: new Date().toISOString(), autor: 'Kratos', ...meta }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(inside(rel), `---\n${fm}\n---\n\n# ${title}\n\n${body.trim()}\n`);
  return rel;
}

export function appendDaily(text: string, date = new Date()): string {
  ensureVault();
  const day = date.toISOString().slice(0, 10);
  const rel = path.join('Diario', `${day}.md`);
  const file = inside(rel);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `---\nfecha: "${day}"\nautor: "Kratos"\n---\n\n# Diario ${day}\n`);
  fs.appendFileSync(file, `\n- ${date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · ${text.replace(/\n+/g, ' ')}`);
  return rel;
}

export function searchNotes(query: string, limit = 5): { path: string; snippet: string }[] {
  ensureVault();
  const terms = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter((t) => t.length > 2);
  const out: { path: string; snippet: string; score: number }[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.md') && fs.statSync(p).size < 500_000) {
        const text = fs.readFileSync(p, 'utf8');
        const flat = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const score = terms.reduce((s, t) => s + (flat.includes(t) ? 1 : 0), 0);
        if (score) {
          const i = Math.max(0, flat.indexOf(terms.find((t) => flat.includes(t))!) - 120);
          out.push({ path: path.relative(VAULT, p), snippet: text.slice(i, i + 400).replace(/\s+/g, ' '), score });
        }
      }
    }
  };
  walk(VAULT);
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ path: p, snippet }) => ({ path: p, snippet }));
}

export function readNote(rel: string): string {
  const file = inside(rel);
  if (!file.endsWith('.md')) throw new Error('Solo notas .md');
  return fs.readFileSync(file, 'utf8').slice(0, 20_000);
}
