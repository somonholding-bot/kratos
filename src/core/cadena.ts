import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { requestApproval } from './approvals.ts';
import { carpeta, EPISODIO_DIR, mediaPython, productionRunning, publicTextProblem, runQa, uploadPrivate } from './fabrica.ts';

// Cadena final de la fábrica, en código y sin IA: vídeo renderizado → miniatura → puerta de calidad → subida PRIVADA → petición de aprobación.
// El CEO solo la supervisa. Publicar en abierto sigue exigiendo la aprobación de la propietaria en el panel.
const LEAD = 0.5;
const MAX_ERRORES = 3;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Título ≤ 60 caracteres: el primero de los candidatos que cabe; si ninguno cabe, el primero cortado en límite de palabra.
export function pickTitle(titulos: string[]): string {
  const ok = titulos.find((t) => t && t.length <= 60);
  if (ok) return ok;
  const t = String(titulos[0] ?? '').slice(0, 60);
  return t.includes(' ') ? t.slice(0, t.lastIndexOf(' ')) : t;
}

// Capítulos desde 0:00 (YouTube exige ≥ 3, el primero en 0:00 y ≥ 10 s entre ellos), repartidos por las frases del guion.
export function chapters(sentences: { text: string; start: number }[], n = 8): string[] {
  if (sentences.length < 3) return [];
  const out: string[] = []; let last = -99;
  const k = Math.min(n, sentences.length);
  for (let i = 0; i < k; i++) {
    const s = sentences[Math.min(sentences.length - 1, Math.round((i * sentences.length) / k))];
    const t = i === 0 ? 0 : LEAD + s.start - 0.1;
    if (t - last < 10) continue;
    const name = s.text.replace(/[^\p{L}\p{N}' ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    out.push(`${mmss(t)} ${name.charAt(0).toUpperCase()}${name.slice(1)}`); last = t;
  }
  return out.length >= 3 ? out : [];
}

export function buildMeta(p: any, sentences: { text: string; start: number }[]) {
  const titulos: string[] = [...(p.titulos ?? []), p.titulo].filter(Boolean);
  const caps = chapters(sentences);
  const fuentes: string[] = p.fuentes ?? [];
  const intro = String(p.descripcion ?? '').split('\n\n')[0].trim() || `${pickTitle(titulos)}.`;
  const descripcion = [intro, caps.join('\n'), fuentes.length ? `Sources and further reading:\n${fuentes.map((f) => `• ${f}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  const etiquetas = [...new Set<string>((p.etiquetas ?? []).map((e: string) => String(e).trim()).filter(Boolean))].slice(0, 15);
  return { titulo: pickTitle(titulos), descripcion, etiquetas, capitulos: caps.length };
}

async function paqueteDe(db: Db, q: any) {
  const r = (await db.query(`SELECT result->'extraido'->'paquete' AS p FROM tasks WHERE owner_function = 'venus' AND status = 'completada' AND result->'extraido'->'paquete'->>'titulo' = $1 ORDER BY id DESC LIMIT 1`, [q.titulo])).rows[0];
  return r?.p ?? null;
}

// Miniatura propia 16:9: un escenario del propio episodio + 2-4 palabras grandes (texto sacado de la idea de miniatura de Venus).
async function crearMiniatura(db: Db, q: any, p: any) {
  const dir = carpeta(q.id), esc = path.join(dir, 'escenarios');
  const fondo = fs.existsSync(esc) ? fs.readdirSync(esc).filter((f) => /\.png$/i.test(f)).sort().map((f) => path.join(esc, f))[0] : undefined;
  if (!fondo) throw new Error('No hay escenarios del episodio para hacer la miniatura');
  const idea = String((p?.miniaturas ?? [])[0] ?? ''), m = /text:\s*(.+)$/i.exec(idea);
  const texto = (m ? m[1] : String(q.titulo).split(':').pop() ?? q.titulo).replace(/["“”]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
  const out = path.join(dir, 'miniatura.jpg');
  const r = spawnSync(mediaPython()!, [path.join(EPISODIO_DIR, '../miniatura.py'), fondo, texto, out], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`No pude crear la miniatura: ${(r.stderr || r.stdout).slice(-300)}`);
  await db.query(`UPDATE content_queue SET miniatura_ruta = $2, updated_at = now() WHERE id = $1`, [q.id, out]);
  return out;
}

const aviso = (db: Db, text: string, actor: string) => db.query(`INSERT INTO agenda (at, kind, text, created_by) VALUES (now(), 'aviso', $1, $2)`, [text, actor]);

async function pedirAprobacion(db: Db, q: any, actor: string) {
  const dup = (await db.query(`SELECT 1 FROM approvals WHERE scope->>'tipo' = 'youtube_publicar' AND scope->>'video_id' = $1 AND status IN ('pendiente','aprobada','ejecutada') LIMIT 1`, [q.youtube_id])).rows[0];
  if (dup) return null;
  const a = await requestApproval(db, { kind: 'publicacion', description: `Publicar en YouTube: «${String(q.titulo).slice(0, 100)}» (https://youtu.be/${q.youtube_id}) como público. Ya pasó la puerta de calidad y está en privado con miniatura: míralo y apruébalo.`,
    scope: { tipo: 'youtube_publicar', video_id: String(q.youtube_id), visibilidad: 'public' }, validDays: 14, requestedBy: 'cadena' });
  await aviso(db, `El vídeo «${String(q.titulo).slice(0, 60)}» está listo en privado. Falta tu aprobación para publicarlo.`, actor);
  await audit(db, actor, 'cadena.aprobacion_pedida', { cola: q.id, video: q.youtube_id, aprobacion: a.id });
  return a.id;
}

// Un paso por elemento y vuelta; los fallos se cuentan en la auditoría y, al tercero, se avisa a la propietaria.
export async function advanceChain(db: Db, actor = 'cadena') {
  const vivo = productionRunning();
  const items = (await db.query(`SELECT * FROM content_queue WHERE tipo = 'largo' AND video_ruta IS NOT NULL AND estado IN ('PRODUCTION','QA') ORDER BY sale_el NULLS LAST, id`)).rows
    .filter((q: any) => q.id !== vivo?.id);
  const hechos: string[] = [];
  for (const q of items) {
    const errores = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'cadena.error' AND (details->>'cola')::int = $1`, [q.id])).rows[0].n;
    if (errores >= MAX_ERRORES) continue;
    try {
      const p = await paqueteDe(db, q);
      if (q.estado === 'PRODUCTION') {
        if (!q.miniatura_ruta) await crearMiniatura(db, q, p);
        const r = await runQa(db, q.id);
        if (r.resultado === 'BLOQUEADO') { await aviso(db, `El vídeo «${String(q.titulo).slice(0, 50)}» no pasó la puerta de calidad: ${(r.fallos ?? []).join('; ').slice(0, 200)}`, actor); hechos.push(`${q.id}: QA bloqueado`); continue; }
        hechos.push(`${q.id}: QA ok`);
        q.estado = 'QA';
      }
      if (q.estado === 'QA' && !q.youtube_id) {
        if (!p) throw new Error('No encuentro el paquete de Venus de este vídeo (título, descripción, etiquetas)');
        const tl = JSON.parse(fs.readFileSync(path.join(carpeta(q.id), 'timeline.json'), 'utf8'));
        const meta = buildMeta(p, tl.sentences);
        const prob = publicTextProblem(meta.titulo, meta.descripcion, meta.etiquetas.join(', ')); if (prob) throw new Error(prob);
        if (meta.capitulos < 3) throw new Error('No salen 3 capítulos desde 0:00');
        const up = await uploadPrivate(db, q.id, meta, actor);
        q.youtube_id = up.id; q.titulo = meta.titulo; hechos.push(`${q.id}: subido privado`);
      }
      if (q.estado === 'QA' && q.youtube_id) { if (await pedirAprobacion(db, q, actor)) hechos.push(`${q.id}: aprobación pedida`); }
    } catch (e: any) {
      await audit(db, actor, 'cadena.error', { cola: q.id, error: String(e?.message ?? e).slice(0, 300) });
      if (errores + 1 >= MAX_ERRORES) await aviso(db, `El vídeo ${q.id} se atascó en el último tramo (${String(e?.message ?? e).slice(0, 120)}). Hay que revisarlo.`, actor);
    }
  }
  // Subidos en privado a los que aún les falta pedir la aprobación (p. ej. si se cayó entre un paso y otro)
  const sinPedir = (await db.query(`SELECT * FROM content_queue WHERE tipo = 'largo' AND estado = 'QA' AND youtube_id IS NOT NULL`)).rows;
  for (const q of sinPedir) await pedirAprobacion(db, q, actor).then((id) => { if (id) hechos.push(`${q.id}: aprobación pedida`); }, () => {});
  return hechos;
}
