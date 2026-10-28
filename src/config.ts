import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, '.jarvis');

export const config = {
  host: '127.0.0.1', // nunca 0.0.0.0: el panel no se expone a la red
  port: Number(process.env.JARVIS_PORT ?? 7420),
  db: {
    host: '127.0.0.1',
    port: 5432,
    database: process.env.JARVIS_DB ?? 'jarvis',
    user: 'jarvis_app',
  },
  agentDbUser: 'jarvis_agent',
  worker: {
    pollMs: Number(process.env.JARVIS_POLL_MS ?? 5000),
    lockMinutes: 5,
    heartbeatStaleSeconds: 60,
  },
};
