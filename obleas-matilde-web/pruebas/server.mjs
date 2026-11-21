// Servidor de prueba: imita la API de Supabase (/rest/v1/rpc/<función>) sobre PGlite
// y sirve la página con las mismas reglas de seguridad (_headers) que Netlify.
// Solo para pruebas locales: atiende únicamente a este computador.
// Con --red también atiende a los teléfonos de la misma red Wi-Fi (para probar en el celular):
//   node server.mjs .. --red
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '..';       // carpeta obleas-matilde-web
const PORT = 8787;
const RED = process.argv.includes('--red');
const ORIGIN = `http://localhost:${PORT}`;
// dirección con la que entró el navegador (en la red Wi-Fi es la IP de este computador)
const originOf = req => RED && /^[\w.-]+:\d+$/.test(req.headers.host || '') ? `http://${req.headers.host}` : ORIGIN;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon; create role authenticated; create schema extensions;`);
for (const f of ['supabase.sql', 'supabase-v2.sql', 'supabase-v3.sql', 'supabase-opcion-a.sql']) {
  if (fs.existsSync(path.join(dir, f))) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
}
// datos de prueba: contraseña admin123, PIN 654321, código de meseros 777777, insumos contados
await db.exec(`update ajustes set clave_admin = extensions.crypt('admin123', extensions.gen_salt('bf')),
                                  pin_vendedor = extensions.crypt('654321', extensions.gen_salt('bf')),
                                  codigo_mesero = extensions.crypt('777777', extensions.gen_salt('bf'));
               update productos set existencia = contenido where tipo = 'insumo';`);

// Encabezados de sitio/_headers (los mismos de Netlify); la base de datos apunta a este servidor
const headers = {};
const hf = path.join(dir, 'sitio', '_headers');
if (fs.existsSync(hf)) for (const line of fs.readFileSync(hf, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
  if (m) headers[m[1]] = m[2];
}
const headersFor = origin => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, origin)]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

let queue = Promise.resolve();
// cada llamada espera a la anterior, pero un error de una no debe afectar a las siguientes
const call = (fn, args) => queue = queue.catch(() => {}).then(async () => {
  if (!/^[a-z_]+$/.test(fn)) throw new Error('función no válida');
  const keys = Object.keys(args || {}).filter(k => /^p_[a-z_]+$/.test(k));
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
  await db.exec('set role anon');
  try { return (await db.query(sql, vals)).rows[0].r; } finally { await db.exec('reset role'); }
});

http.createServer(async (req, res) => {
  const origin = originOf(req);
  const url = new URL(req.url, origin);
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let body = ''; for await (const c of req) body += c;
    try {
      const r = await call(url.pathname.split('/').pop(), body ? JSON.parse(body) : {});
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(400, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 'P0001', message: e.message }));
    }
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { ...headersFor(origin), 'content-type': TYPES['.js'] });
    res.end(`window.OM_CONFIG={url:"${origin}",key:"local-test"};`); return;
  }
  const base = path.resolve(dir, 'sitio');
  const f = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (f.startsWith(base + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { ...headersFor(origin), 'content-type': TYPES[path.extname(f)] || 'text/plain; charset=utf-8' }); res.end(fs.readFileSync(f));
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, RED ? '0.0.0.0' : '127.0.0.1', () => console.log('listo en ' + ORIGIN + (RED ? ' (y en la red Wi-Fi)' : '')));
