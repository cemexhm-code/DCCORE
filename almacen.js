// Almacenamiento de archivos (PDFs, firmas y videos)
// - En Vercel: Vercel Blob PRIVADO (variable BLOB_READ_WRITE_TOKEN, se crea sola al conectar el Blob store).
// - Sin esa variable (pruebas locales / servidor propio): carpeta local DATA_DIR.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const blob = require('@vercel/blob');

const MODO = process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

function rutaLocal(pathname) {
  const p = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  return path.join(DATA_DIR, p);
}

async function guardarLocal(pathname, buffer) {
  const destino = rutaLocal(pathname);
  if (fs.existsSync(destino)) throw new Error('El archivo ya existe.');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buffer);
}

// Devuelve { hash, size, contentType } o null si el archivo no existe
async function inspeccionar(pathname) {
  const h = crypto.createHash('sha256');
  if (MODO === 'local') {
    const p = rutaLocal(pathname);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return { hash: h.update(buf).digest('hex'), size: buf.length, contentType: null };
  }
  const r = await blob.get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  let size = 0;
  for await (const trozo of Readable.fromWeb(r.stream)) { h.update(trozo); size += trozo.length; }
  return { hash: h.digest('hex'), size, contentType: r.blob.contentType };
}

// Envía el archivo directamente a través del servidor (para PDFs e imágenes de firma)
async function enviar(res, pathname, tipo) {
  if (MODO === 'local') {
    const p = rutaLocal(pathname);
    if (!fs.existsSync(p)) return res.status(404).end();
    return res.sendFile(p);
  }
  const r = await blob.get(pathname, { access: 'private' });
  if (!r || r.statusCode !== 200) return res.status(404).end();
  res.setHeader('Content-Type', tipo || r.blob.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  Readable.fromWeb(r.stream).pipe(res);
}

// Redirige a un enlace temporal (10 min) — para videos, que pueden pesar más de lo que deja pasar Vercel
async function redirigir(res, pathname) {
  if (MODO === 'local') return enviar(res, pathname);
  const validUntil = Date.now() + 10 * 60 * 1000;
  const token = await blob.issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await blob.presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil });
  res.redirect(302, presignedUrl);
}

module.exports = { MODO, guardarLocal, inspeccionar, enviar, redirigir };
