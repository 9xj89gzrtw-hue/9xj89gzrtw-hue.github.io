/*
 * app.js — AI & Market Tycoon: интерфейс.
 *
 * Один цикл на 120 мс: досчитать завершённые заказы, обновить числа и полоски.
 * Всё остальное — рендер по состоянию из js/economy.js. Никаких таймеров на
 * каждый заказ: игрок может свернуть вкладку, а заказы всё равно доедут.
 */
(function initApp(root) {
  "use strict";
  var E = root.AT.economy;
  var C = root.AT.content;
  var S = root.AT.save;
  var P = root.AT.pay;

  var state = null;
  var el = {};
  var lastSaveAt = 0;
  var shownFlash = 0;
  var previewSnapshot = null;   // прогресс до 60-сек тест-драйва
  var demoUsedPro = false;      // в демо нажали x5/x10 или песочницу

  function $(id) { return document.getElementById(id); }

  /* Настоящий Pro: оплата, ключ TW1 или universal-запись. Превью сюда не
     входит — иначе тест-драйв сохранился бы на диск как покупка. */
  function realPro() {
    if (state && state.pro) return true;
    if (!root.Unlock) return false;
    var rec = root.Unlock.state("algo-tycoon");
    if (rec && rec.hash) return true;
    return !!(root.Unlock.hasUniversal && root.Unlock.hasUniversal());
  }

  function previewActive() {
    return !!(root.Unlock && root.Unlock.isPreview && root.Unlock.isPreview("algo-tycoon"));
  }

  /* Интерфейс Pro: реальный ключ ИЛИ 60-секундный тест-драйв. */
  function proActive() { return realPro() || previewActive(); }

  function syncPro() {
    if (!state) return;
    state.pro = realPro();
    state.preview = previewActive();
  }

  function save() {
    syncPro();
    /* Демо живёт только в памяти вкладки: ни прогресс, ни флаг Pro не пишем. */
    if (previewActive()) { lastSaveAt = Date.now(); return; }
    S.save(state);
    lastSaveAt = Date.now();
  }

  function snapshotState() {
    return JSON.parse(JSON.stringify({
      balance: state.balance, chapter: state.chapter, rep: state.rep,
      completed: state.completed, earned: state.earned, chapterEarned: state.chapterEarned,
      upgrades: state.upgrades, speed: state.speed, sandbox: state.sandbox,
      active: state.active, crisis: state.crisis
    }));
  }

  function restoreState(snap) {
    Object.keys(snap).forEach(function (k) { state[k] = snap[k]; });
  }

  /* ---------- отрисовка ---------- */

  function renderAll() {
    var st = E.stats(state);
    paintHeader(st);
    paintStats(st);
    paintLoad(st);
    paintActive();
    paintOrders();
    paintChapter(st);
    paintUpgrades(st);
    paintCrises();
    paintSpeed();
    paintPro();
    paintVip(st);
  }

  function paintHeader(st) {
    el.hudRub.textContent = E.fmtRub(st.rub);
    el.hudUsd.textContent = "≈ " + E.fmtUsd(st.usd);
    el.hudLoad.textContent = E.group(st.used) + " / " + E.group(st.capacity);
    el.tier.textContent = st.pro ? "PRO" : "FREE";
    el.tier.className = "chip mono" + (st.pro ? " chip-pro" : "");
  }

  function paintStats(st) {
    el.statRub.textContent = E.fmtRub(st.rub);
    el.statUsd.textContent = "≈ " + E.fmtUsd(st.usd);
    el.statIncome.textContent = E.group(st.incomePerHour) + " ₽/час";
    if (el.statIncomeNote) {
      el.statIncomeNote.textContent = st.active > 0
        ? "по заказам, которые сейчас на стойке"
        : "стойка простаивает — возьмите заказ";
    }
    el.statRep.textContent = E.group(st.rep);
    el.statRepNote.textContent = "бонус к оплате +" + st.repBonusPct + "%";
    el.statDone.textContent = E.group(st.completed);
    el.statTotal.textContent = "оборот " + E.fmtRub(st.earned);
    el.chapterTag.textContent = st.chapterTag + " · " + st.chapterName;
  }

  /* VIP-тикер: появляется после третьего сданного заказа и всё время висит
     в правой колонке. Это не попап и не оверлей — обычный блок в потоке. */
  function paintVip(st) {
    if (!el.vipTicker) return;
    var show = st.completed >= 3;
    el.vipTicker.hidden = !show;
    if (!show) return;
    el.vipTicker.classList.toggle("is-pro", st.pro);
    if (el.vipDemo) {
      el.vipDemo.hidden = st.pro;
      el.vipDemo.disabled = st.pro;
    }
    if (el.vipBuy) el.vipBuy.textContent = st.pro ? "Pro уже открыт" : "🔓 Открыть VIP за 149 ₽";
  }

  function paintLoad(st) {
    var pct = st.capacity ? Math.min(100, (st.used / st.capacity) * 100) : 0;
    el.loadFill.style.width = pct.toFixed(1) + "%";
    el.loadFill.parentNode.className = "loadbar" + (pct >= 99 ? " is-full" : pct >= 60 ? " is-hot" : "");
    el.loadLabel.textContent = E.group(st.used) + " / " + E.group(st.capacity) + " нагрузки";
    var free = st.free;
    if (st.crisis) {
      var cName = crisisName(st.crisis.id) || "рынок штормит";
      var loadDown = Number(st.crisis.loadMult) < 1;
      el.dashNote.textContent = loadDown
        ? "Кризис «" + cName + "»: мощность стоек урезана на время."
        : "Кризис «" + cName + "»: заказы платят меньше, пока он не кончится.";
      el.dashNote.className = "dash-note is-warn";
    } else if (free <= 0) {
      el.dashNote.textContent = "Стойка забита. Ждём, пока заказы доедут, или покупаем ещё стойку.";
      el.dashNote.className = "dash-note is-warn";
    } else if (st.active > 0) {
      el.dashNote.textContent = "Свободно " + E.group(free) + " нагрузки — можно взять ещё заказ.";
      el.dashNote.className = "dash-note";
    } else {
      el.dashNote.textContent = "Стойка свободна — можно брать заказ.";
      el.dashNote.className = "dash-note";
    }
  }

  var activeSig = "";

  function paintActive() {
    var list = state.active || [];
    var now = Date.now();
    var sig = list.map(function (a) { return a.defId + ":" + a.endsAt; }).join("|");

    /* Пересобираем DOM только когда набор заказов правда изменился:
       иначе полоски перезапускали бы анимацию появления 8 раз в секунду. */
    if (sig !== activeSig) {
      activeSig = sig;
      el.activeList.innerHTML = "";
      if (!list.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.id = "active-empty";
        empty.textContent = "Пока ничего не выполняется. Возьмите заказ ниже — прогресс появится здесь.";
        el.activeList.appendChild(empty);
      }
      list.forEach(function (a) {
        var def = E.orderById(a.defId);
        var row = document.createElement("div");
        row.className = "job";
        row.setAttribute("data-job", a.defId);
        row.innerHTML =
          '<div class="job-top"><span class="job-title"></span><span class="job-pay">+' + E.fmtRub(a.payout) + "</span></div>" +
          '<div class="job-meta"><span class="job-client"></span><span class="job-left mono"></span></div>' +
          '<div class="job-bar"><span></span></div>';
        row.querySelector(".job-title").textContent = def ? def.title : a.defId;
        row.querySelector(".job-client").textContent = def ? def.client : "";
        el.activeList.appendChild(row);
      });
    }

    list.forEach(function (a) {
      var row = el.activeList.querySelector('[data-job="' + a.defId + '"]');
      if (!row) return;
      var total = Math.max(1, a.endsAt - a.startedAt);
      var left = Math.max(0, a.endsAt - now);
      row.querySelector(".job-left").textContent = "осталось " + E.fmtSec(left);
      row.querySelector(".job-bar span").style.width = (((total - left) / total) * 100).toFixed(1) + "%";
    });
  }

  function paintOrders() {
    var st = E.stats(state);
    var node = el.orders;
    node.innerHTML = "";

    /* Сначала текущая глава, затем уже открытые заказы прошлых глав. */
    var list = E.availableOrders(state);
    el.ordersCount.textContent = String(list.length);

    if (!list.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Все заказы главы уже на стойке. Ещё чуть-чуть — и деньги придут.";
      node.appendChild(p);
      return;
    }

    list.forEach(function (o) {
      var pay = E.payoutFor(state, o);
      var sec = E.durationMs(state, o);
      var running = (state.active || []).some(function (a) { return a.defId === o.id; });
      var fits = o.load <= st.free;
      var card = document.createElement("div");
      card.className = "order" + (running ? " is-locked" : "");
      card.setAttribute("data-order", o.id);

      var info = document.createElement("div");
      info.className = "info";
      info.innerHTML =
        '<div class="order-title"><span class="title"></span> ' +
        '<span class="tag' + (o.chapter === state.chapter ? " is-hot" : "") + '">' + chapterLabel(o.chapter) + "</span></div>" +
        '<div class="order-meta"><span class="client"></span>' +
        "<span>нагрузка <b>" + E.group(o.load) + "</b></span>" +
        "<span>время <b>" + E.fmtSec(sec) + "</b></span></div>";
      info.querySelector(".title").textContent = o.title;
      info.querySelector(".client").textContent = o.client;

      var right = document.createElement("div");
      right.className = "order-right";
      var payEl = document.createElement("span");
      payEl.className = "order-pay";
      payEl.textContent = "+" + E.fmtRub(pay);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn primary order-btn" + (running ? " is-running" : "");
      btn.setAttribute("data-accept", o.id);
      if (running) {
        btn.textContent = "Уже в работе";
        btn.disabled = true;
      } else if (!fits) {
        btn.textContent = "Нет места";
        btn.disabled = false;
        btn.classList.remove("primary");
        btn.setAttribute("data-no-room", "1");
      } else {
        btn.textContent = "Взять заказ";
      }
      right.appendChild(payEl);
      right.appendChild(btn);

      card.appendChild(info);
      card.appendChild(right);
      node.appendChild(card);
    });
  }

  function chapterLabel(id) {
    if (id === 3) return "Pro";
    return "глава " + id;
  }

  function crisisName(id) {
    for (var i = 0; i < C.CRISES.length; i += 1) if (C.CRISES[i].id === id) return C.CRISES[i].name;
    return "";
  }

  function paintChapter(st) {
    el.chapterGoal.textContent = st.goal ? "цель " + E.fmtRub(st.goal) : "песочница";
    var pct = st.goal ? st.progress : 100;
    el.chapterFill.style.width = pct.toFixed(1) + "%";
    el.chapterLabel.textContent = st.goal
      ? E.fmtRub(st.chapterEarned) + " из " + E.fmtRub(st.goal)
      : "открыт кластер: " + E.fmtRub(st.rub);

    el.chapters.innerHTML = "";
    C.CHAPTERS.forEach(function (ch) {
      var locked = ch.id === 3 && !st.pro;
      var current = ch.id === st.chapter;
      var card = document.createElement("div");
      card.className = "chapter" + (current ? " is-current" : "") + (locked ? " is-locked" : "");
      var status = locked ? "Pro" : current ? "вы здесь" : ch.id < st.chapter ? "пройдена" : "дальше";
      card.innerHTML =
        '<div class="chapter-tag"></div><div class="chapter-name"></div>' +
        '<div class="chapter-sub"></div><div class="chapter-goal mono"></div>' +
        '<div class="tag' + (locked ? " is-pro" : "") + '">' + status + "</div>";
      card.querySelector(".chapter-tag").textContent = ch.tag;
      card.querySelector(".chapter-name").textContent = ch.name;
      card.querySelector(".chapter-sub").textContent = ch.sub;
      card.querySelector(".chapter-goal").textContent = ch.goal ? "цель " + E.fmtRub(ch.goal) : "песочница $1 000 000";
      var tagEl = card.querySelector(".tag");
      tagEl.textContent = status;
      tagEl.className = "tag" + (locked ? " is-pro" : "");
      el.chapters.appendChild(card);
    });

    var can = E.canAdvance(state);
    el.chapterNext.hidden = !can;
    if (can) el.chapterNext.textContent = "Открыть главу " + (state.chapter + 1) + " →";
  }

  function paintUpgrades(st) {
    el.upgrades.innerHTML = "";
    C.UPGRADES.forEach(function (u) {
      var lvl = state.upgrades[u.id] || 0;
      var maxed = lvl >= u.max;
      var cost = E.upgradeCost(state, u.id);
      var row = document.createElement("div");
      row.className = "upgrade" + (maxed ? " is-max" : "");
      row.innerHTML =
        '<div><div class="upgrade-name"></div><div class="upgrade-desc"></div></div>' +
        '<div class="upgrade-right"><span class="upgrade-lvl mono"></span>' +
        '<span class="upgrade-cost"></span><button class="btn primary" type="button"></button></div>';
      row.querySelector(".upgrade-name").textContent = u.name;
      row.querySelector(".upgrade-desc").textContent = u.desc;
      row.querySelector(".upgrade-lvl").textContent = lvl + "/" + u.max;
      row.querySelector(".upgrade-cost").textContent = maxed ? "макс" : E.fmtRub(cost);
      var btn = row.querySelector("button");
      btn.setAttribute("data-upgrade", u.id);
      if (maxed) {
        btn.textContent = "Максимум";
        btn.disabled = true;
        btn.classList.remove("primary");
      } else if (st.rub < cost) {
        btn.textContent = "Не хватает";
        btn.disabled = true;
        btn.classList.remove("primary");
      } else {
        btn.textContent = "Купить";
      }
      el.upgrades.appendChild(row);
    });
  }

  function paintCrises() {
    el.crises.innerHTML = "";
    C.CRISES.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn crisis-btn";
      b.setAttribute("data-crisis", c.id);
      b.innerHTML = "<span></span><small></small>";
      b.querySelector("span").textContent = c.name;
      b.querySelector("small").textContent = c.desc;
      el.crises.appendChild(b);
    });
  }

  function paintSpeed() {
    Array.prototype.forEach.call(el.speed.querySelectorAll("[data-speed]"), function (b) {
      var x = Number(b.getAttribute("data-speed"));
      b.classList.toggle("is-on", state.speed === x);
      b.classList.toggle("is-locked", x > 1 && !proActive());
    });
  }

  function paintPro() {
    var pro = proActive();
    document.body.classList.toggle("pro", pro);
    el.tier.textContent = pro ? "PRO" : "FREE";
    el.tier.className = "chip mono" + (pro ? " chip-pro" : "");
    el.payCard.hidden = pro;
    el.payUsdc.hidden = pro;
    el.payCard2.hidden = pro;
    el.openPro.textContent = pro ? "Pro активен — ключ принят" : "У меня уже есть ключ TW1-…";
    el.sandboxNote.textContent = state.sandbox
      ? "Песочница включена: баланс $1 000 000. Основной прогресс сохранён отдельно."
      : "Песочница не трогает основной прогресс: это отдельный режим для экспериментов.";
  }

  function flash(text) {
    var item = document.createElement("div");
    item.className = "flash-item";
    item.textContent = text;
    el.flash.appendChild(item);
    shownFlash += 1;
    if (shownFlash > 3) {
      while (el.flash.firstChild && el.flash.childNodes.length > 3) el.flash.removeChild(el.flash.firstChild);
    }
    setTimeout(function () {
      item.style.transition = "opacity .4s ease";
      item.style.opacity = "0";
      setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 420);
    }, 5200);
  }

  /* ---------- действия ---------- */

  function acceptOrder(defId) {
    var res = E.accept(state, defId, Date.now());
    if (!res.ok) {
      if (res.reason === "no_room") flash("Стойка занята — сначала дождитесь заказа или купите стойку.");
      else if (res.reason === "pro_only") { flash("Глава 3 открывается в Pro."); openPro(); }
      else if (res.reason === "already_running") flash("Этот заказ уже в работе.");
      else flash("Этот заказ сейчас недоступен.");
      return;
    }
    save();
    renderAll();
    paintBigButton();
  }

  function paintBigButton() {
    var rec = E.recommended(state);
    var st = E.stats(state);
    if (!rec) {
      el.acceptTop.textContent = "Стойка занята — заказы доезжают";
      el.acceptTop.disabled = true;
      el.acceptHint.textContent = "Подождите пару секунд: заказ вернётся в список, как только освободится место.";
      return;
    }
    var fits = rec.load <= st.free;
    var pay = E.payoutFor(state, rec);
    if (!fits) {
      el.acceptTop.textContent = "⏳ Нет места — купите стойку";
      el.acceptTop.disabled = false;
      el.acceptHint.textContent = "Заказ «" + rec.title + "» ждёт: нужно " + E.group(rec.load) + " нагрузки.";
      return;
    }
    el.acceptTop.disabled = false;
    if (state.completed === 0) {
      el.acceptTop.textContent = "Принять первый заказ (+" + E.fmtRub(pay) + ")";
    } else {
      el.acceptTop.textContent = "Взять «" + rec.title + "» (+" + E.fmtRub(pay) + ")";
    }
    el.acceptHint.textContent = "Нагрузка " + E.group(rec.load) + " · время " + E.fmtSec(E.durationMs(state, rec)) + " · оплата сразу на счёт.";
  }

  function buyUpgrade(id) {
    var res = E.buyUpgrade(state, id);
    if (!res.ok) {
      if (res.reason === "no_money") flash("Не хватает " + E.fmtRub(res.cost - state.balance) + " — возьмите ещё заказ.");
      else flash("Дальше улучшать некуда: уровень максимальный.");
      return;
    }
    flash("Апгрейд куплен: " + E.upgradeById(id).name + " · уровень " + res.level);
    save();
    renderAll();
    paintBigButton();
  }

  function nextChapter() {
    var res = E.advance(state);
    if (!res.ok) {
      if (res.reason === "goal_not_reached") flash("Сначала закройте цель главы.");
      return;
    }
    flash("Глава " + res.chapter + " открыта: " + E.chapterById(res.chapter).name);
    save();
    renderAll();
    paintBigButton();
  }

  function setSpeed(x) {
    var res = E.setSpeed(state, x);
    if (!res.ok) {
      if (res.reason === "pro_only") { flash("Ускорение x5 и x10 — в Pro."); openPro(); }
      return;
    }
    if (previewActive() && x > 1) demoUsedPro = true;
    save();
    paintSpeed();
    paintBigButton();
  }

  function runSandbox() {
    var res = E.startSandbox(state);
    if (!res.ok) { openPro(); return; }
    if (previewActive()) demoUsedPro = true;
    flash("Песочница включена: $1 000 000 на счету, глава 3 открыта. Экспериментируйте.");
    save();
    renderAll();
    paintBigButton();
  }

  function runCrisis(id) {
    var res = E.applyCrisis(state, id, Date.now());
    if (!res.ok) {
      if (res.reason === "pro_only") { flash("Кризисы — инструмент Pro."); openPro(); }
      return;
    }
    var c = res.crisis;
    if (res.fine) {
      el.crisisOut.textContent = "«" + c.name + "»: штраф −" + E.fmtRub(res.fine) + ". Баланс: " + E.fmtRub(state.balance) + ".";
    } else {
      el.crisisOut.textContent = "«" + c.name + "» запущен на " + c.sec + " с. Смотрите, как падает доход.";
    }
    flash("Кризис: " + c.name);
    save();
    renderAll();
  }

  function reportJson() {
    var st = E.stats(state);
    var data = {
      game: "AI & Market Tycoon",
      version: 2,
      at: new Date().toISOString(),
      stats: st,
      upgrades: state.upgrades,
      chapters: C.CHAPTERS.map(function (c) { return { id: c.id, name: c.name, goal: c.goal }; }),
      active: state.active
    };
    download("ai-market-tycoon-report.json", JSON.stringify(data, null, 2), "application/json");
  }

  function reportCsv() {
    var st = E.stats(state);
    var rows = [
      ["metric", "value"],
      ["balance_rub", st.rub],
      ["balance_usd", st.usd.toFixed(2)],
      ["earned_rub", st.earned],
      ["orders_done", st.completed],
      ["chapter", st.chapter],
      ["chapter_name", st.chapterName],
      ["reputation", st.rep],
      ["capacity", st.capacity],
      ["income_per_hour_rub", st.incomePerHour],
      ["speed", st.speed],
      ["pro", st.pro ? 1 : 0]
    ];
    download("ai-market-tycoon-report.csv", rows.map(function (r) { return r.join(","); }).join("\n"), "text/csv");
  }

  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type + ";charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      flash("Файл " + name + " готов.");
    } catch (e) {
      flash("Браузер не дал скачать файл — скопируйте данные вручную.");
    }
  }

  /* ---------- Pro и оплата ---------- */

  function openPro() { el.modal.classList.remove("hidden"); }
  function closePro() { el.modal.classList.add("hidden"); }

  function verifyKey() {
    var raw = (el.keyIn.value || "").trim();
    if (!raw) { el.proStatus.textContent = "Вставьте ключ TW1-… из письма или с экрана после оплаты."; return; }
    if (/^TW1-/i.test(raw)) {
      if (!root.Unlock || !root.Unlock.verifyLicenseKey) {
        el.proStatus.textContent = "Проверка ключа не загрузилась — обновите страницу.";
        return;
      }
      el.proStatus.textContent = "Проверяю подпись ключа…";
      root.Unlock.verifyLicenseKey(raw, { product: "algo-tycoon" }).then(function (lic) {
        if (lic && lic.valid) {
          state.pro = true;
          save();
          paintPro();
          renderAll();
          paintBigButton();
          el.proStatus.textContent = "Ключ принят (" + lic.code + "). Pro открыт навсегда, работает офлайн.";
        } else {
          var map = {
            format: "это не ключ TW1 — скопируйте строку целиком",
            signature: "подпись не сходится: ключ обрезан или изменён",
            product: "ключ от другого продукта — для всего набора нужен TW1-ALL",
            crypto: "браузер отказал в проверке подписи — откройте страницу по https"
          };
          el.proStatus.textContent = "Ключ не принят: " + (map[lic && lic.error] || "неизвестная ошибка");
        }
      }, function (e) { el.proStatus.textContent = "Не удалось проверить ключ: " + e.message; });
      return;
    }
    el.proStatus.textContent = "Проверяю старый ключ LC1…";
    P.verifyLicense(raw).then(function (r) {
      if (r.ok) {
        state.pro = true;
        save();
        paintPro();
        renderAll();
        paintBigButton();
        el.proStatus.textContent = "Старый ключ принят. Pro открыт.";
      } else {
        el.proStatus.textContent = "Ключ не принят: " + (r.reason || "неизвестная ошибка");
      }
    });
  }

  function verifyTx() {
    var tx = (el.txIn.value || "").trim();
    if (!P.isHexTx(tx)) { el.proStatus.textContent = "Это не хеш перевода: нужен 0x и 64 символа."; return; }
    el.proStatus.textContent = "Проверяю перевод в сети Base…";
    P.verifyBaseUSDCPayment({ txHash: tx, amountUSD: P.PRICE_PRO }).then(function (r) {
      if (r.ok) {
        state.pro = true;
        save();
        paintPro();
        renderAll();
        paintBigButton();
        el.proStatus.textContent = "Оплата найдена: " + r.amountUSDC + " USDC, блок " + r.blockNumber + ". Pro открыт.";
      } else {
        el.proStatus.textContent = "Не подтверждено: " + r.reason;
      }
    });
  }

  function mountOneClick() {
    if (!root.Unlock || !root.Unlock.mountOneClick) return;
    var opts = {
      product: "algo-tycoon",
      price: P.PRICE_PRO,
      note: el.payHint,
      onError: function (msg) { el.proStatus.textContent = msg || ""; },
      onDone: function (r) {
        state.pro = true;
        save();
        paintPro();
        renderAll();
        paintBigButton();
        el.proStatus.textContent = "Оплачено в 1 клик: " + (Number(r.received) / 1e6).toFixed(2) + " USDC подтверждено в Base.";
      }
    };
    try { root.Unlock.mountOneClick(el.payUsdc, opts); } catch (e) { /* кошелька нет — кнопка просто не активна */ }
    try { root.Unlock.mountOneClick(el.pay1click, opts); } catch (e) { /* то же */ }
  }

  /* ---------- цикл ---------- */

  var proCheckedAt = 0;

  function loop() {
    if (!state) return;
    if (Date.now() - proCheckedAt > 400) {
      proCheckedAt = Date.now();
      if (proActive() !== document.body.classList.contains("pro")) {
        paintPro();
        paintSpeed();
        renderAll();
        paintBigButton();
      }
    }
    var res = E.tick(state, Date.now());
    if (res.completed.length) {
      res.completed.forEach(function (d) { flash("+ " + E.fmtRub(d.payout) + " — «" + d.title + "» сдан"); });
      renderAll();
      paintBigButton();
      save();
      return;
    }
    var st = E.stats(state);
    paintHeader(st);
    paintLoad(st);
    paintActive();
    if (Date.now() - lastSaveAt > 4000) save();
  }

  /* ---------- запуск ---------- */

  function bind() {
    el = {
      hudRub: $("hud-rub"), hudUsd: $("hud-usd"), hudLoad: $("hud-load"), tier: $("tier-chip"),
      statRub: $("stat-rub"), statUsd: $("stat-usd"), statIncome: $("stat-income"),
      statIncomeNote: $("stat-income-note"),
      statRep: $("stat-rep"), statRepNote: $("stat-rep-note"), statDone: $("stat-done"),
      statTotal: $("stat-total"), chapterTag: $("chapter-tag"),
      loadFill: $("load-fill"), loadLabel: $("dash-load-label"), dashNote: $("dash-note"),
      activeList: $("active-list"), flash: $("flash"), orders: $("orders"), ordersCount: $("orders-count"),
      chapters: $("chapters"), chapterFill: $("chapter-fill"), chapterLabel: $("chapter-progress-label"),
      chapterGoal: $("chapter-goal"), chapterNext: $("chapter-next"),
      upgrades: $("upgrades"), upgradesHint: $("upgrades-hint"),
      speed: $("speed"), acceptTop: $("accept-top"), acceptHint: $("accept-hint"),
      payCard: $("pay-card-algo"), payUsdc: $("pay-usdc"), openPro: $("open-pro"),
      payCard2: document.querySelector('#pro-modal [data-shop-product="algo-tycoon"]'),
      sandboxStart: $("sandbox-start"), sandboxNote: $("sandbox-note"),
      vipTicker: $("vip-ticker"), vipBuy: $("vip-buy"), vipDemo: $("vip-demo"),
      crises: $("crises"), crisisOut: $("crisis-out"),
      reportJson: $("report-json"), reportCsv: $("report-csv"), reset: $("reset"),
      steps: $("steps"), modal: $("pro-modal"), modalClose: $("modal-close"),
      keyIn: $("key-in"), txIn: $("tx-in"), proStatus: $("pro-status"),
      tabTx: $("tab-tx-btn"), tabKey: $("tab-key-btn"),
      pay1click: $("pay-1click"), payHint: $("pay-1click-hint")
    };

    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-accept],[data-upgrade],[data-crisis],[data-speed]") : null;
      if (t) {
        if (t.hasAttribute("data-accept")) acceptOrder(t.getAttribute("data-accept"));
        else if (t.hasAttribute("data-upgrade")) buyUpgrade(t.getAttribute("data-upgrade"));
        else if (t.hasAttribute("data-crisis")) runCrisis(t.getAttribute("data-crisis"));
        else if (t.hasAttribute("data-speed")) setSpeed(t.getAttribute("data-speed"));
        return;
      }
      if (e.target.closest && e.target.closest("#accept-top")) {
        var rec = E.recommended(state);
        if (rec) acceptOrder(rec.id);
        return;
      }
    });

    el.chapterNext.addEventListener("click", nextChapter);
    el.sandboxStart.addEventListener("click", runSandbox);
    el.reportJson.addEventListener("click", reportJson);
    el.reportCsv.addEventListener("click", reportCsv);
    el.reset.addEventListener("click", function () {
      if (root.confirm && !root.confirm("Начать заново? Текущий прогресс удалится.")) return;
      S.wipe();
      state = E.create();
      save();
      renderAll();
      paintBigButton();
      flash("Новая игра: 1 000 ₽ и одна серверная стойка.");
    });

    el.openPro.addEventListener("click", openPro);
    el.tier.addEventListener("click", openPro);
    el.modalClose.addEventListener("click", closePro);
    el.modal.addEventListener("click", function (e) { if (e.target === el.modal) closePro(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePro(); });
    el.tabKey.addEventListener("click", verifyKey);
    el.tabTx.addEventListener("click", verifyTx);
    el.keyIn.addEventListener("keydown", function (e) { if (e.key === "Enter") verifyKey(); });
    el.txIn.addEventListener("keydown", function (e) { if (e.key === "Enter") verifyTx(); });

    C.STEPS.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      el.steps.appendChild(li);
    });

    document.addEventListener("unlock:changed", function (e) {
      var nowPreview = previewActive();
      var wasPreview = !!state.preview;
      if (nowPreview && !wasPreview) {
        previewSnapshot = snapshotState();
        demoUsedPro = false;
        flash("Тест-драйв Pro на 60 секунд: доступны x5, песочница $1 000 000 и глава 3.");
      } else if (!nowPreview && wasPreview) {
        var usedProFeatures = demoUsedPro || state.sandbox || state.speed > 1;
        if (previewSnapshot) { restoreState(previewSnapshot); previewSnapshot = null; }
        demoUsedPro = false;
        syncPro();
        save();
        renderAll();
        paintBigButton();
        flash(usedProFeatures
          ? "Тест-драйв закончился. Песочница и x5 остались в демо — полный Pro навсегда за 149 ₽."
          : "Тест-драйв закончился. Полный Pro — 149 ₽, прогресс не потерян.");
        if (!realPro()) {
          el.proStatus.textContent = usedProFeatures
            ? "Вы попробовали песочницу и ускорение. Полный ключ Pro навсегда — 149 ₽: карта РФ / СБП или USDC на Base."
            : "Тест-драйв закончился. Полный ключ Pro навсегда — 149 ₽: карта РФ / СБП или USDC на Base.";
          openPro();
        }
        return;
      }
      syncPro();
      paintPro();
      paintSpeed();
      renderAll();
      paintBigButton();
    });

    if (el.vipBuy) el.vipBuy.addEventListener("click", openPro);
    if (el.vipDemo) el.vipDemo.addEventListener("click", function () {
      if (!root.Unlock || !root.Unlock.startPreview) { openPro(); return; }
      root.Unlock.startPreview("algo-tycoon", 60);
      flash("Тест-драйв Pro включён на 60 секунд: x5, песочница и глава 3.");
      paintPro();
      paintSpeed();
      renderAll();
      paintBigButton();
    });

    mountOneClick();
  }

  function boot() {
    state = S.load();
    bind();
    /* Небольшой read-only API для тестов и для отладки в консоли. */
    root.AT.app = {
      state: function () { return state; },
      stats: function () { return E.stats(state); },
      accept: acceptOrder,
      save: save
    };
    var away = S.awayHours(state);
    var res = E.tick(state, Date.now());
    if (res.completed.length) {
      flash("Пока вас не было (" + away.toFixed(1) + " ч), заказы доехали: +" + E.fmtRub(res.gained));
    }
    paintPro();
    renderAll();
    paintBigButton();
    save();
    setInterval(loop, 120);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
