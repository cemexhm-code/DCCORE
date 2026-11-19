require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { db, DATA_DIR } = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const EMPRESA = process.env.EMPRESA_NOMBRE || 'DC CONCRETOS';

if (!ADMIN_PASSWORD) {
  console.warn('⚠️  Define ADMIN_PASSWORD en el archivo .env para poder entrar al panel de administración.');
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build')));

// ---------- utilidades ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (p) => sha256(fs.readFileSync(p));
const nuevoToken = () => crypto.randomBytes(24).toString('hex');
const limpiar = (s, max = 200) => String(s ?? '').trim().slice(0, max);

function tokenDe(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.t || '';
}
function requiereEmpleado(req, res, next) {
  const s = db.prepare(`SELECT s.*, e.numero, e.nombre, e.area FROM sesiones s
    JOIN empleados e ON e.id = s.empleado_id WHERE s.token = ? AND s.tipo = 'empleado'`).get(tokenDe(req));
  if (!s) return res.status(401).json({ error: 'Sesión no válida. Vuelve a ingresar.' });
  req.empleado = { id: s.empleado_id, numero: s.numero, nombre: s.nombre, area: s.area };
  next();
}
function requiereAdmin(req, res, next) {
  const s = db.prepare(`SELECT * FROM sesiones WHERE token = ? AND tipo = 'admin'`).get(tokenDe(req));
  if (!s) return res.status(401).json({ error: 'Sesión de administrador no válida.' });
  next();
}

// Subida de políticas (PDF) por el administrador
const subirPolitica = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'politicas'),
    filename: (_req, _f, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, f.mimetype === 'application/pdf'),
});

// Subida de firma + video por el empleado
const subirFirma = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024, files: 2 },
});

// ---------- configuración pública ----------
app.get('/api/config', (_req, res) => res.json({ empresa: EMPRESA }));

// ---------- EMPLEADO ----------
app.post('/api/empleado/ingresar', (req, res) => {
  const numero = limpiar(req.body.numero, 40).toUpperCase();
  const nombre = limpiar(req.body.nombre, 120).replace(/\s+/g, ' ');
  const area = limpiar(req.body.area, 80);
  if (!numero || nombre.length < 5) {
    return res.status(400).json({ error: 'Escribe tu número de empleado y tu nombre completo.' });
  }
  let emp = db.prepare('SELECT * FROM empleados WHERE numero = ?').get(numero);
  if (!emp) {
    const r = db.prepare('INSERT INTO empleados (numero, nombre, area) VALUES (?,?,?)').run(numero, nombre, area);
    emp = { id: r.lastInsertRowid, numero, nombre, area };
  } else if (area && area !== emp.area) {
    db.prepare('UPDATE empleados SET area = ? WHERE id = ?').run(area, emp.id);
  }
  const token = nuevoToken();
  db.prepare(`INSERT INTO sesiones (token, tipo, empleado_id) VALUES (?, 'empleado', ?)`).run(token, emp.id);
  res.json({ token, empleado: { numero: emp.numero, nombre: emp.nombre, area: area || emp.area } });
});

app.get('/api/empleado/yo', requiereEmpleado, (req, res) => res.json(req.empleado));

app.get('/api/politicas', requiereEmpleado, (req, res) => {
  const filas = db.prepare(`
    SELECT p.id, p.codigo, p.titulo, p.version, p.descripcion, p.area, p.creada,
           f.id AS firma_id, f.folio, f.creada AS firmada
    FROM politicas p
    LEFT JOIN firmas f ON f.politica_id = p.id AND f.empleado_id = ?
    WHERE p.activa = 1
    ORDER BY (f.id IS NOT NULL), p.titulo`).all(req.empleado.id);
  res.json(filas);
});

app.get('/api/politicas/:id', requiereEmpleado, (req, res) => {
  const p = db.prepare(`SELECT id, codigo, titulo, version, descripcion, area, tipo, contenido, hash
                        FROM politicas WHERE id = ? AND activa = 1`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Política no encontrada.' });
  const f = db.prepare('SELECT folio, creada FROM firmas WHERE politica_id = ? AND empleado_id = ?')
    .get(p.id, req.empleado.id);
  res.json({ ...p, firma: f || null });
});

app.get('/api/politicas/:id/archivo', requiereEmpleado, (req, res) => {
  const p = db.prepare(`SELECT archivo FROM politicas WHERE id = ? AND tipo = 'pdf'`).get(req.params.id);
  if (!p) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'politicas', p.archivo));
});

