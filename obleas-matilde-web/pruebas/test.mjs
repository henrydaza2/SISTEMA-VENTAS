// Pruebas de la base de datos sobre un Postgres local (PGlite). Uso: node test.mjs ..
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const dir = process.argv[2] || '..';
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon; create role authenticated; create schema extensions;`);
const v1 = fs.readFileSync(dir + '/supabase.sql', 'utf8');
const v2 = fs.readFileSync(dir + '/supabase-v2.sql', 'utf8');
const v3 = fs.readFileSync(dir + '/supabase-v3.sql', 'utf8');
const v4 = fs.readFileSync(dir + '/supabase-v4.sql', 'utf8');
const v5 = fs.readFileSync(dir + '/supabase-v5.sql', 'utf8');

let ok = 0, bad = 0;
const t = async (name, fn) => { try { const r = await fn(); console.log('OK  ', name, r === undefined ? '' : JSON.stringify(r).slice(0, 300)); ok++; } catch (e) { console.log('FAIL', name, e.message); bad++; } };
const fails = async (name, fn, code) => { try { await fn(); console.log('FAIL', name, '(no lanzó error)'); bad++; } catch (e) { if (e.message.includes(code)) { console.log('OK  ', name, '→', code); ok++; } else { console.log('FAIL', name, e.message); bad++; } } };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} esperaba ${JSON.stringify(b)}, llegó ${JSON.stringify(a)}`); };
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ip = async (v) => db.query(`select set_config('request.headers', $1, false)`, [v ? JSON.stringify({ 'cf-connecting-ip': v }) : '{}']);
// llama una función como el rol anónimo, igual que la página: {"error": ...} se vuelve un error
const rpc = async (fn, args = {}) => {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
  await db.exec('set role anon');
  let r;
  try { r = (await db.query(sql, vals)).rows[0].r; } finally { await db.exec('reset role'); }
  if (r && typeof r === 'object' && !Array.isArray(r) && typeof r.error === 'string') throw new Error(r.error);
  return r;
};
const PIN = 'ana2024x', MESERO = '777777', CLAVE = 'admin123';   // PIN = contraseña de la vendedora Ana

await t('v1 se ejecuta', async () => { await db.exec(v1); });
await t('venta v1 de prueba', async () => { await db.exec(`update ajustes set clave_admin = extensions.crypt('${CLAVE}', extensions.gen_salt('bf'))`); const r = (await db.query(`select public.registrar_venta(null, '[{"id":"oblea-3-salsas","qty":1}]'::jsonb, 'efectivo', 0) r`)).rows[0].r; return r.total; });
await t('v2 se ejecuta', async () => { await db.exec(v2); });
// simula el daño que arregla v3: un insumo quedó como adicional y sin receta
await db.exec(`update productos set tipo = 'adicional', categoria = 'Adicionales', precio = 1000 where id = 'ins-chispitas';
               delete from recetas where insumo_id = 'ins-chispitas';`);
await t('v3 se ejecuta', async () => { await db.exec(v3); });
await t('v3 se ejecuta otra vez (idempotente)', async () => { await db.exec(v3); });
// una oblea creada a mano (sin receta) también debe usar el paquete de galletas
await db.exec(`insert into productos (id, nombre, categoria, tipo, precio) values ('meseros-oblea', 'Oblea solo Arequipe Meseros', 'Obleas', 'venta', 2000)`);
await t('v4 se ejecuta', async () => { await db.exec(v4); });
await t('v4 se ejecuta otra vez (idempotente)', async () => { await db.exec(v4); });
// el PIN de vendedor que había antes de v5 debe quedar como el vendedor "Vendedor"
await db.exec(`update ajustes set pin_vendedor = extensions.crypt('4321', extensions.gen_salt('bf'))`);
await t('v5 se ejecuta', async () => { await db.exec(v5); });
await t('v3 + v4 + v5 juntos se pueden volver a ejecutar', async () => { await db.exec(v3 + '\n' + v4 + '\n' + v5); });
await t('después de repetir v3 + v4 + v5 las galletas siguen exactas', async () => (await q1(`select round(public._costo_unit('oblea-arequipe'),2) c`)).c);
await t('todas las obleas del menú usan 2 galletas', async () => {
  const r = (await db.query(`select p.id, r.cantidad::int c from productos p left join recetas r on r.producto_id = p.id and r.insumo_id = 'ins-obleas'
                             where p.tipo = 'venta' and p.nombre ilike '%oblea%' order by p.id`)).rows;
  if (r.length !== 5 || r.some(x => x.c !== 2)) throw new Error(JSON.stringify(r)); return r.map(x => x.id);
});
await t('un producto que se llama "oblea" pero no está en la categoría Obleas no recibe galletas', async () => {
  const id = await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { name: 'Malteada de oblea', type: 'venta', cat: 'Malteadas', price: 7000, cost: 2500 } });
  eq((await q1(`select count(*)::int n from recetas where producto_id = $1`, [id])).n, 0, 'recetas');
  await db.exec(`insert into recetas (producto_id, insumo_id, cantidad) values ('${id}', 'ins-obleas', 3)`);
  eq((await q1(`select cantidad::int c from recetas where producto_id = $1`, [id])).c, 3, 'su receta se respeta');
  await db.exec(`delete from productos where id = '${id}'`);   // se borra para no cambiar los demás cálculos
  return 'sin galletas automáticas';
});
await t('v3 devuelve Chispitas a insumo y repone su receta', async () => {
  const r = await q1(`select tipo, precio::int, contenido::int, (select count(*)::int from recetas where insumo_id = 'ins-chispitas') rec from productos where id = 'ins-chispitas'`);
  eq(r, { tipo: 'insumo', precio: 30000, contenido: 1000, rec: 1 }); return r;
});

