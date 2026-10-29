// Tiempo y distancia en coche entre dos lugares (Nominatim + OSRM, gratis y sin clave; sin tráfico en tiempo real)
async function main(input) {
  const geo = async (q) => {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'KRATOS-asistente-personal' } })).json();
    if (!r[0]) throw new Error(`No encuentro «${q}»`);
    return { lat: Number(r[0].lat), lon: Number(r[0].lon), nombre: r[0].display_name.split(',').slice(0, 3).join(',') };
  };
  const a = await geo(String(input.origen)), b = await geo(String(input.destino));
  const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`)).json();
  const route = r.routes?.[0];
  if (!route) return { error: 'No hay ruta en coche entre esos lugares' };
  const min = Math.round(route.duration / 60);
  return { origen: a.nombre, destino: b.nombre, distancia_km: Math.round(route.distance / 100) / 10, minutos_sin_trafico: min,
    nota: 'Estimación sin tráfico; en hora punta puede tardar bastante más.' };
}
