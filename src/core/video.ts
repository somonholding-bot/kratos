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
export async function produceVideo(_db: Db, _task: any): Promise<Record<string, unknown>> {
  // Cadena local antigua (imágenes fijas con zoom): retirada por orden del propietario el 2-nov-2026 por su baja calidad.
  // Los episodios se producen ahora con el motor de Orin (scripts/media/episodio: voz Kokoro, animación 2D, música ACE-Step).
  throw new Error('La cadena de vídeo antigua está retirada. Los episodios se producen con scripts/media/episodio (storyboard por beats) y se suben con scripts/media/subir-episodio.ts.');
}
