require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { handleUpload } = require('@vercel/blob/client');
const { q, uno } = require('./db');
const almacen = require('./almacen');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const EMPRESA = process.env.EMPRESA_NOMBRE || 'DC CONCRETOS';
const MB = 1024 * 1024;

if (!ADMIN_PASSWORD) console.warn('⚠️  Define ADMIN_PASSWORD para poder entrar al panel de administración.');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
// En Vercel los archivos de public/ los sirve su CDN; esto es para correrlo localmente
app.use(express.static(path.join(__dirname, 'public')));

// ---------- utilidades ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const nuevoToken = () => crypto.randomBytes(24).toString('hex');
const limpiar = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function tokenDe(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return String(req.query.t || '');
}
async function empleadoDeToken(token) {
  if (!token) return null;
  return uno(`SELECT e.id, e.numero, e.nombre, e.area FROM sesiones s
    JOIN empleados e ON e.id = s.empleado_id WHERE s.token = $1 AND s.tipo = 'empleado'`, [token]);
}
async function esAdmin(token) {
  if (!token) return false;
  return !!(await uno(`SELECT 1 FROM sesiones WHERE token = $1 AND tipo = 'admin'`, [token]));
}
const requiereEmpleado = ah(async (req, res, next) => {
  req.empleado = await empleadoDeToken(tokenDe(req));
  if (!req.empleado) return res.status(401).json({ error: 'Sesión no válida. Vuelve a ingresar.' });
  next();
});
const requiereAdmin = ah(async (req, res, next) => {
  if (!(await esAdmin(tokenDe(req)))) return res.status(401).json({ error: 'Sesión de administrador no válida.' });
  next();
});

// ---------- autorización de subidas de archivos ----------
// El navegador sube los archivos directo al almacenamiento (Vercel Blob) para no pasar
// por el límite de 4.5 MB de Vercel. Aquí se decide qué puede subir cada quien.
async function autorizarSubida(pathname, clientPayload) {
  let datos = {};
  try { datos = JSON.parse(clientPayload || '{}'); } catch {}
  const { token, tipo } = datos;
  const politicaId = parseInt(datos.politicaId, 10);

  if (tipo === 'politica') {
    if (!(await esAdmin(token))) throw new Error('No autorizado.');
    if (!/^politicas\/[\w-]+\.pdf$/.test(pathname)) throw new Error('Ruta no válida.');
    return { allowedContentTypes: ['application/pdf'], maximumSizeInBytes: 50 * MB };
  }
  if (tipo === 'firma' || tipo === 'video') {
    const emp = await empleadoDeToken(token);
    if (!emp) throw new Error('Sesión no válida.');
    const pol = await uno('SELECT id FROM politicas WHERE id = $1 AND activa', [politicaId]);
    if (!pol) throw new Error('Política no encontrada.');
    const ya = await uno('SELECT 1 FROM firmas WHERE politica_id = $1 AND empleado_id = $2', [politicaId, emp.id]);
    if (ya) throw new Error('Ya firmaste esta política.');
    const carpeta = tipo === 'firma' ? 'firmas' : 'videos';
    const ext = tipo === 'firma' ? 'png' : '(mp4|webm|mov)';
    if (!new RegExp(`^${carpeta}/${politicaId}_${emp.id}_\\d+\\.${ext}$`).test(pathname)) throw new Error('Ruta no válida.');
    return tipo === 'firma'
      ? { allowedContentTypes: ['image/png'], maximumSizeInBytes: 3 * MB }
      : { allowedContentTypes: ['video/*'], maximumSizeInBytes: 150 * MB };
  }
  throw new Error('Tipo de archivo no válido.');
}

app.get('/api/almacen/modo', (_req, res) => res.json({ modo: almacen.MODO }));

