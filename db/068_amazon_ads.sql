-- Amazon Ads (solo lectura) para aprender de las campañas antiguas de los libros del propietario.
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['amazon_ads']))) WHERE id IN ('mercurio','sol','jupiter','venus');
