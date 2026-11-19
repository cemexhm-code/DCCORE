// Sube un archivo directo al almacenamiento.
// En Vercel usa Vercel Blob (subida directa desde el navegador, sin el límite de 4.5 MB).
// En local lo envía al propio servidor.
import { upload } from '/vendor/blob-client.mjs';

let modo;
async function obtenerModo() {
  if (!modo) modo = (await (await fetch('/api/almacen/modo')).json()).modo;
  return modo;
}

export async function subirArchivo(pathname, archivo, payload, alAvanzar) {
  if ((await obtenerModo()) === 'blob') {
    const r = await upload(pathname, archivo, {
      access: 'private',
      handleUploadUrl: '/api/almacen/subir',
      clientPayload: JSON.stringify(payload),
      contentType: archivo.type || undefined,
      multipart: archivo.size > 20 * 1024 * 1024,
      onUploadProgress: (e) => alAvanzar?.(e.percentage),
    });
    return r.pathname;
  }
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ pathname, payload: JSON.stringify(payload) });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/almacen/local?' + qs);
    xhr.upload.onprogress = (e) => e.lengthComputable && alAvanzar?.((e.loaded / e.total) * 100);
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
      xhr.status === 200 ? resolve(r.pathname) : reject(new Error(r.error || 'No se pudo subir el archivo.'));
    };
    xhr.onerror = () => reject(new Error('Sin conexión. Intenta de nuevo.'));
    xhr.send(archivo);
  });
}
