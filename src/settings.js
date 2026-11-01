/* Ajustes compartidos por el script de la página y el popup. */
(function (root) {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    mode: "speak", // "speak" | "write" | "mix"
    threshold: 80, // % mínimo para pasar a la siguiente línea (como en Speak)
    every: 1, // practicar 1 de cada N líneas
    minWords: 2, // las líneas más cortas se dejan pasar sin ejercicio
    autoMic: true, // abrir el micrófono al pausar
    autoContinue: true, // seguir el video al superar la línea
    skipPassed: true, // no volver a parar en líneas ya superadas
    dictation: false, // al escribir: false = la línea se muestra para copiarla; true = dictado
    pauseOffset: 0, // segundos: negativo pausa antes del final del subtítulo
    revealAfter: 3, // intentos fallidos antes de ofrecer la respuesta al escribir
    hideNativeSubs: false,

    subLang: "en-US",
    translationLang: "es-419",
  };

  // chrome.storage cuando corre como extensión; localStorage en pruebas sueltas.
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  const store = {
    async get(keys) {
      if (hasChrome) return chrome.storage.local.get(keys);
      const out = {};
      for (const k of [].concat(keys)) {
        const v = localStorage.getItem("cre:" + k);
        if (v !== null) out[k] = JSON.parse(v);
      }
      return out;
    },
    async set(obj) {
      if (hasChrome) return chrome.storage.local.set(obj);
      for (const [k, v] of Object.entries(obj)) localStorage.setItem("cre:" + k, JSON.stringify(v));
    },
    async remove(keys) {
      if (hasChrome) return chrome.storage.local.remove(keys);
      for (const k of [].concat(keys)) localStorage.removeItem("cre:" + k);
    },
    onChange(fn) {
      if (hasChrome) chrome.storage.onChanged.addListener((changes, area) => area === "local" && fn(changes));
    },
  };

  async function loadSettings() {
    const { settings } = await store.get("settings");
    return Object.assign({}, DEFAULTS, settings || {});
  }

  function today(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Racha de días seguidos con al menos una línea superada (hoy o ayer cuenta). */
  function streak(days) {
    let n = 0;
    const d = new Date();
    if (!(days[today(d)] && days[today(d)].passed)) d.setDate(d.getDate() - 1);
    while (days[today(d)] && days[today(d)].passed) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const api = { DEFAULTS, store, loadSettings, today, streak };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CRESettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
