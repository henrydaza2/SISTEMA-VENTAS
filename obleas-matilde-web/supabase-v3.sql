-- =====================================================================
--  OBLEAS MATILDE · Actualización 3 (seguridad y correcciones)
--
--  - Bloqueo de intentos: 5 fallos desde un mismo dispositivo = 15 minutos
--    de espera; además un tope general por hora para todos.
--  - Contraseña de administrador de 8 caracteres o más; PIN y código de
--    meseros de 6 o más (los que ya existen siguen funcionando).
--  - Una venta no se repite aunque se presione Cobrar dos veces sin señal.
--  - Las ventas después de medianoche quedan en el día de la caja abierta.
--  - Editar un producto ya no pisa el stock; el tipo no se puede cambiar.
--  - Los respaldos se revisan antes de guardarse.
--  - Descuento máximo de meseros configurable (por defecto 100 %).
--  - Incluye la corrección de los 3 insumos (supabase-fix-insumos.sql).
--
--  Pega TODO este archivo en Supabase > SQL Editor y presiona "Run".
--  Va encima de supabase.sql y supabase-v2.sql. No borra ventas.
--  Se puede ejecutar más de una vez.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

do $estructura$
begin
create table if not exists public.intentos (
  tipo            text not null,          -- admin | pin | mesero
  ip              text not null,          -- dispositivo; '*' = todos
  fallos          int not null default 0,
  ventana         timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  primary key (tipo, ip)
);
alter table public.intentos enable row level security;
revoke all on public.intentos from anon, authenticated;

alter table public.ajustes add column if not exists descuento_max numeric not null default 100;  -- % del subtotal
end
$estructura$;

-- ---------- Corrección de los 3 insumos (antes supabase-fix-insumos.sql) ----------
update public.productos set
  tipo = 'insumo', categoria = 'Insumos', unidad = 'g', stock = null,
  acepta_adicionales = false, salsas_incluidas = 0, es_salsa = false,
  precio    = case when id = 'ins-leche-condensada' then 67000 else 30000 end,
  costo     = case when id = 'ins-leche-condensada' then 67000 else 30000 end,
  contenido = case when id = 'ins-leche-condensada' then 5000 else 1000 end,
  minimo    = case when id = 'ins-leche-condensada' then 1000 else 200 end
where id in ('ins-lluvia-chocolate', 'ins-chispitas', 'ins-leche-condensada') and tipo <> 'insumo';

insert into public.recetas (producto_id, insumo_id, cantidad)
select v.p, v.i, v.c from (values
  ('add-lluvia-chocolate', 'ins-lluvia-chocolate', 15),
  ('add-chispitas',        'ins-chispitas',        15),
  ('add-leche-condensada', 'ins-leche-condensada', 25)) as v(p, i, c)
where exists (select 1 from public.productos where id = v.p)
  and exists (select 1 from public.productos where id = v.i and tipo = 'insumo')
on conflict do nothing;

-- =====================================================================
--  Ayudas internas
-- =====================================================================

-- Dispositivo que llama (Supabase pasa la IP real en cf-connecting-ip)
create or replace function public._ip() returns text
language sql stable as $$
  select left(coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''), 'local'), 64)
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) x
$$;

-- Número seguro: null si no es un número válido o es enorme
create or replace function public._num(t text) returns numeric
language plpgsql immutable as $$
declare r numeric;
begin
  begin r := t::numeric; exception when others then return null; end;
  if r = 'NaN'::numeric or abs(r) > 1e12 then return null; end if;
  return r;
end $$;

create or replace function public._fecha(t text) returns timestamptz
language plpgsql stable as $$
begin
  return t::timestamptz;
exception when others then return null;
end $$;

-- Revisa una contraseña, PIN o código y lleva la cuenta de intentos.
-- Devuelve null si está bien, o el código de error. NUNCA lanza error:
-- así el intento fallido queda guardado.
create or replace function public._acceso(p_tipo text, p_valor text) returns text
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  v_hash text; v_ip text := _ip(); v_hasta timestamptz; v_fallos int;
  v_tope int := case p_tipo when 'admin' then 20 else 60 end;   -- tope general por hora