await t('las 4 obleas existen y aceptan adicionales', async () => { const r = (await db.query(`select id, nombre, precio, salsas_incluidas, acepta_adicionales from productos where id like 'oblea%' order by precio`)).rows; if (r.length !== 4 || r.some(x => !x.acepta_adicionales)) throw new Error(JSON.stringify(r)); return r.map(x => `${x.nombre} $${x.precio} incl=${x.salsas_incluidas}`); });
await t('estado', () => rpc('estado'));
const cat = await rpc('catalogo');
await t('catalogo: productos y adicionales (sin insumos)', async () => { if (cat.adicionales.some(a => a.id.startsWith('ins-'))) throw new Error('hay insumos en adicionales'); return { productos: cat.productos.length, adicionales: cat.adicionales.length }; });
// 2 galletas exactas ($340) + 25 g de arequipe con 15 % de merma ($356,5)
await t('costo oblea base ≈ 696.5 (galletas sin merma)', async () => { const r = await q1(`select round(public._costo_unit('oblea-arequipe'),2) c`); if (Math.abs(r.c - 696.5) > .01) throw new Error(r.c); return r.c; });
await t('costo adicional salsa ≈ 287.5', async () => { const r = await q1(`select round(public._costo_unit('add-salsa-mora'),2) c`); if (Math.abs(r.c - 287.5) > .01) throw new Error(r.c); return r.c; });

