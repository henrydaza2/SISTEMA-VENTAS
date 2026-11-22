# Novedades de la página · Obleas Matilde

**21 de noviembre de 2026**

## Nuevas funciones

**Productos (antes "Vender")**
- Las obleas salen primero, y cada una muestra cuántas alcanzan con los insumos que quedan ("≈ 48 disponibles").
- Al elegir **Transferencia** aparece la llave **@NEQUIZHA210**, con botón para copiarla.
- Botón de **recibo de la última venta**, junto a "Cerrar caja".
- **Recibo compacto** de 80 mm: unas 11 líneas, letra gruesa y negra, con el nombre de quien atendió.

**Inventario**
- **Para vender** agrupado por categoría, con botones para ver una sola categoría. Se pueden **crear categorías nuevas**.
- El **stock** de las obleas se calcula solo con los insumos que quedan.
- Cada oblea vendida descuenta **2 galletas** del paquete x100. Aplica a todo producto de la categoría Obleas, también a los nuevos.
- **Descartes:** se registra lo que se dañó o no cumplió la calidad. Saca del inventario lo que corresponde, calcula la pérdida y la muestra por producto y por fechas. Un descarte se puede anular.
- Aviso de los insumos que aún no se descuentan porque no se han contado o no tienen precio.

**Caja (antes "Cierre del día")**
- Pide el código **cada vez** que se entra: vendedor (solo ver) o administrador.
- La ganancia del día descuenta las pérdidas por descartes.
- Muestra quién atendió cada venta.
- El administrador puede **corregir** o **reabrir** una caja ya cerrada. Cada cambio queda anotado.

**Ajustes**
- **Vendedores:** cada uno con su nombre y su contraseña (letras y números). Se pueden agregar, cambiar la contraseña, desactivar y eliminar, y se ven las ventas de hoy de cada uno.
- Cambiar la **llave de transferencia**.
- **Descuento máximo** de meseros.

**Vista y diseño**
- Pensada para el **celular**: ventanas que suben desde abajo, botones fijos, tablas como tarjetas y "Cobrar" siempre a la vista.
- **Tema oscuro** nuevo, morado con botones color arequipe.

## Correcciones de seguridad y errores
- Contraseñas más largas: administrador de 8 caracteres o más, vendedores y meseros de 6 o más.
- **5 intentos fallidos** bloquean el dispositivo 15 minutos.
- Una venta **ya no se repite** si se corta la señal y se vuelve a cobrar.
- Los vendedores solo pueden **ver** Inventario y Caja: no cambian nada y no ven costos ni el resultado del conteo de la caja.
- La contraseña de administrador ya no queda guardada al editar una venta.
- Las ventas después de medianoche quedan en el día de la caja abierta.
- Editar un producto ya no borra su stock.
- Un respaldo con datos dañados ya no puede afectar la página.
- La página está protegida contra código externo.

## Para activarlo
1. Ejecutar en Supabase el bloque de **correcciones de caja** (lo demás ya está ejecutado).
2. Subir la carpeta `obleas-matilde-web/sitio` a Netlify.
3. Crear los vendedores en Ajustes y cambiar las contraseñas.
4. Contar los insumos en Inventario → Insumos.

Todo se comprobó con **99 pruebas de la base** y **14 pruebas de la página**.
