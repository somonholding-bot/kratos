// Ingesta inicial de la biblioteca de Sol (Omega, etapa 4): registra las URLs citadas en las bibliotecas de conocimiento de Sol y en las guías.
// Cada URL se abre de verdad; solo las que responden quedan «verificada» (acceso = pagina: se abrió la página, no se leyó un libro entero).
// Uso: node scripts/sol/ingesta-fuentes.ts
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../../src/db.ts';
import { migrate } from '../../src/migrate.ts';
import { ROOT } from '../../src/config.ts';
import { addSource, libraryStats } from '../../src/core/omega.ts';

const ARCHIVOS: [string, string[]][] = [
  ['skills/sol/mente-humana-ciencia/SKILL.md', ['neurociencia', 'psicologia', 'sueño', 'conciencia', 'biohacking']],
  ['skills/sol/hipnosis-mentalismo-psicologia-profunda/SKILL.md', ['hipnosis', 'sugestion', 'mentalismo', 'psicologia profunda']],
  ['skills/sol/esoterismo-historia-y-misticismo/SKILL.md', ['esoterismo', 'hermetismo', 'alquimia', 'parapsicologia', 'simbolos']],
  ['skills/sol/narrativa-persuasion-etica-y-medicion/SKILL.md', ['narrativa', 'persuasion', 'audiencias', 'medicion']],
  ['docs/guia-atencion.md', ['atencion', 'retencion', 'youtube']],
  ['docs/guia-mentalismo-jung.md', ['mentalismo', 'jung', 'simbolos']],
];
const tipoDe = (u: string) => /wikipedia\.org|britannica\.com|plato\.stanford/.test(u) ? 'enciclopedia' : /ncbi\.nlm|doi\.org|nature\.com|pnas\.org|core\.ac\.uk|repec\.org|scilit|sciencedirect|frontiersin|plos/.test(u) ? 'articulo'
  : /cia\.gov|archives\.gov|\.gov\//.test(u) ? 'documento_oficial' : /support\.google|blog\.youtube/.test(u) ? 'documentacion_oficial' : 'web';

const db = createPool(); await migrate(db, () => {});
const urls = new Map<string, Set<string>>();
for (const [f, temas] of ARCHIVOS) {
  const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/https?:\/\/[^\s)>\]"'`|]+/g)) {
    let u = m[0].replace(/[.,;:]+$/, ''); if (u.includes('(') && !u.includes(')')) u += ')';   // enlaces de Wikipedia con paréntesis
    if (!urls.has(u)) urls.set(u, new Set()); temas.forEach((t) => urls.get(u)!.add(t));
  }
}
const lista = [...urls.entries()]; let ok = 0, mal = 0; const fallidas: string[] = [];
for (let i = 0; i < lista.length; i += 6) {
  await Promise.all(lista.slice(i, i + 6).map(async ([u, temas]) => {
    try {
      const r: any = await addSource(db, { url: u, titulo: undefined, tipo: tipoDe(u), temas: [...temas], acceso: 'pagina', notas: 'Citada en las bibliotecas de conocimiento de Sol (investigación del 4-nov-2026)' }, 'ingesta');
      if (r.verificada) ok++; else { mal++; fallidas.push(`${r.http_status} ${u}`); }
    } catch (e: any) {
      // sin título de página (bloqueada o caída): se registra con la propia URL como título, NO verificada
      try { await addSource(db, { url: u, titulo: u.slice(0, 200), tipo: tipoDe(u), temas: [...temas], notas: 'No se pudo abrir en la ingesta' }, 'ingesta', async () => ({ status: 0, title: null })); } catch { /* URL no válida */ }
      mal++; fallidas.push(`sin título ${u}`);
    }
  }));
}
console.log(JSON.stringify({ urls: lista.length, verificadas: ok, no_verificadas: mal, fallidas: fallidas.slice(0, 40), biblioteca: await libraryStats(db) }, null, 1));
await db.end();
