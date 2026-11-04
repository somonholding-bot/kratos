import { execFileSync, spawnSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Canal de YouTube del propietario con acceso completo (YouTube Data API + YouTube Analytics), decidido por el propietario.
// Subir vídeos: siempre como PRIVADOS. Hacerlos públicos (publicar) exige su aprobación en el panel.
// Credencial de Google (app de escritorio) y token de acceso en el Llavero, servicio «kratos-google».
// La autorización se hace una vez con scripts/conectar-youtube.ts (ventana de Google en el navegador).

export const SCOPES = ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const SERVICE = 'kratos-google';

export function secret(account: string): string | null {
  if (process.env.KRATOS_DISABLE_AI === '1') return null;   // pruebas: nunca el Llavero real
  try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}
// Se guarda por la entrada estándar de `security -i` (el secreto no aparece en la lista de procesos)
export function saveSecret(account: string, value: string) {
  const r = spawnSync('/usr/bin/security', ['-i'], { input: `add-generic-password -U -s ${SERVICE} -a ${account} -w ${value}\n` });
  if (r.status !== 0) throw new Error('No se pudo guardar en el Llavero');
}

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const id = secret('client_id'), sec = secret('client_secret'), refresh = secret('refresh_token');
  if (!id || !sec || !refresh) throw new Error('YouTube sin conectar: ejecuta scripts/conectar-youtube.ts');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: 'refresh_token' }) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Google rechazó el acceso (${j.error ?? r.status}): vuelve a autorizar con scripts/conectar-youtube.ts`);
  token = { value: j.access_token, until: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

async function get(url: string) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}: ${j.error?.message ?? ''}`.slice(0, 200));
  return j;
}

export const youtubeConnected = () => !!(secret('client_id') && secret('refresh_token'));

// Resumen del canal: datos, últimos vídeos con sus cifras y analítica de los últimos 28 días
export async function youtubeSummary(_db?: Db, videos = 10) {
  const ch = (await get('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true')).items?.[0];
  if (!ch) return { error: 'Esta cuenta de Google no tiene canal de YouTube' };
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const ids = uploads ? (await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${Math.min(25, videos)}&playlistId=${uploads}`)).items?.map((i: any) => i.contentDetails.videoId) ?? [] : [];
  const vids = ids.length ? (await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,status&id=${ids.join(',')}`)).items ?? [] : [];
  const end = new Date(), start = new Date(Date.now() - 28 * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  let analitica: unknown = null;
  try {
    const a = await get(`https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${d(start)}&endDate=${d(end)}&metrics=views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares`);
    const cols = (a.columnHeaders ?? []).map((c: any) => c.name);
    analitica = a.rows?.[0] ? Object.fromEntries(cols.map((c: string, i: number) => [c, a.rows[0][i]])) : { nota: 'Sin datos en los últimos 28 días' };
  } catch (e: any) { analitica = { error: e.message }; }
  return {
    canal: { nombre: ch.snippet?.title, id: ch.id, suscriptores: Number(ch.statistics?.subscriberCount ?? 0), vistas_totales: Number(ch.statistics?.viewCount ?? 0), videos: Number(ch.statistics?.videoCount ?? 0) },
    ultimos_28_dias: analitica,
    videos_recientes: vids.map((v: any) => ({ id: v.id, titulo: v.snippet?.title, fecha: v.snippet?.publishedAt?.slice(0, 10),
      visibilidad: v.status?.publishAt ? 'programado' : v.status?.privacyStatus === 'private' ? 'privado' : v.status?.privacyStatus === 'public' ? 'publico' : v.status?.privacyStatus,
      sale_el: v.status?.publishAt ?? null, vistas: Number(v.statistics?.viewCount ?? 0),
      me_gusta: Number(v.statistics?.likeCount ?? 0), comentarios: Number(v.statistics?.commentCount ?? 0), url: `https://youtu.be/${v.id}` })),
  };
}

