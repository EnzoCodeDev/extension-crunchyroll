/* ============================================================
   Puntuación (misma lógica que speak-english-enzo/src/lib/scoring.ts).
   El texto dicho o escrito y la línea objetivo se normalizan y se comparan
   con alineación palabra a palabra más distancia de edición por caracteres.
   ============================================================ */
(function (root) {
  "use strict";

  const CONTRACTIONS = {
    "i'm": "i am", "i've": "i have", "i'll": "i will", "i'd": "i would", "you're": "you are",
    "you've": "you have", "you'll": "you will", "you'd": "you would", "he's": "he is", "she's": "she is",
    "it's": "it is", "we're": "we are", "we've": "we have", "we'll": "we will", "they're": "they are",
    "they've": "they have", "they'll": "they will", "that's": "that is", "there's": "there is",
    "here's": "here is", "what's": "what is", "who's": "who is", "where's": "where is", "how's": "how is",
    "let's": "let us", "don't": "do not", "doesn't": "does not", "didn't": "did not", "can't": "cannot",
    "couldn't": "could not", "won't": "will not", "wouldn't": "would not", "shouldn't": "should not",
    "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not", "haven't": "have not",
    "hasn't": "has not", "hadn't": "had not", "ain't": "is not", "gonna": "going to",
    "wanna": "want to", "gotta": "got to", "'em": "them", "o'clock": "oclock",
    // Variantes sin apóstrofo: el reconocedor las devuelve así a menudo.
    "im": "i am", "ive": "i have", "ill": "i will", "youre": "you are", "youve": "you have",
    "youll": "you will", "youd": "you would", "hes": "he is", "shes": "she is", "its": "it is",
    "weve": "we have", "theyre": "they are", "theyve": "they have", "thats": "that is",
    "theres": "there is", "heres": "here is", "whats": "what is", "whos": "who is",
    "wheres": "where is", "hows": "how is", "lets": "let us", "dont": "do not",
    "doesnt": "does not", "didnt": "did not", "cant": "cannot", "couldnt": "could not",
    "wont": "will not", "wouldnt": "would not", "shouldnt": "should not", "isnt": "is not",
    "arent": "are not", "wasnt": "was not", "werent": "were not", "havent": "have not",
    "hasnt": "has not", "hadnt": "had not",
  };

  const NUMBERS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven",
    "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve", "20": "twenty",
    "25": "twenty five", "30": "thirty", "100": "one hundred",
  };

  const SPELLINGS = { ok: "okay", mike: "mic" };

  const CONTRACTION_RES = Object.entries(CONTRACTIONS).map(
    ([k, v]) => [new RegExp("\\s" + k + "\\s", "g"), " " + v + " "],
  );

  function normalize(text) {
    let t = " " + String(text || "").toLowerCase().trim() + " ";
    t = t.replace(/[’‘`´]/g, "'");
    // Separa puntuación ANTES de expandir: «that's...» debe ser «that is»,
    // no «that s». Conserva el apóstrofo hasta terminar las contracciones.
    t = t.replace(/[^a-z0-9'\s]/g, " ");
    // Las regex de contracciones necesitan espacios a ambos lados de cada palabra.
    t = t.replace(/\s+/g, "  ");
    for (const [re, v] of CONTRACTION_RES) t = t.replace(re, v);
    // Tras expandir contracciones, el apóstrofo restante es parte de un nombre
    // o posesivo: Knight's → knights, no dos palabras «knight s».
    t = t.replace(/'/g, "");
    t = t.replace(/[^a-z0-9\s]/g, " ");
    t = t.replace(/\so\s+k\s/g, " okay ").replace(/\sgood\s+bye\s/g, " goodbye ");
    const words = t.split(/\s+/).filter(Boolean).map((w) => NUMBERS[w] || SPELLINGS[w] || w);
    return words.join(" ").split(" ").filter(Boolean);
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function charSim(a, b) {
    const A = a.join(""), B = b.join("");
    if (!A.length && !B.length) return 1;
    return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
  }

  function wordSim(a, b) {
    if (a === b) return 1;
    return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
  }

  function reconcileSplits(target, said) {
    const targetSet = new Set(target);
    const pairs = new Map();
    for (let i = 0; i < target.length - 1; i++) pairs.set(target[i] + target[i + 1], [target[i], target[i + 1]]);
    const out = [];
    for (let i = 0; i < said.length; i++) {
      const w = said[i];
      const next = said[i + 1];
      if (next !== undefined && !targetSet.has(w) && targetSet.has(w + next)) { out.push(w + next); i++; continue; }
      const pair = pairs.get(w);
      if (!targetSet.has(w) && pair) { out.push(...pair); continue; }
      out.push(w);
    }
    return out;
  }

  const SOUNDALIKES = {
    cheese: ["she", "is"], sheez: ["she", "is"], sheesh: ["she", "is"], shees: ["she", "is"],
    his: ["he", "is"], hees: ["he", "is"],
  };

  function reconcileSoundalikes(target, said) {
    const targetSet = new Set(target);
    const joined = " " + target.join(" ") + " ";
    return said.flatMap((w) => {
      const fix = SOUNDALIKES[w];
      return fix && !targetSet.has(w) && joined.includes(" " + fix.join(" ") + " ") ? fix : [w];
    });
  }

  function alignWords(target, said) {
    const m = target.length, n = said.length;
    const score = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) score[i][0] = -i;
    for (let j = 1; j <= n; j++) score[0][j] = -j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const s = wordSim(target[i - 1], said[j - 1]);
        score[i][j] = Math.max(score[i - 1][j - 1] + (s >= 0.6 ? s : -0.4), score[i - 1][j] - 1, score[i][j - 1] - 1);
      }
    }
    const out = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const s = wordSim(target[i - 1], said[j - 1]);
        const diag = score[i - 1][j - 1] + (s >= 0.6 ? s : -0.4);
        if (score[i][j] === diag) { out.unshift({ word: target[i - 1], sim: s }); i--; j--; continue; }
      }
      if (i > 0 && score[i][j] === score[i - 1][j] - 1) { out.unshift({ word: target[i - 1], sim: 0 }); i--; continue; }
      j--;
      if (j < 0) break;
    }
    return out;
  }

  function evaluate(targetText, saidText) {
    const target = normalize(targetText);
    const raw = normalize(saidText);
    if (!raw.length) return { score: 0, words: target.map((w) => ({ word: w, sim: 0 })) };
    const said = reconcileSplits(target, reconcileSoundalikes(target, raw));
    const words = alignWords(target, said);
    const credit = words.reduce((a, w) => a + (w.sim >= 0.999 ? 1 : w.sim >= 0.8 ? 0.25 : 0), 0);
    const wordScore = credit / (target.length || 1);
    const charScore = Math.max(0, Math.min(1, (charSim(target, said) - 0.55) / 0.45));
    const extraPenalty = Math.min(0.3, Math.max(0, said.length - target.length) * 0.1);
    const combined = wordScore * 0.8 + charScore * 0.2 - extraPenalty;
    return { score: Math.max(0, Math.round(combined * 100)), words };
  }

  function dedupeChunks(chunks) {
    const words = (c) => normalize(c[0] || "");
    const has = (big, small) => {
      for (let i = 0; i + small.length <= big.length; i++) if (small.every((w, j) => big[i + j] === w)) return true;
      return false;
    };
    let kept = [];
    for (const c of chunks) {
      const w = words(c);
      if (!w.length) continue;
      const acc = kept.flatMap(words);
      if (acc.length && has(acc, w)) continue;
      if (acc.length && w.length > acc.length && has(w, acc)) kept = [c];
      else kept.push(c);
    }
    return kept;
  }

  function cleanChunks(chunks, mobile) {
    const w = chunks.map((c) => normalize(c[0] || "").join(" "));
    const buggy = w.some((cur, i) => i > 0 && w[i - 1] &&
      ((cur.length > w[i - 1].length && cur.startsWith(w[i - 1] + " ")) || (cur === w[i - 1] && cur.includes(" "))));
    return mobile || buggy ? dedupeChunks(chunks) : chunks;
  }

  /** Arma la frase con cada alternativa del reconocedor y se queda con la mejor. */
  function evaluateBest(target, chunks) {
    if (!chunks.length) return null;
    const maxAlts = Math.max(...chunks.map((c) => c.length));
    let best = null;
    for (let a = 0; a < maxAlts; a++) {
      const text = chunks.map((c) => c[Math.min(a, c.length - 1)]).join(" ").trim();
      if (!text) continue;
      const r = evaluate(target, text);
      if (!best || r.score > best.score) best = Object.assign({}, r, { transcript: text });
    }
    return best;
  }

  const api = { normalize, evaluate, evaluateBest, cleanChunks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CREScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
