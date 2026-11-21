-- =====================================================================
--  OBLEAS MATILDE · Actualización 2
--  Caja (abrir / cerrar), adicionales, recetas e insumos en gramos,
--  costo de producción y ganancia, editar ventas, descuento de meseros.
--
--  Pega TODO este archivo en Supabase > SQL Editor y presiona "Run".
--  Va encima de supabase.sql (que ya ejecutaste). No borra ventas.
--  Se puede ejecutar más de una vez.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Los cambios de estructura van dentro de un bloque DO porque el verificador
-- del SQL Editor de Supabase no reconoce "add column if not exists".
do $estructura$
begin
-- ---------- Productos: nuevos campos ----------
alter table public.productos add column if not exists unidad text not null default 'u';
alter table public.productos add column if not exists contenido numeric;          -- insumos: cuánto trae cada paquete (g o u)
alter table public.productos add column if not exists existencia numeric;         -- insumos: cuánto queda (g o u); null = sin registrar
alter table public.productos add column if not exists merma numeric not null default 0;  -- % extra de insumos por pérdida
alter table public.productos add column if not exists acepta_adicionales boolean not null default false;
alter table public.productos add column if not exists salsas_incluidas int not null default 0;   -- salsas que ya van en el precio
alter table public.productos add column if not exists es_salsa boolean not null default false;    -- adicionales que son salsas
alter table public.productos drop constraint if exists productos_tipo_check;
alter table public.productos add constraint productos_tipo_check check (tipo in ('venta','adicional','insumo'));

-- Receta: cuánto de cada insumo usa una unidad de producto (sin merma)
create table if not exists public.recetas (
  producto_id text not null references public.productos(id) on delete cascade,
  insumo_id   text not null references public.productos(id) on delete cascade,
  cantidad    numeric not null check (cantidad > 0),
  primary key (producto_id, insumo_id)
);

-- ---------- Ventas: nuevos campos ----------
alter table public.ventas add column if not exists subtotal  numeric;
alter table public.ventas add column if not exists descuento numeric not null default 0;
alter table public.ventas add column if not exists costo     numeric;
alter table public.ventas add column if not exists consumo   jsonb not null default '[]'::jsonb;
alter table public.ventas add column if not exists caja_id   uuid;
alter table public.ventas add column if not exists editada   timestamptz;
update public.ventas set subtotal = total where subtotal is null;
update public.ventas v set costo = (select coalesce(sum(coalesce((x->>'cost')::numeric, 0) * (x->>'qty')::int), 0)
                                    from jsonb_array_elements(v.items) x)
where costo is null;

-- ---------- Caja ----------
create table if not exists public.cajas (
  id         uuid primary key default gen_random_uuid(),
  dia        date not null,
  abierta_en timestamptz not null default now(),
  base       numeric not null default 0,
  cerrada_en timestamptz,
  contado    numeric,
  esperado   numeric,
  notas      text not null default ''
);
create unique index if not exists cajas_solo_una_abierta on public.cajas ((true)) where cerrada_en is null;

-- ---------- Código de meseros ----------
alter table public.ajustes add column if not exists codigo_mesero text;

alter table public.recetas enable row level security;
alter table public.cajas   enable row level security;
revoke all on public.recetas, public.cajas from anon, authenticated;
end
$estructura$;

-- =====================================================================
--  Datos: insumos, adicionales y recetas
-- =====================================================================

-- Insumos: tamaño del paquete
update public.productos set unidad = 'g', contenido = 5000 where id = 'ins-arequipe' and contenido is null;
update public.productos set unidad = 'u', contenido = 100  where id = 'ins-obleas'   and contenido is null;
update public.productos set unidad = 'g', contenido = 1000
 where id in ('ins-salsa-chocolate','ins-salsa-durazno','ins-salsa-maracuya','ins-salsa-mora','ins-chispitas','ins-lluvia-chocolate')
   and contenido is null;
update public.productos set unidad = 'g', contenido = 5000, nombre = 'Leche condensada galón (5 kg)'
 where id = 'ins-leche-condensada' and contenido is null;

insert into public.productos (id, nombre, categoria, tipo, precio, costo, unidad, contenido, minimo)
values ('ins-queso', 'Queso (bloque 4 kg)', 'Insumos', 'insumo', 0, 0, 'g', 4000, 800)
on conflict (id) do nothing;

