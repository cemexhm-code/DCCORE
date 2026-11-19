// Prepara las librerías del navegador dentro de public/vendor (Vercel sirve public/ desde su CDN).
// Ejecutar: npm run vendor   (solo es necesario si actualizas pdfjs-dist o @vercel/blob)
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const pdf = path.join(raiz, 'node_modules/pdfjs-dist/legacy/build');
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  fs.copyFileSync(path.join(pdf, f), path.join(raiz, 'public/vendor/pdfjs', f));
}
require('esbuild').buildSync({
  stdin: { contents: "export { upload } from '@vercel/blob/client';", resolveDir: raiz },
  bundle: true, format: 'esm', platform: 'browser', minify: true, target: 'es2020',
  outfile: path.join(raiz, 'public/vendor/blob-client.mjs'),
});
console.log('vendor listo');
