const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseSubtitles } = require("../src/subs.js");

const hookSource = fs.readFileSync(require.resolve("../src/page-hook.js"), "utf8");
const VIDEO_A = "abcdefghijk";
const VIDEO_B = "lmnopqrstuv";
const track = (languageCode, kind) => ({
  languageCode, kind,
  baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_A}&sig=a%2Bb%20c&lang=${languageCode}`,
  name: { simpleText: languageCode },
});
const response = (videoId = VIDEO_A, tracks = [track("en")]) => ({
  videoDetails: { videoId },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
});
function page(initial, playerResponse) {
  const listeners = {};
  const messages = [];
  const requests = [];
  const location = { href: `https://www.youtube.com/watch?v=${VIDEO_A}`, origin: "https://www.youtube.com" };
  class XHR {
    open(...args) { this.openArgs = args; }
    send(...args) { this.sendArgs = args; }
    addEventListener(type, fn) { this[type] = fn; }
  }
  const window = {
    ytInitialPlayerResponse: initial,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    postMessage(msg) { messages.push(JSON.parse(JSON.stringify(msg))); },
    async fetch(...args) {
      requests.push(args);
      return { ok: true, clone: () => ({ json: async () => window.nextResponse }) };
    },
  };
  const player = { getPlayerResponse: () => playerResponse };
  const document = { getElementById: () => player, querySelector: () => player };
  vm.runInNewContext(hookSource, { window, document, location, URL, Request, XMLHttpRequest: XHR, Date });
  return { window, location, messages, requests, XHR,
    emit(type) { for (const fn of listeners[type] || []) fn({ source: window, data: { source: "cre-content", type: "get-playback" } }); },
  };
}

test("YouTube discovers page captions and prefers manual English, preserving signed query bytes", () => {
  const p = page(response(VIDEO_A, [track("en", "asr"), track("es"), track("en")]));
  const pb = p.messages.at(-1)?.payload;
  assert.equal(pb?.platform, "youtube");
  assert.equal(pb.videoId, VIDEO_A);
  assert.equal(pb.subtitles.en.format, "json3");
  assert.equal(pb.subtitles.en.url, track("en").baseUrl + "&fmt=json3");
  assert.equal(pb.subtitles.en.kind, "manual");
  assert.ok(pb.subtitles.es);
  assert.deepEqual(p.requests, []);
});

test("hook rejects stale SPA metadata and responds only with the current video", () => {
  const p = page(response());
  p.emit("yt-navigate-finish");
  assert.equal(p.messages.length, 1, "identical unsolicited metadata is deduplicated");
  p.emit("message");
  assert.equal(p.messages.length, 2, "explicit request replays cached metadata");
  p.location.href = `https://www.youtube.com/watch?v=${VIDEO_B}`;
  p.emit("yt-navigate-finish");
  p.emit("message");
  assert.equal(p.messages.length, 2, "old video cannot be replayed after SPA navigation");
  p.window.ytInitialPlayerResponse = response(VIDEO_B);
  p.emit("yt-navigate-finish");
  assert.equal(p.messages.at(-1).payload.videoId, VIDEO_B);
  p.window.ytInitialPlayerResponse = { videoDetails: { videoId: VIDEO_B } };
  p.emit("yt-navigate-finish");
  assert.deepEqual(p.messages.at(-1).payload.subtitles, {});
});

test("reads player getPlayerResponse before stale initial data", () => {
  const p = page(response(VIDEO_B), response());
  assert.equal(p.messages.at(-1)?.payload.videoId, VIDEO_A);
});

test("observes existing fetch and XHR responses without extra requests or argument changes", async () => {
  const p = page();
  const init = { method: "POST", body: "unchanged" };
  p.window.nextResponse = response();
  const returned = await p.window.fetch("/youtubei/v1/player?prettyPrint=false", init);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(returned.ok);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0][1], init);
  assert.equal(p.messages.at(-1)?.payload.videoId, VIDEO_A);
  const xhr = new p.XHR();
  xhr.open("POST", "/youtubei/v1/player");
  xhr.send("original body");
  xhr.status = 200;
  xhr.responseType = "json";
  xhr.response = response(VIDEO_A, [track("es")]);
  xhr.load();
  assert.deepEqual(xhr.openArgs, ["POST", "/youtubei/v1/player"]);
  assert.deepEqual(xhr.sendArgs, ["original body"]);
  assert.ok(p.messages.at(-1).payload.subtitles.es);
  p.location.href = `https://www.youtube.com/watch?v=${VIDEO_B}`;
  const count = p.messages.length;
  await p.window.fetch("/youtubei/v1/player", init);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p.messages.length, count, "late player response for old video is ignored");
});

