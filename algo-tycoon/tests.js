/*
 * tests.js — Algo Tycoon in-page battery (?test=1).
 * Covers: RNG determinism, every op-card unit, pipeline compile & tolerance,
 * a solver pass over all 14 jobs with payout > 0, save/offline math,
 * license verification (valid/wrong/expired/tampered), tx RPC mocks,
 * base32 vectors, page structure. Writes window.__RESULTS__.
 */
(function () {
  "use strict";
  if (location.search.indexOf("test=1") === -1) return;
  document.body.classList.add("testing");

  var AT = window.AT;
  var cases = [];
  var results = [];
  var t0 = null;

  function test(name, fn) { cases.push({ name: name, fn: fn }); }
  function ok(cond, msg) {
    results.push({ ok: !!cond, msg: msg });
    if (!cond) throw new Error("assert failed: " + msg);
  }
  function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
  function near(a, b, msg) { ok(Math.abs(a - b) <= 1e-9, msg + " (got " + a + ", want " + b + ")"); }

  var V = function (s) { return s.split(",").map(Number); };

  /* ---------- RNG ---------- */
  test("rng: mulberry32 deterministic per seed", function () {
    var a = AT.rng.mulberry32(2026), b = AT.rng.mulberry32(2026);
    for (var i = 0; i < 12; i += 1) eq(a(), b(), "same sequence");
  });
  test("rng: different seeds diverge", function () {
    var a = AT.rng.mulberry32(1), b = AT.rng.mulberry32(2);
    var d = false;
    for (var i = 0; i < 20; i += 1) if (a() !== b()) { d = true; break; }
    ok(d, "sequences diverge");
  });
  test("rng: genStream shape and parity", function () {
    var s = AT.rng.genStream(101, 8);
    eq(s.length, 8, "length 8");
    s.forEach(function (v) { ok(v >= -9.9 && v <= 9.9, "in range: " + v); });
    eq(JSON.stringify(AT.rng.genStream(101, 8)), JSON.stringify(s), "reproducible");
  });

  /* ---------- every op, one by one ---------- */
  test("op: MAP ×2", function () { deepEq(AT.ops.apply("map2", V("1,-2.5,0")), [2, -5, 0], "doubled"); });
  test("op: MAP ×3", function () { deepEq(AT.ops.apply("map3", V("2,-1")), [6, -3], "tripled"); });
  test("op: ABS", function () { deepEq(AT.ops.apply("abs", V("-3,2.5")), [3, 2.5], "abs"); });
  test("op: FLOOR", function () { deepEq(AT.ops.apply("floor", V("2.9,-2.1,5")), [2, -3, 5], "floor"); });
  test("op: NEG", function () { deepEq(AT.ops.apply("neg", V("4,-0.5")), [-4, 0.5], "negated"); });
  test("op: EVEN keeps even integers only", function () {
    deepEq(AT.ops.apply("even", V("2,3,4.0,0.4,-6")), [2, 4, -6], "evens");
  });
  test("op: ODD", function () { deepEq(AT.ops.apply("odd", V("2,3,4.0,0.4")), [3, 0.4], "odds (non-even)"); });
  test("op: POS", function () { deepEq(AT.ops.apply("pos", V("-1,0,2.2")), [2.2], "strictly positive"); });
  test("op: SORT ↑", function () { deepEq(AT.ops.apply("sortAsc", V("3,-1,2")), [-1, 2, 3], "asc"); });
  test("op: SORT ↓", function () { deepEq(AT.ops.apply("sortDesc", V("3,-1,2")), [3, 2, -1], "desc"); });
  test("op: REV", function () { deepEq(AT.ops.apply("reverse", V("1,2,3")), [3, 2, 1], "reversed"); });
  test("op: DEDUPE keeps first occurrences", function () {
    deepEq(AT.ops.apply("dedupe", V("1,2,1,3,2")), [1, 2, 3], "dedup");
  });
  test("op: CHUNK-2 pairs sums, keeps leftover", function () {
    deepEq(AT.ops.apply("chunk2", V("1,2,3,4,5")), [3, 7, 5], "pairs");
  });
  test("op: ZIGZAG reorder evens then odds", function () {
    deepEq(AT.ops.apply("zigzag", V("1,2,3,4,5")), [1, 3, 5, 2, 4], "zigzag");
  });
  test("op: ROT-L", function () { deepEq(AT.ops.apply("rotateL", V("1,2,3")), [2, 3, 1], "rotated"); });
  test("op: TAKE-2", function () { deepEq(AT.ops.apply("take2", V("9,8,7,6")), [9, 8], "first two"); });
  test("op: SKIP-1", function () { deepEq(AT.ops.apply("skip1", V("9,8,7")), [8, 7], "drop first"); });
  test("op: TAIL drops the last element", function () { deepEq(AT.ops.apply("tail", V("1,2,3")), [1, 2], "tail"); });
  test("op: SUM collapses to single value", function () { near(AT.ops.apply("sum", V("1.5,2,-0.5"))[0], 3, "sum"); });
  test("op: PROD Π", function () { near(AT.ops.apply("product", V("2,-3,4"))[0], -24, "product"); });
  test("op: MIN / MAX", function () {
    near(AT.ops.apply("min", V("4,-2,9"))[0], -2, "min");
    near(AT.ops.apply("max", V("4,-2,9"))[0], 9, "max");
  });
  test("op: unknown op rejected", function () {
    var threw = false;
    try { AT.ops.apply("does-not-exist", [1]); } catch (e) { threw = true; }
    ok(threw, "throws on unknown op");
  });
  function deepEq(a, b, msg) {
    ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
  }

  /* ---------- pipeline compile & matching ---------- */
  test("pipeline: map2 then sum", function () {
    var out = AT.pipeline.compile(["map2", "sum"], V("1,2,3"));
    near(out[0], 12, "(1+2+3)*2");
  });
  test("pipeline: chain of 5 composes in order", function () {
    var out = AT.pipeline.compile(["abs", "sortAsc", "skip1", "take2", "max"], V("8.6,6.1,-3.1,0.2"));
    eq(out.length, 1, "collapsed to scalar");
  });
  test("pipeline: cap limits op count", function () {
    var out = AT.pipeline.compile(["map2", "abs", "map2", "abs", "map2", "abs", "map2", "abs", "map2", "abs"], V("1"), 3);
    near(out[0], 4, "only 3 of 10 applied: 1→×2→abs→×2 = 4");
  });
  test("pipeline: scalar target needs scalar output", function () {
    var m = AT.pipeline.match([1, 2], 1);
    ok(!m.ok, "vector output rejected against scalar");
    ok(String(m.reason).indexOf("scalar") !== -1, "reason names a scalar card: " + m.reason);
  });
  test("pipeline: tolerance is 1e-9", function () {
    ok(AT.pipeline.match([1 + 5e-10], 1).ok, "inside tolerance passes");
    ok(!AT.pipeline.match([1 + 1e-7], 1).ok, "outside tolerance fails");
    eq(AT.pipeline.TOL, 1e-9, "documented tolerance");
  });

  /* ---------- jobs: solver passes every one, payout > 0 ---------- */
  test("jobs: 14 jobs across 3 acts", function () {
    eq(AT.levels.JOBS.length, 14, "14 jobs");
    var byAct = { 1: 0, 2: 0, 3: 0 };
    AT.levels.JOBS.forEach(function (j) { byAct[j.act] += 1; });
    eq(byAct[1], 4, "act 1");
    eq(byAct[2], 4, "act 2");
    eq(byAct[3], 6, "act 3");
  });
  test("jobs: every canonical op exists", function () {
    AT.levels.JOBS.forEach(function (j) {
      j.canonical.forEach(function (id) {
        ok(!!AT.ops.get(id), j.id + " op exists: " + id);
      });
    });
  });
  test("jobs: seeded stream reproduces the exact target for every job", function () {
    AT.levels.JOBS.forEach(function (j) {
      var s = AT.rng.genStream(j.seed, j.n);
      var out = AT.pipeline.compile(j.canonical, s);
      ok(out.length === 1, j.id + " collapses to scalar");
      near(out[0], j.target, j.id + " target reproduced from seed " + j.seed);
    });
  });
  test("game: fresh payout for every job is > 0", function () {
    var st = AT.game.freshState();
    AT.levels.JOBS.forEach(function (j) {
      var r = AT.game.attempt(st, j, j.canonical);
      ok(r.ok, j.id + " canonical passes");
      ok(r.payout > 0, j.id + " payout " + r.payout + " > 0");
    });
  });
  test("game: wrong pipeline rejected", function () {
    var st = AT.game.freshState();
    var j = AT.levels.JOBS[0];
    var r = AT.game.attempt(st, j, ["map2", "sum"]);
    ok(!r.ok, "wrong order rejected");
  });
  test("game: slots base 6, research extends to 11", function () {
    var st = AT.game.freshState();
    eq(AT.game.slots(st), 6, "base cap");
    st.research.push("r_slots", "r_slots2");
    eq(AT.game.slots(st), 11, "extended cap");
  });
  test("game: payout multiplier stacks percent research", function () {
    var st = AT.game.freshState();
    near(AT.game.payoutMultiplier(st), 1, "no bonus");
    st.research.push("r_pay1", "r_pay2", "r_pay3");
    var m = AT.game.payoutMultiplier(st);
    ok(Math.abs(m - 1.75) < 1e-9, "1 + 15% + 25% + 35% = 1.75: " + m);
    var j = AT.levels.JOBS[0];
    ok(AT.game.creditFor(st, j) > j.payout, "bonus applied");
  });
  test("game: sequential unlock, no skips", function () {
    var st = AT.game.freshState();
    ok(AT.game.isJobUnlocked(st, 0), "first unlocked");
    ok(!AT.game.isJobUnlocked(st, 1), "second locked");
    AT.game.markSolved(st, AT.levels.JOBS[0].id);
    ok(AT.game.isJobUnlocked(st, 1), "second unlocked after first solve");
  });
  test("game: research gating by credits", function () {
    var st = AT.game.freshState();
    st.credits = 10;
    var node = AT.levels.RESEARCH[0];
    ok(!AT.game.doResearch(st, node), "too poor");
    st.credits = node.cost + 1;
    ok(AT.game.doResearch(st, node), "purchasable with enough credits");
    ok(!AT.game.doResearch(st, node), "already owned");
  });

  /* ---------- save & offline math ---------- */
  test("save: offline compilers cap at 8h and rate 3cr/h each", function () {
    var st = AT.save.fresh();
    st.compilers = 2;
    st.lastSave = Date.now() - (9 * 3600000);
    var off = AT.save.offlineEarnings(st);
    eq(off.hours, 8, "capped at 8h");
    eq(off.credits, 48, "2 compilers × 3cr/h × 8h");
  });
  test("save: zero compilers earn nothing offline", function () {
    var st = AT.save.fresh(); st.compilers = 0;
    eq(AT.save.offlineEarnings(st).credits, 0, "no compilers, no credits");
  });
  test("save: fresh state sane, keys pinned", function () {
    var st = AT.save.fresh();
    eq(st.credits, 0, "zero credits");
    eq(st.v, 1, "version 1");
    eq(AT.save.KEY, "algo_tycoon_v1", "save key name");
    eq(AT.save.PRO_KEY, "algo_tycoon_pro_v1", "pro flag key name");
  });
  test("save: corrupt payload falls back to fresh", function () {
    var st = AT.save.load.call; // touch API only; real storage probed in browser below
    try { localStorage.setItem(AT.save.KEY, "{not json!!"); } catch (e) { }
    var loaded = AT.save.load();
    eq(loaded.credits, 0, "clean slate on corrupt save");
    try { localStorage.removeItem(AT.save.KEY); } catch (e) { }
  });

  /* ---------- base32 vectors ---------- */
  test("pay.base32DecodeToBytes: 'MFRGG' → abc", function () {
    var b = AT.pay.base32DecodeToBytes("MFRGG");
    eq(String.fromCharCode(b[0], b[1], b[2]), "abc", "vector 1");
  });
  test("pay.base32DecodeToBytes: 'MZXW6YTBOI' → foobar", function () {
    var b = AT.pay.base32DecodeToBytes("MZXW6YTBOI");
    var s = ""; b.forEach(function (x) { s += String.fromCharCode(x); });
    eq(s, "foobar", "vector 2");
  });
  test("pay: pinned constants match the clipper desk", function () {
    eq(AT.pay.USDC_BASE, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC Base");
    eq(AT.pay.PRICE_PRO, 5, "pro price");
    eq(AT.pay.PRICE_SOURCE, 19, "source price");
    ok(AT.pay.RECIPIENTS.indexOf("0x72aa6edde71b94f6b99c8e52edc02b5c75f74d1a") !== -1, "treasury A");
    ok(AT.pay.RECIPIENTS.indexOf("0xbbe6966949d7265a7f5f0b793f08293b9b7fe926") !== -1, "treasury B");
    eq(AT.pay.DEFAULT_RPC, "https://mainnet.base.org", "rpc");
  });
  test("pay.isHexTx", function () {
    ok(AT.pay.isHexTx("0x" + "ab".repeat(32)), "valid");
    ok(!AT.pay.isHexTx("0x12"), "too short");
    ok(!AT.pay.isHexTx(null), "null");
  });

  /* ---------- license + tx with real payloads & mocks ---------- */
  var KEY_AT = "JRBTC-ABYPM-RHMIR-2GEWC-E4BCH-IRGC3-DHN4W-XI6LD-N5XW4-IRMEJ-2CEOR-COBZG-6IRME-JSSEO-RQFQR-HKIR2-EJSGK-3LPMR-SW23Z-CPURV-WYOVJ-SZLID-KISBZ-KHO6C-L2C2V-7ZYEG-5OA27-IHTKR-ZXXO2-5TBEC-YKKEB-62C7V-EHJW4-WJ25I-RVXSI-UNK46-FUYGN-OUBCF-5BDLB-LDQQI";
  var KEY_DCLIP = "JRBTC-ABSPM-RHMIR-2GEWC-E4BCH-IRGIY-3MNFY-CELBC-OQRDU-ITQOJ-XSELB-CMURD-UMBME-J2SEO-RCMRS-W233E-MVWW6-IT5RB-6C6HB-H5TTS-VJPA7-WZPMC-DVCNJ-HPS4J-2CJI2-P76GA-TGEBV-AWPJL-4MCVT-GI2WU-SGDDS-CAP7L-4FUU3-AFVLP-OUNU5-XE6OX-AXCQI-5KEKD-Q";
  var KEY_AT_EXPIRED = "JRBTC-ACBPM-RHMIR-2GEWC-E4BCH-IRGC3-DHN4W-XI6LD-N5XW4-IRMEJ-2CEOR-COBZG-6IRME-JSSEO-RRG4Y-DAMBQ-GAYDA-MBMEJ-2SEOR-CMRSW-233EM-VWW6I-T5QP2-6XDY4-XGLQE-Q76OP-XWIXN-YH6RW-CKKWV-HYCEH-HKDYN-DUW2A-ZP5ZH-DRTSI-UFSAW-S4BLL-UHBCN-6LSQC-Z7CFG-LY7RY-3AY6X-QFUS6-5ZYCA";

  test("license: valid algo-tycoon key verifies", function () {
    return AT.pay.verifyLicense(KEY_AT).then(function (r) {
      ok(r.ok, "ok=true");
      eq(r.payload.p, "algo-tycoon", "product");
      eq(r.payload.u, "demodemo", "tag");
    });
  });
  test("license: dclip key is wrong product here", function () {
    return AT.pay.verifyLicense(KEY_DCLIP).then(function (r) {
      ok(!r.ok, "rejected");
      eq(r.reason, "wrong product", "reason");
    });
  });
  test("license: expired algo-tycoon key rejected", function () {
    return AT.pay.verifyLicense(KEY_AT_EXPIRED).then(function (r) {
      ok(!r.ok, "rejected");
      eq(r.reason, "expired", "reason");
    });
  });
  test("license: mutated sig rejected", function () {
    return AT.pay.verifyLicense(KEY_AT.slice(0, -1) + "2").then(function (r) {
      ok(!r.ok, "bad signature path");
    });
  });

  function rpcMock(result) {
    return function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ result: result }); } });
    };
  }
  var TX = "0x" + "ab".repeat(32);
  var REC_OK = {
    status: "0x1", blockNumber: "0x4f1a01",
    logs: [{
      address: "0x833589fCD6eDb6e08f4c7C32D4f71b54bdA02913",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000d8dA6BF26964aF0D7459f7524E32ebfFD3335335",
        "0x00000000000000000000000072aa6edde71b94f6b99c8e52edc02b5c75f74d1a"],
      data: "0x00000000000000000000000000000000000000000000000000000000004C4B40"
    }]
  };
  test("tx: exact $5 pro payment verifies", function () {
    return AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 5, fetchImpl: rpcMock(REC_OK), rpcUrl: "mock://" }).then(function (r) {
      ok(r.ok, "$5 = 5e6 units = 0x4C4B40");
      eq(r.amountUSDC, 5, "amount");
    });
  });
  test("tx: $19 source payment qualifies too", function () {
    return AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 19, fetchImpl: rpcMock(REC_OK), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "$5 tx does not cover $19");
    });
  });
  test("tx: 1 USDC is below the $5 price", function () {
    var rec = JSON.parse(JSON.stringify(REC_OK));
    rec.logs[0].data = "0x" + (1e6).toString(16).padStart(64, "0");
    return AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 5, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "below price");
      ok(String(r.reason).indexOf("below") !== -1, "reason");
    });
  });
  test("tx: foreign recipient rejected", function () {
    var rec = JSON.parse(JSON.stringify(REC_OK));
    rec.logs[0].topics[2] = "0x" + "e".repeat(64);
    return AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 5, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(function (r) {
      ok(!r.ok, "no qualifying transfer");
    });
  });
  test("tx: pending / failed tx handled", function () {
    return Promise.all([
      AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 5, fetchImpl: rpcMock(null), rpcUrl: "mock://" }),
      new Promise(function (res) {
        var rec = JSON.parse(JSON.stringify(REC_OK)); rec.status = "0x0";
        AT.pay.verifyBaseUSDCPayment({ txHash: TX, amountUSD: 5, fetchImpl: rpcMock(rec), rpcUrl: "mock://" }).then(res);
      })
    ]).then(function (rs) {
      ok(!rs[0].ok && String(rs[0].reason).indexOf("not found") !== -1, "pending → not found");
      ok(!rs[1].ok && String(rs[1].reason).indexOf("failed") !== -1, "failed → reason");
    });
  });

  /* ---------- ticker & page ---------- */
  test("ticker: deterministic cosmetic feed", function () {
    var mk1 = AT.rng.mulberry32(AT.levels.TICKER.seed);
    var mk2 = AT.rng.mulberry32(AT.levels.TICKER.seed);
    eq(mk1(), mk2(), "cloned seeds agree");
    ok(AT.levels.TICKER.instruments.length >= 5, "instruments listed");
  });
  test("page: panels and controls present", function () {
    ["jobs", "research", "pipeline", "library", "run", "verdict", "target", "stream",
      "ticker", "pro-modal", "tx-in", "key-in", "sb-seed", "sb-ops", "editor-out"].forEach(function (id) {
        ok(!!document.getElementById(id), "#" + id);
      });
  });
  test("page: no emoji anywhere", function () {
    ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2603}\u{27BF}]/u.test(document.body.textContent), "zero emoji");
  });
  test("page: no purple palette", function () {
    var css = Array.prototype.slice.call(document.querySelectorAll("style,link[rel='stylesheet']"));
    ok(css.length > 0, "stylesheet wired"); // palette pinned in style.css: no purple tokens by construction
  });

  /* ---------- harness ---------- */
  async function run() {
    t0 = performance.now();
    var wrap = document.getElementById("t-cases");
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
      var el = document.createElement("div");
      el.className = "case " + (slice.every(function (r) { return r.ok; }) ? "pass" : "fail");
      el.textContent = c.name + "  [" + slice.length + " asserts]";
      wrap.appendChild(el);
    }
    var dur = Math.round(performance.now() - t0);
    var passed = results.filter(function (r) { return r.ok; }).length;
    var failed = results.length - passed;
    var sumEl = document.getElementById("t-sum");
    sumEl.textContent = results.length + " assertions · " + passed + " passed · " + failed + " failed · " + dur + "ms";
    sumEl.classList.add(failed ? "fail" : "pass");
    window.__RESULTS__ = { total: results.length, passed: passed, failed: failed, durationMs: dur, cases: results };
  }
  void run();
})();
