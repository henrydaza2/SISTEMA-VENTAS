-- =====================================================================
--  OBLEAS MATILDE · Actualización 4 (galletas exactas)
--
--  - El paquete de obleas x 100 surte TODAS las obleas del menú: cada oblea
--    vendida descuenta exactamente 2 galletas.
--    También las obleas que se creen o renombren después, aunque se edite la receta.
--  - Los insumos que se cuentan por unidades (u), como las galletas, se
--    descuentan exactos, sin merma. La merma (%) sigue aplicando a lo que se
--    mide en gramos o mililitros (arequipe, queso, salsas...).
--  - Estimado de cuántos productos alcanzan con los insumos que quedan.
--  - Los vendedores pueden VER el inventario y la caja con su PIN, sin cambiar
--    nada y sin ver costos, ganancias ni el resultado del cierre.
--
--  Va después de supabase-v3.sql. No cambia precios ni borra ventas.
--  Pega TODO en Supabase > SQL Editor y presiona "Run". Se puede ejecutar dos veces.
-- =====================================================================

-- Todas las obleas del menú usan 2 galletas del paquete x 100
insert into public.recetas (producto_id, insumo_id, cantidad)
select p.id, 'ins-obleas', 2
  from public.productos p
 where p.tipo = 'venta' and (p.nombre ilike '%oblea%' or p.categoria ilike '%oblea%')
   and exists (select 1 from public.productos where id = 'ins-obleas' and tipo = 'insumo')
on conflict (producto_id, insumo_id) do update set cantidad = 2;

-- Costo de una unidad: la merma solo se suma a lo que no se cuenta por unidades
create or replace function public._costo_unit(p_id text) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from recetas where producto_id = p.id) then
      (select coalesce(sum(r.cantidad * i.precio / nullif(i.contenido, 0)
                           * case when i.unidad = 'u' then 1 else 1 + p.merma / 100 end), 0)
         from recetas r join productos i on i.id = r.insumo_id
        where r.producto_id = p.id)
    else p.costo end
  from productos p where p.id = p_id
$$;

-- Arma una venta (igual que en v3; los insumos por unidades se descuentan sin merma)
create or replace function public._armar(p_items jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  it jsonb; p productos%rowtype; a productos%rowtype; r record; ins productos%rowtype;
  q int; aid text; adds jsonb; uprice numeric; ucost numeric; bcost numeric; acost numeric; incl int; aprice numeric;
  items jsonb := '[]'::jsonb; sub numeric := 0; costo numeric := 0;
  cons jsonb := '{}'::jsonb; consumo jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'VENTA_VACIA';
  end if;

  -- bloquea los productos siempre en el mismo orden: dos ventas a la vez no se traban
  perform 1 from productos where id in (select x->>'id' from jsonb_array_elements(p_items) x) order by id for update;

  for it in select value from jsonb_array_elements(p_items) loop
    q := _num(it->>'qty')::int;
    if q is null or q < 1 or q > 1000 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select * into p from productos where id = it->>'id' and tipo = 'venta';
    if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
    if p.stock is not null then
      if p.stock < q then raise exception 'SIN_STOCK:%', p.nombre; end if;
      update productos set stock = stock - q where id = p.id;
    end if;

    bcost := coalesce(_costo_unit(p.id), 0);
    uprice := p.precio; ucost := bcost; adds := '[]'::jsonb;
    for r in select rc.insumo_id, rc.cantidad, i.unidad from recetas rc join productos i on i.id = rc.insumo_id
              where rc.producto_id = p.id loop
      cons := jsonb_set(cons, array[r.insumo_id],
                to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0)
                         + r.cantidad * q * case when r.unidad = 'u' then 1 else 1 + p.merma / 100 end));
    end loop;

    if jsonb_typeof(it->'adds') = 'array' and jsonb_array_length(it->'adds') > 0 then
      if jsonb_array_length(it->'adds') > 20 then raise exception 'VALOR_INVALIDO'; end if;
      if not p.acepta_adicionales then raise exception 'NO_ACEPTA_ADICIONALES'; end if;
      incl := p.salsas_incluidas;
      for aid in select t.v from jsonb_array_elements_text(it->'adds') with ordinality as t(v, n) group by t.v order by min(t.n) loop
        select * into a from productos where id = aid and tipo = 'adicional';
        if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
        acost := coalesce(_costo_unit(a.id), 0);
        if a.es_salsa and incl > 0 then aprice := 0; incl := incl - 1; else aprice := a.precio; end if;
        adds := adds || jsonb_build_object('id', a.id, 'name', a.nombre, 'price', aprice, 'cost', round(acost, 2), 'incl', aprice = 0 and a.es_salsa);
        uprice := uprice + aprice; ucost := ucost + acost;
        for r in select rc.insumo_id, rc.cantidad, i.unidad from recetas rc join productos i on i.id = rc.insumo_id
                  where rc.producto_id = a.id loop
          cons := jsonb_set(cons, array[r.insumo_id],
                    to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0)
                             + r.cantidad * q * case when r.unidad = 'u' then 1 else 1 + a.merma / 100 end));
        end loop;
      end loop;
    end if;

    items := items || jsonb_build_object('id', p.id, 'name', p.nombre, 'cat', p.categoria,
               'base', p.precio, 'base_cost', round(bcost, 2), 'adds', adds,
               'price', uprice, 'cost', round(ucost, 2), 'qty', q);
    sub := sub + uprice * q;
    costo := costo + ucost * q;
  end loop;

  for r in select key as id, value::numeric as cant from jsonb_each_text(cons) order by key loop
    update productos set existencia = existencia - r.cant where id = r.id and existencia is not null;
    select * into ins from productos where id = r.id;
    consumo := consumo || jsonb_build_object('id', ins.id, 'name', ins.nombre, 'unit', ins.unidad,
                 'qty', round(r.cant, 2), 'cost', round(r.cant * ins.precio / nullif(ins.contenido, 0), 2));
  end loop;

  return jsonb_build_object('items', items, 'subtotal', sub, 'costo', round(costo, 2), 'consumo', consumo);
