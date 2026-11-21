-- =====================================================================
--  OBLEAS MATILDE · Base de datos (Supabase / PostgreSQL)
--  Pega TODO este archivo en Supabase > SQL Editor y presiona "Run".
--  Se puede ejecutar más de una vez sin dañar los datos.
--
--  Seguridad: nadie puede leer ni escribir las tablas directamente.
--  Todo pasa por las funciones de abajo, que revisan el PIN de vendedor
--  o la contraseña de administrador DENTRO del servidor.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.productos (
  id        text primary key default gen_random_uuid()::text,
  nombre    text not null,
  categoria text not null default '',
  tipo      text not null default 'venta' check (tipo in ('venta','insumo')),
  precio    numeric not null default 0,
  costo     numeric not null default 0,
  stock     integer,                      -- null = sin control de stock
  minimo    integer not null default 5,
  creado    timestamptz not null default now()
);

create table if not exists public.ventas (
  id        uuid primary key default gen_random_uuid(),
  ref       text unique,                  -- id original cuando viene de un respaldo
  fecha     timestamptz not null default now(),
  dia       date not null,
  orden     integer not null,             -- número de orden dentro del día
  items     jsonb not null,
  total     numeric not null,
  pago      text not null check (pago in ('efectivo','transferencia')),
  recibido  numeric not null default 0,
  anulada   boolean not null default false,
  unique (dia, orden)
);

create table if not exists public.ajustes (
  id           int primary key check (id = 1),
  clave_admin  text,                      -- contraseña de administrador (cifrada)
  pin_vendedor text                       -- PIN de vendedor (cifrado); null = cualquiera vende
);
insert into public.ajustes (id) values (1) on conflict (id) do nothing;

-- Tablas cerradas: sin políticas, nadie entra directo.
alter table public.productos enable row level security;
alter table public.ventas    enable row level security;
alter table public.ajustes   enable row level security;
revoke all on public.productos, public.ventas, public.ajustes from anon, authenticated;

-- ---------- Ayudas internas ----------
create or replace function public._hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;

create or replace function public._verificar_admin(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  select clave_admin into v from ajustes where id = 1;
  if v is null then raise exception 'SIN_CLAVE'; end if;
  if p_clave is null or crypt(p_clave, v) <> v then
    perform pg_sleep(1);                  -- frena los intentos de adivinar
    raise exception 'CLAVE_INCORRECTA';
  end if;
end $$;

create or replace function public._venta_json(v public.ventas, con_costo boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', coalesce(v.ref, v.id::text), 'uid', v.id, 'date', v.fecha, 'day', v.dia, 'order', v.orden,
    'total', v.total, 'pay', v.pago, 'received', v.recibido, 'void', v.anulada,
    'items', case when con_costo then v.items
                  else (select coalesce(jsonb_agg(x - 'cost'), '[]'::jsonb) from jsonb_array_elements(v.items) x) end)
$$;

create or replace function public._producto_json(p public.productos) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.nombre, 'cat', p.categoria, 'type', p.tipo,
                            'price', p.precio, 'cost', p.costo, 'stock', p.stock, 'min', p.minimo)
$$;

-- ---------- Funciones públicas (cualquiera con el enlace) ----------

-- ¿Ya hay contraseña? ¿Se pide PIN para vender?
create or replace function public.estado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tiene_clave', clave_admin is not null, 'pide_pin', pin_vendedor is not null)
  from ajustes where id = 1
$$;

-- Productos a la venta (sin costos ni insumos)
create or replace function public.menu() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nombre, 'cat', categoria,
           'price', precio, 'stock', stock, 'min', minimo) order by categoria, precio, nombre), '[]'::jsonb)
  from productos where tipo = 'venta'
$$;

