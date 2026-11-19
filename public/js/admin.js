import { subirArchivo } from '/js/subir.js';

const TK = 'admin_token';
let token = sesion.get(TK);
let politicas = [];
let firmas = [];

async function iniciar() {
  nombreEmpresa();
  if (!token) return mostrarIngreso();
  try { await cargarResumen(); } catch { sesion.del(TK); token = null; return mostrarIngreso(); }
  $('#vista-ingreso').classList.add('oculto');
  $('#vista-panel').classList.remove('oculto');
  $('#salir').classList.remove('oculto');
  cargarPendientes();
}
function mostrarIngreso() {
  $('#vista-ingreso').classList.remove('oculto');
  $('#vista-panel').classList.add('oculto');
  $('#salir').classList.add('oculto');
}

$('#form-ingreso').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/admin/ingresar', { method: 'POST', body: { password: $('#pass').value } });
    token = r.token; sesion.set(TK, token); iniciar();
  } catch (err) { $('#err-ingreso').textContent = err.message; }
});
$('#salir').addEventListener('click', () => { sesion.del(TK); token = null; mostrarIngreso(); });

// ---------- pestañas ----------
$$('.pestanas button').forEach((b) => b.addEventListener('click', () => {
  $$('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('oculto', t.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'firmas') cargarFirmas();
  if (b.dataset.tab === 'pendientes') cargarPendientes();
  if (b.dataset.tab === 'compartir') mostrarCompartir();
}));

// ---------- resumen / políticas ----------
async function cargarResumen() {
  const r = await api('/api/admin/resumen', { token });
  politicas = r.politicas;
  const activas = politicas.filter((p) => p.activa);
  $('#k-pol').textContent = activas.length;
  $('#k-emp').textContent = r.empleados;
  $('#k-firmas').textContent = r.totalFirmas;

  $('#tb-politicas').innerHTML = politicas.length ? politicas.map((p) => {
    const pct = r.empleados ? Math.round(p.firmas / r.empleados * 100) : 0;
    return `<tr>
      <td><b>${esc(p.titulo)}</b><br><span class="sub">${[p.codigo, p.area, p.tipo === 'pdf' ? 'PDF' : 'Texto'].filter(Boolean).map(esc).join(' · ')} · ${fecha(p.creada, false)}</span></td>
      <td>${esc(p.version)}</td>
      <td style="min-width:120px">${p.firmas} / ${r.empleados}<div class="progreso"><div style="width:${p.activa ? pct : 0}%"></div></div></td>
      <td>${p.activa ? '<span class="etq ok">Activa</span>' : '<span class="etq gris">Inactiva</span>'}</td>
      <td style="white-space:nowrap">
        ${p.tipo === 'pdf' ? `<button class="btn sec chico" data-ver="${p.id}">Ver PDF</button>` : ''}
        <button class="btn sec chico" data-act="${p.id}" data-val="${p.activa ? 0 : 1}">${p.activa ? 'Desactivar' : 'Activar'}</button>
      </td></tr>`;
  }).join('') : '<tr><td colspan="5" class="sub">Aún no hay políticas. Usa “+ Subir política”.</td></tr>';

  const opts = activas.map((p) => `<option value="${p.id}">${esc(p.titulo)} (v${esc(p.version)})</option>`).join('');
  $('#sel-reemplaza').innerHTML = '<option value="">— Es una política nueva —</option>' + opts;
  const sel = $('#filtro-politica').value;
  $('#filtro-politica').innerHTML = '<option value="">Todas las políticas</option>' +
    politicas.map((p) => `<option value="${p.id}">${esc(p.titulo)} (v${esc(p.version)})</option>`).join('');
  $('#filtro-politica').value = sel;
}

$('#tb-politicas').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]');
  const ver = e.target.closest('[data-ver]');
  if (act) {
    await api('/api/admin/politicas/' + act.dataset.act, { method: 'PATCH', token, body: { activa: act.dataset.val === '1' } });
    await cargarResumen(); cargarPendientes();
  }
  if (ver) abrirArchivo(`/api/admin/politicas/${ver.dataset.ver}/archivo`);
});

function abrirArchivo(url) {
  window.open(url + '?t=' + encodeURIComponent(token), '_blank', 'noopener');
}

