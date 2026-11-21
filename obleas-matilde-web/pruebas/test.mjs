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
const PIN = '654321', MESERO = '777777', CLAVE = 'admin123';

await t('v1 se ejecuta', async () => { await db.exec(v1); });
await t('venta v1 de prueba', async () => { await db.exec(`update ajustes set clave_admin = extensions.crypt('${CLAVE}', extensions.gen_salt('bf'))`); const r = (await db.query(`select public.registrar_venta(null, '[{"id":"oblea-3-salsas","qty":1}]'::jsonb, 'efectivo', 0) r`)).rows[0].r; return r.total; });
await t('v2 se ejecuta', async () => { await db.exec(v2); });
// simula el daño que arregla v3: un insumo quedó como adicional y sin receta
await db.exec(`update productos set tipo = 'adicional', categoria = 'Adicionales', precio = 1000 where id = 'ins-chispitas';
               delete from recetas where insumo_id = 'ins-chispitas';`);
await t('v3 se ejecuta', async () => { await db.exec(v3); });
await t('v3 se ejecuta otra vez (idempotente)', async () => { await db.exec(v3); });
await t('v3 devuelve Chispitas a insumo y repone su receta', async () => {
  const r = await q1(`select tipo, precio::int, contenido::int, (select count(*)::int from recetas where insumo_id = 'ins-chispitas') rec from productos where id = 'ins-chispitas'`);
  eq(r, { tipo: 'insumo', precio: 30000, contenido: 1000, rec: 1 }); return r;
});

await t('las 4 obleas existen y aceptan adicionales', async () => { const r = (await db.query(`select id, nombre, precio, salsas_incluidas, acepta_adicionales from productos where id like 'oblea%' order by precio`)).rows; if (r.length !== 4 || r.some(x => !x.acepta_adicionales)) throw new Error(JSON.stringify(r)); return r.map(x => `${x.nombre} $${x.precio} incl=${x.salsas_incluidas}`); });
await t('estado', () => rpc('estado'));
const cat = await rpc('catalogo');
await t('catalogo: productos y adicionales (sin insumos)', async () => { if (cat.adicionales.some(a => a.id.startsWith('ins-'))) throw new Error('hay insumos en adicionales'); return { productos: cat.productos.length, adicionales: cat.adicionales.length }; });
await t('costo oblea base ≈ 747.5', async () => { const r = await q1(`select round(public._costo_unit('oblea-arequipe'),2) c`); if (Math.abs(r.c - 747.5) > .01) throw new Error(r.c); return r.c; });
await t('costo adicional salsa ≈ 287.5', async () => { const r = await q1(`select round(public._costo_unit('add-salsa-mora'),2) c`); if (Math.abs(r.c - 287.5) > .01) throw new Error(r.c); return r.c; });

