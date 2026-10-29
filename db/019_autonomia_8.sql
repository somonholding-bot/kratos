-- Autonomía nivel 8 (decidida por el propietario el 29-oct-2026): KRATOS puede diagnosticarse y proponer cambios
-- en su propio código; cada cambio exige aprobación en el panel, respaldo, pruebas y vuelta atrás automática.
UPDATE system_state SET value = '8', updated_at = now(), updated_by = 'propietario' WHERE key = 'autonomy_level';
