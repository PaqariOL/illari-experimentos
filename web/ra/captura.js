/*
 * captura.js — Foto y video para los visores de Illari (RA con marcadores y «Con tus manos»).
 *
 * Cada página da una función componer(g, W, H) que dibuja el cuadro completo (cámara + 3D + logo…)
 * en un lienzo 2D, en píxeles de pantalla (CSS). Este archivo se encarga del resto:
 *   - IllariCaptura.foto(componer, nombre)      → JPG en Descargas
 *   - IllariCaptura.grabadora({...})            → video con el micrófono, máximo 60 s, en Descargas
 *
 * Video: se graba como MP4 (H.264 + AAC, u Opus si el celular no tiene AAC), el formato que aceptan
 * WhatsApp, Instagram, TikTok y Facebook. Se codifica con WebCodecs y se empaqueta con mp4-muxer.
 * Si el navegador no puede, se usa MediaRecorder (MP4 si puede; si no, WebM).
 */
(function () {
  const MAX_SEGUNDOS = 60;
  const LADO_MAX_VIDEO = 1280; // 720p
  const CUADROS = 30;
  const BITRATE_VIDEO = 3_000_000;
  const BITRATE_AUDIO = 96_000;
  const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js';
  const VERSION = '2026-11-24';
  // Tamaños que se prueban para el MP4 (lado largo). Muchos celulares solo codifican H.264 hasta
  // 1920×1088 en horizontal: un video vertical de 1280 de alto puede no estar permitido.
  const LADOS_MP4 = [1280, 1088, 960, 720, 640];
  const CODECS_H264 = ['avc1.42001f', 'avc1.4d001f', 'avc1.640028', 'avc1.42002a', 'avc1.4d0028'];
  const pasoDe16 = (v) => Math.max(16, Math.round(v / 16) * 16);

  // ---------------------------------------------------------------- utilidades
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

  // mp4-muxer se carga una sola vez (14 KB), en segundo plano
  let cargaMuxer = null;
  function cargarMuxer() {
    if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
    if (!cargaMuxer) {
      cargaMuxer = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = MP4_MUXER;
        s.onload = () => (window.Mp4Muxer ? ok(window.Mp4Muxer) : mal(new Error('mp4-muxer')));
        s.onerror = () => { cargaMuxer = null; mal(new Error('mp4-muxer')); };
        document.head.appendChild(s);
      });
    }
    return cargaMuxer;
  }

  // ¿Puede este navegador codificar H.264 con WebCodecs? Devuelve la configuración o null.
  async function configuracionH264(width, height) {
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) return null;
    for (const codec of ['avc1.42001f', 'avc1.4d001f', 'avc1.42002a', 'avc1.4d0028', 'avc1.640028']) {
      const cfg = { codec, width, height, bitrate: BITRATE_VIDEO, framerate: CUADROS, latencyMode: 'realtime', avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return r.config || cfg;
      } catch (e) { /* se prueba el siguiente */ }
    }
    return null;
  }

  // Busca un tamaño que el codificador H.264 del celular acepte. Primero vertical (como la pantalla);
  // si no, el mismo video acostado y marcado para que el reproductor lo gire (rotación 90°).
  async function planMP4(W, H) {
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) return null;
    const largo = Math.max(W, H);
    const intentos = [];
    for (const girar of [false, true]) {
      for (const lado of LADOS_MP4) {
        const k = Math.min(window.devicePixelRatio || 1, lado / largo);
        let w = pasoDe16(W * k), h = pasoDe16(H * k);
        if (girar) { if (w === h) continue; [w, h] = [h, w]; }
        const clave = w + 'x' + h;
        if (intentos.includes(clave)) continue;
        intentos.push(clave);
        const vcfg = await configuracionH264(w, h);
        if (vcfg) return { vcfg, w, h, girar };
      }
    }
    return null;
  }

  async function configuracionAudio(sampleRate, numberOfChannels) {
    if (!('AudioEncoder' in window)) return null;
    for (const [codec, nombre] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate, numberOfChannels, bitrate: BITRATE_AUDIO };
      try {
        const r = await AudioEncoder.isConfigSupported(cfg);
        if (r.supported) return { cfg: r.config || cfg, nombre };
      } catch (e) { /* se prueba el siguiente */ }
    }
    return null;
  }

  // Formatos de MediaRecorder (respaldo): MP4 con H.264; si no, WebM; un MP4 "genérico" al final
  // (algunos navegadores lo graban con VP9 por dentro y no todos los celulares lo abren).
  function formatoMediaRecorder() {
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

  async function pedirMicrofono(op) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (e) {
      op.avisar('Grabando sin sonido (sin permiso de micrófono)');
      return null;
    }
  }

  // ---------------------------------------------------------------- grabadora
  /**
   * opciones:
   *   componer(g, W, H)   dibuja un cuadro
   *   nombre()            nombre base del archivo
   *   alCambiar(estado, s) 'grabando' (con los segundos) | 'guardando' | 'detenido'
   *   avisar(texto)       mensajes para el usuario
   */
  function grabadora(op) {
    let sesion = null; // grabación en curso
    cargarMuxer().catch(() => {}); // se adelanta la descarga del empaquetador

    function relojes(alDetener) {
      const inicio = performance.now();
      op.alCambiar('grabando', 0);
      const id = setInterval(() => {
        const s = Math.floor((performance.now() - inicio) / 1000);
        op.alCambiar('grabando', s);
        if (s >= (window.__illariMaxSegundos || MAX_SEGUNDOS)) alDetener();
      }, 250);
      return { inicio, parar: () => clearInterval(id) };
    }

    function guardar(blob, extension) {
      op.alCambiar('detenido', 0);
      if (!blob || !blob.size) { op.avisar('No se pudo guardar el video'); return; }
      descargar(new File([blob], op.nombre() + '-' + Date.now() + '.' + extension, { type: blob.type }));
      op.avisar('Video guardado en Descargas');
    }

    // ---------- Opción principal: WebCodecs + mp4-muxer → MP4 real (H.264 + AAC/Opus)
    async function iniciarMP4(plan, Mp4Muxer) {
      const W = window.innerWidth, H = window.innerHeight;
      const { vcfg, girar } = plan;
      // c = lienzo que se codifica; p = lienzo vertical donde se dibuja la escena (el mismo si no se gira)
      const c = document.createElement('canvas');
      c.width = plan.w; c.height = plan.h;
      const p = girar ? document.createElement('canvas') : c;
      if (girar) { p.width = plan.h; p.height = plan.w; }
      const g = p.getContext('2d'), gc = c.getContext('2d');
      const kx = p.width / W, ky = p.height / H;
      const audio = await pedirMicrofono(op);
      let lector = null, primerAudio = null, acfg = null;
      if (audio && 'MediaStreamTrackProcessor' in window) {
        try {
          lector = new MediaStreamTrackProcessor({ track: audio.getAudioTracks()[0] }).readable.getReader();
          primerAudio = (await lector.read()).value || null; // para saber la frecuencia y los canales reales
          if (primerAudio) acfg = await configuracionAudio(primerAudio.sampleRate, primerAudio.numberOfChannels);
        } catch (e) { acfg = null; }
      }
      if (audio && !acfg) {
        if (primerAudio) primerAudio.close();
        try { lector && lector.cancel(); } catch (e) {}
        audio.getTracks().forEach((t) => t.stop());
        lector = null;
        op.avisar('Grabando sin sonido');
      }

      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: c.width, height: c.height, frameRate: CUADROS, rotation: girar ? 90 : 0 },
        audio: acfg ? { codec: acfg.nombre, sampleRate: acfg.cfg.sampleRate, numberOfChannels: acfg.cfg.numberOfChannels } : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let fallo = null;
      const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { fallo = e; detener(); } });
      venc.configure(vcfg);
      let aenc = null;
      if (acfg) {
        aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: () => { aenc = null; } });
        aenc.configure(acfg.cfg);
      }

      // audio: se lee y codifica mientras dure la grabación
      let leyendo = !!(lector && aenc);
      if (leyendo) {
        (async () => {
          let d = primerAudio;
          while (leyendo && d) {
            try { if (aenc && aenc.state === 'configured') aenc.encode(d); } catch (e) {}
            d.close();
            const r = await lector.read();
            d = r.done ? null : r.value;
          }
          if (d) d.close();
        })();
      } else if (primerAudio) primerAudio.close();

      // video: un cuadro cada 1/30 s
      let raf = 0, ultimo = -1, n = 0, activo = true, tsAnterior = -1;
      const t0 = performance.now();
      const cuadro = () => {
        if (!activo) return;
        raf = requestAnimationFrame(cuadro);
        const ahora = performance.now();
        if (ultimo >= 0 && ahora - ultimo < 1000 / CUADROS - 4) return;
        ultimo = ahora;
        g.setTransform(kx, 0, 0, ky, 0, 0);
        try { op.componer(g, W, H); } catch (e) { /* un cuadro fallido no detiene la grabación */ }
        if (girar) {
          // se guarda acostado (90° a la izquierda); el reproductor lo endereza con la marca de rotación
          gc.setTransform(0, -1, 1, 0, 0, c.height);
          gc.drawImage(p, 0, 0);
        }
        if (venc.state !== 'configured' || venc.encodeQueueSize > 4) return; // el celular va lento: se salta el cuadro
        // tiempo en microsegundos desde el inicio: nunca negativo y siempre creciente
        const ts = Math.max(tsAnterior + 1, Math.round((ahora - t0) * 1000), 0);
        tsAnterior = ts;
        const f = new VideoFrame(c, { timestamp: ts });
        venc.encode(f, { keyFrame: n++ % (CUADROS * 2) === 0 });
        f.close();
      };
      raf = requestAnimationFrame(cuadro);

      const reloj = relojes(() => detener());
      let deteniendo = false;
      async function detener() {
        if (deteniendo) return;
        deteniendo = true;
        activo = false;
        cancelAnimationFrame(raf);
        reloj.parar();
        op.alCambiar('guardando', 0);
        leyendo = false;
        try { lector && (await lector.cancel()); } catch (e) {}
        if (audio) audio.getTracks().forEach((t) => t.stop());
        try {
          if (venc.state === 'configured') await venc.flush();
          if (aenc && aenc.state === 'configured') await aenc.flush();
          if (fallo) throw fallo;
          muxer.finalize();
          guardar(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'mp4');
        } catch (e) {
          console.warn(e);
          op.alCambiar('detenido', 0);
          op.avisar('No se pudo guardar el video');
        } finally {
          try { venc.close(); } catch (e) {}
          try { aenc && aenc.close(); } catch (e) {}
          sesion = null;
        }
      }
      return { detener, tipo: 'mp4-webcodecs' + (girar ? '-girado' : '') + ' ' + c.width + 'x' + c.height };
    }

    // ---------- Respaldo: MediaRecorder
    async function iniciarMediaRecorder(c, g, W, H, k) {
      const formato = formatoMediaRecorder();
      if (!formato) { op.avisar('Este navegador no puede grabar video'); return null; }
      const dibujar = () => {
        g.setTransform(k, 0, 0, k, 0, 0);
        try { op.componer(g, W, H); } catch (e) {}
        raf = requestAnimationFrame(dibujar);
      };
      let raf = 0;
      g.setTransform(k, 0, 0, k, 0, 0);
      op.componer(g, W, H);
      const flujo = c.captureStream(CUADROS);
      const audio = await pedirMicrofono(op);
      if (audio) audio.getAudioTracks().forEach((t) => flujo.addTrack(t));
      let rec;
      try {
        rec = new MediaRecorder(flujo, { mimeType: formato[0], videoBitsPerSecond: BITRATE_VIDEO, audioBitsPerSecond: BITRATE_AUDIO });
      } catch (e) {
        if (audio) audio.getTracks().forEach((t) => t.stop());
        op.avisar('No se pudo iniciar la grabación');
        return null;
      }
      const partes = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) partes.push(ev.data); };
      const reloj = relojes(() => detener());
      rec.onstop = () => {
        cancelAnimationFrame(raf);
        reloj.parar();
        if (audio) audio.getTracks().forEach((t) => t.stop());
        flujo.getTracks().forEach((t) => t.stop());
        sesion = null;
        guardar(new Blob(partes, { type: formato[0].split(';')[0] }), formato[1]);
        if (formato[1] === 'webm') {
          const firefox = /Firefox|FxiOS/.test(navigator.userAgent);
          setTimeout(() => op.avisar(firefox ? 'Firefox graba en WebM. Para MP4 abre la RA en Google Chrome.' : 'Este navegador solo grabó en WebM. Actualiza Google Chrome.'), 2500);
        }
      };
      rec.start(1000);
      raf = requestAnimationFrame(dibujar);
      function detener() { if (rec.state !== 'inactive') rec.stop(); }
      return { detener, tipo: 'mediarecorder-' + formato[1] };
    }

    let iniciando = false;
    async function iniciar() {
      if (sesion || iniciando) return;
      iniciando = true;
      try {
        const W0 = window.innerWidth, H0 = window.innerHeight;
        const plan = await planMP4(W0, H0);
        let Mux = null;
        if (plan) { try { Mux = await cargarMuxer(); } catch (e) { Mux = null; } }
        if (plan && Mux) {
          sesion = await iniciarMP4(plan, Mux);
        } else {
          const { c, g, W, H, escala: k } = lienzo(Math.min(window.devicePixelRatio || 1, LADO_MAX_VIDEO / Math.max(W0, H0)));
          sesion = await iniciarMediaRecorder(c, g, W, H, k);
        }
      } finally {
        iniciando = false;
      }
    }

    return {
      alternar: () => (sesion ? sesion.detener() : iniciar()),
      grabando: () => !!sesion,
      detener: () => sesion && sesion.detener(),
      tipo: () => sesion && sesion.tipo,
    };
  }

  // Para diagnostico-video.html: qué puede grabar este navegador
  async function diagnostico() {
    const W = window.innerWidth, H = window.innerHeight;
    const r = { version: VERSION, navegador: navigator.userAgent, pantalla: W + '×' + H + ' @' + (window.devicePixelRatio || 1),
      webcodecs: 'VideoEncoder' in window, audioDesdeMicrofono: 'MediaStreamTrackProcessor' in window, h264: [], audio: [], mediaRecorder: [] };
    if (r.webcodecs) {
      for (const [w, h] of [[576, 1280], [720, 1280], [1280, 720], [480, 1088], [1088, 480], [432, 960], [960, 432], [320, 720], [720, 320], [640, 480]]) {
        const cfg = await configuracionH264(w, h);
        r.h264.push(w + 'x' + h + ': ' + (cfg ? 'sí (' + cfg.codec + ')' : 'no'));
      }
    }
    if ('AudioEncoder' in window) {
      for (const codec of ['mp4a.40.2', 'opus']) {
        try { r.audio.push(codec + ': ' + ((await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 1, bitrate: BITRATE_AUDIO })).supported ? 'sí' : 'no')); }
        catch (e) { r.audio.push(codec + ': error'); }
      }
    }
    if (typeof MediaRecorder !== 'undefined') {
      for (const t of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8,opus'])
        r.mediaRecorder.push(t + ': ' + (MediaRecorder.isTypeSupported(t) ? 'sí' : 'no'));
    }
    try { await cargarMuxer(); r.empaquetadorMP4 = 'cargado'; } catch (e) { r.empaquetadorMP4 = 'no se pudo cargar'; }
    const plan = await planMP4(W, H);
    r.resultado = plan ? 'MP4 ' + plan.w + 'x' + plan.h + (plan.girar ? ' (girado)' : '') : 'WebM / MediaRecorder';
    return r;
  }

  window.IllariCaptura = { foto, grabadora, descargar, dibujarVideoCubriendo, MAX_SEGUNDOS, configuracionH264, planMP4, diagnostico, VERSION };
})();
