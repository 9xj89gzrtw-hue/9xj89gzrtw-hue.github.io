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
    tickerIdx: 0
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
    $("slot-cap").textContent = ui.cards.length + "/" + G.slots(ui.state) + " CARDS";
  }

  /* ---------- job board ---------- */
  function renderJobs() {
    var wrap = $("jobs");
    wrap.textContent = "";
    var acts = { 1: "ACT I — PILOT", 2: "ACT II — VOLUME", 3: "ACT III — PLAYBOOK" };
    var keys = [1, 2, 3];
    keys.forEach(function (a) {
      var head = document.createElement("div");
      head.className = "act-head mono";
      head.textContent = acts[a] + " · " + G.actsCleared(ui.state)[a] + "/" + L.JOBS.filter(function (j) { return j.act === a; }).length;
      wrap.appendChild(head);
      L.JOBS.filter(function (j) { return j.act === a; }).forEach(function (j) {
        var idx = L.JOBS.indexOf(j);
        var unlocked = G.isJobUnlocked(ui.state, idx);
        var solved = G.isJobSolved(ui.state, j.id);
        var row = document.createElement("button");
        row.className = "job" + (solved ? " solved" : "") + (ui.jobId === j.id ? " sel" : "") + (unlocked ? "" : " locked");
        row.innerHTML =
          "<span class='jpay mono'>" + (unlocked ? fmt(G.creditFor(ui.state, j)) : "—") + " cr</span>" +
          "<span class='jtitle'>" + (unlocked ? j.id.toUpperCase() + " · " + j.rtl : (solved ? j.id.toUpperCase() : "LOCKED")) + "</span>" +
          (solved ? "<span class='jmark mono'>DONE</span>" : "");
        if (unlocked) row.addEventListener("click", function () { selectJob(j.id); });
        wrap.appendChild(row);
      });
    });
  }

  function selectJob(id) {
    ui.jobId = id;
    ui.cards = [];
    var j = jobById(id);
    $("job-title").textContent = j.id.toUpperCase() + " · " + j.rtl;
    $("job-brief").textContent = j.brief + " stream seed " + j.seed + ", " + j.n + " values · target " + j.target;
    renderStream(j);
    renderPipeline();
    $("verdict").textContent = "build the pipeline, then RUN";
    $("verdict").className = "verdict mono";
    renderJobs();
    renderHud();
  }

  function renderStream(j) {
    var stream = R.genStream(j.seed, j.n);
    var box = $("stream");
    box.textContent = "";
    stream.forEach(function (v) {
      var c = document.createElement("span");
      c.className = "val" + (v > 0 ? " pos" : v < 0 ? " neg" : "");
      c.textContent = (v > 0 ? "+" : "") + v.toFixed(1);
      box.appendChild(c);
    });
    $("target").textContent = "TARGET " + j.target;
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
          slot.classList.add("filled");
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
    OPS.list.forEach(function (op) {
      var b = document.createElement("button");
      b.className = "card";
      b.textContent = op.label;
      b.addEventListener("click", function () {
        if (ui.cards.length >= G.slots(ui.state)) {
          flash("pipeline is full — remove a card or research WIDE PIPELINE");
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

  function runPipeline() {
    var j = jobById(ui.jobId);
    if (!j) return;
    var r = G.attempt(ui.state, j, ui.cards);
    if (r.ok && !G.isJobSolved(ui.state, j.id)) {
      ui.state.credits += r.payout;
      G.markSolved(ui.state, j.id);
      S.save(ui.state);
      $("verdict").textContent = "ACCEPTED · +" + fmt(r.payout) + " cr";
      $("verdict").className = "verdict mono ok";
      renderJobs(); renderHud(); renderResearch();
    } else if (r.ok) {
      $("verdict").textContent = "correct again — payout already collected";
      $("verdict").className = "verdict mono ok";
    } else {
      $("verdict").textContent = "REJECTED · " + r.reason;
      $("verdict").className = "verdict mono warn";
    }
  }

  /* ---------- research ---------- */
  function renderResearch() {
    var wrap = $("research");
    wrap.textContent = "";
    L.RESEARCH.forEach(function (node) {
      var owned = ui.state.research.indexOf(node.id) !== -1;
      var b = document.createElement("button");
      b.className = "rnode" + (owned ? " owned" : "");
      b.innerHTML = "<span class='rlabel'>" + node.label + "</span>" +
        "<span class='rdesc'>" + node.desc + "</span>" +
        "<span class='rcost mono'>" + (owned ? "INSTALLED" : fmt(node.cost) + " cr") + "</span>";
      if (!owned) b.addEventListener("click", function () {
        if (G.doResearch(ui.state, node)) {
          $("verdict").textContent = "research installed: " + node.label;
          $("verdict").className = "verdict mono ok";
          S.save(ui.state); sortResearchOrder();
          renderResearch(); renderHud(); renderPipeline();
        } else {
          flash("not enough credits for " + node.label);
        }
      });
      wrap.appendChild(b);
    });
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

  function verifyKey() {
    var el = $("pro-status");
    el.textContent = "checking key…";
    P.verifyLicense($("key-in").value).then(function (r) {
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
    renderHud(); renderPipeline(); renderJobs();
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

  /* ---------- boot ---------- */
  function boot() {
    ui.state = S.load();
    var off = S.offlineEarnings(ui.state);
    if (off.credits > 0) {
      ui.state.credits += off.credits;
      S.save(ui.state);
    }
    renderLibrary();
    renderResearch();
    selectJob(L.JOBS[G.unlockedIndex(ui.state)] ? L.JOBS[G.unlockedIndex(ui.state)].id : L.JOBS[0].id);
    tickTicker(); setInterval(tickTicker, 4000);
    $("run").addEventListener("click", runPipeline);
    $("chip-pro-zone").addEventListener("click", openPro);
    $("modal-close").addEventListener("click", closePro);
    $("tab-tx-btn").addEventListener("click", function () { verifyPro("pro"); });
    $("tab-src-btn").addEventListener("click", function () { verifyPro("source"); });
    $("tab-key-btn").addEventListener("click", verifyKey);
    $("sb-run").addEventListener("click", sandboxRun);
    $("ed-export").addEventListener("click", editorExport);
    applyEntitlements();
    renderHud();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else boot();
})(window);
