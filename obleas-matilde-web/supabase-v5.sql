-- =====================================================================
--  OBLEAS MATILDE · Actualización 5 (descartes)
--
--  - Descartes: sacar del inventario productos o insumos que se dañaron o no
--    cumplieron la calidad, y calcular la pérdida de cada uno.
--    · Un insumo descartado baja su existencia (en g, ml o u).
--    · Un producto descartado (una oblea, un boli...) baja su stock y los
--      insumos de su receta, igual que si se hubiera vendido, pero sin venta.
--    · La pérdida es lo que costó producir lo descartado.
--  - Un descarte se puede anular: devuelve todo al inventario.
--  - El respaldo incluye los descartes.
--
--  Va después de supabase-v4.sql. No cambia precios ni borra ventas.
--  Pega TODO en Supabase > SQL Editor y presiona "Run". Se puede ejecutar dos veces.
-- =====================================================================

do $estructura$
begin
create table if not exists public.descartes (
  id          uuid primary key default gen_random_uuid(),
  fecha       timestamptz not null default now(),
  dia         date not null,
  producto_id text not null,
  nombre      text not null,
  tipo        text not null,
  cantidad    numeric not null check (cantidad > 0),
  unidad      text not null default 'u',
  costo       numeric not null default 0,              -- pérdida total del descarte
  motivo      text not null default '',
  consumo     jsonb not null default '[]'::jsonb,      -- insumos que se sacaron del inventario
  stock_desc  int,                                     -- unidades de stock (a mano) que se sacaron
  anulado     boolean not null default false
);
create index if not exists descartes_dia on public.descartes (dia);
alter table public.descartes enable row level security;
revoke all on public.descartes from anon, authenticated;
end
$estructura$;

create or replace function public._descarte_json(d public.descartes) returns jsonb
language sql stable as $$
  select jsonb_build_object('uid', d.id, 'date', d.fecha, 'day', d.dia, 'product', d.producto_id, 'name', d.nombre,
                            'type', d.tipo, 'qty', d.cantidad, 'unit', d.unidad, 'cost', d.costo, 'reason', d.motivo,
                            'consumo', d.consumo, 'void', d.anulado)
$$;

-- Registrar un descarte. p_cantidad: unidades del producto, o g / ml / u del insumo.
create or replace function public.admin_descartar(p_clave text, p_id text, p_cantidad numeric, p_motivo text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  e text := _acceso('admin', p_clave); p productos%rowtype; ins productos%rowtype; r record;
  q numeric := p_cantidad; v_dia date; cons jsonb := '{}'::jsonb; consumo jsonb := '[]'::jsonb;
  v_costo numeric := 0; st int; d descartes%rowtype;
begin
  if e is not null then return _err(e); end if;
  select * into p from productos where id = p_id for update;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  if q is null or q <= 0 or q > 1000000 then raise exception 'CANTIDAD_INVALIDA'; end if;
  if p.tipo <> 'insumo' and (q <> trunc(q) or q > 1000) then raise exception 'CANTIDAD_INVALIDA'; end if;
  -- la pérdida cuenta en el día de trabajo (el de la caja abierta, o hoy)
  select dia into v_dia from cajas where cerrada_en is null limit 1;
  v_dia := coalesce(v_dia, _hoy());

  if p.tipo = 'insumo' then
    update productos set existencia = existencia - q where id = p.id and existencia is not null;
    v_costo := coalesce(q * p.precio / nullif(p.contenido, 0), 0);
    consumo := jsonb_build_array(jsonb_build_object('id', p.id, 'name', p.nombre, 'unit', p.unidad, 'qty', round(q, 2), 'cost', round(v_costo, 2)));
  else
    if p.stock is not null then
      if p.stock < q then raise exception 'SIN_STOCK:%', p.nombre; end if;
      update productos set stock = stock - q::int where id = p.id;
      st := q::int;
    end if;
    -- los insumos de la receta salen igual que en una venta (las unidades, exactas)
    for r in select rc.insumo_id, rc.cantidad, i.unidad from recetas rc join productos i on i.id = rc.insumo_id
              where rc.producto_id = p.id loop
      cons := jsonb_set(cons, array[r.insumo_id],
                to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0)
                         + r.cantidad * q * case when r.unidad = 'u' then 1 else 1 + p.merma / 100 end));
    end loop;
    for r in select key as id, value::numeric as cant from jsonb_each_text(cons) order by key loop
      update productos set existencia = existencia - r.cant where id = r.id and existencia is not null;
      select * into ins from productos where id = r.id;
      consumo := consumo || jsonb_build_object('id', ins.id, 'name', ins.nombre, 'unit', ins.unidad,
                   'qty', round(r.cant, 2), 'cost', round(r.cant * ins.precio / nullif(ins.contenido, 0), 2));
    end loop;
    v_costo := coalesce(_costo_unit(p.id), 0) * q;
  end if;

  insert into descartes (dia, producto_id, nombre, tipo, cantidad, unidad, costo, motivo, consumo, stock_desc)
  values (v_dia, p.id, p.nombre, p.tipo, q, case when p.tipo = 'insumo' then p.unidad else 'u' end,
          round(v_costo, 2), left(coalesce(p_motivo, ''), 200), consumo, st)
  returning * into d;
  return _descarte_json(d);
end $$;

-- Descartes entre dos fechas (sin fechas: los últimos 30 días)
create or replace function public.admin_descartes(p_clave text, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(_descarte_json(d) order by d.fecha desc), '[]'::jsonb)
            from (select * from descartes
                   where dia between coalesce(p_desde, _hoy() - 30) and coalesce(p_hasta, _hoy())
                   order by fecha desc limit 2000) d);
end $$;

-- Anular un descarte: devuelve el stock y los insumos
create or replace function public.admin_anular_descarte(p_clave text, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave); d descartes%rowtype; x jsonb;
begin
  if e is not null then return _err(e); end if;
  select * into d from descartes where id = p_uid for update;
  if not found then raise exception 'DESCARTE_NO_EXISTE'; end if;
  if not d.anulado then
    update descartes set anulado = true where id = p_uid;
    if d.stock_desc is not null then
      update productos set stock = stock + d.stock_desc where id = d.producto_id and stock is not null;
    end if;
    for x in select value from jsonb_array_elements(d.consumo) order by value->>'id' loop
      update productos set existencia = existencia + (x->>'qty')::numeric where id = x->>'id' and existencia is not null;
    end loop;
  end if;
  return 'true'::jsonb;
end $$;

-- El respaldo ahora también guarda los descartes
create or replace function public.admin_respaldo(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return jsonb_build_object(
    'version', 5,
    'products',  (select coalesce(jsonb_agg(_producto_json(p) order by p.nombre), '[]'::jsonb) from productos p),
    'sales',     (select coalesce(jsonb_agg(_venta_json(v, true) order by v.fecha), '[]'::jsonb) from ventas v),
    'cajas',     (select coalesce(jsonb_agg(_caja_json(c, true) order by c.abierta_en), '[]'::jsonb) from cajas c),
    'descartes', (select coalesce(jsonb_agg(_descarte_json(d) order by d.fecha), '[]'::jsonb) from descartes d));
end $$;

revoke all on function public._descarte_json(public.descartes) from public, anon, authenticated;
grant execute on function public.admin_descartar(text, text, numeric, text), public.admin_descartes(text, date, date),
                          public.admin_anular_descarte(text, uuid), public.admin_respaldo(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
