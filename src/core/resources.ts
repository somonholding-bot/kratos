import { execFile } from 'node:child_process';
import os from 'node:os';

// Uso de recursos del Mac y de KRATOS (solo lectura, con herramientas que ya trae macOS).
// Cacheado unos segundos: consultar `top` cada vez costaría más de lo que mide.

type Proc = { name: string; ramMb: number; cpu: number; count: number };
export type Resources = {
  at: string; cores: number;
  cpuPct: { user: number; sys: number; idle: number; busy: number } | null;
  ram: { totalGb: number; usedPct: number; freePct: number | null };
  kratos: { ramMb: number; cpu: number; parts: Proc[] };
  topApps: { name: string; ramMb: number; cpu: number }[];
  warnings: string[];
};

const run = (cmd: string, args: string[], ms = 8000) => new Promise<string>((resolve) => {
  execFile(cmd, args, { timeout: ms, maxBuffer: 4_000_000 }, (_e, out) => resolve(String(out ?? '')));
});

// Clasifica procesos: lo que es de KRATOS se agrupa aparte
const KRATOS_PARTS: [string, RegExp][] = [
  ['Servidor y panel', /src\/server\.ts/],
  ['Trabajador de tareas', /src\/worker\.ts/],
  ['Reconocimiento de voz (whisper)', /whisper-server/],
  ['Voz natural (Piper/Kokoro)', /tts-server\.py/],
  ['Ventana del universo', /Kratos\.app\/Contents\/MacOS\/Kratos|WebKit\.WebContent/],
];

let cache: { at: number; value: Resources } | null = null;

export async function resources(): Promise<Resources> {
  if (cache && Date.now() - cache.at < 4000) return cache.value;
  const [top, mem, ps, pressure] = await Promise.all([
    run('/usr/bin/top', ['-l', '2', '-n', '0', '-s', '1']),
    run('/usr/bin/vm_stat', []),
    run('/bin/ps', ['-Ao', 'pid=,rss=,%cpu=,command=']),
    run('/usr/bin/memory_pressure', []),
  ]);

  // CPU: la última línea «CPU usage» de top (la primera muestra es un promedio desde el arranque)
  const cpuLine = top.split('\n').filter((l) => l.startsWith('CPU usage')).pop() ?? '';
  const pick = (k: string) => Number(cpuLine.match(new RegExp(`([\\d.]+)% ${k}`))?.[1] ?? NaN);
  const user = pick('user'), sys = pick('sys'), idle = pick('idle');
  const cpuPct = Number.isFinite(idle) ? { user, sys, idle, busy: Math.round((100 - idle) * 10) / 10 } : null;

  const totalGb = os.totalmem() / 1073741824;
  const freeLine = pressure.match(/System-wide memory free percentage:\s*(\d+)%/);
  const freePct = freeLine ? Number(freeLine[1]) : null;
  const pageSize = Number(mem.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
  const freePages = Number(mem.match(/Pages free:\s+(\d+)/)?.[1] ?? 0);
  const usedPct = freePct !== null ? 100 - freePct : Math.round((1 - (freePages * pageSize) / os.totalmem()) * 100);

  const rows = ps.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
    return m ? { rssMb: Number(m[2]) / 1024, cpu: Number(m[3]), cmd: m[4] } : null;
  }).filter((r): r is { rssMb: number; cpu: number; cmd: string } => !!r);

  const parts: Proc[] = KRATOS_PARTS.map(([name]) => ({ name, ramMb: 0, cpu: 0, count: 0 }));
  const apps = new Map<string, { ramMb: number; cpu: number }>();
  for (const r of rows) {
    const i = KRATOS_PARTS.findIndex(([, re]) => re.test(r.cmd));
    if (i >= 0) { parts[i].ramMb += r.rssMb; parts[i].cpu += r.cpu; parts[i].count++; continue; }
    const app = (r.cmd.match(/\/([^/]+?)\.app\//)?.[1] ?? r.cmd.split(' ')[0].split('/').pop() ?? '?').slice(0, 40);
    const a = apps.get(app) ?? { ramMb: 0, cpu: 0 };
    a.ramMb += r.rssMb; a.cpu += r.cpu; apps.set(app, a);
  }
  const kratosRam = parts.reduce((s, p) => s + p.ramMb, 0), kratosCpu = parts.reduce((s, p) => s + p.cpu, 0);
  const topApps = [...apps.entries()].sort((a, b) => b[1].ramMb - a[1].ramMb).slice(0, 8)
    .map(([name, v]) => ({ name, ramMb: Math.round(v.ramMb), cpu: Math.round(v.cpu * 10) / 10 }));

  const warnings: string[] = [];
  if (cpuPct && cpuPct.busy > 85) warnings.push(`CPU al ${cpuPct.busy}%: el sistema está muy cargado.`);
  if (freePct !== null && freePct < 15) warnings.push(`Memoria libre baja (${freePct}%): macOS usa mucho el disco y todo se vuelve lento.`);
  if (kratosRam > totalGb * 1024 * 0.15) warnings.push(`KRATOS usa ${Math.round(kratosRam)} MB de RAM.`);

  const value: Resources = {
    at: new Date().toISOString(), cores: os.cpus().length,
    cpuPct, ram: { totalGb: Math.round(totalGb * 10) / 10, usedPct, freePct },
    kratos: { ramMb: Math.round(kratosRam), cpu: Math.round(kratosCpu * 10) / 10, parts: parts.map((p) => ({ ...p, ramMb: Math.round(p.ramMb), cpu: Math.round(p.cpu * 10) / 10 })).filter((p) => p.count) },
    topApps, warnings,
  };
  cache = { at: Date.now(), value };
  return value;
}