await fails('anon no lee tablas', async () => { await db.exec('set role anon'); try { await db.query('select * from ventas'); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no lee intentos', async () => { await db.exec('set role anon'); try { await db.query('select * from intentos'); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no llama _armar', async () => { await db.exec('set role anon'); try { await db.query(`select public._armar('[]'::jsonb)`); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('anon no llama _acceso', async () => { await db.exec('set role anon'); try { await db.query(`select public._acceso('admin','x')`); } finally { await db.exec('reset role'); } }, 'permission denied');
await fails('la función vieja menu() ya no existe', () => rpc('menu'), 'does not exist');

await fails('vender con caja cerrada', () => rpc('registrar_venta', { p_pin: null, p_items: [{ id: 'oblea-arequipe', qty: 1 }], p_pago: 'efectivo' }), 'CAJA_CERRADA');
await fails('PIN de 4 caracteres ya no se acepta', () => rpc('admin_fijar_pin', { p_clave: CLAVE, p_pin: '4321' }), 'PIN_CORTO');
await fails('contraseña de menos de 8 ya no se acepta', () => rpc('admin_cambiar_clave', { p_clave: CLAVE, p_nueva: 'corta12' }), 'CLAVE_CORTA');
await t('un PIN viejo de 4 caracteres sigue funcionando', async () => {
  await db.exec(`update ajustes set pin_vendedor = extensions.crypt('4321', extensions.gen_salt('bf'))`);
  const c = await rpc('abrir_caja', { p_pin: '4321', p_base: 0 }); await rpc('cerrar_caja', { p_pin: '4321', p_contado: 0 });
  return c.abierta;
});
await t('fijar PIN de 6', () => rpc('admin_fijar_pin', { p_clave: CLAVE, p_pin: PIN }));
await fails('abrir caja con PIN malo', () => rpc('abrir_caja', { p_pin: '000000', p_base: 50000 }), 'PIN_INCORRECTO');
await fails('base negativa', () => rpc('abrir_caja', { p_pin: PIN, p_base: -1 }), 'VALOR_INVALIDO');
await t('abrir caja', () => rpc('abrir_caja', { p_pin: PIN, p_base: 50000 }));
await fails('abrir caja dos veces', () => rpc('abrir_caja', { p_pin: PIN, p_base: 1 }), 'CAJA_YA_ABIERTA');

await t('insumos: compra arequipe (2 baldes) y contar obleas', async () => [
  await rpc('admin_insumo_compra', { p_clave: CLAVE, p_id: 'ins-arequipe', p_paquetes: 2, p_precio: 62000 }),
  await rpc('admin_insumo_contar', { p_clave: CLAVE, p_id: 'ins-obleas', p_cantidad: 100 })]);
await t('precio queso por compra (4 kg a $80.000)', () => rpc('admin_insumo_compra', { p_clave: CLAVE, p_id: 'ins-queso', p_paquetes: 1, p_precio: 80000 }));

const s1 = await rpc('registrar_venta', { p_pin: PIN, p_items: [{ id: 'oblea-1-salsa', qty: 2, adds: ['add-salsa-mora', 'add-salsa-chocolate'] }, { id: 'boli-coco', qty: 1 }], p_pago: 'efectivo', p_recibido: 20000 });
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
await t('admin_ventas con costos y consumo', async () => { const v = await rpc('admin_ventas', { p_clave: CLAVE, p_dia: null }); return v.length; });

// --- bloqueo de intentos (al final: deja contadores) ---
await db.exec(`delete from intentos`);
await t('5 contraseñas malas bloquean ese dispositivo, aunque luego acierte', async () => {
  await ip('1.1.1.1');
  for (let i = 0; i < 5; i++) { try { await rpc('admin_entrar', { p_clave: 'mala' + i }); } catch (e) { if (!e.message.includes('CLAVE_INCORRECTA')) throw e; } }
  try { await rpc('admin_entrar', { p_clave: CLAVE }); throw new Error('no bloqueó'); } catch (e) { if (!e.message.startsWith('BLOQUEADO:')) throw e; return e.message; }
});
await t('otro dispositivo sí puede entrar', async () => { await ip('2.2.2.2'); return rpc('admin_entrar', { p_clave: CLAVE }); });
await t('el bloqueo también frena el PIN y el código desde otro tipo', async () => {
  await ip('3.3.3.3');
  for (let i = 0; i < 5; i++) { try { await rpc('verificar_mesero', { p_codigo: 'x' + i }); } catch (e) { } }
  try { await rpc('verificar_mesero', { p_codigo: MESERO }); throw new Error('no bloqueó'); } catch (e) { if (!e.message.startsWith('BLOQUEADO')) throw e; }
  return rpc('abrir_caja', { p_pin: PIN, p_base: 0 }).then(c => c.abierta);   // el PIN es otro contador
});
await t('tope general: 20 contraseñas malas desde muchos dispositivos bloquean a todos', async () => {
  await db.exec(`delete from intentos`);
  for (let i = 0; i < 20; i++) { await ip('9.9.9.' + i); try { await rpc('admin_entrar', { p_clave: 'mala' }); } catch (e) { } }
  await ip('8.8.8.8');
  try { await rpc('admin_entrar', { p_clave: CLAVE }); throw new Error('no bloqueó'); } catch (e) { if (!e.message.startsWith('BLOQUEADO')) throw e; return e.message; }
});
await ip(null); await db.exec(`delete from intentos`);
await fails('admin sin clave correcta', () => rpc('admin_cajas', { p_clave: 'mala', p_dia: null }), 'CLAVE_INCORRECTA');

console.log(`\n${ok} bien, ${bad} con error`);
process.exit(bad ? 1 : 0);