await fails('anon no lee tablas', async () => { await db.exec('set role anon'); try { await db.query('select * from ventas'); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no lee intentos', async () => { await db.exec('set role anon'); try { await db.query('select * from intentos'); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no llama _armar', async () => { await db.exec('set role anon'); try { await db.query(`select public._armar('[]'::jsonb)`); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no llama _acceso', async () => { await db.exec('set role anon'); try { await db.query(`select public._acceso('admin','x')`); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('la función vieja menu() ya no existe', () => rpc('menu'), 'does not exist');

await fails('vender con caja cerrada', () => rpc('registrar_venta', { p_pin: '4321', p_items: [{ id: 'oblea-arequipe', qty: 1 }], p_pago: 'efectivo' }), 'CAJA_CERRADA');
await t('el PIN que había quedó como el vendedor "Vendedor"', async () => {
  const v = await rpc('admin_vendedores', { p_clave: CLAVE });
  eq(v.map(x => x.name), ['Vendedor'], 'vendedores'); eq((await q1(`select pin_vendedor from ajustes`)).pin_vendedor, null, 'pin viejo borrado');
  return v[0].active;
});
await fails('contraseña de vendedor de menos de 6 no se acepta', () => rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: null, p_nombre: 'Ana', p_contra: 'ab1' }), 'PIN_CORTO');
await fails('contraseña de menos de 8 ya no se acepta', () => rpc('admin_cambiar_clave', { p_clave: CLAVE, p_nueva: 'corta12' }), 'CLAVE_CORTA');
await t('el PIN viejo de 4 caracteres sigue funcionando', async () => {
  const c = await rpc('abrir_caja', { p_pin: '4321', p_base: 0 }); await rpc('cerrar_caja', { p_pin: '4321', p_contado: 0 });
  return c.abierta;
});
await t('crear la vendedora Ana con contraseña de letras y números', () => rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: null, p_nombre: 'Ana', p_contra: PIN }));
await fails('no se repite el nombre de un vendedor', () => rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: null, p_nombre: 'ana', p_contra: 'otra123' }), 'VENDEDOR_EXISTE');
await fails('no se repite la contraseña de otro vendedor', () => rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: null, p_nombre: 'Luis', p_contra: PIN }), 'CONTRA_REPETIDA');
await fails('la función vieja admin_fijar_pin ya no existe', () => rpc('admin_fijar_pin', { p_clave: CLAVE, p_pin: '123456' }), 'does not exist');
await t('llave de transferencia: viene por defecto y se cambia desde Ajustes', async () => {
  eq((await rpc('estado')).llave, '@NEQUIZHA210', 'por defecto');
  await rpc('admin_fijar_llave', { p_clave: CLAVE, p_llave: '  @OTRA123 ' }); eq((await rpc('estado')).llave, '@OTRA123', 'cambiada');
  await rpc('admin_fijar_llave', { p_clave: CLAVE, p_llave: '@NEQUIZHA210' }); return 'ok';
});
await fails('abrir caja con PIN malo', () => rpc('abrir_caja', { p_pin: '000000', p_base: 50000 }), 'PIN_INCORRECTO');
await fails('base negativa', () => rpc('abrir_caja', { p_pin: PIN, p_base: -1 }), 'VALOR_INVALIDO');
await t('abrir caja', () => rpc('abrir_caja', { p_pin: PIN, p_base: 50000 }));
await fails('abrir caja dos veces', () => rpc('abrir_caja', { p_pin: PIN, p_base: 1 }), 'CAJA_YA_ABIERTA');

await t('insumos: compra arequipe (2 baldes) y contar obleas', async () => [
  await rpc('admin_insumo_compra', { p_clave: CLAVE, p_id: 'ins-arequipe', p_paquetes: 2, p_precio: 62000 }),
  await rpc('admin_insumo_contar', { p_clave: CLAVE, p_id: 'ins-obleas', p_cantidad: 100 })]);
await t('precio queso por compra (4 kg a $80.000)', () => rpc('admin_insumo_compra', { p_clave: CLAVE, p_id: 'ins-queso', p_paquetes: 1, p_precio: 80000 }));

const s1 = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-1-salsa', qty: 2, adds: ['add-salsa-mora', 'add-salsa-chocolate'] }, { id: 'boli-coco', qty: 1 }], p_pago: 'efectivo', p_recibido: 20000 });
await t('la venta guarda quién la atendió', async () => { eq(s1.seller, 'Ana'); return s1.seller; });
await t('venta: 1 salsa incluida + 1 extra, total 17.500, sin costos visibles', async () => { if (s1.total != 17500) throw new Error(s1.total); if (JSON.stringify(s1).includes('"cost"')) throw new Error('expone costos'); return { total: s1.total, adds: s1.items[0].adds }; });
const s1b = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 1, adds: ['add-salsa-mora'] }, { id: 'oblea-3-salsas', qty: 1, adds: ['add-salsa-mora', 'add-salsa-durazno', 'add-salsa-maracuya'] }], p_pago: 'efectivo' });
await t('solo arequipe + salsa = 4.500; 3 salsas = 6.500 → 11.000', async () => { eq(+s1b.total, 11000); return s1b.total; });
await fails('más de 20 adicionales', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 1, adds: Array(21).fill('add-queso') }], p_pago: 'efectivo' }), 'VALOR_INVALIDO');
await fails('recibido enorme', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 1 }], p_pago: 'efectivo', p_recibido: 1e9 }), 'VALOR_INVALIDO');

// --- venta repetida por falta de señal ---
const stockQ = async () => (await q1(`select existencia from productos where id = 'ins-arequipe'`)).existencia;
const antes = await stockQ();
const r1 = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 1 }], p_pago: 'efectivo', p_ref: 'carrito-abc' });
const r2 = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 1 }], p_pago: 'efectivo', p_ref: 'carrito-abc' });
await t('cobrar dos veces el mismo carrito guarda UNA venta', async () => {
  eq(r2.uid, r1.uid, 'uid'); eq(r2.order, r1.order, 'orden');
  const n = (await q1(`select count(*)::int n from ventas where ref = 'carrito-abc'`)).n; eq(n, 1, 'ventas');
  eq(Math.round(antes - await stockQ()), 29, 'arequipe descontado una vez (25 g + 15 %)'); return { orden: r1.order };
});

