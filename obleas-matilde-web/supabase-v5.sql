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
--  - El respaldo incluye los descartes, y al subirlo se restauran.
--  - Vendedores: cada uno con su nombre y su contraseña (puede tener letras y
--    números). El PIN de vendedor que había pasa a ser el vendedor "Vendedor".
--    Cada venta guarda quién la atendió.
--  - Bloqueo: 5 intentos fallidos desde un dispositivo lo bloquean 15 minutos
--    para entrar con cualquier código (ya no hay tope general).
--  - Galletas automáticas solo para la categoría Obleas (no por el nombre).
--  - La llave de transferencia se cambia desde Ajustes.
--  - Costos y "alcanza para" se calculan solo en la base (la página los usa).
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

-- vendedores: nombre y contraseña (cifrada)
create table if not exists public.vendedores (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  clave   text not null,
  activo  boolean not null default true,
  creado  timestamptz not null default now()
);
create unique index if not exists vendedores_nombre on public.vendedores (lower(nombre));
alter table public.vendedores enable row level security;
revoke all on public.vendedores from anon, authenticated;

alter table public.ventas  add column if not exists vendedor text;             -- quién atendió la venta
alter table public.ajustes add column if not exists llave_transferencia text;  -- llave que ve el cliente al pagar por transferencia
end
$estructura$;

-- El PIN de vendedor que había pasa a ser el vendedor "Vendedor" (misma clave, sigue funcionando)
insert into public.vendedores (nombre, clave)
select 'Vendedor', pin_vendedor from public.ajustes
 where id = 1 and pin_vendedor is not null and not exists (select 1 from public.vendedores);
update public.ajustes set pin_vendedor = null where id = 1 and pin_vendedor is not null and exists (select 1 from public.vendedores);
update public.ajustes set llave_transferencia = '@NEQUIZHA210' where id = 1 and llave_transferencia is null;

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

-- =====================================================================
--  Acceso: vendedores con contraseña y bloqueo por dispositivo
--  Cada tipo de código lleva su propia cuenta de fallos (así acertar uno no
--  borra los fallos de otro); con 5 fallos seguidos el dispositivo queda
--  bloqueado 15 minutos para entrar con CUALQUIER código.
-- =====================================================================
create or replace function public._acceso(p_tipo text, p_valor text) returns text
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_hash text; v_ip text := _ip(); v_hasta timestamptz; v_fallos int; v_vend text;
begin
  if p_tipo = 'pin' then
    perform set_config('om.vendedor', '', true);
    -- sin vendedores activos, cualquiera con el enlace vende (como cuando no había PIN)
    if not exists (select 1 from vendedores where activo) then return null; end if;
  else
    select case p_tipo when 'admin' then clave_admin else codigo_mesero end into v_hash from ajustes where id = 1;
    if v_hash is null then return case p_tipo when 'admin' then 'SIN_CLAVE' else 'SIN_CODIGO_MESERO' end; end if;
  end if;

  select bloqueado_hasta into v_hasta from intentos
   where tipo = 'dispositivo' and ip = v_ip and bloqueado_hasta > now();
  if v_hasta is not null then
    return 'BLOQUEADO:' || ceil(extract(epoch from v_hasta - now()))::int;
  end if;

  if p_valor is not null and length(p_valor) <= 200 then
    if p_tipo = 'pin' then
      select nombre into v_vend from vendedores where activo and crypt(p_valor, clave) = clave order by creado limit 1;
      if v_vend is not null then
        perform set_config('om.vendedor', v_vend, true);
        update intentos set fallos = 0 where tipo = p_tipo and ip = v_ip and fallos > 0;
        return null;
      end if;
    elsif crypt(p_valor, v_hash) = v_hash then
      update intentos set fallos = 0 where tipo = p_tipo and ip = v_ip and fallos > 0;
      return null;
    end if;
  end if;

  insert into intentos as i (tipo, ip, fallos) values (p_tipo, v_ip, 1)
  on conflict (tipo, ip) do update set fallos = i.fallos + 1
  returning fallos into v_fallos;
  if v_fallos >= 5 then
    update intentos set fallos = 0 where tipo = p_tipo and ip = v_ip;
    insert into intentos as i (tipo, ip, fallos, bloqueado_hasta) values ('dispositivo', v_ip, 0, now() + interval '15 minutes')
    on conflict (tipo, ip) do update set bloqueado_hasta = now() + interval '15 minutes';
  end if;
  return case p_tipo when 'admin' then 'CLAVE_INCORRECTA' when 'pin' then 'PIN_INCORRECTO' else 'CODIGO_MESERO_INCORRECTO' end;
