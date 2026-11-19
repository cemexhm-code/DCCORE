import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const token = sesion.get('emp_token');
if (!token) location.replace('/');
const id = new URLSearchParams(location.search).get('id');

let politica, empleado, frase;
let inicioLectura = Date.now();
let segundosLectura = 0;
let firmaBlob = null;
let videoBlob = null;

// ---------------- navegación entre pasos ----------------
function irPaso(n) {
  for (let i = 1; i <= 4; i++) {
    $('#paso-' + i).classList.toggle('oculto', i !== n);
    const d = $(`.pasos [data-paso="${i}"]`);
    d.classList.toggle('activo', i === n);
    d.classList.toggle('hecho', i < n);
  }
  if (n === 2) ajustarLienzo();
  if (n !== 3) apagarCamara();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------- carga ----------------
async function cargar() {
  nombreEmpresa();
  try {
    [politica, empleado] = await Promise.all([
      api('/api/politicas/' + id, { token }),
      api('/api/empleado/yo', { token }),
    ]);
  } catch (e) {
    if (e.status === 401) { sesion.del('emp_token'); return location.replace('/'); }
    $('#titulo').textContent = e.message; return;
  }
  if (politica.firma) return location.replace('/constancia.html?folio=' + encodeURIComponent(politica.firma.folio));

  document.title = politica.titulo;
  $('#titulo').textContent = politica.titulo;
  $('#meta').textContent = [politica.codigo, 'Versión ' + politica.version, politica.area].filter(Boolean).join(' · ');
  if (politica.descripcion) { $('#descripcion').textContent = politica.descripcion; $('#descripcion').classList.remove('oculto'); }

  frase = `Yo, ${empleado.nombre}, he leído la política "${politica.titulo}" versión ${politica.version} y firmo de acuerdo con ella.`;
  $('#frase').textContent = frase;
  $('#guion').textContent = frase;
  $('#texto-acepto').textContent = `Declaro que he leído y comprendido la política "${politica.titulo}" (versión ${politica.version}) y acepto cumplirla. Mi firma y mi video tienen validez como constancia de aceptación.`;

  if (politica.tipo === 'pdf') await mostrarPDF();
  else {
    $('#lector').innerHTML = '';
    const div = document.createElement('div');
    div.className = 'texto';
    div.textContent = politica.contenido;
    $('#lector').appendChild(div);
  }
  inicioLectura = Date.now();
  vigilarFinal();
}

async function mostrarPDF() {
  const r = await fetch(`/api/politicas/${id}/archivo`, { headers: { Authorization: 'Bearer ' + token } });
  const datos = await r.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: datos }).promise;
  const cont = $('#lector');
  cont.innerHTML = '';
  const ancho = cont.clientWidth - 8;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i);
    const v1 = pagina.getViewport({ scale: 1 });
    const escala = (ancho / v1.width) * dpr;
    const vp = pagina.getViewport({ scale: escala });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    cont.appendChild(c);
    await pagina.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}

function vigilarFinal() {
  const habilitar = () => {
    $('#btn-leido').disabled = false;
    $('#aviso-leer').textContent = '✔ Llegaste al final del documento.';
  };
  const obs = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { habilitar(); obs.disconnect(); }
  });
  obs.observe($('#fin-documento'));
}

$('#btn-leido').addEventListener('click', () => {
  segundosLectura = Math.round((Date.now() - inicioLectura) / 1000);
  irPaso(2);
});

// ---------------- firma ----------------
const lienzo = $('#lienzo');
const ctx = lienzo.getContext('2d');
let dibujando = false, hayTrazo = false, ultimo = null;

function ajustarLienzo() {
  const r = lienzo.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (lienzo.width === Math.round(r.width * dpr) && lienzo.height === Math.round(r.height * dpr)) return;
  lienzo.width = Math.round(r.width * dpr);
  lienzo.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2545';
  borrarFirma();
}
function borrarFirma() {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, lienzo.width, lienzo.height); ctx.restore();
  hayTrazo = false; $('#btn-firma-ok').disabled = true; $('#ph-firma').classList.remove('oculto');
}
const punto = (e) => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
lienzo.addEventListener('pointerdown', (e) => {
  e.preventDefault(); lienzo.setPointerCapture(e.pointerId);
  dibujando = true; ultimo = punto(e);
  ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#0b2545'; ctx.fill();
});
lienzo.addEventListener('pointermove', (e) => {
  if (!dibujando) return;
  e.preventDefault();
  const p = punto(e);
  ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  ultimo = p;
  if (!hayTrazo) { hayTrazo = true; $('#btn-firma-ok').disabled = false; $('#ph-firma').classList.add('oculto'); }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => lienzo.addEventListener(ev, () => (dibujando = false)));
window.addEventListener('resize', () => { if (!$('#paso-2').classList.contains('oculto') && !hayTrazo) ajustarLienzo(); });

$('#btn-borrar').addEventListener('click', borrarFirma);
$('#btn-firma-ok').addEventListener('click', () => {
  // Exportar con fondo blanco
  const out = document.createElement('canvas');
  out.width = lienzo.width; out.height = lienzo.height;
  const o = out.getContext('2d');
  o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(lienzo, 0, 0);
  out.toBlob((b) => { firmaBlob = b; $('#firma-preview').src = URL.createObjectURL(b); irPaso(3); }, 'image/png');
});

// ---------------- video ----------------
let flujo = null, grabadora = null, trozos = [], reloj = null, segundos = 0;
const MAX_SEG = 60, MIN_SEG = 4;

function tipoVideo() {
  if (!window.MediaRecorder) return null;
  const opciones = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opciones.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

$('#btn-abrir-camara').addEventListener('click', async () => {
  $('#err-video').textContent = '';
  if (!navigator.mediaDevices?.getUserMedia || tipoVideo() === null) {
    $('#err-video').textContent = 'Tu navegador no permite grabar aquí. Usa el botón "Grabar con la cámara del teléfono" o abre el enlace en Chrome o Safari.';
    return;
  }
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true,
    });
    $('#vista-previa').srcObject = flujo;
    $('#zona-inicio').classList.add('oculto');
    $('#zona-revision').classList.add('oculto');
    $('#zona-camara').classList.remove('oculto');
  } catch (e) {
    $('#err-video').textContent = 'No se pudo abrir la cámara o el micrófono. Revisa los permisos del navegador, o usa el botón "Grabar con la cámara del teléfono".';
  }
});

