const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
