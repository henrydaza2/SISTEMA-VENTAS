-- YA NO HACE FALTA: supabase-v3.sql incluye esta misma corrección.
-- OBLEAS MATILDE · Corrección de 3 insumos. Ejecutar las DOS instrucciones, una por una.

-- 1) Devolver Lluvia, Chispitas y Leche condensada a insumos
update public.productos set
  tipo = 'insumo', categoria = 'Insumos', unidad = 'g', stock = null,
  acepta_adicionales = false, salsas_incluidas = 0,
  precio    = case when id = 'ins-leche-condensada' then 67000 else 30000 end,
  costo     = case when id = 'ins-leche-condensada' then 67000 else 30000 end,
  contenido = case when id = 'ins-leche-condensada' then 5000 else 1000 end,
  minimo    = case when id = 'ins-leche-condensada' then 1000 else 200 end
where id in ('ins-lluvia-chocolate', 'ins-chispitas', 'ins-leche-condensada');

-- 2) Recetas de los adicionales que usan esos insumos
insert into public.recetas (producto_id, insumo_id, cantidad) values
  ('add-lluvia-chocolate', 'ins-lluvia-chocolate', 15),
  ('add-chispitas', 'ins-chispitas', 15),
  ('add-leche-condensada', 'ins-leche-condensada', 25)
on conflict do nothing;
