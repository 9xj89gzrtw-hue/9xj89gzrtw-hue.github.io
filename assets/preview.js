/* 60-second Pro test drive — inline, never floating.
 *
 * A buyer should be able to see the Pro interface switch on before paying,
 * but the control must live inside the page: an in-flow strip in the tool's
 * control area and in the Pro tariff card. Nothing is fixed to the viewport,
 * so it can never cover a heading, a button or a card.
 *
 * The demo grants nothing durable: the entitlement lives in a variable inside
 * assets/unlock.js, no unlock:* record is written, and a reload drops back to
 * Free. Encrypted Pro packs are never decrypted by this path — a page that
 * loads one checks Unlock.isPreview() first and shows a paywall note instead.
 *
 * Usage:
 *   <script src="../assets/preview.js" data-product="tg-chats" defer></script>
 *   <div data-preview-mount="tool"></div>
 *   <div data-preview-mount="price"></div>
 *
 * With no explicit mount the strip is appended to <main> (still in flow).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var product = (script && script.getAttribute("data-product")) ||
    (document.body && document.body.getAttribute("data-preview-product")) || "";
  var RU = (document.documentElement.lang || "").toLowerCase().indexOf("ru") === 0;
  var SECONDS = 60;

  var T = RU ? {
    title: "Тест-драйв Pro",
    sub: "60 секунд бесплатно, без регистрации. Pro-панели включатся здесь же, в памяти вкладки.",
    try: "Включить на 60 сек",
    run: "Осталось ",
    sec: " сек",
    stop: "Остановить",
    note: "Демо живёт только в этой вкладке: ничего не сохраняется, файлы Pro не расшифровываются. После оплаты ключ TW1-… откроет Pro навсегда.",
    done: "Демо закончилось — Pro снова закрыт. Ключ TW1-… или оплата открывают его навсегда.",
    pro: "Pro уже открыт",
    label: "Показать интерфейс Pro до оплаты"
  } : {
    title: "Pro test drive",
    sub: "60 seconds free, no sign-up. The Pro panels switch on right here, in this tab's memory.",
    try: "Start 60 seconds",
    run: "Left ",
    sec: " sec",
    stop: "Stop",
    note: "The demo lives in this tab only: nothing is saved and encrypted Pro files stay sealed. A TW1-… key or a payment unlocks Pro for good.",
    done: "The demo ended — Pro is locked again. A TW1-… key or a payment unlocks it for good.",
    pro: "Pro is already active",
    label: "See the Pro interface before paying"
  };

  var toggles = [];
  var ticker = null;

  /* Self-contained styles: nine pages, five different stylesheets. The strip is
     a normal block in the document flow — no position:fixed anywhere. */
  var CSS = [
    ".preview-demo{display:flex;align-items:center;gap:12px;flex-wrap:wrap;",
    "margin:12px 0 0;padding:11px 13px;border:1px solid #e2e8f0;border-radius:10px;",
    "background:#f8fafc;font:400 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155}",
    ".preview-demo .preview-copy{flex:1 1 200px;min-width:0}",
    ".preview-demo strong{display:block;font-size:12.5px;font-weight:600;color:#0f172a;letter-spacing:-.01em}",
    ".preview-demo .preview-sub{display:block;margin-top:1px;color:#64748b;font-size:11.5px}",
    ".preview-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;",
    "padding:8px 12px;border-radius:8px;border:1px solid #0f172a;background:#0f172a;color:#fff;",
    "font:550 12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer;",
    "white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease}",
    ".preview-btn:hover{background:#1e293b}",
    ".preview-btn.is-active{background:#ecfdf5;color:#1d4d38;border-color:#2c6b4f}",
    ".preview-btn.is-active:hover{background:#dcfce7}",
    ".preview-btn.is-pro{opacity:.65;cursor:default;box-shadow:none}",
    ".preview-btn[hidden]{display:none}",
    ".preview-note{flex-basis:100%;margin:0;color:#64748b;font-size:11px;line-height:1.45}",
    ".preview-note[hidden]{display:none}",
    "@media (max-width:520px){.preview-demo{padding:10px 11px}.preview-btn{width:100%}.preview-demo .preview-copy{flex-basis:100%}}",
    "@media print{.preview-demo{display:none !important}}"
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
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.6"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 7v5c0 4.2 3 7.6 7.5 9 4.5-1.4 7.5-4.8 7.5-9V7L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>';
  }

  function render() {
    var active = ready() && window.Unlock.isPreview(product);
    var pro = isRealPro();
    toggles.forEach(function (t) {
      var btn = t.btn;
      if (!btn) return;
      if (pro) {
        btn.disabled = true;
        btn.className = "preview-btn is-pro";
        btn.innerHTML = icon(false) + "<span>" + T.pro + "</span>";
        btn.setAttribute("aria-pressed", "true");
        t.note.hidden = true;
        return;
      }
      btn.disabled = false;
      btn.className = "preview-btn" + (active ? " is-active" : "");
      btn.innerHTML = icon(active) +
        "<span>" + (active ? T.run + window.Unlock.previewRemaining() + T.sec : T.try) + "</span>";
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.setAttribute("aria-label", active ? T.stop : T.label);
      t.note.hidden = !active;
      t.note.textContent = T.note;
    });

    if (active && !ticker) {
      ticker = setInterval(function () {
        if (!ready()) return;
        if (!window.Unlock.isPreview(product)) {
          clearInterval(ticker); ticker = null; render(); return;
        }
        toggles.forEach(function (t) {
          var label = t.btn.querySelector("span");
          if (label) label.textContent = T.run + window.Unlock.previewRemaining() + T.sec;
        });
      }, 1000);
    }
    if (!active && ticker) { clearInterval(ticker); ticker = null; }
  }

  function makeToggle(host, primary) {
    var box = document.createElement("div");
    box.className = "preview-demo";
    box.setAttribute("data-preview-host", "1");

    var copy = document.createElement("div");
    copy.className = "preview-copy";
    var strong = document.createElement("strong");
    strong.textContent = T.title;
    var sub = document.createElement("span");
    sub.className = "preview-sub";
    sub.textContent = T.sub;
    copy.appendChild(strong);
    copy.appendChild(sub);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = primary ? "preview-btn" : "preview-btn-" + (toggles.length + 1);
    btn.className = "preview-btn";
    btn.setAttribute("data-product", product);
    btn.setAttribute("aria-label", T.label);
    btn.innerHTML = icon(false) + "<span>" + T.try + "</span>";
    btn.addEventListener("click", function () {
      if (!ready()) return;
      if (window.Unlock.isPreview(product)) window.Unlock.stopPreview();
      else window.Unlock.startPreview(product, SECONDS);
      render();
    });

    var note = document.createElement("p");
    note.className = "preview-note";
    note.hidden = true;

    box.appendChild(copy);
    box.appendChild(btn);
    box.appendChild(note);
    host.appendChild(box);
    toggles.push({ box: box, btn: btn, note: note });
  }

  function mount() {
    if (!ready()) return;
    injectCss();

    var hosts = Array.prototype.slice.call(document.querySelectorAll("[data-preview-mount]"));
    if (!hosts.length) {
      /* No marker on this page: insert the strip in the flow of the first
         sensible container, never fixed over the content. */
      var main = document.querySelector("main") || document.querySelector(".app") || document.body;
      var host = document.createElement("div");
      host.className = "wrap";
      host.id = "preview-fallback";
      var footer = document.querySelector(".site-footer");
      if (footer && footer.parentNode === main) main.insertBefore(host, footer);
      else main.appendChild(host);
      hosts = [host];
    }
    hosts.forEach(function (host, i) {
      /* A compact marker inside a pricing card gets one strip; a toolbar
         marker gets one too. Both stay in the document flow. */
      host.removeAttribute("data-preview-mount");
      makeToggle(host, i === 0);
    });

    document.addEventListener("unlock:changed", render);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.PreviewDemo = {
    product: product,
    isActive: function () { return ready() && window.Unlock.isPreview(product); },
    start: function () { if (ready()) { window.Unlock.startPreview(product, SECONDS); render(); } },
    stop: function () { if (ready()) { window.Unlock.stopPreview(); render(); } }
  };
})();
