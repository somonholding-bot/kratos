-- Júpiter (cartera y experimentos) y Mercurio pueden crear productos con enlace de pago y leer ventas de KRATOS en Stripe.
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['stripe_ventas']))) WHERE id IN ('jupiter','mercurio');