test("normalization replaces fmt only and rejects nonofficial caption URLs", () => {
  const signed = track("en");
  signed.baseUrl += "&fmt=srv3&keep=a+b%2F";
  const p = page(response(VIDEO_A, [signed, { ...track("es"), baseUrl: "https://youtube.com.evil.test/api/timedtext" }]));
  assert.equal(p.messages.at(-1).payload.subtitles.en.url, signed.baseUrl.replace("fmt=srv3", "fmt=json3"));
  assert.equal(p.messages.at(-1).payload.subtitles.es, undefined);
});

test("Crunchyroll fetch behavior and explicit cached replay remain available", async () => {
  const p = page();
  p.location.href = "https://www.crunchyroll.com/watch/example";
  p.location.origin = "https://www.crunchyroll.com";
  p.window.nextResponse = { audioLocale: "en-US", subtitles: { "en-US": { url: "https://example.test/sub.ass", format: "ass" } } };
  await p.window.fetch("https://example.test/playback/v3/id/web/chrome/play");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p.messages.at(-1)?.payload.audioLocale, "en-US");
  p.emit("message");
  assert.equal(p.messages.length, 2);
});

test("JSON3 merges appended/cumulative and rolling windows without repeating text", () => {
  const text = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: "Hello" }] },
    { tStartMs: 1500, dDurationMs: 1500, wWinId: 1, aAppend: 1, segs: [{ utf8: " world" }] },
    { tStartMs: 1600, dDurationMs: 1400, wWinId: 1, segs: [{ utf8: "Hello world" }] },
    { tStartMs: 3000, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: "Hello world\nNext line" }] },
    { tStartMs: 3500, dDurationMs: 1000, wWinId: 1, aAppend: 1, segs: [{ utf8: "\n" }] },
  ] });
  assert.deepEqual(parseSubtitles(text, "json3"), [
    { start: 1, end: 3, text: "Hello world", practice: "Hello world" },
    { start: 3, end: 5, text: "Next line", practice: "Next line" },
  ]);
});

test("JSON3 malformed input, invalid timing and nontext segments are ignored", () => {
  for (const text of ["{", "null", "{}", '{"events":{}}']) assert.deepEqual(parseSubtitles(text, "json3"), []);
  const events = [null, { tStartMs: -1, dDurationMs: 500, segs: [{ utf8: "negative" }] },
    { tStartMs: 0, dDurationMs: 0, segs: [{ utf8: "zero" }] },
    { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 123 }, {}] },
    { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: "Yes" }] },
    { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: "Yes" }] }];
  assert.deepEqual(parseSubtitles(JSON.stringify({ events })).map((c) => c.text), ["Yes", "Yes"]);
});

test("manual regional English is ordered ahead of base-language ASR and malformed tracks are skipped", () => {
  const p = page(response(VIDEO_A, [null, {}, track("en", "asr"), track("en-US"), track("es")]));
  assert.deepEqual(Object.keys(p.messages.at(-1)?.payload.subtitles || {}), ["en-US", "es", "en"]);
});

test("JSON3 reads segment text and milliseconds while dropping nonverbal/style events", () => {
  const text = JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 9000, wpWinPosId: 1 },
    { tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: "Hello" }, { utf8: " world!", tOffsetMs: 100 }] },
    { tStartMs: 3000, dDurationMs: 500, segs: [{ utf8: "[Music] ♪" }] },
  ] });
  assert.deepEqual(parseSubtitles(text, "json3"), [{ start: 1, end: 2.5, text: "Hello world!", practice: "Hello world!" }]);
});
