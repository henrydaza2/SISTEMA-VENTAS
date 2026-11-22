# Parte de cambios · Obleas Matilde

**Fecha:** 21 de noviembre de 2026
**Repositorio:** https://github.com/henrydaza2/SISTEMA-VENTAS (rama `main`)
**Página en uso:** https://obleasmatilde.netlify.app (Netlify + Supabase)

Este parte resume las auditorías, correcciones y mejoras hechas en esta jornada, en el orden en que se hicieron. El detalle técnico de cómo está armado el código está en `PARTE-CODIGO.md`.

---

## 1. Resumen

| | Al empezar | Al terminar |
|---|---|---|
| Auditoría de código | NO APROBADO: 25 fallas (1 crítica, 4 altas, 10 medias, 10 bajas) | APROBADO; segunda auditoría: 1 media y 4 bajas, todas corregidas |
| Pruebas de la base de datos | 44 | **99** |
| Pruebas de la página (navegador real) | 0 | **14** |
| Archivos SQL | `supabase.sql`, `supabase-v2.sql` | + `supabase-v3.sql`, `supabase-v4.sql`, `supabase-v5.sql` |
| Código en GitHub | No | Sí, 14 commits |

---

## 2. Primera auditoría (25 fallas, todas corregidas en `supabase-v3.sql` y la página)

### Crítica y altas
| # | Falla | Corrección |
|---|---|---|
| 1 | La contraseña de administrador se podía adivinar sin límite (mínimo 4 caracteres) | Bloqueo por intentos y mínimo de 8 caracteres |
| 2 | El PIN y el código de meseros se podían adivinar sin límite | Mismo bloqueo y mínimo de 6 caracteres |
| 3 | Una venta se registraba dos veces si se cortaba la señal y se volvía a cobrar | Cada cobro lleva un identificador; si llega dos veces, la base devuelve la misma venta |
| 4 | Al editar una venta, la contraseña de administrador quedaba en la pantalla de vender | La contraseña se pide al guardar la edición y no queda guardada |
| 5 | La librería de Supabase se cargaba sin verificación y sin política de seguridad | Verificación `integrity` y archivo `_headers` con política CSP |

### Medias
6. Editar un producto pisaba el stock con un valor viejo → ya no se manda el stock al editar.
7. Un respaldo modificado podía meter código en la página → la base limpia los datos del respaldo y la página escapa todo.
8. Las ventas después de medianoche, con la caja abierta, no cuadraban con el cierre → quedan en el día de la caja.
9. Dos ventas al mismo tiempo se podían trabar → los productos se bloquean siempre en el mismo orden.
10. Subir un respaldo grande podía pasarse del tiempo límite → la contraseña se revisa una sola vez.
11. Se podía cambiar el tipo de un producto que ya existe → bloqueado.
12. Corrección de 3 insumos pendiente (`supabase-fix-insumos.sql`) → incluida en la v3.
13. Botones de menos de 44 px → todos de 44 px o más.
14. El carrito escondido del celular recibía el foco; el lector de pantalla no decía "Agotado" → corregido.
15. Las pruebas no avisaban cuando fallaban → ahora terminan con error.

### Bajas (16 a 25)
- El PIN quedaba guardado en el aparato; ahora solo mientras la pestaña está abierta.
- Las respuestas viejas que llegaban tarde ya no pisan a las nuevas.
- Se tradujeron los mensajes de error que faltaban.
- Se borró una función vieja que seguía publicada.
- Topes en montos, cantidades y adicionales.
- Protección contra fórmulas al abrir el CSV en Excel.
- Orden correcto de las salsas incluidas.
- Sin avisos repetidos cuando no hay señal.
- `search_path` seguro en la base.
- Servidor de prueba solo local.
- Descuento máximo de meseros configurable.

---

## 3. Cambios pedidos durante la jornada