// Vercel Blob: genera el permiso temporal para que el navegador suba el archivo
app.post('/api/almacen/subir', ah(async (req, res) => {
  try {
    const r = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: (pathname, clientPayload) => autorizarSubida(pathname, clientPayload),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// Modo local (sin Vercel Blob): el navegador envía el archivo aquí
app.put('/api/almacen/local', express.raw({ type: () => true, limit: '150mb' }), ah(async (req, res) => {
  if (almacen.MODO !== 'local') return res.status(404).end();
  const pathname = String(req.query.pathname || '');
  try {
    const reglas = await autorizarSubida(pathname, String(req.query.payload || ''));
    if (req.body.length > reglas.maximumSizeInBytes) throw new Error('El archivo es demasiado grande.');
    await almacen.guardarLocal(pathname, req.body);
    res.json({ pathname });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------- configuración pública ----------
app.get('/api/config', (_req, res) => res.json({ empresa: EMPRESA }));

// ---------- EMPLEADO ----------
app.post('/api/empleado/ingresar', ah(async (req, res) => {
  const numero = limpiar(req.body.numero, 40).toUpperCase();
  const nombre = limpiar(req.body.nombre, 120).replace(/\s+/g, ' ');
  const area = limpiar(req.body.area, 80);
  if (!numero || nombre.length < 5) {
    return res.status(400).json({ error: 'Escribe tu número de empleado y tu nombre completo.' });
  }
  let emp = await uno('SELECT * FROM empleados WHERE numero = $1', [numero]);
  if (!emp) {
    emp = await uno('INSERT INTO empleados (numero, nombre, area) VALUES ($1,$2,$3) RETURNING *', [numero, nombre, area]);
  } else if (area && area !== emp.area) {
    await q('UPDATE empleados SET area = $1 WHERE id = $2', [area, emp.id]);
  }
  const token = nuevoToken();
  await q(`INSERT INTO sesiones (token, tipo, empleado_id) VALUES ($1, 'empleado', $2)`, [token, emp.id]);
  res.json({ token, empleado: { numero: emp.numero, nombre: emp.nombre, area: area || emp.area } });
}));

app.get('/api/empleado/yo', requiereEmpleado, (req, res) => res.json(req.empleado));

app.get('/api/politicas', requiereEmpleado, ah(async (req, res) => {
  res.json(await q(`
    SELECT p.id, p.codigo, p.titulo, p.version, p.descripcion, p.area, p.creada,
           f.id AS firma_id, f.folio, f.creada AS firmada
    FROM politicas p
    LEFT JOIN firmas f ON f.politica_id = p.id AND f.empleado_id = $1
    WHERE p.activa
    ORDER BY (f.id IS NOT NULL), p.titulo`, [req.empleado.id]));
}));

app.get('/api/politicas/:id', requiereEmpleado, ah(async (req, res) => {
  const p = await uno(`SELECT id, codigo, titulo, version, descripcion, area, tipo, contenido, hash
                       FROM politicas WHERE id = $1 AND activa`, [parseInt(req.params.id, 10)]);
  if (!p) return res.status(404).json({ error: 'Política no encontrada.' });
  const f = await uno('SELECT folio, creada FROM firmas WHERE politica_id = $1 AND empleado_id = $2', [p.id, req.empleado.id]);
  res.json({ ...p, firma: f || null });
}));

app.get('/api/politicas/:id/archivo', requiereEmpleado, ah(async (req, res) => {
  const p = await uno(`SELECT archivo FROM politicas WHERE id = $1 AND tipo = 'pdf'`, [parseInt(req.params.id, 10)]);
  if (!p) return res.status(404).end();
  await almacen.enviar(res, p.archivo, 'application/pdf');
}));

app.post('/api/politicas/:id/firmar', requiereEmpleado, ah(async (req, res) => {
  const emp = req.empleado;
  const p = await uno('SELECT * FROM politicas WHERE id = $1 AND activa', [parseInt(req.params.id, 10)]);
  if (!p) return res.status(404).json({ error: 'Política no encontrada.' });
  const ya = await uno('SELECT folio FROM firmas WHERE politica_id = $1 AND empleado_id = $2', [p.id, emp.id]);
  if (ya) return res.status(409).json({ error: 'Ya firmaste esta política.', folio: ya.folio });
  if (req.body.acepto !== 'si') return res.status(400).json({ error: 'Debes marcar la casilla de aceptación.' });

  const firma = String(req.body.firma || '');
  const video = String(req.body.video || '');
  const prefijo = `${p.id}_${emp.id}_`;
  if (!firma.startsWith('firmas/' + prefijo) || !video.startsWith('videos/' + prefijo)) {
    return res.status(400).json({ error: 'Archivos no válidos.' });
  }
  const [iFirma, iVideo] = await Promise.all([almacen.inspeccionar(firma), almacen.inspeccionar(video)]);
  if (!iFirma || iFirma.size < 500) return res.status(400).json({ error: 'Falta la firma.' });
  if (!iVideo || iVideo.size < 10000) return res.status(400).json({ error: 'Falta el video de aceptación.' });

  const folio = `POL${p.id}-${emp.numero}-${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9-]/gi, '');
  const frase = `Yo, ${emp.nombre}, he leído la política "${p.titulo}" versión ${p.version} y firmo de acuerdo con ella.`;
  const vt = iVideo.contentType || ('video/' + video.split('.').pop());
  await q(`INSERT INTO firmas (folio, politica_id, empleado_id, nombre_firmante, frase, firma_archivo,
      video_archivo, video_tipo, hash_politica, hash_firma, hash_video, segundos_lectura, ip, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
    folio, p.id, emp.id, emp.nombre, frase, firma, video, vt, p.hash, iFirma.hash, iVideo.hash,
    parseInt(req.body.segundos_lectura, 10) || null, req.ip, limpiar(req.get('user-agent'), 400)]);
  res.json({ ok: true, folio });
}));

app.get('/api/constancia/:folio', requiereEmpleado, ah(async (req, res) => {
  const f = await uno(`SELECT f.folio, f.nombre_firmante, f.frase, f.hash_politica, f.hash_firma, f.hash_video,
      f.creada, f.segundos_lectura, e.numero, e.area, p.titulo, p.version, p.codigo
      FROM firmas f JOIN empleados e ON e.id = f.empleado_id JOIN politicas p ON p.id = f.politica_id
      WHERE f.folio = $1 AND f.empleado_id = $2`, [req.params.folio, req.empleado.id]);
  if (!f) return res.status(404).json({ error: 'Constancia no encontrada.' });
  res.json(f);
}));
app.get('/api/constancia/:folio/firma', requiereEmpleado, ah(async (req, res) => {
  const f = await uno('SELECT firma_archivo FROM firmas WHERE folio = $1 AND empleado_id = $2', [req.params.folio, req.empleado.id]);
  if (!f) return res.status(404).end();
  await almacen.enviar(res, f.firma_archivo, 'image/png');
}));

// ---------- ADMINISTRADOR ----------
app.post('/api/admin/ingresar', ah(async (req, res) => {
  const pass = String(req.body.password || '');
  const ok = ADMIN_PASSWORD && pass.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  const token = nuevoToken();
  await q(`INSERT INTO sesiones (token, tipo) VALUES ($1, 'admin')`, [token]);
  res.json({ token });
}));

app.get('/api/admin/resumen', requiereAdmin, ah(async (_req, res) => {
  const [{ n: empleados }] = await q('SELECT COUNT(*)::int n FROM empleados');
  const [{ n: totalFirmas }] = await q('SELECT COUNT(*)::int n FROM firmas');
  const politicas = await q(`
    SELECT p.id, p.codigo, p.titulo, p.version, p.descripcion, p.area, p.tipo, p.activa, p.creada,
      (SELECT COUNT(*)::int FROM firmas f WHERE f.politica_id = p.id) AS firmas
    FROM politicas p ORDER BY p.activa DESC, p.creada DESC`);
  res.json({ empleados, totalFirmas, politicas });
}));

app.post('/api/admin/politicas', requiereAdmin, ah(async (req, res) => {
  const titulo = limpiar(req.body.titulo, 200);
  const contenido = String(req.body.contenido || '').trim();
  const archivo = String(req.body.archivo || '');
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio.' });
  if (!archivo && !contenido) return res.status(400).json({ error: 'Sube un PDF o escribe el texto de la política.' });
  let hash;
  if (archivo) {
    if (!/^politicas\/[\w-]+\.pdf$/.test(archivo)) return res.status(400).json({ error: 'Archivo no válido.' });
    const info = await almacen.inspeccionar(archivo);
    if (!info) return res.status(400).json({ error: 'No se encontró el PDF subido. Intenta de nuevo.' });
    hash = info.hash;
  } else {
    hash = sha256(Buffer.from(contenido));
  }
  const r = await uno(`INSERT INTO politicas (codigo, titulo, version, descripcion, area, tipo, archivo, contenido, hash)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [
    limpiar(req.body.codigo, 40), titulo, limpiar(req.body.version, 20) || '1.0', limpiar(req.body.descripcion, 600),
    limpiar(req.body.area, 80), archivo ? 'pdf' : 'texto', archivo || null, archivo ? null : contenido, hash]);
  const reemplaza = parseInt(req.body.reemplaza, 10);
  if (reemplaza) await q('UPDATE politicas SET activa = false WHERE id = $1', [reemplaza]);
  res.json({ ok: true, id: r.id });
}));

app.patch('/api/admin/politicas/:id', requiereAdmin, ah(async (req, res) => {
  await q('UPDATE politicas SET activa = $1 WHERE id = $2', [!!req.body.activa, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));

app.get('/api/admin/politicas/:id/archivo', requiereAdmin, ah(async (req, res) => {
  const p = await uno(`SELECT archivo FROM politicas WHERE id = $1 AND tipo = 'pdf'`, [parseInt(req.params.id, 10)]);
  if (!p) return res.status(404).end();
  await almacen.redirigir(res, p.archivo);
}));

const SQL_FIRMAS = `SELECT f.id, f.folio, f.nombre_firmante, f.frase, f.creada, f.segundos_lectura, f.ip, f.user_agent,
    f.hash_politica, f.hash_firma, f.hash_video, f.video_tipo,
    e.numero, e.area, p.id AS politica_id, p.titulo, p.version, p.codigo
  FROM firmas f JOIN empleados e ON e.id = f.empleado_id JOIN politicas p ON p.id = f.politica_id`;

app.get('/api/admin/firmas', requiereAdmin, ah(async (req, res) => {
  const texto = `%${limpiar(req.query.q, 80)}%`;
  const pid = parseInt(req.query.politica, 10) || null;
  res.json(await q(`${SQL_FIRMAS}
    WHERE ($1::int IS NULL OR f.politica_id = $1) AND (e.nombre ILIKE $2 OR e.numero ILIKE $2 OR f.folio ILIKE $2)
    ORDER BY f.creada DESC LIMIT 1000`, [pid, texto]));
}));

app.get('/api/admin/firmas/:id/firma', requiereAdmin, ah(async (req, res) => {
  const f = await uno('SELECT firma_archivo FROM firmas WHERE id = $1', [parseInt(req.params.id, 10)]);
  if (!f) return res.status(404).end();
  await almacen.enviar(res, f.firma_archivo, 'image/png');
}));
app.get('/api/admin/firmas/:id/video', requiereAdmin, ah(async (req, res) => {
  const f = await uno('SELECT video_archivo FROM firmas WHERE id = $1', [parseInt(req.params.id, 10)]);
  if (!f) return res.status(404).end();
  await almacen.redirigir(res, f.video_archivo);
}));

app.get('/api/admin/pendientes', requiereAdmin, ah(async (_req, res) => {
  res.json(await q(`
    SELECT e.numero, e.nombre, e.area, p.id AS politica_id, p.titulo, p.version
    FROM empleados e CROSS JOIN politicas p
    WHERE p.activa AND NOT EXISTS (SELECT 1 FROM firmas f WHERE f.empleado_id = e.id AND f.politica_id = p.id)
    ORDER BY e.nombre, p.titulo`));
}));

app.get('/api/admin/exportar.csv', requiereAdmin, ah(async (_req, res) => {
  const filas = await q(`${SQL_FIRMAS} ORDER BY f.creada DESC`);
  const cols = ['folio', 'creada', 'numero', 'nombre_firmante', 'area', 'codigo', 'titulo', 'version',
    'segundos_lectura', 'ip', 'hash_politica', 'hash_firma', 'hash_video'];
  const esc = (v) => `"${String(v instanceof Date ? v.toISOString() : v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="firmas-politicas.csv"');
  res.send(csv);
}));

app.get('/api/admin/qr', requiereAdmin, ah(async (req, res) => {
  const svg = await QRCode.toString(limpiar(req.query.url, 300), { type: 'svg', margin: 1, width: 260 });
  res.type('image/svg+xml').send(svg);
}));

// ---------- errores ----------
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Error en el servidor.' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`✅ Portal en http://localhost:${PORT}  (admin: /admin.html) · almacenamiento: ${almacen.MODO}`));
}
module.exports = app;
