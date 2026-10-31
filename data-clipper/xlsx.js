/*
 * xlsx.js — minimal multi-sheet XLSX writer (pure JS, no dependencies).
 * Emits a *store-only* (uncompressed) ZIP so downstream code can inspect it
 * with plain bytes; Excel/Sheets/Gnumeric open it without warnings.
 * API: ClipXLSX.buildXLSX(sheets) where sheets = [{name, rows:[[c0,c1..]]}]
 * Returns Uint8Array.
 */
(function initXlsx(root) {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  function buildStoreZip(entries) {
    // entries: [{name: string, data: Uint8Array}]
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    entries.forEach(function (e) {
      var nameBytes = utf8(e.name);
      var crc = crc32(e.data);
      var lh = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(e.data.length), u32(e.data.length),
        u16(nameBytes.length), u16(0)
      );
      localParts.push(new Uint8Array(lh), nameBytes, e.data);
      var ch = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(e.data.length), u32(e.data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      );
      centralParts.push(new Uint8Array(ch), nameBytes);
      offset += lh.length + nameBytes.length + e.data.length;
    });
    var centralSize = centralParts.reduce(function (a, p) { return a + p.length; }, 0);
    var centralOffset = offset;
    var end = [].concat(
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(centralSize), u32(centralOffset), u16(0)
    );
    var total = offset + centralSize + end.length;
    var out = new Uint8Array(total);
    var pos = 0;
    localParts.concat(centralParts).concat([new Uint8Array(end)]).forEach(function (p) {
      out.set(p, pos);
      pos += p.length;
    });
    return out;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function colName(n) { // 0-based -> A, B, C ...
    var s = "";
    n += 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetXml(rows) {
    var r = 1;
    var body = "";
    rows.forEach(function (row) {
      var cells = "";
      row.forEach(function (cell, c) {
        var ref = colName(c) + r;
        var isNum = typeof cell === "number" && isFinite(cell);
        cells += '<c r="' + ref + '"' + (isNum ? '' : ' t="inlineStr"') + ">" +
          (isNum
            ? "<v>" + cell + "</v>"
            : "<is><t>" + esc(cell == null ? "" : String(cell)) + "</t></is>") +
          "</c>";
      });
      body += '<row r="' + r + '">' + cells + "</row>";
      r += 1;
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + body + "</sheetData></worksheet>";
  }

  function sanitizeSheetName(name, used) {
    var clean = String(name || "Sheet").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
    var base = clean;
    var n = 2;
    while (used[clean]) { clean = (base.slice(0, 28) + " " + n); n += 1; }
    used[clean] = 1;
    return clean;
  }

  function buildXLSX(sheets) {
    var used = {};
    var names = sheets.map(function (s) { return sanitizeSheetName(s.name, used); });
    var entries = [];
    entries.push({ name: "[Content_Types].xml", data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") +
      "</Types>"
    ) });
    entries.push({ name: "_rels/.rels", data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"
    ) });
    var sheetTags = sheets.map(function (s, i) {
      return '<sheet name="' + esc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join("");
    entries.push({ name: "xl/workbook.xml", data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<sheets>" + sheetTags + "</sheets></workbook>"
    ) });
    entries.push({ name: "xl/_rels/workbook.xml.rels", data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join("") +
      "</Relationships>"
    ) });
    sheets.forEach(function (s, i) {
      var rows = s.rows.map(function (row) {
        return row.map(function (c) { return c == null ? "" : c; });
      });
      entries.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: utf8(sheetXml(rows)) });
    });
    return buildStoreZip(entries);
  }

  root.ClipXLSX = { buildXLSX: buildXLSX, crc32: crc32 };
})(typeof window !== "undefined" ? window : globalThis);
