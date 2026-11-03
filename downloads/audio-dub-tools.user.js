// ==UserScript==
// @name         Audio Dub Extractor — метки клипов
// @namespace    https://9xj89gzrtw-hue.github.io/audio-dub-extractor/
// @version      1.0.0
// @description  Ставит метки времени на YouTube-видео и отдаёт проект для Studio: список клипов с началом и концом.
// @author       Toolworks
// @match        https://www.youtube.com/watch*
// @match        https://youtu.be/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Free-часть Audio Dub Extractor.
 *
 * Что делает: читает позицию плеера и превращает её в метку; две метки рядом —
 * это клип. Метки хранятся в localStorage по id видео, экспорт — JSON, который
 * открывает Studio (Pro) и режет по этим таймкодам.
 *
 * Чего не делает: не скачивает и не декодирует звук, не обращается к сети.
 * Скачивание звука — задача двух расширений, они лежат рядом на странице.
 */
(function () {
  "use strict";

  const KEY = "audio-dub-marks:v1";
  const PANEL_ID = "audio-dub-panel";

  function videoId() {
    const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/) || location.pathname.match(/^\/watch/);
    if (location.pathname.startsWith("/watch")) {
      return new URLSearchParams(location.search).get("v") || location.pathname;
    }
    if (m && location.pathname.startsWith("/shorts/")) return m[1];
    return location.pathname.replace(/[^\w-]+/g, "_") || "video";
  }

  function video() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function title() {
    const el = document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector("h1.title yt-formatted-string") ||
      document.querySelector("h1");
    return (el && el.textContent.trim()) || document.title.replace(/ - YouTube$/, "");
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; }
  }
  function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* приватный режим */ }
  }
  function marks() {
    const all = load();
    return Array.isArray(all[videoId()]) ? all[videoId()] : [];
  }
  function setMarks(list) {
    const all = load();
    all[videoId()] = list.slice(-500);
    save(all);
  }

  function tc(seconds) {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    const two = (n) => String(n).padStart(2, "0");
    return (h ? two(h) + ":" : "") + two(m) + ":" + two(s) + "." + String(milli).padStart(3, "0");
  }

  function pairs(list) {
    // Каждая пара меток — клип. Нечётный хвост остаётся «точкой входа» и в
    // проект не попадает: Studio не должен молча выдумывать конец.
    const out = [];
    for (let i = 0; i + 1 < list.length; i += 2) out.push({ start: list[i].at, end: list[i + 1].at });
    return out;
  }

  function toast(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483647;" +
      "background:#0f172a;color:#fff;font:500 13px/1.4 -apple-system,system-ui,sans-serif;padding:9px 14px;border-radius:8px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.32);pointer-events:none";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function copy(text, note) {
    const done = () => toast(note || "Скопировано");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Не удалось скопировать"); }
      ta.remove();
    }
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function project() {
    const clips = pairs(marks());
    const safe = title().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "video";
    return {
      app: "audio-dub-extractor",
      version: 1,
      savedAt: new Date().toISOString(),
      source: location.href,
      title: title(),
      items: clips.map((c, i) => ({
        name: safe + " часть " + (i + 1),
        in: tc(c.start),
        out: tc(c.end),
        source: location.href
      }))
    };
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const list = marks();
    const body = panel.querySelector("[data-marks]");
    const info = panel.querySelector("[data-info]");
    const v = video();
    info.textContent = v ? "Сейчас " + tc(v.currentTime) + " · меток " + list.length + " · клипов " + pairs(list).length
      : "Плеер не найден — откройте видео.";
    body.textContent = "";
    if (!list.length) {
      const p = document.createElement("div");
      p.style.cssText = "color:#94a3b8;font-size:12px;padding:6px 0";
      p.textContent = "Нажмите M в начале фрагмента и ещё раз в конце — получится клип.";
      body.appendChild(p);
      return;
    }
    list.forEach((mark, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;padding:3px 0;font-size:12px";
      const dot = document.createElement("span");
      dot.textContent = i % 2 === 0 ? "▸" : "▪";
      dot.style.color = i % 2 === 0 ? "#38bdf8" : "#86efac";
      const time = document.createElement("button");
      time.textContent = tc(mark.at);
      time.style.cssText = "background:none;border:0;color:#e2e8f0;font:inherit;font-family:ui-monospace,monospace;cursor:pointer;padding:0";
      time.title = "Перейти к метке";
      time.onclick = () => { const vv = video(); if (vv) vv.currentTime = mark.at; };
      const del = document.createElement("button");
      del.textContent = "✕";
      del.style.cssText = "margin-left:auto;background:none;border:0;color:#64748b;cursor:pointer;font-size:12px;padding:0 2px";
      del.title = "Удалить метку";
      del.onclick = () => { const next = marks(); next.splice(i, 1); setMarks(next); render(); };
      row.append(dot, time, del);
      body.appendChild(row);
    });
  }

  function addMark() {
    const v = video();
    if (!v) { toast("Плеер не найден"); return; }
    const list = marks();
    list.push({ at: Number(v.currentTime) || 0, title: title() });
    setMarks(list);
    render();
    toast("Метка " + tc(v.currentTime) + " · " + (list.length % 2 ? "начало клипа" : "конец клипа"));
  }

  function build() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;width:250px;" +
      "background:#111827;color:#e2e8f0;border:1px solid #334155;border-radius:12px;" +
      "box-shadow:0 12px 32px rgba(0,0,0,.4);font:13px/1.4 -apple-system,system-ui,sans-serif;overflow:hidden";
    panel.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1f2937">',
      '  <b style="font-size:12.5px">Метки клипов</b>',
      '  <button data-close style="margin-left:auto;background:none;border:0;color:#94a3b8;cursor:pointer;font-size:15px" title="Свернуть">✕</button>',
      '</div>',
      '<div style="padding:10px 12px">',
      '  <button data-mark style="width:100%;background:#2563eb;color:#fff;border:0;border-radius:7px;padding:8px;font:600 12.5px inherit;cursor:pointer">Отметить момент (M)</button>',
      '  <div data-info style="color:#94a3b8;font-size:11.5px;margin:8px 0 4px"></div>',
      '  <div data-marks style="max-height:150px;overflow:auto"></div>',
      '  <div style="display:flex;gap:6px;margin-top:8px">',
      '    <button data-copy style="flex:1;background:#1f2937;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;font:500 11.5px inherit;cursor:pointer">Список</button>',
      '    <button data-project style="flex:1;background:#1f2937;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;font:500 11.5px inherit;cursor:pointer">Проект JSON</button>',
      '  </div>',
      '</div>'
    ].join("");
    document.body.appendChild(panel);
    panel.querySelector("[data-mark]").onclick = addMark;
    panel.querySelector("[data-copy]").onclick = () => {
      const list = marks();
      if (!list.length) { toast("Меток пока нет"); return; }
      copy(list.map((m, i) => (i % 2 ? "  конец " : "") + tc(m.at)).join("\n"), "Список меток скопирован");
    };
    panel.querySelector("[data-project]").onclick = () => {
      const p = project();
      if (!p.items.length) { toast("Нужны пары меток: начало и конец"); return; }
      const safe = p.title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 50) || "clips";
      download(safe + ".audio-dub.json", JSON.stringify(p, null, 2));
    };
    panel.querySelector("[data-close]").onclick = () => panel.remove();
    render();
    setInterval(render, 1000);
  }

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M" || e.key === "ь") { e.preventDefault(); addMark(); }
  });

  const start = () => {
    if (!document.body) { setTimeout(start, 300); return; }
    build();
    // YouTube перерисовывает страницу при переходе между видео без перезагрузки.
    let href = location.href;
    setInterval(() => { if (location.href !== href) { href = location.href; build(); render(); } }, 1200);
  };
  start();
})();
