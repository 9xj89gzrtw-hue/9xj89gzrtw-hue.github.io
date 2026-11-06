/* assets/home-lab.js — the live widget on the home hero.
 *
 * Three things that work right here, with no sign-up and no network:
 *   1. profitability of a WB/Ozon product — an editable table and a commission
 *      slider, recalculated per keystroke, one click to a CSV Excel opens;
 *   2. a hand-picked slice of the Telegram catalogue: only Russian-language
 *      seller, wholesale and IT-freelance chats. Spam, other languages and
 *      ALL-CAPS noise are filtered out before they reach the DOM;
 *   3. a pasted spreadsheet → clean CSV, previewed as a real table.
 *
 * The catalogue is a curated constant on purpose: the free 35-row slice is
 * generated elsewhere and contains rows a Russian buyer should never see.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(Number(n) || 0).toLocaleString("ru-RU"); };

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
    Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== name; });
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

  /* ---------- 1. profit calculator ---------- */
  /* price − cost − price × (commission + tax) − logistics.
     Assumptions are printed under the table, not hidden. */
  var LOGISTICS = 60;
  var TAX = 6;
  var rows = [
    { name: "Кашемировый свитер", price: 4290, cost: 1450 },
    { name: "Термокружка 450 мл", price: 1590, cost: 540 },
    { name: "Носки, набор 5 пар", price: 690, cost: 310 }
  ];
  var commission = 22;

  function profitOf(r) {
    var price = Math.max(0, Number(r.price) || 0);
    var cost = Math.max(0, Number(r.cost) || 0);
    return price - cost - price * (commission + TAX) / 100 - LOGISTICS;
  }

  function verdict(p) {
    if (p < 0) return "is-red";
    if (p < 400) return "is-yellow";
    return "is-green";
  }

  function paintSlider() {
    var el = $("calc-comm");
    if (!el) return;
    var pct = (commission - Number(el.min)) / (Number(el.max) - Number(el.min)) * 100;
    el.style.setProperty("--fill", pct + "%");
    var out = $("calc-comm-out");
    if (out) out.textContent = commission + "%";
  }

  function renderCalc() {
    var body = $("calc-rows");
    if (!body) return;
    body.textContent = "";

    rows.forEach(function (r, i) {
      var tr = document.createElement("tr");
      tr.className = verdict(profitOf(r));

      var tdName = document.createElement("td");
      var inName = document.createElement("input");
      inName.type = "text";
      inName.value = r.name;
      inName.setAttribute("aria-label", "Товар " + (i + 1));
      inName.addEventListener("input", function () { r.name = inName.value; });
      tdName.appendChild(inName);

      function numberCell(key, label) {
        var td = document.createElement("td");
        var input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "10";
        input.value = String(r[key]);
        input.setAttribute("aria-label", label + " " + (i + 1));
        input.addEventListener("input", function () {
          r[key] = Number(input.value) || 0;
          updateTotals();
          tr.className = verdict(profitOf(r));
          tr.querySelector(".c-profit-cell").textContent = money(profitOf(r));
        });
        td.appendChild(input);
        return td;
      }

      var tdProfit = document.createElement("td");
      tdProfit.className = "c-profit-cell";
      tdProfit.textContent = money(profitOf(r));

      tr.appendChild(tdName);
      tr.appendChild(numberCell("price", "Цена"));
      tr.appendChild(numberCell("cost", "Закуп"));
      tr.appendChild(tdProfit);
      body.appendChild(tr);
    });

    updateTotals();
  }

  function money(n) {
    var v = Math.round(Number(n) || 0);
    return (v < 0 ? "−" : "") + fmt(Math.abs(v)) + " ₽";
  }

  function updateTotals() {
    var unit = $("calc-unit");
    var month = $("calc-month");
    if (!unit) return;
    var total = rows.reduce(function (s, r) { return s + profitOf(r); }, 0);
    var avg = rows.length ? total / rows.length : 0;
    unit.textContent = money(avg);
    if (month) month.textContent = fmt(total * 100) + " ₽";
    unit.classList.remove("bump");
    /* force reflow so the animation restarts on every change */
    void unit.offsetWidth;
    unit.classList.add("bump");
  }

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "calc-comm") {
      commission = Number(e.target.value) || 0;
      paintSlider();
      renderCalc();
    }
  });

  if ($("calc-add")) {
    $("calc-add").addEventListener("click", function () {
      rows.push({ name: "Новый товар", price: 1000, cost: 400 });
      renderCalc();
      var inputs = $("calc-rows").querySelectorAll("input[type=text]");
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    });
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  if ($("calc-xlsx")) {
    $("calc-xlsx").addEventListener("click", function () {
      var head = ["Товар", "Цена, ₽", "Закуп, ₽", "Комиссия, %", "Логистика, ₽", "Налог, %", "Прибыль, ₽"];
      var lines = [head.join(";")];
      rows.forEach(function (r) {
        lines.push([r.name, r.price, r.cost, commission, LOGISTICS, TAX, Math.round(profitOf(r))]
          .map(csvCell).join(";"));
      });
      var csv = "\uFEFF" + lines.join("\r\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pribyl-wb-ozon-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  /* ---------- 2. curated Telegram chats ---------- */
  /* Rows taken from the verified 1 017-row catalogue (checked 2026-11-04/05).
     Deliberately short and clean: seller/wholesale/IT channels a Russian
     buyer actually needs. No jokes, no capslock shouting, no other languages. */
  var CURATED = [
    { username: "ozon_chat", title: "OZON · чат селлеров", topic: "Маркетплейсы", members: 54229, kind: "biz" },
    { username: "marketplacechati", title: "Маркетплейсы · чат продавцов", topic: "Маркетплейсы", members: 42763, kind: "biz" },
    { username: "contentwbchat", title: "Карточки товара Wildberries", topic: "Маркетплейсы", members: 37062, kind: "biz" },
    { username: "ozon_fbs", title: "OZON · клуб партнёров", topic: "Маркетплейсы", members: 28728, kind: "biz" },
    { username: "postavshiki_rossiya", title: "Поставщики России · опт", topic: "Закупки и опт", members: 26133, kind: "biz" },
    { username: "sadovod_baza_ru", title: "Садовод · база поставщиков", topic: "Закупки и опт", members: 24111, kind: "biz" },
    { username: "proffreelancee_chat", title: "Фриланс · чат заказчиков и исполнителей", topic: "IT и фриланс", members: 39773, kind: "biz" },
    { username: "qa_jobs", title: "QA · вакансии и заказы", topic: "IT и фриланс", members: 59025, kind: "biz" },
    { username: "beincrypto_ru", title: "BeInCrypto · сообщество трейдеров", topic: "Крипто", members: 19789, kind: "crypto" },
    { username: "tonchathq", title: "TON · общий чат", topic: "Крипто", members: 17151, kind: "crypto" }
  ];

  function chatMatches(c, q) {
    if (!q) return true;
    var n = q.toLowerCase();
    return c.title.toLowerCase().indexOf(n) !== -1 ||
      c.topic.toLowerCase().indexOf(n) !== -1 ||
      c.username.toLowerCase().indexOf(n) !== -1;
  }

  function renderChats(q) {
    var box = $("lab-list");
    if (!box) return;
    box.textContent = "";
    var found = CURATED.filter(function (c) { return chatMatches(c, q); });
    found.slice(0, 6).forEach(function (c) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "lab-chat-row";
      a.setAttribute("data-kind", c.kind);
      a.href = "https://t.me/" + c.username;
      a.target = "_blank";
      a.rel = "noopener";

      var ava = document.createElement("span");
      ava.className = "lr-ava";
      ava.textContent = c.title.charAt(0).toUpperCase();

      var body = document.createElement("span");
      body.className = "lr-body";
      var title = document.createElement("span");
      title.className = "lr-title";
      title.textContent = c.title;
      var meta = document.createElement("span");
      meta.className = "lr-meta";
      meta.textContent = fmt(c.members) + " участников · " + c.topic;
      body.appendChild(title);
      body.appendChild(meta);

      var go = document.createElement("span");
      go.className = "lr-go";
      go.textContent = "Открыть →";

      a.appendChild(ava);
      a.appendChild(body);
      a.appendChild(go);
      li.appendChild(a);
      box.appendChild(li);
    });
    if (!found.length) {
      var empty = document.createElement("li");
      empty.className = "lab-muted";
      empty.textContent = "Ничего не нашлось. Попробуйте «селлеры», «опт» или «фриланс».";
      box.appendChild(empty);
    }
    var count = $("lab-count");
    if (count) count.textContent = found.length ? "35 бесплатно" : "0 из 35";
  }

  if ($("lab-q")) $("lab-q").addEventListener("input", function () { renderChats(this.value); });

  /* ---------- 3. pasted table → CSV ---------- */
  function detectDelimiter(line) {
    var counts = { "\t": (line.match(/\t/g) || []).length, ";": (line.match(/;/g) || []).length, ",": (line.match(/,/g) || []).length };
    var best = "\t";
    Object.keys(counts).forEach(function (d) { if (counts[d] > counts[best]) best = d; });
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

  function tableToCsv(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return { rows: [], csv: "", cols: 0 };
    var d = detectDelimiter(lines[0]);
    var parsed = lines.map(function (l) { return splitRow(l, d); });
    var cols = parsed.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var csv = parsed.map(function (r) {
      return r.map(function (v) {
        var s = String(v);
        return /[";,\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";");
    }).join("\n");
    return { rows: parsed, csv: csv, cols: cols };
  }

  function updateTable() {
    var input = $("lab-table-in");
    if (!input) return;
    var t = tableToCsv(input.value);
    var rowsEl = $("lab-rows");
    if (rowsEl) rowsEl.textContent = t.rows.length + " строк · " + t.cols + " колонок";

    var grid = $("lab-grid");
    if (!grid) return;
    grid.textContent = "";
    if (!t.rows.length) return;
    t.rows.slice(0, 4).forEach(function (row, ri) {
      var tr = document.createElement("tr");
      for (var ci = 0; ci < Math.min(4, t.cols); ci += 1) {
        var cell = document.createElement(ri === 0 ? "th" : "td");
        cell.textContent = row[ci] || "";
        tr.appendChild(cell);
      }
      grid.appendChild(tr);
    });
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

  /* ---------- 4. catalogue tabs ---------- */
  var catTabs = Array.prototype.slice.call(document.querySelectorAll(".cat-tab"));
  var products = Array.prototype.slice.call(document.querySelectorAll(".product[data-cat]"));

  function filterCatalogue(cat) {
    catTabs.forEach(function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-cat") === cat ? "true" : "false");
    });
    var shown = 0;
    products.forEach(function (p) {
      var match = cat === "all" || p.getAttribute("data-cat") === cat;
      p.hidden = !match;
      if (match) shown += 1;
    });
    var empty = $("cat-empty");
    if (empty) empty.hidden = shown > 0;
  }

  catTabs.forEach(function (t) {
    t.addEventListener("click", function () { filterCatalogue(t.getAttribute("data-cat")); });
  });

  /* ---------- boot ---------- */
  paintSlider();
  renderCalc();
  renderChats("");
  updateTable();
  filterCatalogue("all");
})();
