// Sube Shorts verticales al canal: el primero se publica ya y el resto se programa (uno por día). Uso: node scripts/media/subir-shorts.ts <carpeta> <plan.json>
// plan.json: [{ archivo, titulo, descripcion, etiquetas, publicar: "ahora" | "2026-11-03T00:00:00Z" }]
import fs from 'node:fs';
import path from 'node:path';
import { uploadVideo, setPrivacy, schedulePublish } from '../../src/core/youtube.ts';

const [dir, planF] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.resolve(dir, planF), 'utf8'));
const out: unknown[] = [];
for (const s of plan) {
  const up = await uploadVideo(path.resolve(dir, s.archivo), { titulo: s.titulo, descripcion: s.descripcion, etiquetas: s.etiquetas, categoria: '27', idioma: 'en' });
  const vis = s.publicar === 'ahora' ? await setPrivacy(up.id, 'public') : await schedulePublish(up.id, s.publicar);
  out.push({ archivo: s.archivo, url: up.url, ...vis });
}
console.log(JSON.stringify(out, null, 1));