end $$;
-- el tope general (para todos los dispositivos) ya no se usa
delete from public.intentos where ip = '*';

create or replace function public.estado() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'tiene_clave', a.clave_admin is not null,
    'pide_pin', exists (select 1 from vendedores where activo),
    'pide_mesero', a.codigo_mesero is not null,
    'descuento_max', a.descuento_max,
    'llave', a.llave_transferencia,
    'caja', coalesce((select _caja_json(c, false) from cajas c where c.cerrada_en is null limit 1),
                     jsonb_build_object('abierta', false)))
  from ajustes a where a.id = 1
$$;

create or replace function public._venta_json(v public.ventas, con_costo boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', coalesce(v.ref, v.id::text), 'uid', v.id, 'date', v.fecha, 'day', v.dia, 'order', v.orden,
    'subtotal', coalesce(v.subtotal, v.total), 'discount', v.descuento, 'total', v.total,
    'pay', v.pago, 'received', v.recibido, 'void', v.anulada, 'edited', v.editada, 'caja', v.caja_id, 'seller', v.vendedor,
    'items', case when con_costo then v.items else (
        select coalesce(jsonb_agg((x - 'cost' - 'base_cost') || jsonb_build_object('adds',
                 (select coalesce(jsonb_agg(y - 'cost'), '[]'::jsonb) from jsonb_array_elements(coalesce(x->'adds', '[]'::jsonb)) y))), '[]'::jsonb)
        from jsonb_array_elements(v.items) x) end)
  || case when con_costo then jsonb_build_object('cost', coalesce(v.costo, 0), 'consumo', v.consumo) else '{}'::jsonb end
$$;

-- La venta guarda quién la atendió (el vendedor cuya contraseña se usó)
create or replace function public.registrar_venta(p_pin text, p_items jsonb, p_pago text, p_recibido numeric default 0,
                                                  p_descuento numeric default 0, p_codigo text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_caja uuid; v_dia date; v_orden int; v_row ventas%rowtype; arm jsonb; d numeric; v_total numeric; v_max numeric; v_vend text;
  e text := _acceso('pin', p_pin);
begin
  if e is not null then return _err(e); end if;
  v_vend := nullif(current_setting('om.vendedor', true), '');
  if p_ref is not null then
    if length(p_ref) > 64 then raise exception 'VALOR_INVALIDO'; end if;
    perform pg_advisory_xact_lock(hashtext('om-ref-' || p_ref));
    select * into v_row from ventas where ref = p_ref;
    if found then return _venta_json(v_row, false); end if;
  end if;
  if p_pago is null or p_pago not in ('efectivo','transferencia') then raise exception 'PAGO_INVALIDO'; end if;
  if p_recibido is not null and (p_recibido < 0 or p_recibido > 10000000) then raise exception 'VALOR_INVALIDO'; end if;
  d := round(coalesce(p_descuento, 0));
  if d < 0 then raise exception 'DESCUENTO_INVALIDO'; end if;
  if d > 0 then
    e := _acceso('mesero', p_codigo);
    if e is not null then return _err(e); end if;
  end if;

  select id, dia into v_caja, v_dia from cajas where cerrada_en is null for update;
  if v_caja is null then raise exception 'CAJA_CERRADA'; end if;

  arm := _armar(p_items);
  if d > (arm->>'subtotal')::numeric then raise exception 'DESCUENTO_MAYOR'; end if;
  select descuento_max into v_max from ajustes where id = 1;
  if d > round((arm->>'subtotal')::numeric * coalesce(v_max, 100) / 100) then raise exception 'DESCUENTO_MAXIMO'; end if;
  v_total := (arm->>'subtotal')::numeric - d;

  perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
  select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;

  insert into ventas (ref, dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, caja_id, vendedor)
  values (p_ref, v_dia, v_orden, arm->'items', (arm->>'subtotal')::numeric, d, v_total, (arm->>'costo')::numeric, arm->'consumo', p_pago,
          case when p_pago = 'efectivo' and coalesce(p_recibido, 0) >= v_total then p_recibido else 0 end, v_caja, v_vend)
  returning * into v_row;
  return _venta_json(v_row, false);
end $$;

-- ---------- Vendedores (solo el administrador) ----------
drop function if exists public.admin_fijar_pin(text, text);

create or replace function public.admin_vendedores(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.nombre, 'active', v.activo, 'created', v.creado,
            'sales_today', (select count(*) from ventas where vendedor = v.nombre and dia = _hoy() and not anulada))
          order by v.activo desc, lower(v.nombre)), '[]'::jsonb) from vendedores v);
