const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("YouTube solo permite timedtext HTTPS y emisores reales de la plataforma", async () => {
  for (const host of ["www.youtube.com", "m.youtube.com", "youtube.com"]) {
    const { context, calls } = worker();
    const url = `https://${host}/api/timedtext?v=example&lang=en&fmt=json3`;
    await vm.runInContext(`fetchSubtitle(${JSON.stringify(url)})`, context);
    assert.equal(calls[0].url, url);
    assert.equal(vm.runInContext(`fromCrunchyroll({tab:{},url:'https://${host}/watch?v=example'})`, context), true);
  }
  for (const url of ["https://youtube.com.other.example/api/timedtext", "https://www.youtube.com/watch?v=x", "https://www.youtube.com/youtubei/v1/player", "http://www.youtube.com/api/timedtext", "https://www.youtube.com:8443/api/timedtext", "https://evil.youtube.com/api/timedtext"]) {
    const { context, calls } = worker();
    await assert.rejects(vm.runInContext(`fetchSubtitle(${JSON.stringify(url)})`, context));
    assert.equal(calls.length, 0);
  }
  const { context } = worker();
  assert.equal(vm.runInContext("fromCrunchyroll({tab:{},url:'https://youtube.com.other.example/'})", context), false);
});

function worker() {
  const calls = [];
  let context;
  context = vm.createContext({
    URL, AbortSignal,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    importScripts(...files) {
      for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, text: async () => "WEBVTT" };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8"), context);
  return { context, calls };
}

test("pronunciación de frase usa diccionarios locales sin traducir ni hacer peticiones", async () => {
  const { context, calls } = worker();
  vm.runInContext(`speakDict = {hello:["hola","je-LÓU"]}; cmu = new Map([["body","B AA1 D IY0"]]);`, context);
  const result = await vm.runInContext(`pronounceLine("Hello, body!")`, context);
  assert.equal(result.ok, true);
  assert.ok(result.text.startsWith("je-LÓU, "));
  assert.ok(!result.text.includes("body"));
  assert.ok(result.text.endsWith("!"));
  assert.equal(calls.length, 0);
  const missing = await vm.runInContext(`pronounceLine("Hello xyzzyq")`, context);
  assert.ok(missing.text.includes("[xyzzyq]"));
  assert.equal((await vm.runInContext(`pronounceLine("")`, context)).ok, false);
  assert.equal((await vm.runInContext(`pronounceLine("a".repeat(2001))`, context)).ok, false);
});

test("el worker verifica el origen del frame emisor, no solo el de su pestaña", () => {
  const { context } = worker();
  const result = vm.runInContext(`fromCrunchyroll({tab:{url:'https://www.crunchyroll.com/watch/test'},url:'https://other.example/'})`, context);
  assert.equal(result, false);
});

test("el worker rechaza destinos de subtítulos fuera de los dominios permitidos", async () => {
  const { context, calls } = worker();
  await assert.rejects(vm.runInContext("fetchSubtitle('https://other.example/subs.vtt')", context));
  assert.equal(calls.length, 0);
});

test("el CDN de subtítulos observado en el reproductor tiene permiso y conserva las restricciones", async () => {
  const { context, calls } = worker();
  const url = "https://vod-fy-mod.crunchyrollcdn.com/subs.vtt";
  await vm.runInContext(`fetchSubtitle(${JSON.stringify(url)})`, context);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.ok(manifest.host_permissions.includes("https://vod-fy-mod.crunchyrollcdn.com/*"));
  assert.ok(manifest.content_scripts.every(script => !script.matches.some(match => match.includes("crunchyrollcdn.com"))));
});

test("el permiso del CDN no autoriza otros hosts, sufijos engañosos ni protocolos inseguros", async () => {
  for (const url of [
    "https://other.crunchyrollcdn.com/subs.vtt",
    "https://vod-fy-mod.crunchyrollcdn.com.other.example/subs.vtt",
    "http://vod-fy-mod.crunchyrollcdn.com/subs.vtt",
    "https://vod-fy-mod.crunchyrollcdn.com:8443/subs.vtt",
    "https://" + "example" + "@" + "vod-fy-mod.crunchyrollcdn.com/subs.vtt",
  ]) {
    const { context, calls } = worker();
    await assert.rejects(vm.runInContext(`fetchSubtitle(${JSON.stringify(url)})`, context));
    assert.equal(calls.length, 0);
  }
});

test("el worker no acepta credenciales, HTTP ni puertos alternativos", async () => {
  for (const url of [
    "https://" + "example" + "@" + "www.crunchyroll.com/subs.vtt",
    "http://www.crunchyroll.com/subs.vtt",
    "https://www.crunchyroll.com:8443/subs.vtt",
  ]) {
    const { context, calls } = worker();
    await assert.rejects(vm.runInContext(`fetchSubtitle(${JSON.stringify(url)})`, context));
    assert.equal(calls.length, 0);
  }
});

test("los subtítulos se piden sin cookies y sin seguir redirecciones", async () => {
  const { context, calls } = worker();
  await vm.runInContext("fetchSubtitle('https://www.crunchyroll.com/subs.vtt')", context);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal);
});
