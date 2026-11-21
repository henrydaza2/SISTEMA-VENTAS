# Obleas Matilde · Cómo ponerla en internet

Son 4 pasos y toman unos 15 minutos. Solo se hacen una vez.

Qué hay en esta carpeta:

- `sitio/` → la página (`index.html`) y su conexión (`config.js`). **Esta carpeta es la que se sube a internet.**
- `supabase.sql` → crea la base de datos, las reglas de seguridad y tus 23 productos.
- `INSTRUCCIONES.md` → este archivo.

---

## Paso 1 · Crear la base de datos (Supabase, gratis)

1. Entra a https://supabase.com y crea una cuenta.
2. Crea un proyecto nuevo ("New project"). Ponle de nombre `obleas-matilde`.
   - Te pide una contraseña de base de datos: invéntala y guárdala. No se usa en la página.
   - Región: elige la más cercana (por ejemplo, East US).
3. Espera 1–2 minutos a que el proyecto termine de crearse.

## Paso 2 · Cargar las tablas y los productos

1. En el menú de la izquierda abre **SQL Editor**.
2. Abre el archivo `supabase.sql` con el Bloc de notas, copia **todo** y pégalo en el editor.
3. Presiona **Run**. Debe decir "Success".

Si sale un error, cópialo y pásaselo a Claude.

## Paso 3 · Conectar la página con tu base de datos

1. En Supabase abre **Project Settings → API** (también puede llamarse "Data API" o "API Keys").
2. Copia dos datos:
   - **Project URL** (se ve así: `https://abcdxyz.supabase.co`)
   - La **clave pública**: aparece como `anon` `public` o como `publishable`.
3. Abre `sitio/config.js` con el Bloc de notas y pégalos entre las comillas:

   ```js
   window.OM_CONFIG = {
     url: "https://abcdxyz.supabase.co",
     key: "tu-clave-publica"
   };
   ```

4. Guarda el archivo.

**Importante:** nunca pegues la clave `service_role` ni la `secret`. Esas dan acceso total y no deben estar en la página.

## Paso 4 · Publicar la página (Netlify, gratis)

1. Entra a https://app.netlify.com/drop y crea una cuenta.
2. Arrastra la carpeta **`sitio`** completa a la página.
3. En unos segundos te da un enlace. Para ponerle nombre: **Site configuration → Change site name** → `obleas-matilde`.
   Tu enlace queda así: `https://obleas-matilde.netlify.app` (si el nombre está ocupado, prueba otro parecido).

---

## Lo primero que debes hacer al abrir el enlace

1. Toca **Inventario**. Como aún no hay contraseña, la página te pide **crear la contraseña de administrador**.
   Hazlo de inmediato: el primero que la crea se queda con ella.
2. (Recomendado) Ve a **Ajustes → PIN de vendedor** y crea un PIN para tus empleados.
   - Con PIN: solo vende quien lo tenga. Se escribe una vez por dispositivo.
   - Sin PIN: vende cualquiera que tenga el enlace.
3. Haz una venta de prueba y luego anúlala en **Cierre del día**.

## Traer las ventas de la página anterior

1. En la página anterior (la de claude.ai): **Respaldo → Descargar respaldo**.
2. En la nueva: **Ajustes → Subir respaldo**.

## Cómo queda protegida

| Quién | Qué puede hacer |
|---|---|
| Cualquiera con el enlace | Ver los productos a la venta y sus precios. Vender (si no hay PIN). |
| Quien tiene el PIN de vendedor | Vender e imprimir el recibo de su venta. |
| Quien tiene la contraseña de administrador | Inventario, cierre del día, anular ventas, respaldo, cambiar PIN y contraseña. |

La contraseña y el PIN se revisan dentro del servidor, y se guardan cifrados. Los costos, los insumos y las ventas no se pueden leer sin la contraseña.

## Para cambiar la página más adelante

Cuando Claude te entregue una versión nueva de `index.html`, entra a Netlify → tu sitio → **Deploys** y arrastra otra vez la carpeta `sitio`. El enlace no cambia y los datos no se pierden.

## Si olvidas la contraseña de administrador

En Supabase → **SQL Editor**, ejecuta esto y vuelve a crearla desde la página:

```sql
update public.ajustes set clave_admin = null where id = 1;
```
