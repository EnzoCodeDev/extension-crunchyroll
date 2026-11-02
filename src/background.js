/* Service worker:
   1) descarga subtítulos cuando el CDN no deja leerlos desde la página (CORS);
   2) busca palabras: significado y pronunciación para hispanohablantes;
   3) traduce una línea completa cuando el episodio no trae subtítulos en español.
   Solo atiende a los frames de Crunchyroll y YouTube. */
importScripts("pron.js", "network.js");

function fromCrunchyroll(sender) {
  try {
    const url = new URL(sender.url);
    return !!sender.tab && url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (/(^|\.)crunchyroll\.com$/.test(url.hostname) || ["www.youtube.com", "m.youtube.com", "youtube.com"].includes(url.hostname));
  } catch (_) { return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !fromCrunchyroll(sender)) return false;
  let job = null;
  if (msg.type === "cre-fetch") job = fetchSubtitle(msg.url);
  else if (msg.type === "cre-word") job = lookupWord(String(msg.word || ""));
  else if (msg.type === "cre-translate") job = translateLine(String(msg.text || ""));
  else if (msg.type === "cre-pronounce") job = pronounceLine(String(msg.text || ""));
  if (!job) return false;
  job.then(reply, (e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true; // respuesta asíncrona
});

async function fetchSubtitle(url) {
  const target = CRENetwork.subtitleUrl(url);
  const r = await fetch(target, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15000) });
  return r.ok ? { ok: true, text: await r.text() } : { ok: false, error: "HTTP " + r.status };
}

/* ---------- diccionarios locales (se cargan la primera vez) ---------- */
let speakDict = null, cmu = null;

async function loadDicts() {
  if (!speakDict) speakDict = await (await fetch(chrome.runtime.getURL("data/speak-dict.json"))).json();
  if (!cmu) {
    const text = await (await fetch(chrome.runtime.getURL("data/cmudict.txt"))).text();
    const map = new Map();
    for (const line of text.split("\n")) {
      const i = line.indexOf(" ");
      if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
    }
    cmu = map;
  }
}

function cmuLookup(word) {
  for (const k of [word, word.replace(/^'+|'+$/g, ""), word.replace(/'s$/, ""), word.replace(/in'$/, "ing")]) {
    if (k && cmu.has(k)) return { key: k, arpabet: cmu.get(k) };
  }
  return null;
}

/* ---------- traducción (Google Translate, sin clave) ---------- */
const POS_ES = {
  noun: "sustantivo", verb: "verbo", adjective: "adjetivo", adverb: "adverbio", pronoun: "pronombre",
  preposition: "preposición", conjunction: "conjunción", interjection: "interjección", article: "artículo",
  abbreviation: "abreviatura", prefix: "prefijo", suffix: "sufijo", phrase: "frase", "auxiliary verb": "verbo auxiliar",
};

async function googleTranslate(text, dict) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dj=1&dt=t" +
    (dict ? "&dt=bd" : "") + "&q=" + encodeURIComponent(text);
  const r = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Traductor no disponible (HTTP " + r.status + ")");
  return r.json();
}

async function meaningOf(word) {
  const key = "w:" + word;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return cached;
  const data = await googleTranslate(word, true);
  const main = (data.sentences || []).map((s) => s.trans || "").join("").trim();
  const groups = (data.dict || []).slice(0, 3).map((d) => ({
    pos: POS_ES[d.pos] || d.pos || "",
    terms: (d.terms || []).slice(0, 4),
  })).filter((g) => g.terms.length);
  const out = { main, groups };
  await chrome.storage.local.set({ [key]: out });
  return out;
}

async function pronounceLine(text) {
  if (!text.trim() || text.length > 2000) return { ok: false, error: "Texto vacío o demasiado largo" };
  await loadDicts();
  // Solo diccionarios locales: no dispara una traducción por cada palabra.
  const out = text.replace(/[A-Za-z0-9][A-Za-z0-9'’]*(?:-[A-Za-z]+)*/g, (raw) => {
    const word = CREPron.wordKey(raw);
    const own = speakDict[word];
    if (own && own[1]) return own[1];
    const c = cmuLookup(word);
    const p = c && CREPron.fromArpabet(c.arpabet, c.key);
    return p && p.es ? p.es : `[${raw}]`;
  });
  return { ok: true, text: out };
}

async function lookupWord(raw) {
  const word = CREPron.wordKey(raw);
  if (!word || word.length > 100 || !/^[a-z0-9'-]+$/.test(word)) return { ok: false, error: "Palabra no válida" };
  await loadDicts();
  const res = { ok: true, word, es: "", ipa: "", meaning: "", groups: [], source: "" };
  const own = speakDict[word];
  const c = cmuLookup(word);
  if (c) {
    const p = CREPron.fromArpabet(c.arpabet, c.key);
    if (p) { res.es = p.es; res.ipa = p.ipa; }
  }
  // Las entradas escritas a mano en Speak tienen prioridad.
  if (own) { res.meaning = own[0]; res.es = own[1]; res.source = "speak"; }
  try {
    const m = await meaningOf(word);
    if (!own) { res.meaning = m.main; res.source = "google"; }
    res.groups = m.groups;
  } catch (_) {
    if (!own) res.error = "Sin conexión con el traductor: solo pronunciación.";
  }
  return res;
}

async function translateLine(text) {
  if (!text.trim() || text.length > 2000) return { ok: false, error: "Texto vacío o demasiado largo" };
  const key = "t:" + text;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return { ok: true, text: cached };
  const data = await googleTranslate(text, false);
  const out = (data.sentences || []).map((s) => s.trans || "").join("").trim();
  await chrome.storage.local.set({ [key]: out });
  return { ok: true, text: out };
}
