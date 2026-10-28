// Propuesta visual de KRATOS: estados simulados con el selector.
import { createScene, AGENTS } from '/kratos-scene.js';

const STATES = {
  reposo: { label: 'Reposo', active: [], text: 'Sin interacción. El zorro pasea o descansa en su franja; el fuego es suave. No indica que esté grabando ni trabajando.' },
  despertar: { label: 'Despertar', active: [], text: 'Tras «Kratos, Kratos» o «Hey Kratos»: se detiene, mira hacia el núcleo, la cola se aviva y se despliega la constelación.' },
  escuchando: { label: 'Escuchando', active: [], text: 'El núcleo responde al nivel del micrófono (aquí, simulado).' },
  pensando: { label: 'Pensando', active: [], text: 'Latido lento del núcleo y sinapsis girando mientras Claude responde.' },
  hablando: { label: 'Hablando', active: [], text: 'El núcleo sigue el audio de salida (aquí, simulado).' },
  ejecutando: { label: 'Ejecutando', active: ['marte', 'saturno'], text: 'Ejemplo: «Convierte esto en tareas». Solo Marte y Saturno se iluminan y conectan con el núcleo; el resto permanece tenue.' },
  esperando_permiso: { label: 'Esperando permiso', active: [], text: 'Saturno marca el límite en ámbar: hace falta tu aprobación en el panel.' },
  detenido: { label: 'Detenido', active: [], text: 'Parada de emergencia: tono rojo, fuego mínimo, sin actividad.' },
};
const EXAMPLE = { marte: 'Convertir la decisión en 4 tareas (ejemplo)', saturno: 'Revisar dependencias y fechas (ejemplo)' };

const scene = createScene(document.getElementById('scene'), { quality: 'media', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
document.getElementById('reduced').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
let current = 'reposo';

const statesEl = document.getElementById('states');
statesEl.innerHTML = Object.entries(STATES).map(([id, s]) => `<button data-state="${id}" aria-pressed="false">${s.label}</button>`).join('');
function setState(id) {
  current = id;
  scene.set({ state: id, active: STATES[id].active });
  statesEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.state === id)));
  document.getElementById('desc').textContent = STATES[id].text;
  renderAgents();
}
statesEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setState(b.dataset.state); });

function renderAgents() {
  const active = new Set(STATES[current].active);
  document.getElementById('agents').innerHTML = AGENTS.map((a) => `<li><button data-agent="${a.id}">
    <span class="sym" aria-hidden="true">${a.symbol}</span><span><b>${a.name}</b><br><span class="st">${a.role}</span></span>
    <span class="st ${active.has(a.id) ? 'on' : ''}">${active.has(a.id) ? 'trabajando' : 'disponible'}</span></button></li>`).join('');
}
function showAgent(id) {
  const d = document.getElementById('detail');
  scene.set({ selected: id });
  if (!id) { d.hidden = true; return; }
  const a = AGENTS.find((x) => x.id === id);
  const busy = STATES[current].active.includes(id);
  d.hidden = false;
  d.innerHTML = `<h2>${a.symbol} ${a.name}</h2><p>${a.role}</p>
    <p class="meta">Estado: ${busy ? 'trabajando' : 'disponible'}<br>Tarea actual: ${busy ? EXAMPLE[id] : '—'}<br>Último resultado verificado: — (propuesta)</p>`;
}
document.getElementById('agents').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showAgent(b.dataset.agent); });
document.getElementById('scene').addEventListener('agent-select', (e) => showAgent(e.detail));
document.getElementById('quality').addEventListener('change', (e) => scene.set({ quality: e.target.value }));
document.getElementById('reduced').addEventListener('change', (e) => { document.getElementById('scene').classList.toggle('reduced', e.target.checked); scene.set({ reducedMotion: e.target.checked }); });

// Nivel de audio SIMULADO para la propuesta (en el producto vendrá del micrófono o de la voz real).
setInterval(() => {
  if (current === 'escuchando' || current === 'hablando') scene.set({ level: Math.abs(Math.sin(performance.now() / 180)) * (0.4 + Math.random() * 0.6) });
  document.getElementById('fps').textContent = `${scene.fps} fps · ${scene.drawMs.toFixed(2)} ms de dibujo por fotograma`;
}, 90);

renderAgents();
setState('reposo');
