-- El propietario (1-nov-2026): el canal de YouTube es en inglés; YouTube traduce y dobla automáticamente a otros idiomas.
INSERT INTO preferences (text, active)
SELECT 'El canal de YouTube es en INGLÉS (títulos, guiones, voz, miniaturas, descripción y etiquetas). YouTube traduce y dobla automáticamente a otros idiomas. Las respuestas al propietario siguen en español.', true
WHERE NOT EXISTS (SELECT 1 FROM preferences WHERE text LIKE 'El canal de YouTube es en INGLÉS%');