-- Alerta de insumos: avisar cuando quede el 20 % de un paquete
update public.productos set minimo = round(contenido * 0.2)
 where tipo = 'insumo' and contenido is not null and minimo <= 1;
update public.productos set costo = precio where tipo = 'insumo';

-- Las 4 obleas del menú. Todas aceptan adicionales; las de salsa dejan elegir cuál(es) van incluidas.
insert into public.productos (id, nombre, categoria, tipo, precio, costo, minimo) values
  ('oblea-arequipe',       'Oblea solo arequipe',               'Obleas', 'venta', 3500, 0, 5),
  ('oblea-arequipe-queso', 'Oblea arequipe + queso',            'Obleas', 'venta', 4500, 0, 5),
  ('oblea-1-salsa',        'Oblea arequipe + queso + 1 salsa',  'Obleas', 'venta', 5500, 0, 5),
  ('oblea-3-salsas',       'Oblea arequipe + queso + 3 salsas', 'Obleas', 'venta', 6500, 0, 5)
on conflict (id) do nothing;
update public.productos set nombre = 'Oblea solo arequipe' where id = 'oblea-arequipe' and nombre = 'Oblea con arequipe';
update public.productos set acepta_adicionales = true, merma = 15
 where id in ('oblea-arequipe','oblea-arequipe-queso','oblea-1-salsa','oblea-3-salsas') and acepta_adicionales = false;
update public.productos set salsas_incluidas = 1 where id = 'oblea-1-salsa'  and salsas_incluidas = 0;
update public.productos set salsas_incluidas = 3 where id = 'oblea-3-salsas' and salsas_incluidas = 0;

-- Adicionales ($1.000 cada uno, se pueden cambiar en Inventario)
insert into public.productos (id, nombre, categoria, tipo, precio, costo, minimo, merma) values
  ('add-queso',           'Queso',               'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-salsa-chocolate', 'Salsa de chocolate',  'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-salsa-mora',      'Salsa de mora',       'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-salsa-maracuya',  'Salsa de maracuyá',   'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-salsa-durazno',   'Salsa de durazno',    'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-lluvia-chocolate','Lluvia de chocolate', 'Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-chispitas',       'Chispitas de colores','Adicionales', 'adicional', 1000, 0, 0, 15),
  ('add-leche-condensada','Leche condensada',    'Adicionales', 'adicional', 1000, 0, 0, 15)
on conflict (id) do nothing;
update public.productos set es_salsa = true
 where id in ('add-salsa-chocolate','add-salsa-mora','add-salsa-maracuya','add-salsa-durazno') and es_salsa = false;

-- Recetas (cantidades por unidad, antes de merma). Las salsas se descuentan según la que elija el cliente.
insert into public.recetas (producto_id, insumo_id, cantidad)
select v.p, v.i, v.c from (values
  ('oblea-arequipe',       'ins-obleas',           2),
  ('oblea-arequipe',       'ins-arequipe',         25),
  ('oblea-arequipe-queso', 'ins-obleas',           2),
  ('oblea-arequipe-queso', 'ins-arequipe',         25),
  ('oblea-arequipe-queso', 'ins-queso',            25),
  ('oblea-1-salsa',        'ins-obleas',           2),
  ('oblea-1-salsa',        'ins-arequipe',         25),
  ('oblea-1-salsa',        'ins-queso',            25),
  ('oblea-3-salsas',       'ins-obleas',           2),
  ('oblea-3-salsas',       'ins-arequipe',         25),
  ('oblea-3-salsas',       'ins-queso',            25),
  ('add-queso',            'ins-queso',            25),
  ('add-salsa-chocolate',  'ins-salsa-chocolate',  25),
  ('add-salsa-mora',       'ins-salsa-mora',       25),
  ('add-salsa-maracuya',   'ins-salsa-maracuya',   25),
  ('add-salsa-durazno',    'ins-salsa-durazno',    25),
  ('add-lluvia-chocolate', 'ins-lluvia-chocolate', 15),
  ('add-chispitas',        'ins-chispitas',        15),
  ('add-leche-condensada', 'ins-leche-condensada', 25)
) as v(p, i, c)
where exists (select 1 from public.productos where id = v.p)
  and exists (select 1 from public.productos where id = v.i and tipo = 'insumo')
on conflict do nothing;

-- =====================================================================
--  Ayudas internas
-- =====================================================================