begin
  select case p_tipo when 'admin' then clave_admin when 'pin' then pin_vendedor else codigo_mesero end
    into v_hash from ajustes where id = 1;
  if v_hash is null then
    return case p_tipo when 'admin' then 'SIN_CLAVE' when 'pin' then null else 'SIN_CODIGO_MESERO' end;
  end if;

  select max(bloqueado_hasta) into v_hasta from intentos
   where tipo = p_tipo and ip in (v_ip, '*') and bloqueado_hasta > now();
  if v_hasta is not null then
    return 'BLOQUEADO:' || ceil(extract(epoch from v_hasta - now()))::int;
  end if;

  if p_valor is not null and length(p_valor) <= 200 and crypt(p_valor, v_hash) = v_hash then
    update intentos set fallos = 0 where tipo = p_tipo and ip = v_ip and fallos > 0;
    return null;
  end if;

  -- fallo: este dispositivo
  insert into intentos as i (tipo, ip, fallos) values (p_tipo, v_ip, 1)
  on conflict (tipo, ip) do update set fallos = i.fallos + 1
  returning fallos into v_fallos;
  if v_fallos >= 5 then
    update intentos set fallos = 0, bloqueado_hasta = now() + interval '15 minutes' where tipo = p_tipo and ip = v_ip;
  end if;
  -- fallo: todos los dispositivos, por hora
  insert into intentos as i (tipo, ip, fallos, ventana) values (p_tipo, '*', 1, now())
  on conflict (tipo, ip) do update set
    fallos  = case when i.ventana < now() - interval '1 hour' then 1 else i.fallos + 1 end,
    ventana = case when i.ventana < now() - interval '1 hour' then now() else i.ventana end
  returning fallos into v_fallos;
  if v_fallos >= v_tope then
    update intentos set fallos = 0, ventana = now(), bloqueado_hasta = now() + interval '15 minutes' where tipo = p_tipo and ip = '*';
  end if;

  return case p_tipo when 'admin' then 'CLAVE_INCORRECTA' when 'pin' then 'PIN_INCORRECTO' else 'CODIGO_MESERO_INCORRECTO' end;
end $$;

create or replace function public._err(p text) returns jsonb
language sql immutable as $$ select jsonb_build_object('error', p) $$;

-- Limpia los productos de una venta que viene de un respaldo
create or replace function public._limpiar_items(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',   left(coalesce(x->>'id', ''), 100),
    'name', left(coalesce(x->>'name', ''), 200),
    'cat',  left(coalesce(x->>'cat', ''), 60),
    'qty',  least(greatest(coalesce(_num(x->>'qty'), 1), 1), 1000)::int,
    'price', coalesce(_num(x->>'price'), 0),
    'cost', _num(x->>'cost'), 'base', _num(x->>'base'), 'base_cost', _num(x->>'base_cost'),
    'adds', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', left(coalesce(a->>'id', ''), 100), 'name', left(coalesce(a->>'name', ''), 200),
                'price', coalesce(_num(a->>'price'), 0), 'cost', _num(a->>'cost'), 'incl', coalesce(a->>'incl', '') = 'true')), '[]'::jsonb)
             from (select a from jsonb_array_elements(case when jsonb_typeof(x->'adds') = 'array' then x->'adds' else '[]'::jsonb end) a
                   where jsonb_typeof(a) = 'object' limit 20) aa))), '[]'::jsonb)
  from (select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
        where jsonb_typeof(x) = 'object' limit 100) xx
$$;

create or replace function public._limpiar_consumo(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',   left(coalesce(x->>'id', ''), 100),
    'name', left(coalesce(x->>'name', ''), 200),
    'unit', case when x->>'unit' in ('g', 'u', 'ml') then x->>'unit' else 'u' end,
    'qty',  coalesce(_num(x->>'qty'), 0),
    'cost', coalesce(_num(x->>'cost'), 0))), '[]'::jsonb)
  from (select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
        where jsonb_typeof(x) = 'object' limit 100) xx
