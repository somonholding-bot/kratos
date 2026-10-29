// Motor híbrido: lectura de los eventos de Claude Code y aplazamiento por límite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStream } from '../src/core/subscription.ts';

test('lee resultado, coste y estado del límite del stream de Claude Code', () => {
  const out = [
    '{"type":"system","subtype":"init"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793300000,"rateLimitType":"five_hour"}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"Plan listo","total_cost_usd":0.42}',
  ].join('\n');
  const r = parseStream(out);
  assert.equal(r.text, 'Plan listo'); assert.equal(r.costUsd, 0.42);
  assert.equal(r.limit?.status, 'allowed_warning'); assert.equal(r.limit?.type, 'five_hour');
  assert.ok(r.limit?.resetsAt?.startsWith('2026-'));
});

test('detecta la sesión no iniciada y el límite agotado', () => {
  assert.equal(parseStream('{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}').notLoggedIn, true);
  assert.equal(parseStream('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1793300000}}').limit?.status, 'rejected');
});
