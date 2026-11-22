# Parte técnico del código · Obleas Matilde

**Fecha:** 21 de noviembre de 2026
**Versión en uso:** https://obleasmatilde.netlify.app (Netlify + Supabase)

Este documento resume lo importante del código: cómo está armado, qué hace cada parte, cómo se prueba, qué riesgos tiene y qué falta. La historia del proyecto está en `INFORME.md`, y las instrucciones para retomar el trabajo con Claude, en `CLAUDE.md`.

---

## 1. Archivos

| Archivo | Para qué sirve | Estado |
|---|---|---|
| `obleas-matilde-web/sitio/index.html` | La página: diseño y pantallas (HTML + CSS) | **En uso** |
| `obleas-matilde-web/sitio/app.js` | La lógica de la página (antes iba dentro de index.html) | **En uso** |
| `obleas-matilde-web/sitio/_headers` | Reglas de seguridad que Netlify agrega (CSP y otras) | **En uso** |
| `obleas-matilde-web/sitio/config.js` | URL de Supabase y clave **pública** (publishable) | En uso |
| `obleas-matilde-web/supabase.sql` | Base de datos inicial: tablas, contraseña, PIN, ventas | Ejecutado |
| `obleas-matilde-web/supabase-v2.sql` | Caja, adicionales, recetas, costos, editar ventas, meseros | Ejecutado |
| `obleas-matilde-web/supabase-v3.sql` | Seguridad: bloqueo de intentos, ventas sin duplicar, día de la caja, respaldos revisados, descuento máximo; incluye el arreglo de insumos | **Pendiente de ejecutar** |
| `obleas-matilde-web/supabase-v4.sql` | Galletas automáticas (2 por oblea, también en obleas nuevas), estimado de cuánto alcanza, y vista de solo lectura para vendedores | **Pendiente de ejecutar** (después de v3) |
| `obleas-matilde-web/supabase-v5.sql` | Descartes: sacar productos o insumos dañados y calcular la pérdida; el respaldo los incluye | **Pendiente de ejecutar** (después de v4) |
| `obleas-matilde-web/supabase-fix-insumos.sql` | Devuelve 3 insumos a su tipo correcto | Reemplazado por v3 (no hace falta) |
| `obleas-matilde-web/pruebas/` | Pruebas de la base de datos y servidor local de prueba | Herramienta |
| `obleas-matilde-web/INSTRUCCIONES.md` | Guía de instalación (Supabase + Netlify) | Guía |
| `index.html` (raíz) y `obleas-matilde.html` | Versiones antiguas (local y claude.ai) | **No usar** |

---

## 2. Cómo funciona

```
Navegador (index.html)
   │  solo llama funciones (RPC) con la clave pública
   ▼
Supabase (PostgreSQL)
   ├─ Funciones públicas ...... estado, catalogo, abrir/cerrar caja, registrar_venta
   ├─ Funciones admin_* ....... piden la contraseña de administrador
   └─ Tablas cerradas ......... nadie las lee ni escribe directamente
```

- **Las tablas no se tocan desde el navegador.** Tienen RLS activo y todos los permisos revocados para el rol público. Todo pasa por funciones `security definer`.
- **La seguridad se valida en el servidor.** La contraseña, el PIN y el código de meseros se comparan dentro de la base de datos y se guardan cifrados con `crypt()` (bcrypt).
- **Intentos limitados (v3).** 5 fallos desde un mismo dispositivo lo bloquean 15 minutos; además hay un tope general por hora (20 para la contraseña, 60 para PIN y código). Si la clave está mal, la función responde `{"error": "..."}` en vez de lanzar un error, para que el intento quede contado.
- **Los precios los calcula el servidor.** El navegador solo envía qué productos, cuántos y qué adicionales.

---

## 3. Base de datos

### Tablas
| Tabla | Contenido |
|---|---|
| `productos` | Productos para vender, adicionales e insumos (columna `tipo`), con precio, costo, stock, merma, salsas incluidas y existencia en gramos |
| `recetas` | Cuánto de cada insumo usa una unidad de producto |
| `ventas` | Cada venta: número de orden del día, productos, subtotal, descuento, total, costo, consumo de insumos, pago, caja |
| `cajas` | Apertura y cierre de caja: base, efectivo contado, esperado y notas |
| `ajustes` | Contraseña de administrador, PIN de vendedor y código de meseros (cifrados), descuento máximo (%) |
| `intentos` | Intentos fallidos por tipo y dispositivo, y bloqueos (v3) |

