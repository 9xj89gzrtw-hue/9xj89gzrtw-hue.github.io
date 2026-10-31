/*
 * engine.js — Table & TG-Channel Clipper Pro detection/export core.
 * Pure browser engine: no chrome.* APIs. The same file powers the popup via
 * the injected bridge (content.js) and the landing-page sandbox.
 */
(function initClipEngine(root) {
  "use strict";

  var ROLE_CLASS_RE =
    /(price|cost|amount|rate|views|views-count|reactions|likes|comments|shares|author|user|from_name|time|date|ago|datetime|meta)/;

  function normText(el) {
    if (!el) return "";
    var t = (el.innerText || el.textContent || "").replace(/\s+/g, " ");
    return t.trim();
  }

  /* ---------- detection ---------- */

  /* Find card groups: repeated sibling containers with identical tag and
   * class signature. Returns up to 12 ranked groups. */
  function findCardGroups(doc) {
    var all = doc.querySelectorAll("div,article,section,li");
    var dedupe = new Map(); // signature string -> first order key
    var groups = [];
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el.classList && el.classList.length === 0) continue;
      var sig = sigOf(el);
      if (!sig) continue;
      if (dedupe.has(sig)) continue;
      dedupe.set(sig, true);
      var count = countSiblings(sig, doc);
      if (count < 3) continue;
      var sampleText = normText(el);
      if (sampleText.length < 8 || sampleText.length > 4000) continue;
      groups.push({
        kind: "cards",
        tag: el.tagName.toLowerCase(),
        classes: Array.prototype.slice.call(el.classList),
        selector: selectorOf(el),
        count: count,
        sampleText: sampleText.slice(0, 140),
        fieldCandidates: fieldScan(el)
      });
    }
    groups.sort(function (a, b) { return b.count - a.count; });
    return groups.slice(0, 12);
  }

  function sigOf(el) {
    var classes = Array.prototype.slice.call(el.classList).join(".");
    if (!classes) return "";
    return el.tagName.toLowerCase() + "|" + classes;
  }

  // Count elements matching the same signature anywhere in the document.
  function countSiblings(sig, doc) {
    var parts = sig.split("|");
    if (parts.length !== 2) return 0;
    var sel = parts[0] + (parts[1] ? "." + parts[1].split(".").join(".") : "");
    return doc.querySelectorAll(sel).length;
  }

  function selectorOf(el) {
    var sel = el.tagName.toLowerCase();
    if (el.classList && el.classList.length) {
      sel += "." + Array.prototype.slice.call(el.classList).join(".");
    }
    return sel;
  }

  /* Scan one sample container for likely field elements. */
  function fieldScan(container) {
    var cands = [];
    var kids = container.querySelectorAll("*");
    var bestTitle = null;
    var bestLen = 0;
    for (var i = 0; i < kids.length; i += 1) {
      var el = kids[i];
      var isLinkish = el.tagName === "A" || el.tagName === "IMG" || !!el.querySelector("a[href],img");
      var text = normText(el);
      if (!isLinkish && text.length > bestLen) {
        bestTitle = el;
        bestLen = text.length;
      }
      var cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
      if (!cls) continue;
      var m = cls.match(ROLE_CLASS_RE);
      if (m && text.length > 0 && text.length < 200) {
        cands.push({ role: m[1], selector: selectorOf(el), sample: text.slice(0, 60) });
      }
    }
    if (bestTitle) {
      cands.unshift({
        role: "title",
        selector: selectorOf(bestTitle),
        sample: normText(bestTitle).slice(0, 60)
      });
    }
    var a = container.querySelector("a[href]");
    if (a) cands.push({ role: "link", selector: "a[href]", sample: a.getAttribute("href") });
    var tm = container.querySelector("[datetime]");
    if (tm) cands.push({ role: "datetime", selector: "[datetime]", sample: tm.getAttribute("datetime") });

    // de-dupe by role@selector; keep at most 8
    var seen = {};
    var uniq = [];
    cands.forEach(function (c) {
      var key = c.role + "@" + c.selector;
      if (seen[key]) return;
      seen[key] = 1;
      uniq.push(c);
    });
    return uniq.slice(0, 8);
  }

  /* ---------- extraction ---------- */

  function matchContainers(recipe, root) {
    var r = root || document;
    if (!recipe || !recipe.selector) return [];
    var list;
    try {
      list = r.querySelectorAll(recipe.selector);
    } catch (e) {
      return [];
    }
    return Array.prototype.slice.call(list);
  }

  function matchCount(recipe, root) {
    return matchContainers(recipe, root).length;
  }

  /* Extract rows from containers matching `recipe`, using roles -> selectors. */
  function extractRows(recipe, roles, maxRows, root) {
    var containers = matchContainers(recipe, root);
    var rows = [];
    var fields = Object.keys(roles);
    for (var i = 0; i < containers.length && rows.length < maxRows; i += 1) {
      var c = containers[i];
      var row = {};
      var hitAny = false;
      for (var f = 0; f < fields.length; f += 1) {
        var role = fields[f];
        var selector = roles[role];
        var value = "";
        if (role === "link") {
          var a = selector ? c.querySelector(selector) : null;
          if (!a && !selector) a = c.querySelector("a[href]");
          if (a) value = a.href || a.getAttribute("href") || "";
        } else if (role === "datetime") {
          var t = c.querySelector(selector || "[datetime]");
          if (t) value = t.getAttribute("datetime") || normText(t);
        } else if (selector) {
          var el = c.querySelector(selector);
          if (el) value = normText(el);
        }
        if (value) hitAny = true;
        row[role] = value;
      }
      if (hitAny) rows.push(row);
    }
    return {
      rows: rows,
      total: rows.length,
      containers: containers.length,
      truncated: containers.length > rows.length
    };
  }

  /* HTML tables (with colspan expansion). */
  function extractTables(maxRows, root) {
    var tables = (root || document).querySelectorAll("table");
    var out = [];
    for (var t = 0; t < tables.length; t += 1) {
      var el = tables[t];
      var rowsArr = [];
      var limit = Math.min(el.rows.length, maxRows);
      for (var r = 0; r < limit; r += 1) {
        var tr = el.rows[r];
        var cells = [];
        for (var c = 0; c < tr.cells.length; c += 1) {
          var span = tr.cells[c].colSpan || 1;
          var txt = normText(tr.cells[c]);
          for (var k = 0; k < span; k += 1) cells.push(txt);
        }
        rowsArr.push(cells);
      }
      if (rowsArr.length >= 2) {
        out.push({ kind: "table", caption: tableCaption(el), rowCount: el.rows.length, rows: rowsArr });
      }
    }
    return out;
  }

  function tableCaption(el) {
    if (el.caption) return normText(el.caption).slice(0, 60);
    var th = el.querySelector("th");
    return th ? normText(th).slice(0, 60) : "";
  }

  /* ---------- filtering ---------- */

  /* pattern: plain keyword (case-insensitive substring) or "/regex/flags". */
  function filterRows(rows, pattern) {
    var p = String(pattern || "").trim();
    if (!p) return { rows: rows.slice(0), dropped: 0 };
    var rx = null;
    var needle = p.toLowerCase();
    if (p.length > 2 && p.charAt(0) === "/") {
      var end = p.lastIndexOf("/");
      if (end > 0) {
        var body = p.slice(1, end);
        var flags = end + 1 < p.length ? p.slice(end + 1) : "";
        try {
          rx = new RegExp(body, flags.replace(/[^dgimsuv]/g, ""));
        } catch (e) {
          rx = null;
        }
      }
    }
    var kept = [];
    var dropped = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var joined = joinedRow(rows[i]);
      var keep = rx ? rx.test(joined) : joined.toLowerCase().indexOf(needle) !== -1;
      if (keep) kept.push(rows[i]);
      else dropped += 1;
    }
    return { rows: kept, dropped: dropped };
  }

  function joinedRow(row) {
    var keys = Object.keys(row);
    var parts = [];
    for (var i = 0; i < keys.length; i += 1) parts.push(String(row[keys[i]]));
    return parts.join("\u0001");
  }

  var api = {
    normText: normText,
    findCardGroups: findCardGroups,
    fieldScan: fieldScan,
    matchCount: matchCount,
    extractRows: extractRows,
    extractTables: extractTables,
    filterRows: filterRows,
    FREE_ROW_CAP: 50
  };

  root.ClipEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