await fails('descuento sin código creado', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 1 }], p_pago: 'efectivo', p_descuento: 500, p_codigo: 'x' }), 'SIN_CODIGO_MESERO');
await t('crear código meseros', () => rpc('admin_fijar_codigo_mesero', { p_clave: CLAVE, p_codigo: MESERO }));
await fails('código mesero malo', () => rpc('verificar_mesero', { p_codigo: '111111' }), 'CODIGO_MESERO_INCORRECTO');
await t('cada oblea vendida descuenta exactamente 2 galletas', async () => {
  const g = async () => +(await q1(`select existencia from productos where id = 'ins-obleas'`)).existencia;
  const a = await g();
  const v = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 3 }, { id: 'oblea-3-salsas', qty: 2, adds: ['add-salsa-mora', 'add-salsa-durazno', 'add-salsa-maracuya'] }], p_pago: 'efectivo' });
  eq(a - await g(), 10, 'galletas'); await rpc('admin_anular', { p_clave: CLAVE, p_uid: v.uid }); eq(await g(), a, 'anular las devuelve');
  return 'gastó 10, anular las devolvió';
});
await t('código de mesero malo en la venta no toca el inventario', async () => {
  const a = await stockQ();
  try { await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-arequipe', qty: 1 }], p_pago: 'efectivo', p_descuento: 500, p_codigo: '000000' }); throw new Error('no falló'); }
  catch (e) { if (!e.message.includes('CODIGO_MESERO_INCORRECTO')) throw e; }
  eq(await stockQ(), a); return 'sin cambios';
});
await fails('descuento mayor que el total', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 1 }], p_pago: 'efectivo', p_descuento: 9000, p_codigo: MESERO }), 'DESCUENTO_MAYOR');
await t('fijar descuento máximo 10 %', () => rpc('admin_fijar_descuento_max', { p_clave: CLAVE, p_pct: 10 }));
await fails('descuento por encima del máximo', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 2 }], p_pago: 'efectivo', p_descuento: 1000, p_codigo: MESERO }), 'DESCUENTO_MAXIMO');
await t('volver a 100 %', () => rpc('admin_fijar_descuento_max', { p_clave: CLAVE, p_pct: 100 }));
const s2 = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 2 }], p_pago: 'transferencia', p_descuento: 1000, p_codigo: MESERO });
await t('venta con descuento mesero', async () => ({ order: s2.order, subtotal: s2.subtotal, discount: s2.discount, total: s2.total }));
await fails('adicional en boli', () => rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 1, adds: ['add-queso'] }], p_pago: 'efectivo' }), 'NO_ACEPTA_ADICIONALES');

await t('editar venta 1 (1 oblea, 1 salsa)', async () => { const e = await rpc('admin_editar_venta', { p_clave: CLAVE, p_uid: s1.uid, p_items: [{ id: 'oblea-1-salsa', qty: 1, adds: ['add-salsa-mora'] }], p_pago: 'transferencia' }); eq(+e.total, 5500); return { order: e.order, total: e.total, edited: !!e.edited }; });
await t('anular venta 2', () => rpc('admin_anular', { p_clave: CLAVE, p_uid: s2.uid }));

