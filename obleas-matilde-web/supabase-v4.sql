-- =====================================================================
--  OBLEAS MATILDE · Actualización 4 (galletas exactas)
--
--  - El paquete de obleas x 100 surte TODAS las obleas del menú: cada oblea
--    vendida descuenta exactamente 2 galletas.
--  - Los insumos que se cuentan por unidades (u), como las galletas, se
--    descuentan exactos, sin merma. La merma (%) sigue aplicando a lo que se
--    mide en gramos o mililitros (arequipe, queso, salsas...).
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

revoke all on function public._costo_unit(text), public._armar(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
