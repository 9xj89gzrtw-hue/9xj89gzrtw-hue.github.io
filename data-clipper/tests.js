/*
 * tests.js — in-page assertion battery. Runs only when the page URL has
 * ?test=1: renders a PASS/FAIL panel and writes window.__RESULTS__ =
 * { total, passed, failed, durationMs, cases } for the CI harness.
 */
(function () {
  "use strict";
  if (location.search.indexOf("test=1") === -1) return;
  document.body.classList.add("testing");

  var cases = [];
  var results = [];
  var t0 = null;

  function test(name, fn) { cases.push({ name: name, fn: fn }); }
  function ok(cond, msg) {
    results.push({ ok: !!cond, msg: msg });
    if (!cond) throw new Error("assert failed: " + msg);
  }
  function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

  /* ---- demo license keys (issued by keys/issue_license.mjs, same vault key
   * whose public half is embedded in license.js) ---- */
  var KEY_DCLIP = "JRBTC-ABSPM-RHMIR-2GEWC-E4BCH-IRGIY-3MNFY-CELBC-OQRDU-ITQOJ-XSELB-CMURD-UMBME-J2SEO-RCMRS-W233E-MVWW6-IT5RB-6C6HB-H5TTS-VJPA7-WZPMC-DVCNJ-HPS4J-2CJI2-P76GA-TGEBV-AWPJL-4MCVT-GI2WU-SGDDS-CAP7L-4FUU3-AFVLP-OUNU5-XE6OX-AXCQI-5KEKD-Q";
  var KEY_AT = "JRBTC-ABYPM-RHMIR-2GEWC-E4BCH-IRGC3-DHN4W-XI6LD-N5XW4-IRMEJ-2CEOR-COBZG-6IRME-JSSEO-RQFQR-HKIR2-EJSGK-3LPMR-SW23Z-CPURV-WYOVJ-SZLID-KISBZ-KHO6C-L2C2V-7ZYEG-5OA27-IHTKR-ZXXO2-5TBEC-YKKEB-62C7V-EHJW4-WJ25I-RVXSI-UNK46-FUYGN-OUBCF-5BDLB-LDQQI";
  var KEY_EXPIRED = "JRBTC-AB3PM-RHMIR-2GEWC-E4BCH-IRGIY-3MNFY-CELBC-OQRDU-ITQOJ-XSELB-CMURD-UMJXG-AYDAM-BQGAY-DALBC-OURDU-ITEMV-WW6ZD-FNVXS-E7KRX-YA3KB-GB5IH-DTYXW-G45MP-BAX5K-VNGKE-UNT52-MSYVO-GSBNW-CSQF3-N4UFW-ZZWU4-OYKJL-X63LZ-APJ6I-2GM7M-5ITNU-IELIJ-JD4B2-D5AAO";

  /* ---------- base32 ---------- */
  test("base32: 'MFRGG' decodes to 'abc'", function () {
    var b = ClipLicense.base32DecodeToBytes("MFRGG");
    eq(String.fromCharCode(b[0], b[1], b[2]), "abc", "decoded text");
  });
  test("base32: 'MZXW6YTBOI' decodes to 'foobar'", function () {
    var b = ClipLicense.base32DecodeToBytes("MZXW6YTBOI");
    var s = "";
    b.forEach(function (x) { s += String.fromCharCode(x); });
    eq(s, "foobar", "decoded text");
  });

  /* ---------- license verification (async, Ed25519 WebCrypto) ---------- */
  test("license: valid dclip key verifies, payload preserved", function () {
    return ClipLicense.verifyLicense(KEY_DCLIP, ["dclip"]).then(function (r) {
      ok(r.ok, "ok=true for the correct product");
      eq(r.payload.u, "demodemo", "user tag");
      eq(r.payload.t, "pro", "tier");
      eq(r.payload.e, 0, "never expires");
    });
  });
  test("license: wrong product key is rejected", function () {
    return ClipLicense.verifyLicense(KEY_AT, ["dclip"]).then(function (r) {
      ok(!r.ok, "rejected");
      eq(r.reason, "wrong product", "reason is 'wrong product'");
    });
  });
  test("license: expired key is rejected as expired", function () {
    return ClipLicense.verifyLicense(KEY_EXPIRED, ["dclip"]).then(function (r) {
      ok(!r.ok, "rejected");
      eq(r.reason, "expired", "reason is 'expired'");
    });
  });
  test("license: tampered signature is rejected", function () {
    var tampered = KEY_DCLIP.slice(0, -1) + "2"; // flip a char in the sig region, keep length
    return ClipLicense.verifyLicense(tampered, ["dclip"]).then(function (r) {
      ok(!r.ok, "tampered key rejected");
      ok(r.reason !== undefined, "reason given: " + r.reason);
    });
  });
  test("license: garbage key is rejected as malformed", function () {
    return ClipLicense.verifyLicense("HELLO-WORLD-12345!!!", ["dclip"]).then(function (r) {
      ok(!r.ok, "garbage rejected");
    });
  });
  test("license: whitespace/other separators are normalized", function () {
    var noisy = "  " + KEY_DCLIP.toLowerCase().replace(/-/g, " ") + "  ";
    return ClipLicense.verifyLicense(noisy, ["dclip"]).then(function (r) {
      ok(r.ok, "still verifies after normalization");
    });
  });
  test("license: key payload for algo-tycoon is valid for that product", function () {
    return ClipLicense.verifyLicense(KEY_AT, ["algo-tycoon"]).then(function (r) {
      ok(r.ok, "algo-tycoon key verifies for algo-tycoon");
    });
  });

  /* ---------- CSV ---------- */
  test("csv: builds header + row", function () {
    var csv = ClipCSV.buildCSV([{ a: "1", b: "2" }], ["a", "b"], { withBOM: false });
    eq(csv, "a,b\n1,2\n", "plain csv");
  });
  test("csv: quotes cells containing comma", function () {
    var csv = ClipCSV.buildCSV([{ a: "x,y" }], ["a"], { withBOM: false });
    eq(csv, "a\n\"x,y\"\n", "quoted cell");
  });
  test("csv: doubles embedded quotes", function () {
    var csv = ClipCSV.buildCSV([{ a: 'say "hi"' }], ["a"], { withBOM: false });
    eq(csv, "a\n\"say \"\"hi\"\"\"\n", "escaped quotes");
  });
  test("csv: quote cells with newline", function () {
    var csv = ClipCSV.buildCSV([{ a: "l1\nl2" }], ["a"], { withBOM: false });
    ok(csv.indexOf('"l1\nl2"') !== -1, "newline cell quoted");
  });
  test("csv: custom delimiter honored", function () {
    var csv = ClipCSV.buildCSV([{ a: "1", b: "2" }], ["a", "b"], { delimiter: ";", withBOM: false });
    eq(csv, "a;b\n1;2\n", "semicolon delimiter");
  });
  test("csv: BOM prepended when requested", function () {
    var csv = ClipCSV.buildCSV([{ a: "1" }], ["a"], { withBOM: true });
    ok(csv.charCodeAt(0) === 0xFEFF, "BOM first char");
  });
  test("csv: null-safe cells", function () {
    var csv = ClipCSV.buildCSV([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"], { withBOM: false });
    eq(csv, "a,b,c\n,,0\n", "nulls become empty");
  });

  /* ---------- XLSX ---------- */
  test("xlsx: output is a ZIP (PK header)", function () {
    var b = ClipXLSX.buildXLSX([{ name: "Clip", rows: [["a", "b"], ["1", "2"]] }]);
    ok(b instanceof Uint8Array, "Uint8Array");
    eq(String.fromCharCode(b[0], b[1]), "PK", "zip magic");
    eq(b[2], 3, "PK\\x03");
    eq(b[3], 4, "PK\\x04");
  });
  test("xlsx: ends with EOCD record", function () {
    var b = ClipXLSX.buildXLSX([{ name: "Clip", rows: [["a"], ["1"]] }]);
    var n = b.length;
    eq(b[n - 22], 0x50, "EOCD sig P");
    eq(b[n - 21], 0x4B, "EOCD sig K");
    eq(b[n - 20], 0x05, "EOCD sig \\x05");
    eq(b[n - 19], 0x06, "EOCD sig \\x06");
    eq(b[n - 2], 0, "comment len hi 0");
    eq(b[n - 1], 0, "comment len lo 0");
  });
  test("xlsx: contains workbook xml with sheet name", function () {
    var b = ClipXLSX.buildXLSX([{ name: "Data 2026", rows: [["a"]] }]);
    var s = BufferLikeToString(b);
    ok(s.indexOf("Data 2026") !== -1, "sheet name present");
    ok(s.indexOf("xl/workbook.xml") !== -1, "workbook part present");
    ok(s.indexOf("[Content_Types].xml") !== -1, "content types present");
  });
  test("xlsx: sheetData rows serialized with refs", function () {
    var b = ClipXLSX.buildXLSX([{ name: "S", rows: [["h"], ["1"], [42]] }]);
    var s = BufferLikeToString(b);
    ok(s.indexOf('<c r="A1" t="inlineStr">') !== -1, "A1 inline string");
    ok(s.indexOf("<is><t>1</t></is>") !== -1, "text '1' stored as inlineStr");
    ok(s.indexOf("<v>42</v>") !== -1, "number cell stored as <v> node");
  });
  test("xlsx: two sheets, names sanitized", function () {
    var b = ClipXLSX.buildXLSX([
      { name: "A/B:bad*name", rows: [["x"]] },
      { name: "Data", rows: [["y"]] }
    ]);
    var s = BufferLikeToString(b);
    ok(s.indexOf("A B bad name") !== -1, "illegal chars replaced");
    ok(s.indexOf("Data") !== -1, "second sheet present");
  });
  test("xlsx: crc32 known vector", function () {
    var bytes = new TextEncoder().encode("123456789");
    eq(ClipXLSX.crc32(bytes), 0xCBF43926 >>> 0, "crc32('123456789') == 0xCBF43926");
  });

  function BufferLikeToString(b) {
    var s = "";
    var CH = 8192;
    for (var i = 0; i < b.length; i += CH) {
      s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length)));
    }
    return s;
  }

  /* ---------- engine: text normalization ---------- */
  test("engine.normText collapses whitespace", function () {
    assertEquals(ClipEngine.normText ? "built" : "missing", "built", "engine present");
    var el = document.createElement("div");
    el.innerText = "a\n   b\t c";
    eq(ClipEngine.normText(el), "a b c", "normalized");
  });
  function assertEquals(a, b, m) { eq(a, b, m); }

  /* ---------- engine: group detection on the demo feed ---------- */
  test("engine: finds the demo-post group with count 8", function () {
    var groups = ClipEngine.findCardGroups(document.getElementById("demo-feed"));
    ok(groups.length > 0, "at least one group");
    var grp = groups.find(function (g) { return g.classes.join(" ").indexOf("demo-post") !== -1; });
    ok(!!grp, "demo-post group present");
    eq(grp.count, 8, "8 demo posts");
    var sig = (grp.tag + "|" + grp.classes.join(".")).toLowerCase();
    ok(sig.indexOf("demo-post") !== -1, "signature contains demo-post");
    ok(grp.fieldCandidates.length >= 3, "field candidates >= 3");
  });
  test("engine: fieldScan yields title/link/time/views roles", function () {
    var feed = document.getElementById("demo-feed");
    var card = feed.querySelector(".demo-post");
    var cands = ClipEngine.fieldScan(card);
    var roles = cands.map(function (c) { return c.role; });
    ok(roles.indexOf("title") !== -1, "title role");
    ok(roles.indexOf("link") !== -1, "link role");
    var cls = cands.map(function (c) { return c.selector; }).join(" ");
    ok(/m-time|m-views|m-link/.test(cls), "metric/time/link spans visible to candidates");
  });
  test("engine: matchCount for .demo-post selector is 8", function () {
    eq(ClipEngine.matchCount({ selector: ".demo-post" }, document.getElementById("demo-feed")), 8, "8 matches");
  });
  test("engine: extractRows fills title/link/time/views", function () {
    var res = ClipEngine.extractRows(
      { selector: ".demo-post" },
      { title: ".pt a", link: ".pt a", time: ".m-time", views: ".m-views" },
      50,
      document.getElementById("demo-feed")
    );
    eq(res.total, 8, "8 rows");
    eq(res.rows[0].title, "Market open: traders eye liquidity shift", "row0 title");
    ok(res.rows[0].link.indexOf("/post/") !== -1, "link contains /post/");
    eq(res.rows[0].time, "09:14", "row0 time");
    ok(res.rows[0].views.indexOf("12.4K") !== -1, "row0 views");
    eq(res.truncated, false, "not truncated");
  });
  test("engine: maxRows caps extraction", function () {
    var res = ClipEngine.extractRows({ selector: ".demo-post" }, { title: ".pt a" }, 3, document.getElementById("demo-feed"));
    eq(res.total, 3, "capped at 3");
    ok(res.truncated, "truncated flag set");
  });
  test("engine: extractTables expands colspan", function () {
    var host = document.createElement("div");
    host.innerHTML = "<table><tr><th>H0</th><th colspan='2'>H1</th></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>";
    document.body.appendChild(host);
    var tables = ClipEngine.extractTables(50, host);
    ok(tables.length === 1, "one table");
    var head = tables[0].rows[0];
    eq(head.length, 3, "header expanded to 3 cells");
    eq(head[1], "H1", "colspan cell duplicated");
    host.remove();
  });
  test("engine: filterRows keyword mode", function () {
    var rows = [{ t: "alpha" }, { t: "beta" }, { t: "Gamma rise" }];
    var out = ClipEngine.filterRows(rows, "gam");
    eq(out.rows.length, 1, "1 kept, case-insensitive");
    eq(out.rows[0].t, "Gamma rise", "kept the matching row");
    eq(out.dropped, 2, "2 dropped");
  });
  test("engine: filterRows regex mode", function () {
    var rows = [{ t: "alpha" }, { t: "beta" }];
    var out = ClipEngine.filterRows(rows, "/^alp/i");
    eq(out.rows.length, 1, "regex kept 1");
    eq(out.rows[0].t, "alpha", "kept the right one");
  });
  test("engine: unparseable regex falls back to literal keyword", function () {
    var rows = [{ t: "x" }, { t: "he said /[/g once" }];
    var out = ClipEngine.filterRows(rows, "/[/g");
    eq(out.rows.length, 1, "literal match kept, no crash");
    eq(out.rows[0].t, "he said /[/g once", "right row kept");
  });
  test("engine: FREE_ROW_CAP is 50", function () {
    eq(ClipEngine.FREE_ROW_CAP, 50, "cap constant");
  });
  test("engine: findCardGroups ignores tiny/unique blocks", function () {
    var host = document.createElement("div");
    host.innerHTML = "<div class='a'>x</div><div class='b'>y</div><div class='c'>z</div>";
    document.body.appendChild(host);
    var groups = ClipEngine.findCardGroups(host);
    ok(groups.length === 0, "no groups from unique classes");
    host.remove();
  });

  /* ---------- tx: hash format + protocol against a mocked RPC ---------- */
  function rpcMock(result) {
    return function (url, opts) {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ jsonrpc: "2.0", id: "dc1", result: result }); }
      });
    };
  }
  var TX = "0x" + "ab".repeat(32);
  var REC_OK = {
    status: "0x1",
    blockNumber: "0x4f1a01",
    logs: [{
      address: "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000d8dA6BF26964aF0D7459f7524E32ebfFD3335335",
        "0x00000000000000000000000072aa6edde71b94f6b99c8e52edc02b5c75f74d1a"
      ],
      data: "0x0000000000000000000000000000000000000000000000000000000000895440"
    }]
  };
  test("tx: isHexTx accepts exact 0x+64hex", function () {
    ok(ClipTx.isHexTx(TX), "valid hash accepted");
    ok(!ClipTx.isHexTx("0x123"), "too short rejected");
    ok(!ClipTx.isHexTx("e/…"), "junk rejected");
    ok(!ClipTx.isHexTx(null), "null rejected");
  });
  test("tx: qualifying 9.00 USDC transfer verifies", function () {
    return ClipTx.verifyBaseUSDCPayment({ txHash: TX, minAmountUSD: 9, fetchImpl: rpcMock(REC_OK), rpcUrl: "mock://" }).then(function (r) {
      ok(r.ok, "ok=true");
      eq(r.amountUSDC, 9, "amount parsed (0x895440 = 9000000 units / 1e6)");
      ok(r.blockNumber !== undefined, "block surfaced");
    });
  });
  test("tx: 2 USDC transfer is below the $9 price", function () {
    var rec = JSON.parse(JSON.stringify(REC_OK));
    rec.logs[0].data = "0x" + (2e6).toString(16).padStart(64, "0");
    return ClipTx.verifyBaseUSDCPayment({ txHash: TX, minAmountUSD: 9, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "rejected");
      ok(String(r.reason).indexOf("below") !== -1, "below-price reason");
    });
  });
  test("tx: transfer to a foreign address rejected", function () {
    var rec = JSON.parse(JSON.stringify(REC_OK));
    rec.logs[0].topics[2] = "0x000000000000000000000000" + "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    return ClipTx.verifyBaseUSDCPayment({ txHash: TX, minAmountUSD: 9, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "foreign recipient rejected");
      ok(String(r.reason).indexOf("no qualifying") !== -1, "reason names missing qualifying transfer");
    });
  });
  test("tx: failed tx (status 0x0) rejected", function () {
    var rec = JSON.parse(JSON.stringify(REC_OK));
    rec.status = "0x0";
    return ClipTx.verifyBaseUSDCPayment({ txHash: TX, minAmountUSD: 9, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "failed tx rejected");
      ok(String(r.reason).indexOf("failed") !== -1, "reason mentions failure");
    });
  });
  test("tx: pending tx (null receipt) reports not found", function () {
    return ClipTx.verifyBaseUSDCPayment({ txHash: TX, minAmountUSD: 9, fetchImpl: rpcMock(null), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "not ok");
      ok(String(r.reason).indexOf("not found") !== -1, "reason mentions not found: " + r.reason);
    });
  });
  test("tx: USDC contract + treasury addresses pinned in module", function () {
    eq(ClipTx.USDC_BASE, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC Base address");
    ok(ClipTx.RECIPIENTS.indexOf("0x72aa6edde71b94f6b99c8e52edc02b5c75f74d1a") !== -1, "treasury A");
    ok(ClipTx.RECIPIENTS.indexOf("0xbbe6966949d7265a7f5f0b793f08293b9b7fe926") !== -1, "treasury B");
    eq(ClipTx.DEFAULT_RPC, "https://mainnet.base.org", "default rpc");
  });

  /* ---------- sandbox integration (UI-level) ---------- */
  test("sandbox: auto-detect populated groups on load", function () {
    ok(window.__CLIP_DETECT__, "sandbox() dispatch exposed");
    var groups = window.__CLIP_DETECT__();
    ok(groups.length >= 1, "at least one group detected");
    ok(groups.some(function (g) { return (g.classes.join(".") || "").indexOf("demo-post") !== -1; }), "demo-post group");
  });
  test("sandbox: selecting the demo group harvests 8 rows", function () {
    window.__CLIP_SELECT__(0);
    var d = window.__CLIP_DEMO__;
    ok(d.groups >= 1, "groups recorded: " + d.groups);
    eq(d.rows.length, 8, "8 harvested rows");
    ok(d.csv && d.csv.length > 50, "csv produced");
    ok(d.csv.indexOf("/post/") !== -1, "csv contains link column data");
  });
  test("sandbox: csv download button reflects readiness", function () {
    eq(document.getElementById("btn-dl").disabled, false, "download enabled");
  });
  test("sandbox: first csv column is a mapped field, not 'undefined'", function () {
    var d = window.__CLIP_DEMO__;
    ok(!/^undefined|^null/.test(d.csv.slice(0, 12)), "csv header sane");
  });
  test("sandbox: toggle title field off reduces rows/fields cleanly", function () {
    window.__CLIP_DETECT__();
    window.__CLIP_SELECT__(0);
    var before = window.__CLIP_DEMO__.rows.length;
    window.__CLIP_TOGGLE__(0, "title", ".pt a");
    window.__CLIP_TOGGLE__(0, "title", ".pt a"); // toggle twice => back on
    var after = window.__CLIP_DEMO__.rows.length;
    eq(before, 8, "rows before");
    eq(after, before, "rows stable after toggling");
  });

  /* ---------- page structure sanity ---------- */
  test("page: all sections present", function () {
    ["sandbox", "install", "pro", "faq", "btn-detect", "btn-dl", "tx-in", "key-in"].forEach(function (id) {
      ok(!!document.getElementById(id), "#" + id + " exists");
    });
  });
  test("page: zip download link points at a zip", function () {
    var a = document.querySelector('a[href$=".zip"]');
    ok(!!a, "zip link exists");
    ok(a.getAttribute("href").indexOf("data-clipper-unpacked.zip") !== -1, "zip filename");
  });
  test("page: no emoji in UI copy", function () {
    var main = document.querySelector("main");
    ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(main.textContent), "zero emoji");
  });

  /* ---------- harness ---------- */
  function render(r) {
    var el = document.createElement("div");
    el.className = "case " + (r.ok ? "pass" : "fail");
    el.textContent = r.msg || r.name;
    return el;
  }
  function summarize() {
    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length };
  }

  async function run() {
    t0 = performance.now();
    var caseEls = [];
    for (var i = 0; i < cases.length; i += 1) {
      var c = cases[i];
      var from = results.length;
      try {
        var ret = c.fn();
        if (ret && typeof ret.then === "function") await ret;
      } catch (e) {
        results.push({ ok: false, msg: c.name + " ✗ " + (e && e.message ? e.message : String(e)) });
      }
      var slice = results.slice(from);
      caseEls.push({
        el: render({ ok: slice.every(function (r) { return r.ok; }), msg: c.name + "  [" + slice.length + " asserts]" })
      });
    }
    var dur = Math.round(performance.now() - t0);
    var sum = summarize();
    var sumEl = document.getElementById("t-sum");
    sumEl.textContent = sum.total + " assertions · " + sum.passed + " passed · " + sum.failed + " failed · " + dur + "ms";
    sumEl.classList.add(sum.failed ? "fail" : "pass");
    var wrap = document.getElementById("t-cases");
    caseEls.forEach(function (c) { wrap.appendChild(c.el); });
    window.__RESULTS__ = {
      total: sum.total,
      passed: sum.passed,
      failed: sum.failed,
      durationMs: dur,
      cases: results.map(function (r) { return { ok: r.ok, msg: r.msg }; })
    };
  }
  void run();
})();