// --- productos ---
await fails('no se puede cambiar el tipo de un producto', () => rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'ins-queso', name: 'Queso', type: 'adicional', price: 1000 } }), 'NO_CAMBIAR_TIPO');
await t('editar un producto sin "stock" no pisa el stock', async () => {
  await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'boli-kola', name: 'Boli de kola', type: 'venta', cat: 'Bolis en leche', price: 4500, cost: 2800, stock: 10, min: 2 } });
  await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-kola', qty: 3 }], p_pago: 'efectivo' });
  await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'boli-kola', name: 'Boli de kola', type: 'venta', cat: 'Bolis en leche', price: 5000, cost: 2800, min: 2 } });
  const r = await q1(`select stock, precio::int from productos where id = 'boli-kola'`); eq(r, { stock: 7, precio: 5000 }); return r;
});
await t('restaurar respaldo viejo (sin adds_ok) conserva adicionales', async () => { await rpc('admin_restaurar', { p_clave: CLAVE, p_datos: { products: [{ id: 'oblea-1-salsa', name: 'Oblea arequipe + queso + 1 salsa', type: 'venta', cat: 'Obleas', price: 5500, stock: null, min: 5 }], sales: [] } }); const r = await q1(`select acepta_adicionales, salsas_incluidas from productos where id='oblea-1-salsa'`); if (!r.acepta_adicionales || r.salsas_incluidas !== 1) throw new Error(JSON.stringify(r)); return r; });
await t('un respaldo con código escondido se limpia al guardarse', async () => {
  await rpc('admin_restaurar', { p_clave: CLAVE, p_datos: { products: [], sales: [{ id: 'malo-1', date: '2026-01-02T15:00:00Z', total: 'x', pay: 'efectivo',
    items: [{ id: 'z', name: '<img src=x onerror=alert(1)>', qty: '<img src=x onerror=alert(1)>', price: '1e400', adds: 'nada' }],
    consumo: [{ id: 'q', name: 'n', unit: '<script>', qty: 'abc', cost: 5 }] }] } });
  const v = await q1(`select items, consumo, total from ventas where ref = 'malo-1'`);
  eq(v.items[0].qty, 1, 'qty'); eq(v.items[0].price, 0, 'price'); eq(v.items[0].adds, [], 'adds'); eq(v.consumo[0].unit, 'u', 'unit'); eq(+v.total, 0, 'total');
  return v.items[0];
});
await t('respaldo y restaurar', async () => { const b = await rpc('admin_respaldo', { p_clave: CLAVE }); return rpc('admin_restaurar', { p_clave: CLAVE, p_datos: b }); });

// --- caja después de medianoche ---
await t('una venta pasada la medianoche queda en el día de la caja', async () => {
  await db.exec(`update cajas set dia = dia - 1 where cerrada_en is null`);
  const dia = (await q1(`select dia::text d from cajas where cerrada_en is null`)).d;
  const v = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'boli-coco', qty: 1 }], p_pago: 'efectivo' });
  eq(v.day, dia); await db.exec(`update cajas set dia = dia + 1 where cerrada_en is null`);
  return { day: v.day, order: v.order };
});

await fails('cerrar caja con PIN malo', () => rpc('cerrar_caja', { p_pin: '1', p_contado: 0 }), 'PIN_INCORRECTO');
await t('cerrar caja (contó 49.000)', () => rpc('cerrar_caja', { p_pin: PIN, p_contado: 49000, p_notas: 'faltó un billete' }));
await t('admin_cajas', async () => { const c = await rpc('admin_cajas', { p_clave: CLAVE, p_dia: null }); return c.map(x => ({ base: x.base, efectivo: x.efectivo, contado: x.contado, abierta: x.abierta })); });
await t('corregir una caja cerrada: cambia lo contado, recalcula y queda anotado', async () => {
  const c = (await rpc('admin_cajas', { p_clave: CLAVE, p_dia: null })).find(x => !x.abierta && +x.contado === 49000);
  const r = await rpc('admin_corregir_caja', { p_clave: CLAVE, p_id: c.id, p_base: null, p_contado: 61000, p_notas: 'se contó mal' });
  eq(+r.contado, 61000, 'contado'); eq(+r.base, +c.base, 'base igual'); eq(r.notas, 'se contó mal', 'notas');
  eq(+r.esperado_al_cerrar, +c.base + +c.efectivo, 'debería haber');
  eq(r.correcciones.length, 1, 'anotada'); eq(+r.correcciones[0].antes.contado, 49000, 'antes');
  return { contado: r.contado, corregida: !!r.corregida };
});
await fails('el vendedor no puede corregir una caja', () => rpc('admin_corregir_caja', { p_clave: PIN, p_id: '00000000-0000-0000-0000-000000000000', p_base: 1, p_contado: 1, p_notas: '' }), 'CLAVE_INCORRECTA');
await fails('no se corrige una caja que no existe', () => rpc('admin_corregir_caja', { p_clave: CLAVE, p_id: '00000000-0000-0000-0000-000000000000', p_base: 1, p_contado: 1, p_notas: '' }), 'CAJA_NO_EXISTE');
await t('reabrir una caja cerrada y volver a cerrarla', async () => {
  const c = (await rpc('admin_cajas', { p_clave: CLAVE, p_dia: null })).find(x => !x.abierta && +x.contado === 61000);
  const r = await rpc('admin_reabrir_caja', { p_clave: CLAVE, p_id: c.id });
  eq(r.abierta, true, 'abierta'); eq(r.correcciones.length, 2, 'anotada');
  eq((await rpc('estado')).caja.abierta, true, 'estado');
  await rpc('cerrar_caja', { p_pin: PIN, p_contado: 61000 });
  return 'ok';
});
await db.exec(`delete from intentos`);
await t('admin_ventas con costos y consumo', async () => { const v = await rpc('admin_ventas', { p_clave: CLAVE, p_dia: null }); return v.length; });

