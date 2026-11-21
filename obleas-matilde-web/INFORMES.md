# Informe del proyecto · Punto de venta Obleas Matilde

**Fecha:** 15 de noviembre de 2026
**Carpeta del proyecto:** `Escritorio\Sistema Obleas y barra`

---

## 1. Resumen

Se construyó un sistema de punto de venta para **Obleas Matilde** (obleas y bolis): ventas, inventario, caja diaria, recibos y cierre del día con ganancias.

El sistema pasó por cuatro versiones. La que está en uso es una página en internet con base de datos propia:

| | |
|---|---|
| **Página en uso** | https://obleasmatilde.netlify.app |
| **Base de datos** | Supabase (proyecto "Obleas Matilde") |
| **Alojamiento de la página** | Netlify (sitio `obleasmatilde`) |
| **Estado** | **Versión 2 instalada** (base de datos actualizada y página publicada). Falta una corrección de datos de 3 insumos (ver sección 7). |

---

## 2. Versiones construidas

| # | Versión | Dónde | Datos | Estado |
|---|---|---|---|---|
| 1 | Página local | `index.html` (en esta carpeta) | En el navegador del computador | Reemplazada |
| 2 | Página en claude.ai | Artifact privado "Obleas Matilde" | Base de datos de claude.ai | Reemplazada |
| 3 | Página independiente v1 | Netlify + Supabase | Supabase | Reemplazada |
| 4 | Página independiente v2 | Netlify + Supabase (`obleas-matilde-web/`) | Supabase | **En uso** |

**Por qué se cambió de versión:**
- **De local a claude.ai:** para usarla desde varios dispositivos.
- **De claude.ai a Netlify + Supabase:** claude.ai no permite que personas sin cuenta vendan ni guarden datos, y era un requisito que cualquiera con el enlace pudiera vender.

---

## 3. Funciones del sistema (versión 2)

### Vender
- Productos por categoría (Obleas, Bolis en agua, Bolis en leche, Bolis especiales), con buscador.
- **Obleas con salsas y adicionales:** las 4 obleas del menú abren una ventana para elegir salsas (chocolate, mora, maracuyá, durazno) y adicionales (queso, lluvia, chispitas, leche condensada). En "+ 1 salsa" y "+ 3 salsas" el cliente elige cuáles van incluidas; no deja agregar hasta elegirlas.
- Pago en **efectivo** (con cálculo de cambio y botones rápidos de billetes) o **transferencia**.
- **Descuento de meseros:** pide un código propio de los meseros y el valor en pesos.
- **Ventana emergente** al registrar cada venta: número de orden, fecha y hora, total, pago, cambio y productos.
- **Recibo imprimible** en tamaño tirilla de 80 mm.
- En celular, el carrito se abre como panel desde abajo.

### Caja diaria
- **Abrir caja** con el PIN de vendedor y el efectivo inicial (base). Sin caja abierta no se puede vender.
- **Cerrar caja** escribiendo el efectivo contado. El vendedor no ve si cuadra.
- El administrador ve: base, ventas en efectivo, cuánto debería haber, cuánto se contó y el resultado (cuadra / falta / sobra).

### Inventario (con contraseña)
- Tres pestañas: **Para vender**, **Adicionales** e **Insumos**.
- Agregar, editar y eliminar productos y cambiar precios.
- **Recetas:** cada producto indica los insumos que usa (en gramos o unidades) y su merma.
- **Costo de producción, ganancia y margen** de cada producto, calculados automáticamente.
- **Insumos:**
  - **Compra:** suma paquetes y actualiza el precio (útil para el queso, de precio variable).
  - **Contar:** corrige lo que hay realmente.
  - Se descuentan solos con cada venta y la página avisa cuando queda poco.

### Cierre del día (con contraseña)
- Total vendido, efectivo, transferencia y **ganancia** (con costo, descuentos y margen).
- Resultado de la **caja**.
- **Unidades vendidas:** obleas, bolis y adicionales.
- **Ventas** con número de orden; cada una se puede imprimir, **editar** o **anular**.
- **Ganancia por producto**, con cada adicional en su propia fila.
- **Insumos usados** en el día, su costo y lo que queda.
- Exportar a CSV (Excel). Consulta de cualquier fecha anterior.

### Ajustes (con contraseña)
- PIN de vendedor, código de meseros y contraseña de administrador.
- Descargar y subir respaldos.

---

## 4. Productos, precios y costos

### Menú
| Producto | Precio | Salsas incluidas | Costo |
|---|---|---|---|
| Oblea solo arequipe | $3.500 | 0 | $748 |
| Oblea arequipe + queso | $4.500 | 0 | $748 + queso |
| Oblea arequipe + queso + 1 salsa | $5.500 | 1 (el cliente elige cuál) | $748 + queso + salsa |
| Oblea arequipe + queso + 3 salsas | $6.500 | 3 (el cliente elige cuáles) | $748 + queso + 3 salsas |

