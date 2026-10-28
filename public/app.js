// Panel de Kratos. Todo lo que se muestra sale de la API local; nada se simula aquí.

import { Voice, isNative } from './voice.js';
import { createScene, AGENTS } from './kratos-scene.js';

const voice = new Voice();
const SCREENS = [
  ['inicio', 'Inicio'], ['conversacion', 'Conversación'], ['negocios', 'Negocios y productos'],
  ['agentes', 'Agentes y tareas'], ['calendario', 'Calendario'], ['contenido', 'Contenido y campañas'],
  ['presupuesto', 'Presupuestos'], ['analitica', 'Analítica'], ['conexiones', 'Conexiones'],
  ['aprobaciones', 'Aprobaciones'], ['actividad', 'Registro de actividad'], ['ajustes', 'Configuración y privacidad'],
];
const STATE_LABEL = {
  desconectado: 'Desconectado', escuchando: 'Escuchando', transcribiendo: 'Transcribiendo', pensando: 'Pensando',
  ejecutando: 'Ejecutando', esperando_permiso: 'Esperando permiso', completado: 'Completado', error: 'Error',
  detenido: 'Detenido', en_espera: 'En espera', hablando: 'Hablando',
};

const app = { screen: 'inicio', overview: null, thinking: false, completedUntil: 0, lastOk: null, wake: null, wokeUntil: 0, awake: false, agents: [], selected: null };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const usd = (c) => `${(Number(c) / 100).toFixed(2)} USD`;
const demoTag = (isDemo) => (isDemo ? '<span class="tag demo-tag">DEMO</span>' : '<span class="tag real">real</span>');
const unknown = '<span class="unknown">desconocido</span>';

function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { return null; } }

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, opts);
  if (r.status === 401) { location.reload(); throw new Error('Sesión requerida'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 4000);
}

