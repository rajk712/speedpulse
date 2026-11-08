(() => {
  const cfg = window.SITE_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const PING_COUNT = 12;
  const DOWN_STREAMS = 6;
  const UP_STREAMS = 4;
  const TEST_MS = 10000;
  const WARMUP_MS = 1500;
  const UP_BLOB_BYTES = 8 * 1024 * 1024;
  // Scale grows to 10 Gbps once a reading passes 1 Gbps, so multi-gig lines don't pin the needle.
  const SCALES = [
    { max: 1000, ticks: [0, 5, 10, 50, 100, 250, 500, 1000] },
    { max: 10000, ticks: [0, 10, 50, 100, 500, 1000, 2500, 5000, 10000] },
  ];
  let scale = SCALES[0];
  const HISTORY_KEY = "speedpulse.history";

  // ---------- gauge ----------
  // 240-degree arc, log scale so 5 Mbps and 500 Mbps are both readable.
  const CX = 150, CY = 150, R = 120, START = 150, SWEEP = 240;

  function polar(deg) {
    const rad = (deg * Math.PI) / 180;
    return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
  }

  function arcPath(frac) {
    const f = Math.max(0.001, Math.min(1, frac));
    const [x1, y1] = polar(START);
    const [x2, y2] = polar(START + SWEEP * f);
    const large = SWEEP * f > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
  }

  const toFrac = (mbps) => Math.log10(1 + mbps) / Math.log10(1 + scale.max);

  function drawTicks() {
    const g = $("gaugeTicks");
    g.replaceChildren();
    for (const v of scale.ticks) {
      const deg = START + SWEEP * toFrac(v);
      const rad = (deg * Math.PI) / 180;
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", CX + (R - 26) * Math.cos(rad));
      t.setAttribute("y", CY + (R - 26) * Math.sin(rad) + 4);
      t.textContent = v >= 1000 ? `${v / 1000}G` : v;
      g.appendChild(t);
    }
  }

  function setScale(next) {
    if (next === scale) return;
    scale = next;
    drawTicks();
  }

  function setGauge(mbps) {
    if (mbps > scale.max) setScale(SCALES.find((sc) => mbps <= sc.max) || SCALES[SCALES.length - 1]);
    $("gaugeFill").setAttribute("d", arcPath(toFrac(mbps)));
    $("speed").textContent = fmt(mbps);
  }

  const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const toMbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;

  // ---------- tests ----------
  async function measurePing() {
    const samples = [];
    for (let i = 0; i < PING_COUNT; i++) {
      const t0 = performance.now();
      await fetch(`/api/ping?r=${Math.random()}`, { cache: "no-store" });
      samples.push(performance.now() - t0);
    }
    // First request includes connection setup; drop it.
    samples.shift();
    const sorted = [...samples].sort((a, b) => a - b);
    const ping = sorted[Math.floor(sorted.length / 2)];
    let jitter = 0;
    for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
    jitter /= samples.length - 1;
    return { ping, jitter };
  }

  // Runs `streams` workers for TEST_MS, ignores the warmup window, and reports live speed.
  // `worker(signal, onBytes)` must keep transferring until the signal aborts.
  async function timedTransfer(streams, worker, onSpeed) {
    const ctrl = new AbortController();
    const start = performance.now();
    let total = 0;
    let measured = 0;
    let measureStart = null;
    let end = null;

    const onBytes = (n) => {
      if (end !== null) return;
      total += n;
      if (performance.now() - start >= WARMUP_MS) {
        if (measureStart === null) measureStart = performance.now();
        measured += n;
      }
    };

    const timer = setInterval(() => {
      const now = performance.now();
      const live = measureStart ? toMbps(measured, now - measureStart) : toMbps(total, now - start);
      onSpeed(live);
    }, 150);

    const jobs = Array.from({ length: streams }, () => worker(ctrl.signal, onBytes).catch(() => {}));
    await new Promise((r) => setTimeout(r, TEST_MS));
    // Freeze the measurement before aborting so teardown time doesn't count.
    end = performance.now();
    ctrl.abort();
    clearInterval(timer);
    await Promise.allSettled(jobs);

    return measureStart ? toMbps(measured, end - measureStart) : toMbps(total, end - start);
  }

  async function downloadWorker(signal, onBytes) {
    while (!signal.aborted) {
      const res = await fetch(`/api/down?bytes=${25 * 1024 * 1024}&r=${Math.random()}`, {
        cache: "no-store",
        signal,
      });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.byteLength);
      }
    }
  }

  let uploadBlob;
  function getUploadBlob() {
    if (!uploadBlob) {
      const buf = new Uint8Array(UP_BLOB_BYTES);
      for (let i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
      uploadBlob = new Blob([buf]);
    }
    return uploadBlob;
  }

  // XHR because fetch() has no upload progress events.
  function uploadWorker(signal, onBytes) {
    const blob = getUploadBlob();
    return new Promise((resolve) => {
      // One listener per stream; it aborts whichever request is in flight.
      let current = null;
      signal.addEventListener("abort", () => current && current.abort(), { once: true });
      const send = () => {
        if (signal.aborted) return resolve();
        const xhr = new XMLHttpRequest();
        current = xhr;
        let last = 0;
        xhr.upload.onprogress = (e) => {
          onBytes(e.loaded - last);
          last = e.loaded;
        };
        xhr.onload = send;
        xhr.onerror = resolve;
        xhr.onabort = resolve;
        xhr.open("POST", `/api/up?r=${Math.random()}`);
        xhr.send(blob);
      };
      send();
    });
  }

  // ---------- results ----------
  // Rough thresholds for common uses, in the spirit of nperf/speedtest quality ratings.
  function verdict(r) {
    const rate = (ok) => (ok === 2 ? "Great" : ok === 1 ? "OK" : "Poor");
    const score = (conds) => conds.filter(Boolean).length;
    const items = [
      ["4K streaming", score([r.down >= 25, r.down >= 50])],
      ["HD video calls", score([r.up >= 3 && r.down >= 5 && r.jitter < 30, r.up >= 10 && r.jitter < 10])],
      ["Online gaming", score([r.ping < 60 && r.jitter < 20, r.ping < 25 && r.jitter < 8])],
      ["Large downloads", score([r.down >= 50, r.down >= 300])],
      ["Cloud backup / uploads", score([r.up >= 10, r.up >= 50])],
    ];
    const box = $("verdict");
    box.innerHTML = "<strong>What this connection is good for</strong><ul>" +
      items.map(([k, v]) => `<li>${k}: <b class="r${v}">${rate(v)}</b></li>`).join("") + "</ul>";
    box.hidden = false;
  }

  function showOffer(down) {
    const o = cfg.offer;
    if (!o || !o.enabled) return;
    if (o.showBelowMbps && down >= o.showBelowMbps) return;
    $("offerTitle").textContent = o.title;
    $("offerText").textContent = o.text;
    $("offerCta").textContent = o.cta;
    $("offerCta").href = o.url;
    $("offer").hidden = false;
  }

  function showShare(r) {
    const params = new URLSearchParams({
      d: r.down.toFixed(1), u: r.up.toFixed(1), p: r.ping.toFixed(0), j: r.jitter.toFixed(1),
    });
    const link = `${location.origin}/?${params}`;
    $("copyLink").onclick = async () => {
      await navigator.clipboard.writeText(link);
      $("copyLink").textContent = "Copied!";
      setTimeout(() => ($("copyLink").textContent = "Copy result link"), 1500);
    };
    const text = `My internet: ${fmt(r.down)} Mbps down / ${fmt(r.up)} Mbps up, ${r.ping.toFixed(0)} ms ping. Test yours:`;
    $("tweet").href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
    $("share").hidden = false;
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }

  function saveHistory(r) {
    const list = [{ ...r, at: Date.now() }, ...loadHistory()].slice(0, 20);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    $("historyList").innerHTML = list.length
      ? list.map((h) =>
          `<li>${new Date(h.at).toLocaleString()} - ${fmt(h.down)} down / ${fmt(h.up)} up, ` +
          `${h.ping.toFixed(0)} ms${h.isp ? " - " + escapeHtml(h.isp) : ""}</li>`).join("")
      : "<li class='muted'>No tests yet.</li>";
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  async function loadMeta() {
    try {
      const m = await (await fetch("/api/meta", { cache: "no-store" })).json();
      $("isp").textContent = m.isp || "Unknown";
      $("ip").textContent = m.ip || "-";
      $("loc").textContent = [m.city, m.country].filter(Boolean).join(", ") || "-";
      $("colo").textContent = m.colo ? `Cloudflare ${m.colo}` : "Local";
      return m;
    } catch {
      return {};
    }
  }

  // ---------- run ----------
  async function run() {
    const btn = $("go");
    btn.disabled = true;
    for (const id of ["verdict", "share", "offer"]) $(id).hidden = true;
    for (const id of ["ping", "jitter", "down", "up"]) $(id).textContent = "-";
    setScale(SCALES[0]);

    try {
      const meta = await loadMeta();

      $("phase").textContent = "Measuring ping...";
      const { ping, jitter } = await measurePing();
      $("ping").textContent = ping.toFixed(0);
      $("jitter").textContent = jitter.toFixed(1);

      $("phase").textContent = "Testing download...";
      $("gaugeFill").style.stroke = "var(--accent)";
      const down = await timedTransfer(DOWN_STREAMS, downloadWorker, setGauge);
      $("down").textContent = fmt(down);

      $("phase").textContent = "Testing upload...";
      $("gaugeFill").style.stroke = "var(--accent2)";
      setGauge(0);
      const up = await timedTransfer(UP_STREAMS, uploadWorker, setGauge);
      $("up").textContent = fmt(up);

      setGauge(down);
      $("gaugeFill").style.stroke = "var(--accent)";
      $("phase").textContent = "Done";

      const result = { down, up, ping, jitter, isp: meta.isp || "" };
      verdict(result);
      showShare(result);
      showOffer(down);
      saveHistory(result);
    } catch (e) {
      $("phase").textContent = "Test failed. Check your connection and try again.";
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = "AGAIN";
    }
  }

  // Shared links (?d=..&u=..) show the sender's result without running a test.
  function showSharedResult() {
    const q = new URLSearchParams(location.search);
    if (!q.has("d")) return;
    const r = { down: +q.get("d"), up: +q.get("u") || 0, ping: +q.get("p") || 0, jitter: +q.get("j") || 0 };
    $("down").textContent = fmt(r.down);
    $("up").textContent = fmt(r.up);
    $("ping").textContent = r.ping.toFixed(0);
    $("jitter").textContent = r.jitter.toFixed(1);
    setGauge(r.down);
    $("phase").textContent = "Shared result. Press GO to test yours.";
    verdict(r);
  }

  // ---------- ads ----------
  function initAds() {
    if (!cfg.adsenseClient) return;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.adsenseClient}`;
    document.head.appendChild(s);
    document.querySelectorAll(".ad").forEach((el) => {
      const slot = cfg.adSlots && cfg.adSlots[el.dataset.slot];
      if (!slot) return;
      el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.adsenseClient}" ` +
        `data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      el.hidden = false;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  // ---------- init ----------
  $("gaugeTrack").setAttribute("d", arcPath(1));
  drawTicks();
  setGauge(0);
  $("go").addEventListener("click", run);
  $("clearHistory").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
  $("year").textContent = new Date().getFullYear();
  renderHistory();
  showSharedResult();
  loadMeta();
  initAds();
})();
