import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Bitácora de fallas y rendimiento + ajustes internos que KRATOS puede cambiar a petición del propietario.

export const SETTINGS = {
  ui_quality: { enum: ['baja', 'media', 'alta'] },
  ui_reduced: { enum: ['0', '1'] },
  voice_speed: { min: 0.7, max: 1.4 },
  follow_up: { min: 5, max: 300 },
  tts_voice: { enum: ['piper', 'kokoro', 'apple'] },
  voice_model: { enum: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] },
  agents_engine: { enum: ['suscripcion', 'api'] },
} as const;
export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export async function allSettings(db: Db): Promise<Record<string, unknown>> {
  const rows = (await db.query(`SELECT key, value FROM system_state WHERE key = ANY($1)`, [SETTING_KEYS])).rows;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db: Db, key: string, raw: unknown, by: string) {
  if (!SETTING_KEYS.includes(key as SettingKey)) throw new Error(`Ajuste «${key}» no existe o no se puede cambiar`);
  const rule = SETTINGS[key as SettingKey] as any;
  let value: unknown;
  if (rule.enum) {
    if (!rule.enum.includes(String(raw))) throw new Error(`Valor no válido para ${key}: usa ${rule.enum.join(', ')}`);
    value = String(raw);
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < rule.min || n > rule.max) throw new Error(`${key} debe estar entre ${rule.min} y ${rule.max}`);
    value = n;
  }
  await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`, [key, JSON.stringify(value), by]);
  await audit(db, by, 'ajuste.cambiado', { key, value });
  return { key, value };
}

export async function logFault(db: Db, source: string, level: 'aviso' | 'error', message: string) {
  await db.query(`INSERT INTO fault_log (source, level, message) VALUES ($1, $2, $3)`, [source.slice(0, 40), level, message.slice(0, 500)]).catch(() => {});
}

export async function logPerf(db: Db, r: any) {
  const top = r.topApps?.[0];
  await db.query(`INSERT INTO perf_log (cpu_busy, ram_used_pct, ram_free_pct, kratos_ram_mb, kratos_cpu, top_app, top_app_ram_mb) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.cpuPct?.busy ?? null, r.ram?.usedPct ?? null, r.ram?.freePct ?? null, r.kratos?.ramMb ?? null, r.kratos?.cpu ?? null, top?.name ?? null, top?.ramMb ?? null]).catch(() => {});
  // se conservan 7 días
  await db.query(`DELETE FROM perf_log WHERE at < now() - interval '7 days'`).catch(() => {});
}