$('#form-politica').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#err-politica').textContent = '';
  const fd = new FormData(e.target);
  const pdf = fd.get('archivo');
  if (fd.get('reemplaza') && !confirm('La política anterior se desactivará y los empleados deberán firmar esta nueva versión. ¿Continuar?')) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Publicando…';
  try {
    const datos = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'archivo'));
    if (pdf?.size) {
      if (pdf.type && pdf.type !== 'application/pdf') throw new Error('El archivo debe ser PDF.');
      const nombre = `politicas/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      const pdfTipado = pdf.type ? pdf : new Blob([pdf], { type: 'application/pdf' });
      datos.archivo = await subirArchivo(nombre, pdfTipado, { token, tipo: 'politica' },
        (p) => (btn.textContent = `Subiendo PDF… ${Math.round(p)}%`));
    }
    await api('/api/admin/politicas', { method: 'POST', token, body: datos });
    e.target.reset();
    await cargarResumen(); cargarPendientes();
    $('[data-tab="politicas"]').click();
  } catch (err) { $('#err-politica').textContent = err.message; }
  btn.disabled = false; btn.textContent = 'Publicar política';
});

// ---------- firmas ----------
let tBuscar;
$('#buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargarFirmas, 300); });
$('#filtro-politica').addEventListener('change', cargarFirmas);

async function cargarFirmas() {
  const qs = new URLSearchParams({ q: $('#buscar').value });
  if ($('#filtro-politica').value) qs.set('politica', $('#filtro-politica').value);
  firmas = await api('/api/admin/firmas?' + qs, { token });
  $('#tb-firmas').innerHTML = firmas.length ? firmas.map((f, i) => `<tr>
    <td style="white-space:nowrap">${fecha(f.creada)}</td>
    <td><b>${esc(f.nombre_firmante)}</b><br><span class="sub">No. ${esc(f.numero)}${f.area ? ' · ' + esc(f.area) : ''}</span></td>
    <td>${esc(f.titulo)}<br><span class="sub">v${esc(f.version)}</span></td>
    <td>${f.segundos_lectura != null ? Math.round(f.segundos_lectura / 60 * 10) / 10 + ' min' : '–'}</td>
    <td><button class="btn chico" data-i="${i}">Ver evidencia</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="sub">Sin firmas.</td></tr>';
}

$('#tb-firmas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) verDetalle(firmas[+b.dataset.i]);
});

function verDetalle(f) {
  const q = 't=' + encodeURIComponent(token);
  $('#detalle-cuerpo').innerHTML = `
    <h3>${esc(f.nombre_firmante)}</h3>
    <p class="sub">${esc(f.titulo)} · v${esc(f.version)} · ${fecha(f.creada)}</p>
    <p class="frase">${esc(f.frase)}</p>
    <video controls playsinline preload="metadata" src="/api/admin/firmas/${f.id}/video?${q}"></video>
    <img src="/api/admin/firmas/${f.id}/firma?${q}" alt="Firma" style="max-width:280px;width:100%;border-bottom:1px solid #333;display:block;margin:14px 0 4px">
    <div class="constancia" style="margin-top:14px"><dl>
      <dt>Folio</dt><dd>${esc(f.folio)}</dd>
      <dt>No. empleado</dt><dd>${esc(f.numero)}</dd>
      <dt>Tiempo de lectura</dt><dd>${f.segundos_lectura ?? '–'} seg</dd>
      <dt>IP</dt><dd>${esc(f.ip)}</dd>
      <dt>Dispositivo</dt><dd><small>${esc(f.user_agent)}</small></dd>
      <dt>Huella política</dt><dd><small>${esc(f.hash_politica)}</small></dd>
      <dt>Huella firma</dt><dd><small>${esc(f.hash_firma)}</small></dd>
      <dt>Huella video</dt><dd><small>${esc(f.hash_video)}</small></dd>
    </dl></div>
    <div class="fila-btn">
      <a class="btn sec" href="/api/admin/firmas/${f.id}/video?${q}" download>Descargar video</a>
      <button class="btn" onclick="this.closest('dialog').close()">Cerrar</button>
    </div>`;
  $('#detalle').showModal();
}
$('#detalle').addEventListener('close', () => { const v = $('#detalle video'); if (v) v.pause(); });

$('#btn-csv').addEventListener('click', async () => {
  const r = await fetch('/api/admin/exportar.csv', { headers: { Authorization: 'Bearer ' + token } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = 'firmas-politicas.csv';
  a.click();
});

// ---------- pendientes ----------
async function cargarPendientes() {
  const p = await api('/api/admin/pendientes', { token });
  $('#k-pend').textContent = p.length;
  $('#tb-pendientes').innerHTML = p.length ? p.map((x) => `<tr>
    <td>${esc(x.numero)}</td><td>${esc(x.nombre)}</td><td>${esc(x.area || '')}</td>
    <td>${esc(x.titulo)} <span class="sub">v${esc(x.version)}</span></td></tr>`).join('')
    : '<tr><td colspan="4" class="sub">¡Nadie tiene pendientes! 🎉</td></tr>';
}

// ---------- compartir ----------
async function mostrarCompartir() {
  const url = location.origin + '/';
  $('#enlace').textContent = url;
  $('#btn-wa').href = 'https://wa.me/?text=' + encodeURIComponent('Por favor lee y firma las políticas de la empresa aquí: ' + url);
  try {
    const r = await fetch('/api/admin/qr?' + new URLSearchParams({ url, t: token }));
    $('#qr').innerHTML = await r.text();
  } catch {}
}
$('#btn-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#enlace').textContent); $('#btn-copiar').textContent = '¡Copiado!'; } catch {}
});

iniciar();
