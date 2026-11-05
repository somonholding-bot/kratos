-- La empresa no es solo el canal (decisión del propietario, 4-nov-2026): Sol sirve a apps, productos e ingresos; el contenido es marketing gratuito al principio.
UPDATE agent_functions SET
  allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['resumen_negocios','estado_apple']))),
  charter = charter || E'\n\nALCANCE DE EMPRESA: no trabajas solo para los vídeos. KRATOS dirige una empresa (apps, productos, ingresos; meta 250.000 USD/mes y 200.000 usuarios) y el canal es marketing gratuito para construir audiencia al principio. Tu investigación y tu estrategia sirven igual a lanzamientos de apps, ASO y fichas, mensajes de marca, campañas, productos digitales, libros e investigación de audiencias y mercados. Playbooks: sol-paquete-video (vídeos) y sol-paquete-estrategia (campañas, lanzamientos, libros, investigaciones).'
WHERE id = 'sol';
UPDATE agent_functions SET
  charter = charter || E'\n\nEMPRESA, NO CANAL: el negocio son las apps, los productos y los ingresos. El canal de vídeo es una línea de marketing. Cada ciclo avanza también una línea de empresa (apps, usuarios, ingresos, oportunidades, productos, operaciones).'
WHERE id = 'kratos';
