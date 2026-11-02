import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Db } from '../db.ts';
import { ROOT } from '../config.ts';
import { audit } from './state.ts';
import { checkpoint } from './tasks.ts';
import { setThumbnail, uploadCaptions, uploadVideo, youtubeConnected } from './youtube.ts';

// Producción de vídeo en segundo plano (tarea «produccion_video»): scripts/media/producir.ts hace voz, imágenes, música,
// subtítulos, montaje y miniatura en el Mac (gratis y local). Si el encargo lo pide, lo sube a YouTube como PRIVADO.
// Publicarlo sigue necesitando la aprobación del propietario (publicar_video_youtube).
export async function produceVideo(db: Db, task: any): Promise<Record<string, unknown>> {
  const spec = task.inputs ?? {};
  if (!spec.titulo || !spec.guion) throw new Error('El encargo de vídeo necesita título y guion');
  const dir = path.join(os.homedir(), 'Movies/Kratos', `${new Date().toISOString().slice(0, 10)}-tarea-${task.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'encargo.json');
  fs.writeFileSync(file, JSON.stringify({ ...spec, carpeta: dir }, null, 2));
  // puede tardar decenas de minutos: se renueva el bloqueo de la tarea mientras trabaja
  const keep = setInterval(() => db.query(`UPDATE tasks SET locked_until = now() + interval '5 minutes' WHERE id = $1 AND status = 'en_ejecucion'`, [task.id]).catch(() => {}), 60_000);
  let out: string;
  try {
    // cada etapa que el productor anuncia («[hh:mm:ss] Voz…») queda como punto de control en la tarea
    out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [path.join(ROOT, 'scripts/media/producir.ts'), file], { cwd: ROOT, timeout: 3 * 3_600_000 });
      let stdout = '', stderr = '';
      p.stdout.on('data', (d) => { const t = String(d); stdout += t; for (const m of t.matchAll(/^\[[\d:]+\] (.+)$/gm)) checkpoint(db, task.id, m[1]).catch(() => {}); });
      p.stderr.on('data', (d) => { stderr = (stderr + String(d)).slice(-4000); });
      p.on('error', reject);
      p.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Producción fallida (código ${code}): ${(stderr || stdout).slice(-600)}`)));
    });
  } finally { clearInterval(keep); }
  const result: Record<string, any> = JSON.parse(out.trim().split('\n').pop()!);
  await audit(db, 'kratos (vídeo)', 'video.producido', { tarea: task.id, carpeta: dir, duracion_s: result.duracion_s });
  if (spec.subir && youtubeConnected()) {
    const up = await uploadVideo(result.video, { titulo: spec.titulo, descripcion: spec.descripcion ?? '', etiquetas: spec.etiquetas ?? [], idioma: spec.idioma ?? 'en' });
    result.youtube = up;
    // miniatura y subtítulos: si YouTube los rechaza (p. ej. canal sin verificar), el vídeo queda subido igual
    result.miniatura_subida = await setThumbnail(up.id, result.miniatura).then(() => true, (e) => e.message);
    result.subtitulos_subidos = await uploadCaptions(up.id, result.subtitulos, spec.idioma ?? 'en').then(() => true, (e) => e.message);
    await audit(db, 'kratos (vídeo)', 'youtube.subido_privado', { id: up.id, titulo: String(spec.titulo).slice(0, 100) });
  }
  return result;
}
