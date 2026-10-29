-- Contactos propios de KRATOS (no lee la agenda de macOS) y llamadas desde el iPhone del propietario vía el Mac.
CREATE TABLE IF NOT EXISTS contacts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_name ON contacts (lower(name));

INSERT INTO connections (service, capabilities, account, access, credentials_required, cost, status, revocation) VALUES
  ('Llamadas desde tu iPhone (Mac)', 'KRATOS marca cuando tú se lo ordenas; tú confirmas con «Llamar» en FaceTime', 'iPhone enlazado al Mac (Continuidad)', 'lectura_escritura',
   'iPhone con «Llamadas en otros dispositivos» activado para este Mac', 'Tu plan telefónico', 'conectado', 'iPhone › Ajustes › Teléfono › Llamadas en otros dispositivos')
ON CONFLICT (service) DO NOTHING;