create or replace function public._verificar_pin(p_pin text) returns void
language plpgsql set search_path = public, extensions as $$
declare v text;
begin
  select pin_vendedor into v from ajustes where id = 1;
  if v is not null and (p_pin is null or crypt(p_pin, v) <> v) then
    perform pg_sleep(1);
    raise exception 'PIN_INCORRECTO';
  end if;
end $$;

-- Costo de producción de una unidad: receta x precio del insumo, más la merma.
-- Si no tiene receta, usa el costo escrito a mano.
create or replace function public._costo_unit(p_id text) returns numeric
language sql stable set search_path = public as $$
  select case
    when exists (select 1 from recetas where producto_id = p.id) then
      (select coalesce(sum(r.cantidad * i.precio / nullif(i.contenido, 0)), 0)
         from recetas r join productos i on i.id = r.insumo_id
        where r.producto_id = p.id) * (1 + p.merma / 100)
    else p.costo end
  from productos p where p.id = p_id
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
    -- costo de una unidad; si trae salsas incluidas, suma el costo promedio de una salsa por cada una
    'unit_cost', round(_costo_unit(p.id) + p.salsas_incluidas *
                   coalesce((select avg(_costo_unit(s.id)) from productos s where s.es_salsa), 0), 2))
$$;

create or replace function public._venta_json(v public.ventas, con_costo boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', coalesce(v.ref, v.id::text), 'uid', v.id, 'date', v.fecha, 'day', v.dia, 'order', v.orden,
    'subtotal', coalesce(v.subtotal, v.total), 'discount', v.descuento, 'total', v.total,
    'pay', v.pago, 'received', v.recibido, 'void', v.anulada, 'edited', v.editada, 'caja', v.caja_id,
    'items', case when con_costo then v.items else (
        select coalesce(jsonb_agg((x - 'cost' - 'base_cost') || jsonb_build_object('adds',
                 (select coalesce(jsonb_agg(y - 'cost'), '[]'::jsonb) from jsonb_array_elements(coalesce(x->'adds', '[]'::jsonb)) y))), '[]'::jsonb)
        from jsonb_array_elements(v.items) x) end)
  || case when con_costo then jsonb_build_object('cost', coalesce(v.costo, 0), 'consumo', v.consumo) else '{}'::jsonb end
$$;

-- Arma los productos de una venta: precios, adicionales, costos y consumo de insumos.
-- También descuenta el stock de productos y la existencia de insumos.
-- p_items: [{ "id": "...", "qty": 2, "adds": ["add-queso", ...] }]
create or replace function public._armar(p_items jsonb) returns jsonb
language plpgsql set search_path = public as $$
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

  for it in select value from jsonb_array_elements(p_items) loop
    q := (it->>'qty')::int;
    if q is null or q < 1 or q > 1000 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select * into p from productos where id = it->>'id' and tipo = 'venta' for update;
    if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
    if p.stock is not null then
      if p.stock < q then raise exception 'SIN_STOCK:%', p.nombre; end if;
      update productos set stock = stock - q where id = p.id;
    end if;

    bcost := coalesce(_costo_unit(p.id), 0);
    uprice := p.precio; ucost := bcost; adds := '[]'::jsonb;
    for r in select insumo_id, cantidad from recetas where producto_id = p.id loop
      cons := jsonb_set(cons, array[r.insumo_id],
                to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0) + r.cantidad * q * (1 + p.merma / 100)));
    end loop;

    if jsonb_typeof(it->'adds') = 'array' and jsonb_array_length(it->'adds') > 0 then
      if not p.acepta_adicionales then raise exception 'NO_ACEPTA_ADICIONALES'; end if;
      incl := p.salsas_incluidas;     -- las primeras salsas elegidas ya van en el precio
      -- en el orden en que se marcaron (sin repetir): las primeras salsas son las incluidas
      for aid in select t.v from jsonb_array_elements_text(it->'adds') with ordinality as t(v, n) group by t.v order by min(t.n) loop
        select * into a from productos where id = aid and tipo = 'adicional';
        if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
        acost := coalesce(_costo_unit(a.id), 0);
        if a.es_salsa and incl > 0 then aprice := 0; incl := incl - 1; else aprice := a.precio; end if;
        adds := adds || jsonb_build_object('id', a.id, 'name', a.nombre, 'price', aprice, 'cost', round(acost, 2), 'incl', aprice = 0 and a.es_salsa);
        uprice := uprice + aprice; ucost := ucost + acost;
        for r in select insumo_id, cantidad from recetas where producto_id = a.id loop
          cons := jsonb_set(cons, array[r.insumo_id],
                    to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0) + r.cantidad * q * (1 + a.merma / 100)));
        end loop;
      end loop;
    end if;

    items := items || jsonb_build_object('id', p.id, 'name', p.nombre, 'cat', p.categoria,
               'base', p.precio, 'base_cost', round(bcost, 2), 'adds', adds,
               'price', uprice, 'cost', round(ucost, 2), 'qty', q);
    sub := sub + uprice * q;
    costo := costo + ucost * q;
  end loop;

  -- descontar insumos (solo los que ya tienen existencia registrada)
  for r in select key as id, value::numeric as cant from jsonb_each_text(cons) loop
    update productos set existencia = existencia - r.cant where id = r.id and existencia is not null;
    select * into ins from productos where id = r.id;
    consumo := consumo || jsonb_build_object('id', ins.id, 'name', ins.nombre, 'unit', ins.unidad,
                 'qty', round(r.cant, 2), 'cost', round(r.cant * ins.precio / nullif(ins.contenido, 0), 2));
  end loop;

  return jsonb_build_object('items', items, 'subtotal', sub, 'costo', round(costo, 2), 'consumo', consumo);
