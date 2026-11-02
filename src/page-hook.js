/* Se ejecuta en el contexto de la página (world MAIN) antes que Crunchyroll.
   Solo LEE la respuesta de reproducción para conocer las URLs de los
   subtítulos; no modifica peticiones ni respuestas. */
(function () {
  "use strict";
  if (window.__creHookInstalled) return;
  window.__creHookInstalled = true;

  const SOURCE = "cre-hook";
  let last = null;

  function isPlayback(url) {
    // /playback/v3/<id>/web/chrome/play, /playback/v4/..., o el servicio de reproducción.
    // Además, publish() exige que la respuesta traiga subtitles/captions.
    return typeof url === "string" && /\/play(\?|$)/.test(url.split("#")[0]);
  }

  function youtubeVideoId() {
    try {
      const u = new URL(location.href);
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
      const id = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
      return /^[\w-]{11}$/.test(id || "") ? id : null;
    } catch (_) { return null; }
  }

  function isYouTubePlayer(url) {
    try {
      const u = new URL(url, location.href);
      return /(^|\.)youtube\.com$/.test(u.hostname) && /^\/youtubei\/v1\/player\/?$/.test(u.pathname);
    } catch (_) { return false; }
  }

  function normalizeYouTube(data) {
    const videoId = youtubeVideoId();
    if (!videoId || data?.videoDetails?.videoId !== videoId) return null;
    const renderer = data.captions?.playerCaptionsTracklistRenderer;
    const subtitles = {};
    const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks.filter((t) => t && typeof t === "object") : [];
    // Keep the first manual track for each language before considering ASR.
    for (const t of [...tracks].sort((a, b) => Number(a.kind === "asr") - Number(b.kind === "asr"))) {
      const language = t.languageCode;
      if (typeof language !== "string" || !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language) || subtitles[language]) continue;
      try {
        const u = new URL(t.baseUrl);
        if (u.protocol !== "https:" || u.username || u.password || u.port || !/(^|\.)youtube\.com$/.test(u.hostname) || u.pathname !== "/api/timedtext") continue;
        // Do not serialize searchParams: that can rewrite signed query bytes.
        const base = t.baseUrl.split("#")[0];
        const url = /([?&])fmt=[^&]*/.test(base)
          ? base.replace(/([?&])fmt=[^&]*/g, "$1fmt=json3")
          : base + (base.includes("?") ? "&" : "?") + "fmt=json3";
        subtitles[language] = { url, format: "json3", language, kind: t.kind === "asr" ? "asr" : "manual" };
      } catch (_) { /* invalid/unprovided caption URL */ }
    }
    const audioLocale = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex]?.languageCode || data.videoDetails.defaultAudioLanguage;
    return { subtitles, captions: {}, audioLocale: typeof audioLocale === "string" ? audioLocale : null, platform: "youtube", videoId };
  }

  function publishYouTube(data) {
    const payload = normalizeYouTube(data);
    if (!payload) return false;
    if (last?.platform === "youtube" && JSON.stringify(last) === JSON.stringify(payload)) return true;
    last = payload;
    window.postMessage({ source: SOURCE, type: "playback", payload: last }, location.origin);
    return true;
  }

  function discoverYouTube() {
    if (!youtubeVideoId()) {
      if (last?.platform === "youtube") last = null;
      return;
    }
    if (last?.platform === "youtube" && last.videoId !== youtubeVideoId()) last = null;
    try {
      const player = document.getElementById("movie_player");
      if (publishYouTube(player?.getPlayerResponse?.())) return;
    } catch (_) { /* player may not be ready */ }
    try { publishYouTube(window.ytInitialPlayerResponse); } catch (_) { /* no metadata yet */ }
  }

  function publish(url, data) {
    if (isYouTubePlayer(url)) { publishYouTube(data); return; }
    if (!data || typeof data !== "object") return;
    if (!data.subtitles && !data.captions) return;
    last = {
      url,
      audioLocale: data.audioLocale || null,
      subtitles: data.subtitles || {},
      captions: data.captions || {},
      at: Date.now(),
    };
    window.postMessage({ source: SOURCE, type: "playback", payload: last }, location.origin);
  }

  // Si el script aislado arranca después, puede pedir la última respuesta.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "cre-content") return;
    if (e.data.type === "get-playback") {
      const previous = last;
      discoverYouTube();
      if (last && last === previous) window.postMessage({ source: SOURCE, type: "playback", payload: last }, location.origin);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await originalFetch.apply(this, arguments);
    try {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      if (res.ok && (isPlayback(url) || isYouTubePlayer(url))) res.clone().json().then((d) => publish(url, d)).catch(() => {});
    } catch (_) { /* nunca romper la página */ }
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__creUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (isPlayback(this.__creUrl) || isYouTubePlayer(this.__creUrl)) {
      this.addEventListener("load", function () {
        try {
          if (this.status >= 200 && this.status < 300) {
            const body = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
            publish(this.__creUrl, body);
          }
        } catch (_) { /* nada */ }
      });
    }
    return send.apply(this, arguments);
  };
  window.addEventListener("yt-navigate-finish", discoverYouTube);
  window.addEventListener("DOMContentLoaded", discoverYouTube);
  discoverYouTube();
})();
