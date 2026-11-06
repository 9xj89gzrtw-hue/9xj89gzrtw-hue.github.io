/*
 * save.js — AI & Market Tycoon: сохранение прогресса.
 *
 * Схема v2 живёт под ключом algo_tycoon_v2. Мусор в localStorage никогда не
 * ломает игру: битый JSON — это новая игра, а не белый экран. Флаг Pro
 * дублируется в algo_tycoon_pro_v1, чтобы его видели другие окна.
 */
(function initSave(root) {
  "use strict";
  root.AT = root.AT || {};
  var E = root.AT.economy;

  var KEY = "algo_tycoon_v2";
  var PRO_KEY = "algo_tycoon_pro_v1";
  var OFFLINE_CAP_HOURS = 8;

  function store() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; }
    catch (e) { return null; }
  }

  /* Все поля, которые переживают перезагрузку. */
  function pick(s) {
    return {
      v: 2,
      balance: Math.max(0, Math.round(s.balance)),
      chapter: s.chapter,
      rep: s.rep,
      completed: s.completed,
      earned: s.earned,
      chapterEarned: s.chapterEarned,
      upgrades: s.upgrades,
      speed: s.speed,
      sandbox: !!s.sandbox,
      active: (s.active || []).map(function (a) {
        return { defId: a.defId, load: a.load, payout: a.payout, startedAt: a.startedAt, endsAt: a.endsAt };
      }),
      lastSave: Date.now()
    };
  }

  function load() {
    var s = E.create();
    var ls = store();
    if (!ls) return s;
    var raw = null;
    try { raw = ls.getItem(KEY); } catch (e) { return s; }
    if (!raw) return s;
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return s; }
    if (!obj || obj.v !== 2) return s;

    s.balance = Number(obj.balance) >= 0 ? Number(obj.balance) : s.balance;
    s.chapter = [1, 2, 3].indexOf(Number(obj.chapter)) >= 0 ? Number(obj.chapter) : 1;
    s.rep = Number(obj.rep) || 0;
    s.completed = Number(obj.completed) || 0;
    s.earned = Number(obj.earned) || 0;
    s.chapterEarned = Number(obj.chapterEarned) || 0;
    s.sandbox = !!obj.sandbox;
    s.speed = E.SPEEDS.indexOf(Number(obj.speed)) >= 0 ? Number(obj.speed) : 1;
    ["rack", "gpu", "sales", "team"].forEach(function (k) {
      var lvl = Number(obj.upgrades && obj.upgrades[k]) || 0;
      s.upgrades[k] = Math.max(0, Math.min(12, Math.floor(lvl)));
    });
    if (Array.isArray(obj.active)) {
      s.active = obj.active.filter(function (a) {
        return a && E.orderById(a.defId) && Number(a.endsAt) > 0;
      }).slice(0, 12).map(function (a) {
        return {
          defId: a.defId,
          load: Number(a.load) || 0,
          payout: Number(a.payout) || 0,
          startedAt: Number(a.startedAt) || Date.now(),
          endsAt: Number(a.endsAt) || Date.now()
        };
      });
    }
    s.lastSave = Number(obj.lastSave) || Date.now();
    try { if (ls.getItem(PRO_KEY) === "1") s.pro = true; } catch (e) { /* ignore */ }
    return s;
  }

  function save(s) {
    var ls = store();
    if (!ls) return false;
    try {
      ls.setItem(KEY, JSON.stringify(pick(s)));
      if (s.pro) ls.setItem(PRO_KEY, "1");
      return true;
    } catch (e) {
      return false;
    }
  }

  function wipe() {
    var ls = store();
    if (!ls) return;
    try {
      ls.removeItem(KEY);
      ls.removeItem(PRO_KEY);
    } catch (e) { /* ignore */ }
  }

  /* Сколько времени игрок отсутствовал (для сообщения о завершённых заказах). */
  function awayHours(s) {
    if (!s || !s.lastSave) return 0;
    return Math.min(OFFLINE_CAP_HOURS, Math.max(0, (Date.now() - s.lastSave) / 3600000));
  }

  root.AT.save = {
    fresh: function () { return E.create(); },
    load: load,
    save: save,
    wipe: wipe,
    awayHours: awayHours,
    KEY: KEY,
    PRO_KEY: PRO_KEY,
    OFFLINE_CAP_HOURS: OFFLINE_CAP_HOURS
  };
})(typeof window !== "undefined" ? window : globalThis);