-- Registrar una venta. Los precios y el total se calculan en el servidor.
create or replace function public.registrar_venta(p_pin text, p_items jsonb, p_pago text, p_recibido numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pin text; v_dia date := _hoy(); v_it jsonb; v_p productos%rowtype; v_qty int;
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_orden int; v_row ventas%rowtype;
begin
  select pin_vendedor into v_pin from ajustes where id = 1;
  if v_pin is not null and (p_pin is null or crypt(p_pin, v_pin) <> v_pin) then
    perform pg_sleep(1);
    raise exception 'PIN_INCORRECTO';
  end if;
  if p_pago is null or p_pago not in ('efectivo','transferencia') then raise exception 'PAGO_INVALIDO'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'VENTA_VACIA';
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 1000 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select * into v_p from productos where id = v_it->>'id' and tipo = 'venta' for update;
    if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
    if v_p.stock is not null then
      if v_p.stock < v_qty then raise exception 'SIN_STOCK:%', v_p.nombre; end if;
      update productos set stock = stock - v_qty where id = v_p.id;
    end if;
    v_items := v_items || jsonb_build_object('id', v_p.id, 'name', v_p.nombre, 'price', v_p.precio,
                                             'cost', v_p.costo, 'qty', v_qty);
    v_total := v_total + v_p.precio * v_qty;
  end loop;

  -- número de orden del día, sin repetirse aunque vendan dos a la vez
  perform pg_advisory_xact_lock(hashtext('om-venta-' || v_dia::text));
  select coalesce(max(orden), 0) + 1 into v_orden from ventas where dia = v_dia;

  insert into ventas (dia, orden, items, total, pago, recibido)
  values (v_dia, v_orden, v_items, v_total, p_pago,
          case when p_pago = 'efectivo' and coalesce(p_recibido, 0) >= v_total then p_recibido else 0 end)
  returning * into v_row;

  return _venta_json(v_row, false);
end $$;

-- Crear la contraseña de administrador (solo funciona si todavía no existe)
create or replace function public.crear_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_clave is null or length(p_clave) < 4 then raise exception 'CLAVE_CORTA'; end if;
  update ajustes set clave_admin = crypt(p_clave, gen_salt('bf', 10)) where id = 1 and clave_admin is null;
  if not found then raise exception 'YA_EXISTE_CLAVE'; end if;
  return true;
end $$;

-- ---------- Funciones de administrador (piden la contraseña) ----------

create or replace function public.admin_entrar(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin perform _verificar_admin(p_clave); return true; end $$;

create or replace function public.admin_cambiar_clave(p_clave text, p_nueva text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  if p_nueva is null or length(p_nueva) < 4 then raise exception 'CLAVE_CORTA'; end if;
  update ajustes set clave_admin = crypt(p_nueva, gen_salt('bf', 10)) where id = 1;
  return true;
end $$;

-- p_pin vacío o null = quitar el PIN (cualquiera con el enlace vende)
create or replace function public.admin_fijar_pin(p_clave text, p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  if p_pin is null or p_pin = '' then
    update ajustes set pin_vendedor = null where id = 1;
  else
    if length(p_pin) < 4 then raise exception 'PIN_CORTO'; end if;
    update ajustes set pin_vendedor = crypt(p_pin, gen_salt('bf', 8)) where id = 1;
  end if;
  return true;
end $$;

create or replace function public.admin_productos(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  return (select coalesce(jsonb_agg(_producto_json(p) order by p.tipo desc, p.categoria, p.nombre), '[]'::jsonb) from productos p);
end $$;

create or replace function public.admin_guardar_producto(p_clave text, p_prod jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(p_prod->>'id', ''); v_tipo text;
begin
  perform _verificar_admin(p_clave);
  if coalesce(trim(p_prod->>'name'), '') = '' then raise exception 'NOMBRE_VACIO'; end if;
  v_tipo := case when p_prod->>'type' = 'insumo' then 'insumo' else 'venta' end;
  if v_id is null then v_id := gen_random_uuid()::text; end if;
  insert into productos (id, nombre, categoria, tipo, precio, costo, stock, minimo)
  values (v_id, trim(p_prod->>'name'), coalesce(trim(p_prod->>'cat'), ''), v_tipo,
          greatest(coalesce((p_prod->>'price')::numeric, 0), 0), greatest(coalesce((p_prod->>'cost')::numeric, 0), 0),
          (p_prod->>'stock')::int, greatest(coalesce((p_prod->>'min')::int, 5), 0))
  on conflict (id) do update set nombre = excluded.nombre, categoria = excluded.categoria, tipo = excluded.tipo,
          precio = excluded.precio, costo = excluded.costo, stock = excluded.stock, minimo = excluded.minimo;
  return v_id;
end $$;

create or replace function public.admin_eliminar_producto(p_clave text, p_id text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  delete from productos where id = p_id;
  return true;
end $$;

create or replace function public.admin_ajustar_stock(p_clave text, p_id text, p_delta int) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v int;
begin
  perform _verificar_admin(p_clave);
  update productos set stock = greatest(coalesce(stock, 0) + p_delta, 0) where id = p_id returning stock into v;
  if not found then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  return v;
end $$;

create or replace function public.admin_ventas(p_clave text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  return (select coalesce(jsonb_agg(_venta_json(v, true) order by v.orden), '[]'::jsonb)
          from ventas v where v.dia = coalesce(p_dia, _hoy()));
end $$;

create or replace function public.admin_anular(p_clave text, p_uid uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v ventas%rowtype; it jsonb;
begin
  perform _verificar_admin(p_clave);
  select * into v from ventas where id = p_uid for update;
  if not found then raise exception 'VENTA_NO_EXISTE'; end if;
  if v.anulada then return true; end if;
  update ventas set anulada = true where id = p_uid;
  for it in select value from jsonb_array_elements(v.items) loop      -- devuelve el stock
    update productos set stock = stock + (it->>'qty')::int where id = it->>'id' and stock is not null;
  end loop;
  return true;
end $$;

create or replace function public.admin_respaldo(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _verificar_admin(p_clave);
  return jsonb_build_object(
    'products', (select coalesce(jsonb_agg(_producto_json(p) order by p.nombre), '[]'::jsonb) from productos p),
    'sales',    (select coalesce(jsonb_agg(_venta_json(v, true) order by v.fecha), '[]'::jsonb) from ventas v));
end $$;

-- Sube un respaldo (de esta página o de las versiones anteriores).
-- Actualiza los productos del respaldo y agrega las ventas que falten.
create or replace function public.admin_restaurar(p_clave text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v jsonb; v_fecha timestamptz; v_dia date; v_orden int; n_p int := 0; n_v int := 0;
begin
  perform _verificar_admin(p_clave);
  for v in select value from jsonb_array_elements(coalesce(p_datos->'products', '[]'::jsonb)) loop
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
    insert into ventas (ref, fecha, dia, orden, items, total, pago, recibido, anulada)
    values (v->>'id', v_fecha, v_dia, v_orden, coalesce(v->'items', '[]'::jsonb), coalesce((v->>'total')::numeric, 0),
            case when v->>'pay' = 'transferencia' then 'transferencia' else 'efectivo' end,
            coalesce((v->>'received')::numeric, 0), coalesce((v->>'void')::boolean, false));
    n_v := n_v + 1;
  end loop;
  return jsonb_build_object('productos', n_p, 'ventas', n_v);
end $$;

-- ---------- Permisos ----------
-- Las ayudas internas no se pueden llamar desde afuera.
revoke all on function public._verificar_admin(text), public._venta_json(public.ventas, boolean),
                       public._producto_json(public.productos), public._hoy() from public, anon, authenticated;

grant execute on function
  public.estado(), public.menu(), public.registrar_venta(text, jsonb, text, numeric), public.crear_clave(text),
  public.admin_entrar(text), public.admin_cambiar_clave(text, text), public.admin_fijar_pin(text, text),
  public.admin_productos(text), public.admin_guardar_producto(text, jsonb), public.admin_eliminar_producto(text, text),
  public.admin_ajustar_stock(text, text, int), public.admin_ventas(text, date), public.admin_anular(text, uuid),
  public.admin_respaldo(text), public.admin_restaurar(text, jsonb)
to anon, authenticated;

-- ---------- Productos iniciales (solo si la tabla está vacía) ----------
insert into public.productos (id, nombre, categoria, tipo, precio, costo, stock, minimo)
select * from (values
  ('oblea-arequipe',        'Oblea solo arequipe',               'Obleas',           'venta',   3500,     0, null::int, 5),
  ('oblea-arequipe-queso',  'Oblea arequipe + queso',            'Obleas',           'venta',   4500,     0, null, 5),
  ('oblea-1-salsa',         'Oblea arequipe + queso + 1 salsa',  'Obleas',           'venta',   5500,     0, null, 5),
  ('oblea-3-salsas',        'Oblea arequipe + queso + 3 salsas', 'Obleas',           'venta',   6500,     0, null, 5),
  ('boli-corozo',           'Boli de corozo',                    'Bolis en agua',    'venta',   4000,  2800, null, 5),
  ('boli-tamarindo',        'Boli de tamarindo',                 'Bolis en agua',    'venta',   4000,  2800, null, 5),
  ('boli-maracuya-agua',    'Boli de maracuyá (agua)',           'Bolis en agua',    'venta',   4000,  2800, null, 5),
  ('boli-guanabana',        'Boli de guanábana',                 'Bolis en leche',   'venta',   4500,  2800, null, 5),
  ('boli-maracuya-leche',   'Boli de maracuyá (leche)',          'Bolis en leche',   'venta',   4500,  2800, null, 5),
  ('boli-kola',             'Boli de kola',                      'Bolis en leche',   'venta',   4500,  2800, null, 5),
  ('boli-coco',             'Boli de coco',                      'Bolis en leche',   'venta',   4500,  2800, null, 5),
  ('boli-arequipe',         'Boli de arequipe',                  'Bolis especiales', 'venta',   4500,  2800, null, 5),
  ('boli-milo',             'Boli de Milo',                      'Bolis especiales', 'venta',   4500,  2800, null, 5),
  ('boli-galleta-bocadillo','Boli de galleta con bocadillo',     'Bolis especiales', 'venta',   4500,  2800, null, 5),
  ('ins-arequipe',          'Arequipe Basileia 5 kg',            'Insumos',          'insumo', 62000, 62000, null, 1),
  ('ins-obleas',            'Paquete de obleas x100 u',          'Insumos',          'insumo', 17000, 17000, null, 1),
  ('ins-salsa-chocolate',   'Salsa de chocolate 1.000 g',        'Insumos',          'insumo', 10000, 10000, null, 1),
  ('ins-salsa-durazno',     'Salsa de durazno 1.000 g',          'Insumos',          'insumo', 10000, 10000, null, 1),
  ('ins-salsa-maracuya',    'Salsa de maracuyá 1.000 g',         'Insumos',          'insumo', 10000, 10000, null, 1),
  ('ins-salsa-mora',        'Salsa de mora 1.000 g',             'Insumos',          'insumo', 10000, 10000, null, 1),
  ('ins-leche-condensada',  'Leche condensada galón',            'Insumos',          'insumo', 67000, 67000, null, 1),
  ('ins-chispitas',         'Chispitas de colores',              'Insumos',          'insumo', 30000, 30000, null, 1),
  ('ins-lluvia-chocolate',  'Lluvia de chocolate',               'Insumos',          'insumo', 30000, 30000, null, 1)
) as t(id, nombre, categoria, tipo, precio, costo, stock, minimo)
where not exists (select 1 from public.productos);

-- Avisa a la API que hay funciones nuevas
notify pgrst, 'reload schema';
