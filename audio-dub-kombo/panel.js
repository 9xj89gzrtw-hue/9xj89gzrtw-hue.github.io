/* Audio Dub Kombo — the panel that runs on the video page.
 *
 * Three jobs, one panel:
 *   1. capture the Yandex AI-dub audio stream and download it;
 *   2. download the original soundtrack;
 *   3. drop in/out timecodes and open them in Studio.
 *
 * It never hides what it is doing: the status line names the host and the
 * format of whatever it is about to download, and when only a muxed MP4 is
 * available it says so instead of promising a bare audio file.
 */
(function () {
  "use strict";

  var C = window.AudioDubCore;
  if (!C) return;

  var SITE = C.siteOf(window.location);
  if (!SITE) return;
  if (window.__adkPanelLoaded) return;
  window.__adkPanelLoaded = true;

  var PANEL_ID = "adk-panel";
  var CSS_ID = "adk-style";
  var candidates = [];
  var seen = Object.create(null);
  var renderQueued = false;
  var lastAutoOpen = -1;

  var state = {
    collapsed: readFlag("adk:collapsed", false),
    autoOpen: readFlag("adk:autoopen", true),
    busy: "",
    status: "",
    error: ""
  };

  function readFlag(name, fallback) {
    try {
      var raw = localStorage.getItem(name);
      return raw == null ? fallback : raw === "1";
    } catch (e) { return fallback; }
  }
  function writeFlag(name, value) {
    try { localStorage.setItem(name, value ? "1" : "0"); } catch (e) { /* private mode */ }
  }

  /* --- capture --------------------------------------------------------- */

  function remember(url, source) {
    if (!url || typeof url !== "string") return;
    if (url.slice(0, 5) !== "https" && url.slice(0, 4) !== "http") return;
    if (seen[url]) return;
    var info = C.classify(url);
    if (!info) return;
    seen[url] = true;
    candidates.push({ url: url, kind: info.kind, ext: info.ext, score: info.score, host: info.host, at: Date.now(), source: source });
    if (candidates.length > 400) {
      var dropped = candidates.splice(0, 100);
      dropped.forEach(function (c) { delete seen[c.url]; });
    }
    scheduleRender();
  }

  function hookFetch() {
    var original = window.fetch;
    if (typeof original !== "function" || original.__adk) return;
    var wrapped = function (input) {
      try {
        var url = typeof input === "string" ? input : (input && input.url);
        remember(url, "fetch");
      } catch (e) { /* never break the page for a log line */ }
      return original.apply(this, arguments).then(function (res) {
        try { if (res && res.url) remember(res.url, "fetch"); } catch (e) { /* ignore */ }
        return res;
      });
    };
    wrapped.__adk = true;
    window.fetch = wrapped;
  }

  function hookXhr() {
    var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__adk) return;
    var open = proto.open;
    proto.open = function (method, url) {
      try { remember(String(url), "xhr"); } catch (e) { /* ignore */ }
      return open.apply(this, arguments);
    };
    proto.__adk = true;
  }

  function hookMedia() {
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (proto && !proto.__adkSrc) {
      var desc = Object.getOwnPropertyDescriptor(proto, "src");
      if (desc && desc.set) {
        Object.defineProperty(proto, "src", {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (value) {
            try { remember(String(value), "media"); } catch (e) { /* ignore */ }
            return desc.set.call(this, value);
          }
        });
      }
      proto.__adkSrc = true;
    }
    ["loadedmetadata", "play", "durationchange"].forEach(function (name) {
      document.addEventListener(name, function (e) {
        var t = e.target;
        if (!t || !t.currentSrc) return;
        remember(t.currentSrc, "media");
      }, true);
    });
    /* YouTube and VK set src as an attribute on players they rebuild. */
    try {
      var mo = new MutationObserver(function (records) {
        records.forEach(function (r) {
          if (r.target && r.target.currentSrc) remember(r.target.currentSrc, "attr");
          if (r.addedNodes) {
            r.addedNodes.forEach(function (n) {
              if (!n || n.nodeType !== 1) return;
              if (n.currentSrc) remember(n.currentSrc, "attr");
              if (n.querySelectorAll) {
                n.querySelectorAll("video,audio,source").forEach(function (el) {
                  if (el.currentSrc) remember(el.currentSrc, "attr");
                  if (el.src) remember(el.src, "attr");
                });
              }
            });
          }
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    } catch (e) { /* no MutationObserver: the other hooks still work */ }
  }

  function scanPerformance() {
    try {
      performance.getEntriesByType("resource").forEach(function (entry) {
        remember(entry && entry.name, "perf");
      });
    } catch (e) { /* ignore */ }
  }

  function watchPerformance() {
    try {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { remember(entry && entry.name, "perf"); });
      });
      po.observe({ entryTypes: ["resource"] });
    } catch (e) { /* Safari without PerformanceObserver: fall back to polling */ }
  }

  function collect() {
    scanPerformance();
    var extra = Array.isArray(window.__AUDIO_DUB_TEST__) ? window.__AUDIO_DUB_TEST__ : [];
    var list = candidates.slice();
    extra.forEach(function (item) {
      list.push(typeof item === "string" ? { url: item } : item);
    });
    return C.rank(list);
  }

  /* --- page context ---------------------------------------------------- */

  function videoId() {
    var loc = window.location;
    if (SITE.id === "youtube") {
      var v = C.query(loc.search, "v");
      if (v) return v;
      var shorts = /\/shorts\/([\w-]{6,})/.exec(loc.pathname);
      if (shorts) return shorts[1];
      return loc.pathname.replace(/[^\w-]+/g, "_");
    }
    return loc.pathname.replace(/[^\w-]+/g, "_").slice(0, 120) || "video";
  }

  function pageTitle() {
    var sels = SITE.id === "youtube"
      ? ["h1.ytd-watch-metadata yt-formatted-string", "#title h1 yt-formatted-string", "h1.title yt-formatted-string", "h1"]
      : ["h1", ".vv_title", ".video-title", "title"];
    for (var i = 0; i < sels.length; i += 1) {
      var el = document.querySelector(sels[i]);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim().replace(/\s*[-—]\s*(YouTube|VK|Rutube).*$/i, "");
      }
    }
    return document.title.replace(/\s*[-—]\s*(YouTube|VK|Rutube).*$/i, "");
  }

  function player() {
    return document.querySelector("video.html5-main-video") ||
      document.querySelector("video") ||
      document.querySelector("audio");
  }

  function marksAll() {
    try { return JSON.parse(localStorage.getItem(C.MARK_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function marks() {
    var all = marksAll();
    var key = videoId();
    return Array.isArray(all[key]) ? all[key] : [];
  }
  function setMarks(list) {
    var all = marksAll();
    all[videoId()] = list.slice(-C.MAX_MARKS);
    try { localStorage.setItem(C.MARK_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }

  function license() {
    var rec = C.storedLicense(C.PRODUCT);
    return rec && rec.kind === "license" ? rec : null;
  }
  function isPro() {
    var rec = C.storedLicense(C.PRODUCT);
    return !!(rec && rec.hash);
  }

  /* --- panel ----------------------------------------------------------- */

  var LABEL = {
    title: "Audio Dub Kombo",
    dub: "Скачать озвучку Яндекса (MP3)",
    audio: "Скачать оригинальный звук (M4A/MP3)",
    mark: "Метка клипа [M] → Открыть в Studio",
    idle: "Панель готова. Включите видео, чтобы поймать поток.",
    nothing: "Поток не найден. Включите озвучку/звук на странице и нажмите ещё раз.",
    proFree: "Free: 2 файла по 30 с",
    proOn: "Pro активен: 200 файлов, любая длина"
  };

  function css() {
    return [
      "#" + PANEL_ID + "{--adk:" + SITE.accent + ";--adk-soft:" + SITE.accentSoft + ";",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f0f0f;background:#fff;",
      "border:1px solid #e5e5e5;border-radius:12px;padding:0;margin:14px 0;overflow:hidden;",
      "box-shadow:0 1px 2px rgba(0,0,0,.05);max-width:820px}",
      "#" + PANEL_ID + ".adk-float{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:288px;margin:0;",
      "box-shadow:0 12px 40px rgba(0,0,0,.22)}",
      "#" + PANEL_ID + " .adk-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--adk-soft);",
      "border-bottom:1px solid #ececec}",
      "#" + PANEL_ID + " .adk-dot{width:8px;height:8px;border-radius:50%;background:var(--adk);flex:none}",
      "#" + PANEL_ID + " .adk-name{font-weight:700;font-size:13px;letter-spacing:-.01em}",
      "#" + PANEL_ID + " .adk-site{font-size:11.5px;color:#606060}",
      "#" + PANEL_ID + " .adk-pill{margin-left:auto;font-size:10.5px;font-weight:700;letter-spacing:.02em;color:var(--adk);",
      "background:#fff;border:1px solid #dcdcdc;border-radius:999px;padding:2px 8px}",
      "#" + PANEL_ID + " .adk-x{background:none;border:0;color:#606060;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px}",
      "#" + PANEL_ID + " .adk-body{padding:10px 12px 12px}",
      "#" + PANEL_ID + " .adk-btn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;",
      "border:1px solid #e0e0e0;background:#f7f7f7;color:#0f0f0f;border-radius:8px;padding:8px 11px;",
      "font:600 12.5px/1.3 inherit;margin:0 0 7px}",
      "#" + PANEL_ID + " .adk-btn:hover{background:#efefef}",
      "#" + PANEL_ID + " .adk-btn[disabled]{opacity:.55;cursor:progress}",
      "#" + PANEL_ID + " .adk-btn.adk-primary{background:var(--adk);border-color:var(--adk);color:#fff}",
      "#" + PANEL_ID + " .adk-btn.adk-primary:hover{filter:brightness(1.07)}",
      "#" + PANEL_ID + " .adk-btn.adk-link{background:transparent;border-style:dashed;color:var(--adk)}",
      "#" + PANEL_ID + " .adk-btn .adk-ico{width:15px;height:15px;flex:none;opacity:.85}",
      "#" + PANEL_ID + " .adk-status{font-size:11.5px;color:#606060;margin:4px 0 8px;min-height:15px}",
      "#" + PANEL_ID + " .adk-status.adk-bad{color:#b3261e}",
      "#" + PANEL_ID + " .adk-status.adk-good{color:#137333}",
      "#" + PANEL_ID + " .adk-marks{display:flex;flex-direction:column;gap:4px;max-height:132px;overflow:auto}",
      "#" + PANEL_ID + " .adk-mark{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#0f0f0f}",
      "#" + PANEL_ID + " .adk-mark b{font-weight:600}",
      "#" + PANEL_ID + " .adk-mark button{background:none;border:0;padding:0;cursor:pointer;font:inherit;color:#606060}",
      "#" + PANEL_ID + " .adk-mark button.adk-time{color:var(--adk);font-variant-numeric:tabular-nums}",
      "#" + PANEL_ID + " .adk-mark .adk-del{margin-left:auto;font-size:12px}",
      "#" + PANEL_ID + " .adk-empty{font-size:11.5px;color:#909090}",
      "#" + PANEL_ID + " .adk-pro{margin-top:10px;border-top:1px solid #ececec;padding-top:9px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
      "#" + PANEL_ID + " .adk-pro span{font-size:11.5px;color:#606060}",
      "#" + PANEL_ID + " .adk-pro input{flex:1;min-width:120px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;",
      "border:1px solid #dcdcdc;border-radius:6px;padding:5px 7px;color:#0f0f0f;background:#fff}",
      "#" + PANEL_ID + " .adk-pro button{background:#fff;border:1px solid var(--adk);color:var(--adk);border-radius:6px;",
      "padding:5px 9px;font:600 11.5px inherit;cursor:pointer}",
      "#" + PANEL_ID + " .adk-chip{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:var(--adk);color:#fff;",
      "border:0;border-radius:999px;padding:9px 14px;font:600 12px/1 inherit;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.24)}"
    ].join("");
  }

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = css();
    (document.head || document.documentElement).appendChild(style);
  }

  function icon(name) {
    var paths = {
      dub: "M12 3v12m0 0 4-4m-4 4-4-4M5 21h14",
      audio: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
      mark: "M6 3v18l6-4 6 4V3H6Z"
    };
    return '<svg class="adk-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
  }

  function findAnchor() {
    for (var i = 0; i < SITE.anchor.length; i += 1) {
      var el = document.querySelector(SITE.anchor[i]);
      if (el && el !== document.body) return el;
    }
    return null;
  }

  function build() {
    injectCss();
    var anchor = findAnchor();
    var panel = document.getElementById(PANEL_ID);
    if (panel && anchor && panel.parentNode === anchor) return panel;

    if (panel) panel.remove();
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    if (!anchor) panel.className = "adk-float";
    panel.innerHTML = [
      '<div class="adk-head">',
      '  <span class="adk-dot"></span>',
      '  <span class="adk-name">' + LABEL.title + '</span>',
      '  <span class="adk-site">' + SITE.name + '</span>',
      '  <span class="adk-pill" data-pill>Free</span>',
      '  <button class="adk-x" type="button" data-collapse title="Свернуть">&minus;</button>',
      '</div>',
      '<div class="adk-body">',
      '  <button class="adk-btn adk-primary" type="button" data-dub>' + icon("dub") + '<span>' + LABEL.dub + '</span></button>',
      '  <button class="adk-btn" type="button" data-audio>' + icon("audio") + '<span>' + LABEL.audio + '</span></button>',
      '  <button class="adk-btn adk-link" type="button" data-mark>' + icon("mark") + '<span>' + LABEL.mark + '</span></button>',
      '  <div class="adk-status" data-status>' + LABEL.idle + '</div>',
      '  <div class="adk-marks" data-marks></div>',
      '  <div class="adk-pro" data-pro></div>',
      '</div>'
    ].join("");

    if (anchor) anchor.insertBefore(panel, anchor.firstChild);
    else document.body.appendChild(panel);
    wire(panel);
    return panel;
  }

  function setStatus(text, kind) {
    state.status = text;
    var el = document.querySelector("#" + PANEL_ID + " [data-status]");
    if (!el) return;
    el.textContent = text;
    el.className = "adk-status" + (kind ? " adk-" + kind : "");
  }

  function candidatesText() {
    var list = collect();
    var dub = list.filter(function (c) { return c.kind === "dub"; })[0];
    var audio = C.best(list, "audio");
    var bits = [];
    if (dub) bits.push("озвучка: " + dub.host);
    if (audio) bits.push((audio.fallback ? "звук: MP4 (дорожка внутри)" : "звук: " + (audio.ext || "m4a")) + " · " + audio.host);
    return bits.join(" · ");
  }

  function render() {
    renderQueued = false;
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    var list = marks();
    var pill = panel.querySelector("[data-pill]");
    var pro = isPro();
    pill.textContent = pro ? "Pro" : "Free";
    pill.style.background = pro ? SITE.accent : "#fff";
    pill.style.color = pro ? "#fff" : SITE.accent;

    var body = panel.querySelector(".adk-body");
    if (state.collapsed) { body.style.display = "none"; return; }
    body.style.display = "";

    var markBtn = panel.querySelector("[data-mark] span");
    var clips = C.pairs(list).length;
    markBtn.textContent = list.length % 2
      ? "Конец клипа [M] · начало " + C.tc(list[list.length - 1].at)
      : clips && state.autoOpen === false
        ? "Открыть в Studio (" + clips + " клип" + (clips === 1 ? "" : "а") + ")"
        : LABEL.mark;

    var box = panel.querySelector("[data-marks]");
    box.textContent = "";
    var player_ = player();
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "adk-empty";
      empty.textContent = "Нажмите M в начале фрагмента и ещё раз в конце — клип уйдёт в Studio.";
      box.appendChild(empty);
    } else {
      list.forEach(function (mark, i) {
        var row = document.createElement("div");
        row.className = "adk-mark";
        var label = document.createElement("b");
        label.textContent = i % 2 === 0 ? "начало" : "конец";
        var time = document.createElement("button");
        time.type = "button";
        time.className = "adk-time";
        time.textContent = C.tc(mark.at);
        time.title = "Перейти к метке";
        time.addEventListener("click", function () {
          var v = player();
          if (v) v.currentTime = mark.at;
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "adk-del";
        del.textContent = "\u00d7";
        del.title = "Удалить метку";
        del.addEventListener("click", function () {
          var next = marks();
          next.splice(i, 1);
          setMarks(next);
          render();
        });
        row.append(label, time, del);
        box.appendChild(row);
      });
      if (clips) {
        var open = document.createElement("button");
        open.type = "button";
        open.className = "adk-btn adk-link";
        open.style.marginTop = "6px";
        open.textContent = "Открыть в Studio: " + clips + " клип" + (clips === 1 ? "" : "а") + " · " + C.tc(C.pairs(list).reduce(function (s, c) { return s + c.end - c.start; }, 0));
        open.addEventListener("click", function () { openStudio(); });
        box.appendChild(open);
      }
    }

    var proBox = panel.querySelector("[data-pro]");
    proBox.textContent = "";
    if (pro) {
      var span = document.createElement("span");
      span.textContent = LABEL.proOn;
      proBox.appendChild(span);
      var off = document.createElement("button");
      off.type = "button";
      off.textContent = "сбросить";
      off.addEventListener("click", function () {
        try { localStorage.removeItem("unlock:" + C.PRODUCT); } catch (e) { /* ignore */ }
        render();
      });
      proBox.appendChild(off);
    } else {
      var hint = document.createElement("span");
      hint.textContent = LABEL.proFree + " · Pro $7 / 299 ₽:";
      proBox.appendChild(hint);
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "TW1-…";
      input.value = state.pendingKey || "";
      input.addEventListener("input", function () { state.pendingKey = input.value; });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); activate(input.value); }
      });
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Активировать";
      btn.addEventListener("click", function () { activate(input.value); });
      proBox.append(input, btn);
    }

    if (!state.status) {
      var now = candidatesText();
      setStatus(now ? "Найдено · " + now : LABEL.idle);
    }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { try { render(); } catch (e) { /* ignore */ } });
  }

  function addMark() {
    var v = player();
    if (!v) { setStatus("Плеер не найден — откройте видео.", "bad"); return; }
    var list = marks();
    list.push({ at: Number(v.currentTime) || 0, title: pageTitle() });
    setMarks(list);
    var box = document.getElementById(PANEL_ID);
    state.status = "";
    render();

    if (state.collapsed) {
      var chip = document.querySelector(".adk-chip");
      if (chip) chip.textContent = LABEL.title + " · " + list.length;
    }
    if (list.length % 2 === 0) {
      var clips = C.pairs(list).length;
      if (state.autoOpen && clips > lastAutoOpen) {
        lastAutoOpen = clips;
        openStudio();
      } else {
        setStatus("Клип " + clips + " готов. Откройте Studio кнопкой ниже.", "good");
      }
    } else {
      setStatus("Начало клипа: " + C.tc(list[list.length - 1].at) + ". Нажмите M в конце.", "good");
    }
    void box;
  }

  function openStudio() {
    var list = marks();
    var project = C.buildProject({ marks: list, title: pageTitle(), url: window.location.href });
    if (!project.items.length) {
      setStatus(list.length < 2
        ? "Нужны две метки: начало и конец."
        : "Конец совпал с началом — поставьте метки на разные секунды.", "bad");
      return;
    }
    var lic = license();
    var url = C.studioUrl(project, lic ? lic.hash.replace(/^license:/, "") : null);
    setStatus("Открываем Studio: " + project.items.length + " клип(а).", "good");
    window.open(url, "_blank", "noopener");
  }

  async function activate(key) {
    var text = String(key || "").trim();
    if (!text) { setStatus("Вставьте ключ TW1-… из письма магазина.", "bad"); return; }
    if (!C.isLicenseKey(text)) { setStatus("Это не ключ TW1: нужен формат TW1-<КОД>-<ID>-<ПОДПИСЬ>.", "bad"); return; }
    var res = await C.verifyLicense(text, { product: C.PRODUCT });
    if (!res.valid) {
      var map = {
        format: "Ключ скопирован не полностью.",
        signature: "Подпись не сходится — проверьте ключ.",
        product: "Ключ от другого продукта.",
        crypto: "Браузер не дал проверить подпись (crypto.subtle)."
      };
      setStatus(map[res.error] || "Ключ не принят.", "bad");
      return;
    }
    if (!C.storeLicense(C.PRODUCT, res)) { setStatus("Не удалось сохранить ключ в этом браузере.", "bad"); return; }
    state.pendingKey = "";
    setStatus("Ключ принят. Pro активен: 200 файлов в Studio, клипы любой длины.", "good");
    render();
  }

  async function onDownload(kind) {
    var btn = document.querySelector("#" + PANEL_ID + (kind === "dub" ? " [data-dub]" : " [data-audio]"));
    if (state.busy) return;
    state.busy = kind;
    if (btn) btn.disabled = true;
    try {
      var list = collect();
      var pick = kind === "dub" ? list.filter(function (c) { return c.kind === "dub"; })[0] : C.best(list, "audio");
      if (!pick) {
        setStatus(kind === "dub"
          ? "Озвучка не найдена. Включите перевод/озвучку на странице и нажмите снова."
          : LABEL.nothing, "bad");
        return;
      }
      var name = C.filenameFor(kind, pageTitle(), pick.ext);
      setStatus("Скачиваем " + (pick.fallback ? "MP4 (дорожка внутри)" : pick.ext) + " · " + pick.host + "…");
      var res = await C.download(pick.url, name);
      if (!res.ok) {
        setStatus("Не вышло: " + (res.message || res.error) + ". Попробуйте ещё раз после 2–3 секунд воспроизведения.", "bad");
        return;
      }
      var size = res.bytes
        ? " · " + (res.bytes >= 1048576 ? (res.bytes / 1048576).toFixed(1) + " МБ" : Math.round(res.bytes / 1024) + " КБ")
        : "";
      setStatus("Готово: " + name + size + " · " + pick.host +
        (pick.fallback ? " · звук внутри видеофайла, дорожку вытащит Studio" : ""), "good");
    } catch (e) {
      setStatus("Ошибка: " + ((e && e.message) || e), "bad");
    } finally {
      state.busy = "";
      if (btn) btn.disabled = false;
    }
  }

  function wire(panel) {
    panel.querySelector("[data-dub]").addEventListener("click", function () { onDownload("dub"); });
    panel.querySelector("[data-audio]").addEventListener("click", function () { onDownload("audio"); });
    panel.querySelector("[data-mark]").addEventListener("click", addMark);
    panel.querySelector("[data-collapse]").addEventListener("click", function () { collapse(true); });
  }

  function collapse(hide) {
    state.collapsed = hide;
    writeFlag("adk:collapsed", hide);
    var panel = document.getElementById(PANEL_ID);
    var chip = document.querySelector(".adk-chip");
    if (hide) {
      if (panel) panel.remove();
      if (!chip) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "adk-chip";
        chip.textContent = LABEL.title + " · " + marks().length;
        chip.addEventListener("click", function () { collapse(false); });
        document.body.appendChild(chip);
      }
    } else {
      if (chip) chip.remove();
      build();
      render();
    }
  }

  /* --- lifecycle -------------------------------------------------------- */

  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") {
      e.preventDefault();
      addMark();
    }
  });

  var lastHref = location.href;
  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastAutoOpen = -1;
      state.status = "";
      scheduleRender();
    }
    scanPerformance();
    if (!state.collapsed && !document.getElementById(PANEL_ID)) {
      try { build(); } catch (e) { /* the site will change again in a second */ }
    }
    if (!state.collapsed) scheduleRender();
  }

  function start() {
    hookFetch();
    hookXhr();
    hookMedia();
    watchPerformance();
    scanPerformance();
    try { build(); } catch (e) { /* ignore */ }
    if (state.collapsed) collapse(true);
    else render();
    setInterval(tick, 1500);
  }

  /* Hooks first: they must be installed before the player asks for a stream. */
  hookFetch();
  hookXhr();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