Todas las obleas abren la ventana de salsas y adicionales. Las salsas incluidas no se cobran (son las primeras que se marcan); las demás salsas y adicionales cuestan $1.000 cada uno.

| Producto | Precio | Costo |
|---|---|---|
| Bolis en agua (corozo, tamarindo, maracuyá) | $4.000 | $2.800 |
| Bolis en leche (guanábana, maracuyá, kola, coco) | $4.500 | $2.800 |
| Bolis especiales (arequipe, Milo, galleta con bocadillo) | $4.500 | $2.800 |

### Adicionales de oblea ($1.000 cada uno, se pueden cambiar)
| Adicional | Insumo usado | Costo |
|---|---|---|
| Queso | 25 g de queso | Depende del precio de compra (*) |
| Salsa de chocolate, mora, maracuyá o durazno | 25 g de salsa | $288 |
| Lluvia de chocolate | 15 g | $518 |
| Chispitas de colores | 15 g | $518 |
| Leche condensada | 25 g | $385 |

(*) El queso quedó con precio $0. Se actualiza al registrar la primera compra.

### Cómo se calcula el costo de la oblea base
| Insumo | Cantidad | Costo |
|---|---|---|
| Obleas (paquete x100 a $17.000) | 2 unidades | $340 |
| Arequipe Basileia 5 kg ($62.000) | 25 g | $310 |
| **Subtotal** | | **$650** |
| **+ 15 % de merma** | | **$748** |

### Insumos registrados
| Insumo | Paquete | Precio |
|---|---|---|
| Arequipe Basileia | 5 kg | $62.000 |
| Paquete de obleas | 100 u | $17.000 |
| Salsas (chocolate, durazno, maracuyá, mora) | 1 kg | $10.000 |
| Leche condensada (galón) | 5 kg | $67.000 |
| Chispitas de colores | 1 kg | $30.000 |
| Lluvia de chocolate | 1 kg | $30.000 |
| Queso | 4 kg | Variable |

---

## 5. Seguridad

| Quién | Qué puede hacer |
|---|---|
| Cualquiera con el enlace | Ver los productos a la venta y sus precios |
| Quien tiene el **PIN de vendedor** | Abrir y cerrar caja, vender, imprimir recibos |
| Quien tiene el **código de meseros** | Aplicar descuentos en una venta |
| Quien tiene la **contraseña de administrador** | Inventario, costos, cierre del día, editar y anular ventas, ajustes y respaldos |

- La contraseña, el PIN y el código se **verifican en el servidor** y se guardan **cifrados**.
- Nadie puede leer las tablas directamente: todo pasa por funciones que revisan los permisos. Se comprobó que sin contraseña no se pueden leer ventas, costos ni ajustes.
- Tras un intento fallido, el servidor espera 1 segundo para frenar a quien intente adivinar.
- **Si se olvida la contraseña de administrador**, se puede reiniciar desde Supabase (instrucción en `INSTRUCCIONES.md`).

---

## 6. Archivos

```
Sistema Obleas y barra/
├── index.html                     Versión 1 (local, ya no se usa)
├── obleas-matilde.html            Versión 2 (claude.ai, ya no se usa)
├── INFORME.md                     Este informe
└── obleas-matilde-web/            ← VERSIÓN EN USO
    ├── sitio/
    │   ├── index.html             La página (versión 2, lista para subir)
    │   └── config.js              Conexión con Supabase (URL y clave pública)
    ├── supabase.sql               Base de datos inicial (ya ejecutado)
    ├── supabase-v2.sql            Actualización 2 (ya ejecutado)
    ├── supabase-fix-insumos.sql   Corrección de 3 insumos (FALTA ejecutar)
    └── INSTRUCCIONES.md           Guía de instalación paso a paso
```

---

## 7. Pendientes

### Instalación de la versión 2: hecha
- `supabase-v2.sql` se ejecutó en Supabase. Se comprobó: caja, PIN, contraseña, las 4 obleas con sus salsas incluidas y los 8 adicionales.
- La carpeta `sitio` se subió a Netlify. Se comprobó que el archivo publicado es idéntico al local.

### Corrección pendiente: 3 insumos guardados como "para vender"
En la base de datos real, **Lluvia de chocolate**, **Chispitas de colores** y **Leche condensada galón** quedaron como productos para vender (a $1.000, $500 y $1.000). Por eso aparece una categoría **"Insumos"** en la pantalla de Vender, y los costos de esos adicionales salen mal.

