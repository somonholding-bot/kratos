-- Canal de YouTube del propietario con acceso completo (credencial y permiso en el Llavero: kratos-google).
-- KRATOS sube vídeos como privados y los edita; publicarlos exige la aprobación del propietario en el panel.
UPDATE connections SET capabilities = 'Canal, vídeos y analítica; subir vídeos (privados) y editarlos; publicar con tu aprobación', access = 'lectura_escritura',
  credentials_required = 'Credencial de Google (Llavero: kratos-google) y autorización con scripts/conectar-youtube.ts', revocation = 'myaccount.google.com › Seguridad › Apps con acceso'
WHERE service = 'YouTube';
