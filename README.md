# DCCORE
Portal corporativo de DC CONCRETOS para la gestión centralizada de políticas, reglamentos, procedimientos, manuales y documentos internos, con control de versiones y seguimiento de cumplimiento.

## Qué hace

Cada empleado, desde su celular:

1. **Lee** la política completa (PDF o texto). El botón para continuar solo se activa cuando llega al final.
2. **Firma** con el dedo en la pantalla.
3. **Graba un video** leyendo en voz alta: *"Yo, [nombre], he leído la política [título] versión [x] y firmo de acuerdo con ella."* La frase aparece sobre la cámara para que la lea.
4. **Envía** todo y recibe una **constancia** con folio, que puede imprimir o guardar en PDF.

El administrador, en `/admin.html`:

- Sube políticas en PDF o en texto, con código, versión y área.
- Publica nuevas versiones. La anterior se desactiva y todos tienen que volver a firmar.
- Ve quién firmó, con video, firma, fecha y hora, IP, dispositivo y tiempo de lectura.
- Ve la lista de **firmas pendientes**.
- Exporta todo a Excel (CSV).
- Obtiene el enlace y un **código QR** para los empleados, o lo envía por WhatsApp.

**Evidencia que se guarda por cada firma:** folio único, empleado, política y versión, firma (PNG), video, fecha y hora, IP, dispositivo, segundos de lectura, y una **huella SHA-256** del documento, de la firma y del video. La huella permite demostrar que ninguno de los tres se modificó después.

---

## Publicar en Vercel

El proyecto ya está preparado para Vercel: Express sin configuración extra, archivos en **Vercel Blob privado** y datos en **Postgres (Neon)**.

1. **Importa el proyecto.** Entra a https://vercel.com/new, elige el repositorio **DCCORE** y da clic en **Deploy**. El primer despliegue puede fallar porque todavía no hay base de datos; es normal.
2. **Crea la base de datos.** En el proyecto, ve a **Storage** → **Create Database** → **Neon** (Postgres). Elige el plan Free y conéctala al proyecto. Esto agrega la variable `DATABASE_URL`.
3. **Crea el almacenamiento de archivos.** Ve a **Storage** → **Create Database** → **Blob**. Pon el acceso en **Private**; es importante porque los videos son datos personales y este ajuste no se puede cambiar después. Conéctalo al proyecto. Esto agrega la variable `BLOB_READ_WRITE_TOKEN`.
4. **Agrega las variables.** En **Settings** → **Environment Variables** agrega:
   - `ADMIN_PASSWORD` = la contraseña del panel
   - `EMPRESA_NOMBRE` = `DC CONCRETOS`
5. **Vuelve a desplegar.** En **Deployments**, abre el último, da clic en los tres puntos **⋯** y luego en **Redeploy**.

Listo:
- Empleados: `https://tu-proyecto.vercel.app/`
- Administrador: `https://tu-proyecto.vercel.app/admin.html`

Las tablas de la base de datos se crean solas en la primera visita.

### Cómo funcionan las subidas
Vercel limita cada petición a 4.5 MB. Por eso los videos y PDFs se suben **directo del navegador a Vercel Blob**. El servidor solo da un permiso temporal y revisa quién sube qué: un empleado solo puede subir su propia firma y su propio video, y solo el administrador puede subir PDFs. Al ver la evidencia, los videos se abren con un enlace temporal de 10 minutos.

---

## Correrlo localmente o en un servidor propio
Requisitos: Node.js 20 o superior y Postgres.
```bash
npm install
cp .env.example .env     # pon DATABASE_URL y ADMIN_PASSWORD
npm start
```
Sin `BLOB_READ_WRITE_TOKEN`, los archivos se guardan en la carpeta `data/`.

## Recomendaciones
- **Aviso de privacidad:** el video y la firma son datos personales (LFPDPPP). Incluye tu aviso de privacidad y conserva la evidencia solo el tiempo necesario.
- **Validez legal:** el sistema genera evidencia sólida (firma, video, huellas SHA-256, fecha e IP), pero no es la e.firma del SAT. Consulta a tu área jurídica.
- **Si la cámara no abre** en algún navegador (por ejemplo, el navegador interno de algunas apps), el portal ofrece el botón **"Grabar con la cámara del teléfono"**, que usa la cámara nativa.

## Estructura
```
server.js             API (Express); Vercel la detecta automáticamente
db.js                 Postgres
almacen.js            Archivos: Vercel Blob privado o carpeta local
public/               Páginas (Vercel las sirve desde su CDN)
  index.html          Ingreso del empleado y lista de políticas
  politica.html       Leer → Firmar → Video → Enviar
  constancia.html     Constancia de firma
  admin.html          Panel de administración
  vendor/             pdf.js y cliente de Vercel Blob (generados con `npm run vendor`)
```
