// Páginas web de KRATOS: plantilla honesta, publicación por la API de GitHub (simulada) y reglas de contenido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { publicarPagina, plantilla } from '../src/core/paginas.ts';

let db: Db; const llamadas: string[][] = []; const cuerpos: string[] = [];
const g = async (args: string[], input?: string) => {
  llamadas.push(args); if (input) cuerpos.push(input);
  if (args[1]?.endsWith('/pages')) return '';
  if (args[0] === 'api' && args.length === 4 && args[2] === '--jq') throw new Error('Not Found');   // ni repo ni archivo existen
  return '{}';
};
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM paginas_web WHERE slug LIKE 'prueba-%'`); });
after(async () => { await db.query(`DELETE FROM paginas_web WHERE slug LIKE 'prueba-%'`); await db.end(); });

const base = { slug: 'Prueba Guía 7 Noches', titulo: 'Guía de 7 noches', subtitulo: 'Un programa sencillo para recordar tus sueños', puntos: ['7 audios guiados', 'Diario descargable'], cta_texto: 'Reservar', cta_url: 'https://buy.stripe.com/test_1', precio: '29 USD', preventa: true };
test('la plantilla escapa el texto y marca la preventa', () => {
  const h = plantilla({ ...base, titulo: '<script>x</script>' });
  assert.doesNotMatch(h, /<script>x/); assert.match(h, /PREVENTA/); assert.match(h, /buy\.stripe\.com/);
});
test('publica por la API de GitHub (crea el repo la primera vez) y guarda la URL', async () => {
  const r = await publicarPagina(db, base, 'agente:jupiter', g);
  assert.match(r.url, /github\.io\/kratos-paginas\/prueba-gu-a-7-noches\/$/);
  assert.ok(llamadas.some((a) => a.includes('user/repos'))); assert.ok(llamadas.some((a) => a.includes('PUT') && a.some((x) => x.includes('contents/prueba-gu-a-7-noches/index.html'))));
  assert.match(Buffer.from(JSON.parse(cuerpos.at(-1)!).content, 'base64').toString(), /Guía de 7 noches/);
});
test('rechaza promesas imposibles, enlaces no https y páginas sin contenido concreto', async () => {
  await assert.rejects(publicarPagina(db, { ...base, subtitulo: 'Resultados garantizados en una noche' }, 'agente:jupiter', g), /garantizar/);
  await assert.rejects(publicarPagina(db, { ...base, cta_url: 'http://x.com' }, 'agente:jupiter', g), /https/);
  await assert.rejects(publicarPagina(db, { ...base, puntos: ['uno'] }, 'agente:jupiter', g), /2 puntos/);
});