$$;

-- Arma una venta (igual que antes, más topes y bloqueos en orden para no trabarse)
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
    for r in select insumo_id, cantidad from recetas where producto_id = p.id loop
      cons := jsonb_set(cons, array[r.insumo_id],
                to_jsonb(coalesce((cons->>r.insumo_id)::numeric, 0) + r.cantidad * q * (1 + p.merma / 100)));
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

  for r in select key as id, value::numeric as cant from jsonb_each_text(cons) order by key loop
    update productos set existencia = existencia - r.cant where id = r.id and existencia is not null;
    select * into ins from productos where id = r.id;
    consumo := consumo || jsonb_build_object('id', ins.id, 'name', ins.nombre, 'unit', ins.unidad,
                 'qty', round(r.cant, 2), 'cost', round(r.cant * ins.precio / nullif(ins.contenido, 0), 2));
  end loop;

  return jsonb_build_object('items', items, 'subtotal', sub, 'costo', round(costo, 2), 'consumo', consumo);
end $$;

-- Devuelve el inventario de una venta (en orden, para no trabarse con otras)
create or replace function public._revertir(v public.ventas) returns void
language plpgsql set search_path = public, pg_temp as $$
declare x jsonb;
begin
  for x in select value from jsonb_array_elements(v.items) order by value->>'id' loop
    update productos set stock = stock + (x->>'qty')::int where id = x->>'id' and stock is not null;
  end loop;
  for x in select value from jsonb_array_elements(coalesce(v.consumo, '[]'::jsonb)) order by value->>'id' loop
    update productos set existencia = existencia + (x->>'qty')::numeric where id = x->>'id' and existencia is not null;
  end loop;
end $$;

-- Guarda un producto (sin revisar contraseña; la revisa quien la llama).
-- p_restaurar = true permite cambiar el tipo (viene de un respaldo).
create or replace function public._guardar_producto(p_prod jsonb, p_restaurar boolean) returns text
language plpgsql set search_path = public, pg_temp as $$
declare v_id text := left(nullif(p_prod->>'id', ''), 100); v_tipo text; v_actual text; x jsonb;
begin
  if jsonb_typeof(p_prod) <> 'object' then raise exception 'VALOR_INVALIDO'; end if;
  if coalesce(trim(p_prod->>'name'), '') = '' then raise exception 'NOMBRE_VACIO'; end if;
  v_tipo := case when p_prod->>'type' in ('insumo','adicional') then p_prod->>'type' else 'venta' end;
  if v_id is null then v_id := gen_random_uuid()::text; end if;
  select tipo into v_actual from productos where id = v_id;
  if v_actual is not null and v_actual <> v_tipo and not p_restaurar then raise exception 'NO_CAMBIAR_TIPO'; end if;

  insert into productos (id, nombre, categoria, tipo, precio, costo, stock, minimo, unidad, contenido, existencia, merma, acepta_adicionales,
                         salsas_incluidas, es_salsa)
  values (v_id, left(trim(p_prod->>'name'), 100),
          left(coalesce(nullif(trim(p_prod->>'cat'), ''), case v_tipo when 'insumo' then 'Insumos' when 'adicional' then 'Adicionales' else '' end), 60),
          v_tipo,
          least(greatest(coalesce(_num(p_prod->>'price'), 0), 0), 10000000),
          case when v_tipo = 'insumo' then least(greatest(coalesce(_num(p_prod->>'price'), 0), 0), 10000000)
               else least(greatest(coalesce(_num(p_prod->>'cost'), 0), 0), 10000000) end,
          case when v_tipo = 'venta' and _num(p_prod->>'stock') is not null then least(greatest(_num(p_prod->>'stock'), 0), 1000000)::int end,
          least(greatest(coalesce(_num(p_prod->>'min'), 5), 0), 10000000)::int,
          case when p_prod->>'unit' in ('g','u','ml') then p_prod->>'unit' else 'u' end,
          case when v_tipo = 'insumo' then nullif(least(greatest(coalesce(_num(p_prod->>'content'), 0), 0), 10000000), 0) end,
          case when v_tipo = 'insumo' then least(greatest(_num(p_prod->>'qty'), -10000000), 10000000) end,
          least(greatest(coalesce(_num(p_prod->>'merma'), 0), 0), 100),
          v_tipo = 'venta' and coalesce(p_prod->>'adds_ok', '') = 'true',
          case when v_tipo = 'venta' then least(greatest(coalesce(_num(p_prod->>'incl'), 0), 0), 10)::int else 0 end,
          v_tipo = 'adicional' and coalesce(p_prod->>'salsa', '') = 'true')
  on conflict (id) do update set
    nombre = excluded.nombre, categoria = excluded.categoria, tipo = excluded.tipo, precio = excluded.precio,
    costo = excluded.costo, minimo = excluded.minimo,
    -- lo que no viene se conserva: así editar un producto no pisa el stock ni la existencia
    stock = case when p_prod ? 'stock' then excluded.stock else productos.stock end,
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
      for x in select value from jsonb_array_elements(p_prod->'recipe') limit 30 loop
        if coalesce(_num(x->>'qty'), 0) > 0 and x->>'id' <> v_id
           and exists (select 1 from productos where id = x->>'id' and tipo = 'insumo') then
          insert into recetas (producto_id, insumo_id, cantidad) values (v_id, x->>'id', least(_num(x->>'qty'), 1000000))
          on conflict (producto_id, insumo_id) do update set cantidad = excluded.cantidad;
        end if;
      end loop;
    end if;
  end if;
  return v_id;
