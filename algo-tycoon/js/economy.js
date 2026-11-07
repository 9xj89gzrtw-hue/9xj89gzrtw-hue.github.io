/*
 * economy.js — AI & Market Tycoon: вся экономика игры в одном месте.
 *
 * Чистые функции без DOM: их проверяет tests.js в браузере и в node.
 * Правила намеренно простые, чтобы игрок понял их за 10 секунд:
 *   • старт — 1 000 ₽ и одна серверная стойка на 100 нагрузки;
 *   • заказ занимает нагрузку и время, по завершении платит ₽;
 *   • репутация даёт бонус к оплате, апгрейды — нагрузку, скорость и цену;
 *   • глава закрыта, когда оборот главы дошёл до цели.
 */
(function initEconomy(root) {
  "use strict";
  root.AT = root.AT || {};
  var C = root.AT.content;

  var RATE = 90;                    // ₽ за $1 — курс для второй валюты
  var START_BALANCE = 1000;
  var BASE_CAPACITY = 100;
  var RACK_CAPACITY = 100;
  var REP_STEP = 0.005;             // +0.5% к оплате за единицу репутации
  var REP_CAP = 50;                 // дальше бонус не растёт (+25%)
  var SALES_STEP = 0.15;            // +15% к оплате за уровень отдела продаж
  var GPU_STEP = 0.8;               // −20% времени за уровень нейросети
  var TEAM_REP = 2;                 // +2 репутации за заказ с оператором
  var SANDBOX_BALANCE = 90000000;   // песочница: $1 000 000
  var SPEEDS = [1, 5, 10];

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function create(over) {
    var s = {
      v: 2,
      balance: START_BALANCE,
      chapter: 1,
      rep: 0,
      completed: 0,
      earned: 0,          // общий оборот за всё время
      chapterEarned: 0,   // оборот текущей главы
      upgrades: { rack: 0, gpu: 0, sales: 0, team: 0 },
      speed: 1,
      pro: false,
      sandbox: false,
      active: [],         // [{defId, load, payout, startedAt, endsAt}]
      crisis: null,       // {id, until, payMult, loadMult}
      lastSave: Date.now()
    };
    if (over) {
      Object.keys(over).forEach(function (k) {
        if (k === "upgrades") s.upgrades = Object.assign(s.upgrades, over.upgrades || {});
        else s[k] = over[k];
      });
    }
    return s;
  }

  function chapterById(id) {
    for (var i = 0; i < C.CHAPTERS.length; i += 1) {
      if (C.CHAPTERS[i].id === id) return C.CHAPTERS[i];
    }
    return C.CHAPTERS[0];
  }

  function orderById(id) {
    for (var i = 0; i < C.ORDERS.length; i += 1) {
      if (C.ORDERS[i].id === id) return C.ORDERS[i];
    }
    return null;
  }

  function upgradeById(id) {
    for (var i = 0; i < C.UPGRADES.length; i += 1) {
      if (C.UPGRADES[i].id === id) return C.UPGRADES[i];
    }
    return null;
  }

  /* Pro в памяти: настоящий ключ/оплата (s.pro), песочница или 60-секундный
     тест-драйв (s.preview). Превью не сохраняется на диск — см. app.js. */
  function isPro(s) { return !!(s && (s.pro || s.sandbox || s.preview)); }

  /* ---------- нагрузка ---------- */
  function loadMult(s, now) {
    var c = crisis(s, now);
    return c ? c.loadMult : 1;
  }

  function capacity(s, now) {
    var base = BASE_CAPACITY + (s.upgrades.rack || 0) * RACK_CAPACITY;
    return Math.round(base * loadMult(s, now));
  }

  function usedLoad(s) {
    return (s.active || []).reduce(function (sum, a) { return sum + Number(a.load || 0); }, 0);
  }

  function freeLoad(s, now) {
    return Math.max(0, capacity(s, now) - usedLoad(s));
  }

  /* ---------- оплата и время ---------- */
  function repBonus(s) { return Math.min(REP_CAP, Math.max(0, s.rep || 0)) * REP_STEP; }

  function crisis(s, now) {
    if (!s || !s.crisis) return null;
    var t = now == null ? Date.now() : now;
    if (s.crisis.until && s.crisis.until <= t) { s.crisis = null; return null; }
    return s.crisis;
  }

  function payoutFor(s, order, now) {
    if (!order) return 0;
    var sales = 1 + (s.upgrades.sales || 0) * SALES_STEP;
    var rep = 1 + repBonus(s);
    var c = crisis(s, now);
    var crisisMult = c ? Number(c.payMult || 1) : 1;
    return Math.max(1, Math.round(order.rub * sales * rep * crisisMult));
  }

  function durationMs(s, order) {
    if (!order) return 0;
    var gpu = Math.pow(GPU_STEP, s.upgrades.gpu || 0);
    var speed = SPEEDS.indexOf(s.speed) >= 0 ? s.speed : 1;
    return Math.max(600, Math.round((order.sec * 1000 * gpu) / speed));
  }

  /* ---------- витрина заказов ---------- */
  function isActive(s, defId) {
    return (s.active || []).some(function (a) { return a.defId === defId; });
  }

  function availableOrders(s) {
    return C.ORDERS.filter(function (o) {
      return o.chapter <= s.chapter && !isActive(s, o.id);
    });
  }

  /* Первый заказ, который реально влезает на стойку. Порядок — как в списке
     главы: игрок всегда понимает, что произойдёт по нажатию большой кнопки. */
  function recommended(s, now) {
    var room = freeLoad(s, now);
    var fits = availableOrders(s).filter(function (o) { return o.load <= room; });
    if (fits.length) return fits[0];
    /* Стойка забита — предлагаем самый лёгкий заказ, чтобы кнопка объяснила,
       чего не хватает, а не молчала. */
    var any = availableOrders(s).slice().sort(function (a, b) { return a.load - b.load; });
    return any[0] || null;
  }

  /* Принять заказ. Возвращает {ok, reason?, active?} */
  function accept(s, defId, now) {
    var order = orderById(defId);
    var t = now == null ? Date.now() : now;
    if (!order) return { ok: false, reason: "unknown_order" };
    if (order.chapter > s.chapter) return { ok: false, reason: "locked_chapter" };
    if (order.chapter === 3 && !isPro(s)) return { ok: false, reason: "pro_only" };
    if (isActive(s, defId)) return { ok: false, reason: "already_running" };
    if (order.load > freeLoad(s, t)) return { ok: false, reason: "no_room" };
    var active = {
      defId: defId,
      load: order.load,
      payout: payoutFor(s, order, t),
      startedAt: t,
      endsAt: t + durationMs(s, order)
    };
    s.active.push(active);
    return { ok: true, active: active };
  }

  /* Досчитать завершённые заказы. Мутирует состояние и возвращает события. */
  function tick(s, now) {
    var t = now == null ? Date.now() : now;
    var done = [];
    s.active = (s.active || []).filter(function (a) {
      if (a.endsAt > t) return true;
      var order = orderById(a.defId);
      s.balance += a.payout;
      s.earned += a.payout;
      s.chapterEarned += a.payout;
      s.completed += 1;
      s.rep += TEAM_REP + (s.upgrades.team || 0) * TEAM_REP;
      done.push({ defId: a.defId, title: order ? order.title : a.defId, payout: a.payout });
      return false;
    });
    return { completed: done, gained: done.reduce(function (x, d) { return x + d.payout; }, 0) };
  }

  /* ---------- главы ---------- */
  function chapterGoal(s) {
    return chapterById(s.chapter).goal;
  }

  function chapterProgress(s) {
    var goal = chapterGoal(s);
    if (!goal) return 100;
    return clamp((s.chapterEarned / goal) * 100, 0, 100);
  }

  function canAdvance(s) {
    var goal = chapterGoal(s);
    if (!goal) return false;
    if (s.chapterEarned < goal) return false;
    if (s.chapter >= 3) return false;
    if (s.chapter + 1 === 3 && !isPro(s)) return false;
    return true;
  }

  function advance(s) {
    if (!canAdvance(s)) return { ok: false, reason: s.chapter >= 3 ? "last_chapter" : "goal_not_reached" };
    s.chapter += 1;
    s.chapterEarned = 0;
    return { ok: true, chapter: s.chapter };
  }

  /* ---------- апгрейды ---------- */
  function upgradeCost(s, id) {
    var u = upgradeById(id);
    if (!u) return Infinity;
    var lvl = s.upgrades[id] || 0;
    if (lvl >= u.max) return Infinity;
    return Math.round(u.base * Math.pow(u.growth, lvl) / 10) * 10;
  }

  function buyUpgrade(s, id) {
    var u = upgradeById(id);
    if (!u) return { ok: false, reason: "unknown" };
    var lvl = s.upgrades[id] || 0;
    if (lvl >= u.max) return { ok: false, reason: "max_level" };
    var cost = upgradeCost(s, id);
    if (s.balance < cost) return { ok: false, reason: "no_money", cost: cost };
    s.balance -= cost;
    s.upgrades[id] = lvl + 1;
    return { ok: true, cost: cost, level: lvl + 1 };
  }

  /* ---------- скорость и песочница (Pro) ---------- */
  function setSpeed(s, speed) {
    var x = Number(speed);
    if (SPEEDS.indexOf(x) === -1) return { ok: false, reason: "bad_speed" };
    if (x > 1 && !isPro(s)) return { ok: false, reason: "pro_only" };
    s.speed = x;
    return { ok: true, speed: x };
  }

  function startSandbox(s, now) {
    if (!isPro(s)) return { ok: false, reason: "pro_only" };
    s.sandbox = true;
    s.balance = SANDBOX_BALANCE;
    s.chapter = 3;
    s.chapterEarned = 0;
    s.speed = s.speed > 1 ? s.speed : 5;
    s.active = [];
    s.crisis = null;
    return { ok: true, balance: s.balance, at: now == null ? Date.now() : now };
  }

  /* ---------- кризисы (Pro) ---------- */
  function crisisById(id) {
    for (var i = 0; i < C.CRISES.length; i += 1) {
      if (C.CRISES[i].id === id) return C.CRISES[i];
    }
    return null;
  }

  function applyCrisis(s, id, now) {
    if (!isPro(s)) return { ok: false, reason: "pro_only" };
    var c = crisisById(id);
    if (!c) return { ok: false, reason: "unknown_crisis" };
    var t = now == null ? Date.now() : now;
    if (c.finePct) {
      var fine = Math.round(s.balance * (c.finePct / 100));
      s.balance = Math.max(0, s.balance - fine);
      s.crisis = null;
      return { ok: true, crisis: c, fine: fine };
    }
    s.crisis = { id: c.id, until: t + c.sec * 1000, payMult: c.payMult, loadMult: c.loadMult };
    return { ok: true, crisis: c };
  }

  /* ---------- сводка ---------- */
  /* Доход в час — только по заказам, которые прямо сейчас крутятся на стойке.
     Пустая стойка = 0 ₽/час: цифра честная, а не прогноз «если всё занять». */
  function incomePerHour(s, now) {
    var perSec = 0;
    (s.active || []).forEach(function (a) {
      var ms = Math.max(600, Number(a.endsAt || 0) - Number(a.startedAt || 0));
      perSec += Number(a.payout || 0) / (ms / 1000);
    });
    return Math.round(perSec * 3600);
  }

  function stats(s, now) {
    var t = now == null ? Date.now() : now;
    var ch = chapterById(s.chapter);
    return {
      rub: s.balance,
      usd: s.balance / RATE,
      capacity: capacity(s, t),
      used: usedLoad(s),
      free: freeLoad(s, t),
      rep: s.rep,
      repBonusPct: Math.round(repBonus(s) * 100),
      chapter: s.chapter,
      chapterName: ch.name,
      chapterTag: ch.tag,
      goal: ch.goal,
      chapterEarned: s.chapterEarned,
      progress: chapterProgress(s),
      completed: s.completed,
      earned: s.earned,
      incomePerHour: incomePerHour(s, t),
      speed: s.speed,
      pro: isPro(s),
      sandbox: !!s.sandbox,
      active: (s.active || []).length,
      crisis: crisis(s, t)
    };
  }

  /* ---------- форматирование ---------- */
  function group(n) {
    var v = Math.round(Number(n) || 0);
    var s = String(Math.abs(v));
    var out = "";
    for (var i = 0; i < s.length; i += 1) {
      if (i > 0 && (s.length - i) % 3 === 0) out += "\u00A0";
      out += s[i];
    }
    return (v < 0 ? "−" : "") + out;
  }

  function fmtRub(n) { return group(n) + "\u00A0₽"; }

  function fmtUsd(n) {
    var v = Number(n) || 0;
    var abs = Math.abs(v);
    if (abs >= 1000) return "$" + group(v);
    return "$" + v.toFixed(2);
  }

  function fmtSec(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    return sec + " с";
  }

  root.AT.economy = {
    RATE: RATE,
    START_BALANCE: START_BALANCE,
    BASE_CAPACITY: BASE_CAPACITY,
    RACK_CAPACITY: RACK_CAPACITY,
    SANDBOX_BALANCE: SANDBOX_BALANCE,
    SPEEDS: SPEEDS,
    create: create,
    chapterById: chapterById,
    orderById: orderById,
    upgradeById: upgradeById,
    isPro: isPro,
    capacity: capacity,
    usedLoad: usedLoad,
    freeLoad: freeLoad,
    repBonus: repBonus,
    payoutFor: payoutFor,
    durationMs: durationMs,
    availableOrders: availableOrders,
    recommended: recommended,
    accept: accept,
    tick: tick,
    chapterGoal: chapterGoal,
    chapterProgress: chapterProgress,
    canAdvance: canAdvance,
    advance: advance,
    upgradeCost: upgradeCost,
    buyUpgrade: buyUpgrade,
    setSpeed: setSpeed,
    startSandbox: startSandbox,
    applyCrisis: applyCrisis,
    incomePerHour: incomePerHour,
    stats: stats,
    fmtRub: fmtRub,
    fmtUsd: fmtUsd,
    fmtSec: fmtSec,
    group: group
  };
})(typeof window !== "undefined" ? window : globalThis);
