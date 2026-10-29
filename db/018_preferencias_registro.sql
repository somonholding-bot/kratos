-- Preferencias permanentes del propietario: se inyectan en cada conversación (sobreviven a cerrar y reiniciar).
CREATE TABLE IF NOT EXISTS preferences (
  id serial PRIMARY KEY,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
-- Las que el propietario ya pidió (estaban solo como notas en la bóveda)
INSERT INTO preferences (text)
SELECT v FROM (VALUES
  ('No uses el nombre del propietario en las respuestas; solo en el saludo de la mañana o en un momento formal. Nunca «señor» salvo en ese saludo.'),
  ('Respuestas habladas breves: 1 a 3 frases, salvo que pida detalle.'),
  ('Ubicación de referencia: Hampton, Virginia (Estados Unidos).')
) AS p(v)
WHERE NOT EXISTS (SELECT 1 FROM preferences);