end $$;

-- =====================================================================
--  Se quitan las funciones viejas (cambian de forma; se vuelven a crear abajo)
-- =====================================================================
drop function if exists public.menu();
drop function if exists public.verificar_mesero(text);
drop function if exists public.abrir_caja(text, numeric);
drop function if exists public.cerrar_caja(text, numeric, text);
drop function if exists public.registrar_venta(text, jsonb, text, numeric, numeric, text);
drop function if exists public.admin_entrar(text);
drop function if exists public.admin_cambiar_clave(text, text);
drop function if exists public.admin_fijar_pin(text, text);
drop function if exists public.admin_fijar_codigo_mesero(text, text);
drop function if exists public.admin_productos(text);
drop function if exists public.admin_guardar_producto(text, jsonb);
drop function if exists public.admin_eliminar_producto(text, text);
drop function if exists public.admin_ajustar_stock(text, text, int);
drop function if exists public.admin_insumo_compra(text, text, numeric, numeric);
drop function if exists public.admin_insumo_contar(text, text, numeric);
drop function if exists public.admin_ventas(text, date);
drop function if exists public.admin_cajas(text, date);
drop function if exists public.admin_anular(text, uuid);
drop function if exists public.admin_editar_venta(text, uuid, jsonb, text, numeric, numeric);
drop function if exists public.admin_respaldo(text);
drop function if exists public.admin_restaurar(text, jsonb);
drop function if exists public._verificar_admin(text);
drop function if exists public._verificar_pin(text);

-- =====================================================================
--  Funciones públicas
--  Si la contraseña, el PIN o el código están mal devuelven {"error": "..."}
--  en vez de lanzar un error, para que el intento fallido quede contado.
-- =====================================================================

create or replace function public.estado() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'tiene_clave', a.clave_admin is not null,
    'pide_pin', a.pin_vendedor is not null,
    'pide_mesero', a.codigo_mesero is not null,
    'descuento_max', a.descuento_max,
    'caja', coalesce((select _caja_json(c, false) from cajas c where c.cerrada_en is null limit 1),
                     jsonb_build_object('abierta', false)))
  from ajustes a where a.id = 1
$$;

create or replace function public.crear_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 200 then raise exception 'CLAVE_CORTA'; end if;
  update ajustes set clave_admin = crypt(p_clave, gen_salt('bf', 10)) where id = 1 and clave_admin is null;
  if not found then raise exception 'YA_EXISTE_CLAVE'; end if;
  return true;
