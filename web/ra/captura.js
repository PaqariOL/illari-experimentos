/*
 * captura.js — Foto y video para los visores de Illari (RA con marcadores y «Con tus manos").
 *
 * Cada página da una función componer(g, W, H) que dibuja el cuadro completo (cámara + 3D + logo…)
 * en un lienzo 2D, en píxeles de pantalla (CSS). Este archivo se encarga del resto:
 *   - IllariCaptura.foto(componer, nombre)      → JPG en Descargas
 *   - IllariCaptura.grabadora({...})            → video (MP4 si el navegador puede; si no, WebM)
 *                                                 con el micrófono, máximo 60 s, en Descargas
 */
(function () {
  const MAX_SEGUNDOS = 60;
  const LADO_MAX_VIDEO = 1280; // 720p
  const CUADROS = 30;

  function descargar(archivo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(archivo);
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  function lienzo(escala) {
    const W = window.innerWidth, H = window.innerHeight;
    const c = document.createElement('canvas');
    // dimensiones pares (los códecs de video lo necesitan)
    c.width = Math.round((W * escala) / 2) * 2;
    c.height = Math.round((H * escala) / 2) * 2;
    return { c, g: c.getContext('2d'), W, H, escala: c.width / W };
  }

  async function foto(componer, nombre) {
    const { c, g, W, H, escala } = lienzo(Math.min(window.devicePixelRatio || 1, 2));
    g.setTransform(escala, 0, 0, escala, 0, 0);
    componer(g, W, H);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    descargar(new File([blob], nombre + '-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
  }

  // Formatos en orden de preferencia: MP4 con H.264 (se abre en cualquier celular y en WhatsApp);
  // si el navegador no puede, WebM (Android lo reproduce). Un MP4 "genérico" va al final, porque algunos
  // navegadores lo graban con VP9 por dentro y no todos los celulares lo abren.
  function formatoVideo() {
    const opciones = [
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
      ['video/mp4;codecs=avc1.42E01E,opus', 'mp4'],
      ['video/mp4;codecs=avc1,mp4a', 'mp4'],
      ['video/webm;codecs=vp8,opus', 'webm'],
      ['video/webm;codecs=vp9,opus', 'webm'],
      ['video/webm', 'webm'],
      ['video/mp4', 'mp4'],
    ];
    if (typeof MediaRecorder === 'undefined') return null;
    return opciones.find(([t]) => MediaRecorder.isTypeSupported(t)) || null;
  }

  /**
   * opciones:
   *   componer(g, W, H)   dibuja un cuadro
   *   nombre()            nombre base del archivo
   *   alCambiar(estado)   'grabando' | 'detenido'; recibe también los segundos: alCambiar('grabando', s)
   *   avisar(texto)       mensajes para el usuario
   */
  function grabadora(op) {
    let rec = null, audio = null, partes = [], raf = 0, reloj = 0, inicio = 0, formato = null;

    async function iniciar() {
      if (rec) return;
      formato = formatoVideo();
      if (!formato) { op.avisar('Este navegador no puede grabar video'); return; }
      const W0 = window.innerWidth, H0 = window.innerHeight;
      const escala = Math.min(window.devicePixelRatio || 1, LADO_MAX_VIDEO / Math.max(W0, H0));
      const { c, g, W, H, escala: k } = lienzo(escala);
      const dibujar = () => {
        g.setTransform(k, 0, 0, k, 0, 0);
        try { componer(); } catch (e) { /* un cuadro fallido no detiene la grabación */ }
        raf = requestAnimationFrame(dibujar);
      };
      const componer = () => op.componer(g, W, H);
      componer();
      const flujo = c.captureStream(CUADROS);
      // micrófono (si no hay permiso, se graba sin sonido)
      try {
        audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        audio.getAudioTracks().forEach((t) => flujo.addTrack(t));
      } catch (e) {
        audio = null;
        op.avisar('Grabando sin sonido (sin permiso de micrófono)');
      }
      partes = [];
      try {
        rec = new MediaRecorder(flujo, { mimeType: formato[0], videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 96_000 });
      } catch (e) {
        detenerAudio();
        op.avisar('No se pudo iniciar la grabación');
        return;
      }
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) partes.push(ev.data); };
      rec.onstop = () => {
        cancelAnimationFrame(raf);
        clearInterval(reloj);
        detenerAudio();
        flujo.getTracks().forEach((t) => t.stop());
        const tipo = formato[0].split(';')[0];
        const blob = new Blob(partes, { type: tipo });
        rec = null;
        op.alCambiar('detenido', 0);
        if (!blob.size) { op.avisar('No se pudo guardar el video'); return; }
        descargar(new File([blob], op.nombre() + '-' + Date.now() + '.' + formato[1], { type: tipo }));
        op.avisar('Video guardado en Descargas');
      };
      rec.start(1000);
      inicio = performance.now();
      raf = requestAnimationFrame(dibujar);
      op.alCambiar('grabando', 0);
      reloj = setInterval(() => {
        const s = Math.floor((performance.now() - inicio) / 1000);
        op.alCambiar('grabando', s);
        if (s >= (window.__illariMaxSegundos || MAX_SEGUNDOS)) detener();
      }, 250);
    }

    function detenerAudio() {
      if (audio) audio.getTracks().forEach((t) => t.stop());
      audio = null;
    }

    function detener() {
      if (rec && rec.state !== 'inactive') rec.stop();
    }

    return {
      alternar: () => (rec ? detener() : iniciar()),
      grabando: () => !!rec,
      detener,
      formato: () => (formatoVideo() || [''])[0],
    };
  }

  // Ayuda para dibujar el video de la cámara igual que en pantalla (object-fit: cover, con espejo opcional)
  function dibujarVideoCubriendo(g, video, W, H, espejo) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const esc = Math.max(W / vw, H / vh);
    const w = vw * esc, h = vh * esc;
    g.save();
    if (espejo) { g.translate(W, 0); g.scale(-1, 1); }
    g.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
    g.restore();
    return true;
  }

  window.IllariCaptura = { foto, grabadora, descargar, dibujarVideoCubriendo, MAX_SEGUNDOS };
})();
