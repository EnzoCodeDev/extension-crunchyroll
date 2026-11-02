// Pruebas de lógica pura: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, evaluateBest, normalize } = require("../src/scoring.js");
const { parseSubtitles, practiceText, pauseTime } = require("../src/subs.js");
const { streak, today } = require("../src/settings.js");
const { fromArpabet, wordKey } = require("../src/pron.js");
const fs = require("node:fs");
const path = require("node:path");

test("normaliza contracciones, números y puntuación", () => {
  assert.deepEqual(normalize("I'm gonna win, OK?"), ["i", "am", "going", "to", "win", "okay"]);
  assert.deepEqual(normalize("I'm I'm"), ["i", "am", "i", "am"]);
  assert.deepEqual(normalize("I have 2 cats"), ["i", "have", "two", "cats"]);
});

test("contracción seguida de puntuación no penaliza una respuesta correcta (regresión But, that's...)", () => {
  for (const [target, answer] of [
    ["But, that's...", "but that's"],
    ["But, that’s…", "but that's"],
    ["That's!", "that is"],
    ["I'm, I'm...", "i am i am"],
    ["Don't!", "do not"],
    ["Let's-go!", "let us go"],
  ]) {
    assert.deepEqual(normalize(target), normalize(answer), target);
    const result = evaluate(target, answer);
    assert.equal(result.score, 100, target);
    assert.ok(result.words.every(w => w.sim === 1), target);
    assert.equal(evaluate(answer, target).score, 100, target);
  }
});

test("posesivos conservan una palabra y una inversión leve no penaliza también el apóstrofo", () => {
  const target = "possessing a Magic Knight's body.";
  assert.deepEqual(normalize(target), ["possessing", "a", "magic", "knights", "body"]);
  assert.equal(evaluate(target, "possessing a magic knights body").score, 100);
  const transposed = evaluate(target, "possessing a magic knigths body");
  assert.ok(transposed.score >= 80 && transposed.score < 100, `nota ${transposed.score}`);
  assert.equal(transposed.words.length, 5);
  assert.ok(evaluate(target, "possessing a magic king body").score < 80);
  assert.ok(evaluate(target, "possessing a magic body").score < 80);
});

test("línea idéntica = 100 y supera el 80", () => {
  assert.equal(evaluate("I won't let you down!", "I will not let you down").score, 100);
});

test("una palabra mal de cinco no llega al 80", () => {
  const r = evaluate("Where are you going now", "Where are you from now");
  assert.ok(r.score < 80, `score ${r.score}`);
  assert.equal(r.words.find((w) => w.word === "going").sim < 1, true);
});

test("errores de escritura leves bajan la nota pero la línea correcta pasa", () => {
  assert.ok(evaluate("Don't worry about it", "dont worry about it").score >= 80);
  assert.ok(evaluate("Don't worry about it", "dont wory about").score < 80);
});

test("vacío = 0", () => {
  assert.equal(evaluate("Hello there", "").score, 0);
});

test("evaluateBest elige la mejor alternativa del reconocedor", () => {
  const best = evaluateBest("I need to get stronger", [["I need to get strong her", "I need to get stronger"]]);
  assert.equal(best.score, 100);
  assert.equal(best.transcript, "I need to get stronger");
});

test("parsea WebVTT con etiquetas", () => {
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<i>Hello</i> there!\n\n00:03.000 --> 00:04.000 align:start\n[laughs] Nice.\n";
  const cues = parseSubtitles(vtt, "vtt");
  assert.equal(cues.length, 2);
  assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1, 2.5, "Hello there!"]);
  assert.equal(cues[1].practice, "Nice.");
});

test("parsea SRT", () => {
  const srt = "1\r\n00:00:01,200 --> 00:00:03,000\r\nWe did it!\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n♪ ♪\r\n";
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 1.2);
});

test("parsea ASS y descarta carteles y canciones", () => {
  const ass = [
    "[Script Info]", "Title: x", "", "[V4+ Styles]", "Format: Name, Fontname", "Style: Default,Arial", "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Let's go,{\\i0} everyone!\\NNow!",
    "Dialogue: 0,0:00:02.00,0:00:04.00,Signs,,0,0,0,,{\\an8}STATION",
    "Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\pos(100,200)}Shop",
    "Dialogue: 0,0:00:07.00,0:00:08.00,Song,,0,0,0,,La la la",
    "Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,- Who?",
    "Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,- Me.",
  ].join("\n");
  const cues = parseSubtitles(ass, "ass");
  assert.deepEqual(cues.map((c) => c.text), ["Let's go, everyone! Now!", "- Who? - Me."]);
  assert.equal(cues[1].practice, "Who? Me.");
});