$('#btn-grabar').addEventListener('click', () => {
  trozos = []; segundos = 0;
  const tipo = tipoVideo();
  try {
    grabadora = new MediaRecorder(flujo, { ...(tipo ? { mimeType: tipo } : {}), videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
  } catch { grabadora = new MediaRecorder(flujo); }
  grabadora.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  grabadora.onstop = () => {
    clearInterval(reloj);
    $('#rec').classList.add('oculto');
    if (segundos < MIN_SEG) {
      $('#err-video').textContent = `El video es muy corto. Lee la frase completa (mínimo ${MIN_SEG} segundos).`;
      $('#btn-grabar').classList.remove('oculto'); $('#btn-detener').classList.add('oculto');
      return;
    }
    const b = new Blob(trozos, { type: grabadora.mimeType || tipo || 'video/webm' });
    mostrarRevision(b);
  };
  grabadora.start(1000);
  $('#err-video').textContent = '';
  $('#rec').textContent = '0:00'; $('#rec').classList.remove('oculto');
  $('#btn-grabar').classList.add('oculto'); $('#btn-detener').classList.remove('oculto');
  reloj = setInterval(() => {
    segundos++;
    $('#rec').textContent = `0:${String(segundos).padStart(2, '0')}`;
    if (segundos >= MAX_SEG) grabadora.stop();
  }, 1000);
});

$('#btn-detener').addEventListener('click', () => grabadora?.state === 'recording' && grabadora.stop());

function mostrarRevision(b) {
  videoBlob = b;
  apagarCamara();
  $('#zona-camara').classList.add('oculto');
  $('#zona-inicio').classList.add('oculto');
  $('#zona-revision').classList.remove('oculto');
  const v = $('#reproduccion');
  v.src = URL.createObjectURL(b);
  $('#btn-grabar').classList.remove('oculto'); $('#btn-detener').classList.add('oculto');
}

$('#video-archivo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 140 * 1024 * 1024) { $('#err-video').textContent = 'El video es demasiado grande. Graba uno más corto (menos de 1 minuto).'; return; }
  $('#err-video').textContent = '';
  mostrarRevision(f);
});

$('#btn-regrabar').addEventListener('click', () => {
  videoBlob = null;
  $('#zona-revision').classList.add('oculto');
  $('#zona-inicio').classList.remove('oculto');
  $('#video-archivo').value = '';
});

$('#btn-video-ok').addEventListener('click', () => irPaso(4));

function apagarCamara() {
  if (grabadora?.state === 'recording') grabadora.stop();
  flujo?.getTracks().forEach((t) => t.stop());
  flujo = null;
}

// ---------------- envío ----------------
$('#acepto').addEventListener('change', (e) => ($('#btn-enviar').disabled = !e.target.checked));
$('#btn-atras').addEventListener('click', () => irPaso(3));

$('#btn-enviar').addEventListener('click', () => {
  if (!firmaBlob || !videoBlob) { $('#err-envio').textContent = 'Falta la firma o el video.'; return; }
  const fd = new FormData();
  fd.append('acepto', 'si');
  fd.append('segundos_lectura', String(segundosLectura));
  fd.append('firma', firmaBlob, 'firma.png');
  const ext = (videoBlob.type || '').includes('mp4') ? 'mp4' : (videoBlob.type || '').includes('quicktime') ? 'mov' : 'webm';
  fd.append('video', videoBlob, 'video.' + ext);

  const btn = $('#btn-enviar');
  btn.disabled = true; btn.textContent = 'Enviando…';
  $('#err-envio').textContent = '';
  const prog = $('#prog-envio'); prog.classList.remove('oculto');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/politicas/${id}/firmar`);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) prog.firstElementChild.style.width = (e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 200 || (xhr.status === 409 && r.folio)) {
      location.replace('/constancia.html?nuevo=1&folio=' + encodeURIComponent(r.folio));
    } else {
      $('#err-envio').textContent = r.error || 'No se pudo enviar. Revisa tu conexión e intenta de nuevo.';
      btn.disabled = false; btn.textContent = 'Firmar y enviar';
    }
  };
  xhr.onerror = () => {
    $('#err-envio').textContent = 'Sin conexión. Intenta de nuevo.';
    btn.disabled = false; btn.textContent = 'Firmar y enviar';
  };
  xhr.send(fd);
});

cargar();