end $$;

create or replace function public.verificar_mesero(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('mesero', p_codigo);
begin
  if e is not null then return _err(e); end if;
  return 'true'::jsonb;
end $$;

create or replace function public.abrir_caja(p_pin text, p_base numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c cajas%rowtype; e text := _acceso('pin', p_pin);
begin
  if e is not null then return _err(e); end if;
  if p_base is not null and (p_base < 0 or p_base > 10000000) then raise exception 'VALOR_INVALIDO'; end if;
  if exists (select 1 from cajas where cerrada_en is null) then raise exception 'CAJA_YA_ABIERTA'; end if;
  insert into cajas (dia, base) values (_hoy(), coalesce(p_base, 0)) returning * into c;
  return _caja_json(c, false);
end $$;

create or replace function public.cerrar_caja(p_pin text, p_contado numeric, p_notas text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c cajas%rowtype; e text := _acceso('pin', p_pin);
begin
  if e is not null then return _err(e); end if;
  if p_contado is null or p_contado < 0 or p_contado > 100000000 then raise exception 'VALOR_INVALIDO'; end if;
  select * into c from cajas where cerrada_en is null for update;
  if not found then raise exception 'CAJA_CERRADA'; end if;
  update cajas set cerrada_en = now(), contado = p_contado, notas = coalesce(left(p_notas, 500), ''),
         esperado = c.base + (select coalesce(sum(total), 0) from ventas where caja_id = c.id and not anulada and pago = 'efectivo')
   where id = c.id;
  return 'true'::jsonb;
end $$;

-- p_ref: identificador que pone la página a cada venta. Si llega dos veces
-- (se cortó la señal y se volvió a cobrar), devuelve la venta ya guardada.
create or replace function public.registrar_venta(p_pin text, p_items jsonb, p_pago text, p_recibido numeric default 0,
                                                  p_descuento numeric default 0, p_codigo text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_caja uuid; v_dia date; v_orden int; v_row ventas%rowtype; arm jsonb; d numeric; v_total numeric; v_max numeric;
  e text := _acceso('pin', p_pin);
begin
  if e is not null then return _err(e); end if;
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
  -- el código de meseros se revisa ANTES de tocar el inventario
  if d > 0 then
    e := _acceso('mesero', p_codigo);
    if e is not null then return _err(e); end if;
  end if;

  -- la venta va al día de la caja abierta (aunque ya sea pasada la medianoche)
  select id, dia into v_caja, v_dia from cajas where cerrada_en is null for update;
  if v_caja is null then raise exception 'CAJA_CERRADA'; end if;

  arm := _armar(p_items);
  if d > (arm->>'subtotal')::numeric then raise exception 'DESCUENTO_MAYOR'; end if;
  select descuento_max into v_max from ajustes where id = 1;
  if d > round((arm->>'subtotal')::numeric * coalesce(v_max, 100) / 100) then raise exception 'DESCUENTO_MAXIMO'; end if;
  v_total := (arm->>'subtotal')::numeric - d;

  perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
  select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;

  insert into ventas (ref, dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, caja_id)
  values (p_ref, v_dia, v_orden, arm->'items', (arm->>'subtotal')::numeric, d, v_total, (arm->>'costo')::numeric, arm->'consumo', p_pago,
          case when p_pago = 'efectivo' and coalesce(p_recibido, 0) >= v_total then p_recibido else 0 end, v_caja)
  returning * into v_row;
  return _venta_json(v_row, false);
end $$;

-- =====================================================================
--  Funciones de administrador
-- =====================================================================

create or replace function public.admin_entrar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return 'true'::jsonb;
end $$;

create or replace function public.admin_cambiar_clave(p_clave text, p_nueva text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_nueva is null or length(p_nueva) < 8 or length(p_nueva) > 200 then raise exception 'CLAVE_CORTA'; end if;
  update ajustes set clave_admin = crypt(p_nueva, gen_salt('bf', 10)) where id = 1;
  return 'true'::jsonb;
end $$;

-- p_pin vacío o null = quitar el PIN (cualquiera con el enlace vende)
create or replace function public.admin_fijar_pin(p_clave text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_pin is null or p_pin = '' then
    update ajustes set pin_vendedor = null where id = 1;
  else
    if length(p_pin) < 6 or length(p_pin) > 200 then raise exception 'PIN_CORTO'; end if;
    update ajustes set pin_vendedor = crypt(p_pin, gen_salt('bf', 8)) where id = 1;
  end if;
  return 'true'::jsonb;
end $$;

create or replace function public.admin_fijar_codigo_mesero(p_clave text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_codigo is null or p_codigo = '' then
    update ajustes set codigo_mesero = null where id = 1;
  else
    if length(p_codigo) < 6 or length(p_codigo) > 200 then raise exception 'PIN_CORTO'; end if;
    update ajustes set codigo_mesero = crypt(p_codigo, gen_salt('bf', 8)) where id = 1;
  end if;
  return 'true'::jsonb;
end $$;

-- Descuento máximo de meseros, en % del subtotal (1 a 100)
create or replace function public.admin_fijar_descuento_max(p_clave text, p_pct numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then raise exception 'VALOR_INVALIDO'; end if;
  update ajustes set descuento_max = round(p_pct) where id = 1;
  return to_jsonb(round(p_pct));
end $$;

create or replace function public.admin_productos(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(_producto_json(p) order by p.tipo desc, p.categoria, p.nombre), '[]'::jsonb) from productos p);
end $$;

create or replace function public.admin_guardar_producto(p_clave text, p_prod jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return to_jsonb(_guardar_producto(p_prod, false));
end $$;

create or replace function public.admin_eliminar_producto(p_clave text, p_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  delete from productos where id = p_id;
  return 'true'::jsonb;
end $$;

create or replace function public.admin_ajustar_stock(p_clave text, p_id text, p_delta int) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v int; e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_delta is null or abs(p_delta) > 1000000 then raise exception 'VALOR_INVALIDO'; end if;
  update productos set stock = least(greatest(coalesce(stock, 0) + p_delta, 0), 1000000) where id = p_id returning stock into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return to_jsonb(v);
end $$;

create or replace function public.admin_insumo_compra(p_clave text, p_id text, p_paquetes numeric, p_precio numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v numeric; e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_paquetes is null or p_paquetes <= 0 or p_paquetes > 1000 then raise exception 'CANTIDAD_INVALIDA'; end if;
  if p_precio is not null and (p_precio < 0 or p_precio > 10000000) then raise exception 'VALOR_INVALIDO'; end if;
  update productos set existencia = coalesce(existencia, 0) + p_paquetes * coalesce(contenido, 1),
                       precio = coalesce(p_precio, precio), costo = coalesce(p_precio, costo)
   where id = p_id and tipo = 'insumo' returning existencia into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return to_jsonb(v);
end $$;

-- Contar un insumo: fija cuánto hay. null = dejar de controlarlo
create or replace function public.admin_insumo_contar(p_clave text, p_id text, p_cantidad numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v numeric; e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_cantidad is not null and (p_cantidad < 0 or p_cantidad > 10000000) then raise exception 'VALOR_INVALIDO'; end if;
  update productos set existencia = p_cantidad where id = p_id and tipo = 'insumo' returning existencia into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return coalesce(to_jsonb(v), 'null'::jsonb);
end $$;

create or replace function public.admin_ventas(p_clave text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(_venta_json(v, true) order by v.orden), '[]'::jsonb)
          from ventas v where v.dia = coalesce(p_dia, _hoy()));
end $$;

create or replace function public.admin_cajas(p_clave text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return (select coalesce(jsonb_agg(_caja_json(c, true) order by c.abierta_en), '[]'::jsonb)
          from cajas c where c.dia = coalesce(p_dia, _hoy()) or (c.cerrada_en is null and coalesce(p_dia, _hoy()) = _hoy()));
end $$;

create or replace function public.admin_anular(p_clave text, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v ventas%rowtype; e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  select * into v from ventas where id = p_uid for update;
  if not found then raise exception 'VENTA_NO_EXISTE'; end if;
  if not v.anulada then
    update ventas set anulada = true where id = p_uid;
    perform _revertir(v);
  end if;
  return 'true'::jsonb;
end $$;

create or replace function public.admin_editar_venta(p_clave text, p_uid uuid, p_items jsonb, p_pago text,
                                                     p_recibido numeric default 0, p_descuento numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v ventas%rowtype; arm jsonb; d numeric; t numeric; e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  if p_pago is null or p_pago not in ('efectivo','transferencia') then raise exception 'PAGO_INVALIDO'; end if;
  if p_recibido is not null and (p_recibido < 0 or p_recibido > 10000000) then raise exception 'VALOR_INVALIDO'; end if;
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
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e text := _acceso('admin', p_clave);
begin
  if e is not null then return _err(e); end if;
  return jsonb_build_object(
    'version', 3,
    'products', (select coalesce(jsonb_agg(_producto_json(p) order by p.nombre), '[]'::jsonb) from productos p),
    'sales',    (select coalesce(jsonb_agg(_venta_json(v, true) order by v.fecha), '[]'::jsonb) from ventas v),
    'cajas',    (select coalesce(jsonb_agg(_caja_json(c, true) order by c.abierta_en), '[]'::jsonb) from cajas c));
end $$;

-- Sube un respaldo: revisa la contraseña UNA vez, limpia los datos y agrega las ventas que falten.
create or replace function public.admin_restaurar(p_clave text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v jsonb; v_fecha timestamptz; v_dia date; v_orden int; v_ref text; n_p int := 0; n_v int := 0;
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
    insert into ventas (ref, fecha, dia, orden, items, subtotal, descuento, total, costo, consumo, pago, recibido, anulada)
    values (v_ref, v_fecha, v_dia, v_orden, _limpiar_items(v->'items'),
            coalesce(_num(v->>'subtotal'), _num(v->>'total'), 0), greatest(coalesce(_num(v->>'discount'), 0), 0),
            coalesce(_num(v->>'total'), 0), _num(v->>'cost'), _limpiar_consumo(v->'consumo'),
            case when v->>'pay' = 'transferencia' then 'transferencia' else 'efectivo' end,
            greatest(coalesce(_num(v->>'received'), 0), 0), coalesce(v->>'void', '') = 'true');
    n_v := n_v + 1;
  end loop;
  return jsonb_build_object('productos', n_p, 'ventas', n_v);
end $$;

-- =====================================================================
--  Permisos
-- =====================================================================
revoke all on function public._ip(), public._num(text), public._fecha(text), public._acceso(text, text), public._err(text),
                       public._limpiar_items(jsonb), public._limpiar_consumo(jsonb), public._guardar_producto(jsonb, boolean),
                       public._armar(jsonb), public._revertir(public.ventas)
  from public, anon, authenticated;

grant execute on function
  public.estado(), public.catalogo(), public.crear_clave(text), public.verificar_mesero(text),
  public.abrir_caja(text, numeric), public.cerrar_caja(text, numeric, text),
  public.registrar_venta(text, jsonb, text, numeric, numeric, text, text),
  public.admin_entrar(text), public.admin_cambiar_clave(text, text), public.admin_fijar_pin(text, text),
  public.admin_fijar_codigo_mesero(text, text), public.admin_fijar_descuento_max(text, numeric),
  public.admin_productos(text), public.admin_guardar_producto(text, jsonb), public.admin_eliminar_producto(text, text),
  public.admin_ajustar_stock(text, text, int), public.admin_insumo_compra(text, text, numeric, numeric),
  public.admin_insumo_contar(text, text, numeric), public.admin_ventas(text, date), public.admin_cajas(text, date),
  public.admin_anular(text, uuid), public.admin_editar_venta(text, uuid, jsonb, text, numeric, numeric),
  public.admin_respaldo(text), public.admin_restaurar(text, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';