// --- galletas automáticas, estimado y vista de vendedor (v4) ---
await t('una oblea nueva creada desde la página recibe 2 galletas aunque no las ponga', async () => {
  const id = await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { name: 'Oblea de prueba', type: 'venta', cat: 'Obleas', price: 3000, recipe: [{ id: 'ins-arequipe', qty: 20 }] } });
  const r = (await db.query(`select insumo_id, cantidad::int c from recetas where producto_id = $1 order by insumo_id`, [id])).rows;
  eq(r, [{ insumo_id: 'ins-arequipe', c: 20 }, { insumo_id: 'ins-obleas', c: 2 }]); return r;
});
await t('si se escribe otro número de galletas en una oblea, quedan 2', async () => {
  await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'oblea-arequipe', name: 'Oblea solo arequipe', type: 'venta', cat: 'Obleas', price: 3500, recipe: [{ id: 'ins-obleas', qty: 3 }, { id: 'ins-arequipe', qty: 25 }] } });
  return (await q1(`select cantidad::int c from recetas where producto_id = 'oblea-arequipe' and insumo_id = 'ins-obleas'`)).c === 2 ? 2 : (() => { throw new Error('no quedó en 2'); })();
});
await t('si se quita la receta de una oblea, las galletas vuelven solas', async () => {
  await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'oblea-arequipe', name: 'Oblea solo arequipe', type: 'venta', cat: 'Obleas', price: 3500, recipe: [] } });
  const c = (await q1(`select count(*)::int n from recetas where producto_id = 'oblea-arequipe' and insumo_id = 'ins-obleas'`)).n;
  await rpc('admin_guardar_producto', { p_clave: CLAVE, p_prod: { id: 'oblea-arequipe', name: 'Oblea solo arequipe', type: 'venta', cat: 'Obleas', price: 3500, recipe: [{ id: 'ins-obleas', qty: 2 }, { id: 'ins-arequipe', qty: 25 }] } });
  eq(c, 1); return 'repuestas';
});
await t('un boli no recibe galletas', async () => (await q1(`select count(*)::int n from recetas where producto_id = 'boli-coco'`)).n === 0 ? 'sin receta' : (() => { throw new Error('el boli tiene receta'); })());
await t('estimado: con 100 galletas alcanzan 50 obleas solo arequipe (si hay arequipe)', async () => {
  await db.exec(`update productos set existencia = 100 where id = 'ins-obleas'; update productos set existencia = 100000 where id = 'ins-arequipe'`);
  const cat = await rpc('catalogo');
  eq(cat.productos.find(p => p.id === 'oblea-arequipe').alcanza, 50, 'alcanza');
  await db.exec(`update productos set existencia = 57.5 where id = 'ins-arequipe'`);    // 2 obleas: 25 g x 1,15 = 28,75 g c/u
  eq((await rpc('catalogo')).productos.find(p => p.id === 'oblea-arequipe').alcanza, 2, 'manda el que se acaba primero');
  await db.exec(`update productos set existencia = 100000 where id = 'ins-arequipe'`);
  return 'ok';
});
await t('estimado: sin contar un insumo no se inventa un número', async () => {
  await db.exec(`update productos set existencia = null where id = 'ins-queso'`);
  const p = (await rpc('catalogo')).productos.find(x => x.id === 'oblea-arequipe-queso');
  await db.exec(`update productos set existencia = 4000 where id = 'ins-queso'`);
  eq(p.alcanza, null); return 'null';
});
await t('vendedor ve el inventario con su PIN, sin costos', async () => {
  const inv = await rpc('vend_inventario', { p_pin: PIN });
  const txt = JSON.stringify(inv);
  if (/"cost"|"unit_cost"/.test(txt)) throw new Error('muestra costos');
  if (inv.find(p => p.type === 'insumo').price != null) throw new Error('muestra precio de compra');
  return { productos: inv.length, alcanza: inv.find(p => p.id === 'oblea-arequipe').alcanza };
});
await fails('vendedor con PIN malo no ve el inventario', () => rpc('vend_inventario', { p_pin: '000000' }), 'PIN_INCORRECTO');
await t('vendedor ve la caja sin conteo ni costos', async () => {
  const c = await rpc('vend_caja', { p_pin: PIN });
  const txt = JSON.stringify(c);
  if (/"cost"|"contado"|"esperado|"notas"/.test(txt)) throw new Error('muestra datos del cierre');
  return { dia: c.dia, ventas: c.ventas.length, cajas: c.cajas.length, consumo: c.consumo.length };
});
await fails('el vendedor no puede usar funciones de administrador con su PIN', () => rpc('admin_productos', { p_clave: PIN }), 'CLAVE_INCORRECTA');
await db.exec(`delete from intentos`);

// --- descartes (v5) ---
await t('descartar 200 g de arequipe baja la existencia y calcula la pérdida', async () => {
  await db.exec(`update productos set existencia = 5000 where id = 'ins-arequipe'`);
  const d = await rpc('admin_descartar', { p_clave: CLAVE, p_id: 'ins-arequipe', p_cantidad: 200, p_motivo: 'Se dañó' });
  eq(+(await q1(`select existencia from productos where id = 'ins-arequipe'`)).existencia, 4800, 'existencia');
  eq(+d.cost, 2480, 'pérdida 200 g x $12,4'); return { cost: d.cost, unit: d.unit };
});
let dOblea;
await t('descartar 3 obleas saca 6 galletas y su arequipe, y la pérdida es su costo', async () => {
  await db.exec(`update productos set existencia = 100 where id = 'ins-obleas'`);
  dOblea = await rpc('admin_descartar', { p_clave: CLAVE, p_id: 'oblea-arequipe', p_cantidad: 3, p_motivo: 'No cumplió la calidad' });
  eq(+(await q1(`select existencia from productos where id = 'ins-obleas'`)).existencia, 94, 'galletas');
  const c = +(await q1(`select round(public._costo_unit('oblea-arequipe'),2) c`)).c;
  eq(+dOblea.cost, Math.round(c * 3 * 100) / 100, 'pérdida'); return { cost: dOblea.cost, consumo: dOblea.consumo.length };
});
await t('descartar un boli con stock baja el stock', async () => {
  await db.exec(`update productos set stock = 10 where id = 'boli-milo'`);
  const d = await rpc('admin_descartar', { p_clave: CLAVE, p_id: 'boli-milo', p_cantidad: 2, p_motivo: 'Se venció' });
  eq((await q1(`select stock from productos where id = 'boli-milo'`)).stock, 8, 'stock'); return +d.cost;
});
await fails('no se descartan medias obleas', () => rpc('admin_descartar', { p_clave: CLAVE, p_id: 'oblea-arequipe', p_cantidad: 1.5 }), 'CANTIDAD_INVALIDA');
await fails('no se descarta más stock del que hay', () => rpc('admin_descartar', { p_clave: CLAVE, p_id: 'boli-milo', p_cantidad: 50 }), 'SIN_STOCK');
await t('anular un descarte devuelve las galletas', async () => {
  await rpc('admin_anular_descarte', { p_clave: CLAVE, p_uid: dOblea.uid });
  eq(+(await q1(`select existencia from productos where id = 'ins-obleas'`)).existencia, 100, 'galletas'); return 'devueltas';
});
await t('lista de descartes del día con la pérdida', async () => {
  const l = await rpc('admin_descartes', { p_clave: CLAVE, p_desde: null, p_hasta: null });
  return { total: l.length, anulados: l.filter(d => d.void).length, perdida: l.filter(d => !d.void).reduce((a, d) => a + +d.cost, 0) };
});
await fails('un vendedor no puede descartar con su PIN', () => rpc('admin_descartar', { p_clave: PIN, p_id: 'ins-arequipe', p_cantidad: 1 }), 'CLAVE_INCORRECTA');
await t('el respaldo incluye los descartes y al subirlo se restauran', async () => {
  const b = await rpc('admin_respaldo', { p_clave: CLAVE });
  const n = b.descartes.length; const uno = b.descartes[0].uid;
  await db.exec(`delete from descartes where id = '${uno}'`);
  const r = await rpc('admin_restaurar', { p_clave: CLAVE, p_datos: b });
  eq(r.descartes, 1, 'restaurado'); eq((await q1(`select count(*)::int n from descartes`)).n, n, 'total'); return r;
});
await t('el servidor da el costo de una unidad y para cuántas obleas alcanzan las galletas', async () => {
  const p = await rpc('admin_productos', { p_clave: CLAVE });
  const g = p.find(x => x.id === 'ins-obleas'), o = p.find(x => x.id === 'oblea-arequipe');
  eq(g.alcanza_ins, { n: Math.floor(+g.qty / 2), que: 'obleas' }, 'galletas'); eq(+o.base_cost, 696.5, 'costo oblea');
  return { galletas: g.alcanza_ins, base_cost: o.base_cost };
});
await t('vendedores: lista con ventas de hoy; desactivar quita el acceso', async () => {
  const l = await rpc('admin_vendedores', { p_clave: CLAVE });
  const ana = l.find(v => v.name === 'Ana'), viejo = l.find(v => v.name === 'Vendedor');
  if (!(ana.sales_today > 0)) throw new Error('sin ventas de Ana');
  await rpc('admin_vendedor_activo', { p_clave: CLAVE, p_id: viejo.id, p_activo: false });
  try { await rpc('vend_inventario', { p_pin: '4321' }); throw new Error('entró inactivo'); } catch (e) { if (!e.message.includes('PIN_INCORRECTO')) throw e; }
  await rpc('admin_eliminar_vendedor', { p_clave: CLAVE, p_id: viejo.id });
  await db.exec(`delete from intentos`);
  return { ana: ana.sales_today, quedan: (await rpc('admin_vendedores', { p_clave: CLAVE })).length };
});
await t('cambiar la contraseña de un vendedor', async () => {
  const ana = (await rpc('admin_vendedores', { p_clave: CLAVE })).find(v => v.name === 'Ana');
  await rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: ana.id, p_nombre: 'Ana', p_contra: 'nueva99' });
  await rpc('vend_inventario', { p_pin: 'nueva99' });
  await rpc('admin_guardar_vendedor', { p_clave: CLAVE, p_id: ana.id, p_nombre: 'Ana', p_contra: PIN });
  return 'ok';
});
await db.exec(`delete from intentos`);

