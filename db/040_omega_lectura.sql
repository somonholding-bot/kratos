-- Omega: lectura real de textos de acceso abierto. El código lleva la cuenta de cuánto se leyó; «texto_completo» solo se marca al llegar al 90 %.
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS longitud int;
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS leido_hasta int NOT NULL DEFAULT 0;