end $$;

-- Crear (p_id null) o editar un vendedor. En una edición, p_contra vacío = no cambiar la contraseña.
create or replace function public.admin_guardar_vendedor(p_clave text, p_id uuid, p_nombre text, p_contra text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave); v_nombre text := trim(coalesce(p_nombre, '')); v_id uuid := p_id;
begin
  if e is not null then return _err(e); end if;
  if v_nombre = '' or length(v_nombre) > 40 then raise exception 'NOMBRE_VACIO'; end if;
  if exists (select 1 from vendedores where lower(nombre) = lower(v_nombre) and id is distinct from p_id) then raise exception 'VENDEDOR_EXISTE'; end if;
  if p_contra is not null and p_contra <> '' then
    if length(p_contra) < 6 or length(p_contra) > 64 then raise exception 'PIN_CORTO'; end if;
    -- dos vendedores no pueden tener la misma contraseña (la contraseña dice quién vendió)
    if exists (select 1 from vendedores where id is distinct from p_id and crypt(p_contra, clave) = clave) then raise exception 'CONTRA_REPETIDA'; end if;
  elsif p_id is null then
    raise exception 'PIN_CORTO';
  end if;
  if p_id is null then
    insert into vendedores (nombre, clave) values (v_nombre, crypt(p_contra, gen_salt('bf', 8))) returning id into v_id;
  else
    update vendedores set nombre = v_nombre,
           clave = case when p_contra is not null and p_contra <> '' then crypt(p_contra, gen_salt('bf', 8)) else clave end
     where id = p_id;
    if not found then raise exception 'VENDEDOR_NO_EXISTE'; end if;
  end if;
  return to_jsonb(v_id);
end $$;