// --- bloqueo de intentos (al final: deja contadores) ---
await db.exec(`delete from intentos`);
await t('5 contraseñas malas bloquean el dispositivo para CUALQUIER código, aunque luego acierte', async () => {
  await ip('1.1.1.1');
  for (let i = 0; i < 5; i++) { try { await rpc('admin_entrar', { p_clave: 'mala' + i }); } catch (e) { if (!e.message.includes('CLAVE_INCORRECTA')) throw e; } }
  try { await rpc('admin_entrar', { p_clave: CLAVE }); throw new Error('no bloqueó'); } catch (e) { if (!e.message.startsWith('BLOQUEADO:')) throw e; }
  try { await rpc('vend_inventario', { p_pin: PIN }); throw new Error('no bloqueó al vendedor'); } catch (e) { if (!e.message.startsWith('BLOQUEADO:')) throw e; return e.message; }
});
await t('otro dispositivo sí puede entrar', async () => { await ip('2.2.2.2'); return rpc('admin_entrar', { p_clave: CLAVE }); });
await t('acertar otro código no borra los fallos de la contraseña', async () => {
  await ip('3.3.3.3');
  for (let i = 0; i < 4; i++) { try { await rpc('admin_entrar', { p_clave: 'mala' + i }); } catch (e) { } }
  await rpc('vend_inventario', { p_pin: PIN });           // la vendedora entra bien
  try { await rpc('admin_entrar', { p_clave: 'mala5' }); } catch (e) { }
  try { await rpc('admin_entrar', { p_clave: CLAVE }); throw new Error('no bloqueó'); } catch (e) { if (!e.message.startsWith('BLOQUEADO')) throw e; return e.message; }
});
await t('ya no hay tope general: fallos sueltos de muchos dispositivos no bloquean a otro', async () => {
  await db.exec(`delete from intentos`);
  for (let i = 0; i < 20; i++) { await ip('9.9.9.' + i); try { await rpc('admin_entrar', { p_clave: 'mala' }); } catch (e) { } }
  await ip('8.8.8.8'); return rpc('admin_entrar', { p_clave: CLAVE });
});
await ip(null); await db.exec(`delete from intentos`);
await fails('admin sin clave correcta', () => rpc('admin_cajas', { p_clave: 'mala', p_dia: null }), 'CLAVE_INCORRECTA');

console.log(`\n${ok} bien, ${bad} con error`);
process.exit(bad ? 1 : 0);
