-- El propietario (1-nov-2026): el CEO no debe decidir cada 20 minutos. Cada hora mira si los agentes terminaron algo;
-- solo entonces se reúne (revisa, aprende, asigna). Revisión estratégica cada 6 h. Sin novedades, no gasta nada.
UPDATE tasks SET recurrence_minutes = 60 WHERE type = 'ciclo_ceo' AND status IN ('pendiente', 'esperando_ia', 'en_ejecucion');