| Pedido | Qué se hizo | Commit |
|---|---|---|
| Subir el código a GitHub | Repositorio `henrydaza2/SISTEMA-VENTAS` | `e155de6` |
| Mejorar la vista en el teléfono | Ventanas que suben desde abajo con botones fijos, tablas como tarjetas, buscador fijo, "Cobrar" siempre visible, obleas primero, estado de conexión arriba | `6e1a385` |
| Cambiar el tema oscuro | Tema "morado nocturno" con botones color arequipe | `6e1a385` |
| Recibos legibles al imprimir | Letra Arial gruesa y todo en negro puro | `6e1a385` |
| Cálculo de merma, gramajes y precios | Se calcularon (48 g de arequipe ≈ 208 obleas por 10 kg; queso a $30.000/kg); **luego se pidió quitar el cambio de precios y gramajes**, y se quitó | `0d1a770` |
| Recibo más pequeño | Formato compacto para rollo de 80 mm: de unas 24 a unas 11 líneas | `3e16578` |
| Descontar insumos y adicionales en cada venta | Ya funcionaba; se agregó un aviso de los insumos sin contar o sin precio | `bdc03cd` |
| 2 galletas por oblea | Cada oblea descuenta exactamente 2 galletas; las unidades van sin merma | `6105f2a` |
| Galletas para todas las obleas, estimado y vista de vendedores | Galletas automáticas; "alcanza para"; los vendedores ven Inventario y Caja con su código, sin costos ni resultado de caja | `bdbf14f` |
| Que el stock y el estimado cuadren | Lo que tiene receta muestra su stock calculado con los insumos | `2937c1c` |
| Categorías, Descartes, nombres y código en Caja | Para vender agrupado por categoría y con categorías nuevas; sección **Descartes** con la pérdida por producto; Vender → **Productos**, Cierre → **Caja**; Caja pide código siempre | `3a03958` |
| Filtrar por categoría y llave de transferencia | Botones de categoría en Inventario; al elegir Transferencia aparece la llave **@NEQUIZHA210** con botón Copiar | `0e43565` |
| Segunda auditoría | Cancelar al entrar a Caja ya no deja la página sin sesión, y otros 4 ajustes | `c2bdd4b` |
| Decisiones de la auditoría y recomendaciones | Ver la sección 4 | `5eba329` |
| Corregir una caja después de cerrada | Botones **Corregir** y **Reabrir** en Caja; cada cambio queda anotado | `ae602b1` |

---

## 4. Decisiones tomadas por el dueño (aplicadas en `supabase-v5.sql`)

1. **Vendedores con contraseña.** En Ajustes hay una lista de vendedores con estado y ventas del día. Se pueden agregar, cambiar la contraseña (letras y números, mínimo 6), activar, desactivar y eliminar. El PIN anterior pasó a ser el vendedor "Vendedor". Cada venta guarda quién la atendió, y sale en Caja y en el recibo.
2. **Bloqueo:** 5 intentos fallidos seguidos bloquean el dispositivo 15 minutos para entrar con cualquier código. Se quitó el tope general entre dispositivos.
3. **Regla de las galletas** solo para la **categoría** Obleas, no por el nombre del producto.

Y las recomendaciones de la auditoría:
- **Pruebas automáticas de la página** en Edge. Encontraron que, en el celular, el botón "Recibo de la última venta" quedaba escondido; ya está corregido.
- **Costos y "alcanza para"** se calculan solo en la base.
- **La llave de transferencia** se cambia desde Ajustes.
- **El respaldo** también restaura los descartes.

---

## 5. Archivos SQL y en qué orden van

| Archivo | Contenido | Estado |
|---|---|---|
| `supabase.sql` | Base inicial | Ejecutado |
| `supabase-v2.sql` | Caja, adicionales, recetas, costos, meseros | Ejecutado |
| `supabase-v3.sql` | Seguridad (primera auditoría) | Ejecutado el 21/11 (junto con v4 y v5) |
| `supabase-v4.sql` | Galletas automáticas, estimados, vista de vendedor | Ejecutado el 21/11 |
| `supabase-v5.sql` | Descartes, vendedores, bloqueo, regla por categoría, llave, respaldo | Ejecutado el 21/11 |
| Bloque "Correcciones a una caja ya cerrada" (final de v5) | Corregir y reabrir caja | **Pendiente de ejecutar** en una pestaña nueva del SQL Editor |

Todos los archivos se pueden ejecutar más de una vez sin dañar datos.

---

## 6. Pendientes

1. Ejecutar en Supabase el bloque de **correcciones de caja**.
2. **Subir la carpeta `obleas-matilde-web/sitio` a Netlify.** La base ya está actualizada y la página publicada es la anterior.
3. En Ajustes: crear un vendedor por persona, y eliminar el "Vendedor" (el PIN viejo) o cambiarle la contraseña.
4. Cambiar la contraseña de administrador (8 caracteres o más) y el código de meseros (6 o más).
5. En Inventario → Insumos: contar galletas, arequipe y queso, y registrar el precio del queso.
6. Borrar en Netlify los deploys anteriores a esta actualización, después de comprobar que la nueva funciona.
7. Hacer una impresión de prueba del recibo en la impresora real.

---

## 7. Cómo se prueba

En `obleas-matilde-web/pruebas`:
```
npm test
```
- `test.mjs`: 99 pruebas de la base de datos (v1 a v5) en un Postgres local.
- `pagina.mjs`: 14 pruebas de la página en Edge sin ventana: vender, caja, inventario, descartes, vendedores, llave, bloqueo, código malicioso y vista de celular.
- `node server.mjs .. --red`: servidor de prueba para abrir la página desde el celular en la misma red. Claves de prueba: vendedor `654321`, meseros `777777`, administrador `admin123`.

---

## 8. Lo que no se pudo verificar

- La impresión del recibo en la impresora real.
- El uso con lector de pantalla en un teléfono real.
- Que Supabase entregue la IP real de cada dispositivo para el bloqueo por intentos. Se usa el encabezado `cf-connecting-ip`.
- La página publicada en Netlify con los cambios, porque todavía no se ha subido.