### Funciones públicas (cualquiera con el enlace)
| Función | Qué hace | Protección |
|---|---|---|
| `estado()` | Dice si hay contraseña y PIN, y si la caja está abierta | — |
| `catalogo()` | Productos y adicionales para vender, sin costos | — |
| `abrir_caja` / `cerrar_caja` | Abre la caja con una base y la cierra con lo contado | PIN |
| `registrar_venta` | Registra la venta (en el día de la caja abierta), descuenta stock e insumos y asigna el número de orden. Con `p_ref` no se repite si llega dos veces | PIN, y código de meseros si hay descuento |
| `verificar_mesero` | Comprueba el código de meseros | Bloqueo de intentos |
| `crear_clave` | Crea la contraseña de administrador **solo si no existe** (mínimo 8) | — |
| `vend_inventario` / `vend_caja` | El vendedor VE el inventario y la caja del día, sin costos, sin conteo ni resultado del cierre y sin poder cambiar nada (v4) | PIN |

### Funciones de administrador (piden contraseña)
`admin_entrar`, `admin_fijar_descuento_max`, `admin_productos`, `admin_guardar_producto`, `admin_eliminar_producto`, `admin_ajustar_stock`, `admin_insumo_compra`, `admin_insumo_contar`, `admin_ventas`, `admin_cajas`, `admin_editar_venta`, `admin_anular`, `admin_fijar_pin`, `admin_fijar_codigo_mesero`, `admin_cambiar_clave`, `admin_respaldo`, `admin_restaurar`.

### Funciones internas (bloqueadas para el público)
| Función | Qué hace |
|---|---|
| `_armar(items)` | Calcula precios, salsas incluidas, costos y consumo de insumos; descuenta stock y existencia |
| `_revertir(venta)` | Devuelve stock e insumos al anular o editar |
| `_costo_unit(id)` | Costo de producción: receta × precio del insumo × (1 + merma) |
| `_acceso(tipo, valor)` | Compara contraseña, PIN o código, cuenta los fallos y bloquea (v3) |
| `_guardar_producto` | Guarda un producto; no cambia el tipo de uno existente ni pisa el stock si no viene |
| `_limpiar_items` / `_limpiar_consumo` | Revisan las ventas que llegan en un respaldo |

---

## 4. Reglas del negocio en el código

| Regla | Dónde |
|---|---|
| 4 obleas: $3.500 / $4.500 / $5.500 (1 salsa) / $6.500 (3 salsas) | `productos`, `supabase-v2.sql` |
| Las primeras salsas que marca el cliente van incluidas; las demás cuestan $1.000 | `_armar` (servidor) y `addsDetail` (página) |
| Receta: 2 obleas del paquete + 25 g arequipe (+25 g queso); salsa 25 g; lluvia y chispitas 15 g; leche condensada 25 g | `recetas` |
| Merma del 15 % en obleas y adicionales, solo en lo que va en gramos; las galletas (unidades) van exactas: 2 por oblea | `productos.merma`, `_armar`, `_costo_unit` (v4) |
| Costo de la oblea base: $697 (2 galletas $340 + arequipe con merma $357) | `_costo_unit` |
| Bolis: costo fijo $2.800, sin receta | `productos.costo` |
| Sin caja abierta no se vende | `registrar_venta` |
| Número de orden por día (001, 002…), sin repetir aunque vendan dos a la vez | `registrar_venta` (bloqueo por día) |
| Pasada la medianoche, con la caja abierta, las ventas siguen en el día de la caja | `registrar_venta` |
| Descuento de meseros hasta el máximo fijado en Ajustes (100 % = sin límite) | `registrar_venta`, `ajustes.descuento_max` |
| Editar y anular ventas conservan el número de orden y devuelven el inventario | `admin_editar_venta`, `admin_anular`, `_revertir` |
| Al cerrar caja, el vendedor no ve si cuadra; el administrador sí | `cerrar_caja`, `admin_cajas` |

---

## 5. La página (`sitio/index.html`)

| Sección | Qué hace | Clave |
|---|---|---|
| **Productos** (antes Vender) | Productos por categoría, ventana de salsas y adicionales, carrito, descuento de meseros, cobro, ventana "Venta registrada", recibo imprimible de 80 mm | PIN |
| **Inventario** | Pestañas Para vender (por categorías, se pueden crear nuevas), Adicionales, Insumos y Descartes; recetas, merma, costo y margen; compras y conteo de insumos | Contraseña |
| **Caja** (antes Cierre del día; pide código cada vez que se entra) | Totales, ganancia, caja (cuadra / falta / sobra), unidades vendidas, ganancia por producto, insumos usados, editar y anular ventas, CSV | Contraseña |
| **Ajustes** | PIN, código de meseros, contraseña y respaldos | Contraseña |