end $$;

-- =====================================================================
--  Galletas automáticas: toda oblea del menú (también las que se creen o
--  renombren después) lleva 2 galletas, aunque la receta se edite.
-- =====================================================================
create or replace function public._es_oblea(p_id text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from productos where id = p_id and tipo = 'venta'
                 and (nombre ilike '%oblea%' or categoria ilike '%oblea%'))
$$;

-- Pone (o devuelve) las 2 galletas a las obleas que no las tengan
create or replace function public._asegurar_galletas() returns void
language sql set search_path = public, pg_temp as $$
  insert into recetas (producto_id, insumo_id, cantidad)
  select p.id, 'ins-obleas', 2 from productos p
   where p.tipo = 'venta' and (p.nombre ilike '%oblea%' or p.categoria ilike '%oblea%')
     and exists (select 1 from productos where id = 'ins-obleas' and tipo = 'insumo')
     and not exists (select 1 from recetas r where r.producto_id = p.id and r.insumo_id = 'ins-obleas')
  on conflict (producto_id, insumo_id) do nothing
$$;

-- En una oblea, las galletas siempre son 2 (aunque se escriba otro número)
create or replace function public._tg_galletas_fijas() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.insumo_id = 'ins-obleas' and _es_oblea(new.producto_id) then new.cantidad := 2; end if;
  return new;
end $$;

create or replace function public._tg_galletas_reponer() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  perform _asegurar_galletas();
  return null;
end $$;

drop trigger if exists galletas_fijas on public.recetas;
create trigger galletas_fijas before insert or update on public.recetas
  for each row execute function public._tg_galletas_fijas();
-- si al editar una oblea se borra su receta, las galletas vuelven solas
drop trigger if exists galletas_reponer_recetas on public.recetas;
create trigger galletas_reponer_recetas after delete on public.recetas
  for each statement execute function public._tg_galletas_reponer();
-- obleas nuevas o renombradas reciben sus galletas
drop trigger if exists galletas_reponer_productos on public.productos;
create trigger galletas_reponer_productos after insert or update of nombre, categoria, tipo on public.productos
  for each statement execute function public._tg_galletas_reponer();

select public._asegurar_galletas();
update public.recetas set cantidad = 2 where insumo_id = 'ins-obleas' and public._es_oblea(producto_id) and cantidad <> 2;

-- =====================================================================
--  Cuántos productos alcanzan con los insumos que quedan
--  (null si no tiene receta o algún insumo no se ha contado)
-- =====================================================================
create or replace function public._alcanza(p_id text) returns int
language sql stable set search_path = public, pg_temp as $$
  select case when count(*) = 0 or bool_or(i.existencia is null) then null
              else greatest(floor(min(i.existencia / nullif(r.cantidad * case when i.unidad = 'u' then 1 else 1 + p.merma / 100 end, 0))), 0)::int end
    from productos p join recetas r on r.producto_id = p.id join productos i on i.id = r.insumo_id
   where p.id = p_id
