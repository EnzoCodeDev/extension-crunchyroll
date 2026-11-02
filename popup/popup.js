(async function () {
  "use strict";
  const { store, loadSettings, today, streak } = window.CRESettings;
  const $ = (id) => document.getElementById(id);
  let settings = await loadSettings();

  const save = (patch) => {
    settings = Object.assign({}, settings, patch);
    store.set({ settings });
    paint();
  };

  function paint() {
    $("enabled").checked = settings.enabled;
    for (const b of document.querySelectorAll("#mode button")) b.classList.toggle("on", b.dataset.v === settings.mode);
    $("threshold").value = settings.threshold;
    $("thresholdOut").textContent = settings.threshold + " %";
    for (const id of ["every", "minWords", "translationLang", "pauseOffset"]) $(id).value = String(settings[id]);
    for (const id of ["dictation", "autoMic", "autoContinue", "skipPassed", "hideNativeSubs"]) $(id).checked = !!settings[id];
  }

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  document.querySelectorAll("#mode button").forEach((b) => b.addEventListener("click", () => save({ mode: b.dataset.v })));
  $("threshold").addEventListener("input", (e) => save({ threshold: Number(e.target.value) }));
  $("every").addEventListener("change", (e) => save({ every: Number(e.target.value) }));
  $("minWords").addEventListener("change", (e) => save({ minWords: Number(e.target.value) }));
  $("translationLang").addEventListener("change", (e) => save({ translationLang: e.target.value }));
  $("pauseOffset").addEventListener("change", (e) => save({ pauseOffset: Number(e.target.value) }));
  for (const id of ["dictation", "autoMic", "autoContinue", "skipPassed", "hideNativeSubs"]) {
    $(id).addEventListener("change", (e) => save({ [id]: e.target.checked }));
  }

  async function paintStats() {
    const { stats, status } = await store.get(["stats", "status"]);
    const s = stats || { days: {}, totalPassed: 0, totalAttempts: 0 };
    const d = s.days[today()] || { passed: 0 };
    $("today").textContent = d.passed;
    $("streak").textContent = streak(s.days);
    $("total").textContent = s.totalPassed;
    $("acc").textContent = s.totalAttempts ? Math.round((s.totalPassed / s.totalAttempts) * 100) + " %" : "–";

    if (status && status.episode) {
      const key = "ep:" + status.episode;
      const ep = (await store.get(key))[key];
      const done = ep ? Object.keys(ep.passed).length : 0;
      const text = status.state === "ready" || status.state === "manual"
        ? `Video actual: ${done} de ${status.lines} líneas superadas · ${status.track}`
        : status.state === "error" ? "Este video no tiene subtítulos en inglés." : "Esperando los subtítulos del video…";
      $("episode").textContent = text;
      $("reset").hidden = !done;
      $("reset").onclick = async () => {
        await store.remove(key);
        paintStats();
      };
    }
  }

  paint();
  paintStats();
  store.onChange(() => paintStats());
})();
