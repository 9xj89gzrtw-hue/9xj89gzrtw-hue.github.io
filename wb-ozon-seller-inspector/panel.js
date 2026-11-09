/*
 * panel.js — the DOM half. A pill in a shadow root so no site CSS leaks in
 * or out. Appears only when product cards of WB/Ozon are actually found.
 */
(function () {
  "use strict";
  var C = window.WbOzon;
  if (!C) return;
  if (window.__WBOZON_PANEL__) return;
  window.__WBOZON_PANEL__ = true;

  var site = C.siteOf({ hostname: window.location.hostname, pathname: window.location.pathname, protocol: window.location.protocol });
  if (!site) return; // installed on the wrong site: stay invisible

  var host = document.createElement("div");
  host.setAttribute("data-wb-ozon-inspector", "");
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647";
  document.documentElement.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  var defaults = { commissionPct: 11, sppPct: 5, taxPct: 7, logisticsRub: 55, costRub: 0 };
  try {
    var saved = JSON.parse(localStorage.getItem("tw1wbozon:cfg") || "null");
    if (saved) {
      defaults.commissionPct = C.num(saved.commissionPct, defaults.commissionPct);
      defaults.sppPct = C.num(saved.sppPct, defaults.sppPct);
      defaults.taxPct = C.num(saved.taxPct, defaults.taxPct);
      defaults.logisticsRub = C.num(saved.logisticsRub, defaults.logisticsRub);
      defaults.costRub = C.num(saved.costRub, defaults.costRub);
    }
  } catch (e) { /* first run */ }

  var FIELDS = [
    ["commissionPct", "Комиссия, %"], ["sppPct", "СПП, %"], ["taxPct", "Налог, %"],
    ["logisticsRub", "Логистика, ₽"], ["costRub", "Закуп/себест., ₽"]
  ];

  var CSS = [
    ".pill{position:relative;background:#111418;color:#fff;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
    "border-radius:12px;padding:10px 14px;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:340px}",
    ".row{display:flex;align-items:center;gap:8px;margin:6px 0}",
    ".row label{flex:1 1 auto;color:#c8cbd0}",
    ".row input{width:90px;background:#1d2126;border:1px solid #2b3138;border-radius:6px;color:#fff;padding:4px 8px;font:inherit}",
    "button{font:inherit;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}",
    ".export{background:#6c4df6;color:#fff;width:100%}",
    ".dismiss{background:transparent;color:#8b9096;padding:4px}",
    ".status{min-height:16px;color:#c8cbd0;font-size:12px}",
    ".status.bad{color:#ff8a80}",
    "a{color:#9fa8ff;text-decoration:none;font-size:12px}",
    ".kbd{width:100%;box-sizing:border-box;background:#1d2126;border:1px solid #2b3138;border-radius:6px;color:#fff;padding:6px 8px;font:inherit;margin:4px 0}"
  ].join("");

  root.innerHTML =
    '<style>' + CSS + '</style>' +
    '<div class="pill">' +
      '<div class="row"><strong>WB &amp; Ozon Inspector</strong>' +
        '<button class="dismiss" type="button" title="скрыть">✕</button></div>' +
      '<div class="status" id="wbo-status">Ищу карточки…</div>' +
      '<form id="wbo-form">' + FIELDS.map(function (f) {
        return '<div class="row"><label for="wbo-' + f[0] + '">' + f[1] + '</label>' +
          '<input id="wbo-' + f[0] + '" name="' + f[0] + '" value="' + defaults[f[0]] + '" inputmode="decimal"></div>';
      }).join("") +
      '<button class="export" type="submit">Выгрузить в Excel (CSV)</button>' +
      '<input class="kbd" id="wbo-key" placeholder="ключ TW1-CLIP-… / TW1-ALL-… (снимает лимит 50)" autocomplete="off">' +
      '<div class="row"><a href="' + C.SITE + '" target="_blank" rel="noreferrer">Справка и лицензия</a>' +
      '<span class="status" id="wbo-tier"></span></div></form>' +
    '</div>';

  var $ = function (id) { return root.getElementById(id); };
  var status = $("wbo-status"), tier = $("wbo-tier"), form = $("wbo-form");
  var keyInput = $("wbo-key");
  var lastRows = [];

  function cfgFromForm() {
    var o = {};
    for (var i = 0; i < FIELDS.length; i++) {
      o[FIELDS[i][0]] = C.num($("wbo-" + FIELDS[i][0]).value, defaults[FIELDS[i][0]]);
    }
    try { localStorage.setItem("tw1wbozon:cfg", JSON.stringify(o)); } catch (e) { /* ok */ }
    return o;
  }

  function isPro() { return !!C.storedLicense(); }

  function statusMsg(text, bad) {
    status.textContent = text;
    status.className = "status" + (bad ? " bad" : "");
  }

  function tierMsg(total) {
    if (isPro()) { tier.textContent = "Pro"; return; }
    tier.textContent = total != null && total > C.FREE_ROWS
      ? "Free " + C.FREE_ROWS + " из " + total
      : "Free до " + C.FREE_ROWS;
  }

  function harvest() {
    var rows = C.collect(document, site);
    if (!rows.length) {
      // search pages render late: wait for rows before complaining
      return;
    }
    lastRows = rows;
    statusMsg("Карточек найдено: " + rows.length + (rows[0].site === "wb" ? " (WB)" : " (Ozon)"));
    tierMsg(rows.length <= C.FREE_ROWS ? null : rows.length);
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!lastRows.length) { harvest(); }
    if (!lastRows.length) { statusMsg("Карточек ещё нет — прокрутите страницу поиска.", "bad"); return; }
    var cfg = cfgFromForm();
    var pro = isPro();
    var clip = C.clipRows(lastRows, pro);
    var margins = C.marginTable(clip.rows, cfg);
    var text = C.rowsToCsv(margins);
    var stamp = new Date().toISOString().slice(0, 10);
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "wb-ozon-" + site.id + "-" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    if (clip.truncated) {
      statusMsg("Free: выгрузилось " + clip.shown + " из " + lastRows.length + " карточек. ключ TW1-CLIP снимает лимит офлайн.", "bad");
    } else {
      statusMsg("Выгружено карточек: " + clip.shown + ".");
    }
    tierMsg(lastRows.length <= C.FREE_ROWS ? null : lastRows.length);
  });

  keyInput.addEventListener("change", function () {
    var raw = keyInput.value.trim();
    if (!raw) return;
    C.verifyKey(raw).then(function (r) {
      if (!r.valid) {
        var m = r.error === "format" ? "Это не ключ TW1: нужен формат TW1-CLIP-XXXXXX-…"
              : r.error === "product" ? "Ключ от другого продукта: нужен TW1-CLIP или TW1-ALL."
              : r.error === "crypto" ? "Браузер не дал crypto.subtle: откройте страницу по https."
              : "Подпись ключа не сходится — проверьте копипаст.";
        statusMsg(m, "bad");
        return;
      }
      C.storeLicense(C.PRODUCT, { kind: "license", code: r.code, hash: "license:WB-OZON:" + r.code });
      keyInput.value = "";
      statusMsg("Pro активирован: лимит " + C.FREE_ROWS + " снят офлайн.");
      tierMsg(null);
    });
  });

  root.querySelector(".dismiss").addEventListener("click", function () {
    host.remove();
    window.__WBOZON_PANEL__ = false;
  });

  /* search pages stream cards in over seconds */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", harvest);
  } else {
    harvest();
  }
  var harvestTimer = setInterval(harvest, 2000);
  setTimeout(function () { clearInterval(harvestTimer); }, 30000);
})();
