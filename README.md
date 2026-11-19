# DCCORE
Portal corporativo de DC CONCRETOS para la gestión centralizada de políticas, reglamentos, procedimientos, manuales y documentos internos, con control de versiones y seguimiento de cumplimiento.


Página web donde la empresa publica sus políticas y cada empleado, desde su celular:

1. **Lee** la política completa (PDF o texto); el botón para continuar solo se activa al llegar al final.
2. **Firma** con el dedo en la pantalla.
3. **Graba un video** leyendo en voz alta: *"Yo, [nombre], he leído la política [título] versión [x] y firmo de acuerdo con ella."* (la frase aparece sobre la cámara como guion).
4. **Envía** y recibe una **constancia** con folio que puede imprimir o guardar en PDF.

El administrador, desde `/admin.html`:

- Sube políticas (PDF o texto) con código, versión y área.
- Publica nuevas versiones (la anterior se desactiva y todos deben volver a firmar).
- Ve quién firmó, el video, la firma, fecha/hora, IP, dispositivo y tiempo de lectura.
- Ve quién tiene firmas **pendientes**.
- Descarga todo a Excel (CSV).
- Obtiene el enlace y un **código QR** para compartir con los empleados (o enviarlo por WhatsApp).

### Evidencia que se guarda por cada firma
Folio único · nombre y número de empleado · política y versión · firma (PNG) · video · fecha y hora · IP · navegador/dispositivo · segundos de lectura · **huella digital SHA-256** del documento firmado, de la firma y del video (permite demostrar que ninguno fue modificado después).

---

## Instalación

Requisitos: **Node.js 18 o superior**.

```bash
npm install
cp .env.example .env      # edita EMPRESA_NOMBRE y ADMIN_PASSWORD
npm start
```

- Empleados: `http://tu-servidor:3000/`
- Administrador: `http://tu-servidor:3000/admin.html`

> ⚠️ **La cámara del celular solo funciona con HTTPS** (candado en el navegador). En producción publica el portal con un dominio y certificado SSL (las opciones de abajo ya lo incluyen).

### Opción A — Servidor propio / VPS (DigitalOcean, AWS Lightsail, Hostinger VPS…)
```bash
git clone <tu-repositorio> dccore && cd dccore
npm install && cp .env.example .env && nano .env
npm i -g pm2 && pm2 start server.js --name politicas && pm2 save
```
Pon delante Nginx o Caddy con un certificado gratuito de Let's Encrypt. Con Caddy basta:
```
politicas.tuempresa.com {
    reverse_proxy localhost:3000
}
```
Si usas Nginx, sube el límite de carga para los videos: `client_max_body_size 150M;`

### Opción B — Docker
```bash
docker build -t dccore .
docker run -d -p 3000:3000 -v /ruta/datos:/data \
  -e ADMIN_PASSWORD=... -e EMPRESA_NOMBRE="Mi Empresa" dccore
```

### Opción C — Render / Railway (sin administrar servidor)
Conecta el repositorio, comando de inicio `npm start`, define las variables `ADMIN_PASSWORD` y `EMPRESA_NOMBRE`, y **agrega un disco persistente** montado en `/data` con la variable `DATA_DIR=/data` (si no, los videos se borran en cada reinicio).

---

## Dónde se guardan los datos
Todo vive en la carpeta `data/` (o en `DATA_DIR`):

```
data/portal.db      ← base de datos (empleados, políticas, firmas)
data/politicas/     ← PDFs
data/firmas/        ← imágenes de firma
data/videos/        ← videos de aceptación
```
**Respalda esa carpeta con regularidad.** Un video de 30 s pesa aprox. 3–5 MB; 500 empleados × 10 políticas ≈ 20 GB.

## Recomendaciones
- **Aviso de privacidad:** el video y la firma son datos personales (en México, LFPDPPP). Incluye o enlaza tu aviso de privacidad y conserva la evidencia solo el tiempo necesario.
- Para validez laboral/legal, consulta con tu área jurídica; este sistema genera evidencia sólida (firma + video + huellas SHA-256 + fecha/IP), pero no es una firma electrónica avanzada (e.firma del SAT).
- Si el celular no abre la cámara dentro del navegador (algunos navegadores internos de apps), el portal ofrece el botón **"Grabar con la cámara del teléfono"**, que usa la app de cámara nativa.

## Estructura
```
server.js            API y servidor (Express)
db.js                Base de datos SQLite
public/index.html    Ingreso del empleado y lista de políticas
public/politica.html Leer → Firmar → Video → Enviar
public/constancia.html
public/admin.html    Panel de administración
```