create or replace function public.admin_vendedor_activo(p_clave text, p_id uuid, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  update vendedores set activo = coalesce(p_activo, false) where id = p_id;
  if not found then raise exception 'VENDEDOR_NO_EXISTE'; end if;
  return 'true'::jsonb;
end $$;

create or replace function public.admin_eliminar_vendedor(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  delete from vendedores where id = p_id;    -- las ventas conservan el nombre de quien atendió
  return 'true'::jsonb;
end $$;

-- ---------- Llave de transferencia ----------
create or replace function public.admin_fijar_llave(p_clave text, p_llave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave); v text := nullif(trim(coalesce(p_llave, '')), '');
begin
  if e is not null then return _err(e); end if;
  if v is not null and length(v) > 60 then raise exception 'VALOR_INVALIDO'; end if;
  update ajustes set llave_transferencia = v where id = 1;
  return coalesce(to_jsonb(v), 'null'::jsonb);
end $$;

-- =====================================================================
--  Galletas automáticas: SOLO para la categoría Obleas
--  (un producto que se llame "oblea" pero esté en otra categoría tiene su propia receta)
-- =====================================================================
create or replace function public._es_oblea(p_id text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from productos where id = p_id and tipo = 'venta' and categoria ilike '%oblea%')
$$;

create or replace function public._asegurar_galletas() returns void
language sql set search_path = public, pg_temp as $$
  insert into recetas (producto_id, insumo_id, cantidad)
  select p.id, 'ins-obleas', 2 from productos p
   where p.tipo = 'venta' and p.categoria ilike '%oblea%'
     and exists (select 1 from productos where id = 'ins-obleas' and tipo = 'insumo')
     and not exists (select 1 from recetas r where r.producto_id = p.id and r.insumo_id = 'ins-obleas')
  on conflict (producto_id, insumo_id) do nothing
$$;

-- quita las galletas que se pusieron solo por el nombre a productos de otra categoría
delete from public.recetas r using public.productos p
 where r.producto_id = p.id and r.insumo_id = 'ins-obleas'
   and p.nombre ilike '%oblea%' and p.categoria not ilike '%oblea%';

-- =====================================================================
--  Costos y "alcanza para" en un solo lugar (la base); la página solo los muestra
-- =====================================================================
-- Para cuántos productos alcanza un insumo (solo si todos los que lo usan gastan lo mismo, como las galletas)
create or replace function public._alcanza_insumo(p_id text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with usan as (
    select p.categoria, r.cantidad * case when i.unidad = 'u' then 1 else 1 + p.merma / 100 end as gasto
      from recetas r join productos p on p.id = r.producto_id and p.tipo = 'venta' join productos i on i.id = r.insumo_id
     where r.insumo_id = p_id)
  select case when i.existencia is null or not exists (select 1 from usan)
                   or (select count(distinct round(gasto, 4)) from usan) <> 1 or (select max(gasto) from usan) <= 0 then null
              else jsonb_build_object('n', greatest(floor(i.existencia / (select max(gasto) from usan)), 0)::int,
                                      'que', case when (select bool_and(categoria ilike '%oblea%') from usan) then 'obleas' else 'productos' end) end
    from productos i where i.id = p_id
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
    'alcanza_ins', case when p.tipo = 'insumo' then _alcanza_insumo(p.id) end,
    -- costo de UNA unidad tal como sale al descartarla (sin salsas incluidas)
    'base_cost', case when p.tipo = 'insumo' then round(p.precio / nullif(p.contenido, 0), 4) else round(_costo_unit(p.id), 2) end,
    'unit_cost', round(_costo_unit(p.id) + p.salsas_incluidas *
                   coalesce((select avg(_costo_unit(s.id)) from productos s where s.es_salsa), 0), 2))
$$;

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
            'alcanza', case when p.tipo = 'venta' then _alcanza(p.id) end,
            'alcanza_ins', case when p.tipo = 'insumo' then _alcanza_insumo(p.id) end)
          order by p.tipo desc, p.categoria, p.nombre), '[]'::jsonb) from productos p);
end $$;

