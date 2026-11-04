// Cadena final de la fábrica: título ≤ 60, capítulos desde 0:00 y descripción con fuentes, sin tocar YouTube.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeta, chapters, pickTitle } from '../src/core/cadena.ts';
import { publicTextProblem } from '../src/core/fabrica.ts';

const frases = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Sentence number ${i} about dreams and the moon.`, start: i * 14 }));

test('título: el primero que cabe en 60 caracteres, o el primero cortado en palabra', () => {
  assert.equal(pickTitle(['x'.repeat(70), 'Short title here']), 'Short title here');
  const t = pickTitle(['This is an extremely long title that keeps going well past sixty characters']);
  assert.ok(t.length <= 60 && !t.endsWith(' '));
});

test('capítulos: empiezan en 0:00, son ≥ 3 y están separados al menos 10 s', () => {
  const c = chapters(frases(40));
  assert.ok(c.length >= 3 && c[0].startsWith('0:00 '));
  const segs = c.map((l) => { const [m, s] = l.split(' ')[0].split(':').map(Number); return m * 60 + s; });
  assert.ok(segs.every((v, i) => i === 0 || v - segs[i - 1] >= 10));
  assert.deepEqual(chapters(frases(2)), []);
});

test('descripción: introducción, capítulos y fuentes, sin mencionar apps ni español', () => {
  const m = buildMeta({ titulo: 'Lucid Dreaming for Beginners', descripcion: 'What the data says.\n\nMore text', fuentes: ['Aspy 2017 — https://doi.org/10.1037/drm0000059'], etiquetas: ['lucid dreaming', 'lucid dreaming', 'dream journal'] }, frases(40));
  assert.match(m.descripcion, /^What the data says\./);
  assert.match(m.descripcion, /0:00 /);
  assert.match(m.descripcion, /Sources and further reading:\n• Aspy/);
  assert.deepEqual(m.etiquetas, ['lucid dreaming', 'dream journal']);
  assert.equal(publicTextProblem(m.titulo, m.descripcion, m.etiquetas.join(', ')), null);
});
