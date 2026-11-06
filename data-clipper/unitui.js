/*
 * unitui.js — Unit-Economics Studio wiring for the landing page.
 * Drives ClipUnit (pure core, unitcalc.js) against the sheet editor,
 * renders the colour verdict matrix and enforces the same tier policy the
 * rest of the product uses: free = 50 rows CSV, Pro (the TW1-CLIP-… /
 * TW1-ALL-… key, tx hash or 60-second preview) = 10 000 rows, multi-sheet
 * XLSX report and competitor batch compare.
 *
 * The visible input is a spreadsheet grid (add / edit / paste from Excel).
 * A hidden textarea keeps the old "one text blob" contract for the engine
 * and for the test harness, so parsing and tests stay untouched.
 *
 * Exposes window.__UNITCALC__ = { results, summary, pro } for the test harness.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var PARAM_FIELDS = [
    ["commission", "комиссия, %", 22], ["logistics", "логистика, ₽", 60],
    ["ssp", "СПП (логистика −), %", 0], ["returns", "возвраты, %", 3],
    ["returnLogistics", "возвратный логистик, ₽", 45], ["ads", "реклама, %", 10],
    ["pack", "упаковка, ₽", 15], ["tax", "налог УСН, %", 6],
    ["fixedMonthly", "фикс. расходы / мес, ₽", 30000]
  ];

  var HEADER_LABELS = {
    name: "Товар", price: "Цена, ₽", cost: "Закуп, ₽",
    commission: "Комиссия, %", logistics: "Логистика, ₽", competitor: "Конкурент, ₽"
  };

  var EXAMPLE_WB = [
    "товар;цена;закуп;комиссия%;логистика",
    "Кашемир свитер жен;4290;1450;19;60",
    "Термобельё комплект;2390;870;21;58",
    "Носки набор 5 пар;690;310;22;55",
    "Пуховик утеплённый;6990;3100;17;65",
    "Косметика бустер корректор;1540;620;24;60",
    "Сумка кожа муж;5450;2350;16;62",
    "Игрушка антистресс;340;190;26;55",
    "Плед флис 140x200;1980;940;20;58",
    "Ботинки зимние;8890;4300;17;68",
    "Палантин летний;1240;430;23;55"
  ].join("\n");

  var EXAMPLE_OZON = [
    '{"items":[',
    '{"name":"Термокружка 450мл","цена":1590,"закуп":540,"комиссия":25,"логистика":55},',
    '{"name":"Органайзер для косметики","цена":1290,"закуп":470,"комиссия":24,"логистика":52},',
    '{"name":"Свеча ароматерапия","цена":890,"закуп":260,"комиссия":27,"логистика":50},',
    '{"name":"Гантели виниловые 2х3кг","цена":2690,"закуп":1450,"комиссия":21,"логистика":85},',
    '{"name":"Коврик для йоги TPE","цена":2450,"закуп":1120,"комиссия":22,"логистика":80}',
    "]}",
    ""
  ].join("\n");

  var state = { results: [], summary: null, params: {}, rows: [], cols: null, grid: { headers: [], rows: [] } };
  var runTimer = null;

  function num(el, fallback) {
    var v = ClipUnit.parseNum(el && el.value);
    return isFinite(v) ? v : fallback;
  }

  /* ---------------- parameters ---------------- */
  function renderParams() {
    var host = $("uc-params");
    if (!host) return;
    host.textContent = "";
    PARAM_FIELDS.forEach(function (f) {
      var wrap = document.createElement("label");
      wrap.className = "uc-param";
      var span = document.createElement("span");
      span.textContent = f[1];
      var input = document.createElement("input");
      input.type = "text";
      input.id = "uc-p-" + f[0];
      input.value = String(f[2]);
      input.addEventListener("input", scheduleRun);
      wrap.appendChild(span);
      wrap.appendChild(input);
      host.appendChild(wrap);
    });
  }

  function applyPreset(key) {
    var preset = ClipUnit.PRESETS[key] || ClipUnit.PRESETS.wb;
    PARAM_FIELDS.forEach(function (f) {
      var el = $("uc-p-" + f[0]);
      if (!el || f[0] === "fixedMonthly") return;
      var v = preset[f[0]];
      if (typeof v === "number") el.value = String(v);
    });
    var ex = $("uc-example");
    if (ex) ex.textContent = key === "ozon" ? "ПРИМЕР OZON" : key === "telegram" ? "ПРИМЕР TG" : "ПРИМЕР WB";
  }

  function readParams() {
    return {
      commission: num($("uc-p-commission"), 22),
      logistics: num($("uc-p-logistics"), 60),
      ssp: num($("uc-p-ssp"), 0),
      returns: num($("uc-p-returns"), 3),
      returnLogistics: num($("uc-p-returnLogistics"), 45),
      ads: num($("uc-p-ads"), 10),
      pack: num($("uc-p-pack"), 15),
      tax: num($("uc-p-tax"), 6),
      fixedMonthly: num($("uc-p-fixedMonthly"), ClipUnit.DEFAULTS.fixedMonthly)
    };
  }

  function isPro() {
    return !!(window.Unlock && window.Unlock.isPro && window.Unlock.isPro("data-clipper"));
  }

  /* ---------------- sheet editor ---------------- */
  /* One cell = plain text. The engine parses the serialized textarea, so a
     pasted 500-row table and ten hand-typed rows take the same code path. */
  function quote(v) {
    var s = String(v == null ? "" : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function serializeGrid() {
    var g = state.grid;
    var lines = [g.headers.map(quote).join(";")];
    g.rows.forEach(function (row) {
      lines.push(g.headers.map(function (h) { return quote(row[h]); }).join(";"));
    });
    return lines.join("\n");
  }

  function syncToTextarea() {
    var input = $("uc-input");
    if (input) input.value = serializeGrid();
  }

  function loadGridFromText(text) {
    var parsed = ClipUnit.parseInput(text);
    state.grid = {
      headers: parsed.headers.slice(0, 8),
      rows: parsed.rows.map(function (r) {
        var o = {};
        parsed.headers.slice(0, 8).forEach(function (h) { o[h] = r[h] == null ? "" : r[h]; });
        return o;
      })
    };
    if (!state.grid.rows.length) state.grid.rows.push(defaultRow());
    syncToTextarea();
    renderGrid();
  }

  function defaultRow() {
    var o = {};
    state.grid.headers.forEach(function (h) { o[h] = ""; });
    return o;
  }

  function labelFor(header, cols) {
    var key = null;
    Object.keys(cols).forEach(function (field) { if (cols[field] === header) key = field; });
    return key && HEADER_LABELS[key] ? HEADER_LABELS[key] : header;
  }

  function renderGrid() {
    var table = $("uc-grid");
    if (!table) return;
    table.textContent = "";
    var g = state.grid;
    if (!g.headers.length) return;
    var cols = ClipUnit.mapColumns(g.headers);

    var thead = document.createElement("thead");
    var trh = document.createElement("tr");
    g.headers.forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = labelFor(h, cols);
      var numeric = cols.price === h || cols.cost === h || cols.commission === h ||
        cols.logistics === h || cols.competitor === h;
      if (numeric) th.className = "num";
      trh.appendChild(th);
    });
    var thDel = document.createElement("th");
    thDel.className = "del";
    thDel.innerHTML = '<span class="sr-only">Удалить строку</span>';
    trh.appendChild(thDel);
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    g.rows.forEach(function (row, ri) {
      var tr = document.createElement("tr");
      g.headers.forEach(function (h) {
        var td = document.createElement("td");
        var input = document.createElement("input");
        input.type = "text";
        input.value = row[h] == null ? "" : row[h];
        input.setAttribute("aria-label", labelFor(h, cols) + ", строка " + (ri + 1));
        var numeric = cols.price === h || cols.cost === h || cols.commission === h ||
          cols.logistics === h || cols.competitor === h;
        if (numeric) { input.className = "num"; input.inputMode = "decimal"; }
        input.addEventListener("input", function () {
          row[h] = input.value;
          syncToTextarea();
          scheduleRun();
        });
        td.appendChild(input);
        tr.appendChild(td);
      });
      var tdDel = document.createElement("td");
      tdDel.className = "del";
      var del = document.createElement("button");
      del.type = "button";
      del.className = "row-del";
      del.title = "Удалить строку";
      del.setAttribute("aria-label", "Удалить строку " + (ri + 1));
      del.textContent = "×";
      del.addEventListener("click", function () {
        if (state.grid.rows.length <= 1) { defaultRow(); }
        state.grid.rows.splice(ri, 1);
        if (!state.grid.rows.length) state.grid.rows.push(defaultRow());
        syncToTextarea();
        renderGrid();
        scheduleRun();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var info = $("uc-cols-info");
    if (info) {
      var mapped = Object.keys(cols).filter(function (k) { return cols[k]; });
      info.textContent = g.rows.length + " строк · столбцы: " + (mapped.length ? mapped.join(", ") : "не распознаны");
    }
  }

  function scheduleRun() {
    if (runTimer) clearTimeout(runTimer);
    runTimer = setTimeout(function () { runTimer = null; run(); }, 220);
  }

  function pasteFromExcel() {
    function apply(text) {
      if (!text || !String(text).trim()) return;
      loadGridFromText(text);
      run();
      if ($("uc-status")) $("uc-status").textContent = "вставлено строк: " + state.grid.rows.length + " — проверьте матрицу справа";
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(apply, function () {
        var manual = window.prompt("Браузер не дал доступ к буферу. Вставьте таблицу сюда (Ctrl+V / Cmd+V):", "");
        if (manual) apply(manual);
      });
      return;
    }
    var manual = window.prompt("Вставьте таблицу из Excel или Google Sheets (Ctrl+V / Cmd+V):", "");
    if (manual) apply(manual);
  }

  /* ---------------- matrix ---------------- */
  function detailColumns(r) {
    return ClipUnit.CSV_COLUMNS.map(function (c) { return c[1](r); });
  }

  function renderMatrix() {
    var table = $("uc-table");
    var shown = state.results.slice(0, 50); // DOM matrix preview stays honest at 50
    if (!shown.length) {
      table.textContent = "";
      table.hidden = true;
      $("uc-out-title").textContent = "МАТРИЦА · нет данных";
      $("uc-sum").textContent = "— заполните таблицу слева —";
      $("uc-csv").disabled = true;
      $("uc-xlsx").disabled = true;
      return;
    }
    table.textContent = "";
    table.hidden = false;
    var trh = document.createElement("tr");
    ClipUnit.CSV_COLUMNS.forEach(function (c) {
      var th = document.createElement("th");
      th.textContent = c[0];
      trh.appendChild(th);
    });
    table.appendChild(trh);
    shown.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.className = r.verdict === "green" ? "uc-green" : r.verdict === "yellow" ? "uc-yellow" : "uc-red";
      detailColumns(r).forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = String(v == null ? "" : v);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    var s = state.summary;
    $("uc-out-title").textContent = "МАТРИЦА · " + s.count + " артикулов";
    $("uc-sum").textContent = "зелёных " + s.green + " · узких " + s.yellow + " · убыточных " + s.red +
      " · потенциал/мес ≈ " + Math.round(s.totalProfitMonth).toLocaleString("ru-RU") + " ₽";
    $("uc-csv").disabled = false;
    $("uc-xlsx").disabled = false;
  }

  function run() {
    var text = $("uc-input").value;
    var parsed = ClipUnit.parseInput(text);
    if (!parsed.rows.length) {
      state.results = []; state.summary = null;
      $("uc-status").textContent = "нет распознанных строк — добавьте товар или вставьте таблицу";
      renderMatrix();
      return;
    }
    var cols = ClipUnit.mapColumns(parsed.headers);
    var missing = ["price"].filter(function (k) { return cols[k] === null; });
    var params = readParams();
    var rows = parsed.rows.slice(0, ClipUnit.PRO_ROW_CAP);
    var results = ClipUnit.computeAll(rows, cols, params, params.fixedMonthly);
    var summary = ClipUnit.summary(results);
    state = {
      results: results, summary: summary, params: params, rows: rows, cols: cols,
      grid: state.grid
    };
    var mapped = Object.keys(cols).filter(function (k) { return cols[k]; });
    var msg = "строк " + parsed.rows.length +
      (parsed.rows.length > rows.length ? " (взято " + rows.length + ", лимит Pro " + ClipUnit.PRO_ROW_CAP + ")" : "") +
      " · столбцы: " + (mapped.join(", ") || "не распознаны") +
      (missing.length ? " · НЕТ колонки «цена» — строки помечены красным" : "") +
      (isPro() ? " · PRO" : " · FREE: CSV до " + ClipUnit.FREE_ROW_CAP + " строк");
    $("uc-status").textContent = msg;
    renderMatrix();
    window.__UNITCALC__ = { results: state.results, summary: state.summary, cols: cols, pro: isPro() };
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function onCSV() {
    var cap = isPro() ? ClipUnit.PRO_ROW_CAP : ClipUnit.FREE_ROW_CAP;
    var csv = ClipUnit.toCSV(state.results, cap);
    if (!csv) return;
    download(new Blob([csv], { type: "text/csv" }), "unit-economics-marketplace.csv");
    if (!isPro() && state.results.length > cap) {
      $("uc-status").textContent = "выгружено " + cap + " из " + state.results.length +
        " строк (FREE). Pro снимает лимит до " + ClipUnit.PRO_ROW_CAP + " и добавляет XLSX и сравнение конкурентов.";
    }
  }

  function onXLSX() {
    if (!isPro()) {
      $("uc-status").textContent = "XLSX-отчёт и сравнение конкурентов — в Pro: ключ TW1-CLIP-… / TW1-ALL-… в поле ниже, USDC или 60-секундный тест-драйв.";
      return;
    }
    var hasComp = state.cols && state.cols.competitor;
    var sheets = [
      { name: "Юнит-экономика", rows: matrixRows(state.results.slice(0, ClipUnit.PRO_ROW_CAP)) },
      { name: "Параметры 2026", rows: paramsRows(state.params) }
    ];
    if (hasComp) sheets.push({ name: "Конкуренты", rows: compRows(state.results) });
    if (typeof ClipXLSX !== "undefined") {
      var bytes = ClipXLSX.buildXLSX(sheets);
      download(new Blob([new Uint8Array(bytes)],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "unit-economics-pro-report.xlsx");
    }
  }

  function matrixRows(results) {
    var rows = [ClipUnit.CSV_COLUMNS.map(function (c) { return c[0]; })];
    results.forEach(function (r) {
      rows.push(detailColumns(r).map(function (v) { return v === "" ? "" : v; }));
    });
    return rows;
  }

  function paramsRows(p) {
    return [["Параметр", "Значение"]].concat(
      Object.keys(p).map(function (k) { return [k, String(p[k])]; })
    );
  }

  function compRows(results) {
    var rows = [["Товар", "Наша цена", "Конкурент", "Разница цены, %", "Прибыль при цене конкурента, ₽"]];
    results.forEach(function (r) {
      if (!r.competitor) return;
      rows.push([r.name, r.price, r.competitor.price,
        Math.round(r.competitor.undercutsBy * 100) / 100, r.competitor.profit]);
    });
    return rows;
  }

  function loadExample() {
    var key = $("uc-preset").value;
    var text = key === "ozon" ? EXAMPLE_OZON : EXAMPLE_WB;
    $("uc-input").value = text;
    loadGridFromText(text);
    run();
  }

  function init() {
    if (!$("uc-input")) return;
    renderParams();
    applyPreset($("uc-preset").value || "wb");

    $("uc-preset").addEventListener("change", function () {
      applyPreset($("uc-preset").value);
      $("uc-status").textContent = "профиль " + (ClipUnit.PRESETS[$("uc-preset").value] || {}).label + " — пересчитано";
      scheduleRun();
    });
    $("uc-run").addEventListener("click", run);
    $("uc-example").addEventListener("click", loadExample);
    $("uc-csv").addEventListener("click", onCSV);
    $("uc-xlsx").addEventListener("click", onXLSX);
    if ($("uc-paste")) $("uc-paste").addEventListener("click", pasteFromExcel);
    if ($("uc-row-add")) $("uc-row-add").addEventListener("click", function () {
      state.grid.rows.push(defaultRow());
      syncToTextarea();
      renderGrid();
      var inputs = $("uc-grid").querySelectorAll("tbody tr:last-child input");
      if (inputs.length) inputs[0].focus();
      scheduleRun();
    });

    /* Start with a real, already-filled example: an empty black textarea was
       the single biggest "how do I even use this" complaint. */
    $("uc-input").value = EXAMPLE_WB;
    loadGridFromText(EXAMPLE_WB);
    run();

    window.__UNITCALC__ = window.__UNITCALC__ || { results: [], summary: null, cols: null, pro: isPro() };
    /* test/automation hook */
    window.__UNITCALC_RUN__ = function (text, presetKey) {
      if (presetKey) applyPreset(presetKey);
      $("uc-input").value = text;
      loadGridFromText(text);
      run();
      return window.__UNITCALC__;
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
