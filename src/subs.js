/* ============================================================
   Lectura de subtítulos (ASS/SSA, WebVTT, SRT y YouTube JSON3) a una lista de líneas
   { start, end, text } en segundos, ordenada y lista para practicar.
   ============================================================ */
(function (root) {
  "use strict";

  function parseTime(s) {
    // 0:01:02.35 (ASS) · 00:01:02.350 / 01:02.350 (VTT) · 00:01:02,350 (SRT)
    const parts = String(s).trim().replace(",", ".").split(":");
    let sec = 0;
    for (const p of parts) sec = sec * 60 + parseFloat(p);
    return Number.isFinite(sec) ? sec : NaN;
  }

  // Estilos de carteles, canciones y rótulos: no son diálogo.
  const NON_DIALOGUE_STYLE = /sign|song|lyric|karaoke|kara|^os|^op\b|^ed\b|opening|ending|title|note|typeset|insert|logo|^tl/i;

  function parseAss(text) {
    const lines = text.split(/\r?\n/);
    let inEvents = false;
    let format = null;
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\[.*\]$/.test(trimmed)) { inEvents = /^\[events\]$/i.test(trimmed); continue; }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(trimmed)) {
        format = trimmed.replace(/^format\s*:/i, "").split(",").map((f) => f.trim().toLowerCase());
        continue;
      }
      if (!/^dialogue\s*:/i.test(trimmed)) continue;
      const fmt = format || ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
      const body = trimmed.replace(/^dialogue\s*:\s*/i, "");
      const fields = [];
      let rest = body;
      for (let i = 0; i < fmt.length - 1; i++) {
        const k = rest.indexOf(",");
        if (k < 0) break;
        fields.push(rest.slice(0, k));
        rest = rest.slice(k + 1);
      }
      fields.push(rest);
      const get = (name) => fields[fmt.indexOf(name)] ?? "";
      const raw = get("text");
      const style = get("style").trim();
      // Rótulos posicionados, dibujos vectoriales o estilos de cartel: fuera.
      if (/\\(pos|move)\s*\(|\\p[1-9]/.test(raw)) continue;
      if (NON_DIALOGUE_STYLE.test(style)) continue;
      const clean = raw.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, " ").replace(/\\h/g, " ");
      out.push({ start: parseTime(get("start")), end: parseTime(get("end")), text: clean });
    }
    return out;
  }

  function parseVttOrSrt(text) {
    const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
    const out = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const m = lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if (!m) continue;
      const body = lines.slice(i + 1).join(" ")
        .replace(/<[^>]*>/g, "")
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
      out.push({ start: parseTime(m[1]), end: parseTime(m[2]), text: body });
    }
    return out;
  }

  function parseJson3(text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { return []; }
    if (!Array.isArray(data?.events)) return [];
    const out = [];
    const windows = new Map();
    const events = data.events.filter((event) => event && typeof event.tStartMs === "number")
      .sort((a, b) => a.tStartMs - b.tStartMs);
    for (const event of events) {
      const key = event.wWinId ?? "default";
      const previous = windows.get(key);
      const start = event.tStartMs / 1000;
      if (!Number.isFinite(start) || start < 0) continue;
      if (!Array.isArray(event.segs)) {
        // An empty timed window event clears the rolling display.
        if (previous && !event.wpWinPosId && !event.wsWinStyleId) {
          previous.end = Math.min(previous.end, start);
          windows.delete(key);
        }
        continue;
      }
      const raw = event.segs.map((seg) => typeof seg?.utf8 === "string" ? seg.utf8 : "").join("");
      let text = tidy(raw);
      if (!text) continue; // newline-only append events are display control, not dialogue
      const end = typeof event.dDurationMs === "number" ? start + event.dDurationMs / 1000
        : event.aAppend && previous ? previous.end : NaN;
      if (!Number.isFinite(end) || end <= start) continue;
      const touching = previous && (start < previous.end || event.wWinId != null && start <= previous.end + 0.001);
      if (touching && event.aAppend) {
        previous.text = tidy(previous.text + raw);
        previous.end = Math.max(previous.end, end);
        continue;
      }
      if (touching && !raw.includes("\n") && (text === previous.text || text.startsWith(previous.text + " "))) {
        previous.text = text;
        previous.end = Math.max(previous.end, end);
        continue;
      }
      if (touching) {
        // A rolling snapshot can carry the tail of the previous window plus
        // a new line. Keep only its new words, not the carried display text.
        const before = previous.text.split(/\s+/);
        const after = text.split(/\s+/);
        for (let n = Math.min(before.length, after.length); n > 0; n--) {
          if (before.slice(-n).join(" ") === after.slice(0, n).join(" ")) {
            text = after.slice(n).join(" ");
            break;
          }
        }
        if (!text) { previous.end = Math.max(previous.end, end); continue; }
        previous.end = Math.min(previous.end, start);
      }
      const cue = { start, end, text };
      out.push(cue);
      windows.set(key, cue);
    }
    return out;
  }

  function tidy(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  /** Texto a practicar: sin efectos de sonido, nombres de personaje ni notas musicales. */
  function practiceText(text) {
    let t = text
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[♪♫#]+/g, " ")
      .replace(/(^|\s)-\s+/g, " ")
      .replace(/^\s*[A-Z][A-Z0-9 .'-]{1,24}:\s*/, " ");
    return tidy(t);
  }

  function finalize(cues) {
    const good = cues
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .map((c) => ({ start: c.start, end: c.end, text: tidy(c.text) }))
      .filter((c) => c.text)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // Líneas con el mismo intervalo (dos personajes, capas de sombra): una sola.
    const merged = [];
    for (const c of good) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.start - c.start) < 0.05 && Math.abs(prev.end - c.end) < 0.05) {
        if (!prev.text.includes(c.text)) prev.text = prev.text + " " + c.text;
        continue;
      }
      merged.push(c);
    }
    return merged
      .map((c) => ({ start: c.start, end: c.end, text: c.text, practice: practiceText(c.text) }))
      .filter((c) => /[a-z]/i.test(c.practice));
  }

  function parseSubtitles(text, format) {
    const src = String(text || "").replace(/^\uFEFF/, "");
    const f = String(format || "").toLowerCase();
    const isAss = f === "ass" || f === "ssa" || /^\s*\[script info\]/i.test(src) || /\n\s*dialogue\s*:/i.test(src);
    const isJson3 = f === "json3" || /^\s*\{/.test(src);
    return finalize(isJson3 ? parseJson3(src) : isAss ? parseAss(src) : parseVttOrSrt(src));
  }

  /** Momento de pausa de la línea i: su final, o antes si la siguiente empieza
   *  antes de que termine (no cortar la frase siguiente), más el ajuste del usuario. */
  function pauseTime(cues, i, offset) {
    const c = cues[i];
    let end = c.end;
    const next = cues[i + 1];
    if (next && next.start < end && next.start > c.start + 0.3) end = next.start;
    return Math.max(c.start + 0.2, end + (Number(offset) || 0));
  }

  const api = { parseSubtitles, practiceText, parseTime, pauseTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CRESubs = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
