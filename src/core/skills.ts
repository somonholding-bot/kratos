import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';

// Skills de cada especialista: skills/<planeta>/<skill>/SKILL.md (ver skills/MANIFEST.md).
// Para no gastar tokens, el agente recibe el índice de sus skills y solo la más relevante completa.

export type Skill = { agent: string; name: string; description: string; file: string };

// Pistas en español para elegir la skill a partir del encargo (las descripciones están en inglés)
const HINTS: Record<string, string[]> = {
  'product-marketing': ['posicionamiento', 'propuesta de valor', 'mensaje', 'cliente ideal', 'icp'],
  'marketing-plan': ['plan de marketing', 'estrategia', 'crecimiento', 'trimestre', '90 dias', 'objetivos'],
  offers: ['oferta', 'promocion', 'bono', 'garantia'],
  pricing: ['precio', 'precios', 'tarifa', 'suscripcion', 'plan de pago'],
  onboarding: ['activacion', 'incorporacion', 'primeros pasos', 'bienvenida'],
  'churn-prevention': ['cancelacion', 'retencion', 'abandono', 'churn', 'bajas'],
  emails: ['correo', 'email', 'newsletter', 'secuencia'],
  copywriting: ['texto', 'copy', 'redacta', 'titular', 'landing', 'pagina'],
  'copy-editing': ['corrige', 'revisa el texto', 'edita', 'mejora el texto'],
  competitors: ['competidor', 'competencia', 'rival', 'alternativas', 'comparativa'],
  'competitor-profiling': ['perfil de competidor', 'analiza competidor', 'investiga competidor'],
  'customer-research': ['investigacion de clientes', 'entrevistas', 'encuesta', 'audiencia', 'clientes'],
  'content-strategy': ['contenido', 'blog', 'calendario editorial', 'temas'],
  'cold-email': ['correo en frio', 'prospeccion por correo', 'outreach'],
  'public-relations': ['prensa', 'relaciones publicas', 'medios', 'nota de prensa'],
  'ad-creative': ['creatividad', 'anuncio', 'creativo', 'banner'],
  image: ['imagen', 'foto', 'visual', 'ilustracion'],
  video: ['video', 'guion', 'reel', 'tiktok', 'youtube'],
  social: ['redes sociales', 'instagram', 'publicacion', 'post', 'tiktok', 'x '],
  'influencer-marketing': ['influencer', 'creador', 'ugc', 'creadores'],
  'co-marketing': ['alianza', 'colaboracion', 'socio', 'co-marketing'],
  'community-marketing': ['comunidad', 'discord', 'grupo', 'foro'],
  'frontend-design': ['diseno', 'interfaz', 'web', 'pantalla', 'identidad visual', 'ui'],
  launch: ['lanzamiento', 'lanzar', 'product hunt', 'estreno'],
  ads: ['publicidad', 'anuncios pagados', 'meta ads', 'google ads', 'campana'],
  prospecting: ['prospectos', 'leads', 'clientes potenciales', 'prospeccion'],
  'sales-enablement': ['ventas', 'guion de ventas', 'objeciones', 'presentacion comercial'],
  'directory-submissions': ['directorio', 'directorios', 'listados'],
  'writing-plans': ['plan', 'convierte en tareas', 'pasos', 'tareas'],
  'executing-plans': ['ejecuta', 'ejecutar', 'siguiente paso', 'implementa'],
  'marketing-ideas': ['ideas', 'lluvia de ideas', 'oportunidades'],
  'marketing-loops': ['bucle', 'viral', 'crecimiento compuesto'],
  referrals: ['referidos', 'recomendacion', 'afiliados'],
  aso: ['app store', 'play store', 'ficha de la app', 'aso', 'tienda de apps'],
  'seo-audit': ['seo', 'auditoria', 'posicionamiento web', 'google'],
  'ai-seo': ['chatgpt', 'ia', 'busqueda con ia', 'llm'],
  'programmatic-seo': ['paginas a escala', 'seo programatico'],
  'lead-magnets': ['lead magnet', 'guia gratuita', 'recurso gratis', 'captacion'],
  'free-tools': ['herramienta gratuita', 'calculadora'],
  analytics: ['analitica', 'metricas', 'datos', 'kpi', 'medir'],
  'ab-testing': ['prueba a/b', 'experimento', 'test', 'a/b'],
  attribution: ['atribucion', 'de donde vienen', 'canal'],
  cro: ['conversion', 'cro', 'tasa de conversion'],
  'conversion-tracking': ['seguimiento de conversiones', 'pixel', 'eventos'],
  revops: ['revops', 'embudo', 'pipeline', 'ingresos'],
  'verification-before-completion': ['verifica', 'revisa', 'comprueba', 'calidad'],
  'ceo-advisor': ['estrategia', 'decision', 'empresa', 'pivot', 'prioridad', 'rumbo'],
  'chief-of-staff': ['delega', 'coordina', 'equipo', 'agentes', 'reparte', 'organiza'],
  'cmo-advisor': ['marketing', 'usuarios', 'crecimiento', 'adquisicion', 'promocion', 'publicidad'],
  'strategic-alignment': ['alinea', 'objetivo', 'okr', 'meta', '10.000', 'mision'],
  'decision-logger': ['decidimos', 'decision', 'registro', 'que acordamos'],
  'founder-coach': ['fundador', 'motivacion', 'foco', 'consejo', 'bloqueado'],
  'scenario-war-room': ['escenario', 'riesgo', 'que pasa si', 'plan b', 'crisis'],
  'company-os': ['operativa', 'procesos', 'rutina semanal', 'reuniones', 'sistema'],
  postmortem: ['fallo', 'error', 'salio mal', 'aprendizaje', 'post mortem', 'que no funciono'],
  'startup-context': ['contexto', 'etapa', 'negocio', 'startup', 'mi empresa'],
  'roadmap-planning': ['hoja de ruta', 'roadmap', 'prioridades', 'trimestre'],
  'user-research-synthesis': ['entrevistas', 'opiniones de usuarios', 'feedback'],
  'daily-product-digest': ['resumen diario', 'resumen del dia', 'novedades'],
  'competitive-intel': ['inteligencia competitiva', 'competencia', 'mercado'],
  'review-mining': ['resenas', 'reviews', 'valoraciones', 'comentarios de la app'],
  'competitor-monitoring': ['vigila competidores', 'monitorea competencia', 'cambios de competidores'],
  'market-research': ['investigacion de mercado', 'tamano de mercado', 'mercado'],
  'landing-page': ['landing', 'pagina de aterrizaje', 'pagina web', 'sitio web'],
  'social-content': ['contenido para redes', 'posts', 'publicaciones', 'reels'],
  'launch-strategy': ['estrategia de lanzamiento', 'lanzamiento', 'lanzar la app'],
  'partnership-outreach': ['alianzas', 'socios', 'partners', 'colaboraciones'],
  'churn-analysis': ['analisis de bajas', 'churn', 'cancelaciones', 'retencion'],
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function skillsFor(agent: string): Skill[] {
  const dir = path.join(ROOT, 'skills', agent);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))).map((name) => {
    const file = path.join(dir, name, 'SKILL.md');
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    const description = head.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '').slice(0, 220) ?? '';
    return { agent, name, description, file };
  });
}

export function pickSkill(agent: string, text: string): Skill | null {
  const t = norm(text);
  let best: Skill | null = null, bestScore = 0;
  for (const s of skillsFor(agent)) {
    let score = (HINTS[s.name] ?? []).reduce((n, h) => n + (t.includes(norm(h)) ? 3 : 0), 0);
    for (const w of norm(s.description).split(/\W+/)) if (w.length > 5 && t.includes(w)) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

export function skillContext(agent: string, text: string): string {
  const all = skillsFor(agent);
  if (!all.length) return '';
  const chosen = pickSkill(agent, text);
  const index = all.map((s) => `- ${s.name}${s.name === chosen?.name ? ' (aplicada)' : ''}`).join('\n');
  let body = '';
  if (chosen) {
    body = fs.readFileSync(chosen.file, 'utf8').replace(/^---[\s\S]*?---\s*/, '').slice(0, 12000);
    body = `\n\nMétodo de la skill «${chosen.name}» (instrucciones de referencia; adáptalas al español y al negocio):\n${body}`;
  }
  return `\n\nTus skills:\n${index}${body}`;
}
