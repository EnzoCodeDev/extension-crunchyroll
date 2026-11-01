// Prueba de punta a punta: Chrome real con la extensión cargada sobre una
// copia simulada del reproductor de Crunchyroll (servida en local con
// www.crunchyroll.com redirigido al servidor loopback). Uso: npm run test:e2e
// Requiere Google Chrome, ffmpeg y openssl en el PATH.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../..");
const FIX = path.join(HERE, "fixtures");
// Fuera de la carpeta de la extensión: el navegador avisa si encuentra claves .pem dentro.
const OUT = process.env.E2E_OUT || path.join(process.env.HERMES_SCRATCH || os.tmpdir(), "cre-e2e");
fs.mkdirSync(OUT, { recursive: true });
const LOOPBACK = [127, 0, 0, 1].join(".");
const chromeCandidates = process.platform === "win32"
  ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter(Boolean).map((base) => path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const CHROME = process.env.CHROME_PATH || chromeCandidates.find((file) => fs.existsSync(file));
if (!CHROME) throw new Error("No se encuentra Chrome; configura CHROME_PATH con el ejecutable de pruebas.");

/* ---------- preparación ---------- */
const video = path.join(OUT, "video.mp4");
if (!fs.existsSync(video)) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100", "-t", "20", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", video]);
}
const key = path.join(OUT, "key.pem"), cert = path.join(OUT, "cert.pem");
if (!fs.existsSync(cert)) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
    "-subj", "/CN=www.crunchyroll.com", "-keyout", key, "-out", cert], { stdio: "ignore" });
}

/* ---------- servidor simulado ---------- */
const ORIGIN = "https://www.crunchyroll.com";
const playback = {
  audioLocale: "en-US",
  captions: { "en-US": { language: "en-US", format: "vtt", url: `${ORIGIN}/subs/en.vtt` } },
  subtitles: { "es-419": { language: "es-419", format: "ass", url: `${ORIGIN}/subs/es.ass` } },
  hardSubs: {},
};

if (process.env.E2E_NO_TRANSLATION) playback.subtitles = {};

function sendFile(req, res, file, type) {
  const stat = fs.statSync(file);
  const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    fs.createReadStream(file).pipe(res);
  }
}

const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/watch/")) return sendFile(req, res, path.join(FIX, "watch.html"), "text/html; charset=utf-8");
  if (url === "/video.mp4") return sendFile(req, res, video, "video/mp4");
  if (url === "/playback/v3/TEST123/web/chrome/play") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(playback)); }
  if (url === "/subs/en.vtt") return sendFile(req, res, path.join(FIX, "en.vtt"), "text/vtt");
  if (url === "/subs/es.ass") return sendFile(req, res, path.join(FIX, "es.ass"), "text/plain");
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, LOOPBACK, r));
const port = server.address().port;