-- =====================================================================
--  Subir un respaldo: ahora también restaura los descartes (como historia;
--  no vuelve a tocar el inventario)
-- =====================================================================
create or replace function public.admin_restaurar(p_clave text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb; v_fecha timestamptz; v_dia date; v_orden int; v_ref text; v_uid uuid; n_p int := 0; n_v int := 0; n_d int := 0;
        e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if jsonb_typeof(p_datos) <> 'object' then raise exception 'VALOR_INVALIDO'; end if;
  for v in select value from jsonb_array_elements(case when jsonb_typeof(p_datos->'products') = 'array' then p_datos->'products' else '[]'::jsonb end)
           where jsonb_typeof(value) = 'object'
           order by (value->>'type' = 'insumo') desc limit 1000 loop
    perform _guardar_producto(v, true);
    n_p := n_p + 1;
  end loop;
  for v in select value from jsonb_array_elements(case when jsonb_typeof(p_datos->'sales') = 'array' then p_datos->'sales' else '[]'::jsonb end)
           where jsonb_typeof(value) = 'object'
           order by value->>'date' limit 50000 loop
    v_ref := left(v->>'id', 100);
    v_fecha := _fecha(v->>'date');
    continue when v_ref is null or v_fecha is null;
    continue when exists (select 1 from ventas where ref = v_ref or id::text = v_ref);
    v_dia := coalesce(_fecha(v->>'day' || 'T12:00:00-05')::date, (v_fecha at time zone 'America/Bogota')::date);
    perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
    select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;
    insert into ventas (ref, fecha, dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, anulada, vendedor)
    values (v_ref, v_fecha, v_dia, v_orden, _limpiar_items(v->'items'),
            coalesce(_num(v->>'subtotal'), _num(v->>'total'), 0), greatest(coalesce(_num(v->>'discount'), 0), 0),
            coalesce(_num(v->>'total'), 0), _num(v->>'cost'), _limpiar_consumo(v->'consumo'),
            case when v->>'pay' = 'transferencia' then 'transferencia' else 'efectivo' end,
            greatest(coalesce(_num(v->>'received'), 0), 0), coalesce(v->>'void', '') = 'true', left(nullif(v->>'seller', ''), 40));
    n_v := n_v + 1;
  end loop;
  for v in select value from jsonb_array_elements(case when jsonb_typeof(p_datos->'descartes') = 'array' then p_datos->'descartes' else '[]'::jsonb end)
           where jsonb_typeof(value) = 'object' limit 50000 loop
    begin v_uid := (v->>'uid')::uuid; exception when others then v_uid := null; end;
    v_fecha := _fecha(v->>'date');
    continue when v_uid is null or v_fecha is null or coalesce(_num(v->>'qty'), 0) <= 0;
    continue when exists (select 1 from descartes where id = v_uid);
    insert into descartes (id, fecha, dia, producto_id, nombre, tipo, cantidad, unidad, costo, motivo, consumo, anulado)
    values (v_uid, v_fecha,
            coalesce(_fecha(v->>'day' || 'T12:00:00-05')::date, (v_fecha at time zone 'America/Bogota')::date),
            left(coalesce(v->>'product', ''), 100), left(coalesce(v->>'name', ''), 200),
            case when v->>'type' in ('venta','adicional','insumo') then v->>'type' else 'venta' end,
            least(_num(v->>'qty'), 1000000), case when v->>'unit' in ('g','u','ml') then v->>'unit' else 'u' end,
            greatest(coalesce(_num(v->>'cost'), 0), 0), left(coalesce(v->>'reason', ''), 200),
            _limpiar_consumo(v->'consumo'), coalesce(v->>'void', '') = 'true');
    n_d := n_d + 1;
  end loop;
  return jsonb_build_object('productos', n_p, 'ventas', n_v, 'descartes', n_d);
end $$;

revoke all on function public._acceso(text, text), public._venta_json(public.ventas, boolean), public._es_oblea(text),
                       public._asegurar_galletas(), public._alcanza_insumo(text), public._producto_json(public.productos)
  from public, anon, authenticated;
grant execute on function public.estado(), public.registrar_venta(text, jsonb, text, numeric, numeric, text, text),
                          public.admin_vendedores(text), public.admin_guardar_vendedor(text, uuid, text, text),
                          public.admin_vendedor_activo(text, uuid, boolean), public.admin_eliminar_vendedor(text, uuid),
                          public.admin_fijar_llave(text, text), public.vend_inventario(text), public.admin_restaurar(text, jsonb)
  to anon, authenticated;

revoke all on function public._descarte_json(public.descartes) from public, anon, authenticated;
grant execute on function public.admin_descartar(text, text, numeric, text), public.admin_descartes(text, date, date),
                          public.admin_anular_descarte(text, uuid), public.admin_respaldo(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
