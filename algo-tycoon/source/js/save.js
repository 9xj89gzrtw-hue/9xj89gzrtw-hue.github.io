/*
 * save.js — Algo Tycoon persistence & offline earnings.
 * Save shape v1 under localStorage key algo_tycoon_v1. The Pro entitlement is
 * also mirrored to algo_tycoon_pro_v1 for cross-window readouts.
 */
(function initSave(root) {
  "use strict";
  root.AT = root.AT || {};

  var KEY = "algo_tycoon_v1";
  var PRO_KEY = "algo_tycoon_pro_v1";
  var COMPILER_RATE_PER_HOUR = 3;
  var OFFLINE_CAP_HOURS = 8;

  function fresh() {
    return {
      v: 1,
      credits: 0,
      solved: [],       // job ids, in order solved
      research: [],     // researched node ids
      compilers: 0,
      pro: false,       // sandbox + editor entitlement
      sourcePro: false, // source-zip entitlement
      lastSave: Date.now()
    };
  }

  function load() {
    var s = fresh();
    try {
      var raw = null;
      if (typeof localStorage !== "undefined") raw = localStorage.getItem(KEY);
      if (!raw) return s;
      var obj = JSON.parse(raw);
      if (obj && obj.v === 1) {
        s.credits = Number(obj.credits) || 0;
        s.solved = Array.isArray(obj.solved) ? obj.solved.slice(0, 64) : [];
        s.research = Array.isArray(obj.research) ? obj.research.slice(0, 32) : [];
        s.compilers = Number(obj.compilers) || 0;
        s.pro = !!obj.pro;
        s.sourcePro = !!obj.sourcePro;
        s.lastSave = Number(obj.lastSave) || Date.now();
      }
      if (typeof localStorage !== "undefined" && localStorage.getItem(PRO_KEY) === "1") s.pro = true;
    } catch (e) { /* corrupted save: start clean, never crash */ }
    return s;
  }

  /* Research effects reduced to a table used by game.js */
  function effects(state) {
    var e = { payoutPct: 0, slots: 0, compilers: state.compilers || 0 };
    root.AT.levels.RESEARCH.forEach(function (r) {
      if (state.research.indexOf(r.id) !== -1) {
        if (r.effect.payoutPct) e.payoutPct += r.effect.payoutPct;
        if (r.effect.slots) e.slots += r.effect.slots;
      }
    });
    return e;
  }

  function offlineEarnings(state) {
    var e = effects(state);
    var hours = Math.max(0, Math.min(OFFLINE_CAP_HOURS, (Date.now() - state.lastSave) / 3600000));
    return { credits: Math.floor(hours * COMPILER_RATE_PER_HOUR * e.compilers), hours: hours, compilers: e.compilers };
  }

  function save(state) {
    state.lastSave = Date.now();
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(KEY, JSON.stringify(state));
        if (state.pro) localStorage.setItem(PRO_KEY, "1");
      }
    } catch (e) { /* storage full/private mode: play persists in memory */ }
  }

  function wipe() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(KEY);
        localStorage.removeItem(PRO_KEY);
      }
    } catch (e) { /* ignore */ }
  }

  root.AT.save = {
    fresh: fresh,
    load: load,
    save: save,
    wipe: wipe,
    effects: effects,
    offlineEarnings: offlineEarnings,
    KEY: KEY,
    PRO_KEY: PRO_KEY,
    COMPILER_RATE_PER_HOUR: COMPILER_RATE_PER_HOUR,
    OFFLINE_CAP_HOURS: OFFLINE_CAP_HOURS
  };
})(typeof window !== "undefined" ? window : globalThis);