end $$;

-- Devuelve al inventario lo que se descontó en una venta
create or replace function public._revertir(v public.ventas) returns void
language plpgsql set search_path = public as $$
declare x jsonb;
begin
  for x in select value from jsonb_array_elements(v.items) loop
    update productos set stock = stock + (x->>'qty')::int where id = x->>'id' and stock is not null;
  end loop;
  for x in select value from jsonb_array_elements(coalesce(v.consumo, '[]'::jsonb)) loop
    update productos set existencia = existencia + (x->>'qty')::numeric where id = x->>'id' and existencia is not null;
  end loop;
end $$;

create or replace function public._caja_json(c public.cajas, completo boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'abierta', c.cerrada_en is null, 'desde', c.abierta_en, 'dia', c.dia)
  || case when completo then jsonb_build_object(
       'base', c.base, 'hasta', c.cerrada_en, 'contado', c.contado, 'esperado_al_cerrar', c.esperado, 'notas', c.notas,
       'efectivo',      (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'efectivo'),
       'transferencia', (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'transferencia'),
       'ventas',        (select count(*) from ventas where caja_id = c.id and not anulada))
     else '{}'::jsonb end
$$;

-- =====================================================================
--  Funciones públicas (cualquiera con el enlace)
-- =====================================================================

create or replace function public.estado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tiene_clave', a.clave_admin is not null,
    'pide_pin', a.pin_vendedor is not null,
    'pide_mesero', a.codigo_mesero is not null,
    'caja', coalesce((select _caja_json(c, false) from cajas c where c.cerrada_en is null limit 1),
                     jsonb_build_object('abierta', false)))
  from ajustes a where a.id = 1
$$;

-- Menú para vender: productos y adicionales (sin costos)
create or replace function public.catalogo() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'productos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nombre, 'cat', categoria, 'price', precio,
                    'stock', stock, 'min', minimo, 'adds_ok', acepta_adicionales, 'incl', salsas_incluidas)
                    order by categoria, precio, nombre), '[]'::jsonb)
                  from productos where tipo = 'venta'),
    'adicionales', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nombre, 'price', precio, 'salsa', es_salsa)
                    order by es_salsa desc, nombre), '[]'::jsonb)
                  from productos where tipo = 'adicional'))
$$;

