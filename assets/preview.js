/* 60-second demo key — client-side only.
 *
 * A buyer should be able to see the Pro interface switch on before paying.
 * The demo grants nothing durable: the entitlement lives in a variable inside
 * assets/unlock.js, no unlock:* record is written, and a reload drops back to
 * Free. Encrypted Pro packs are never decrypted by this path — a page that
 * loads one checks Unlock.isPreview() first and shows a paywall note instead.
 *
 * Usage:
 *   <script src="../assets/preview.js" data-product="tg-chats" defer></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var product = (script && script.getAttribute("data-product")) ||
    (document.body && document.body.getAttribute("data-preview-product")) || "";
  var RU = (document.documentElement.lang || "").toLowerCase().indexOf("ru") === 0;
  var SECONDS = 60;

  var T = RU ? {
    try: "Демо-ключ на 60 секунд",
    run: "Демо: ещё ",
    stop: "Остановить демо",
    note: "Демо-режим в памяти: ничего не сохраняется, Pro-данные не расшифровываются. После оплаты ключ TW1-… откроет всё навсегда.",
    done: "Демо закончилось — Pro снова закрыт. Ключ TW1-… или оплата в 1 клик открывают его навсегда.",
    pro: "Pro уже открыт"
  } : {
    try: "Try a 60-second demo key",
    run: "Demo: ",
    stop: "Stop the demo",
    note: "In-memory demo: nothing is saved and encrypted Pro data stays sealed. A TW1-… key or a one-click payment unlocks it for good.",
    done: "The demo ended — Pro is locked again. A TW1-… key or one-click payment unlocks it for good.",
    pro: "Pro is already active"
  };

  var btn = null;
  var ticker = null;
  var note = null;

  /* One stylesheet for nine pages with five different CSS files: the pill
     carries its own rules so it looks the same everywhere and can never push
     a 390 px viewport sideways. */
  var CSS = [
    ".preview-btn{position:fixed;left:16px;bottom:16px;z-index:70;display:inline-flex;align-items:center;gap:7px;",
    "max-width:calc(100vw - 32px);padding:9px 13px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;",
    "font:550 12.5px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 6px 18px rgba(15,23,42,.12);cursor:pointer}",
    ".preview-btn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".preview-btn:hover{border-color:#334155}",
    ".preview-btn.is-active{border-color:#2c6b4f;color:#1d4d38;background:#ecfdf5}",
    ".preview-btn.is-pro{opacity:.6;cursor:default;box-shadow:none}",
    ".preview-btn[hidden]{display:none}",
    ".preview-note{position:fixed;left:16px;bottom:62px;z-index:70;max-width:min(360px,calc(100vw - 32px));",
    "margin:0;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#334155;",
    "font-size:11.5px;line-height:1.45;box-shadow:0 6px 18px rgba(15,23,42,.12)}",
    ".preview-note[hidden]{display:none}",
    "@media print{.preview-btn,.preview-note{display:none !important}}"
  ].join("");
  function injectCss() {
    if (document.getElementById("preview-css")) return;
    var st = document.createElement("style");
    st.id = "preview-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function ready() {
    return !!(window.Unlock && typeof window.Unlock.startPreview === "function");
  }
  function isRealPro() {
    return ready() && window.Unlock.isPro(product) && !window.Unlock.isPreview(product);
  }

  function icon(on) {
    return on
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.6"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 7v5c0 4.2 3 7.6 7.5 9 4.5-1.4 7.5-4.8 7.5-9V7L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>';
  }

  function render() {
    if (!btn) return;
    if (isRealPro()) {
      btn.hidden = false;
      btn.disabled = true;
      btn.className = "preview-btn is-pro";
      btn.innerHTML = icon(false) + '<span>' + T.pro + "</span>";
      if (note) note.hidden = true;
      if (ticker) { clearInterval(ticker); ticker = null; }
      return;
    }
    var active = ready() && window.Unlock.isPreview(product);
    btn.disabled = false;
    btn.className = "preview-btn" + (active ? " is-active" : "");
    btn.innerHTML = icon(active) + '<span>' +
      (active ? T.run + window.Unlock.previewRemaining() + " c" : T.try) + "</span>";
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    if (note) note.hidden = !active;
    if (active && !ticker) {
      ticker = setInterval(function () {
        if (!btn || !ready()) return;
        if (!window.Unlock.isPreview(product)) {
          clearInterval(ticker); ticker = null; render(); return;
        }
        var label = btn.querySelector("span");
        if (label) label.textContent = T.run + window.Unlock.previewRemaining() + " c";
      }, 1000);
    }
    if (!active && ticker) { clearInterval(ticker); ticker = null; }
  }

  function mount() {
    if (!ready()) return;
    injectCss();
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "preview-btn";
    btn.className = "preview-btn";
    btn.setAttribute("data-product", product);
    btn.setAttribute("aria-label", T.try);
    btn.innerHTML = icon(false) + "<span>" + T.try + "</span>";
    btn.addEventListener("click", function () {
      if (!ready()) return;
      if (window.Unlock.isPreview(product)) window.Unlock.stopPreview();
      else window.Unlock.startPreview(product, SECONDS);
      render();
    });
    document.body.appendChild(btn);

    note = document.createElement("p");
    note.id = "preview-note";
    note.className = "preview-note";
    note.hidden = true;
    note.textContent = T.note;
    document.body.appendChild(note);

    document.addEventListener("unlock:changed", render);
    render();
  }

  /* The demo pill must never widen a 390 px viewport: fixed + max-width in
     assets/base.css, and it is the first thing hidden when printing. */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.PreviewDemo = {
    product: product,
    isActive: function () { return ready() && window.Unlock.isPreview(product); },
    start: function () { if (ready()) { window.Unlock.startPreview(product, SECONDS); render(); } },
    stop: function () { if (ready()) { window.Unlock.stopPreview(); render(); } }
  };
})();
