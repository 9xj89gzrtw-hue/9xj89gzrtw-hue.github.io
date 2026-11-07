/*
 * tests.js — батарея проверок AI & Market Tycoon (?test=1).
 *
 * Проверяем не «красиво ли», а цифры: старт, оплату, нагрузку, главы,
 * апгрейды, кризисы, песочницу, сохранение и наличие всех узлов интерфейса,
 * на которые опирается js/app.js. Результат печатается в #t-cases и кладётся
 * в window.__RESULTS__.
 */
(function () {
  "use strict";
  if (location.search.indexOf("test=1") === -1) return;

  var AT = window.AT;
  var E = AT.economy;
  var C = AT.content;
  var results = [];
  var groups = 0;
  var queue = [];

  function ok(cond, msg) {
    results.push({ ok: !!cond, msg: msg });
    if (!cond) throw new Error("assert failed: " + msg);
  }
  function eq(a, b, msg) {
    ok(a === b, msg + " (получено " + JSON.stringify(a) + ", ожидалось " + JSON.stringify(b) + ")");
  }
  function near(a, b, tol, msg) {
    ok(Math.abs(a - b) <= tol, msg + " (получено " + a + ", ожидалось " + b + "±" + tol + ")");
  }
  function group(name, fn) {
    queue.push({ name: name, fn: fn });
  }

  /* ---------- содержание ---------- */
  group("содержание: 3 главы, 16 заказов, 4 апгрейда", function () {
    eq(C.CHAPTERS.length, 3, "три главы");
    eq(C.CHAPTERS.filter(function (c) { return c.free; }).length, 2, "две бесплатные главы");
    eq(C.CHAPTERS[2].free, false, "третья глава — Pro");
    ok(C.CHAPTERS[0].goal < C.CHAPTERS[1].goal, "цель второй главы выше первой");
    eq(C.ORDERS.length, 16, "шестнадцать заказов");
    eq(C.UPGRADES.length, 4, "четыре апгрейда");
    eq(C.CRISES.length, 3, "три кризиса");

    var ids = {};
    C.ORDERS.forEach(function (o) {
      ok(!ids[o.id], "id заказа уникален: " + o.id);
      ids[o.id] = 1;
      ok(o.rub > 0, "оплата > 0: " + o.id);
      ok(o.load > 0 && o.load <= 1000, "нагрузка в разумных пределах: " + o.id);
      ok(o.sec > 0, "время > 0: " + o.id);
      ok(o.chapter >= 1 && o.chapter <= 3, "глава заказа существует: " + o.id);
    });
    ok(C.ORDERS.some(function (o) { return /Спарсить 100 карточек WB/.test(o.title); }), "есть заказ на 100 карточек WB");
    ok(C.ORDERS.some(function (o) { return /Озвучить ролик нейросетью/.test(o.title); }), "есть заказ на озвучку");
    ok(C.ORDERS.some(function (o) { return /арбитражную сделку/.test(o.title); }), "есть арбитражный заказ");
  });

  /* ---------- старт ---------- */
  group("старт: 1 000 ₽ и одна стойка на 100 нагрузки", function () {
    var s = E.create();
    eq(s.balance, 1000, "баланс 1 000 ₽");
    eq(E.capacity(s), 100, "нагрузка 100");
    eq(E.usedLoad(s), 0, "нагрузка не занята");
    eq(s.chapter, 1, "первая глава");
    eq(s.speed, 1, "скорость x1");
    eq(s.active.length, 0, "нет активных заказов");
    eq(E.SANDBOX_BALANCE, 90000000, "песочница = $1 000 000 при курсе 90");
  });

  group("оплата: первый заказ «Спарсить 100 карточек WB» = 250 ₽", function () {
    var s = E.create();
    var o = E.orderById("o_wb_parse");
    ok(!!o, "заказ существует");
    eq(E.payoutFor(s, o), 250, "оплата 250 ₽ без бонусов");
    eq(E.recommended(s).id, "o_wb_parse", "большая кнопка предлагает первый заказ главы");
  });

  /* ---------- нагрузка ---------- */
  group("нагрузка: заказ занимает стойку и не берётся дважды", function () {
    var s = E.create();
    var now = 1000;
    var r = E.accept(s, "o_arb", now);
    ok(r.ok, "заказ на 70 нагрузки принят");
    eq(E.usedLoad(s), 70, "занято 70");
    eq(E.freeLoad(s, now), 30, "свободно 30");
    eq(E.accept(s, "o_arb", now).reason, "already_running", "повторный тот же заказ отклонён");
    eq(E.accept(s, "o_wb_parse", now).reason, "no_room", "заказ на 35 не влезает в 30");
    ok(E.accept(s, "o_tg_pack", now).ok === false, "на 40 нагрузки места нет");
  });

  group("нагрузка: две стойки дают 200 и два заказа параллельно", function () {
    var s = E.create({ balance: 10000, updates: 0 });
    s.upgrades.rack = 1;
    eq(E.capacity(s), 200, "200 нагрузки");
    ok(E.accept(s, "o_arb", 1000).ok, "первый заказ");
    ok(E.accept(s, "o_wb_parse", 1000).ok, "второй заказ");
    eq(E.usedLoad(s), 105, "занято 105");
  });

  /* ---------- завершение ---------- */
  group("заказ доезжает: деньги, репутация, счётчик", function () {
    var s = E.create();
    var t0 = 5000;
    E.accept(s, "o_wb_parse", t0);
    var dur = E.durationMs(s, E.orderById("o_wb_parse"));
    eq(dur, 6000, "6 секунд при x1");
    eq(E.tick(s, t0 + 1000).gained, 0, "рано — денег нет");
    var res = E.tick(s, t0 + dur);
    eq(res.gained, 250, "начислено 250 ₽");
    eq(s.balance, 1250, "баланс 1 250 ₽");
    eq(s.completed, 1, "один заказ сдан");
    eq(s.rep, 2, "репутация +2");
    eq(s.chapterEarned, 250, "оборот главы 250 ₽");
    eq(E.tick(s, t0 + dur + 5000).gained, 0, "второй раз не платит");
  });

  /* ---------- главы ---------- */
  group("главы: цель 25 000 ₽ закрывает первую", function () {
    var s = E.create();
    eq(E.chapterGoal(s), 25000, "цель главы 1");
    eq(E.canAdvance(s), false, "пока нельзя");
    s.chapterEarned = 24999;
    eq(E.canAdvance(s), false, "24 999 мало");
    s.chapterEarned = 25000;
    eq(E.canAdvance(s), true, "25 000 — можно");
    var r = E.advance(s);
    ok(r.ok, "глава открыта");
    eq(s.chapter, 2, "мы во второй главе");
    eq(s.chapterEarned, 0, "оборот главы обнулён");
    eq(E.chapterGoal(s), 250000, "цель главы 2");
  });

  group("глава 3 закрыта без Pro и открыта с Pro", function () {
    var s = E.create();
    eq(E.accept(s, "o_quant", 1000).reason, "locked_chapter", "без Pro заказ кластера не взять");
    s.chapter = 3;
    eq(E.accept(s, "o_quant", 1000).reason, "pro_only", "глава 3 требует Pro");
    s.pro = true;
    s.upgrades.rack = 4;
    ok(E.accept(s, "o_quant", 1000).ok, "с Pro заказ принят");
  });

  group("глава 3 не открывается переходом без Pro", function () {
    var s = E.create();
    s.chapter = 2;
    s.chapterEarned = 250000;
    eq(E.canAdvance(s), false, "без Pro третья глава не открывается");
    s.pro = true;
    eq(E.canAdvance(s), true, "с Pro открывается");
  });

  /* ---------- скорость ---------- */
  group("скорость: x5 и x10 только в Pro, время делится", function () {
    var s = E.create();
    eq(E.setSpeed(s, 5).reason, "pro_only", "x5 без Pro запрещён");
    eq(E.setSpeed(s, 10).reason, "pro_only", "x10 без Pro запрещён");
    eq(E.setSpeed(s, 7).reason, "bad_speed", "странная скорость отклонена");
    s.pro = true;
    ok(E.setSpeed(s, 5).ok, "x5 с Pro");
    var o = E.orderById("o_wb_parse");
    near(E.durationMs(s, o), 1200, 1, "6 с / 5 = 1.2 с");
    E.setSpeed(s, 10);
    near(E.durationMs(s, o), 600, 1, "6 с / 10 = 0.6 с");
    E.setSpeed(s, 1);
    eq(E.durationMs(s, o), 6000, "назад к 6 с");
  });

  /* ---------- апгрейды ---------- */
  group("апгрейды: стойка стоит 600 ₽, затем 960 ₽", function () {
    var s = E.create();
    eq(E.upgradeCost(s, "rack"), 600, "цена первой стойки");
    ok(E.buyUpgrade(s, "rack").ok, "за 1 000 ₽ стойка покупается");
    eq(s.balance, 400, "осталось 400 ₽");
    eq(E.upgradeCost(s, "rack"), 960, "вторая стойка — 960 ₽");
  });

  group("апгрейды: покупка списывает деньги и качает уровень", function () {
    var s = E.create({ balance: 5000 });
    var r = E.buyUpgrade(s, "rack");
    ok(r.ok, "стойка куплена");
    eq(r.cost, 600, "списано 600 ₽");
    eq(s.balance, 4400, "осталось 4 400 ₽");
    eq(s.upgrades.rack, 1, "уровень 1");
    eq(E.capacity(s), 200, "200 нагрузки");
    eq(E.upgradeCost(s, "rack"), 960, "следующая стойка дороже: 960 ₽");
  });

  group("апгрейды: нет денег — нет покупки", function () {
    var s = E.create({ balance: 100 });
    var r = E.buyUpgrade(s, "rack");
    eq(r.ok, false, "покупка отклонена");
    eq(r.reason, "no_money", "причина — нет денег");
    eq(s.balance, 100, "баланс не тронут");
    eq(s.upgrades.rack, 0, "уровень не вырос");
  });

  group("апгрейды: отдел продаж +15% к оплате", function () {
    var s = E.create({ balance: 10000 });
    E.buyUpgrade(s, "sales");
    eq(E.payoutFor(s, E.orderById("o_wb_parse")), 288, "250 × 1.15 = 288 ₽");
  });

  group("апгрейды: нейросеть ускоряет заказ на 20%", function () {
    var s = E.create({ balance: 10000 });
    E.buyUpgrade(s, "gpu");
    eq(E.durationMs(s, E.orderById("o_wb_parse")), 4800, "6 с → 4.8 с");
  });

  group("апгрейды: оператор даёт +2 репутации за заказ", function () {
    var s = E.create({ balance: 10000 });
    E.buyUpgrade(s, "team");
    E.accept(s, "o_wb_parse", 0);
    E.tick(s, 6000);
    eq(s.rep, 4, "2 базовых + 2 от оператора");
  });

  group("апгрейды: максимальный уровень закрывает покупку", function () {
    var s = E.create({ balance: 10000000 });
    for (var i = 0; i < 8; i += 1) E.buyUpgrade(s, "rack");
    eq(s.upgrades.rack, 8, "восемь уровней");
    eq(E.upgradeCost(s, "rack"), Infinity, "цена — бесконечность");
    eq(E.buyUpgrade(s, "rack").reason, "max_level", "дальше нельзя");
  });

  /* ---------- репутация ---------- */
  group("репутация: +0.5% к оплате за единицу, потолок +25%", function () {
    var s = E.create();
    var o = E.orderById("o_wb_parse");
    s.rep = 20;
    near(E.repBonus(s), 0.1, 1e-9, "20 репутации = +10%");
    eq(E.payoutFor(s, o), 275, "250 + 10% = 275 ₽");
    s.rep = 500;
    near(E.repBonus(s), 0.25, 1e-9, "потолок +25%");
    eq(E.payoutFor(s, o), 313, "250 + 25% = 313 ₽");
  });

  /* ---------- кризисы ---------- */
  group("кризисы: обвал рынка −35% на время", function () {
    var s = E.create({ pro: true });
    var o = E.orderById("o_wb_parse");
    eq(E.applyCrisis(s, "crash", 1000).ok, true, "кризис запущен");
    eq(E.payoutFor(s, o, 1500), 163, "250 × 0.65 = 163 ₽");
    eq(E.payoutFor(s, o, 1000 + 20001), 250, "через 20 с оплата снова полная");
  });

  group("кризисы: отключение стойки режет нагрузку вдвое", function () {
    var s = E.create({ pro: true });
    E.applyCrisis(s, "blackout", 1000);
    eq(E.capacity(s, 1500), 50, "100 → 50 нагрузки");
    eq(E.capacity(s, 1000 + 15001), 100, "через 15 с снова 100");
  });

  group("кризисы: налоговая списывает 10% один раз", function () {
    var s = E.create({ pro: true, balance: 5000 });
    var r = E.applyCrisis(s, "tax", 1000);
    ok(r.ok, "проверка запущена");
    eq(r.fine, 500, "штраф 500 ₽");
    eq(s.balance, 4500, "осталось 4 500 ₽");
    eq(s.crisis, null, "эффект не висит");
  });

  group("кризисы: без Pro не работают", function () {
    var s = E.create();
    eq(E.applyCrisis(s, "crash", 1000).reason, "pro_only", "кризисы только в Pro");
  });

  /* ---------- песочница ---------- */
  group("песочница: $1 000 000, глава 3, скорость x5", function () {
    var free = E.create();
    eq(E.startSandbox(free).reason, "pro_only", "без Pro песочницы нет");
    var s = E.create({ pro: true });
    var r = E.startSandbox(s);
    ok(r.ok, "песочница включена");
    eq(s.balance, 90000000, "90 000 000 ₽ = $1 000 000");
    eq(s.chapter, 3, "третья глава");
    eq(s.speed, 5, "скорость x5");
    eq(s.sandbox, true, "режим помечен");
  });

  /* ---------- доход в час ---------- */
  group("доход в час: 0 на пустой стойке и растёт с заказами", function () {
    var s = E.create();
    eq(E.incomePerHour(s, 1000), 0, "пустая стойка = 0 ₽/час");
    ok(E.accept(s, "o_wb_parse", 1000).ok, "первый заказ принят");
    var one = E.incomePerHour(s, 1000);
    ok(one > 0, "заказ на стойке даёт доход: " + one);
    s.upgrades.rack = 1;
    ok(E.accept(s, "o_voice", 1000).ok, "второй заказ принят");
    var two = E.incomePerHour(s, 1000);
    ok(two > one, "два заказа дают больше: " + two + " > " + one);
  });

  group("тест-драйв: preview открывает x5 и песочницу в памяти", function () {
    var s = E.create({ preview: true });
    ok(E.setSpeed(s, 5).ok, "x5 доступен в демо");
    ok(E.startSandbox(s).ok, "песочница доступна в демо");
    eq(s.sandbox, true, "режим помечен");
    eq(s.balance, 90000000, "баланс песочницы $1 000 000");
  });

  /* ---------- форматирование ---------- */
  group("формат: рубли с пробелами, доллары с точкой", function () {
    eq(E.fmtRub(1000), "1\u00A0000\u00A0₽", "1 000 ₽");
    eq(E.fmtRub(250), "250\u00A0₽", "250 ₽");
    eq(E.fmtRub(650000), "650\u00A0000\u00A0₽", "650 000 ₽");
    eq(E.fmtUsd(11.111), "$11.11", "$11.11");
    eq(E.fmtUsd(1.5), "$1.50", "$1.50");
    eq(E.fmtUsd(90000000 / 90), "$1\u00A0000\u00A0000", "песочница = $1 000 000");
    eq(E.fmtSec(6000), "6 с", "6 секунд");
  });

  /* ---------- сохранение ---------- */
  group("сохранение: прогресс переживает перезагрузку", function () {
    var s = E.create({ balance: 4321, chapter: 2, rep: 7, completed: 3 });
    s.upgrades.rack = 1;
    s.speed = 1;
    AT.save.save(s);
    var back = AT.save.load();
    eq(back.balance, 4321, "баланс на месте");
    eq(back.chapter, 2, "глава на месте");
    eq(back.rep, 7, "репутация на месте");
    eq(back.upgrades.rack, 1, "апгрейд на месте");
    AT.save.wipe();
  });

  group("сохранение: битый JSON не ломает игру", function () {
    try { localStorage.setItem(AT.save.KEY, "{это не json"); } catch (e) { }
    var s = AT.save.load();
    eq(s.balance, 1000, "новая игра вместо белого экрана");
    AT.save.wipe();
  });

  group("сохранение: старая схема v1 игнорируется", function () {
    try { localStorage.setItem(AT.save.KEY, JSON.stringify({ v: 1, credits: 999 })); } catch (e) { }
    var s = AT.save.load();
    eq(s.balance, 1000, "v1 не подмешивается");
    eq(AT.save.KEY, "algo_tycoon_v2", "ключ второй версии");
    AT.save.wipe();
  });

  /* ---------- прогон партии ---------- */
  group("партия: 20 заказов подряд без ухода в минус", function () {
    var s = E.create();
    var now = 0;
    for (var i = 0; i < 40; i += 1) {
      var rec = E.recommended(s, now);
      if (rec) E.accept(s, rec.id, now);
      now += 2000;
      E.tick(s, now);
    }
    ok(s.balance >= 1000, "баланс не ниже старта: " + s.balance);
    ok(s.completed >= 5, "сдано хотя бы 5 заказов: " + s.completed);
    ok(s.earned === s.balance - 1000 || s.earned > 0, "оборот накоплен: " + s.earned);
  });

  /* ---------- интерфейс ---------- */
  function registerDomGroups() {
    group("интерфейс: все узлы на месте", function () {
      var ids = [
        "tier-chip", "hud-rub", "hud-usd", "hud-load", "stat-rub", "stat-usd",
        "stat-income", "stat-rep", "stat-done", "load-fill", "active-list",
        "orders", "orders-count", "chapters", "chapter-fill", "chapter-next",
        "upgrades", "speed", "accept-top", "accept-hint", "pay-card-algo",
        "pro-modal", "key-in", "tx-in", "pro-status", "crises", "steps"
      ];
      ids.forEach(function (id) {
        ok(!!document.getElementById(id), "есть #" + id);
      });
    });

    group("интерфейс: большая кнопка зовёт первый заказ", function () {
      var btn = document.getElementById("accept-top");
      var txt = btn.textContent;
      var fresh = AT.app && AT.app.state().completed === 0;
      if (fresh) {
        ok(/Принять первый заказ/.test(txt), "кнопка: " + txt);
        ok(/\+250\u00A0₽/.test(txt), "в кнопке +250 ₽: " + txt);
      } else {
        ok(/Взять «/.test(txt), "кнопка предлагает следующий заказ: " + txt);
      }
      ok(/[\d]\u00A0₽/.test(txt), "в кнопке видна сумма в рублях: " + txt);
    });

    group("интерфейс: заказы, апгрейды и главы отрисованы", function () {
      ok(document.querySelectorAll("#orders .order").length >= 3, "минимум три заказа");
      eq(document.querySelectorAll("#upgrades .upgrade").length, 4, "четыре апгрейда");
      eq(document.querySelectorAll("#chapters .chapter").length, 3, "три главы");
      eq(document.querySelectorAll("#crises .crisis-btn").length, 3, "три кризиса");
      eq(document.querySelectorAll("#steps li").length, 4, "четыре шага инструкции");
    });

    group("интерфейс: Pro по умолчанию закрыт, ключ принимается", function () {
      var pro = document.body.classList.contains("pro");
      eq(pro, false, "на старте Free");
      eq(document.getElementById("tier-chip").textContent.trim(), "FREE", "чип FREE");
      ok(!!document.querySelector('[data-unlock][data-product="all-in-one"]'), "кнопка All-in-One есть");
      ok(!!document.querySelector('[data-shop-product="algo-tycoon"]'), "карта оплаты привязана к лоту");
    });

    group("интерфейс: один блок JSON-LD и правильные поля", function () {
      var blocks = document.querySelectorAll('script[type="application/ld+json"]');
      eq(blocks.length, 1, "ровно один блок");
      var doc = JSON.parse(blocks[0].textContent);
      var app = doc["@graph"].filter(function (n) { return n["@type"] === "SoftwareApplication"; })[0];
      ok(!!app, "SoftwareApplication описан");
      ok(app.featureList.length >= 3, "featureList ≥ 3");
      ok(app.offers.some(function (o) { return Number(o.price) > 0; }), "есть платное предложение");
      ok(/^https:\/\/9xj89gzrtw-hue\.github\.io/.test(app.url), "абсолютный url");
    });

    group("интерфейс: нет горизонтального скролла", function () {
      var doc = document.documentElement.scrollWidth;
      var win = window.innerWidth;
      ok(doc <= win + 1, "doc=" + doc + " win=" + win);
    });
  }

  function finish() {
    var pass = results.filter(function (r) { return r.ok; }).length;
    var fail = results.length - pass;
    window.__RESULTS__ = { groups: groups, total: results.length, pass: pass, fail: fail, results: results };

    var sum = document.getElementById("t-sum");
    var box = document.getElementById("t-cases");
    if (sum) sum.textContent = "групп: " + groups + " · проверок: " + results.length + " · ok: " + pass + " · fail: " + fail;
    if (box) {
      box.innerHTML = "";
      results.forEach(function (r) {
        var d = document.createElement("div");
        d.className = "t-case" + (r.ok ? "" : " bad");
        d.textContent = (r.ok ? "ok   " : "FAIL ") + r.msg;
        box.appendChild(d);
      });
    }
    document.body.classList.add("testing");
  }

  function run() {
    registerDomGroups();
    /* Группы идут подряд; упавшая группа не останавливает остальные. */
    queue.forEach(function (g) {
      groups += 1;
      try { g.fn(); } catch (e) {
        results.push({ ok: false, msg: "группа «" + g.name + "» упала: " + (e && e.message ? e.message : e) });
      }
    });
    finish();
  }

  function start() {
    /* Ждём следующий макрокадр: приложение успевает отрендерить первый экран
       из DOMContentLoaded, и проверки видят уже живую страницу. */
    setTimeout(function () {
      try { run(); } catch (e) {
        results.push({ ok: false, msg: "батарея упала: " + (e && e.message ? e.message : e) });
        finish();
      }
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
