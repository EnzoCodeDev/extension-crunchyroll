/* ============================================================
   Pronunciación para hispanohablantes a partir de fonemas ARPAbet
   (Diccionario de Pronunciación de CMU), con el mismo estilo que la app
   Speak: sílabas separadas por guiones y la sílaba tónica en MAYÚSCULAS
   con tilde («a-BÁUT», «ÁK-chu-a-li»). También genera el AFI.
   ============================================================ */
(function (root) {
  "use strict";

  const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);

  // Inicios de sílaba (ataques) válidos en inglés para repartir consonantes.
  const ONSETS = new Set([
    "P R", "B R", "T R", "D R", "K R", "G R", "F R", "TH R", "SH R",
    "P L", "B L", "K L", "G L", "F L", "S L",
    "S P", "S T", "S K", "S M", "S N", "S W", "T W", "D W", "K W", "G W",
    "S P R", "S T R", "S K R", "S P L", "S K W",
    "P Y", "B Y", "K Y", "G Y", "D Y", "T Y", "N Y", "L Y", "F Y", "M Y", "V Y", "HH Y",
  ]);

  const VOWEL_ES = {
    AA: "a", AE: "a", AH: "a", AO: "o", AW: "au", AY: "ai", EH: "e", ER: "er",
    EY: "ei", IH: "i", IY: "i", OW: "ou", OY: "oi", UH: "u", UW: "u",
  };
  const CONS_ES = {
    B: "b", CH: "ch", D: "d", DH: "d", F: "f", G: "g", HH: "j", JH: "y", K: "k", L: "l",
    M: "m", N: "n", NG: "ng", P: "p", R: "r", S: "s", SH: "sh", T: "t", TH: "z", V: "v",
    W: "u", Y: "i", Z: "s", ZH: "sh",
  };
  const IPA = {
    AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ", EY: "eɪ", IH: "ɪ",
    IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
    B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m",
    N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j",
    Z: "z", ZH: "ʒ",
  };
  const ACCENT = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };

  function parse(arpabet) {
    return String(arpabet).trim().split(/\s+/).filter(Boolean).map((p) => {
      const m = p.match(/^([A-Z]+)([012])?$/);
      return { ph: m ? m[1] : p, stress: m && m[2] !== undefined ? Number(m[2]) : -1 };
    });
  }

  const LAX = new Set(["AE", "EH", "IH", "UH", "AA", "AH"]);

  /** Divide en sílabas: cada vocal es un núcleo y las consonantes intermedias
   *  se reparten con el ataque válido más largo para la sílaba siguiente. Tras
   *  una vocal corta (cat, bed, sit) un grupo deja su primera consonante atrás,
   *  como escribe Speak: ÁS-king, ÁD-res, BÁZ-rum. */
  function syllabify(phones) {
    const nuclei = [];
    phones.forEach((p, i) => { if (VOWELS.has(p.ph)) nuclei.push(i); });
    if (!nuclei.length) return [phones];
    const cuts = [0];
    for (let k = 1; k < nuclei.length; k++) {
      const a = nuclei[k - 1] + 1, b = nuclei[k];
      const cluster = phones.slice(a, b).map((p) => p.ph);
      let take = 0; // consonantes que pasan a la sílaba siguiente
      for (let n = Math.min(3, cluster.length); n >= 1; n--) {
        const tail = cluster.slice(cluster.length - n);
        // Dentro de la palabra la «s» de s+consonante se queda atrás: iks-PLÉIN, ins-TÉD.
        if (n === 1 ? tail[0] !== "NG" : ONSETS.has(tail.join(" ")) && tail[0] !== "S") { take = n; break; }
      }
      const prev = phones[nuclei[k - 1]];
      if (take > 1 && take === cluster.length && LAX.has(prev.ph) && prev.stress === 1 && cluster[cluster.length - 1] !== "Y") take--;
      cuts.push(b - take);
    }
    const out = [];
    for (let k = 0; k < cuts.length; k++) out.push(phones.slice(cuts[k], cuts[k + 1] ?? phones.length));
    return out;
  }

  /** Grupos vocálicos de la ortografía, uno por sílaba si cuadran (si no, null). */
  function spelledVowels(word, nSyl) {
    if (!word) return null;
    let w = String(word).toLowerCase().replace(/[^a-z]/g, "").replace(/^y(?=[aeiou])/, "");
    let groups = w.match(/[aeiouy]+/g) || [];
    if (groups.length > nSyl && /[^aeiouy](e|es|ed)$/.test(w) && groups[groups.length - 1] === "e") groups = groups.slice(0, -1);
    return groups.length === nSyl ? groups : null;
  }

  const LETTER = { a: "a", e: "e", i: "i", o: "o", u: "u", y: "i" };

  /** Letras de cada fonema de la sílaba (array paralelo a syl). */
  function syllablePieces(syl, ctx) {
    const g = ctx.spelled;
    const pieces = syl.map((p, i) => {
      const next = syl[i + 1];
      if (VOWELS.has(p.ph)) {
        let v = VOWEL_ES[p.ph];
        const beforeFinalL = next && next.ph === "L" && i + 2 === syl.length;
        if (p.ph === "AH" && p.stress === 0) {
          if (beforeFinalL) v = g === "u" && syl[0].ph === "F" ? "u" : "o"; // able → ÉI-bol, careful → KÉR-ful
          else if (g) v = /^(io|ou)/.test(g) ? "o" : LETTER[g[0]] || v; // accident → ÁK-si-dent, attention → a-TÉN-shon
          else if (next && next.ph === "N") v = "e"; // didn't → DÍ-dent
        } else if (p.ph === "IH" && p.stress === 0 && ctx.last && g === "e") v = "e"; // decided → di-SÁI-ded
        else if (p.ph === "ER" && p.stress !== 1) v = (g && /^[aeo]/.test(g) ? LETTER[g[0]] : "e") + (ctx.rToNext ? "" : "r");
        else if (p.ph === "AA" && ((g && /^(o|aw|au)/.test(g)) || (i > 0 && syl[i - 1].ph === "W"))) v = "o"; // box, want → UÓNT
        return v;
      }
      const nextIsVowel = next && VOWELS.has(next.ph);
      let c = CONS_ES[p.ph] || "";
      if (p.ph === "G" && ((nextIsVowel && /^[ei]/.test(VOWEL_ES[next.ph])) || (next && next.ph === "Y"))) c = "gu";
      if (p.ph === "Y" && i === 0 && ctx.prevEndsVowel !== false) c = "y";
      if (p.ph === "JH" && !nextIsVowel && !(next && next.ph === "Y")) c = "ch"; // al final suena «ch» (change → CHEINCH)
      if (p.ph === "NG" && ((!next && /^(G|K)$/.test(ctx.nextStart || "")) || (next && /^(G|K)$/.test(next.ph)))) c = "n";
      return c;
    });
    // «g» ante e/i se escribe «gu» (strongest → STRÓN-guest).
    for (let i = 0; i < pieces.length - 1; i++) if (pieces[i] === "g" && /^[eéií]/.test(pieces[i + 1])) pieces[i] = "gu";
    return pieces;
  }

  function accentFirstVowel(s) {
    return s.replace(/[aeiou]/, (v) => ACCENT[v]);
  }

  /** «AH0 B AW1 T» (+ «about» para guiarse por la ortografía) → { es: "a-BÁUT", ipa: "/əˈbaʊt/" } */
  function fromArpabet(arpabet, word) {
    const phones = parse(arpabet);
    if (!phones.length) return null;
    const syls = syllabify(phones);
    const multi = syls.length > 1;
    const spelled = spelledVowels(word, syls.length);
    // ER átona seguida de vocal (around = ER0 AW1): la «r» pasa a la sílaba siguiente.
    const rToNext = syls.map((syl, k) => {
      const last = syl[syl.length - 1];
      return !!(syls[k + 1] && last.ph === "ER" && last.stress !== 1 && VOWELS.has(syls[k + 1][0].ph));
    });
    const parts = syls.map((syl, k) => {
      const prev = k > 0 ? syls[k - 1][syls[k - 1].length - 1] : null;
      const ctx = {
        prevEndsVowel: prev ? VOWELS.has(prev.ph) && !rToNext[k - 1] : null,
        nextStart: syls[k + 1] ? syls[k + 1][0].ph : "",
        spelled: spelled ? spelled[k] : null,
        rToNext: rToNext[k],
        rFromPrev: k > 0 && rToNext[k - 1],
        last: k === syls.length - 1,
      };
      const pieces = syllablePieces(syl, ctx);
      const stressed = syl.some((p) => p.stress === 1);
      if (stressed && (multi || (syl[0].ph === "W" && syl.length > 1))) {
        // Tilde en polisílabas; en monosílabas solo si empiezan con «u» de W (want → UÓNT).
        const vi = syl.findIndex((p) => VOWELS.has(p.ph));
        pieces[vi] = accentFirstVowel(pieces[vi]);
      }
      let s = (ctx.rFromPrev ? "r" : "") + pieces.join("");
      if (stressed) s = s.toUpperCase();
      return s;
    });
    const ipa = syls.map((syl) => {
      const stressed = syl.some((p) => p.stress === 1);
      const secondary = syl.some((p) => p.stress === 2);
      const body = syl.map((p) => (p.ph === "AH" && p.stress === 0 ? "ə" : p.ph === "ER" && p.stress === 0 ? "ɚ" : IPA[p.ph] || "")).join("");
      return (multi && stressed ? "ˈ" : multi && secondary ? "ˌ" : "") + body;
    }).join("");
    return { es: parts.join("-"), ipa: "/" + ipa + "/" };
  }

  /** Clave de búsqueda de una palabra tal como aparece en el subtítulo. */
  function wordKey(token) {
    return String(token).toLowerCase().replace(/[’‘`´]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
  }

  const api = { fromArpabet, syllabify, parse, wordKey, spelledVowels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CREPron = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