// Sube un vídeo del Mac como PRIVADO (subida reanudable de Google). Publicarlo es otro paso, con aprobación.
export async function uploadVideo(file: string, meta: { titulo: string; descripcion?: string; etiquetas?: string[]; categoria?: string; idioma?: string }) {
  const fs = await import('node:fs');
  if (!fs.existsSync(file)) throw new Error(`No existe el archivo ${file}`);
  const size = fs.statSync(file).size;
  const body = { snippet: { title: meta.titulo.slice(0, 100), description: (meta.descripcion ?? '').slice(0, 5000), tags: meta.etiquetas?.slice(0, 30),
      categoryId: meta.categoria ?? '22', defaultLanguage: meta.idioma ?? 'en', defaultAudioLanguage: meta.idioma ?? 'en' },
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/*' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const loc = init.headers.get('location');
  if (!init.ok || !loc) throw new Error(`YouTube no aceptó la subida (${init.status})`);
  // Subida reanudable por trozos de 64 MB (múltiplo de 256 KiB): un vídeo 4K pesa cientos de MB y un único PUT se cortaba con «fetch failed».
  const TROZO = 64 * 1024 * 1024, fd = fs.openSync(file, 'r');
  let off = 0, v: any = null, fallos = 0;
  try {
    while (!v) {
      const len = Math.min(TROZO, size - off), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off);
      try {
        const r = await fetch(loc, { method: 'PUT', headers: { 'content-length': String(len), 'content-range': `bytes ${off}-${off + len - 1}/${size}` }, body: buf, signal: AbortSignal.timeout(10 * 60_000) });
        if (r.status === 308) { const rg = r.headers.get('range'); off = rg ? Number(rg.split('-')[1]) + 1 : off; fallos = 0; continue; }
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) { if (r.status >= 500 && ++fallos < 6) continue; throw new Error(`La subida falló (${r.status}): ${j.error?.message ?? ''}`.slice(0, 200)); }
        v = j;
      } catch (e: any) {
        if (/^La subida falló/.test(e?.message) || ++fallos >= 6) throw e;
        await new Promise((res) => setTimeout(res, 5000 * fallos));   // corte de red: se pregunta a YouTube hasta dónde llegó y se sigue desde ahí
        const q = await fetch(loc, { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${size}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (q?.status === 308) { const rg = q.headers.get('range'); off = rg ? Number(rg.split('-')[1]) + 1 : 0; }
        else if (q && (q.status === 200 || q.status === 201)) v = await q.json();
      }
    }
  } finally { fs.closeSync(fd); }
  return { id: v.id, url: `https://youtu.be/${v.id}`, estado: 'privado (publicarlo requiere tu aprobación)' };
}

// Miniatura propia (YouTube la permite cuando el canal está verificado con teléfono)
export async function setThumbnail(videoId: string, file: string) {
  const fs = await import('node:fs');
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'image/jpeg' }, body: fs.readFileSync(file), signal: AbortSignal.timeout(60_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Miniatura no aceptada (${r.status}): ${j.error?.message ?? ''}`.slice(0, 200));
  return { miniatura: true };
}

// Subtítulos en español (archivo .srt) para un vídeo propio
export async function uploadCaptions(videoId: string, file: string, language = 'en') {
  const fs = await import('node:fs');
  const boundary = `kratos${Date.now()}`;
  const meta = JSON.stringify({ snippet: { videoId, language, name: language === 'es' ? 'Español' : 'English', isDraft: false } });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fs.readFileSync(file), Buffer.from(`\r\n--${boundary}--`)]);
  const r = await fetch('https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet', { method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(60_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Subtítulos no aceptados (${r.status}): ${j.error?.message ?? ''}`.slice(0, 200));
  return { subtitulos: j.id };
}

// Programa la publicación: el vídeo queda privado y YouTube lo hace público a la hora indicada (ISO en UTC)
export async function schedulePublish(videoId: string, isoUtc: string) {
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', { method: 'PUT',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: videoId, status: { privacyStatus: 'private', publishAt: isoUtc, selfDeclaredMadeForKids: false } }), signal: AbortSignal.timeout(30_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}: ${j.error?.message ?? ''}`);
  return { id: videoId, programado: isoUtc };
}

// Cambia la visibilidad (public, unlisted, private). Solo se llama tras la aprobación del propietario.
export async function setPrivacy(videoId: string, privacy: 'public' | 'unlisted' | 'private') {
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', { method: 'PUT',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: videoId, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } }), signal: AbortSignal.timeout(30_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}: ${j.error?.message ?? ''}`);
  return { id: videoId, visibilidad: privacy };
}

// Edita título, descripción y etiquetas de un vídeo propio (no cambia su visibilidad)
export async function updateVideo(videoId: string, meta: { titulo?: string; descripcion?: string; etiquetas?: string[] }) {
  const cur = (await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`)).items?.[0];
  if (!cur) throw new Error('Ese vídeo no existe o no es tuyo');
  const snippet = { ...cur.snippet, title: meta.titulo ?? cur.snippet.title, description: meta.descripcion ?? cur.snippet.description, tags: meta.etiquetas ?? cur.snippet.tags };
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: videoId, snippet }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}`);
  return { id: videoId, actualizado: true };
}

export type ChannelLook = { descripcion?: string; palabras_clave?: string[]; pais?: string; idioma?: string; video_destacado?: string; banner?: string };

// Personaliza el canal: descripción, palabras clave, país, idioma, vídeo destacado para no suscritos y banner (imagen del Mac, 2048×1152 o mayor).
// El nombre y la foto de perfil no se pueden cambiar con la API de Google: se hacen en YouTube Studio.
export async function updateChannel(look: ChannelLook) {
  const ch = (await get('https://www.googleapis.com/youtube/v3/channels?part=brandingSettings&mine=true')).items?.[0];
  if (!ch) throw new Error('Esta cuenta de Google no tiene canal de YouTube');
  const b = ch.brandingSettings ?? {};
  const channel = { ...(b.channel ?? {}) };
  if (look.descripcion !== undefined) channel.description = look.descripcion.slice(0, 1000);
  if (look.palabras_clave) channel.keywords = look.palabras_clave.map((k) => k.trim()).filter(Boolean).map((k) => (k.includes(' ') ? `"${k.replace(/"/g, '')}"` : k)).join(' ').slice(0, 500);
  if (look.pais) channel.country = look.pais.toUpperCase().slice(0, 2);
  if (look.idioma) channel.defaultLanguage = look.idioma;
  if (look.video_destacado) channel.unsubscribedTrailer = look.video_destacado;
  const image = { ...(b.image ?? {}) };
  if (look.banner) {
    const fs = await import('node:fs');
    if (!fs.existsSync(look.banner)) throw new Error(`No existe la imagen ${look.banner}`);
    const up = await fetch('https://www.googleapis.com/upload/youtube/v3/channelBanners/insert', { method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': look.banner.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' },
      body: fs.readFileSync(look.banner), signal: AbortSignal.timeout(120_000) });
    const u: any = await up.json();
    if (!up.ok) throw new Error(`YouTube no aceptó el banner (${up.status}): ${u.error?.message ?? ''}`.slice(0, 200));
    image.bannerExternalUrl = u.url;
  }
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=brandingSettings', { method: 'PUT',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: ch.id, brandingSettings: { channel, image } }), signal: AbortSignal.timeout(30_000) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}: ${j.error?.message ?? ''}`.slice(0, 200));
  return { canal: ch.id, actualizado: Object.keys(look).filter((k) => (look as any)[k] !== undefined) };
}

// Lista los vídeos del canal con su visibilidad (para gestionar: editar, publicar u ocultar, borrar)
export async function listVideos(max = 25) {
  const ch = (await get('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true')).items?.[0];
  const uploads = ch?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { videos: [] };
  const ids = (await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${Math.min(50, max)}&playlistId=${uploads}`)).items?.map((i: any) => i.contentDetails.videoId) ?? [];
  if (!ids.length) return { videos: [] };
  const vids = (await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,statistics&id=${ids.join(',')}`)).items ?? [];
  return { videos: vids.map((v: any) => ({ id: v.id, titulo: v.snippet?.title, fecha: v.snippet?.publishedAt?.slice(0, 10), visibilidad: v.status?.privacyStatus, vistas: Number(v.statistics?.viewCount ?? 0), url: `https://youtu.be/${v.id}` })) };
}

// Miniaturas que YouTube sirve de cada vídeo (siempre hay alguna automática; si es propia o no, la API no lo dice)
export async function videoThumbnails(ids: string[]) {
  if (!ids.length) return {};
  const vids = (await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.slice(0, 50).map(encodeURIComponent).join(',')}`)).items ?? [];
  return Object.fromEntries(vids.map((v: any) => { const t = v.snippet?.thumbnails ?? {}; return [v.id, { url: (t.maxres ?? t.high ?? t.default)?.url ?? null, tamanos: Object.keys(t) }]; }));
}

export const isVideoId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);

// Borra un vídeo propio (irreversible en YouTube). Solo se llama tras la aprobación del propietario en el panel.
export async function deleteVideo(videoId: string) {
  if (!isVideoId(videoId)) throw new Error('ID de vídeo de YouTube no válido');
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`, { method: 'DELETE',
    headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 403) throw new Error('YouTube no deja borrar (403): falta el permiso de gestión completa del canal. Vuelve a conectar con scripts/conectar-youtube.ts y acepta todos los permisos.');
  if (r.status !== 204) { const j: any = await r.json().catch(() => ({})); throw new Error(`YouTube respondió ${r.status}: ${j.error?.message ?? ''}`.slice(0, 200)); }
  return { id: videoId, borrado: true };
}

// Aprobación del propietario en el panel: solo entonces un vídeo pasa a público, se borra o cambia la presentación pública del canal
export async function onYoutubeApproval(db: Db, approval: any, approved: boolean) {
  const tipo = approval?.scope?.tipo;
  if (!approved || (tipo !== 'youtube_publicar' && tipo !== 'youtube_canal' && tipo !== 'youtube_borrar')) return;

  if (tipo === 'youtube_publicar') {
    await setPrivacy(String(approval.scope.video_id), approval.scope.visibilidad === 'unlisted' ? 'unlisted' : 'public');
    if (approval.scope.visibilidad !== 'unlisted') await db.query(`UPDATE content_queue SET estado = 'PUBLISHED', sale_el = coalesce(sale_el, now()), updated_at = now() WHERE youtube_id = $1`, [String(approval.scope.video_id)]);
  }
  else if (tipo === 'youtube_borrar') {
    await deleteVideo(String(approval.scope.video_id));
    await audit(db, 'propietario', 'youtube.borrado', { aprobacion: approval.id, id: approval.scope.video_id, titulo: approval.scope.titulo ?? null });
  }
  else await updateChannel(approval.scope.cambios ?? {});
  await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [approval.id]);
}
