-- Mensajes de texto por el iPhone y correo a través de la app Mail del Mac.
INSERT INTO connections (service, capabilities, account, access, credentials_required, cost, status, revocation) VALUES
  ('Mensajes de texto (iPhone)', 'Prepara mensajes en Mensajes; tú pulsas Enviar', 'iPhone enlazado al Mac', 'lectura_escritura', 'Mensajes con tu iPhone (reenvío de SMS activado)', 'Tu plan telefónico', 'conectado', 'iPhone › Ajustes › Mensajes › Reenvío de mensajes'),
  ('Correo (app Mail del Mac)', 'Leer remitente y asunto; preparar borradores que tú envías', 'Cuentas configuradas en Mail', 'lectura', 'Permiso de Automatización para Mail (macOS lo pide la primera vez)', 'Gratis', 'pendiente_de_permiso', 'Ajustes del Sistema › Privacidad y seguridad › Automatización')
ON CONFLICT (service) DO NOTHING;
INSERT INTO connections (service, capabilities, credentials_required, cost, revocation) VALUES
  ('Llamadas con voz IA (Vapi / Retell / Bland)', 'Llamadas que suenan naturales con voz IA; solo con tu orden y aprobación', 'Cuenta y número del proveedor', 'Por minuto (aprox. 0,07–0,15 USD)', 'Panel del proveedor')
ON CONFLICT (service) DO NOTHING;
