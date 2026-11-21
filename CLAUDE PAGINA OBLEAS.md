# CLAUDE.md · Punto de venta Obleas Matilde

Este archivo lo lee Claude al iniciar una sesión en esta carpeta. Resume el proyecto, cómo trabajar con el usuario y qué está pendiente. El historial completo está en `INFORME.md`.

## El usuario
- Dueño o dueña del negocio **Obleas Matilde** (obleas y bolis, Colombia). **No es programador.**
- Escribe en **español**. Responder en español, paso a paso, con instrucciones concretas de dónde hacer clic.
- Moneda: pesos colombianos (COP), sin decimales. Zona horaria: America/Bogota.

## Qué está en uso (producción)
| | |
|---|---|
| Página | https://obleasmatilde.netlify.app (Netlify, sitio `obleasmatilde`) |
| Base de datos | Supabase, proyecto ref `vwfcmkdgstekyyuexlgh` |
| SQL Editor (el correcto) | https://supabase.com/dashboard/project/vwfcmkdgstekyyuexlgh/sql/new |
| Código de la página | `obleas-matilde-web/sitio/index.html` (un solo archivo HTML+CSS+JS) |
| Conexión | `obleas-matilde-web/sitio/config.js` (URL + clave pública **publishable**; nunca la secret) |

**Archivos viejos que ya NO se usan:** `index.html` (raíz, versión local con localStorage) y `obleas-matilde.html` (artifact de claude.ai). No modificarlos.

## Arquitectura
- La página llama **solo funciones RPC** de Supabase (`sb.rpc(...)`). Las tablas tienen RLS y `revoke all` para `anon`: nadie las lee directamente.
- La seguridad se valida **en el servidor**: contraseña de administrador (`_verificar_admin`), PIN de vendedor (`_verificar_pin`) y código de meseros (`verificar_mesero`). Todos se guardan con `crypt()` (pgcrypto).
- Tablas: `productos` (tipo `venta` | `adicional` | `insumo`), `recetas`, `ventas`, `cajas`, `ajustes`.
- Funciones públicas: `estado`, `catalogo`, `verificar_mesero`, `abrir_caja`, `cerrar_caja`, `registrar_venta`, `crear_clave`.
- Funciones de administrador (`admin_*`): todas reciben `p_clave` como primer parámetro.
- `_armar(p_items)` calcula precios, salsas incluidas, costos y consumo de insumos, y descuenta el stock. `_revertir` devuelve todo al anular o editar.

### Reglas del negocio
- **4 obleas:** solo arequipe $3.500, arequipe + queso $4.500, + 1 salsa $5.500, + 3 salsas $6.500. Todas aceptan adicionales.
- `salsas_incluidas` (0, 0, 1 y 3): las **primeras salsas que marca el cliente** no se cobran; las demás salsas y adicionales cuestan $1.000.
- Salsas (`es_salsa`): chocolate, mora, maracuyá, durazno. Otros adicionales: queso, lluvia de chocolate, chispitas, leche condensada.
- **Receta por oblea:** 2 obleas del paquete + 25 g de arequipe (+ 25 g de queso si lo lleva). Cada salsa 25 g; lluvia y chispitas 15 g; leche condensada 25 g. **Merma del 15 %** en todo lo de obleas.
- Costo de la oblea base: **$748**. Bolis: costo fijo $2.800, sin receta.
- **Caja:** se abre con el PIN y una base. No se vende con la caja cerrada. Al cerrar, el vendedor no ve si cuadra; el administrador sí.
- **Editar o anular venta:** con contraseña de administrador. Se conserva el número de orden.
- **Número de orden:** por día (001, 002…), asignado en el servidor.
- El queso se compra en bloques de 4 kg; el precio es variable y se ingresa en cada compra.

## Cómo hacer cambios
1. **Página:** editar `obleas-matilde-web/sitio/index.html`. El usuario la publica arrastrando la carpeta `sitio` a **Netlify → Deploys**. El enlace no cambia.
2. **Base de datos:** crear un archivo SQL nuevo (ej. `supabase-v3.sql`). El usuario lo pega en el **SQL Editor** (enlace de arriba) y presiona Run.
   - El verificador del editor rechaza `alter table ... add column if not exists`: meter esos cambios dentro de un bloque `do $x$ begin ... end $x$;`.
   - Si el usuario recibe "Only SELECT queries allowed" u "Only singular query allowed", **está en el asistente de IA o en reportes, no en el SQL Editor.** Darle el enlace directo.
   - Hacer el SQL **idempotente** (se puede ejecutar dos veces) y no borrar ventas.
   - Si cambia la firma de una función, hacer `drop function if exists` de la firma vieja.
3. **Copiar al portapapeles** lo que el usuario debe pegar: `Get-Content -Raw -Encoding UTF8 archivo | Set-Clipboard`.
4. **Probar antes de entregar** (ver abajo). Después de que el usuario ejecute algo, verificar con llamadas RPC públicas (`estado`, `catalogo`) usando la clave pública de `config.js`.

## Cómo probar sin tocar producción
En `obleas-matilde-web/pruebas/` (necesita Node; ya está instalado):
```bash
cd "obleas-matilde-web/pruebas"
npm install
node test.mjs ..
node server.mjs ..
```
- `npm install` instala PGlite 0.3.16, que trae pgcrypto.
- `node test.mjs ..` corre las pruebas SQL: `supabase.sql` + `supabase-v2.sql` + `supabase-v3.sql` + `supabase-v4.sql` sobre un Postgres local. **Hoy pasan 63 de 63.**
- `node server.mjs ..` levanta http://localhost:8787 con una API falsa de Supabase y la página real. Datos de prueba: PIN `654321`, código de meseros `777777`, contraseña de administrador `admin123`.
- Para verla en el navegador de la app: `preview_start` con url `http://localhost:8787`.

## Límites (no hacer)
- **No escribir contraseñas, PIN ni claves de API en páginas en línea**, aunque el usuario las dé. Que las escriba él, o probar en local.
- No pegar ni pedir la clave `secret` o `service_role` de Supabase.
- Los artifacts de claude.ai **no** sirven para esta versión: su CSP bloquea las conexiones a Supabase.

## Pendiente (al 15 de noviembre de 2026)
1. **Corrección de 3 insumos:** en producción, Lluvia de chocolate, Chispitas y Leche condensada quedaron como `tipo='venta'`, así que salen en Vender bajo "Insumos" y sus costos están mal. El arreglo está en `obleas-matilde-web/supabase-fix-insumos.sql` (2 instrucciones) y **el usuario aún no lo ha ejecutado**. Después, verificar con `catalogo` que no queden productos de categoría "Insumos".
2. El usuario debe **cambiar la contraseña de administrador**, porque la escribió en el chat.
3. Decidir el precio del adicional Chispitas: $1.000 o $500.
4. El producto "Oblea solo Arequipe Meseros" ($2.500) lo creó el usuario: preguntar si se conserva.
5. Registrar la compra de queso con su precio, y contar o comprar cada insumo para que se empiecen a descontar.
6. Mejoras propuestas, no hechas: modo sin internet, datos del negocio en el recibo (dirección, NIT), facturación electrónica DIAN.
