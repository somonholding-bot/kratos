-- El ciclo del CEO vuelve a comprobar cada 20 minutos; solo gasta cuando hay algo que revisar o trabajo pendiente en la fábrica de Aion
UPDATE tasks SET recurrence_minutes = 20 WHERE type = 'ciclo_ceo' AND status IN ('pendiente', 'esperando_ia', 'en_ejecucion');
