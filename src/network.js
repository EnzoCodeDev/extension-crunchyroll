/* Política compartida para subtítulos. No permite redirecciones, credenciales,
   hosts arbitrarios ni puertos alternativos procedentes de mensajes de página. */
(function (root) {
  "use strict";
  function subtitleUrl(raw) {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/(^|\.)(crunchyroll\.com|vrv\.co)$/.test(url.hostname)) {
      throw new Error("Destino de subtítulos no permitido");
    }
    return url.href;
  }
  const api = { subtitleUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CRENetwork = api;
})(globalThis);
