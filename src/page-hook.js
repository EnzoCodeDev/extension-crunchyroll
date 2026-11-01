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

  function publish(url, data) {
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
    if (e.data.type === "get-playback" && last) {
      window.postMessage({ source: SOURCE, type: "playback", payload: last }, location.origin);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await originalFetch.apply(this, arguments);
    try {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      if (res.ok && isPlayback(url)) res.clone().json().then((d) => publish(url, d)).catch(() => {});
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
    if (isPlayback(this.__creUrl)) {
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
})();
