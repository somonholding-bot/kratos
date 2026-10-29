// Música por voz: «pon música lounge», «ponme ópera», «pausa la música», «siguiente canción».
// El servidor solo interpreta la orden; la app de Mac busca en YouTube con yt-dlp y reproduce
// el audio directamente (sin anuncios ni vídeo) en una ventanita del universo.

export type MusicCmd = 'pausa' | 'sigue' | 'siguiente' | 'para' | 'sube' | 'baja';
export type MusicEffect = { action: 'musica'; query: string } | { action: 'musica_control'; cmd: MusicCmd };

const GENRES = 'lounge|chill ?out|chill|techno|tecno|house|deep house|opera|jazz|salsa|bachata|merengue|reggaeton|regueton|clasica|rock|pop|electronica|ambient|lofi|lo-fi|piano|baladas|romantica|boleros?|blues|hip hop|rap|trap|cumbia|vallenato|flamenco|bossa nova|soul|funk|reggae|country|gospel|instrumental|meditacion|relajante';
const PLAY = /\b(pon|ponme|pone|ponga|pongame|ponle|reproduce|reproduceme|toca|tocame|quiero (escuchar|oir))\b/;

const clean = (s: string) => s.replace(/[.!?¿¡,]/g, ' ').replace(/^\s*(de|del|tipo|estilo|un poco de|algo de|algo|para|en youtube)\s+/g, '').replace(/\s+(en youtube|por favor|porfa)\s*$/g, '').replace(/\s+/g, ' ').trim();

// t: texto ya normalizado (minúsculas, sin acentos, sin «Kratos»)
export function musicControl(t: string): MusicCmd | null {
  if (/\b(todo|todas|acciones|emergencia)\b/.test(t)) return null;   // «detén todo» es la parada de emergencia
  const about = /\b(musica|cancion|tema|canciones|volumen)\b/.test(t);
  if (/^(pausa|pausala|pausar)\b|\b(pausa|pausala|pausar)\b.*\b(musica|cancion)\b/.test(t)) return 'pausa';
  if (about && /\b(quita|quitala|para|parala|apaga|apagala|deten|detenla|stop|cierra)\b/.test(t)) return 'para';
  if (/^(siguiente|otra|salta|cambiala)\b|\b(siguiente|otra|salta|cambia)\b.*\b(cancion|tema)\b/.test(t)) return 'siguiente';
  if (about && /\b(sube|subele|mas alto|mas fuerte)\b/.test(t)) return 'sube';
  if (about && /\b(baja|bajale|mas bajo|mas suave)\b/.test(t)) return 'baja';
  if (about && /\b(continua|sigue|reanuda|reanudala|vuelve a poner|play)\b/.test(t)) return 'sigue';
  return null;
}

export function musicQuery(t: string): string | null {
  if (!PLAY.test(t)) return null;
  const m = t.match(/\b(musica|cancion|canciones|playlist|lista de reproduccion|radio|album|disco)\b(.*)$/);
  if (m) {
    const rest = clean(m[2]);
    if (/^(cancion|canciones)$/.test(m[1]) && rest) return rest;   // «ponme una canción de Bad Bunny»
    return `${rest || 'lounge chill'} music mix`;
  }
  const g = t.match(new RegExp(`${PLAY.source}\\s+(?:(?:un poco de|algo de|algo|de)\\s+)?(${GENRES})\\b`));
  return g ? `${g[g.length - 1]} music mix` : null;
}

export const label = (query: string) => query.replace(/ music mix$/, '').replace(/ chill$/, '');
