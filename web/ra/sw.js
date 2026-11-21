/*
 * sw.js — Permite usar la Realidad Aumentada sin internet.
 *
 * Guarda en el celular (Cache Storage de Chrome) lo que usan los visores y lo entrega cuando no hay conexión:
 *   - Páginas (.html), scripts propios (.js) y temas.json: primero la red (para recibir los cambios
 *     publicados en GitHub); si no hay internet, la copia guardada.
 *   - Librerías de internet con versión fija (A-Frame, AR.js, three.js, MediaPipe, model-viewer, Draco…):
 *     primero la copia; si no está, se descarga y se guarda.
 *   - Modelos .glb, moléculas .sdf, imágenes: se entrega la copia al instante y, si hay internet,
 *     se actualiza en segundo plano.
 * La página descargar.html llena esta misma copia de una vez, tema por tema o molécula por molécula.
 */
const CACHE = 'illari-ra-v1';
const TIEMPO_RED = 4000; // ms: si la red tarda más, se usa la copia

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Clave de una página o archivo propio: sin la parte "?tema=…"
const claveSinBusqueda = (url) => url.origin + url.pathname;

async function guardar(clave, respuesta) {
  if (!respuesta || !(respuesta.ok || respuesta.type === 'opaque')) return;
  try {
    const c = await caches.open(CACHE);
    await c.put(clave, respuesta);
  } catch (e) { /* sin espacio u otro problema: no se guarda */ }
}

function conTiempo(promesa, ms) {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error('tiempo')), ms);
    promesa.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); mal(e); });
  });
}

// Páginas y temas.json: red primero, copia si no hay internet
async function redPrimero(req, url) {
  const clave = claveSinBusqueda(url);
  try {
    const r = await conTiempo(fetch(req), TIEMPO_RED);
    if (r.ok) guardar(clave, r.clone());
    return r;
  } catch (e) {
    const copia = (await caches.match(clave)) || (await caches.match(req, { ignoreSearch: true }));
    if (copia) return copia;
    if (req.mode === 'navigate') {
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="font-family:sans-serif;background:#B8E3E9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px">' +
        '<div><h2>Sin internet</h2><p>Esta parte todavía no está descargada en el celular.<br>Conéctate a internet una vez y usa el botón <b>«Usar sin internet»</b>.</p></div>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    throw e;
  }
}

// Librerías con versión fija: copia primero
async function copiaPrimero(req) {
  const copia = await caches.match(req);
  if (copia) return copia;
  const r = await fetch(req);
  guardar(req, r.clone());
  return r;
}

// Modelos, moléculas e imágenes propias: copia al instante y actualización en segundo plano
async function copiaYActualiza(req, evento) {
  const copia = await caches.match(req);
  const red = fetch(req).then((r) => { guardar(req, r.clone()); return r; });
  if (copia) {
    evento.waitUntil(red.catch(() => {}));
    return copia;
  }
  return red;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (req.headers.has('range')) return; // fragmentos de video/audio: los maneja el navegador
  const propio = url.origin === self.location.origin;
  if (propio && (req.mode === 'navigate' || /\.(html|json|js)$/i.test(url.pathname) || url.pathname.endsWith('/'))) {
    e.respondWith(redPrimero(req, url));
  } else if (propio) {
    e.respondWith(copiaYActualiza(req, e));
  } else {
    e.respondWith(copiaPrimero(req));
  }
});