app.post('/api/politicas/:id/firmar', requiereEmpleado,
  subirFirma.fields([{ name: 'firma', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  (req, res) => {
    const p = db.prepare('SELECT * FROM politicas WHERE id = ? AND activa = 1').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Política no encontrada.' });
    const ya = db.prepare('SELECT folio FROM firmas WHERE politica_id = ? AND empleado_id = ?').get(p.id, req.empleado.id);
    if (ya) return res.status(409).json({ error: 'Ya firmaste esta política.', folio: ya.folio });

    const firma = req.files?.firma?.[0];
    const video = req.files?.video?.[0];
    if (!firma || firma.size < 500) return res.status(400).json({ error: 'Falta la firma.' });
    if (!video || video.size < 10000) return res.status(400).json({ error: 'Falta el video de aceptación.' });
    if (req.body.acepto !== 'si') return res.status(400).json({ error: 'Debes marcar la casilla de aceptación.' });

    const folio = `POL${p.id}-${req.empleado.numero}-${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9-]/gi, '');
    const base = `${p.id}_${req.empleado.id}_${Date.now()}`;
    const vt = (video.mimetype || '').toLowerCase();
    const ext = vt.includes('mp4') ? 'mp4' : vt.includes('quicktime') ? 'mov' : vt.includes('webm') ? 'webm' : 'mp4';
    const firmaArchivo = `${base}.png`;
    const videoArchivo = `${base}.${ext}`;
    fs.writeFileSync(path.join(DATA_DIR, 'firmas', firmaArchivo), firma.buffer);
    fs.writeFileSync(path.join(DATA_DIR, 'videos', videoArchivo), video.buffer);

    const frase = `Yo, ${req.empleado.nombre}, he leído la política "${p.titulo}" versión ${p.version} y firmo de acuerdo con ella.`;
    db.prepare(`INSERT INTO firmas (folio, politica_id, empleado_id, nombre_firmante, frase, firma_archivo,
        video_archivo, video_tipo, hash_politica, hash_firma, hash_video, segundos_lectura, ip, user_agent)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      folio, p.id, req.empleado.id, req.empleado.nombre, frase, firmaArchivo, videoArchivo, vt || null,
      p.hash, sha256(firma.buffer), sha256(video.buffer), parseInt(req.body.segundos_lectura, 10) || null,
      req.ip, limpiar(req.get('user-agent'), 400));
    res.json({ ok: true, folio });
  });

app.get('/api/constancia/:folio', requiereEmpleado, (req, res) => {
  const f = db.prepare(`SELECT f.folio, f.nombre_firmante, f.frase, f.hash_politica, f.hash_firma, f.hash_video,
      f.creada, f.segundos_lectura, e.numero, e.area, p.titulo, p.version, p.codigo
      FROM firmas f JOIN empleados e ON e.id = f.empleado_id JOIN politicas p ON p.id = f.politica_id
      WHERE f.folio = ? AND f.empleado_id = ?`).get(req.params.folio, req.empleado.id);
  if (!f) return res.status(404).json({ error: 'Constancia no encontrada.' });
  res.json(f);
});
app.get('/api/constancia/:folio/firma', requiereEmpleado, (req, res) => {
  const f = db.prepare('SELECT firma_archivo FROM firmas WHERE folio = ? AND empleado_id = ?').get(req.params.folio, req.empleado.id);
  if (!f) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'firmas', f.firma_archivo));
});

// ---------- ADMINISTRADOR ----------
app.post('/api/admin/ingresar', (req, res) => {
  const pass = String(req.body.password || '');
  const ok = ADMIN_PASSWORD && pass.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  const token = nuevoToken();
  db.prepare(`INSERT INTO sesiones (token, tipo) VALUES (?, 'admin')`).run(token);
  res.json({ token });
});