create or replace function public.verificar_mesero(p_codigo text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  select codigo_mesero into v from ajustes where id = 1;
  if v is null then raise exception 'SIN_CODIGO_MESERO'; end if;
  if p_codigo is null or crypt(p_codigo, v) <> v then
    perform pg_sleep(1);
    raise exception 'CODIGO_MESERO_INCORRECTO';
  end if;
  return true;
end $$;

create or replace function public.abrir_caja(p_pin text, p_base numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cajas%rowtype;
begin
  perform _verificar_pin(p_pin);
  if exists (select 1 from cajas where cerrada_en is null) then raise exception 'CAJA_YA_ABIERTA'; end if;
  insert into cajas (dia, base) values (_hoy(), greatest(coalesce(p_base, 0), 0)) returning * into c;
  return _caja_json(c, false);
end $$;

-- Al cerrar solo se guarda lo contado; el resultado lo ve el administrador.
create or replace function public.cerrar_caja(p_pin text, p_contado numeric, p_notas text default '') returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare c cajas%rowtype;
begin
  perform _verificar_pin(p_pin);
  select * into c from cajas where cerrada_en is null for update;
  if not found then raise exception 'CAJA_CERRADA'; end if;
  update cajas set cerrada_en = now(), contado = greatest(coalesce(p_contado, 0), 0), notas = coalesce(left(p_notas, 500), ''),
         esperado = c.base + (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'efectivo')
   where id = c.id;
  return true;
end $$;

drop function if exists public.registrar_venta(text, jsonb, text, numeric);
create or replace function public.registrar_venta(p_pin text, p_items jsonb, p_pago text, p_recibido numeric default 0,
                                                  p_descuento numeric default 0, p_codigo text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_dia date := _hoy(); v_caja uuid; v_orden int; v_row ventas%rowtype; arm jsonb; d numeric; v_total numeric;
begin
  perform _verificar_pin(p_pin);
  select id into v_caja from cajas where cerrada_en is null;
  if v_caja is null then raise exception 'CAJA_CERRADA'; end if;
  if p_pago is null or p_pago not in ('efectivo','transferencia') then raise exception 'PAGO_INVALIDO'; end if;

  arm := _armar(p_items);
  d := round(coalesce(p_descuento, 0));
  if d < 0 then raise exception 'DESCUENTO_INVALIDO'; end if;
  if d > 0 then
    perform verificar_mesero(p_codigo);
    if d > (arm->>'subtotal')::numeric then raise exception 'DESCUENTO_MAYOR'; end if;
  end if;
  v_total := (arm->>'subtotal')::numeric - d;

  perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
  select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;

  insert into ventas (dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, caja_id)
  values (v_dia, v_orden, arm->'items', (arm->>'subtotal')::numeric, d, v_total, (arm->>'costo')::numeric, arm->'consumo', p_pago,
          case when p_pago = 'efectivo' and coalesce(p_recibido, 0) >= v_total then p_recibido else 0 end, v_caja)
  returning * into v_row;
  return _venta_json(v_row, false);
end $$;

-- =====================================================================
--  Funciones de administrador (piden la contraseña)
-- =====================================================================

create or replace function public.admin_fijar_codigo_mesero(p_clave text, p_codigo text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  if p_codigo is null or p_codigo = '' then
    update ajustes set codigo_mesero = null where id = 1;
  else
    if length(p_codigo) < 4 then raise exception 'PIN_CORTO'; end if;
    update ajustes set codigo_mesero = crypt(p_codigo, gen_salt('bf', 8)) where id = 1;
  end if;
  return true;
end $$;

create or replace function public.admin_guardar_producto(p_clave text, p_prod jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(p_prod->>'id', ''); v_tipo text; x jsonb;
begin
  perform _verificar_admin(p_clave);
  if coalesce(trim(p_prod->>'name'), '') = '' then raise exception 'NOMBRE_VACIO'; end if;
  v_tipo := case when p_prod->>'type' in ('insumo','adicional') then p_prod->>'type' else 'venta' end;
  if v_id is null then v_id := gen_random_uuid()::text; end if;

  insert into productos (id, nombre, categoria, tipo, precio, costo, stock, minimo, unidad, contenido, existencia, merma, acepta_adicionales,
                         salsas_incluidas, es_salsa)
  values (v_id, trim(p_prod->>'name'),
          coalesce(nullif(trim(p_prod->>'cat'), ''), case v_tipo when 'insumo' then 'Insumos' when 'adicional' then 'Adicionales' else '' end),
          v_tipo,
          greatest(coalesce((p_prod->>'price')::numeric, 0), 0),
          case when v_tipo = 'insumo' then greatest(coalesce((p_prod->>'price')::numeric, 0), 0)
               else greatest(coalesce((p_prod->>'cost')::numeric, 0), 0) end,
          case when v_tipo = 'venta' then (p_prod->>'stock')::int end,
          greatest(coalesce((p_prod->>'min')::numeric, 5), 0)::int,
          case when p_prod->>'unit' in ('g','u','ml') then p_prod->>'unit' else 'u' end,
          case when v_tipo = 'insumo' then nullif(greatest(coalesce((p_prod->>'content')::numeric, 0), 0), 0) end,
          case when v_tipo = 'insumo' then (p_prod->>'qty')::numeric end,
          greatest(coalesce((p_prod->>'merma')::numeric, 0), 0),
          v_tipo = 'venta' and coalesce((p_prod->>'adds_ok')::boolean, false),
          case when v_tipo = 'venta' then least(greatest(coalesce((p_prod->>'incl')::int, 0), 0), 10) else 0 end,
          v_tipo = 'adicional' and coalesce((p_prod->>'salsa')::boolean, false))
  on conflict (id) do update set
    nombre = excluded.nombre, categoria = excluded.categoria, tipo = excluded.tipo, precio = excluded.precio,
    costo = excluded.costo, stock = excluded.stock, minimo = excluded.minimo,
    -- si un respaldo viejo no trae estos datos, se conservan los actuales
    contenido = case when p_prod ? 'content' then excluded.contenido else productos.contenido end,
    unidad = case when p_prod ? 'unit' then excluded.unidad else productos.unidad end,
    merma = case when p_prod ? 'merma' then excluded.merma else productos.merma end,
    acepta_adicionales = case when p_prod ? 'adds_ok' then excluded.acepta_adicionales else productos.acepta_adicionales end,
    salsas_incluidas = case when p_prod ? 'incl' then excluded.salsas_incluidas else productos.salsas_incluidas end,
    es_salsa = case when p_prod ? 'salsa' then excluded.es_salsa else productos.es_salsa end,
    existencia = case when p_prod ? 'qty' then excluded.existencia else productos.existencia end;

  if p_prod ? 'recipe' then
    delete from recetas where producto_id = v_id;
    if v_tipo <> 'insumo' and jsonb_typeof(p_prod->'recipe') = 'array' then
      for x in select value from jsonb_array_elements(p_prod->'recipe') loop
        if (x->>'qty')::numeric > 0 and x->>'id' <> v_id
           and exists (select 1 from productos where id = x->>'id' and tipo = 'insumo') then
          insert into recetas (producto_id, insumo_id, cantidad) values (v_id, x->>'id', (x->>'qty')::numeric)
          on conflict (producto_id, insumo_id) do update set cantidad = excluded.cantidad;
        end if;
      end loop;
    end if;
  end if;
  return v_id;
end $$;

-- Registrar compra de un insumo: suma paquetes y actualiza el precio del paquete
create or replace function public.admin_insumo_compra(p_clave text, p_id text, p_paquetes numeric, p_precio numeric) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
declare v numeric;
begin
  perform _verificar_admin(p_clave);
  if p_paquetes is null or p_paquetes <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  update productos set existencia = coalesce(existencia, 0) + p_paquetes * coalesce(contenido, 1),
                       precio = case when p_precio is not null and p_precio >= 0 then p_precio else precio end,
                       costo  = case when p_precio is not null and p_precio >= 0 then p_precio else costo end
   where id = p_id and tipo = 'insumo' returning existencia into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return v;
end $$;

-- Contar un insumo: fija cuánto hay (en g o u). null = dejar de controlarlo
create or replace function public.admin_insumo_contar(p_clave text, p_id text, p_cantidad numeric) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
declare v numeric;
begin
  perform _verificar_admin(p_clave);
  update productos set existencia = case when p_cantidad is null then null else greatest(p_cantidad, 0) end
   where id = p_id and tipo = 'insumo' returning existencia into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return v;
end $$;

create or replace function public.admin_cajas(p_clave text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  return (select coalesce(jsonb_agg(_caja_json(c, true) order by c.abierta_en), '[]'::jsonb)
          from cajas c where c.dia = coalesce(p_dia, _hoy()) or (c.cerrada_en is null and coalesce(p_dia, _hoy()) = _hoy()));
end $$;

create or replace function public.admin_anular(p_clave text, p_uid uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v ventas%rowtype;
begin
  perform _verificar_admin(p_clave);
  select * into v from ventas where id = p_uid for update;
  if not found then raise exception 'VENTA_NO_EXISTE'; end if;
  if v.anulada then return true; end if;
  update ventas set anulada = true where id = p_uid;
  perform _revertir(v);
  return true;
end $$;

-- Editar una venta (cambio de productos, pago o descuento). Conserva el número de orden.
create or replace function public.admin_editar_venta(p_clave text, p_uid uuid, p_items jsonb, p_pago text,
                                                     p_recibido numeric default 0, p_descuento numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v ventas%rowtype; arm jsonb; d numeric; t numeric;
begin
  perform _verificar_admin(p_clave);
  if p_pago is null or p_pago not in ('efectivo','transferencia') then raise exception 'PAGO_INVALIDO'; end if;
  select * into v from ventas where id = p_uid for update;
  if not found then raise exception 'VENTA_NO_EXISTE'; end if;
  if v.anulada then raise exception 'VENTA_ANULADA'; end if;
  perform _revertir(v);
  arm := _armar(p_items);
  d := round(greatest(coalesce(p_descuento, 0), 0));
  if d > (arm->>'subtotal')::numeric then raise exception 'DESCUENTO_MAYOR'; end if;
  t := (arm->>'subtotal')::numeric - d;
  update ventas set items = arm->'items', subtotal = (arm->>'subtotal')::numeric, descuento = d, total = t,
         costo = (arm->>'costo')::numeric, consumo = arm->'consumo', pago = p_pago,
         recibido = case when p_pago = 'efectivo' and coalesce(p_recibido, 0) >= t then p_recibido else 0 end,
         editada = now()
   where id = p_uid returning * into v;
  return _venta_json(v, true);
end $$;

create or replace function public.admin_respaldo(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  return jsonb_build_object(
    'version', 2,
    'products', (select coalesce(jsonb_agg(_producto_json(p) order by p.nombre), '[]'::jsonb) from productos p),
    'sales',    (select coalesce(jsonb_agg(_venta_json(v, true) order by v.fecha), '[]'::jsonb) from ventas v),
    'cajas',    (select coalesce(jsonb_agg(_caja_json(c, true) order by c.abierta_en), '[]'::jsonb) from cajas c));
end $$;

-- Sube un respaldo: guarda los productos (primero los insumos, por las recetas) y agrega las ventas que falten.
create or replace function public.admin_restaurar(p_clave text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v jsonb; v_fecha timestamptz; v_dia date; v_orden int; n_p int := 0; n_v int := 0;
begin
  perform _verificar_admin(p_clave);
  for v in select value from jsonb_array_elements(coalesce(p_datos->'products', '[]'::jsonb))
           order by (value->>'type' = 'insumo') desc loop
    perform admin_guardar_producto(p_clave, v);
    n_p := n_p + 1;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_datos->'sales', '[]'::jsonb)) order by value->>'date' loop
    continue when v->>'id' is null or v->>'date' is null;
    continue when exists (select 1 from ventas where ref = v->>'id' or id::text = v->>'id');
    v_fecha := (v->>'date')::timestamptz;
    v_dia   := (v_fecha at time zone 'America/Bogota')::date;
    perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
    select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;
    insert into ventas (ref, fecha, dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, anulada)
    values (v->>'id', v_fecha, v_dia, v_orden, coalesce(v->'items', '[]'::jsonb),
            coalesce((v->>'subtotal')::numeric, (v->>'total')::numeric, 0), coalesce((v->>'discount')::numeric, 0),
            coalesce((v->>'total')::numeric, 0), (v->>'cost')::numeric, coalesce(v->'consumo', '[]'::jsonb),
            case when v->>'pay' = 'transferencia' then 'transferencia' else 'efectivo' end,
            coalesce((v->>'received')::numeric, 0), coalesce((v->>'void')::boolean, false));
    n_v := n_v + 1;
  end loop;
  return jsonb_build_object('productos', n_p, 'ventas', n_v);
end $$;

-- =====================================================================
--  Permisos
-- =====================================================================
revoke all on function public._verificar_pin(text), public._costo_unit(text), public._producto_json(public.productos),
                       public._venta_json(public.ventas, boolean), public._armar(jsonb), public._revertir(public.ventas),
                       public._caja_json(public.cajas, boolean)
  from public, anon, authenticated;

grant execute on function
  public.estado(), public.catalogo(), public.verificar_mesero(text),
  public.abrir_caja(text, numeric), public.cerrar_caja(text, numeric, text),
  public.registrar_venta(text, jsonb, text, numeric, numeric, text),
  public.admin_fijar_codigo_mesero(text, text), public.admin_guardar_producto(text, jsonb),
  public.admin_insumo_compra(text, text, numeric, numeric), public.admin_insumo_contar(text, text, numeric),
  public.admin_cajas(text, date), public.admin_anular(text, uuid),
  public.admin_editar_venta(text, uuid, jsonb, text, numeric, numeric),
  public.admin_respaldo(text), public.admin_restaurar(text, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';
