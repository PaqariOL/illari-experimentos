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
  const VERSION = '2026-11-24c';
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
    return (await planesMP4(W, H, 1))[0] || null;
  }

  async function planesMP4(W, H, maximo = 4) {
    const lista = [];
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) return lista;
    const largo = Math.max(W, H);
    const intentos = [];
    for (const girar of [false, true]) {
      for (const lado of LADOS_MP4) {
        const k = Math.min(window.devicePixelRatio || 1, lado / largo);
        let w = pasoDe16(W * k), h = pasoDe16(H * k);
        if (girar) { if (w === h) continue; [w, h] = [h, w]; }
        if (lista.length >= maximo) return lista;
        const clave = w + 'x' + h;
        if (intentos.includes(clave)) continue;
        intentos.push(clave);
        const vcfg = await configuracionH264(w, h);
        // como máximo la mitad de los intentos por orientación, para probar también el video acostado
        if (vcfg && lista.filter((x) => x.girar === girar).length < Math.ceil(maximo / 2)) lista.push({ vcfg, w, h, girar });
      }
    }
    return lista;
  }

  // Algunos codificadores (Chrome en Windows y en muchos Android) entregan los trozos sin duración
  // (duration = null) y mp4-muxer los rechaza. En ese caso se copian los datos y se pasa una duración.
  const DURACION_CUADRO = Math.round(1e6 / CUADROS);
  function agregarVideo(muxer, chunk, meta) {
    if (typeof chunk.duration === 'number' && chunk.duration >= 0) return muxer.addVideoChunk(chunk, meta);
    const datos = new Uint8Array(chunk.byteLength);
    chunk.copyTo(datos);
    muxer.addVideoChunkRaw(datos, chunk.type, chunk.timestamp, DURACION_CUADRO, meta);
  }
  function agregarAudio(muxer, chunk, meta, duracion) {
    if (typeof chunk.duration === 'number' && chunk.duration >= 0) return muxer.addAudioChunk(chunk, meta);
    const datos = new Uint8Array(chunk.byteLength);
    chunk.copyTo(datos);
    muxer.addAudioChunkRaw(datos, chunk.type, chunk.timestamp, duracion, meta);
  }
  // duración de un trozo de audio codificado: AAC = 1024 muestras; Opus = 20 ms
  const duracionAudio = (acfg) => (acfg.nombre === 'aac' ? Math.round((1024 * 1e6) / acfg.cfg.sampleRate) : 20000);

  // Audio en un hilo aparte (Worker): la escena 3D y el detector de manos ocupan el hilo principal y,
  // si el audio se lee ahí, el micrófono pierde trozos y el sonido queda más corto que el video.
  const CODIGO_AUDIO = `
    let fin = Infinity, desde = 0;
    onmessage = async (ev) => {
      const m = ev.data;
      if (m.tipo === 'parar') { fin = m.fin; return; }
      if (m.tipo !== 'inicio') return;
      desde = m.desde;
      try {
        const enc = new AudioEncoder({
          output: (c, meta) => {
            const d = new Uint8Array(c.byteLength); c.copyTo(d);
            postMessage({ tipo: 'trozo', datos: d, clase: c.type, ts: c.timestamp, dur: c.duration, meta: meta && meta.decoderConfig ? { decoderConfig: meta.decoderConfig } : undefined }, [d.buffer]);
          },
          error: (e) => postMessage({ tipo: 'error', texto: String(e && e.message || e) }),
        });
        enc.configure(m.cfg);
        const lector = m.flujo.getReader();
        while (true) {
          const r = await lector.read();
          if (r.done) break;
          const d = r.value;
          if (d.timestamp >= fin) { d.close(); break; }
          if (d.timestamp < desde) { d.close(); continue; } // audio de antes de empezar a grabar
          try { enc.encode(d); } catch (e) {}
          d.close();
        }
        try { lector.cancel(); } catch (e) {}
        await enc.flush();
        enc.close();
      } catch (e) {
        postMessage({ tipo: 'error', texto: String(e && e.message || e) });
      }
      postMessage({ tipo: 'fin' });
    };`;

  const conLimite = (promesa, ms, motivo) => Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error(motivo)), ms))]);
  const textoError = (e) => String((e && (e.message || e.name)) || e || 'error').slice(0, 120);
  let ultimoError = '';

  // Prueba real antes de grabar: codifica 3 cuadros (y 0,3 s de silencio si hay audio) y arma un MP4
  // pequeño. Algunos celulares dicen que aceptan un formato pero fallan al codificar o al empaquetar.
  async function probarPlan(plan, Mp4Muxer, acfg) {
    let venc = null, aenc = null, error = null;
    try {
      const c = document.createElement('canvas');
      c.width = plan.w; c.height = plan.h;
      const g = c.getContext('2d');
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: plan.w, height: plan.h, frameRate: CUADROS, rotation: plan.girar ? 90 : 0 },
        audio: acfg ? { codec: acfg.nombre, sampleRate: acfg.cfg.sampleRate, numberOfChannels: acfg.cfg.numberOfChannels } : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let cuadros = 0;
      venc = new VideoEncoder({
        output: (chunk, meta) => { try { agregarVideo(muxer, chunk, meta); cuadros++; } catch (e) { error = error || e; } },
        error: (e) => { error = error || e; },
      });
      venc.configure(plan.vcfg);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i % 2 ? '#B8E3E9' : '#1B2F6E';
        g.fillRect(0, 0, c.width, c.height);
        const f = new VideoFrame(c, { timestamp: i * DURACION_CUADRO, duration: DURACION_CUADRO });
        venc.encode(f, { keyFrame: i === 0 });
        f.close();
      }
      await conLimite(venc.flush(), 5000, 'el codificador de video no respondió');
      if (acfg) {
        aenc = new AudioEncoder({
          output: (chunk, meta) => { try { agregarAudio(muxer, chunk, meta, duracionAudio(acfg)); } catch (e) { error = error || e; } },
          error: (e) => { error = error || e; },
        });
        aenc.configure(acfg.cfg);
        const n = Math.round(acfg.cfg.sampleRate / 10), ch = acfg.cfg.numberOfChannels;
        for (let i = 0; i < 3; i++) {
          const d = new AudioData({ format: 'f32-planar', sampleRate: acfg.cfg.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: i * 100000, data: new Float32Array(n * ch) });
          aenc.encode(d);
          d.close();
        }
        await conLimite(aenc.flush(), 5000, 'el codificador de audio no respondió');
      }
      if (error) throw error;
      if (!cuadros) throw new Error('el codificador no entregó cuadros');
      muxer.finalize();
      if (!muxer.target.buffer || !muxer.target.buffer.byteLength) throw new Error('MP4 vacío');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: textoError(e) };
    } finally {
      try { venc && venc.state !== 'closed' && venc.close(); } catch (e) {}
      try { aenc && aenc.state !== 'closed' && aenc.close(); } catch (e) {}
    }
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
    async function iniciarMP4(plan, Mp4Muxer, sonido) {
      const W = window.innerWidth, H = window.innerHeight;
      const { vcfg, girar } = plan;
      // c = lienzo que se codifica; p = lienzo vertical donde se dibuja la escena (el mismo si no se gira)
      const c = document.createElement('canvas');
      c.width = plan.w; c.height = plan.h;
      const p = girar ? document.createElement('canvas') : c;
      if (girar) { p.width = plan.h; p.height = plan.w; }
      const g = p.getContext('2d'), gc = c.getContext('2d');
      const kx = p.width / W, ky = p.height / H;
      const { audio, primerAudio, acfg } = sonido;
      let lector = sonido.lector;

      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: c.width, height: c.height, frameRate: CUADROS, rotation: girar ? 90 : 0 },
        audio: acfg ? { codec: acfg.nombre, sampleRate: acfg.cfg.sampleRate, numberOfChannels: acfg.cfg.numberOfChannels } : undefined,
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let fallo = null;
      const venc = new VideoEncoder({
        output: (chunk, meta) => { try { agregarVideo(muxer, chunk, meta); } catch (e) { if (!fallo) { fallo = e; detener(); } } },
        error: (e) => { if (!fallo) { fallo = e; detener(); } },
      });
      venc.configure(vcfg);
      const t0 = performance.now(); // inicio de la grabación (video y audio)
      let aenc = null, trabajador = null, finAudio = Infinity, alTerminarAudio = null;
      const audioListo = new Promise((ok) => { alTerminarAudio = ok; });
      const durAudio = acfg ? duracionAudio(acfg) : 0;
      const agregarAudioRaw = (m) => {
        try { muxer.addAudioChunkRaw(m.datos, m.clase, m.ts, typeof m.dur === 'number' && m.dur >= 0 ? m.dur : durAudio, m.meta); }
        catch (e) { /* se pierde ese trozo de audio */ }
      };

      // Opción 1: audio en un Worker
      if (acfg && lector && sonido.flujo && typeof Worker !== 'undefined') {
        let url = null;
        try {
          lector.releaseLock();
          url = URL.createObjectURL(new Blob([CODIGO_AUDIO], { type: 'text/javascript' }));
          trabajador = new Worker(url);
          trabajador.onmessage = (ev) => {
            const m = ev.data;
            if (m.tipo === 'trozo') agregarAudioRaw(m);
            else if (m.tipo === 'error') console.warn('audio:', m.texto);
            else if (m.tipo === 'fin') alTerminarAudio();
          };
          trabajador.postMessage({ tipo: 'inicio', flujo: sonido.flujo, cfg: acfg.cfg, desde: t0 * 1000 }, [sonido.flujo]);
          lector = null;
          if (primerAudio) primerAudio.close();
        } catch (e) {
          // el navegador no permite pasar el micrófono al Worker: se usa el hilo principal
          if (trabajador) { trabajador.terminate(); trabajador = null; }
          try { lector = sonido.flujo.getReader(); } catch (e2) { lector = null; }
        } finally {
          if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      }

      // Opción 2: audio en el hilo principal
      let leyendo = false;
      if (!trabajador && acfg && lector) {
        aenc = new AudioEncoder({ output: (chunk, meta) => { try { agregarAudio(muxer, chunk, meta, durAudio); } catch (e) { /* se pierde ese trozo */ } }, error: () => { aenc = null; } });
        aenc.configure(acfg.cfg);
        leyendo = true;
        (async () => {
          let d = primerAudio;
          while (leyendo && d && d.timestamp < finAudio) {
            try { if (aenc && aenc.state === 'configured' && d.timestamp >= t0 * 1000) aenc.encode(d); } catch (e) {}
            d.close();
            const r = await lector.read();
            d = r.done ? null : r.value;
          }
          if (d) d.close();
          alTerminarAudio();
        })();
      } else if (!trabajador) {
        if (primerAudio) primerAudio.close();
        alTerminarAudio();
      }

      // video: un cuadro cada 1/30 s
      let raf = 0, ultimo = -1, n = 0, activo = true, tsAnterior = -1;
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
        const f = new VideoFrame(c, { timestamp: ts, duration: DURACION_CUADRO });
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
        // se sigue codificando el audio que quedó en espera hasta el momento de parar
        finAudio = performance.now() * 1000; // las marcas de tiempo del micrófono usan este mismo reloj
        if (trabajador) trabajador.postMessage({ tipo: 'parar', fin: finAudio });
        await Promise.race([audioListo, new Promise((ok) => setTimeout(ok, 2500))]);
        leyendo = false;
        if (trabajador) trabajador.terminate();
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
          ultimoError = textoError(e);
          op.alCambiar('detenido', 0);
          op.avisar('No se pudo guardar el video (' + ultimoError + ')');
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

    // Micrófono para el MP4: se lee con MediaStreamTrackProcessor y se elige AAC u Opus
    async function prepararSonido() {
      const sonido = { audio: null, lector: null, primerAudio: null, acfg: null };
      const audio = await pedirMicrofono(op);
      if (!audio) return sonido;
      sonido.audio = audio;
      if ('MediaStreamTrackProcessor' in window) {
        try {
          sonido.flujo = new MediaStreamTrackProcessor({ track: audio.getAudioTracks()[0], maxBufferSize: 300 }).readable; // hasta ~3 s en espera
          sonido.lector = sonido.flujo.getReader();
          sonido.primerAudio = (await sonido.lector.read()).value || null; // frecuencia y canales reales
          if (sonido.primerAudio) sonido.acfg = await configuracionAudio(sonido.primerAudio.sampleRate, sonido.primerAudio.numberOfChannels);
        } catch (e) { sonido.acfg = null; }
      }
      if (!sonido.acfg) { soltarSonido(sonido); op.avisar('Grabando sin sonido'); }
      return sonido;
    }
    function soltarSonido(sonido) {
      if (sonido.primerAudio) { try { sonido.primerAudio.close(); } catch (e) {} }
      try { sonido.lector && sonido.lector.cancel(); } catch (e) {}
      if (sonido.audio) sonido.audio.getTracks().forEach((t) => t.stop());
      sonido.audio = sonido.lector = sonido.primerAudio = sonido.acfg = sonido.flujo = null;
    }

    let iniciando = false;
    async function iniciar() {
      if (sesion || iniciando) return;
      iniciando = true;
      try {
        const W0 = window.innerWidth, H0 = window.innerHeight;
        const planes = await planesMP4(W0, H0);
        let Mux = null;
        if (planes.length) { try { Mux = await cargarMuxer(); } catch (e) { Mux = null; ultimoError = 'no se pudo cargar el empaquetador MP4'; } }
        if (Mux) {
          op.alCambiar('preparando', 0);
          const sonido = await prepararSonido();
          for (const plan of planes) {
            let r = await probarPlan(plan, Mux, sonido.acfg);
            if (!r.ok && sonido.acfg) {
              // el audio es el problema: se graba el video sin sonido
              const r2 = await probarPlan(plan, Mux, null);
              if (r2.ok) { soltarSonido(sonido); op.avisar('Grabando sin sonido'); r = r2; }
            }
            if (r.ok) { sesion = await iniciarMP4(plan, Mux, sonido); return; }
            ultimoError = plan.w + 'x' + plan.h + ': ' + r.error;
            console.warn('MP4 no disponible', ultimoError);
          }
          soltarSonido(sonido);
        }
        const { c, g, W, H, escala: k } = lienzo(Math.min(window.devicePixelRatio || 1, LADO_MAX_VIDEO / Math.max(W0, H0)));
        sesion = await iniciarMediaRecorder(c, g, W, H, k);
        if (!sesion) op.alCambiar('detenido', 0);
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
    let Mux = null;
    try { Mux = await cargarMuxer(); r.empaquetadorMP4 = 'cargado'; } catch (e) { r.empaquetadorMP4 = 'no se pudo cargar'; }
    // prueba real de cada tamaño (sin audio y con audio de 48 kHz)
    r.pruebas = [];
    let elegido = null;
    if (Mux) {
      const acfg = await configuracionAudio(48000, 1);
      for (const plan of await planesMP4(W, H)) {
        const nombre = plan.w + 'x' + plan.h + (plan.girar ? ' girado' : '');
        const v = await probarPlan(plan, Mux, null);
        const a = v.ok && acfg ? await probarPlan(plan, Mux, acfg) : null;
        r.pruebas.push(nombre + ': video ' + (v.ok ? 'OK' : 'falla (' + v.error + ')') + (a ? ' · audio ' + acfg.nombre + ' ' + (a.ok ? 'OK' : 'falla (' + a.error + ')') : ''));
        if (v.ok && !elegido) elegido = nombre + (a && !a.ok ? ', sin sonido' : '');
      }
    }
    r.resultado = elegido ? 'MP4 ' + elegido : 'WebM / MediaRecorder';
    return r;
  }

  window.IllariCaptura = { foto, grabadora, descargar, dibujarVideoCubriendo, MAX_SEGUNDOS, configuracionH264, planMP4, planesMP4, probarPlan, cargarMuxer, diagnostico, VERSION, ultimoError: () => ultimoError };
})();
