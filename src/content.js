/* ============================================================
   Práctica de inglés sobre Crunchyroll.
   Al terminar cada línea de subtítulo el video se pausa: hay que decirla
   (reconocimiento de voz) o escribirla y llegar al umbral (80 %) para seguir.
   ============================================================ */
(function () {
  "use strict";
  if (window.__creContentLoaded) return;
  window.__creContentLoaded = true;

  const { evaluate, evaluateBest, cleanChunks, normalize } = window.CREScoring;
  const { parseSubtitles, pauseTime } = window.CRESubs;
  const { store, loadSettings, today } = window.CRESettings;

  const ERRORS = {
    "no-speech": "No escuché nada. Pulsa el micrófono y habla más cerca.",
    "audio-capture": "No encuentro ningún micrófono conectado.",
    "not-allowed": "El navegador bloqueó el micrófono. Dale permiso en el candado de la barra de direcciones.",
    "service-not-allowed": "Este navegador no permite el reconocimiento de voz aquí. Usa Chrome o Edge.",
    network: "Sin conexión: el reconocimiento de voz necesita internet.",
  };

  /* ---------------- estado ---------------- */
  let settings = null;
  let playback = null; // última respuesta de reproducción leída por page-hook.js
  let playbackGeneration = 0;
  let pendingCues = null; // una recarga no reemplaza el índice de una frase abierta
  let cues = []; // líneas en inglés
  let transCues = []; // líneas en español (ayuda opcional)
  let targets = []; // índices de cues que se practican
  let trackLabel = "";
  let loadState = "waiting"; // waiting | loading | ready | error | manual
  let loadError = "";
  let episodeId = null;
  let progress = { passed: {} };
  let video = null;
  let idx = 0; // posición dentro de targets
  let phase = "watch"; // watch | exercise | replay
  let ex = null; // ejercicio en curso
  let exerciseCount = 0;
  let replayEnd = 0;
  let preciseTimer = 0; // disparo exacto en los últimos milisegundos de la línea
  let savedRate = 1;
  let ownSeek = false; // búsqueda propia (repetir): no cuenta como acción del usuario
  let rec = null;
  let continueTimer = 0;

  /* ---------------- utilidades ---------------- */
  const $ = (sel) => shadow.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cueKey = (c) => String(Math.round(c.start * 10));
  const isEnglish = (loc) => !loc || /^en/i.test(loc);

  function currentEpisode() {
    const m = location.pathname.match(/\/watch\/([A-Za-z0-9]+)/);
    return m ? m[1] : location.pathname;
  }

  function findVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = v; }
    }
    return best;
  }

  /* ---------------- interfaz (Shadow DOM) ---------------- */
  const host = document.createElement("div");
  host.id = "cre-host";
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL("src/panel.css") : "src/panel.css";
  shadow.appendChild(css);
  if (window.__CRE_PANEL_CSS) { // inyección manual de pruebas, sin la extensión instalada
    const st = document.createElement("style");
    st.textContent = window.__CRE_PANEL_CSS;
    shadow.appendChild(st);
  }
  const root = document.createElement("div");
  root.className = "cre";
  root.innerHTML = `
    <div class="pill" hidden>
      <span class="dot"></span><span class="pill-text"></span>
      <div class="seg" role="group" aria-label="Modo">
        <button data-mode="speak" title="Decir cada línea">🎤</button>
        <button data-mode="write" title="Escribir cada línea">⌨️</button>
        <button data-mode="mix" title="Alternar">🔀</button>
      </div>
      <button class="power" title="Pausar / activar la práctica">⏻</button>
      <label class="file" title="Cargar subtítulos (.vtt/.srt/.ass)" hidden>📂<input type="file" accept=".vtt,.srt,.ass,.ssa" hidden></label>
    </div>
    <div class="panel" hidden>
      <div class="top">
        <span class="chip"></span>
        <span class="count"></span>

      </div>
      <div class="target"></div>
      <div class="trans" aria-live="polite" hidden></div>
      <div class="write" hidden><input type="text" autocomplete="off" spellcheck="false" placeholder="Escribe lo que escuchaste…"></div>
      <div class="heard" hidden></div>
      <div class="result" hidden>
        <div class="bar"><div class="fill"></div><span class="mark"></span></div>
        <b class="score"></b>
      </div>
      <div class="status"></div>
      <div class="actions">
        <button data-act="replay" title="Repetir el audio (R)">🔁 Repetir</button>
        <button data-act="slow" title="Repetir más lento (L)">🐢 Lento</button>
        <button data-act="tts" title="Escuchar la pronunciación">🔊 Voz</button>
        <button data-act="hint" title="Pista">💡 Pista</button>
        <span class="grow"></span>
        <button class="primary" data-act="primary"></button>
      </div>
    </div>
    <div class="pop" hidden role="dialog"></div>`;
  shadow.appendChild(root);

  function mountHost() {
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" ? fs : document.body || document.documentElement;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }

  function layout() {
    const pill = $(".pill"), panel = $(".panel");
    if (!video || !document.contains(video)) { pill.hidden = true; panel.hidden = true; return; }
    const r = video.getBoundingClientRect();
    if (r.width < 200 || r.height < 120) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.style.left = r.left + 12 + "px";
    pill.style.top = r.top + 12 + "px";
    panel.style.left = r.left + r.width / 2 + "px";
    panel.style.top = r.bottom - Math.min(90, r.height * 0.12) + "px";
    panel.style.width = Math.min(760, r.width - 32) + "px";
    panel.style.maxHeight = r.height - 80 + "px";
  }

  function renderPill() {
    if (!settings) return;
    const dot = $(".dot"), text = $(".pill-text");
    root.classList.toggle("off", !settings.enabled);
    let label;
    if (!settings.enabled) label = "Práctica en pausa";
    else if (loadState === "ready" || loadState === "manual") {
      const done = targets.filter((i) => progress.passed[cueKey(cues[i])] !== undefined).length;
      label = `Inglés · ${done}/${targets.length}`;
    } else if (loadState === "loading") label = "Cargando subtítulos…";
    else if (loadState === "error") label = loadError || "Sin subtítulos en inglés";
    else label = "Esperando subtítulos…";
    text.textContent = label;
    text.title = trackLabel ? `Pista: ${trackLabel}` : "";
    dot.className = "dot " + (settings.enabled && (loadState === "ready" || loadState === "manual") ? "ok" : loadState === "error" ? "bad" : "");
    for (const b of shadow.querySelectorAll(".seg button")) b.classList.toggle("on", b.dataset.mode === settings.mode);
    $(".file").hidden = !(loadState === "error" || loadState === "waiting" || loadState === "manual");
  }

  function setStatus(text, tone = "") {
    const s = $(".status");
    s.textContent = text;
    s.className = "status " + tone;
  }

  function maskedHint(text, level) {
    // Nivel 1: primera letra de cada palabra. Nivel 2: texto completo.
    if (level >= 2) return esc(text);
    return esc(text.replace(/[A-Za-z][A-Za-z']*/g, (w) => w[0] + w.slice(1).replace(/[A-Za-z]/g, "_")));
  }

  function renderWords(words) {
    return words.map((w) => {
      const cls = w.sim >= 0.999 ? "good" : w.sim >= 0.8 ? "meh" : "bad";
      const tok = /[a-z]/i.test(w.word) && !/•/.test(w.word) ? ` tok" data-w="${esc(w.word)}` : "";
      return `<span class="w ${cls}${tok}">${esc(w.word)}</span>`;
    }).join(" ");
  }

  /** Texto con cada palabra envuelta para poder pasar el ratón y ver su significado. */
  function tokens(text) {
    return String(text).split(/([A-Za-z0-9][A-Za-z0-9'’]*(?:-[A-Za-z]+)*)/).map((part, i) =>
      i % 2 ? `<span class="tok" data-w="${esc(part)}">${esc(part)}</span>` : esc(part)).join("");
  }

  function renderExercise() {
    const panel = $(".panel");
    if (!ex) { panel.hidden = true; return; }
    panel.hidden = false;
    const speak = ex.mode === "speak";
    $(".chip").textContent = speak ? "🎤 Dilo en voz alta" : "⌨️ Escríbelo";
    $(".chip").className = "chip mode-" + ex.mode;
    $(".count").textContent = `Línea ${idx + 1} de ${targets.length}`;

    const target = $(".target");
    if (ex.result && (ex.passed || speak || ex.showText || ex.hint >= 2)) {
      target.innerHTML = `<div class="orig">${tokens(ex.cue.text)}</div><div class="words">${renderWords(ex.result.words)}</div>`;
    } else if (speak || ex.showText) {
      target.innerHTML = `<div class="orig big">${tokens(ex.cue.text)}</div>`;
    } else if (ex.hint) {
      target.innerHTML = `<div class="orig big mono">${maskedHint(ex.cue.practice, ex.hint)}</div>`;
    } else {
      target.innerHTML = `<div class="orig muted">Escucha y escribe la línea en inglés</div>`;
    }
    if (ex.result && !speak && !ex.passed && !ex.showText && ex.hint < 2) {
      target.innerHTML += `<div class="words">${renderWords(ex.result.words.map((w) => w.sim >= 0.999 ? w : { word: w.sim >= 0.8 ? w.word : "•".repeat(Math.max(2, w.word.length)), sim: w.sim }))}</div>`;
    }

    const trans = $(".trans");
    trans.hidden = !(ex.showTrans && (ex.trans || ex.transLoading));
    trans.textContent = ex.trans || (ex.transLoading ? "Traduciendo…" : "");

    $(".write").hidden = speak;
    const heard = $(".heard");
    heard.hidden = !ex.heard;
    heard.innerHTML = ex.heard ? `<span>${esc(ex.heard.label)}:</span> ${tokens(ex.heard.text)}` : "";

    const res = $(".result");
    res.hidden = !ex.result;
    if (ex.result) {
      const sc = ex.result.score;
      const tone = sc >= settings.threshold ? "good" : sc >= settings.threshold - 20 ? "meh" : "bad";
      $(".fill").style.width = Math.min(100, sc) + "%";
      $(".fill").className = "fill " + tone;
      $(".mark").style.left = settings.threshold + "%";
      $(".score").textContent = sc + "%";
      $(".score").className = "score " + tone;
    }

    const act = (a) => shadow.querySelector(`[data-act="${a}"]`);
    act("tts").hidden = !speak;
    act("hint").hidden = speak || ex.passed || ex.showText || ex.hint >= 2;
    act("hint").textContent = ex.hint ? "👁 Ver respuesta" : "💡 Pista";
    const primary = act("primary");
    if (ex.passed) primary.textContent = "Continuar ▶";
    else if (speak) primary.textContent = ex.listening ? "⏹ Parar" : "🎤 Hablar";
    else primary.textContent = "Comprobar ↵";
    primary.classList.toggle("rec", !!ex.listening);
    primary.disabled = phase === "replay";
  }

  /* ---------------- carga de subtítulos ---------------- */
  async function fetchText(url) {
    url = window.CRENetwork.subtitleUrl(url);
    try {
      const r = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.text();
    } catch (_) { /* CORS: probar desde el service worker */ }
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      const res = await chrome.runtime.sendMessage({ type: "cre-fetch", url });
      if (res && res.ok) return res.text;
      throw new Error(res && res.error ? res.error : "No se pudo descargar el subtítulo");
    }
    throw new Error("No se pudo descargar el subtítulo");
  }

  function pickTrack(pb, wanted, preferCaptions) {
    const lists = preferCaptions ? [pb.captions, pb.subtitles] : [pb.subtitles, pb.captions];
    const base = wanted.split("-")[0].toLowerCase();
    for (const exact of [true, false]) {
      for (const list of lists) {
        for (const [key, t] of Object.entries(list || {})) {
          if (!t || !t.url) continue;
          const loc = (t.language || key || "").toLowerCase();
          if (exact ? loc === wanted.toLowerCase() : loc.split("-")[0] === base) {
            return { url: t.url, format: t.format, label: `${t.language || key}${list === pb.captions ? " [CC]" : ""}` };
          }
        }
      }
    }
    return null;
  }

  async function loadFromPlayback(pb) {
    const generation = ++playbackGeneration;
    playback = pb;
    const ep = currentEpisode();
    if (ep !== episodeId) await switchEpisode(ep, true);
    const current = () => generation === playbackGeneration && ep === episodeId && ep === currentEpisode();
    if (!current()) return;
    pendingCues = null;
    loadState = "loading";
    renderPill();
    // Con audio en inglés, los [CC] coinciden palabra por palabra con lo que se oye.
    const track = pickTrack(pb, settings.subLang, isEnglish(pb.audioLocale));
    if (!track) {
      loadState = "error";
      loadError = "Este episodio no tiene subtítulos en inglés";
      if (!ex) { cues = []; targets = []; }
      renderPill();
      return;
    }
    try {
      const text = await fetchText(track.url);
      if (!current()) return;
      setCues(parseSubtitles(text, track.format), track.label, "ready");
    } catch (e) {
      if (!current()) return;
      loadState = "error";
      loadError = "No se pudieron cargar los subtítulos";
      console.warn("[cre]", e);
      renderPill();
      return;
    }
    transCues = [];
    const tr = settings.translationLang && pickTrack(pb, settings.translationLang, false);
    const refreshTranslation = () => {
      if (!current() || !ex) return;
      ex.translationGeneration = (ex.translationGeneration || 0) + 1;
      ex.transLoading = false;
      ex.trans = translationFor(ex.cue);
      if (!ex.trans) translateCurrent();
      renderExercise();
    };
    if (tr) fetchText(tr.url).then((t) => {
      if (!current()) return;
      transCues = parseSubtitles(t, tr.format).map((c) => ({ start: c.start, end: c.end, text: c.text }));
      refreshTranslation();
    }).catch(refreshTranslation);
    else refreshTranslation();
  }

  function setCues(list, label, state) {
    if (ex) {
      pendingCues = { list, label, state };
      loadState = state;
      renderPill();
      return;
    }
    cues = list;
    trackLabel = label;
    loadState = state;
    computeTargets();
    resync();
    renderPill();
    publishStatus();
  }

  function computeTargets() {
    const eligible = [];
    cues.forEach((c, i) => { if (normalize(c.practice).length >= settings.minWords) eligible.push(i); });
    const every = Math.max(1, settings.every | 0);
    targets = eligible.filter((_, k) => k % every === 0);
  }

  async function switchEpisode(ep, preserveGeneration = false) {
    if (!preserveGeneration) { playbackGeneration++; playback = null; }
    pendingCues = null;
    closeExercise();
    episodeId = ep;
    cues = []; transCues = []; targets = []; idx = 0;
    loadState = "waiting"; trackLabel = "";
    const key = "ep:" + ep;
    const data = await store.get(key);
    if (episodeId !== ep) return;
    progress = data[key] || { passed: {} };
    renderPill();
  }

  function publishStatus() {
    store.set({ status: { episode: episodeId, track: trackLabel, lines: targets.length, state: loadState, at: Date.now() } });
  }

  /* ---------------- motor ---------------- */
  function resync() {
    if (!video) { idx = 0; return; }
    const t = video.currentTime;
    idx = targets.findIndex((i) => cues[i].end > t + 0.05);
    if (idx < 0) idx = targets.length;
  }

  function isPassed(cue) { return progress.passed[cueKey(cue)] !== undefined; }

  function translationFor(cue) {
    const matches = transCues.filter((t) => t.end > cue.start && t.start < cue.end)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    let covered = 0, coveredEnd = cue.start;
    const parts = [], seen = new Set();
    for (const t of matches) {
      const start = Math.max(cue.start, t.start), end = Math.min(cue.end, t.end);
      covered += Math.max(0, end - Math.max(start, coveredEnd));
      coveredEnd = Math.max(coveredEnd, end);
      const key = `${t.start}:${t.end}:${t.text}`;
      if (!seen.has(key)) { parts.push(t.text); seen.add(key); }
    }
    // No tratar un fragmento español aislado como el significado de toda la
    // frase: una cobertura temporal insuficiente pide traducción completa.
    return covered >= (cue.end - cue.start) * 0.8 ? parts.join(" ") : "";
  }

  function tick() {
    const v = findVideo();
    if (v !== video) attachVideo(v);
    mountHost();
    layout();
    if (!settings || !settings.enabled || !video || !targets.length) return;
    const t = video.currentTime;
    if (phase === "replay") {
      if (t >= replayEnd - 0.02 || video.ended) {
        video.pause();
        video.playbackRate = savedRate;
        phase = "exercise";
        renderExercise();
        if (ex && ex.mode === "speak" && settings.autoMic && !ex.passed) startMic();
        if (ex && ex.mode === "write") focusInput();
      }
      return;
    }
    if (phase !== "watch" || video.paused || video.seeking) return;
    checkCue();
  }

  function stopAt(k) { return pauseTime(cues, targets[k], settings.pauseOffset); }

  // Pausa exacta: el bucle de 25 ms se acerca y un setTimeout calculado con el
  // tiempo restante dispara justo cuando termina la línea.
  function checkCue() {
    const cue = cues[targets[idx]];
    if (!cue || !video) return;
    const at = stopAt(idx);
    const t = video.currentTime;
    if (t >= at - 0.01) {
      clearTimeout(preciseTimer); preciseTimer = 0;
      if (t > at + 1.5) { resync(); return; } // salto grande sin evento de búsqueda
      if (settings.skipPassed && isPassed(cue)) { idx++; return; }
      startExercise(cue);
      return;
    }
    const remaining = (at - t) / (video.playbackRate || 1);
    if (remaining < 0.12 && !preciseTimer) {
      preciseTimer = setTimeout(() => {
        preciseTimer = 0;
        if (phase === "watch" && video && !video.paused && !video.seeking) checkCue();
      }, Math.max(0, remaining * 1000 - 8));
    }
  }

  function attachVideo(v) {
    if (video) {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
    }
    video = v;
    if (!video) return;
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("play", onPlay);
    resync();
  }

  function onSeeked() {
    clearTimeout(preciseTimer); preciseTimer = 0;
    if (ownSeek) { ownSeek = false; return; }
    if (ex) {
      stopMic(true);
      video.pause();
      if (phase === "replay") video.playbackRate = savedRate;
      phase = "exercise";
      if (Math.abs(video.currentTime - ex.anchor) > 0.04) {
        ownSeek = true;
        video.currentTime = ex.anchor;
      }
      renderExercise();
      return;
    }
    resync();
  }

  function onPlay() {
    // Los play() propios ocurren en watch/replay. Play del sitio no autoriza
    // avanzar: solo un resultado aprobado y Continuar liberan esta frase.
    if (phase === "exercise" && ex && video) video.pause();
  }

  function startExercise(cue) {
    video.pause();
    phase = "exercise";
    const mode = settings.mode === "mix" ? (exerciseCount % 2 ? "write" : "speak") : settings.mode;
    exerciseCount++;
    ex = {
      cue, mode, anchor: video.currentTime, tries: 0, hint: 0, passed: false, result: null, heard: null,
      listening: false, trans: translationFor(cue), showTrans: true,
      // Sin audio en inglés no se puede escribir de oído: se muestra el texto para escribirlo de memoria.
      // Al escribir, el texto se muestra para copiarlo; en «dictado» se oculta.
      // Dictado sin audio en inglés: se muestra y desaparece al empezar a teclear.
      showText: mode === "write" && (!settings.dictation || (playback && !isEnglish(playback.audioLocale))),
      memory: mode === "write" && settings.dictation && playback && !isEnglish(playback.audioLocale),
    };
    const input = $(".write input");
    input.value = "";
    hidePop(true);
    if (ex.showTrans && !ex.trans) translateCurrent();
    renderExercise();
    if (mode === "speak") {
      setStatus(settings.autoMic ? "Preparando el micrófono…" : "Pulsa 🎤 Hablar (o Espacio) y di la línea.");
      if (settings.autoMic) startMic();
    } else {
      setStatus(ex.memory
        ? "El audio no está en inglés: memoriza la línea y escríbela (se oculta al empezar)."
        : ex.showText ? "Escribe la línea y pulsa Enter." : "Escribe lo que dijeron y pulsa Enter. 🔁 para volver a oírlo.");
      focusInput();
    }
  }

  function focusInput() {
    setTimeout(() => { const i = $(".write input"); if (i && !$(".write").hidden) i.focus(); }, 30);
  }

  function closeExercise() {
    clearTimeout(continueTimer);
    stopMic(true);
    window.speechSynthesis && window.speechSynthesis.cancel();
    if (phase === "replay" && video) video.playbackRate = savedRate;
    ex = null;
    phase = "watch";
    hidePop(true);
    renderExercise();
    const queued = pendingCues;
    pendingCues = null;
    if (queued) { setCues(queued.list, queued.label, queued.state); return true; }
    return false;
  }

  function continueVideo() {
    if (!ex || !ex.passed) return;
    const completed = ex.cue;
    if (closeExercise()) {
      const completedIndex = targets.findIndex((i) => cues[i].start === completed.start && cues[i].end === completed.end && cues[i].text === completed.text);
      if (completedIndex >= 0) idx = completedIndex + 1;
      else resync();
    } else idx++;
    video.play().catch(() => {});
    renderPill();
  }

  function replay(slow) {
    if (!ex || !video) return;
    stopMic(true);
    clearTimeout(continueTimer);
    if (phase !== "replay") savedRate = video.playbackRate || 1;
    phase = "replay";
    replayEnd = stopAt(idx);
    ownSeek = true;
    video.currentTime = Math.max(0, ex.cue.start - 0.15);
    video.playbackRate = slow ? 0.7 : savedRate;
    video.play().catch(() => {});
    setStatus(slow ? "Repitiendo más lento…" : "Repitiendo…");
    renderExercise();
  }

  function tts() {
    if (!ex || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(ex.cue.practice);
    u.lang = "en-US";
    u.rate = 0.9;
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === "en-US") || voices.find((v) => /^en/.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
  }

  async function record(score, passed) {
    const mode = ex.mode, cue = ex.cue, ep = episodeId, episodeProgress = progress;
    const day = today();
    const { stats } = await store.get("stats");
    const s = stats || { days: {}, totalPassed: 0, totalAttempts: 0 };
    s.days[day] = s.days[day] || { passed: 0, attempts: 0, speak: 0, write: 0 };
    s.days[day].attempts++;
    s.totalAttempts++;
    if (passed) {
      s.days[day].passed++;
      s.days[day][mode]++;
      s.totalPassed++;
      episodeProgress.passed[cueKey(cue)] = score;
      await store.set({ ["ep:" + ep]: episodeProgress });
    }
    await store.set({ stats: s });
    renderPill();
  }

  function handleResult(result) {
    if (!ex) return;
    ex.tries++;
    ex.result = result;
    const passed = result.score >= settings.threshold;
    record(result.score, passed);
    if (passed) {
      ex.passed = true;
      setStatus(result.score >= 95 ? "¡Perfecto!" : "¡Bien! Línea superada.", "good");
      if (settings.autoContinue) continueTimer = setTimeout(continueVideo, 1300);
    } else {
      const diff = settings.threshold - result.score;
      const saidCount = normalize(result.transcript || "").length;
      const targetCount = normalize(ex.cue.practice).length;
      let msg;
      if (ex.mode === "speak" && saidCount && targetCount >= 3 && saidCount < targetCount) {
        msg = `Solo escuché ${saidCount} de ${targetCount} palabras. Di la línea completa.`;
      } else if (diff <= 10) msg = "Casi. Fíjate en las palabras en rojo y repite.";
      else if (diff <= 25) msg = "Vas bien. Vuelve a escucharla (🔁) e inténtalo otra vez.";
      else msg = "Otra vez, más despacio.";
      if (ex.mode === "write" && !ex.showText && ex.tries >= settings.revealAfter && ex.hint < 2) msg += " Puedes pedir una pista o ver la respuesta.";
      setStatus(msg, "bad");
    }
    renderExercise();
  }

  function checkWritten() {
    if (!ex || ex.mode !== "write" || ex.passed) return;
    const text = $(".write input").value.trim();
    if (!text) { setStatus("Escribe algo primero.", "bad"); return; }
    const r = evaluate(ex.cue.practice, text);
    ex.heard = { label: "Escribiste", text };
    handleResult(Object.assign(r, { transcript: text }));
  }

  /* ---------------- reconocimiento de voz ---------------- */
  function startMic() {
    if (!ex || ex.passed || ex.listening) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { setStatus(ERRORS["service-not-allowed"], "bad"); return; }
    window.speechSynthesis && window.speechSynthesis.cancel();
    const currentExercise = ex;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 5;
    r.lang = "en-US";
    let chunks = [];
    let silence = 0;
    let failed = false;
    const hardStop = setTimeout(() => { try { r.stop(); } catch (_) {} }, 15000);
    r.onstart = () => {
      if (rec !== r || ex !== currentExercise || r.__aborted) return;
      ex.listening = true;
      setStatus("Escuchando… di la línea", "rec");
      renderExercise();
    };
    r.onresult = (e) => {
      if (rec !== r || ex !== currentExercise || r.__aborted) return;
      let interim = "";
      const finals = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts = [];
          for (let j = 0; j < res.length; j++) alts.push(res[j].transcript);
          finals.push(alts);
        } else interim += " " + res[0].transcript;
      }
      chunks = cleanChunks(finals, false);
      const live = (chunks.map((a) => a[0]).join(" ") + interim).trim();
      if (live) { ex.heard = { label: "Escuchando", text: live }; renderExercise(); }
      clearTimeout(silence);
      if (chunks.length) silence = setTimeout(() => { try { r.stop(); } catch (_) {} }, 1400);
    };
    r.onerror = (e) => {
      if (rec !== r || ex !== currentExercise || r.__aborted || e.error === "aborted") return;
      failed = true;
      setStatus(ERRORS[e.error] || `Error del reconocimiento: ${e.error}`, "bad");
    };
    r.onend = () => {
      clearTimeout(silence);
      clearTimeout(hardStop);
      if (rec !== r || ex !== currentExercise || r.__aborted) return;
      rec = null;
      ex.listening = false;
      const best = evaluateBest(ex.cue.practice, cleanChunks(chunks, false));
      if (best) {
        ex.heard = { label: "Dijiste", text: best.transcript };
        handleResult(best);
      } else {
        if (!failed) setStatus(ERRORS["no-speech"], "bad");
        renderExercise();
      }
    };
    rec = r;
    try { r.start(); } catch (_) { /* ya activo */ }
  }

  function stopMic(abort) {
    if (!rec) { if (ex) ex.listening = false; return; }
    const r = rec;
    try {
      if (abort) { r.__aborted = true; r.abort(); } else r.stop();
    } catch (_) { /* ya parado */ }
    if (abort) {
      rec = null;
      if (ex) ex.listening = false;
    }
  }

  /* ---------------- palabras: significado y pronunciación ---------------- */
  const wordCache = new Map();
  let popTimer = 0, popPinned = false, popWord = "";

  function ask(msg) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      return Promise.resolve({ ok: false, error: "Extensión no disponible" });
    }
    return chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e) }));
  }

  function lookup(word) {
    const key = word.toLowerCase();
    if (!wordCache.has(key)) {
      wordCache.set(key, ask({ type: "cre-word", word }).then((r) => {
        if (!r || !r.ok) wordCache.delete(key); // reintentar la próxima vez
        return r;
      }));
    }
    return wordCache.get(key);
  }

  function translateCurrent() {
    const cur = ex;
    if (!cur || cur.transLoading) return;
    cur.transLoading = true;
    const generation = cur.translationGeneration = (cur.translationGeneration || 0) + 1;
    ask({ type: "cre-translate", text: cur.cue.practice || cur.cue.text }).then((r) => {
      if (generation !== cur.translationGeneration) return;
      cur.transLoading = false;
      cur.trans = r && r.ok ? r.text : "No se pudo traducir (sin conexión).";
      if (ex === cur) renderExercise();
    });
  }

  function placePop(anchor) {
    const pop = $(".pop");
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - 8));
    let top = a.top - h - 10; // encima de la palabra: el panel está en la parte baja del video
    if (top < 8) top = a.bottom + 10;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function renderPop(word, r) {
    const pop = $(".pop");
    if (!r) {
      pop.innerHTML = `<div class="pw">${esc(word)}</div><div class="pm muted">Buscando…</div>`;
      return;
    }
    if (!r.ok) {
      pop.innerHTML = `<div class="pw">${esc(word)}</div><div class="pm muted">${esc(r.error || "No encontrada")}</div>`;
      return;
    }
    const groups = (r.groups || []).map((g) => `<div class="pg"><span>${esc(g.pos)}</span> ${esc(g.terms.join(", "))}</div>`).join("");
    pop.innerHTML = `
      <div class="ph">
        <div>
          <div class="pw">${esc(word)}</div>
          ${r.es ? `<div class="pp" title="Cómo se dice, escrito para hispanohablantes">${esc(r.es)}</div>` : `<div class="pm muted">Pronunciación no disponible</div>`}
          ${r.ipa ? `<div class="pi">${esc(r.ipa)}</div>` : ""}
        </div>
        <button class="say" title="Escuchar la palabra">🔊</button>
      </div>
      <div class="pm">${esc(r.meaning || "Sin traducción")}</div>
      ${groups}
      ${r.error ? `<div class="pi">${esc(r.error)}</div>` : ""}`;
  }

  function showPop(el) {
    const word = el.dataset.w;
    if (!word) return;
    const pop = $(".pop");
    popWord = word;
    pop.hidden = false;
    renderPop(word, null);
    placePop(el);
    lookup(word).then((r) => {
      if (popWord !== word || pop.hidden) return;
      renderPop(word, r);
      placePop(el);
    });
  }

  function hidePop(force) {
    if (popPinned && !force) return;
    popPinned = false;
    popWord = "";
    const pop = shadow.querySelector(".pop");
    if (pop) pop.hidden = true;
  }

  function sayWord(word) {
    if (!window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.85;
    const voice = synth.getVoices().find((v) => v.lang === "en-US") || synth.getVoices().find((v) => /^en/.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
  }

  root.addEventListener("mouseover", (e) => {
    const t = e.target.closest(".tok");
    if (t) {
      clearTimeout(popTimer);
      if (popPinned) return;
      popTimer = setTimeout(() => showPop(t), 120);
    } else if (e.target.closest(".pop")) clearTimeout(popTimer);
  });
  root.addEventListener("mouseout", (e) => {
    const to = e.relatedTarget;
    if (e.target.closest(".tok") || e.target.closest(".pop")) {
      if (to && to.closest && (to.closest(".pop") || to.closest(".tok"))) return;
      clearTimeout(popTimer);
      popTimer = setTimeout(() => hidePop(false), 250);
    }
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest(".tok");
    if (t) { // clic: fija el recuadro hasta hacer clic fuera
      clearTimeout(popTimer);
      showPop(t);
      popPinned = true;
      return;
    }
    if (e.target.closest(".say")) { sayWord(popWord); return; }
    if (!e.target.closest(".pop")) hidePop(true);
  });

  /* ---------------- acciones ---------------- */
  function primary() {
    if (!ex || phase === "replay") return;
    if (ex.passed) return continueVideo();
    if (ex.mode === "speak") return ex.listening ? stopMic(false) : startMic();
    return checkWritten();
  }

  function act(name) {
    if (!ex) return;
    switch (name) {
      case "primary": primary(); break;
      case "replay": replay(false); break;
      case "slow": replay(true); break;
      case "tts": tts(); break;
      case "hint":
        ex.hint = Math.min(2, ex.hint + 1);
        ex.showText = false;
        setStatus(ex.hint >= 2 ? "Esta es la línea. Escríbela para seguir." : "Primera letra de cada palabra.");
        renderExercise();
        focusInput();
        break;
    }
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act) act(b.dataset.act);
    else if (b.dataset.mode) saveSettings({ mode: b.dataset.mode });
    else if (b.classList.contains("power")) {
      const on = !settings.enabled;
      if (!on) closeExercise();
      saveSettings({ enabled: on });
    }
  });

  $(".write input").addEventListener("input", () => {
    if (ex && ex.memory && ex.showText) { ex.showText = false; renderExercise(); }
  });

  $(".file input").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const ep = currentEpisode();
    if (ep !== episodeId) await switchEpisode(ep);
    setCues(parseSubtitles(await f.text(), f.name.split(".").pop()), f.name, "manual");
    e.target.value = "";
  });

  // Mientras hay una frase pendiente, un clic en el video solo cierra el
  // diccionario; no llega a los controles nativos que reanudan o adelantan.
  function guardPlayerClick(e) {
    if (!ex || e.composedPath().includes(host)) return;
    if (e.type === "click") hidePop(true);
    if (!video) return;
    const r = video.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
    window.addEventListener(name, guardPlayerClick, { capture: true, passive: false });
  }
  // Los controles de la extensión tampoco deben burbujear al reproductor.
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
    root.addEventListener(name, (e) => e.stopPropagation());
  }

  // Mientras hay ejercicio, el teclado es nuestro: Crunchyroll no recibe atajos.
  window.addEventListener("keydown", (e) => {
    if (!ex) return;
    const inside = e.composedPath().includes(host);
    const typing = inside && e.composedPath()[0] && e.composedPath()[0].tagName === "INPUT";
    if (typing) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); primary(); }
      return;
    }
    const k = e.code;
    const keys = { Space: "primary", Enter: "primary", KeyR: "replay", KeyL: "slow" };
    if (keys[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) act(keys[k]);
    } else if (inside) e.stopPropagation();
  }, true);

  /* ---------------- ajustes ---------------- */
  async function saveSettings(patch) {
    const prev = settings;
    settings = Object.assign({}, settings, patch);
    applySettings(prev);
    await store.set({ settings });
  }

  function applySettings(prev) {
    document.documentElement.classList.toggle("cre-hide-subs", !!settings.hideNativeSubs);
    if (cues.length && !ex) { computeTargets(); resync(); }
    if (ex && prev && (prev.mode !== settings.mode || prev.dictation !== settings.dictation)) {
      stopMic(true);
      if (phase === "replay") video.playbackRate = savedRate;
      video.pause();
      phase = "exercise";
      ex.mode = settings.mode === "mix" ? ((exerciseCount - 1) % 2 ? "write" : "speak") : settings.mode;
      ex.showText = ex.mode === "write" && (!settings.dictation || (playback && !isEnglish(playback.audioLocale)));
      ex.memory = ex.mode === "write" && settings.dictation && playback && !isEnglish(playback.audioLocale);
      if (!ex.passed) { ex.result = null; ex.heard = null; }
      hidePop(true);
      renderExercise();
      if (!ex.passed) {
        setStatus(ex.mode === "write" ? "Escribe la línea y pulsa Enter." : "Pulsa 🎤 Hablar y di la línea.");
        if (ex.mode === "write") focusInput();
        else if (settings.autoMic) startMic();
      }
    }
    renderPill();
  }

  store.onChange((changes) => {
    if (changes.settings) {
      const prev = settings;
      settings = Object.assign({}, settings, changes.settings.newValue || {});
      applySettings(prev);
      if (prev && settings.enabled === false) closeExercise();
      if (prev && playback && (prev.subLang !== settings.subLang || prev.translationLang !== settings.translationLang)) {
        loadFromPlayback(playback);
      }
    }
    if (changes["ep:" + episodeId] && !changes["ep:" + episodeId].newValue) {
      progress = { passed: {} }; // progreso reiniciado desde el popup
      renderPill();
    }
  });

  /* ---------------- arranque ---------------- */
  let pendingPlayback = null;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.source !== "cre-hook" || e.data.type !== "playback") return;
    const payload = e.data.payload;
    if (!payload || typeof payload !== "object" || typeof payload.audioLocale !== "string" && payload.audioLocale !== null) return;
    if (settings) loadFromPlayback(e.data.payload);
    else pendingPlayback = e.data.payload;
  });

  // Navegación interna (SPA): al cambiar de episodio se reinicia el estado.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      const ep = currentEpisode();
      if (ep !== episodeId) switchEpisode(ep);
    }
  }, 700);

  (async function init() {
    settings = await loadSettings();
    await switchEpisode(currentEpisode());
    applySettings();
    if (pendingPlayback) loadFromPlayback(pendingPlayback);
    else window.postMessage({ source: "cre-content", type: "get-playback" }, location.origin);
    // Temporizador y no requestAnimationFrame: rAF se detiene en pestañas ocultas
    // y en algunos modos sin interfaz. 25 ms da una pausa precisa al final de la línea.
    setInterval(tick, 25);
  })();

  // Estado visible para las pruebas automáticas (solo lectura).
  function exposeState() {
    host.dataset.phase = phase;
    host.dataset.load = loadState;
    host.dataset.targets = String(targets.length);
    host.dataset.idx = String(idx);
    host.dataset.score = ex && ex.result ? String(ex.result.score) : "";
    host.dataset.passed = ex ? String(ex.passed) : "";
    host.dataset.mode = ex ? ex.mode : "";
  }
  setInterval(exposeState, 100);
})();
