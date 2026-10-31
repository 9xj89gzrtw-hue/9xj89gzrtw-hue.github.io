/*
 * csv.js — RFC4180 CSV builder. Pure function module, no side effects.
 */
(function initCsv(root) {
  "use strict";

  function escapeCell(value, delimiter) {
    var v = value == null ? "" : String(value);
    var needsQuote = v.indexOf(delimiter) !== -1 ||
      v.indexOf('"') !== -1 ||
      v.indexOf("\n") !== -1 ||
      v.indexOf("\r") !== -1;
    if (!needsQuote) return v;
    return '"' + v.replace(/"/g, '""') + '"';
  }

  function buildCSV(rows, columns, options) {
    var o = options || {};
    var delimiter = o.delimiter || ",";
    var withBOM = o.withBOM !== false;
    var out = [];
    var cols = columns && columns.length ? columns.slice(0) : (rows.length ? Object.keys(rows[0]) : []);
    out.push(cols.map(function (c) { return escapeCell(c, delimiter); }).join(delimiter));
    rows.forEach(function (r) {
      out.push(cols.map(function (c) { return escapeCell(r[c], delimiter); }).join(delimiter));
    });
    var text = out.join("\n") + "\n";
    return withBOM ? "\uFEFF" + text : text;
  }

  var api = { buildCSV: buildCSV, escapeCell: escapeCell };
  root.ClipCSV = api;
})(typeof window !== "undefined" ? window : globalThis);