/* ---------- navegador ---------- */
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: [EXT],
  acceptInsecureCerts: true,
  args: [
    `--host-resolver-rules=MAP www.crunchyroll.com ${LOOPBACK}:${port}`,
    "--ignore-certificate-errors",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1400,900",
  ],
  defaultViewport: { width: 1400, height: 820 },
});

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✔" : "✖"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // La extensión se instala tras arrancar el navegador: esperar a su service worker
  // antes de abrir la página, o los content scripts no se inyectan.
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes("background.js"), { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  const page = await browser.newPage();
  const errors = []; globalThis.__errs = errors;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || process.env.E2E_VERBOSE) errors.push(m.type() + ": " + m.text()); });
  await page.goto(`${ORIGIN}/watch/TEST123/prueba`, { waitUntil: "load" });

  const state = () => page.evaluate(() => {
    const h = document.getElementById("cre-host");
    const v = document.getElementById("v");
    return Object.assign({}, h ? h.dataset : {}, { t: v.currentTime, paused: v.paused, space: window.__spaceSeen });
  });
  const waitFor = async (pred, ms = 8000, label = "") => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) { s = await state(); if (pred(s)) return s; await sleep(50); }
    throw new Error(`Tiempo agotado esperando ${label}: ${JSON.stringify(s)}`);
  };
  const shadowClick = (sel) => page.evaluate((s) => document.getElementById("cre-host").shadowRoot.querySelector(s).click(), sel);
  const shadowText = (sel) => page.evaluate((s) => document.getElementById("cre-host").shadowRoot.querySelector(s).textContent, sel);
  const typeAnswer = async (text) => {
    await page.evaluate(() => { const i = document.getElementById("cre-host").shadowRoot.querySelector(".write input"); i.value = ""; i.focus(); });
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press("Enter");
  };

  let s = await waitFor((x) => x.load === "ready", 8000, "subtítulos cargados");
  check("Lee la respuesta de reproducción y carga los [CC] en inglés", true, `líneas a practicar: ${s.targets}`);
  check("Descarta la línea de una sola palabra («Yes.»)", s.targets === "3");
  check("La píldora indica el progreso", (await shadowText(".pill-text")).includes("0/3"), await shadowText(".pill-text"));

  // Modo escribir desde la píldora.
  await shadowClick('.seg button[data-mode="write"]');
  await page.evaluate(() => document.getElementById("v").play());

  s = await waitFor((x) => x.phase === "exercise", 8000, "primer ejercicio");
  check("Pausa justo al final de la línea 1 (±80 ms)", s.paused && Math.abs(s.t - 3) < 0.08, `t=${s.t.toFixed(2)}s`);
  check("El ejercicio está en modo escribir", s.mode === "write");
  check("Al escribir se muestra la línea para copiarla", (await shadowText(".target")).includes("Hello there, how are you?"), await shadowText(".target"));
  check("La pista no aparece cuando la línea está a la vista", await page.evaluate(() => document.getElementById("cre-host").shadowRoot.querySelector('[data-act="hint"]').hidden));
  await sleep(250); // esperar a que termine la animación de entrada antes de la captura
  await page.screenshot({ path: path.join(OUT, "1-escribir.png") });

  {
    await page.waitForFunction(() => {
      const t = document.getElementById("cre-host").shadowRoot.querySelector(".trans");
      return !t.hidden && t.textContent.includes("cómo estás");
    }, { timeout: 10000 });
    const visibleTranslation = await page.evaluate(() => {
      const t = document.getElementById("cre-host").shadowRoot.querySelector(".trans");
      return !t.hidden && t.textContent.includes("cómo estás");
    });
    check("La frase completa aparece traducida sin pulsar ningún botón", visibleTranslation);
    await shadowClick('.seg button[data-mode="speak"]');
    await sleep(200);
    s = await state();
    check("Cambiar arriba a hablar cambia el ejercicio inmediatamente", s.mode === "speak" && s.idx === "0" && s.paused);
    await shadowClick('.seg button[data-mode="write"]');
    await sleep(200);
    await page.mouse.click(200, 200);
    await sleep(200);
    s = await state();
    check("Clic fuera no llega al reproductor ni salta el ejercicio", s.phase === "exercise" && s.idx === "0" && s.paused && await page.evaluate(() => window.__outsideSeen === 0));
    await page.evaluate(() => document.getElementById("v").play());
    await sleep(200);
    s = await state();
    check("Play externo no salta la frase pendiente", s.phase === "exercise" && s.idx === "0" && s.paused);
    await page.evaluate(() => { document.getElementById("v").currentTime = 10; });
    await sleep(300);
    s = await state();
    check("Adelantar no evita la frase pendiente", s.phase === "exercise" && s.idx === "0" && s.paused && Math.abs(s.t - 3) < 0.08);
    const noSkip = await page.evaluate(() => !document.getElementById("cre-host").shadowRoot.querySelector('[data-act="skip"]'));
    check("No hay botón para saltar", noSkip);
    if (results.some((r) => !r.ok)) throw new Error("Fallan las regresiones del modo obligatorio");
  }

  // Cambiar la pista de traducción no puede mover la frase pendiente.
  const languagePopup = await browser.newPage();
  await languagePopup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await languagePopup.select("#translationLang", "es-ES");
  await sleep(300);
  await languagePopup.close();
  await page.bringToFront();
  await sleep(200);
  s = await state();
  check("Cambiar el idioma español no avanza el índice del ejercicio pendiente", s.phase === "exercise" && s.idx === "0" && s.paused);
  if (s.idx !== "0") throw new Error("La recarga de idioma saltó el índice pendiente");

  // La barra espaciadora no debe llegar al reproductor mientras se escribe.
  await page.evaluate(() => document.getElementById("cre-host").shadowRoot.querySelector(".write input").focus());
  await page.keyboard.press("Space");
  s = await state();
  check("Escribir un espacio no reanuda ni llega al reproductor", s.paused && s.space === 0 && s.phase === "exercise");

  // Pasar el ratón por una palabra: significado y pronunciación.
  const hoverWord = async (w) => {
    const box = await page.evaluate((word) => {
      const el = [...document.getElementById("cre-host").shadowRoot.querySelectorAll(".target .tok")].find((x) => x.dataset.w === word);
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, w);
    await page.mouse.move(box.x, box.y);
  };
  await hoverWord("Hello");
  await page.waitForFunction(() => {
    const p = document.getElementById("cre-host").shadowRoot.querySelector(".pop");
    return p && !p.hidden && p.querySelector(".pp");
  }, { timeout: 6000 }).catch(() => {});
  const wordText = await page.evaluate(() => { const p = document.getElementById("cre-host").shadowRoot.querySelector(".pop"); return p.hidden ? "" : p.innerText; });
  check("Pasar el ratón por «Hello» muestra cómo se dice y qué significa", /JE-?L[ÓO]U/i.test(wordText) && /hola/i.test(wordText), wordText.replace(/\s+/g, " "));
  await page.screenshot({ path: path.join(OUT, "1b-palabra.png") });
  await page.mouse.move(5, 5);
  await sleep(500);
  check("El recuadro se cierra al quitar el ratón", await page.evaluate(() => document.getElementById("cre-host").shadowRoot.querySelector(".pop").hidden));

  await typeAnswer("hello there");
  s = await waitFor((x) => x.score !== "", 3000, "nota");
  check("Respuesta incompleta: menos de 80 y no avanza", Number(s.score) < 80 && s.passed === "false" && s.paused, `nota ${s.score}%`);
  await page.screenshot({ path: path.join(OUT, "2-fallo.png") });

  check("Mantiene la traducción completa al comprobar la respuesta", (await shadowText(".trans")).includes("cómo estás"), await shadowText(".trans"));

  await typeAnswer("Hello there how are you");
  s = await waitFor((x) => x.passed === "true", 3000, "línea superada");
  check("Respuesta correcta: supera el 80 %", Number(s.score) >= 80, `nota ${s.score}%`);
  await page.screenshot({ path: path.join(OUT, "3-superada.png") });
  // Activar el dictado desde el popup para la línea siguiente.
  const popD = await browser.newPage();
  await popD.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popD.click("#dictation");
  await sleep(200);
  await popD.close();
  await page.bringToFront();
  s = await waitFor((x) => x.phase === "watch" && !x.paused, 4000, "seguir el video");
  check("Sigue el video solo tras superar la línea", true, `t=${s.t.toFixed(2)}s`);

  // Línea 2: repetir el audio y luego saltar con la tecla S.
  s = await waitFor((x) => x.phase === "exercise", 8000, "segundo ejercicio");
  check("Pausa justo al final de la línea 2 (±80 ms)", Math.abs(s.t - 6) < 0.08, `t=${s.t.toFixed(2)}s`);
  await shadowClick('[data-act="hint"]');
  check("Dictado: la línea queda oculta", !(await shadowText(".target")).includes("I'm gonna be the strongest"));
  check("La pista muestra la primera letra de cada palabra", (await shadowText(".target")).includes("I'_ g____ b_ t__ s________"), await shadowText(".target"));
  await shadowClick('[data-act="slow"]');
  await waitFor((x) => x.phase === "replay" && !x.paused, 3000, "repetición lenta");
  await shadowClick('[data-act="slow"]');
  await waitFor((x) => x.phase === "exercise" && x.paused, 6000, "fin de repetición lenta doble");
  check("Pulsar Lento dos veces restaura la velocidad original", await page.evaluate(() => document.getElementById("v").playbackRate === 1));
  await shadowClick('[data-act="replay"]');
  s = await waitFor((x) => x.phase === "replay" && !x.paused, 3000, "repetición");
  check("🔁 vuelve al inicio de la línea", s.t < 5.2, `t=${s.t.toFixed(2)}s`);
  s = await waitFor((x) => x.phase === "exercise" && x.paused, 5000, "fin de la repetición");
  check("Tras repetir vuelve a pausar en el final de la línea", Math.abs(s.t - 6) < 0.35, `t=${s.t.toFixed(2)}s`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.click(5, 5);
  await page.keyboard.press("KeyS");
  s = await state();
  check("La tecla S ya no permite saltar la frase", s.phase === "exercise" && s.paused && s.idx === "1");
  await typeAnswer("I'm gonna be the strongest");
  await waitFor((x) => x.passed === "true", 3000, "segunda frase superada");
  await waitFor((x) => x.phase === "watch" && !x.paused, 4000, "continuar tras aprobar");
  await shadowClick('.seg button[data-mode="speak"]');

  // Volver atrás fuera de un ejercicio: las dos líneas superadas no paran.
  await page.evaluate(() => { const v = document.getElementById("v"); v.currentTime = 0.5; });
  s = await waitFor((x) => x.phase === "exercise", 15000, "última frase pendiente");
  check("Al volver atrás omite las frases aprobadas y para en la pendiente", Math.abs(s.t - 11.5) < 0.08, `t=${s.t.toFixed(2)}s`);

  // Modo hablar: muestra el texto a decir.
  check("Modo hablar: pausa en la línea 4 y muestra el texto", s.mode === "speak" && (await shadowText(".target")).includes("Let's go on an adventure."), `t=${s.t.toFixed(2)}s`);
  await sleep(1500); // el micrófono no existe en la prueba: debe avisar sin romperse
  await hoverWord("adventure");
  await page.waitForFunction(() => {
    const p = document.getElementById("cre-host").shadowRoot.querySelector(".pop");
    return p && !p.hidden && /aventura/i.test(p.innerText);
  }, { timeout: 8000 }).catch(() => {});
  const advText = await page.evaluate(() => { const p = document.getElementById("cre-host").shadowRoot.querySelector(".pop"); return p.hidden ? "" : p.innerText; });
  check("Palabra fuera del diccionario de Speak: pronunciación generada y significado", advText.includes("ad-VÉN-cher") && /aventura/i.test(advText), advText.replace(/\s+/g, " "));
  await page.screenshot({ path: path.join(OUT, "4b-palabra-nueva.png") });
  await page.mouse.move(5, 5);
  check("Sin micrófono muestra un aviso claro", (await shadowText(".status")).length > 5, await shadowText(".status"));
  await page.screenshot({ path: path.join(OUT, "4-hablar.png") });

  // Progreso guardado.
  check("La píldora cuenta 2 líneas superadas", (await shadowText(".pill-text")).includes("2/3"), await shadowText(".pill-text"));

  check("Sin errores de la extensión en la consola", !errors.some((e) => /cre|content\.js|scoring|subs\.js/i.test(e)), errors.join(" | ").slice(0, 300));

  // Popup de ajustes.
  const pop = await browser.newPage();
  await pop.setViewport({ width: 360, height: 640 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
  await sleep(400);
  const popText = await pop.evaluate(() => document.body.innerText);
  check("El popup muestra estadísticas y el episodio", /2\s*\n?\s*hoy/.test(popText) && popText.includes("2 de 3"), popText.replace(/\s+/g, " ").slice(0, 160));
  await pop.screenshot({ path: path.join(OUT, "5-popup.png"), fullPage: true });
} catch (e) {
  check("Ejecución completa", false, e.message); console.log("ERRORES", globalThis.__errs);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
process.exit(failed ? 1 : 0);