app.get('/api/admin/resumen', requiereAdmin, (_req, res) => {
  const empleados = db.prepare('SELECT COUNT(*) n FROM empleados').get().n;
  const politicas = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM firmas f WHERE f.politica_id = p.id) AS firmas
    FROM politicas p ORDER BY p.activa DESC, p.creada DESC`).all();
  const totalFirmas = db.prepare('SELECT COUNT(*) n FROM firmas').get().n;
  res.json({ empleados, totalFirmas, politicas });
});

app.post('/api/admin/politicas', requiereAdmin, subirPolitica.single('archivo'), (req, res) => {
  const titulo = limpiar(req.body.titulo, 200);
  const contenido = String(req.body.contenido || '').trim();
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio.' });
  if (!req.file && !contenido) return res.status(400).json({ error: 'Sube un PDF o escribe el texto de la política.' });
  const tipo = req.file ? 'pdf' : 'texto';
  const hash = req.file ? sha256File(req.file.path) : sha256(Buffer.from(contenido));
  const r = db.prepare(`INSERT INTO politicas (codigo, titulo, version, descripcion, area, tipo, archivo, contenido, hash)
                        VALUES (?,?,?,?,?,?,?,?,?)`).run(
    limpiar(req.body.codigo, 40), titulo, limpiar(req.body.version, 20) || '1.0', limpiar(req.body.descripcion, 600),
    limpiar(req.body.area, 80), tipo, req.file?.filename || null, tipo === 'texto' ? contenido : null, hash);
  // Si reemplaza a otra política, desactivar la anterior
  if (req.body.reemplaza) db.prepare('UPDATE politicas SET activa = 0 WHERE id = ?').run(req.body.reemplaza);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.patch('/api/admin/politicas/:id', requiereAdmin, (req, res) => {
  db.prepare('UPDATE politicas SET activa = ? WHERE id = ?').run(req.body.activa ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/politicas/:id/archivo', requiereAdmin, (req, res) => {
  const p = db.prepare(`SELECT archivo FROM politicas WHERE id = ? AND tipo = 'pdf'`).get(req.params.id);
  if (!p) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'politicas', p.archivo));
});

const SQL_FIRMAS = `SELECT f.id, f.folio, f.nombre_firmante, f.frase, f.creada, f.segundos_lectura, f.ip, f.user_agent,
    f.hash_politica, f.hash_firma, f.hash_video, f.video_tipo,
    e.numero, e.area, p.id AS politica_id, p.titulo, p.version, p.codigo
  FROM firmas f JOIN empleados e ON e.id = f.empleado_id JOIN politicas p ON p.id = f.politica_id`;

app.get('/api/admin/firmas', requiereAdmin, (req, res) => {
  const q = `%${limpiar(req.query.q, 80)}%`;
  const pid = req.query.politica || null;
  res.json(db.prepare(`${SQL_FIRMAS}
    WHERE (? IS NULL OR f.politica_id = ?) AND (e.nombre LIKE ? OR e.numero LIKE ? OR f.folio LIKE ?)
    ORDER BY f.creada DESC LIMIT 1000`).all(pid, pid, q, q, q));
});

app.get('/api/admin/firmas/:id/firma', requiereAdmin, (req, res) => {
  const f = db.prepare('SELECT firma_archivo FROM firmas WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'firmas', f.firma_archivo));
});
app.get('/api/admin/firmas/:id/video', requiereAdmin, (req, res) => {
  const f = db.prepare('SELECT video_archivo FROM firmas WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).end();
  res.sendFile(path.join(DATA_DIR, 'videos', f.video_archivo));
});

app.get('/api/admin/pendientes', requiereAdmin, (_req, res) => {
  res.json(db.prepare(`
    SELECT e.numero, e.nombre, e.area, p.id AS politica_id, p.titulo, p.version
    FROM empleados e CROSS JOIN politicas p
    WHERE p.activa = 1 AND NOT EXISTS (SELECT 1 FROM firmas f WHERE f.empleado_id = e.id AND f.politica_id = p.id)
    ORDER BY e.nombre, p.titulo`).all());
});

app.get('/api/admin/exportar.csv', requiereAdmin, (_req, res) => {
  const filas = db.prepare(`${SQL_FIRMAS} ORDER BY f.creada DESC`).all();
  const cols = ['folio', 'creada', 'numero', 'nombre_firmante', 'area', 'codigo', 'titulo', 'version',
    'segundos_lectura', 'ip', 'hash_politica', 'hash_firma', 'hash_video'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="firmas-politicas.csv"');
  res.send(csv);
});

app.get('/api/admin/qr', requiereAdmin, async (req, res) => {
  const url = limpiar(req.query.url, 300);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 260 });
  res.type('image/svg+xml').send(svg);
});

// ---------- errores ----------
app.use((err, _req, res, _next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande.' : 'Error en el servidor.';
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: msg });
});

app.listen(PORT, () => console.log(`✅ Portal de políticas en http://localhost:${PORT}  (admin: /admin.html)`));
