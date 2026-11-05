/*
 * ui.js — Algo Tycoon interface: job board, card library, pipeline slots,
 * research, ticker, Pro modal, sandbox/editor. Click-to-build (no DnD).
 */
(function initUi(root) {
  "use strict";
  root.AT = root.AT || {};
  var $ = function (id) { return document.getElementById(id); };
  var L = root.AT.levels, G = root.AT.game, S = root.AT.save, P = root.AT.pay, R = root.AT.rng, OPS = root.AT.ops, PL = root.AT.pipeline;

  var ui = {
    state: null,
    jobId: null,      // selected job id
    cards: [],        // pipeline op ids
    tickerIdx: 0,
    /* Pro telemetry: session counters for the analytics panel and the
       exportable simulation report. Never leaves the browser. */
    telemetry: { runs: 0, accepted: 0, rejected: 0, credits: 0, durations: [], last: null, stress: null }
  };
  root.AT.ui = ui;
  root.AT.TestHooks = {
    attempt: function (jobId, opIds) { return G.attempt(ui.state, jobById(jobId), opIds); },
    research: function (nodeId) { return G.doResearch(ui.state, nodeById(nodeId)); },
    __state: function () { return ui.state; }
  };

  function jobById(id) { return L.JOBS.filter(function (j) { return j.id === id; })[0]; }
  function nodeById(id) { return L.RESEARCH.filter(function (r) { return r.id === id; })[0]; }

  function fmt(x) {
    if (Math.abs(x) >= 1000) return x.toFixed(x % 1 ? 2 : 0);
    return (Math.round(x * 100) / 100).toString();
  }

  /* ---------- HUD ---------- */
  function renderHud() {
    $("hud-credits").textContent = fmt(ui.state.credits);
    $("tier-chip").textContent = ui.state.pro ? "PRO" : "FREE";
    $("tier-chip").className = "chip mono" + (ui.state.pro ? " chip-pro" : "");
    $("slot-cap").textContent = ui.cards.length + "/" + G.slots(ui.state) + " КАРТ";
  }

  /* ---------- job board ---------- */
  function renderJobs() {
    var wrap = $("jobs");
    wrap.textContent = "";
    var acts = { 1: "АКТ I — ПИЛОТ", 2: "АКТ II — ОБЪЁМ", 3: "АКТ III — ПЛАН" };
    var keys = [1, 2, 3];
    keys.forEach(function (a) {
      var visible = L.JOBS.filter(function (j) {
        return j.act === a && (G.isJobUnlocked(ui.state, L.JOBS.indexOf(j)) || G.isJobSolved(ui.state, j.id));
      });
      if (!visible.length) return; /* no grey LOCKED rows: unseen acts stay unseen */
      var head = document.createElement("div");
      head.className = "act-head mono";
      head.textContent = acts[a] + " · " + G.actsCleared(ui.state)[a] + "/" + L.JOBS.filter(function (j) { return j.act === a; }).length;
      wrap.appendChild(head);
      L.JOBS.filter(function (j) { return j.act === a; }).forEach(function (j) {
        var idx = L.JOBS.indexOf(j);
        var unlocked = G.isJobUnlocked(ui.state, idx);
        var solved = G.isJobSolved(ui.state, j.id);
        if (!unlocked && !solved) return; /* locked rows are simply not rendered */
        var row = document.createElement("button");
        row.className = "job" + (solved ? " solved" : "") + (ui.jobId === j.id ? " sel" : "");
        row.innerHTML =
          "<span class='jpay mono'>" + fmt(G.creditFor(ui.state, j)) + " cr</span>" +
          "<span class='jtitle'>" + j.id.toUpperCase() + " · " + j.rtl + "</span>" +
          (solved ? "<span class='jmark mono'>ГОТОВО</span>" : "");
        if (unlocked) row.addEventListener("click", function () { selectJob(j.id); });
        wrap.appendChild(row);
      });
    });
    if (L.act23Error) {
      var note = document.createElement("div");
      note.className = "act-head mono warn";
      note.textContent = "Ошибка распаковки актов II/III: " + L.act23Error;
      wrap.appendChild(note);
    }
    /* The folded summary always names the contract that is on the desk. */
    var cur = ui.jobId ? jobById(ui.jobId) : null;
    if ($("board-summary") && cur) {
      var total = L.JOBS.filter(function (j) { return j.act === cur.act; }).length;
      $("board-summary").textContent = cur.id.toUpperCase() + " · " + G.actsCleared(ui.state)[cur.act] + "/" + total + " закрыто";
    }
  }

  function selectJob(id) {
    ui.jobId = id;
    ui.cards = [];
    var j = jobById(id);
    $("job-title").textContent = j.id.toUpperCase() + " · " + j.rtl;
    $("job-brief").textContent = j.brief + " Поток от сида " + j.seed + ", " + j.n + " значений · цель " + j.target;
    if ($("job-pay")) $("job-pay").textContent = fmt(G.creditFor(ui.state, j)) + " cr за сдачу";
    if ($("act-label")) {
      var names = { 1: "АКТ I · ПИЛОТ", 2: "АКТ II · ОБЪЁМ", 3: "АКТ III · ПЛАН" };
      $("act-label").textContent = names[j.act] || ("АКТ " + j.act);
    }
    renderStream(j);
    renderPipeline();
    $("verdict").textContent = "соберите пайплайн и нажмите «Запустить поток заказов»";
    $("verdict").className = "verdict mono";
    renderJobs();
    renderHud();
  }

  function renderStream(j) {
    var stream = R.genStream(j.seed, j.n);
    var box = $("stream");
    box.textContent = "";
    stream.forEach(function (v, i) {
      var c = document.createElement("span");
      c.className = "val" + (v > 0 ? " pos" : v < 0 ? " neg" : "") + " flow";
      c.style.animationDelay = (i * 70) + "ms";
      c.textContent = (v > 0 ? "+" : "") + v.toFixed(1);
      box.appendChild(c);
    });
    $("target").textContent = j.target;
  }

  /* ---------- pipeline ---------- */
  function renderPipeline() {
    var wrap = $("pipeline");
    wrap.textContent = "";
    var cap = G.slots(ui.state);
    for (var i = 0; i < cap; i += 1) {
      (function (i) {
        var slot = document.createElement("button");
        slot.className = "slot";
        if (ui.cards[i]) {
          slot.classList.add("filled", "pop");
          slot.style.animationDelay = (i * 80) + "ms";
          slot.textContent = OPS.get(ui.cards[i]).label;
          slot.addEventListener("click", function () {
            ui.cards.splice(i, 1);
            renderPipeline(); renderHud();
          });
        } else {
          slot.textContent = String(i + 1).padStart(2, "0");
        }
        wrap.appendChild(slot);
      })(i);
    }
    $("run").disabled = ui.cards.length === 0;
  }

  function renderLibrary() {
    var wrap = $("library");
    wrap.textContent = "";
    if ($("lib-count")) $("lib-count").textContent = String(OPS.list.length);
    OPS.list.forEach(function (op) {
      var b = document.createElement("button");
      b.className = "card";
      b.textContent = op.label;
      b.addEventListener("click", function () {
        if (ui.cards.length >= G.slots(ui.state)) {
          flash("пайплайн заполнен — уберите карту или откройте WIDE PIPELINE");
          return;
        }
        ui.cards.push(op.id);
        renderPipeline(); renderHud();
      });
      wrap.appendChild(b);
    });
  }

  function flash(msg) {
    $("verdict").textContent = msg;
    $("verdict").className = "verdict mono warn";
  }

  /* RUN is the one action on the page, so it shows the work: every filled slot
     fires left to right, then the desk answers with accepted / rejected. The
     engine call itself stays instant and synchronous. */
  var running = false;

  function runPipeline() {
    var j = jobById(ui.jobId);
    if (!j || !ui.cards.length || running) return;
    running = true;
    var btn = $("run");
    btn.disabled = true;
    var slots = Array.prototype.slice.call(document.querySelectorAll("#pipeline .slot.filled"));
    slots.forEach(function (s, i) {
      s.classList.remove("firing");
      /* restart the animation on a repeated run */
      void s.offsetWidth;
      s.style.animationDelay = (i * 130) + "ms";
      s.classList.add("firing");
    });
    $("verdict").textContent = "поток заказов идёт: " + ui.cards.length + " карт…";
    $("verdict").className = "verdict mono";
    var settle = 180 + slots.length * 130;
    setTimeout(function () {
      slots.forEach(function (s) { s.classList.remove("firing"); s.style.animationDelay = ""; });
      running = false;
      evaluate(j);
    }, settle);
  }

  function evaluate(j) {
    var t0 = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    var r = G.attempt(ui.state, j, ui.cards);
    var ms = Math.max(0, ((root.performance && root.performance.now) ? root.performance.now() : Date.now()) - t0);
    var tm = ui.telemetry;
    tm.runs += 1;
    tm.durations.push(Math.round(ms * 1000) / 1000);
    if (tm.durations.length > 200) tm.durations.shift();
    tm.last = { job: j.id, ok: !!r.ok, ms: Math.round(ms * 1000) / 1000, at: new Date().toISOString() };
    if (r.ok && !G.isJobSolved(ui.state, j.id)) {
      ui.state.credits += r.payout;
      G.markSolved(ui.state, j.id);
      S.save(ui.state);
      tm.accepted += 1;
      tm.credits = Math.round((tm.credits + r.payout) * 100) / 100;
      $("verdict").textContent = "ПРИНЯТО · +" + fmt(r.payout) + " cr. Заказ закрыт, следующий уже на столе.";
      $("verdict").className = "verdict mono ok";
      renderJobs(); renderHud(); renderResearch();
    } else if (r.ok) {
      tm.accepted += 1;
      $("verdict").textContent = "верно снова — выплата за этот заказ уже получена";
      $("verdict").className = "verdict mono ok";
    } else {
      tm.rejected += 1;
      $("verdict").textContent = "ОТКЛОНЕНО · " + r.reason;
      $("verdict").className = "verdict mono warn";
    }
    renderTelemetry();
    $("run").disabled = ui.cards.length === 0;
  }

  /* ---------- research ---------- */
  function renderResearch() {
    var wrap = $("research");
    wrap.textContent = "";
    var ownedCount = 0;
    L.RESEARCH.forEach(function (node) {
      var owned = ui.state.research.indexOf(node.id) !== -1;
      if (owned) ownedCount += 1;
      var b = document.createElement("button");
      b.className = "rnode" + (owned ? " owned" : "");
      b.innerHTML = "<span class='rlabel'>" + node.label + "</span>" +
        "<span class='rdesc'>" + node.desc + "</span>" +
        "<span class='rcost mono'>" + (owned ? "УСТАНОВЛЕНО" : fmt(node.cost) + " cr") + "</span>";
      if (!owned) b.addEventListener("click", function () {
        if (G.doResearch(ui.state, node)) {
          $("verdict").textContent = "исследование установлено: " + node.label;
          $("verdict").className = "verdict mono ok";
          S.save(ui.state); sortResearchOrder();
          renderResearch(); renderHud(); renderPipeline();
        } else {
          flash("не хватает кредитов на " + node.label);
        }
      });
      wrap.appendChild(b);
    });
    if ($("research-summary")) {
      $("research-summary").textContent = ownedCount + " из " + L.RESEARCH.length + " установлено";
    }
  }

  /* keep XYZ order stable; cosmetic */
  function sortResearchOrder() { void 0; }

  /* ---------- ticker (cosmetic order-book buff) ---------- */
  function tickTicker() {
    var el = $("ticker");
    var mk = R.mulberry32(L.TICKER.seed + ui.tickerIdx);
    var parts = [];
    var rows = 5;
    for (var i = 0; i < rows; i += 1) {
      var instr = L.TICKER.instruments[Math.floor(mk() * L.TICKER.instruments.length)];
      var px = (mk() * 20 + 1).toFixed(2);
      var dp = (mk() > 0.5 ? "▲" : "▼");
      var dpPct = (mk() * 4 + 0.1).toFixed(2);
      parts.push(instr + " " + px + " " + dp + dpPct + "%");
    }
    ui.tickerIdx += 1;
    el.textContent = "" + parts.join("   ·   ");
  }

  /* ---------- Pro modal ---------- */
  function openPro() {
    $("pro-modal").classList.remove("hidden");
    $("pro-status").textContent = "";
    if (ui.state.pro) $("pro-status").textContent = "PRO is already active on this machine";
  }
  function closePro() { $("pro-modal").classList.add("hidden"); }

  function specLine(kind) {
    return kind === "source" ?
      "SEND " + P.PRICE_SOURCE + ".00 USDC (BASE) TO A OR B · PRODUCT: SOURCE PACK" :
      "SEND " + P.PRICE_PRO + ".00 USDC (BASE) TO A OR B · PRODUCT: PRO";
  }

  function verifyPro(kind) {
    var el = $("pro-status");
    el.textContent = "querying Base RPC…";
    var amount = kind === "source" ? P.PRICE_SOURCE : P.PRICE_PRO;
    P.verifyBaseUSDCPayment({ txHash: $("tx-in").value, amountUSD: amount }).then(function (r) {
      if (r.ok) {
        if (kind === "source") ui.state.sourcePro = true; else ui.state.pro = true;
        S.save(ui.state);
        applyEntitlements();
        el.textContent = "verified: " + r.amountUSDC + " USDC @ block " + r.blockNumber;
      } else {
        el.textContent = "not verified: " + r.reason;
      }
    });
  }

  /* One click: the wallet switches to Base, sends USDC.transfer, and the page
     unlocks itself from the receipt. The hash inputs below stay as the manual
     path for mobile wallets and exchange withdrawals. */
  function wireOneClick() {
    if (!window.Unlock || !window.Unlock.mountOneClick) return;
    window.Unlock.mountOneClick($("pay-1click"), {
      product: "algo-tycoon",
      price: P.PRICE_PRO,
      note: $("pay-1click-hint"),
      onError: function (msg) { $("pro-status").textContent = msg || ""; },
      onDone: function (r) {
        ui.state.pro = true;
        S.save(ui.state);
        applyEntitlements();
        $("pro-status").textContent = "paid in one click: " + (Number(r.received) / 1e6).toFixed(2) + " USDC confirmed on Base";
      }
    });
  }

  function verifyKey() {
    var el = $("pro-status");
    var raw = ($("key-in").value || "").trim();
    /* TW1-… is the card/SBP key every other page sells. It is verified by the
       shared ECDSA layer (assets/unlock.js), and an ALL key grants every tool.
       The legacy LC1/Ed25519 path below still works for old source-pack buyers. */
    if (/^TW1-/i.test(raw)) {
      if (!window.Unlock || !window.Unlock.verifyLicenseKey) {
        el.textContent = "TW1 verifier did not load — reload the page";
        return;
      }
      el.textContent = "checking TW1 signature…";
      window.Unlock.verifyLicenseKey(raw, { product: "algo-tycoon" }).then(function (lic) {
        if (lic && lic.valid) {
          reflectionSet("pro");
          el.textContent = "TW1 key accepted (" + lic.code + " · " + lic.kid + ") — unlocked offline";
        } else {
          var map = {
            format: "not a TW1 key — paste the whole line from the order",
            signature: "signature mismatch — the key was truncated or edited",
            product: "this key belongs to another product; use an ALL key for the pass",
            crypto: "the browser refused the signature check — open the page over https"
          };
          el.textContent = "TW1 key rejected: " + (map[lic && lic.error] || "unknown error");
        }
      }, function (e) { el.textContent = "TW1 check failed: " + e.message; });
      return;
    }
    el.textContent = "checking key…";
    P.verifyLicense(raw).then(function (r) {
      if (r.ok) {
        reflectionSet("pro");
        el.textContent = "license valid (" + r.payload.u + ")";
      } else {
        el.textContent = "invalid: " + r.reason;
      }
    });
  }
  function reflectionSet(k) { // key can only ever mean "pro"
    ui.state.pro = true;
    S.save(ui.state);
    applyEntitlements(); renderHud();
  }

  function applyEntitlements() {
    document.body.classList.toggle("pro", !!ui.state.pro);
    renderHud(); renderPipeline(); renderJobs(); renderTelemetry();
  }

  /* ---------- sandbox + editor (Pro) ---------- */
  function sandboxRun() {
    if (!ui.state.pro) { openPro(); return; }
    var seed = Number($("sb-seed").value) || 1;
    var n = Math.max(1, Math.min(64, Number($("sb-n").value) || 8));
    var opsIds = ($("sb-ops").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var stream = R.genStream(seed, n);
    $("sb-stream").textContent = JSON.stringify(stream);
    try {
      var out = PL.compile(opsIds, stream, 64);
      $("sb-out").textContent = JSON.stringify(out.map(function (x) { return Math.round(x * 1e9) / 1e9; }));
      $("sb-out").className = "mono ok-text";
    } catch (e) {
      $("sb-out").textContent = "error: " + e.message;
      $("sb-out").className = "mono warn-text";
    }
  }

  function editorExport() {
    if (!ui.state.pro) { openPro(); return; }
    var j = jobById(ui.jobId);
    $("editor-out").textContent = JSON.stringify({
      id: j.id, seed: j.seed, n: j.n, target: j.target, ops: ui.cards, payout: j.payout
    }, null, 1);
  }

  /* ---------- Pro: telemetry, report, stress scenarios ---------- */
  function renderTelemetry() {
    var tm = ui.telemetry;
    function set(id, value) { var el = $(id); if (el) el.textContent = value; }
    var avg = tm.durations.length
      ? (tm.durations.reduce(function (a, b) { return a + b; }, 0) / tm.durations.length).toFixed(2) + " ms"
      : "—";
    set("tm-runs", String(tm.runs));
    set("tm-accepted", String(tm.accepted));
    set("tm-rejected", String(tm.rejected));
    set("tm-credits", fmt(tm.credits));
    set("tm-avg", avg);
    set("tm-last", tm.last ? tm.last.job + " · " + (tm.last.ok ? "OK" : "REJECT") + " · " + tm.last.ms + " ms" : "—");
    var solved = ui.state ? ui.state.solved.length : 0;
    set("tm-solved", String(solved));
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function sessionSnapshot() {
    return {
      generatedAt: new Date().toISOString(),
      product: "algo-tycoon",
      engine: "deterministic op-card pipeline",
      state: {
        credits: ui.state.credits,
        solved: ui.state.solved.slice(),
        research: ui.state.research.slice(),
        compilers: ui.state.compilers,
        pro: !!ui.state.pro,
        sourcePro: !!ui.state.sourcePro
      },
      session: {
        selectedJob: ui.jobId,
        pipeline: ui.cards.slice(),
        slots: G.slots(ui.state),
        actsCleared: G.actsCleared(ui.state),
        earnableLeft: G.totalEarnable(ui.state)
      },
      telemetry: ui.telemetry
    };
  }

  function exportReport() {
    if (!ui.state.pro) { openPro(); return; }
    download("algo-tycoon-report-" + Date.now() + ".json", JSON.stringify(sessionSnapshot(), null, 2), "application/json");
    $("pro-status").textContent = "full simulation report exported (JSON, local only)";
  }

  function exportTelemetryCsv() {
    if (!ui.state.pro) { openPro(); return; }
    var rows = [["run", "duration_ms"]];
    ui.telemetry.durations.forEach(function (d, i) { rows.push([i + 1, String(d)]); });
    rows.push(["total_runs", String(ui.telemetry.runs)]);
    rows.push(["accepted", String(ui.telemetry.accepted)]);
    rows.push(["rejected", String(ui.telemetry.rejected)]);
    rows.push(["credits_earned", String(ui.telemetry.credits)]);
    download("algo-tycoon-telemetry-" + Date.now() + ".csv", rows.map(function (r) { return r.join(","); }).join("\n"), "text/csv;charset=utf-8");
    $("pro-status").textContent = "telemetry exported (CSV, local only)";
  }

  /* A stress scenario is a seed range against a fixed op pipeline: the buyer
     picks the window, the desk reports the distribution instead of a single
     target hit. Runs entirely on the deterministic RNG in js/rng.js. */
  function runStress() {
    if (!ui.state.pro) { openPro(); return; }
    var from = Math.max(1, Math.min(1e9, Number($("stress-from").value) || 1));
    var to = Math.max(from, Math.min(from + 500, Number($("stress-to").value) || from + 20));
    var n = Math.max(1, Math.min(64, Number($("stress-n").value) || 8));
    var opsIds = ($("stress-ops").value || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var out = $("stress-out");
    if (!opsIds.length) { out.textContent = "add at least one op id"; out.className = "out-block mono warn-text"; return; }
    var vals = [];
    var errors = 0;
    var t0 = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    for (var seed = from; seed <= to; seed += 1) {
      try {
        var stream = R.genStream(seed, n);
        var res = PL.compile(opsIds, stream, 64);
        var v = res[0];
        if (typeof v === "number" && isFinite(v)) vals.push(v); else errors += 1;
      } catch (e) { errors += 1; }
    }
    var ms = ((root.performance && root.performance.now) ? root.performance.now() : Date.now()) - t0;
    if (!vals.length) {
      out.textContent = "all " + (to - from + 1) + " scenarios failed — check op ids";
      out.className = "out-block mono warn-text";
      return;
    }
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var sd = Math.sqrt(vals.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / vals.length);
    ui.telemetry.stress = {
      seeds: [from, to], n: n, ops: opsIds, count: vals.length, errors: errors,
      min: min, max: max, mean: mean, sd: sd, ms: Math.round(ms * 100) / 100,
      at: new Date().toISOString()
    };
    out.textContent = [
      "scenarios " + vals.length + " (errors " + errors + ") · " + Math.round(ms) + " ms",
      "min " + min.toFixed(6),
      "max " + max.toFixed(6),
      "mean " + mean.toFixed(6),
      "sd " + sd.toFixed(6)
    ].join("\n");
    out.className = "out-block mono ok-text";
    renderTelemetry();
  }

  /* ---------- boot ---------- */
  function __boot() {
    ui.state = S.load();
    /* A TW1-ALL key (or the All-in-One pass) grants Pro here too, without a
       second purchase: assets/unlock.js mirrors the universal record. */
    if (!ui.state.pro && window.Unlock && window.Unlock.isPro("algo-tycoon")) {
      ui.state.pro = true;
      S.save(ui.state);
    }
    var off = S.offlineEarnings(ui.state);
    if (off.credits > 0) {
      ui.state.credits += off.credits;
      S.save(ui.state);
    }
    renderLibrary();
    renderResearch();
    /* start screen opens straight onto the live board: first unsolved job (fresh save = J01) */
    var first = L.JOBS[G.unlockedIndex(ui.state)] || L.JOBS[0];
    selectJob(first.id);
    /* A brand-new desk starts with a working two-card pipeline on J01:
       REV then SUM is the same sum, so the first tap of RUN is a win. */
    if (!ui.state.solved.length && first.id === "j01") {
      ui.cards = ["reverse", "sum"];
      renderPipeline();
      renderHud();
    }
    tickTicker(); setInterval(tickTicker, 4000);
    $("run").addEventListener("click", runPipeline);
    $("chip-pro-zone").addEventListener("click", openPro);
    $("modal-close").addEventListener("click", closePro);
    $("tab-tx-btn").addEventListener("click", function () { verifyPro("pro"); });
    $("tab-src-btn").addEventListener("click", function () { verifyPro("source"); });
    $("tab-key-btn").addEventListener("click", verifyKey);
    wireOneClick();
    $("sb-run").addEventListener("click", sandboxRun);
    $("ed-export").addEventListener("click", editorExport);
    if ($("tm-export")) $("tm-export").addEventListener("click", exportReport);
    if ($("tm-csv")) $("tm-csv").addEventListener("click", exportTelemetryCsv);
    if ($("stress-run")) $("stress-run").addEventListener("click", runStress);
    document.addEventListener("unlock:changed", function () {
      if (!ui.state.pro && window.Unlock && window.Unlock.isPro("algo-tycoon")) {
        ui.state.pro = true;
        S.save(ui.state);
        applyEntitlements();
      }
    });
    applyEntitlements();
    renderHud();
  }

  function boot() {
    /* Acts II–III stay AES-GCM-sealed until crypt.ready() merges the blob;
       without WebCrypto the game still boots on Act I (see board notice). */
    root.AT.crypt.whenReady(function () { __boot(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else boot();
})(window);
