-- Las apps del propietario (App Store Connect) pasan a ser un negocio real con un producto por app,
-- para que KRATOS y sus agentes puedan asignarles tareas, planes y métricas.
INSERT INTO businesses (name, is_demo) SELECT 'Apps de Idalmi', false WHERE NOT EXISTS (SELECT 1 FROM businesses WHERE name = 'Apps de Idalmi');
INSERT INTO products (business_id, name, platforms)
SELECT (SELECT id FROM businesses WHERE name = 'Apps de Idalmi'), a.name, ARRAY[coalesce(a.platform, 'IOS')]
FROM app_store_apps a WHERE NOT EXISTS (SELECT 1 FROM products p WHERE lower(p.name) = lower(a.name));
