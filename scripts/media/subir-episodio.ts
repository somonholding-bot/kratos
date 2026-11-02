// Sube un episodio terminado al canal de YouTube: banner (opcional), vídeo, miniatura y subtítulos.
// Uso: node scripts/media/subir-episodio.ts <carpeta> <video.mp4> <meta.json> <miniatura.jpg> <subtitulos.srt> [banner.jpg] [private|unlisted|public]
// El vídeo se sube PRIVADO salvo que se pida otra visibilidad; el idioma del canal es inglés.
import fs from 'node:fs';
import path from 'node:path';
import { uploadVideo, setThumbnail, uploadCaptions, updateChannel, setPrivacy } from '../../src/core/youtube.ts';

const [dir, video, metaF, thumb, srt, banner, vis] = process.argv.slice(2);
const p = (f: string) => path.resolve(dir, f);
const meta = JSON.parse(fs.readFileSync(p(metaF), 'utf8'));
const out: Record<string, unknown> = {};
if (banner) out.banner = await updateChannel({ banner: p(banner) }).then((r) => r, (e) => ({ error: e.message }));
const up = await uploadVideo(p(video), { titulo: meta.titulo, descripcion: meta.descripcion, etiquetas: meta.etiquetas, categoria: '27', idioma: 'en' });
out.video = up;
out.miniatura = await setThumbnail(up.id, p(thumb)).then(() => true, (e) => e.message);
out.subtitulos = await uploadCaptions(up.id, p(srt), 'en').then(() => true, (e) => e.message);
if (vis && vis !== 'private') out.visibilidad = await setPrivacy(up.id, vis as any);
console.log(JSON.stringify(out, null, 1));
