-- =====================================================================
--  OBLEAS MATILDE · Gramajes reales y precios nuevos (opción A)
--  - 48 g de arequipe por oblea y 48 g de queso en las que llevan queso.
--  - Los 48 g ya incluyen la pérdida: merma 0 % en las obleas y el adicional queso.
--  - Galletas: 2,3 por oblea (2 + 15 % que se rompen), para no perder esa merma.
--  - Queso a $30.000 el kilo (bloque de 4 kg = $120.000).
--  - Precios: $4.000 / $5.500 / $6.500 / $7.500; adicional queso $2.000.
--    Las de queso trabajan con ~44 % de costo (el queso se come parte del margen)
--    para no subir tanto; la solo arequipe sube $500 y compensa.
--  Pega TODO en Supabase > SQL Editor y presiona "Run". Se puede ejecutar dos veces.
-- =====================================================================

-- Queso: bloque de 4 kg a $120.000 (la existencia contada no cambia)
update public.productos set contenido = 4000, unidad = 'g', precio = 120000, costo = 120000
 where id = 'ins-queso';

-- Recetas de las 4 obleas y del adicional queso
insert into public.recetas (producto_id, insumo_id, cantidad)
select v.p, v.i, v.c from (values
  ('oblea-arequipe',       'ins-obleas',   2.3),
  ('oblea-arequipe',       'ins-arequipe', 48),
  ('oblea-arequipe-queso', 'ins-obleas',   2.3),
  ('oblea-arequipe-queso', 'ins-arequipe', 48),
  ('oblea-arequipe-queso', 'ins-queso',    48),
  ('oblea-1-salsa',        'ins-obleas',   2.3),
  ('oblea-1-salsa',        'ins-arequipe', 48),
  ('oblea-1-salsa',        'ins-queso',    48),
  ('oblea-3-salsas',       'ins-obleas',   2.3),
  ('oblea-3-salsas',       'ins-arequipe', 48),
  ('oblea-3-salsas',       'ins-queso',    48),
  ('add-queso',            'ins-queso',    48)
) as v(p, i, c)
where exists (select 1 from public.productos where id = v.p)
  and exists (select 1 from public.productos where id = v.i and tipo = 'insumo')
on conflict (producto_id, insumo_id) do update set cantidad = excluded.cantidad;

-- Los 48 g ya son lo real: sin merma extra en las obleas ni en el adicional queso
update public.productos set merma = 0
 where id in ('oblea-arequipe','oblea-arequipe-queso','oblea-1-salsa','oblea-3-salsas','add-queso');

-- Precios nuevos
update public.productos set precio = 4000 where id = 'oblea-arequipe';
update public.productos set precio = 5500 where id = 'oblea-arequipe-queso';
update public.productos set precio = 6500 where id = 'oblea-1-salsa';
update public.productos set precio = 7500 where id = 'oblea-3-salsas';
update public.productos set precio = 2000 where id = 'add-queso';

-- Revisión: costo y margen de cada uno
select p.nombre, p.precio::int as precio, round(public._costo_unit(p.id)) as costo_sin_salsas,
       p.salsas_incluidas as salsas_incluidas
  from public.productos p
 where p.id in ('oblea-arequipe','oblea-arequipe-queso','oblea-1-salsa','oblea-3-salsas','add-queso')
 order by p.precio;