**Detalles técnicos:**
- La sesión de administrador solo vive en memoria y se cierra al volver a Vender. Al editar una venta, la contraseña se pide de nuevo al guardar; no queda guardada en la pantalla de vender.
- El PIN de vendedor se recuerda solo mientras la pestaña esté abierta (`sessionStorage`).
- Todo texto o número que se inserta en la página pasa por `esc()` o por funciones que solo devuelven números (`fmt`, `num`, `qtyU`, `pad3`).
- Al elegir Transferencia se muestra la llave `@NEQUIZHA210` (constante `LLAVE_TRANSFERENCIA` al inicio de `app.js`).
- Caja pide código cada vez; si se cancela, la sesión que había sigue igual.
- Cada cobro lleva un identificador (`crypto.randomUUID()`): si se corta la señal y se presiona Cobrar otra vez, la venta no se repite.
- Script de Supabase con `integrity` (SRI) y política CSP en `_headers`. Si se cambia la versión de supabase-js, hay que recalcular el `integrity`.
- Botones de 44 px como mínimo; en el celular, la hoja de venta cerrada queda `inert`.
- Diseño: fondo crema `#FEF3C7`, café `#92400E`, morado `#7E22CE` para una categoría; letras Fredoka (títulos) y Nunito (texto); modo oscuro automático.
- Librería externa: `@supabase/supabase-js@2.45.4` desde jsdelivr.

---

## 6. Pruebas

En `obleas-matilde-web/pruebas/` (necesita Node):

```bash
cd "obleas-matilde-web/pruebas"
```
```bash
npm install
```
```bash
node test.mjs ..
```
```bash
node server.mjs ..
```

- `test.mjs` (o `npm test`) corre **85 pruebas** de la base de datos (v1 a v5) en un Postgres local (PGlite). Todas pasan. Termina con error si alguna falla.
- `server.mjs` levanta http://localhost:8787 (solo para este computador) con la página real, las reglas de `_headers` y una base de datos de prueba. Claves de prueba: PIN `654321`, código de meseros `777777`, contraseña `admin123`.
- Nada de esto toca la página ni la base de datos reales.

---

## 7. Seguridad (auditoría del 21/11/2026)

Informe completo: `C:\Users\dzaz3\security-audit-skill\obleas-matilde\run-1\REPORT.md`

| Hallazgo | Gravedad | Arreglo |
|---|---|---|
| La contraseña de administrador se puede adivinar sin límite | Crítica | **Corregido en v3** (bloqueo + mínimo 8). Falta cambiar la contraseña actual |
| El PIN y el código de meseros se pueden adivinar sin límite | Alta | **Corregido en v3** (bloqueo + mínimo 6) |
| Venta duplicada si se corta la señal | Alta | **Corregido** (`p_ref`) |
| Contraseña guardada en la pantalla al editar una venta | Alta | **Corregido** (se pide al guardar) |
| Script externo sin SRI y sin CSP | Alta | **Corregido** (`integrity` + `_headers`) |
| Stock pisado al editar, respaldo con código escondido, ventas después de medianoche, bloqueos entre ventas, restaurar lento, cambio de tipo, botones pequeños, lector de pantalla, pruebas que no avisan, y 10 fallas bajas | Media / baja | **Corregido** |

Segunda revisión (21/11/2026): 25 fallas, todas corregidas en el código. Queda un riesgo aceptado: el tope general bloquea a todos 15 minutos si hay muchos fallos desde muchos dispositivos (frena ataques, pero alguien con el enlace podría bloquear el PIN un rato).

**Descartado:** inyección de HTML, cambio de precios desde el navegador y lectura directa de tablas.

**Nota técnica para el arreglo:** en Postgres, un error deshace lo guardado en la misma llamada. Por eso el contador de intentos debe registrarse sin lanzar error: la verificación devuelve sí/no y las funciones `admin_*` devuelven vacío si es no.

---

## 8. Pendientes

1. **Ejecutar `supabase-v3.sql`** en el SQL Editor (no en el asistente de IA de Supabase): https://supabase.com/dashboard/project/vwfcmkdgstekyyuexlgh/sql/new. Ya incluye el arreglo de insumos.
2. **Subir la carpeta `sitio`** a Netlify (con `app.js` y `_headers`) justo después del paso 1: la página nueva necesita la v3.
3. **Cambiar la contraseña de administrador** por una de 8 caracteres o más, y el PIN y el código de meseros por unos de 6 o más.
4. Definir el precio del adicional Chispitas ($1.000 o $500) y si se conserva "Oblea solo Arequipe Meseros".
5. Registrar la compra de queso y contar los insumos para que empiecen a descontarse.
6. Medir la merma real (conteo semanal) y ajustar el 15 % por insumo.

---

## 9. Cómo hacer cambios sin romper nada

1. **Página:** editar `sitio/index.html` o `sitio/app.js` → probar con `server.mjs` → arrastrar la carpeta `sitio` a Netlify → Deploys.
2. **Base de datos:** crear un SQL nuevo, que se pueda ejecutar dos veces sin dañar nada y sin borrar ventas → probar con `test.mjs` → ejecutarlo en el **SQL Editor**.
   - Los cambios de estructura (`add column if not exists`) van dentro de un bloque `do $x$ ... $x$;`, porque el editor de Supabase no los acepta sueltos.
3. **Nunca** poner en `config.js` la clave `secret` ni la `service_role`.