$$;

create or replace function public._producto_json(p public.productos) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.nombre, 'cat', p.categoria, 'type', p.tipo,
    'price', p.precio, 'cost', p.costo, 'stock', p.stock, 'min', p.minimo,
    'unit', p.unidad, 'content', p.contenido, 'qty', p.existencia,
    'merma', p.merma, 'adds_ok', p.acepta_adicionales, 'incl', p.salsas_incluidas, 'salsa', p.es_salsa,
    'recipe', (select coalesce(jsonb_agg(jsonb_build_object('id', r.insumo_id, 'qty', r.cantidad) order by r.insumo_id), '[]'::jsonb)
                 from recetas r where r.producto_id = p.id),
    'alcanza', case when p.tipo = 'venta' then _alcanza(p.id) end,
    'unit_cost', round(_costo_unit(p.id) + p.salsas_incluidas *
                   coalesce((select avg(_costo_unit(s.id)) from productos s where s.es_salsa), 0), 2))
$$;

-- Menú para vender, ahora con el estimado de cuántos alcanzan
create or replace function public.catalogo() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'productos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nombre, 'cat', categoria, 'price', precio,
                    'stock', stock, 'min', minimo, 'adds_ok', acepta_adicionales, 'incl', salsas_incluidas, 'alcanza', _alcanza(id))
                    order by categoria, precio, nombre), '[]'::jsonb)
                  from productos where tipo = 'venta'),
    'adicionales', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nombre, 'price', precio, 'salsa', es_salsa)
                    order by es_salsa desc, nombre), '[]'::jsonb)
                  from productos where tipo = 'adicional'))
$$;

-- =====================================================================
--  Vendedores: ver inventario y caja con su PIN, SIN poder cambiar nada
--  y sin ver costos, ganancias ni el resultado del cierre de caja.
-- =====================================================================
create or replace function public.vend_inventario(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('pin', p_pin);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.nombre, 'cat', p.categoria, 'type', p.tipo,
            'price', case when p.tipo <> 'insumo' then p.precio end,
            'stock', p.stock, 'min', p.minimo, 'unit', p.unidad, 'content', p.contenido, 'qty', p.existencia,
            'merma', p.merma, 'adds_ok', p.acepta_adicionales, 'incl', p.salsas_incluidas, 'salsa', p.es_salsa,
            'recipe', (select coalesce(jsonb_agg(jsonb_build_object('id', r.insumo_id, 'qty', r.cantidad) order by r.insumo_id), '[]'::jsonb)
                         from recetas r where r.producto_id = p.id),
            'alcanza', case when p.tipo = 'venta' then _alcanza(p.id) end)
          order by p.tipo desc, p.categoria, p.nombre), '[]'::jsonb) from productos p);
end $$;

-- Caja del día de trabajo (el de la caja abierta, o hoy): ventas y totales, sin costos ni conteo
create or replace function public.vend_caja(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('pin', p_pin); v_dia date;
begin
  if e is not null then return _err(e); end if;
  select dia into v_dia from cajas where cerrada_en is null limit 1;
  v_dia := coalesce(v_dia, _hoy());
  return jsonb_build_object(
    'dia', v_dia,
    'ventas', (select coalesce(jsonb_agg(_venta_json(v, false) order by v.orden), '[]'::jsonb) from ventas v where v.dia = v_dia),
    'cajas', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'abierta', c.cerrada_en is null, 'desde', c.abierta_en, 'hasta', c.cerrada_en, 'base', c.base,
                'efectivo',      (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'efectivo'),
                'transferencia', (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'transferencia'),
                'ventas',        (select count(*) from ventas where caja_id = c.id and not anulada))
              order by c.abierta_en), '[]'::jsonb) from cajas c where c.dia = v_dia),
    'consumo', (select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'name', x->>'name', 'unit', x->>'unit', 'qty', x->'qty')), '[]'::jsonb)
                  from ventas v, jsonb_array_elements(v.consumo) x where v.dia = v_dia and not v.anulada));
end $$;

revoke all on function public._costo_unit(text), public._armar(jsonb), public._es_oblea(text), public._asegurar_galletas(),
                       public._tg_galletas_fijas(), public._tg_galletas_reponer(), public._alcanza(text), public._producto_json(public.productos)
  from public, anon, authenticated;
grant execute on function public.catalogo(), public.vend_inventario(text), public.vend_caja(text) to anon, authenticated;

notify pgrst, 'reload schema';