test("practiceText quita nombres de personaje y efectos", () => {
  assert.equal(practiceText("NARUTO: (grunts) I'm not giving up!"), "I'm not giving up!");
});

test("racha de días", () => {
  const d = new Date();
  const days = {};
  for (let i = 0; i < 3; i++) { days[today(d)] = { passed: 1 }; d.setDate(d.getDate() - 1); }
  assert.equal(streak(days), 3);
  assert.equal(streak({}), 0);
});

test("pausa al final de la línea, o antes si la siguiente se solapa", () => {
  const cues = [{ start: 1, end: 3 }, { start: 2.5, end: 4 }, { start: 5, end: 6 }];
  assert.equal(pauseTime(cues, 0, 0), 2.5); // la siguiente empieza antes: no cortarla
  assert.equal(pauseTime(cues, 1, 0), 4);
  assert.ok(Math.abs(pauseTime(cues, 2, -0.2) - 5.8) < 1e-9); // ajuste del usuario
  assert.equal(pauseTime([{ start: 1, end: 1.3 }], 0, -0.4), 1.2); // nunca antes de empezar
});

test("pronunciación para hispanohablantes al estilo Speak", () => {
  assert.equal(fromArpabet("AH0 B AW1 T", "about").es, "a-BÁUT");
  assert.equal(fromArpabet("AE1 K S AH0 D AH0 N T", "accident").es, "ÁK-si-dent");
  assert.equal(fromArpabet("S T R AO1 NG G AH0 S T", "strongest").es, "STRÓN-guest");
  assert.equal(fromArpabet("W AA1 N T", "want").es, "UÓNT");
  assert.equal(fromArpabet("Y EH1 S", "yes").es, "YES");
  assert.equal(fromArpabet("EY1 B AH0 L", "able").es, "ÉI-bol");
  assert.equal(fromArpabet("IH0 K S P L EY1 N", "explain").es, "iks-PLÉIN");
  assert.equal(fromArpabet("AH0 B AW1 T", "about").ipa, "/əˈbaʊt/");
});

test("clave de palabra: minúsculas, sin puntuación, apóstrofo recto", () => {
  assert.equal(wordKey("“I’m"), "i'm");
  assert.equal(wordKey("Hello!"), "hello");
});

test("traduce la frase completa cuando corresponde a varios subtítulos españoles", () => {
  const vm = require("node:vm");
  const code = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
  const start = code.indexOf("  function translationFor(cue) {");
  const end = code.indexOf("  function tick()", start);
  const call = (transCues) => vm.runInNewContext(code.slice(start, end) + ";translationFor(cue)", {
    transCues, cue: { start: 0, end: 4, text: "Hello. How are you?" },
    window: { CRESubs: require("../src/subs.js") },
  });
  assert.equal(call([
    { start: 0, end: 2, text: "Hola." },
    { start: 2, end: 4, text: "¿Cómo estás?" },
    { start: 4, end: 6, text: "Siguiente frase." },
  ]), "Hola. ¿Cómo estás?");
  // Una traducción parcial no debe impedir traducir la frase completa por red.
  assert.equal(call([{ start: 0, end: 2, text: "Hola." }]), "");
});

test("la pronunciación generada coincide con la de Speak en la mayoría de palabras", () => {
  const data = path.join(__dirname, "..", "data");
  const speak = JSON.parse(fs.readFileSync(path.join(data, "speak-dict.json"), "utf8"));
  const cmu = new Map(fs.readFileSync(path.join(data, "cmudict.txt"), "utf8").split("\n").filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1)]));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let n = 0, ok = 0;
  for (const [w, [, p]] of Object.entries(speak)) {
    if (!cmu.has(w) || p.includes("/")) continue;
    n++;
    if (norm(fromArpabet(cmu.get(w), w).es) === norm(p)) ok++;
  }
  assert.ok(n > 2000 && ok / n >= 0.8, `${ok}/${n}`);
});
