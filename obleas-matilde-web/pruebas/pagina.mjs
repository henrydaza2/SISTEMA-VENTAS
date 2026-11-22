// Pruebas de la página en un navegador real (Edge, sin ventana), contra el servidor de prueba.
// Uso: node pagina.mjs ..    (necesita internet para cargar supabase-js desde jsdelivr)
// Otro navegador: OM_BROWSER="C:\ruta\chrome.exe" node pagina.mjs ..
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const dir = process.argv[2] || '..';
const PORT = 8799, URL = `http://localhost:${PORT}/`;
const BROWSER = process.env.OM_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!BROWSER) { console.log('No encontré Edge ni Chrome. Indica uno con OM_BROWSER.'); process.exit(1); }

// servidor de prueba en otro puerto
const srv = spawn(process.execPath, ['server.mjs', dir], { env: { ...process.env, OM_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { srv.stdout.on('data', d => String(d).includes('listo') && res()); srv.on('exit', c => rej(new Error('el servidor se cerró: ' + c))); });

let ok = 0, bad = 0;
const t = async (name, fn) => { try { const r = await fn(); console.log('OK  ', name, r === undefined ? '' : JSON.stringify(r).slice(0, 200)); ok++; } catch (e) {
  console.log('FAIL', name, String(e.message).split('\n')[0]); bad++;
  // OM_FOTOS=carpeta guarda una foto de la pantalla en cada falla
  if (process.env.OM_FOTOS) await page.screenshot({ path: `${process.env.OM_FOTOS}/falla-${ok + bad}.png` }).catch(() => {});
  // cierra lo que haya quedado abierto para que la siguiente prueba arranque limpia
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())).catch(() => {});
} };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} esperaba ${JSON.stringify(b)}, llegó ${JSON.stringify(a)}`); };

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
// bypassCSP: la CSP de la página (que está bien) no deja que la herramienta de pruebas evalúe código en ella
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'es-CO', bypassCSP: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errores = [];
page.on('pageerror', e => errores.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errores.push(m.text()); });

const secreto = async (v) => { await page.waitForSelector('#pwDialog[open]'); await page.fill('#pw1', v); await page.click('#pwOk'); };
const quien = async (rol) => { await page.waitForSelector('#roleDialog[open]'); await page.click(rol === 'admin' ? '#roleAdmin' : '#roleVend'); };
const tab = (n) => page.click(`.bottomnav [data-tab="${n}"]`);
const sinDesborde = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const toast = () => page.textContent('#toast');

try {
  await page.goto(URL);
  await page.waitForSelector('.prod');

  await t('carga sin errores y las obleas salen primero', async () => {
    const cats = await page.$$eval('.prod .prod-cat', e => e.slice(0, 4).map(x => x.textContent));
    eq(cats, ['Obleas', 'Obleas', 'Obleas', 'Obleas']);
    if (!(await sinDesborde())) throw new Error('la página se sale de lado');
    return await page.textContent('.prod[data-id="oblea-arequipe"] .prod-stock');
  });

  await t('abrir la caja pide la contraseña del vendedor', async () => {
    await page.click('#cajaClosed [data-open-caja]');
    await page.fill('#fm_base', '50000'); await page.click('#fmOk');
    await secreto('000000');
    await page.waitForFunction(() => /incorrecta/.test(document.getElementById('toast').textContent));
    const err = await toast();
    await secreto('654321');
    await page.waitForSelector('.cajachip:not(.off)');
    return err;
  });

  let orden;
  await t('vender una oblea con salsa por transferencia muestra la llave y guarda quién atendió', async () => {
    await page.click('.prod[data-id="oblea-1-salsa"]');
    await page.waitForSelector('#addsDialog[open]');
    await page.check('#addsList input[value="add-salsa-mora"]');
    await page.click('#addsOk');
    await page.click('#cartBar');
    await page.click('.pay button[data-pay="transferencia"]');
    const llave = await page.textContent('#tkValue');
    eq(llave, '@NEQUIZHA210', 'llave');
    await page.click('#checkout');
    await page.waitForSelector('#soldDialog[open]');
    orden = await page.textContent('#soldOrder');
    await page.click('#soldNew');
    await page.click('#lastRcTop');
    const rc = await page.textContent('#receipt');
    if (!rc.includes('Atendió: Vendedor de prueba')) throw new Error('el recibo no dice quién atendió');
    await page.click('#rcClose');
    return orden;
  });

  await t('Inventario como administrador: categorías, filtro y sin desborde', async () => {
    await tab('inventario'); await quien('admin'); await secreto('admin123');
    await page.waitForSelector('#invCats .chip');
    const grupos = await page.$$eval('#invBody tr.grp', e => e.length);
    await page.click('#invCats [data-c="Bolis en leche"]');
    const solo = await page.$$eval('#invBody tr:not(.grp) .pname', e => e.map(x => x.textContent));
    if (!solo.length || solo.some(n => !/boli/i.test(n))) throw new Error('el filtro no funciona: ' + solo);
    await page.click('#invCats [data-c="Todas"]');
    if (!(await sinDesborde())) throw new Error('se sale de lado');
    return { grupos, bolisEnLeche: solo.length };
  });

  await t('un nombre con código HTML se muestra como texto (no se ejecuta)', async () => {
    await page.click('#newProd');
    await page.fill('#pName', '<img src=x onerror="window.__xss=1">');
    await page.selectOption('#pCatSel', '__new'); await page.fill('#pCat', 'Pruebas');
    await page.fill('#pPrice', '1000'); await page.fill('#pCost', '100');
    await page.click('#saveBtn');
    await page.waitForFunction(() => [...document.querySelectorAll('#invBody .pname')].some(e => e.textContent.includes('<img')));
    eq(await page.evaluate(() => window.__xss), undefined, 'se ejecutó código');
    return 'texto';
  });

  await t('registrar un descarte calcula la pérdida', async () => {
    await page.click('#invSeg [data-f="descarte"]');
    await page.click('#descNew');
    await page.selectOption('#descProd', 'oblea-arequipe');
    await page.fill('#descQty', '2');
    const prev = await page.textContent('#descPreview');
    await page.click('#descOk');
    await page.waitForFunction(() => /[1-9]/.test(document.getElementById('descTotal').textContent));
    return { prev, total: await page.textContent('#descTotal') };
  });

  await t('Caja siempre pide código; cancelar deja la sesión como estaba', async () => {
    await tab('cierre'); await page.waitForSelector('#roleDialog[open]'); await page.click('#roleClose');
    const sigue = await page.evaluate(() => ({ pagina: document.querySelector('.page.active').id, role: A.role }));
    eq(sigue, { pagina: 'page-inventario', role: 'admin' });
    return sigue;
  });

  await t('el vendedor ve la Caja sin costos ni resultado', async () => {
    await tab('cierre'); await quien('vend'); await secreto('654321');
    await page.waitForSelector('body.ro');
    const head = await page.textContent('#cajasHead');
    if (/Debería|Contado|Resultado/.test(head)) throw new Error('muestra el resultado de la caja');
    const ganancia = await page.isVisible('.stat.profit');
    eq(ganancia, false, 'ganancia visible');
    await page.waitForFunction(() => document.getElementById('salesBody').textContent.includes('N.º'));
    const ventas = await page.textContent('#salesBody');
    if (!ventas.includes('Atendió Vendedor de prueba')) throw new Error('no dice quién atendió');
    return 'solo ver';
  });

  await t('Ajustes: agregar un vendedor y verlo en la lista', async () => {
    await tab('ajustes'); await secreto('admin123');
    await page.waitForSelector('#vendBody tr');
    await page.fill('#vendName', 'Luis'); await page.fill('#vendPass', 'luis2024');
    await page.click('#vendAdd');
    await page.waitForFunction(() => document.getElementById('vendBody').textContent.includes('Luis'));
    const filas = await page.$$eval('#vendBody tr', e => e.map(x => x.querySelector('.pname')?.textContent));
    return filas;
  });

  await t('Ajustes: cambiar la llave de transferencia', async () => {
    await page.fill('#llaveIn', '@PRUEBA99'); await page.click('#setLlave');
    await page.waitForFunction(() => document.getElementById('tkValue').textContent === '@PRUEBA99');
    await page.fill('#llaveIn', '@NEQUIZHA210'); await page.click('#setLlave');
    await page.waitForFunction(() => document.getElementById('tkValue').textContent === '@NEQUIZHA210');
    return 'ok';
  });

  await t('el nuevo vendedor puede vender con su contraseña', async () => {
    await tab('vender');
    await page.evaluate(() => { sessionStorage.removeItem('om_pin'); pinStore.set(''); });
    await page.click('.prod[data-id="boli-coco"]');
    await page.click('#cartBar'); await page.click('.pay button[data-pay="efectivo"]');
    await page.click('#checkout'); await secreto('luis2024');
    await page.waitForSelector('#soldDialog[open]');
    await page.click('#soldNew');
    await page.click('#lastRcTop');
    const rc = await page.textContent('#receipt'); await page.click('#rcClose');
    if (!rc.includes('Atendió: Luis')) throw new Error('no quedó Luis');
    return 'Luis';
  });

  await t('5 contraseñas malas bloquean este dispositivo', async () => {
    await tab('ajustes');
    for (let i = 0; i < 5; i++) { await secreto('mala' + i); await page.waitForFunction(() => document.getElementById('pwErr').textContent.length > 0); }
    await secreto('admin123');
    await page.waitForFunction(() => /Demasiados intentos/.test(document.getElementById('pwErr').textContent));
    return await page.textContent('#pwErr');
  });

  await t('ningún error de JavaScript en toda la prueba', async () => { if (errores.length) throw new Error(errores.join(' | ')); return 0; });
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${ok} bien, ${bad} con error`);
process.exit(bad ? 1 : 0);