**Arreglo:** ejecutar `supabase-fix-insumos.sql` en el **SQL Editor** (https://supabase.com/dashboard/project/vwfcmkdgstekyyuexlgh/sql/new), no en el asistente de IA ni en reportes, porque esos solo permiten consultas. Son 2 instrucciones; el editor normal acepta las dos juntas.

Al ejecutar quedan otra vez como insumos (paquete de 1 kg a $30.000, y galón de 5 kg a $67.000), con sus recetas.

### Después de la corrección
- [ ] **Cambiar la contraseña de administrador** (se escribió en el chat).
- [ ] Decidir el precio del adicional **Chispitas** ($1.000 actual; en la base de datos real se cobraban $500).
- [ ] Decidir si se conserva el producto **"Oblea solo Arequipe Meseros"** ($2.500), creado por el usuario. Ahora existe el botón de descuento para meseros.
- [ ] Registrar la primera **compra de queso** con su precio real.
- [ ] Confirmar cuántos **gramos de queso** lleva cada oblea (quedó en 25 g).
- [ ] **Contar o registrar la compra** de cada insumo para que empiecen a descontarse.
- [ ] Crear el **código de meseros** en Ajustes.
- [ ] Hacer una venta de prueba: abrir caja, vender, cerrar caja y revisar el cierre.
- [ ] Subir el respaldo de la versión de claude.ai, si tenía ventas que se quieran conservar.
- [ ] Descargar un respaldo cada semana.

### Mejoras propuestas (no hechas)
- **Modo sin internet:** guardar ventas en el dispositivo y enviarlas cuando vuelva la conexión.
- **Datos del negocio en el recibo:** dirección, teléfono, NIT.
- **Facturación electrónica DIAN:** el recibo actual es un comprobante de venta, no una factura electrónica. Requiere un proveedor autorizado.

---

## 8. Pruebas realizadas

### Base de datos (Postgres local, sin tocar la real)
**39 de 40 pruebas correctas.** La única falla era un error en el valor esperado por la prueba, no en el sistema. Se probó:
- Que la actualización se puede ejecutar dos veces sin dañar nada.
- Que los costos calculados coinciden: oblea base $748, salsa $288, lluvia $518, leche condensada $385.
- Que no se puede vender con la caja cerrada.
- Que el PIN incorrecto, el código de mesero incorrecto y la contraseña incorrecta se rechazan.
- Que el descuento no puede superar el total.
- Que los bolis no aceptan adicionales.
- Que los insumos bajan con cada venta y vuelven al anular o editar.
- Que el cierre de caja calcula el faltante.
- Que el respaldo y la restauración funcionan.
- Que sin contraseña no se pueden leer las tablas.

### Página completa (con la base de datos de prueba)
Abrir caja → vender una oblea con queso y salsa más un boli → descuento de mesero de $1.000 → cobro en efectivo con cambio → ventana emergente → segunda venta por transferencia → cerrar caja con faltante → cierre del día (caja, ganancia, unidades, insumos) → editar una venta → registrar compra de queso → editar receta. **Todo funcionó.**

### Errores encontrados y corregidos durante el trabajo
| Error | Corrección |
|---|---|
| La tarjeta del total se veía deformada | Choque de estilos; se renombró la clase |
| En claude.ai no funcionaban imprimir ni las confirmaciones | Se reemplazaron por diálogos propios y descargas |
| El link de claude.ai quedó compartido con "cualquiera con el enlace" | Las ventas y la contraseña quedaron ocultas para visitantes |
| `config.js` se guardó con los datos del ejemplo | Se puso la URL real; la clave la pegó el usuario |
| El servidor de prueba se bloqueaba tras un PIN incorrecto | Error del servidor de prueba (no de la página); corregido |
| Las salsas "incluidas" se elegían en orden alfabético | Ahora son las primeras que marca el cliente |
| El editor de Supabase rechazaba `add column if not exists` | Esas líneas se metieron en un bloque `do` |
| Un restaurar con un respaldo viejo borraba los adicionales de las obleas | Ahora se conservan los datos que el respaldo no trae |
| Aparecía la categoría "Insumos" en Vender | No era la página: 3 insumos estaban guardados como "para vender". Corrección en `supabase-fix-insumos.sql` |

---

## 9. Otras tareas realizadas

- Instalación de la skill **UI/UX Pro Max** (en el proyecto y de forma global) y de las skills de diseño que trae.
- Instalación de **Claude Code** para la terminal (versión 2.1.325).
- Instrucciones para conectar el servidor MCP de **21st.dev**: el usuario debe ejecutar el comando con su propia clave.
- Rediseño visual de la página: colores caramelo, modo oscuro automático, íconos en lugar de emojis y diseño para celular.
