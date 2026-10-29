// Clima actual y de hoy para una ciudad (Open-Meteo, gratis y sin clave)
async function main(input) {
  const ciudad = String(input.ciudad || 'New York');
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=${encodeURIComponent(ciudad)}`)).json();
  // la más poblada entre las coincidencias (evita «York, Nebraska» al pedir New York)
  const all = g.results ?? [], towns = all.filter((r) => /^PPL/.test(r.feature_code ?? ''));
  const p = (towns.length ? towns : all).sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  if (!p) return { error: `No encuentro «${ciudad}»` };
  const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`)).json();
  const CODES = { 0: 'despejado', 1: 'casi despejado', 2: 'parcialmente nublado', 3: 'nublado', 45: 'niebla', 48: 'niebla', 51: 'llovizna', 61: 'lluvia ligera', 63: 'lluvia', 65: 'lluvia fuerte', 71: 'nieve ligera', 73: 'nieve', 75: 'nieve fuerte', 80: 'chubascos', 81: 'chubascos', 82: 'chubascos fuertes', 95: 'tormenta' };
  return {
    lugar: `${p.name}, ${p.admin1 ?? ''} ${p.country ?? ''}`.trim(),
    ahora: { temperatura_c: w.current.temperature_2m, sensacion_c: w.current.apparent_temperature, cielo: CODES[w.current.weather_code] ?? `código ${w.current.weather_code}`, viento_kmh: w.current.wind_speed_10m },
    hoy: { maxima_c: w.daily.temperature_2m_max[0], minima_c: w.daily.temperature_2m_min[0], probabilidad_lluvia: w.daily.precipitation_probability_max[0] },
  };
}