function table(cols, rows, rowClass = () => '') {
  if (!rows.length) return '<p class="meta">Sin registros.</p>';
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr class="${rowClass(r)}">${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const meta = (source) => `<div class="meta">Fuente: ${esc(source)} · Actualizado: ${new Date().toLocaleTimeString('es')}</div>`;

// ---------- estado real ----------
function computeState() {
  const o = app.overview;
  if (!o) return 'desconectado';
  if (o.state.emergency_stop) return 'detenido';
  if (voice.state === 'escuchando') return 'escuchando';
  if (voice.state === 'transcribiendo') return 'transcribiendo';
  if (app.thinking) return 'pensando';
  if (voice.state === 'hablando') return 'hablando';
  const worker = o.heartbeats.find((h) => h.process === 'worker');
  if (!worker || worker.age > 60) return 'error';
  if (o.running.length) return 'ejecutando';
  if (o.pendingApprovals > 0) return 'esperando_permiso';
  if (Date.now() < app.completedUntil) return 'completado';
  return 'en_espera';
}

function paintChrome() {
  const s = computeState();
  const chip = $('#state-chip'); chip.dataset.state = s; chip.textContent = STATE_LABEL[s];
  paintScene();
  const o = app.overview;
  const stop = $('#btn-stop'), pause = $('#btn-pause');
  if (o?.state.emergency_stop) { stop.textContent = 'Reanudar (parada activa)'; stop.className = 'ctl resume'; }
  else { stop.textContent = 'PARADA DE EMERGENCIA'; stop.className = 'ctl danger'; }
  pause.textContent = o?.state.automations_paused ? 'Reanudar automatizaciones' : 'Pausar automatizaciones';
  pause.classList.toggle('on', !!o?.state.automations_paused);
  $('#btn-cancel').disabled = !o?.running.length;
  const ptt = $('#btn-ptt'), mute = $('#btn-mute');
  ptt.disabled = voice.muted || !voice.supported || voice.state === 'transcribiendo';
  ptt.classList.toggle('live', voice.state === 'escuchando');
  ptt.textContent = !voice.supported ? '🎙 Voz no soportada' : voice.muted ? '🎙 Micrófono silenciado' : voice.state === 'escuchando' ? '● Escuchando… suelta para enviar' : voice.state === 'transcribiendo' ? 'Transcribiendo…' : '🎙 Mantén para hablar';
  mute.textContent = voice.muted ? 'Activar micrófono' : 'Silenciar micrófono';
  mute.classList.toggle('muted', voice.muted);
  $('#btn-hush').disabled = voice.state !== 'hablando';
  $('#mic-live').hidden = voice.state !== 'escuchando';
  const mode = $('#mode-chip');
  const ai = app.overview?.ai;
  mode.textContent = `${ai?.active ? `IA: Claude · ${usd(ai.availableCents)} disponibles` : 'Modo demostración · IA sin conectar'}${app.wake ? ` · 🎙 ${app.wake.enabled ? app.wake.state : 'escucha «Kratos» apagada'}` : ''}`;
  const b = document.querySelector('[data-screen="aprobaciones"] .badge');
  if (b) b.textContent = o?.pendingApprovals || '';
  if (b) b.hidden = !o?.pendingApprovals;
}

async function refreshOverview() {
  try { app.overview = await api('/api/overview'); app.lastOk = new Date(); }
  catch { app.overview = null; }
  paintChrome();
}

// ---------- pantallas ----------
const screens = {
  async inicio() {
    const o = app.overview ?? await api('/api/overview');
    const count = (st) => o.counts.find((c) => c.status === st)?.n ?? 0;
    const hb = (p) => { const h = o.heartbeats.find((x) => x.process === p); return h ? (h.age < 60 ? `<span class="tag real">activo · hace ${h.age}s</span>` : `<span class="tag bad">sin latido · hace ${h.age}s</span>`) : '<span class="tag bad">nunca iniciado</span>'; };
    return `<h1>Inicio</h1>${meta('base de datos local')}
      <p>Procesos: servidor ${hb('server')} · trabajador 24 h ${hb('worker')}${o.heartbeats.some((h) => h.process === 'escucha') ? ` · escucha «Kratos» ${hb('escucha')}` : ''}</p>
      <p>Nivel de autonomía: <b>${esc(o.state.autonomy_level)}</b>. IA: <b>${o.ai?.active ? `Claude conectado (${esc(o.ai.model)}) · disponible ${usd(o.ai.availableCents)}` : o.ai?.keyPresent ? 'clave guardada, falta presupuesto aprobado' : 'sin clave de Claude'}</b>. Memoria: Obsidian (${esc(o.vault ?? '')}).</p>
      ${o.state.emergency_stop ? '<p class="tag bad">PARADA DE EMERGENCIA ACTIVA</p>' : ''}
      ${o.state.automations_paused ? '<p class="tag warn">Automatizaciones en pausa</p>' : ''}
      <p><a href="/prototipo/" style="color:var(--accent)">✦ Abrir el universo de KRATOS (pantalla completa) →</a></p>
      <div class="grid">
        <div class="card"><div class="k">Tareas pendientes</div><div class="v">${count('pendiente')}</div></div>
        <div class="card"><div class="k">Esperando IA</div><div class="v">${count('esperando_ia')}</div></div>
        <div class="card"><div class="k">Requieren revisión</div><div class="v">${count('requiere_revision')}</div></div>
        <div class="card"><div class="k">Aprobaciones pendientes</div><div class="v">${o.pendingApprovals}</div></div>
        <div class="card"><div class="k">Presupuesto asignado</div><div class="v">${usd(o.budget.assigned)}</div></div>
        <div class="card"><div class="k">Gastado</div><div class="v">${usd(o.budget.spent)}</div></div>
      </div>
      <h2>Negocios</h2>
      <div class="grid">${o.businesses.map((b) => `<div class="card ${b.is_demo ? 'demo' : ''}"><div class="k">${b.is_demo ? 'Demostración ficticia' : 'Real'}</div>
        <div><b>${esc(b.name)}</b>${demoTag(b.is_demo)}</div><div class="meta">${b.products} productos · ${b.open_tasks} tareas abiertas</div>
        <div>${(b.goals || []).map((g) => `· ${esc(g)}`).join('<br>')}</div></div>`).join('')}</div>`;
  },

  async conversacion() {
    const msgs = await api('/api/messages');
    return `<h1>Conversación</h1>${meta('historial local (texto y voz comparten el mismo contexto)')}
      <div class="note">Modo demostración: Kratos aún no tiene IA conectada. Entiende un conjunto fijo de órdenes. Nunca acepta aprobaciones por conversación.</div>
      <div class="chat"><div class="log" id="log">${msgs.map(msgHtml).join('')}</div>
      <div class="suggest">${['¿Cómo van mis negocios?', '¿Qué hiciste?', 'Presupuesto', 'Tienes 50 dólares para pruebas de anuncios', 'Crea una tarea: revisar la ficha de la app', 'Aprobaciones pendientes', 'Detén todas las acciones']
        .map((s) => `<button data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <form class="composer" id="composer"><input id="say" autocomplete="off" placeholder="Escribe a Kratos…" aria-label="Mensaje"><button class="ctl">Enviar</button></form></div>`;
  },

  async negocios() {
    const d = await api('/api/businesses');
    const products = (id) => d.products.filter((p) => p.business_id === id);
    return `<h1>Negocios y productos</h1>${meta('expedientes locales')}
      ${d.businesses.map((b) => `<h2>${esc(b.name)} ${demoTag(b.is_demo)}</h2>
        ${table([['Producto', (p) => esc(p.name)], ['Plataformas', (p) => esc(p.platforms.join(', ')) || unknown], ['Audiencia', (p) => esc(p.audience) || unknown],
          ['Mercados', (p) => esc(p.markets.join(', ')) || unknown], ['Ingresos', (p) => esc(p.revenue_model) || unknown]], products(b.id), (p) => (p.is_demo ? 'is-demo' : ''))}`).join('')}
      <h2>Expediente: conocimiento clasificado</h2>
      ${table([['Tipo', (k) => `<span class="tag ${k.kind === 'externo_no_confiable' ? 'warn' : ''}">${esc(k.kind)}</span>`], ['Tema', (k) => esc(k.topic)], ['Contenido', (k) => esc(k.content)],
        ['Fuente', (k) => esc(k.source)], ['Fecha', (k) => fmtDate(k.created_at)]], d.knowledge, (k) => (k.is_demo ? 'is-demo' : ''))}
      <h2>Incorporar una nueva app</h2>
      <form class="stack" id="new-business">
        <input name="name" required placeholder="Negocio (p. ej. Mi estudio de apps)">
        <input name="productName" required placeholder="Nombre de la app">
        <input name="platforms" placeholder="Plataformas separadas por coma (iOS, Android, web)">
        <input name="audience" placeholder="Audiencia">
        <input name="markets" placeholder="Mercados separados por coma (MX, ES, US)">
        <input name="revenueModel" placeholder="Modelo de ingresos">
        <button class="ctl">Crear expediente</button>
        <div class="meta">Las métricas se crean como «desconocidas» hasta conectar una fuente real.</div>
      </form>`;
  },

  async agentes() {
    const [fns, tasks] = await Promise.all([api('/api/functions'), api('/api/tasks')]);
    return `<h1>Agentes y tareas</h1>${meta('configuración y cola local')}
      <div class="note">KRATOS coordina a siete especialistas (perfiles, no procesos permanentes). Se activan solo cuando una tarea real los necesita, y necesitan Claude conectado. Solo el trabajador determinista (sin IA) ejecuta revisiones internas.</div>
      <h2>Funciones</h2>
      ${table([['Función', (f) => `<b>${esc(f.symbol ?? '')} ${esc(f.name)}</b><div class="meta">${esc(f.purpose)}</div>`], ['Estado', () => '<span class="tag">inactiva · sin IA</span>'], ['Modelo previsto', (f) => esc(f.model)],
        ['Herramientas', (f) => esc(f.allowed_tools.join(', '))], ['Prohibido', (f) => esc(f.prohibited.join(', '))], ['Escala a ti', (f) => esc(f.escalation)], ['Tareas', (f) => f.open_tasks]], fns)}
      <h2>Cola de tareas</h2>
      ${table([['#', (t) => t.id], ['Tarea', (t) => `${esc(t.title)}<div class="meta">${esc(t.business)}</div>`], ['Estado', (t) => `<span class="tag">${esc(t.status)}</span>`], ['Prioridad', (t) => t.priority],
        ['Responsable', (t) => esc(t.owner_function)], ['Intentos', (t) => `${t.attempts}/${t.max_attempts}`], ['Próxima ejecución', (t) => fmtDate(t.run_at)],
        ['Resultado / error', (t) => esc(t.last_error || (t.result ? JSON.stringify(t.result) : ''))],
        ['', (t) => (['completada', 'cancelada'].includes(t.status) ? '' : `<button class="ctl" data-cancel="${t.id}">Cancelar</button>`)]], tasks, (t) => (t.is_demo ? 'is-demo' : ''))}`;
  },

  async calendario() {
    const rows = await api('/api/schedule');
    return `<h1>Calendario de automatizaciones</h1>${meta('cola local')}
      ${table([['Cuándo', (t) => fmtDate(t.run_at)], ['Tarea', (t) => esc(t.title)], ['Repetición', (t) => (t.recurrence_minutes ? `cada ${t.recurrence_minutes >= 60 ? t.recurrence_minutes / 60 + ' h' : t.recurrence_minutes + ' min'}` : 'una vez')],
        ['Estado', (t) => esc(t.status)], ['Responsable', (t) => esc(t.owner_function)]], rows)}`;
  },

  async contenido() {
    const d = await api('/api/content');
    return `<h1>Contenido y campañas</h1>${meta('local')}
      <h2>Piezas</h2>
      ${table([['Pieza', (p) => `${esc(p.title)}${demoTag(p.is_demo)}`], ['Audiencia', (p) => esc(p.audience)], ['Hipótesis', (p) => esc(p.hypothesis)], ['Mensaje', (p) => esc(p.message)],
        ['Demostración verificable', (p) => esc(p.verifiable_demo)], ['CTA', (p) => esc(p.cta)], ['Derechos', (p) => esc(p.rights)], ['Aprobación', (p) => esc(p.approval_status)],
        ['Canal', (p) => esc(p.channel)], ['ID medición', (p) => esc(p.measurement_id)]], d.pieces, (p) => (p.is_demo ? 'is-demo' : ''))}
      <h2>Experimentos</h2>
      ${table([['Hipótesis', (e) => `${esc(e.hypothesis)}${demoTag(e.is_demo)}`], ['Métrica', (e) => esc(e.metric)], ['Presupuesto', (e) => usd(e.budget_cents)], ['Ventana', (e) => `${e.window_days} días`],
        ['Parada', (e) => esc(e.stop_conditions)], ['Incertidumbre', (e) => esc(e.uncertainty)], ['Estado', (e) => esc(e.status)], ['Decisión', (e) => esc(e.decision) || '—']], d.experiments, (e) => (e.is_demo ? 'is-demo' : ''))}`;
  },

  async presupuesto() {
    const d = await api('/api/budget');
    return `<h1>Presupuestos y compromisos</h1>${meta('libro financiero determinista (independiente de la IA)')}
      <div class="note">Sin dinero asignado, Kratos no puede reservar ni gastar nada. Para asignar, díselo en la conversación («tienes 50 dólares para…») y confírmalo en «Aprobaciones».</div>
      ${table([['Cuenta', (a) => esc(a.label)], ['Ámbito', (a) => esc(a.scope)], ['Límite', (a) => usd(a.limit_cents)], ['Reservado', (a) => usd(a.reserved_cents)], ['Gastado', (a) => usd(a.spent_cents)],
        ['Disponible', (a) => usd(a.limit_cents - a.reserved_cents - a.spent_cents)], ['Vigencia', (a) => fmtDate(a.valid_until)], ['Estado', (a) => esc(a.status)]], d.accounts)}
      <h2>Movimientos</h2>
      ${table([['Fecha', (m) => fmtDate(m.created_at)], ['Tipo', (m) => esc(m.kind)], ['Importe', (m) => usd(m.amount_cents)], ['Clave', (m) => `<code>${esc(m.idempotency_key)}</code>`], ['Actor', (m) => esc(m.actor)]], d.movements)}`;
  },

  async analitica() {
    const rows = await api('/api/metrics');
    return `<h1>Analítica y resultados</h1>${meta('tabla metrics (sin fuentes externas conectadas)')}
      <div class="note">Los valores ausentes se muestran como «desconocido». Kratos nunca rellena cifras.</div>
      ${table([['Negocio', (m) => esc(m.business)], ['Producto', (m) => esc(m.product) || '—'], ['Métrica', (m) => esc(m.metric)], ['Valor', (m) => (m.value === null ? unknown : esc(m.value))],
        ['Fuente', (m) => `${esc(m.source)}${demoTag(m.is_demo)}`], ['Observado', (m) => fmtDate(m.observed_at)]], rows, (m) => (m.is_demo ? 'is-demo' : ''))}`;
  },

  async conexiones() {
    const rows = await api('/api/connections');
    return `<h1>Conexiones y estado</h1>${meta('catálogo local')}
      ${table([['Servicio', (c) => `<b>${esc(c.service)}</b>`], ['Capacidades', (c) => esc(c.capabilities)], ['Estado', (c) => `<span class="tag warn">${esc(c.status.replaceAll('_', ' '))}</span>`],
        ['Acceso', (c) => esc(c.access)], ['Cuenta', (c) => esc(c.account) || '—'], ['Credenciales', (c) => esc(c.credentials_required)], ['Coste', (c) => esc(c.cost)],
        ['Última prueba', (c) => fmtDate(c.last_check)], ['Revocación', (c) => esc(c.revocation)]], rows)}`;
  },

  async aprobaciones() {
    const rows = await api('/api/approvals');
    return `<h1>Aprobaciones</h1>${meta('local · solo se deciden aquí, nunca por voz o chat')}
      ${table([['#', (a) => a.id], ['Tipo', (a) => esc(a.kind)], ['Descripción', (a) => esc(a.description)], ['Cuenta', (a) => esc(a.account_label) || '—'],
        ['Importe máx.', (a) => (a.max_amount_cents == null ? '—' : usd(a.max_amount_cents))], ['Válida hasta', (a) => fmtDate(a.valid_until)], ['Solicitada por', (a) => esc(a.requested_by)],
        ['Estado', (a) => `<span class="tag">${esc(a.status)}</span>`],
        ['', (a) => (a.status === 'pendiente' ? `<button class="ctl resume" data-approve="${a.id}">Aprobar</button> <button class="ctl" data-reject="${a.id}">Rechazar</button>` : '')]], rows)}`;
  },

  async actividad() {
    const rows = await api('/api/audit');
    return `<h1>Registro de actividad</h1>${meta('audit_log (solo inserción)')}
      ${table([['Fecha', (r) => fmtDate(r.at)], ['Actor', (r) => esc(r.actor)], ['Acción', (r) => `<code>${esc(r.action)}</code>`], ['Detalle', (r) => esc(JSON.stringify(r.details))]], rows)}`;
  },

  async ajustes() {
    const reduce = store('jarvis.reduceMotion') === '1';
    return `<h1>Configuración y privacidad</h1>${meta('local')}
      <h2>Interfaz</h2><label><input type="checkbox" id="reduce" ${reduce ? 'checked' : ''}> Reducir movimiento (escena estática)</label>
      <label style="display:block;margin-top:8px">Calidad gráfica de la escena <select id="quality">${['baja', 'media', 'alta'].map((q) => `<option value="${q}" ${(store('kratos.quality') || 'media') === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
      <h2>Voz</h2>${await voiceSettings()}
      <h2>Privacidad</h2>
      <div class="note">
        · El panel solo escucha en <code>127.0.0.1:7420</code>: no es accesible desde otra máquina.<br>
        · Hoy no sale ningún dato de tu computadora: no hay IA ni servicios conectados.<br>
        · Voz: el audio solo viaja de este navegador a 127.0.0.1 y se transcribe en tu Mac con whisper.cpp. El archivo temporal se borra al terminar; no se guardan grabaciones.<br>
        · Respuesta hablada: voces del sistema macOS. Las marcadas «local» no usan internet.<br>
        · El micrófono solo se abre mientras mantienes pulsado el botón (verás la franja roja y el punto naranja de macOS).<br>
        · Secretos: irán al Llavero de macOS, nunca a archivos del proyecto ni al registro.<br>
        · La voz reconocida nunca autoriza pagos, borrados, accesos ni cambios de seguridad.
      </div>
      <h2>Niveles de autonomía</h2>
      <div class="note">Actual: <b>0 · demostración</b>. 1 lectura y borradores · 2 ejecución local reversible · 3 acciones externas aprobadas · 4 optimización limitada. El nivel nunca sube solo.</div>`;
  },
};

async function voiceSettings() {
  const st = await api('/api/voice/status');
  let mics = [];
  try { mics = await voice.devices(); } catch {}
  const voices = voice.spanishVoices();
  const s = st.summary || {};
  return `<div class="note">Motor: ${st.whisper && st.model ? '<span class="tag real">whisper.cpp local listo</span>' : '<span class="tag bad">whisper.cpp o modelo no encontrado</span>'} · Grabaciones guardadas: <b>no</b></div>
    <form class="stack" onsubmit="return false">
      <label>Micrófono<br><select id="mic-select"><option value="">Predeterminado del sistema</option>${mics.map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === voice.deviceId ? 'selected' : ''}>${esc(d.label || 'Micrófono (concede permiso para ver el nombre)')}</option>`).join('')}</select></label>
      <label>Voz de respuesta<br><select id="tts-select"><option value="">Automática (primera voz local en español)</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === voice.voiceURI ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)} · ${v.localService ? 'local' : 'EN LA NUBE'}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="speak-toggle" ${voice.speakReplies ? 'checked' : ''}> Responder también en voz alta</label>
      ${isNative ? `<label><input type="checkbox" id="wake-toggle" ${app.wake?.enabled !== false ? 'checked' : ''}> Activación por voz: decir «Kratos» (micrófono siempre abierto mientras la app esté abierta)</label>
      <div class="meta">Estado de la escucha: ${esc(app.wake?.state ?? 'desconocido')} · Frases: «Kratos, Kratos» o «Hey Kratos»</div>
      <label>Sensibilidad del detector<br><input type="range" id="cfg-sensitivity" min="0" max="1" step="0.1" value="${app.wake?.cfg?.sensitivity ?? 0.5}"></label>
      <label>Ventana entre «Kratos» y «Kratos» (segundos)<br><input type="number" id="cfg-wakeWindow" min="1" max="6" step="0.5" value="${app.wake?.cfg?.wakeWindow ?? 3}"></label>
      <label>Tiempo de espera tras despertar (segundos)<br><input type="number" id="cfg-followUp" min="3" max="30" step="1" value="${app.wake?.cfg?.followUp ?? 8}"></label>` : '<div class="meta">La activación diciendo «Kratos» solo está disponible en la app Kratos del Escritorio.</div>'}
      <button class="ctl" id="tts-test" type="button">Probar voz</button>
    </form>
    <h2>Latencia medida (mediana, últimos 30 días, ${s.n ?? 0} conversaciones de voz)</h2>
    <div class="grid">
      <div class="card"><div class="k">Transcripción</div><div class="v">${s.stt_p50 != null ? s.stt_p50 + ' ms' : '—'}</div></div>
      <div class="card"><div class="k">Respuesta de Kratos</div><div class="v">${s.think_p50 != null ? s.think_p50 + ' ms' : '—'}</div></div>
      <div class="card"><div class="k">Inicio de la voz</div><div class="v">${s.tts_p50 != null ? s.tts_p50 + ' ms' : '—'}</div></div>
    </div>
    ${table([['Fecha', (r) => fmtDate(r.at)], ['Audio', (r) => (r.audio_ms ?? '—') + ' ms'], ['Transcripción', (r) => (r.stt_ms ?? '—') + ' ms'], ['Respuesta', (r) => (r.think_ms ?? '—') + ' ms'], ['Voz', (r) => (r.tts_start_ms ?? '—') + ' ms'], ['Resultado', (r) => esc(r.outcome)]], st.recent)}`;
}

function msgHtml(m) {
  return `<div class="msg ${esc(m.role)}">${esc(m.content)}<small>${m.role === 'usuario' ? 'Tú' : 'Kratos'} · ${esc(m.channel)} · ${fmtDate(m.created_at)}</small></div>`;
}

async function render() {
  const onHome = app.screen === 'inicio';
  $('#stage').hidden = !onHome;
  if (onHome) { scene.start(); refreshAgents(); }
  const main = $('#main');
  try { main.innerHTML = await screens[app.screen](); }
  catch (e) { main.innerHTML = `<h1>Sin conexión con Kratos</h1><p class="meta">${esc(e.message)}. Comprueba que el servicio esté activo.</p>`; }
  paintChrome();
  const log = $('#log'); if (log) log.scrollTop = log.scrollHeight;
}

function go(screen) {
  app.screen = screen;
  store('jarvis.screen', screen);
  document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.screen === screen ? 'page' : 'false'));
  render();
}

async function say(text, channel = 'texto') {
  if (!text.trim()) return null;
  app.thinking = true; paintChrome();
  let reply = null;
  try { reply = await api('/api/chat', { text, channel }); app.completedUntil = Date.now() + 3000; }
  catch (e) { toast(`Error: ${e.message}`); }
  finally { app.thinking = false; await refreshOverview(); if (app.screen === 'conversacion') render(); }
  return reply;
}

// Pulsar para hablar: transcripción local → misma conversación → respuesta breve hablada, detalle en pantalla.
async function pttStop() {
  const t = await voice.stop();
  if (!t) return;
  toast(`Oí: «${t.text}»`);
  const t0 = performance.now();
  const reply = await say(t.text, 'voz');
  const thinkMs = Math.round(performance.now() - t0);
  if (!reply) return;
  if (app.screen !== 'conversacion') toast(reply.text.split('\n')[0]);
  const ttsStartMs = await voice.speak(reply.spoken);
  api('/api/voice/latency', { metricId: t.metricId, thinkMs, ttsStartMs }).catch(() => {});
}

// ---------- escena de KRATOS (estados reales) ----------
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// El panel muestra el mismo universo 3D de KRATOS, integrado y sin controles propios
const sceneFrame = document.createElement('iframe');
sceneFrame.src = '/prototipo/?embed=1';
sceneFrame.title = 'Universo de KRATOS';
sceneFrame.className = 'universe-frame';
$('#scene').append(sceneFrame);
const inner = (fn, ...args) => { try { sceneFrame.contentWindow?.[fn]?.(...args); } catch {} };
const scene = { set() {}, start() {}, pulse() { inner('kratosSpeechPulse'); } };
const SCENE_CAPTION = {
  reposo: 'En reposo. No está escuchando una orden ni ejecutando tareas.',
  despertar: 'Despierto: te escucho.', escuchando: 'Escuchando (el núcleo sigue el nivel real del micrófono).',
  pensando: 'Pensando.', hablando: 'Hablando (el núcleo late con cada palabra).',
  ejecutando: 'Ejecutando: solo se iluminan los especialistas con una tarea en curso.',
  esperando_permiso: 'Esperando tu permiso: revisa «Aprobaciones».', detenido: 'Detenido.',
};
const PLANETS = new Set(AGENTS.map((a) => a.id));

function sceneState() {
  const s = computeState();
  if (s === 'detenido' || s === 'error' || s === 'desconectado') return 'detenido';
  if (Date.now() < app.wokeUntil) return 'despertar';
  const w = app.wake?.state;
  if (s === 'escuchando' || (app.awake && w === 'Te escucho…')) return 'escuchando';
  if (s === 'transcribiendo' || s === 'pensando' || (app.awake && w === 'Procesando…')) return 'pensando';
  if (s === 'hablando' || w === 'Respondiendo') return 'hablando';
  if (s === 'ejecutando') return 'ejecutando';
  // Una aprobación nueva despliega la constelación 2 minutos; después, el aviso queda en la barra superior.
  const latest = app.overview?.latestApprovalAt ? new Date(app.overview.latestApprovalAt).getTime() : 0;
  if (s === 'esperando_permiso' && Date.now() - latest < 120_000) return 'esperando_permiso';
  return 'reposo';
}

function paintScene() {
  const state = sceneState();
  const active = (app.overview?.running ?? []).map((t) => t.owner_function).filter((id) => PLANETS.has(id));
  scene.set({ state, active });
  const cap = $('#scene-caption');
  if (cap) cap.textContent = `${SCENE_CAPTION[state]}${active.length ? ` En curso: ${active.map((id) => AGENTS.find((a) => a.id === id).name).join(', ')}.` : ''}`;
  renderAgentList(active);
}

async function refreshAgents() {
  try { app.agents = await api('/api/agents'); } catch { return; }
  paintScene();
  if (app.selected) showAgent(app.selected);
}

function renderAgentList(active) {
  const list = $('#agent-list');
  if (!list) return;
  const busy = new Set(active);
  const key = JSON.stringify([active, app.selected, app.agents.map((d) => d.current_task?.id ?? 0)]);
  if (list.dataset.key === key) return; // no redibujar sin cambios: conserva el foco del teclado
  list.dataset.key = key;
  list.innerHTML = AGENTS.map((a) => {
    const d = app.agents.find((x) => x.id === a.id);
    const st = busy.has(a.id) ? 'trabajando' : d?.current_task ? 'con tarea en cola' : 'disponible';
    return `<li><button data-agent="${a.id}" aria-pressed="${app.selected === a.id}"><span class="sym" aria-hidden="true">${a.symbol}</span>
      <span><b>${a.name}</b><br><span class="st">${esc(a.role)}</span></span><span class="st ${busy.has(a.id) ? 'on' : ''}">${st}</span></button></li>`;
  }).join('');
}

function showAgent(id) {
  app.selected = id;
  scene.set({ selected: id });
  const box = $('#agent-detail');
  if (!id) { box.hidden = true; return; }
  const a = AGENTS.find((x) => x.id === id), d = app.agents.find((x) => x.id === id);
  box.hidden = false;
  box.innerHTML = `<div class="k">${a.symbol} ${esc(a.name)}</div><p>${esc(d?.purpose ?? a.role)}</p>
    <p class="meta">Tarea actual: ${d?.current_task ? `#${d.current_task.id} ${esc(d.current_task.title)} (${esc(d.current_task.status)})` : 'ninguna'}<br>
    Último resultado verificado: ${d?.last_result ? `#${d.last_result.id} ${esc(d.last_result.title)} · ${fmtDate(d.last_result.at)}` : 'ninguno todavía'}<br>
    Entregables: ${esc((d?.deliverables ?? []).join(', '))}<br>Prohibido: ${esc((d?.prohibited ?? []).join(', ').replaceAll('_', ' '))}</p>
    <button class="ctl" data-agent-close>Cerrar</button>`;
  renderAgentList((app.overview?.running ?? []).map((t) => t.owner_function));
}
$('#scene').addEventListener('agent-select', (e) => showAgent(e.detail));
$('#stage').addEventListener('click', (e) => {
  const b = e.target.closest('[data-agent]');
  if (b) showAgent(b.dataset.agent === app.selected ? null : b.dataset.agent);
  if (e.target.closest('[data-agent-close]')) showAgent(null);
});

// ---------- puente con la app de Mac ----------
window.kratosRefresh = async () => { await refreshOverview(); render(); };
window.kratosNativeState = (state, enabled, cfg) => {
  app.wake = { state, enabled, cfg };
  inner('kratosNativeState', state, enabled);
  if (state === 'Di «Kratos»' || state === 'Escucha apagada') app.awake = false; // vuelve a reposo tras la respuesta
  paintChrome();
};
window.kratosWoke = () => { app.wokeUntil = Date.now() + 1800; app.awake = true; toast('Kratos ha despertado'); paintChrome(); inner('kratosWoke'); };
window.kratosMicLevel = (v) => inner('kratosMicLevel', v);
window.kratosSpeechPulse = () => scene.pulse();

// ---------- eventos ----------
$('#nav').innerHTML = SCREENS.map(([id, label]) => `<button data-screen="${id}">${label}${id === 'aprobaciones' ? '<span class="badge" hidden></span>' : ''}</button>`).join('');
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-screen]'); if (b) go(b.dataset.screen); });

$('#btn-stop').addEventListener('click', async () => {
  if (app.overview?.state.emergency_stop) {
    if (!confirm('¿Reanudar Kratos? Las tareas canceladas no se reanudan solas.')) return;
    await api('/api/resume', {}); toast('Kratos reanudado.');
  } else {
    const r = await api('/api/emergency-stop', {});
    toast(`Parada activada. Tareas canceladas: ${r.cancelled.length}. ${r.external.campanas_externas}`);
  }
  await refreshOverview(); render();
});
$('#btn-pause').addEventListener('click', async () => {
  await api('/api/automations', { paused: !app.overview?.state.automations_paused });
  await refreshOverview(); render();
});
$('#btn-cancel').addEventListener('click', async () => {
  for (const t of app.overview?.running ?? []) await api(`/api/tasks/${t.id}/cancel`, {});
  toast('Tareas en ejecución canceladas.'); await refreshOverview(); render();
});

const ptt = $('#btn-ptt');
ptt.addEventListener('pointerdown', (e) => { e.preventDefault(); ptt.setPointerCapture(e.pointerId); voice.start(); });
ptt.addEventListener('pointerup', () => pttStop());
ptt.addEventListener('pointercancel', () => voice.cancel());
$('#btn-mute').addEventListener('click', () => voice.setMuted(!voice.muted));
$('#btn-hush').addEventListener('click', () => voice.interrupt());
const typing = (el) => el && (el.matches('input, textarea, select, [contenteditable]'));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !typing(document.activeElement) && !e.target.closest('button')) { e.preventDefault(); voice.start(); }
  if (e.key === 'Escape') { voice.cancel(); voice.interrupt(); }
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space' && voice.state === 'escuchando') { e.preventDefault(); pttStop(); } });
voice.addEventListener('change', (e) => { if (e.detail.error) toast(e.detail.error); paintChrome(); });
voice.addEventListener('level', (e) => { const m = $('#meter'); if (m) m.style.width = `${Math.min(100, e.detail * 220)}%`; scene.set({ level: Math.min(1, e.detail * 2.2) }); });
voice.addEventListener('pulse', () => scene.pulse());
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (app.screen === 'ajustes') render(); });
speechSynthesis.addEventListener?.('voiceschanged', () => { if (app.screen === 'ajustes') render(); });

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.say) return say(t.dataset.say);
  if (t.id === 'tts-test') { const was = voice.speakReplies; voice.speakReplies = true; await voice.speak('Hola, soy Kratos. Así sueno.'); voice.speakReplies = was; return; }
  if (t.dataset.cancel) { await api(`/api/tasks/${t.dataset.cancel}/cancel`, {}); return render(); }
  if (t.dataset.approve || t.dataset.reject) {
    const id = t.dataset.approve || t.dataset.reject;
    if (t.dataset.approve && !confirm(`¿Aprobar la solicitud #${id}?`)) return;
    const r = await api(`/api/approvals/${id}`, { approve: !!t.dataset.approve });
    toast(r.ok ? 'Decisión registrada.' : r.reason); await refreshOverview(); return render();
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'composer') { const i = $('#say'); const v = i.value; i.value = ''; return say(v); }
  if (e.target.id === 'new-business') {
    const data = Object.fromEntries(new FormData(e.target));
    try { await api('/api/businesses', data); toast('Expediente creado.'); render(); } catch (err) { toast(err.message); }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'mic-select') voice.setDevice(e.target.value);
  if (e.target.id === 'tts-select') voice.setVoice(e.target.value);
  if (e.target.id === 'speak-toggle') voice.setSpeak(e.target.checked);
  if (e.target.id === 'wake-toggle') voice.setWake(e.target.checked);
  if (e.target.id?.startsWith('cfg-')) voice.setWakeConfig({ [e.target.id.slice(4)]: Number(e.target.value) });
  if (e.target.id === 'reduce') { store('jarvis.reduceMotion', e.target.checked ? '1' : '0'); document.body.classList.toggle('reduce-motion', e.target.checked); scene.set({ reducedMotion: e.target.checked || prefersReduced }); }
  if (e.target.id === 'quality') { store('kratos.quality', e.target.value); scene.set({ quality: e.target.value }); }
});

document.body.classList.toggle('reduce-motion', store('jarvis.reduceMotion') === '1');
const saved = store('jarvis.screen');
await refreshOverview();
go(SCREENS.some(([id]) => id === saved) ? saved : 'inicio');
setInterval(refreshOverview, 4000);
setInterval(() => { if (app.screen === 'inicio') refreshAgents(); }, 8000);
setInterval(paintScene, 500); // transiciones con reloj (despertar, ventana de aprobación)
setInterval(() => { if (!['conversacion', 'negocios'].includes(app.screen)) render(); }, 10000);
