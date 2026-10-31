/*
 * content.js — injected bridge (isolated world). Installs at most once per
 * tab and answers popup requests. All page analysis happens here.
 * Message protocol (chrome.runtime.onMessage):
 *   {t:"detect"}                     -> {cards, tables}
 *   {t:"extract", recipe, roles, maxRows} -> ClipEngine.extractRows result
 *   {t:"tables", maxRows}            -> ClipEngine.extractTables result
 *   {t:"autoscroll", recipe, roles, maxRows} -> progress events + final rows
 *   {t:"stop"}                       -> stops an in-flight autoscroll
 */
(function (global) {
  "use strict";
  if (global.__DCLIP_BRIDGE__) return; // idempotent re-injection
  global.__DCLIP_BRIDGE__ = true;

  var scrollJob = null;

  function reply(send, payload) {
    try { send(payload); } catch (e) { /* tab navigated away */ }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    var E = global.ClipEngine;
    if (!E) { reply(sendResponse, { t: "error", reason: "engine not loaded" }); return; }
    if (msg.t === "detect") {
      reply(sendResponse, { t: "detected", cards: E.findCardGroups(document), tables: E.extractTables(3) });
      return false;
    }
    if (msg.t === "extract") {
      reply(sendResponse, { t: "rows", result: E.extractRows(msg.recipe, msg.roles, msg.maxRows) });
      return false;
    }
    if (msg.t === "tables") {
      reply(sendResponse, { t: "tableRows", result: E.extractTables(msg.maxRows) });
      return false;
    }
    if (msg.t === "stop") {
      if (scrollJob) { scrollJob.stopFlag = true; }
      reply(sendResponse, { t: "stopAck" });
      return false;
    }
    if (msg.t === "autoscroll") {
      if (scrollJob) { reply(sendResponse, { t: "error", reason: "already running" }); return false; }
      scrollJob = { stopFlag: false };
      runAutoScroll(msg, scrollJob, sendResponse);
      return true; // async
    }
    return false;
  });

  /* Auto-scroll harvest (Pro flow): scroll by viewport steps, wait for lazy
   * DOM growth, harvest rows when finished. Emits progress via runtime
   * sendMessage; the final (single) response goes through sendResponse. */
  function runAutoScroll(msg, job, sendResponse) {
    var E = global.ClipEngine;
    var maxRows = msg.maxRows || 1000;
    var stepPause = 350;
    var maxIdleTurns = 2;
    var idleTurns = 0;
    var lastHeight = 0;

    function finishedNaturally() {
      var se = document.scrollingElement || document.documentElement;
      if (se.scrollHeight === lastHeight) idleTurns += 1;
      else idleTurns = 0;
      lastHeight = se.scrollHeight;
      var atBottom = se.scrollTop + se.clientHeight >= se.scrollHeight - 8;
      return idleTurns >= maxIdleTurns && atBottom;
    }

    function tick() {
      if (job.stopFlag) {
        scrollJob = null;
        reply(sendResponse, { t: "aborted" }); // final (single) response
        return;
      }
      var soFar = E.matchCount(msg.recipe);
      push({ t: "progress", rows: soFar });
      if (soFar >= maxRows || finishedNaturally()) {
        var out = E.extractRows(msg.recipe, msg.roles, maxRows);
        reply(sendResponse, { t: "rows", result: out }); // final (single) response
        scrollJob = null;
        return;
      }
      var se = document.scrollingElement || document.documentElement;
      se.scrollBy(0, Math.max(200, Math.round(window.innerHeight * 0.8)));
      setTimeout(tick, stepPause);
    }
    setTimeout(tick, 50);
  }

  /* Fire-and-forget progress channel (sendResponse is single-use in MV3). */
  function push(payload) {
    try { chrome.runtime.sendMessage(payload, function () { void chrome.runtime.lastError; }); } catch (e) { /* popup closed */ }
  }
})(window);
