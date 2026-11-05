/* assets/home-lab.js — the live widget on the home hero.
 *
 * Three things that actually work in the browser, no sign-up and no network:
 *   1. Telegram: format check + lookup in the free slice of the catalogue
 *      (35 rows now, 1 017 in the base);
 *   2. a pasted spreadsheet → clean CSV, downloaded locally;
 *   3. the All-in-One saving, computed from the live Platanus.Market lots in
 *      assets/shop.js rather than invented numbers.
 *
 * The catalogue is loaded lazily, only when the Telegram tab is first opened.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".lab-tab"));
  var panes = {};
  Array.prototype.forEach.call(document.querySelectorAll(".lab-pane"), function (p) {
    panes[p.getAttribute("data-pane")] = p;
  });

  function select(name) {
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-lab") === name ? "true" : "false");
    });
    Object.keys(panes).forEach(function (k) {
      panes[k].hidden = k !== name;
    });
    if (name === "tg") loadCatalog();
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(t.getAttribute("data-lab")); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next.getAttribute("data-lab"));
    });
  });

  /* ---------- Telegram catalogue ---------- */
  var CATALOG = null;
  var loading = false;

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("ru-RU");
  }

  function loadCatalog() {
    if (CATALOG || loading) { if (CATALOG) renderList(""); return; }
    loading = true;
    var s = document.createElement("script");
    s.src = "./tg-chats/catalog.js";
    s.onload = function () {
      CATALOG = window.CHAT_CATALOG || null;
      loading = false;
      if (!CATALOG) { listFallback("База не загрузилась — откройте страницу инструмента."); return; }
      var total = CATALOG.total || (CATALOG.chats || []).length;
      $("lab-count").textContent = fmtNum(total) + " в базе";
      renderList($("lab-q").value || "");
    };
    s.onerror = function () {
      loading = false;
      listFallback("База не загрузилась — откройте страницу инструмента.");
    };
    document.head.appendChild(s);
  }

  function listFallback(msg) {
    var box = $("lab-list");
    box.textContent = "";
    var li = document.createElement("li");
    li.className = "lab-muted";
    li.textContent = msg;
    box.appendChild(li);
  }

  function matches(chat, q) {
    if (!q) return true;
    var needle = q.toLowerCase();
    return (chat.title || "").toLowerCase().indexOf(needle) !== -1 ||
      (chat.topic || "").toLowerCase().indexOf(needle) !== -1 ||
      (chat.city || "").toLowerCase().indexOf(needle) !== -1 ||
      (chat.about || "").toLowerCase().indexOf(needle) !== -1 ||
      (chat.username || "").toLowerCase().indexOf(needle) !== -1;
  }

  function renderList(q) {
    if (!CATALOG) return;
    var box = $("lab-list");
    box.textContent = "";
    var chats = (CATALOG.chats || []).filter(function (c) { return matches(c, q); });
    chats.sort(function (a, b) { return (b.members || 0) - (a.members || 0); });
    chats.slice(0, 5).forEach(function (c) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "lab-chat-row";
      a.href = c.link || ("https://t.me/" + c.username);
      a.target = "_blank";
      a.rel = "noopener";

      var title = document.createElement("span");
      title.className = "lr-title";
      title.textContent = c.title || c.username;

      var meta = document.createElement("span");
      meta.className = "lr-meta";
      meta.textContent = fmtNum(c.members) + " · " + (c.topic || "");

      var go = document.createElement("span");
      go.className = "lr-go";
      go.textContent = "Открыть";

      a.appendChild(title);
      a.appendChild(meta);
      a.appendChild(go);
      li.appendChild(a);
      box.appendChild(li);
    });
    if (!chats.length) {
      var empty = document.createElement("li");
      empty.className = "lab-muted";
      empty.textContent = "Ничего не нашлось. Попробуйте «Python», «Казань» или «родители».";
      box.appendChild(empty);
    }
  }

  function parseUsername(raw) {
    var s = String(raw || "").trim();
    if (!s) return { error: "Вставьте ссылку или ник." };
    s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (/^(t\.me|telegram\.me)\//i.test(s)) s = s.replace(/^(t\.me|telegram\.me)\//i, "");
    s = s.split("?")[0].replace(/\/+$/, "");
    if (s.charAt(0) === "@") s = s.slice(1);
    if (/^\+|^joinchat\//i.test(s)) {
      return { error: "Это приватная invite-ссылка. Такие чаты не входят в открытую базу — её нельзя проверить без вступления." };
    }
    if (s.indexOf("/") !== -1) s = s.split("/")[0];
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s)) {
      return { error: "Не похоже на ник Telegram: нужно 5–32 символа, латиница, цифры и подчёркивание." };
    }
    return { username: s };
  }

  function checkLink() {
    var out = $("lab-check");
    var parsed = parseUsername($("lab-link").value);
    out.className = "lab-check";
    out.textContent = "";
    if (parsed.error) {
      out.classList.add("warn");
      out.textContent = parsed.error;
      return;
    }
    var found = CATALOG && (CATALOG.chats || []).filter(function (c) {
      return String(c.username || "").toLowerCase() === parsed.username.toLowerCase();
    })[0];

    if (found) {
      out.classList.add("ok");
      var wrap = document.createElement("div");
      wrap.className = "lab-chat";
      var b = document.createElement("b");
      b.textContent = found.title || found.username;
      var meta = document.createElement("span");
      meta.textContent = "@" + found.username + " · " + fmtNum(found.members) + " участников · " + (found.topic || "") +
        " · проверен " + String(found.checked_at || "").slice(0, 10);
      var link = document.createElement("a");
      link.href = found.link || ("https://t.me/" + found.username);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Открыть чат в Telegram";
      wrap.appendChild(b);
      wrap.appendChild(meta);
      wrap.appendChild(link);
      out.appendChild(wrap);
      return;
    }

    out.classList.add("warn");
    var msg = document.createElement("span");
    if (!CATALOG) {
      msg.textContent = "Формат верный. База ещё загружается — нажмите «Проверить» через секунду.";
    } else {
      msg.textContent = "Формат верный, но в бесплатной части базы этого ника нет. ";
      var more = document.createElement("a");
      more.href = "./tg-chats/#catalog";
      more.textContent = "Проверить на странице инструмента";
      msg.appendChild(more);
      msg.appendChild(document.createTextNode(" — там видно, чат это, канал или мёртвая ссылка."));
    }
    out.appendChild(msg);
  }

  if ($("lab-check-btn")) $("lab-check-btn").addEventListener("click", checkLink);
  if ($("lab-link")) $("lab-link").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); checkLink(); }
  });
  if ($("lab-q")) $("lab-q").addEventListener("input", function () { renderList(this.value); });

  /* ---------- spreadsheet → CSV ---------- */
  function detectDelimiter(line) {
    var counts = { "\t": (line.match(/\t/g) || []).length, ";": (line.match(/;/g) || []).length, ",": (line.match(/,/g) || []).length };
    var best = "\t";
    Object.keys(counts).forEach(function (d) { if (counts[d] > counts[best]) best = d; });
    /* A line of Russian text often carries commas inside sentences; tabs win on
       a real paste, semicolons win on a ru-locale CSV. */
    return counts[best] ? best : "\t";
  }

  function splitRow(line, d) {
    var out = [];
    var cur = "";
    var quoted = false;
    for (var i = 0; i < line.length; i += 1) {
      var ch = line.charAt(i);
      if (ch === '"') {
        if (quoted && line.charAt(i + 1) === '"') { cur += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === d && !quoted) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (c) { return c.trim(); });
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function tableToCsv(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return { rows: [], csv: "", cols: 0 };
    var d = detectDelimiter(lines[0]);
    var rows = lines.map(function (l) { return splitRow(l, d); });
    var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var csv = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n");
    return { rows: rows, csv: csv, cols: cols };
  }

  function updateTable() {
    var t = tableToCsv($("lab-table-in").value);
    $("lab-rows").textContent = t.rows.length + " строк · " + t.cols + " колонок";
    var pre = $("lab-table-out");
    if (!t.rows.length) { pre.textContent = "Здесь появится готовый CSV."; return; }
    var preview = t.csv.split("\n").slice(0, 4).join("\n");
    pre.textContent = preview + (t.rows.length > 4 ? "\n…" : "");
  }

  function downloadCsv() {
    var t = tableToCsv($("lab-table-in").value);
    if (!t.csv) { updateTable(); return; }
    var blob = new Blob(["\uFEFF" + t.csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "table-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  if ($("lab-table-in")) $("lab-table-in").addEventListener("input", updateTable);
  if ($("lab-csv")) $("lab-csv").addEventListener("click", downloadCsv);

  /* ---------- All-in-One saving ---------- */
  function money(n) { return Math.round(Number(n) || 0).toLocaleString("ru-RU") + " ₽"; }

  function updateBundle() {
    var shop = window.SHOP || {};
    var products = shop.products || {};
    var sum = 0;
    var count = 0;
    Object.keys(products).forEach(function (k) {
      var p = products[k];
      if (p && p.id && Number(p.price_rub) > 0) { sum += Number(p.price_rub); count += 1; }
    });
    var bundle = shop.bundle && Number(shop.bundle.price_rub) > 0 ? Number(shop.bundle.price_rub) : 1290.46;
    if (!count) return;
    $("lab-sum").textContent = money(sum);
    $("lab-bundle-price").textContent = money(bundle);
    $("lab-save").textContent = money(Math.max(0, sum - bundle));
    $("lab-bar-fill").style.width = Math.max(6, Math.min(100, Math.round((bundle / sum) * 100))) + "%";
    $("lab-calc-note").textContent = "Считаем по ценам " + count + " открытых лотов Plati.Market: восемь отдельных лицензий против одного ключа TW1-ALL.";
  }

  /* ---------- boot ---------- */
  updateBundle();
  updateTable();
  /* Do not fetch 17 KB of catalogue until the Telegram tab is actually used —
     but the first tab is Telegram, so warm it once the page is idle. */
  if ("requestIdleCallback" in window) requestIdleCallback(loadCatalog, { timeout: 2500 });
  else setTimeout(loadCatalog, 1200);
})();
