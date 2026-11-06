/*
 * unitcalc.js — Unit-Economics Studio (WB / Ozon / Telegram price lists).
 *
 * Pure, dependency-free core shared by the landing page (index.html) and the
 * in-page test battery (?test=1). Reads any of:
 *   - pasted HTML table markup (DOMParser)
 *   - JSON array of objects (any key naming)
 *   - CSV / TSV / semicolon text (auto-sniffed)
 * and maps columns to the economics model by RU/EN synonyms, then computes
 * per-SKU: net profit per unit, margin %, ROI %, break-even units and the
 * minimum profitable price, with the 2026 default WB / Ozon parameter sets.
 *
 * Free tier: first FREE_ROW_CAP (50) SKUs downloadable as clean CSV.
 * Pro tier (same TW1-CLIP-… / TW1-ALL-… key): 10 000 SKUs, competitor price
 * batch compare and a multi-sheet XLSX report (via ClipXLSX when present).
 */
(function initUnitCalc(root) {
  "use strict";

  var FREE_ROW_CAP = 50;
  var PRO_ROW_CAP = 10000;

  /* ---------- column synonym tables (lower-case, RU first) ---------- */
  var SYN = {
    name: ["товар", "название", "наименование", "артикул", "sku", "title", "name", "nm", "id", "card"],
    price: ["цена", "продажа", "розница", "прайс", "цена продажи", "price", "saleprice", "salepriceu", "retail"],
    cost: ["закуп", "закупка", "себест", "себестоимость", "cost", "buy", "purchase"],
    commission: ["комиссия", "комиссияwb", "комиссия ozon", "commission", "category", "категория"],
    logistics: ["логистика", "логист", "доставка", "logistics", "logisticscost", "fbo", "fbs"],
    competitor: ["конкурент", "конкуренты", "конкурентцена", "competitor", "comp", "minprice", "минцена", "цена конкурента"]
  };

  /* ---------- 2026 default parameter presets (all editable in UI) ---------- */
  var PRESETS = {
    wb: {
      label: "WB · типовой FBO 2026",
      commission: 22,        // category commission % of price
      logistics: 60,         // ₽ per unit, forward logistics
      ssp: 0,                // СПП % off logistics (WB compensates part)
      returns: 3,            // % of units returned
      returnLogistics: 45,   // ₽ cost of processing one return
      ads: 10,               // % of revenue on ads
      pack: 15,              // ₽ packaging per unit
      tax: 6                 // УСН доходы % of revenue
    },
    ozon: {
      label: "Ozon · типовой FBO 2026",
      commission: 25, logistics: 55, ssp: 0, returns: 5,
      returnLogistics: 40, ads: 12, pack: 18, tax: 6
    },
    telegram: {
      label: "TG / прямой прайс · без комиссии",
      commission: 0, logistics: 90, ssp: 0, returns: 1,
      returnLogistics: 20, ads: 5, pack: 10, tax: 6
    },
    promo1111: {
      label: "Расчёт цены с учётом СПП и акций WB/Ozon Ноябрь 2026 (Чёрная Пятница / 11.11)",
      commission: 22,        // обычная комиссия категории % (вне акции)
      logistics: 60,         // ₽ прямая логистика
      ssp: 12,               // СПП % (скидка покупателя на состав логистики)
      returns: 6,            // % возвратов в обычные дни
      returnLogistics: 45,   // ₽ обработка возврата
      ads: 12,               // % от выручки на рекламу вне акции
      pack: 15,              // ₽ упаковка
      tax: 6,                // УСН % от фактической (акционной) выручки
      // --- акционные механизмы 11.11 / Чёрная Пятница ---
      promoDiscount: 30,     // % скидки от карточной цены в акцию
      promoCommission: 24,   // комиссия % во время акции (WB/Ozon поднимают категорию)
      promoAds: 20,          // % от акционной выручки на рекламу во время акции
      promoReturns: 10,      // % возвратов в акции (растут из-за импульсных покупок)
      promoMinMargin: 10     // дно маржи в акцию, ниже которого продавать нельзя
    }
  };

  var DEFAULTS = {
    fixedMonthly: 30000     // ₽ fixed monthly costs for break-even
  };

  /* ---------- number helpers ---------- */
  function parseNum(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    var s = String(v);
    // RU "1 234,56 ₽" and EN "1,234.56$" both map correctly
    s = s.replace(/[^\d,.\-+]/g, "").replace(/\u00A0/g, "");
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      var m = s.match(/[-+]?\d*\.?\d+/);
      return m ? parseFloat(m[0]) : NaN;
    }
    return parseFloat(s);
  }

  function normKey(k) {
    return String(k || "").toLowerCase().replace(/[\s_%:]/g, "").replace(/ё/g, "е");
  }

  function mapColumns(headers) {
    var out = { name: null, price: null, cost: null, commission: null, logistics: null, competitor: null };
    var seen = {};
    headers.forEach(function (h) {
      var n = normKey(h);
      for (var field in SYN) {
        if (!SYN.hasOwnProperty(field) || out[field] !== null) continue;
        for (var i = 0; i < SYN[field].length; i += 1) {
          if (n === SYN[field][i] || n.indexOf(SYN[field][i]) === 0) {
            out[field] = h;
            seen[field] = true;
            break;
          }
        }
        if (seen[field]) break;
      }
    });
    return out;
  }

  /* ---------- input parsers ---------- */
  function splitCSVLine(line, delim) {
    var cells = [], cur = "", quoted = false;
    for (var i = 0; i < line.length; i += 1) {
      var ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  }

  function detectDelimiter(text) {
    var first = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || "";
    if (first.indexOf("\t") !== -1) return "\t";
    if (first.indexOf(";") !== -1 && first.indexOf(",") === -1) return ";";
    if (/^\s*\[/.test(text) || /^\s*\{/.test(text)) return "json";
    if (first.indexOf(",") !== -1) return ",";
    return ",";
  }

  function rowsFromObjList(list) {
    var keys = [];
    var set = {};
    list.forEach(function (o) {
      Object.keys(o || {}).forEach(function (k) { if (!set[k]) { set[k] = 1; keys.push(k); } });
    });
    var rows = list.map(function (o) {
      var r = {};
      keys.forEach(function (k) { r[k] = o[k]; });
      return r;
    });
    return { headers: keys, rows: rows };
  }

  function parseInput(text) {
    var t = String(text == null ? "" : text).trim();
    if (!t) return { headers: [], rows: [], format: "empty" };

    // --- JSON
    if (/^\[|^\{/.test(t)) {
      try {
        var j = JSON.parse(t);
        var list = Array.isArray(j) ? j : (function unwrap(o) {
          // common one-key wrappers: {"items":[…]} / {"data":[…]} / {"rows":[…]}
          var K = ["items", "data", "rows", "list", "results", "cards", "products"];
          for (var i = 0; i < K.length; i += 1) {
            if (o.hasOwnProperty(K[i]) && Array.isArray(o[K[i]]) &&
                o[K[i]].length && typeof o[K[i]][0] === "object") return o[K[i]];
          }
          return [o];
        })(j);
        if (list.length && typeof list[0] === "object") {
          var jsonParsed = rowsFromObjList(list);
          jsonParsed.format = "json";
          return jsonParsed;
        }
      } catch (e) { /* fall through */ }
    }

    // --- HTML table / HTML markup
    if (/<t[dr]\b|<table\b/i.test(t)) {
      var doc = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(t, "text/html") : null;
      if (doc) {
        var trs = Array.prototype.slice.call(doc.querySelectorAll("table tr, tr"));
        var grid = trs.map(function (tr) {
          return Array.prototype.map.call(tr.querySelectorAll("th,td"), function (c) {
            return (c.textContent || "").trim();
          });
        }).filter(function (r) { return r.length; });
        if (grid.length >= 1) {
          var headers = grid[0];
          var data = grid.slice(1);
          if (data.length === 0) { // one-line forms: treat first row as data too
            data = [grid[0]];
            headers = headers.map(function (h, i) { return "col" + (i + 1); });
          }
          var objRows = data.map(function (r) {
            var o = {};
            headers.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ""; });
            return o;
          });
          return { headers: headers, rows: objRows, format: "html" };
        }
      }
    }

    // --- CSV / TSV / plain lines
    var delim = detectDelimiter(t);
    var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var parsedRows = lines.map(function (l) { return splitCSVLine(l, delim); });
    // drop a leading junk header line ("товар;цена" style is still header, keep it)
    var hdr = parsedRows.shift();
    if (!hdr) return { headers: [], rows: [], format: "csv" };
    var headers = hdr.map(function (h, i) { return (h.trim() || "col" + (i + 1)); });
    if (parsedRows.length === 0) {
      headers = headers.map(function (h, i) { return "col" + (i + 1); });
      parsedRows = [hdr];
    }
    var csvRows = parsedRows.map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { o[h] = (r[i] !== undefined ? r[i].trim() : ""); });
      return o;
    });
    return { headers: headers, rows: csvRows, format: "csv" };
  }

  /* ---------- the economics model (2026 defaults, every knob exposed) ---------- */
  function computeSKU(row, cols, p, fixedMonthly) {
    var name = cols.name != null ? String(row[cols.name] == null ? "" : row[cols.name]) : "";
    var price = parseNum(cols.price != null ? row[cols.price] : NaN);
    var cost = parseNum(cols.cost != null ? row[cols.cost] : 0);
    if (!isFinite(cost)) cost = 0;
    var commPct = parseNum(cols.commission != null ? row[cols.commission] : NaN);
    if (!isFinite(commPct)) commPct = p.commission;
    var logi = parseNum(cols.logistics != null ? row[cols.logistics] : NaN);
    if (!isFinite(logi)) logi = p.logistics;

    var commission = price * (commPct / 100);
    var tax = price * (p.tax / 100);
    var ads = price * (p.ads / 100);
    var logEff = logi * (1 - (p.ssp || 0) / 100);
    var retShare = (p.returns || 0) / 100;
    var returnCost = retShare * (logEff + (p.returnLogistics || 0));
    var pack = p.pack || 0;

    var profit = price - commission - tax - ads - logEff - returnCost - cost - pack;
    var margin = price > 0 ? (profit / price) * 100 : 0;
    var roi = cost > 0 ? (profit / cost) * 100 : 0;
    var breakeven = profit > 0 ? Math.ceil((fixedMonthly || DEFAULTS.fixedMonthly) / profit) : Infinity;

    // minimum profitable price: profit(p)=0 with per-unit fees linear in p
    var vf = 1 - (commPct / 100) - (p.tax / 100) - (p.ads / 100);
    var fixedS = cost + logEff + retShare * (logEff + (p.returnLogistics || 0)) + pack;
    var minPrice = vf > 0.05 ? fixedS / vf : 0;

    // competitor compare (Pro batch feature, computed for every row when present)
    var comp = parseNum(cols.competitor != null ? row[cols.competitor] : NaN);
    var compResult = null;
    if (isFinite(comp) && comp > 0) {
      var compPrice = comp;
      var compProfit = compPrice - compPrice * (commPct / 100) - compPrice * (p.tax / 100) -
        compPrice * (p.ads / 100) - logEff - returnCost - cost - pack;
      compResult = {
        price: compPrice,
        profit: compProfit,
        undercutsBy: isFinite(price) && price > 0 ? ((price - compPrice) / price) * 100 : 0
      };
    }

    /* ---------- promo model (11.11 / ЧП 2026) ----------
       Activates only when params.promoDiscount is positive. The card price stays
       untouched; the seller's payout is computed on the promo sell price, with the
       promo commission / ads / return-rate knobs from the preset. Also derives the
       maximum discount that still clears promoMinMargin — the exact number sellers
       ask for before Black Friday savings windows on WB/Ozon. */
    var sell = price;
    var promo = null;
    if (p && typeof p.promoDiscount === "number" && p.promoDiscount > 0 && isFinite(price) && price > 0) {
      var pct_d = p.promoDiscount / 100;
      var effComm = p.promoCommission != null ? p.promoCommission : commPct;
      var effAds = p.promoAds != null ? p.promoAds : p.ads;
      var effReturns = p.promoReturns != null ? p.promoReturns : (p.returns || 0);
      var minMargin = p.promoMinMargin != null ? p.promoMinMargin : 10;
      var sellPrice = price * (1 - pct_d);
      var pComm = sellPrice * (effComm / 100);
      var pTax = sellPrice * (p.tax / 100);
      var pAds = sellPrice * (effAds / 100);
      var pRetShare = effReturns / 100;
      var pRetCost = pRetShare * (logEff + (p.returnLogistics || 0));
      var pProfit = sellPrice - pComm - pTax - pAds - logEff - pRetCost - cost - pack;
      var pMargin = sellPrice > 0 ? (pProfit / sellPrice) * 100 : 0;
      var pRoi = cost > 0 ? (pProfit / cost) * 100 : 0;
      // max discount keeping promо margin >= promoMinMargin:
      // profit(d) = sell - sell*vf - fixed >= minMargin%*sell  ⇔  sell >= fixed/(vf - m)
      var vf_p = 1 - (effComm / 100) - (p.tax / 100) - (effAds / 100);
      var fixed_p = cost + logEff + pRetCost + pack;
      var maxD = 0;
      if (vf_p - minMargin / 100 > 0.05) {
        var needSell = fixed_p / (vf_p - minMargin / 100);
        maxD = needSell < price ? Math.floor(((1 - needSell / price) * 100) * 2) / 2 : 0; // кратно 0.5%
        if (maxD < 0) maxD = 0;
      }
      promo = {
        sellPrice: sellPrice, discount: p.promoDiscount,
        commission: pComm, tax: pTax, ads: pAds, returnCost: pRetCost,
        profit: pProfit, margin: pMargin, roi: pRoi, maxDiscount: maxD
      };
      // the "verdict" of the promo cell uses the promo economics when active
      var promoVerdict = pProfit >= 0 && pMargin >= (p.promoMinMargin != null ? p.promoMinMargin : 10)
        ? "green" : (pProfit > 0 ? "yellow" : "red");
    }

    var verdict = profit >= 0 && margin >= 10 ? "green" : (profit > 0 ? "yellow" : "red");

    return {
      name: name, price: price, cost: cost,
      commission: commission, tax: tax, ads: ads,
      logistics: logEff, returnCost: returnCost, pack: pack,
      profit: profit, margin: margin, roi: roi,
      breakeven: breakeven, minPrice: minPrice,
      competitor: compResult, verdict: verdict,
      promo: promo, promoVerdict: promoVerdict || null
    };
  }

  function computeAll(rows, cols, params, fixedMonthly) {
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      out.push(computeSKU(rows[i], cols, params, fixedMonthly));
    }
    return out;
  }

  function summary(results) {
    var s = { count: results.length, green: 0, yellow: 0, red: 0, totalProfitMonth: 0 };
    results.forEach(function (r) {
      s[r.verdict] += 1;
      if (r.profit > 0 && isFinite(r.breakeven)) s.totalProfitMonth += r.profit * r.breakeven;
    });
    return s;
  }

  /* ---------- output helpers ---------- */
  var CSV_COLUMNS = [
    ["Товар", function (r) { return r.name; }],
    ["Цена, ₽", function (r) { return round2(r.price); }],
    ["Конкурент, ₽", function (r) { return r.competitor ? round2(r.competitor.price) : ""; }],
    ["Комиссия, ₽", function (r) { return round2(r.commission); }],
    ["Налог, ₽", function (r) { return round2(r.tax); }],
    ["Реклама, ₽", function (r) { return round2(r.ads); }],
    ["Логистика с СПП, ₽", function (r) { return round2(r.logistics); }],
    ["Возвраты, ₽", function (r) { return round2(r.returnCost); }],
    ["Упаковка, ₽", function (r) { return round2(r.pack); }],
    ["Себестоимость, ₽", function (r) { return round2(r.cost); }],
    ["Прибыль/шт, ₽", function (r) { return round2(r.profit); }],
    ["Маржа, %", function (r) { return round2(r.margin); }],
    ["ROI, %", function (r) { return round2(r.roi); }],
    ["Безубыточность, шт", function (r) { return isFinite(r.breakeven) ? String(r.breakeven) : "недостижимо"; }],
    ["Мин. цена безубыт, ₽", function (r) { return round2(r.minPrice); }],
    ["Вердикт", function (r) { return r.verdict === "green" ? "прибыльный" : (r.verdict === "yellow" ? "узко" : "убыточный"); }],
    ["Акционная цена 11.11, ₽", function (r) { return r.promo ? round2(r.promo.sellPrice) : ""; }],
    ["Прибыль в акцию, ₽", function (r) { return r.promo ? round2(r.promo.profit) : ""; }],
    ["Маржа в акцию, %", function (r) { return r.promo ? round2(r.promo.margin) : ""; }],
    ["Макс. скидка до дна маржи, %", function (r) { return r.promo ? round2(r.promo.maxDiscount) : ""; }],
    ["Вердикт акции", function (r) { return r.promoVerdict ? (r.promoVerdict === "green" ? "акция ок" : (r.promoVerdict === "yellow" ? "акция узко" : "акция в минус")) : ""; }]
  ];

  function round2(x) {
    return isFinite(x) ? Math.round(x * 100) / 100 : "";
  }

  function resultsToRecords(results) {
    return results.map(function (r) {
      var o = {};
      CSV_COLUMNS.forEach(function (c) { o[c[0]] = c[1](r); });
      return o;
    });
  }

  function toCSV(results, cap) {
    var rows = resultsToRecords(results.slice(0, cap != null ? cap : results.length));
    if (!rows.length || typeof root.ClipCSV === "undefined") return "";
    return root.ClipCSV.buildCSV(rows, CSV_COLUMNS.map(function (c) { return c[0]; }), { withBOM: true });
  }

  /* ---------- interactive-table API (Агент 1): UnitCalc.calculateRow ----------
     Accepts: (rowObject, paramsOrPresetKey, fixedMonthly). Column mapping is done
     automatically from the row's own keys, so the table grid can fire
     UnitCalc.calculateRow({товар:..., цена: ..., закупка: ...}, "promo1111")
     on every cell edit and re-render just that row. Unknown keys are ignored. */
  function calculateRow(rowObject, paramsOrPresetKey, fixedMonthly) {
    var row = {};
    var headers = Object.keys(rowObject || {});
    headers.forEach(function (h) { row[h] = rowObject[h]; });
    var cols = mapColumns(headers);
    var p = resolveParams(paramsOrPresetKey);
    return computeSKU(row, cols, p, fixedMonthly != null ? fixedMonthly : DEFAULTS.fixedMonthly);
  }

  function resolveParams(paramsOrPresetKey) {
    if (typeof paramsOrPresetKey === "string") return PRESETS[paramsOrPresetKey] || PRESETS.wb;
    return paramsOrPresetKey || PRESETS.wb;
  }

  var api = {
    FREE_ROW_CAP: FREE_ROW_CAP,
    PRO_ROW_CAP: PRO_ROW_CAP,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    parseNum: parseNum,
    parseInput: parseInput,
    mapColumns: mapColumns,
    computeSKU: computeSKU,
    computeAll: computeAll,
    summary: summary,
    toCSV: toCSV,
    resultsToRecords: resultsToRecords,
    CSV_COLUMNS: CSV_COLUMNS,
    calculateRow: calculateRow,
    resolveParams: resolveParams
  };
  root.ClipUnit = api;
  // Public alias for the Agent-1 interactive grid (window.UnitCalc.calculateRow).
  root.UnitCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
