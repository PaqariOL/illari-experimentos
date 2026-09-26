# Illari OpenLab Académico — Experimentos

Este repositorio contiene los experimentos que muestra la app. Cada vez que subes un cambio,
GitHub convierte todo automáticamente y lo publica; la app lo descarga la próxima vez que se abre.

```
clasificacion.xlsx            ← la clasificación (tópicos, campos, nivel, etc.)
experimentos/                 ← un .html por experimento
imagenes/                     ← imágenes que usan los HTML (opcional)
scripts/convertir.py          ← convierte todo a JSON (no hace falta tocarlo)
.github/workflows/publicar.yml← publica en GitHub Pages (no hace falta tocarlo)
```

---

## Configuración inicial (una sola vez)

### 1. Crear el repositorio
1. En github.com, arriba a la derecha: **+ → New repository**.
2. Nombre: `illari-experimentos`.
3. Marca **Public** (la app necesita leerlo sin contraseña).
4. **No** marques "Add a README". Pulsa **Create repository**.

### 2. Subir los archivos
1. En la página del repositorio vacío, pulsa **uploading an existing file**.
2. Descomprime el zip y **arrastra todo su contenido** (las carpetas `.github`, `experimentos`,
   `scripts` y los archivos `clasificacion.xlsx` y `README.md`).
3. Abajo, pulsa **Commit changes**.

> Si la carpeta `.github` no se sube (en Windows a veces está oculta), créala a mano:
> **Add file → Create new file**, escribe como nombre `.github/workflows/publicar.yml`,
> pega el contenido de ese archivo y pulsa **Commit changes**.

### 3. Activar GitHub Pages
1. En el repositorio: **Settings → Pages**.
2. En **Source**, elige **GitHub Actions**.

### 4. Ejecutar la primera publicación
1. Ve a la pestaña **Actions → Publicar experimentos → Run workflow → Run workflow**.
2. Espera 1–2 minutos hasta que aparezca el círculo verde ✔.
3. Abre `https://TU-USUARIO.github.io/illari-experimentos/` en el navegador:
   debe decir cuántos experimentos se publicaron.

Esa dirección es la que va en la app (`URL_BASE` en `src/lib/experimentos.ts`).

---

## Agregar o modificar experimentos (el día a día)

1. **Sube el HTML** a la carpeta `experimentos/`
   (entra a la carpeta → **Add file → Upload files** → arrastra → **Commit changes**).
2. **Actualiza el Excel** en tu computadora (una fila nueva con el nombre del HTML y sus "x")
   y súbelo a la raíz del repositorio, reemplazando `clasificacion.xlsx`.
3. Espera 1–2 minutos. La app lo mostrará la próxima vez que se abra S3 con internet.

Para **corregir** un experimento, sube el HTML con el mismo nombre: se reemplaza.

### Referencias (opcional)
Si el Excel tiene una columna con el encabezado **Referencia**, sus enlaces aparecen en la app
como última pestaña de la ficha. Puedes poner varios en la misma celda, separados por salto de
línea (Alt+Enter) o punto y coma. También se aceptan citas sin enlace.

### Imágenes
Pon las imágenes **en la carpeta `experimentos/`** (junto al HTML) o en `imagenes/`.
Pueden repetirse nombres entre experimentos (`picture.png`), el script los separa solo.
Redúcelas a ~1200 px de ancho como máximo para que carguen rápido.

### ¿Cómo sé si algo salió mal?
En **Actions**, abre la última ejecución → **publicar → Convertir Excel + HTML**.
Ahí aparece la lista de avisos, por ejemplo:
- un HTML que está en el Excel pero no se subió,
- un HTML subido que no está en el Excel (no se publica),
- una imagen que no se encontró,
- una fila sin ningún tópico ni campo marcado.

---

## Formato de los HTML
El script reconoce la estructura de tus HTML actuales:
- `<div class="titulo">` → título del experimento
- `<div class="subtitulo">` (o `<h2>`/`<h3>`) → inicio de cada sección
- líneas que empiezan con `•` → elementos de lista
- líneas completas en `<strong>` → avisos de seguridad (se destacan en la app)
- `<sub>`/`<sup>` → se conservan (H₂O, cm³)

Las secciones cuyo título contiene *Materiales*, *Procedimiento*, *Objetivos* o
*Discusión/Conclusiones/Preguntas* se muestran con formato especial (checklist, pasos
numerados, preguntas). El resto se muestra como texto.
