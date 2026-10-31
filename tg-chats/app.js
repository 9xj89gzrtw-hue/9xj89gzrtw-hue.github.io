/* TG Chat Validator — the catalogue is embedded, the checker reads public
   t.me pages in the browser. No account, no server, no stored lists. */
(function () {
  "use strict";

  var PRODUCT = "tgchats";
  var PRICE = 9;
  var FREE_ROWS = 25;
  var FREE_CHECKS = 10;
  var PRO_CHECKS = 50;

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var DATA = window.CHAT_CATALOG || { count: 0, chats: [], generated_at: "" };
  var TOPICS = ["Все", "Разработка", "Данные и ИИ", "Дизайн и продукт", "Маркетинг", "Бизнес", "Работа и карьера", "Образование", "Город и соседи", "Общение"];

  var state = { topic: "Все", city: "", query: "", sort: "members", view: "base", checking: false };

  function isPro() { return !!(window.Unlock && window.Unlock.isPro(PRODUCT)); }
  function toast(msg, bad) { if (window.Unlock) window.Unlock.toast(msg, bad); }
  function esc(s) { return String(s == null ? "" : s); }
  function fmt(n) { return Number(n || 0).toLocaleString("ru-RU"); }
  function dateShort(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  /* ---------------------------------------------------------------- catalogue */

  function filtered() {
    var q = state.query.trim().toLowerCase();
    return DATA.chats.filter(function (c) {
      if (state.topic !== "Все" && c.topic !== state.topic) return false;
      if (state.city && c.city !== state.city) return false;
      if (!q) return true;
      return (c.title + " " + c.about + " " + c.username + " " + c.topic + " " + c.city).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) {
      if (state.sort === "title") return a.title.localeCompare(b.title, "ru");
      if (state.sort === "fresh") return String(b.checked_at).localeCompare(String(a.checked_at));
      return b.members - a.members;
    });
  }

  function renderTopics() {
    var host = $("#topics");
    host.innerHTML = "";
    var counts = {};
    DATA.chats.forEach(function (c) { counts[c.topic] = (counts[c.topic] || 0) + 1; });
    TOPICS.forEach(function (topic) {
      var n = topic === "Все" ? DATA.chats.length : (counts[topic] || 0);
      if (!n) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", state.topic === topic ? "true" : "false");
      b.textContent = topic;
      var span = document.createElement("span");
      span.className = "count";
      span.textContent = n;
      b.appendChild(span);
      b.addEventListener("click", function () {
        state.topic = topic;
        renderTopics();
        renderRows();
      });
      host.appendChild(b);
    });
  }

  function renderCities() {
    var sel = $("#city");
    var cities = {};
    DATA.chats.forEach(function (c) { if (c.city) cities[c.city] = (cities[c.city] || 0) + 1; });
    var list = Object.keys(cities).sort(function (a, b) { return cities[b] - cities[a] || a.localeCompare(b, "ru"); });
    sel.innerHTML = '<option value="">Все города</option>';
    list.forEach(function (city) {
      var o = document.createElement("option");
      o.value = city;
      o.textContent = city + " (" + cities[city] + ")";
      sel.appendChild(o);
    });
    sel.value = state.city;
  }

  function rowMeta(c) {
    var meta = document.createElement("div");
    meta.className = "row-meta";
    var parts = [c.topic, c.city, fmt(c.members) + " участников"];
    parts.filter(Boolean).forEach(function (text, i) {
      if (i) {
        var sep = document.createElement("span");
        sep.textContent = "·";
        meta.appendChild(sep);
      }
      var s = document.createElement("span");
      s.textContent = text;
      meta.appendChild(s);
    });
    return meta;
  }

  function renderRows() {
    var list = $("#rows");
    var all = filtered();
    var pro = isPro();
    var shown = pro ? all : all.slice(0, FREE_ROWS);
    list.innerHTML = "";

    shown.forEach(function (c) {
      var li = document.createElement("li");
      li.className = "result-row";

      var chat = document.createElement("div");
      chat.className = "cell-chat";
      var title = document.createElement("div");
      title.className = "chat-title";
      var a = document.createElement("a");
      a.href = c.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = c.title;
      title.appendChild(a);
      var handle = document.createElement("div");
      handle.className = "chat-handle";
      handle.textContent = "@" + c.username;
      chat.appendChild(title);
      chat.appendChild(handle);
      chat.appendChild(rowMeta(c));

      var topic = document.createElement("div");
      topic.className = "cell-topic";
      topic.textContent = c.topic;

      var city = document.createElement("div");
      city.className = "cell-city";
      city.textContent = c.city || "—";

      var members = document.createElement("div");
      members.className = "cell-members num";
      members.textContent = fmt(c.members);

      var date = document.createElement("div");
      date.className = "cell-date num";
      date.textContent = dateShort(c.checked_at);

      var open = document.createElement("a");
      open.className = "row-open";
      open.href = c.link;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Открыть";

      li.appendChild(chat);
      li.appendChild(topic);
      li.appendChild(city);
      li.appendChild(members);
      li.appendChild(date);
      li.appendChild(open);
      list.appendChild(li);
    });

    $("#empty-row").hidden = all.length !== 0;
    $("#limit-bar").hidden = pro || all.length <= FREE_ROWS;
    $("#limit-text").textContent = "Показаны первые " + FREE_ROWS + " из " + all.length + " чатов по этому фильтру.";

    var badge = $("#visible-badge");
    badge.textContent = pro ? fmt(all.length) + " чатов" : fmt(shown.length) + " из " + fmt(all.length);
    badge.className = "badge" + (!pro && all.length > FREE_ROWS ? " badge-warn" : "");
    $("#check-quota").textContent = (isPro() ? PRO_CHECKS : FREE_CHECKS) + " ссылок за раз";
  }

  function download(format) {
    var all = filtered();
    var pro = isPro();
    var rows = pro ? all : all.slice(0, FREE_ROWS);
    if (!rows.length) { toast("Нет строк для выгрузки", true); return; }
    var table = [["Название", "Ссылка", "Тематика", "Город", "Участники", "Проверен", "Описание"]];
    rows.forEach(function (c) {
      table.push([c.title, c.link, c.topic, c.city || "", c.members, dateShort(c.checked_at), c.about || ""]);
    });
    var stamp = new Date().toISOString().slice(0, 10);
    if (format === "xlsx") {
      window.XLSX.download(table, "telegram-chats-" + stamp + ".xlsx", "Chats");
      toast("Выгружено " + rows.length + " строк");
      return;
    }
    var csv = table.map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "telegram-chats-" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast("Выгружено " + rows.length + " строк");
    if (!pro && all.length > FREE_ROWS) toast("В Pro — все " + all.length + " строк", false);
  }

  /* ---------------------------------------------------------------- checker */

  var READER = "https://r.jina.ai/";
  var calls = [];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function gate() {
    for (;;) {
      var now = Date.now();
      while (calls.length && now - calls[0] > 60000) calls.shift();
      if (calls.length < 16) { calls.push(now); return; }
      await sleep(60000 - (Date.now() - calls[0]) + 250);
    }
  }

  function parseLinks(text) {
    var out = [];
    var seen = {};
    String(text).split(/[\s,;]+/).forEach(function (token) {
      var m = token.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?([A-Za-z0-9_]{4,64})\/?$/) ||
              token.match(/^@([A-Za-z0-9_]{4,64})$/);
      if (!m) return;
      var u = m[1].toLowerCase();
      if (u === "s" || u === "joinchat" || seen[u]) return;
      seen[u] = true;
      out.push(m[1]);
    });
    return out;
  }

  function classifyPage(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var titleEl = doc.querySelector('meta[property="og:title"]');
    var descEl = doc.querySelector('meta[property="og:description"]');
    var title = titleEl ? titleEl.getAttribute("content") : "";
    var desc = descEl ? descEl.getAttribute("content") : "";
    var extraEl = doc.querySelector(".tgme_page_extra");
    var extra = extraEl ? extraEl.textContent.trim() : "";
    var actionEl = doc.querySelector(".tgme_page_action");
    var action = actionEl ? actionEl.textContent.trim().toLowerCase() : "";
    var members = 0;
    var m = extra.match(/([\d\s\u00a0]+)\s*(members|subscribers|участник|подписчик)/i);
    if (m) members = parseInt(m[1].replace(/\D/g, ""), 10) || 0;

    if (!title || /^telegram:\s*contact/i.test(title)) return { status: "missing", title: "", members: 0 };
    if (/subscriber|подписчик/i.test(extra)) return { status: "channel", title: title, members: members };
    if (/request|заявк/i.test(action + " " + desc)) return { status: "request", title: title, members: members };
    if (/member|участник/i.test(extra)) return { status: "open", title: title, members: members };
    return { status: "unknown", title: title, members: members };
  }

  function statusLabel(status) {
    return {
      open: "Открытый чат",
      channel: "Канал, не чат",
      request: "Вступление по заявке",
      missing: "Ссылка не работает",
      unknown: "Не удалось определить",
      error: "Не удалось проверить"
    }[status] || status;
  }

  function addCheckRow(username, status, title, members) {
    var li = document.createElement("li");
    li.className = "check-row";
    var dot = document.createElement("span");
    dot.className = "dot " + (status === "open" ? "ok" : status === "channel" || status === "request" ? "warn" : status === "error" ? "" : "bad");
    var name = document.createElement("span");
    name.className = "check-name";
    var b = document.createElement("b");
    b.textContent = title || "@" + username;
    name.appendChild(b);
    if (title) name.appendChild(document.createTextNode("  @" + username));
    var st = document.createElement("span");
    st.className = "check-status-text";
    st.textContent = statusLabel(status);
    var mem = document.createElement("span");
    mem.className = "check-members";
    mem.textContent = members ? fmt(members) + " участн." : "";
    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(st);
    li.appendChild(mem);
    $("#check-results").appendChild(li);
  }

  async function checkOne(username) {
    await gate();
    var res = await fetch(READER + "https://t.me/" + encodeURIComponent(username), {
      headers: { "x-respond-with": "html" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return classifyPage(await res.text());
  }

  async function runCheck() {
    if (state.checking) return;
    var links = parseLinks($("#check-input").value);
    var limit = isPro() ? PRO_CHECKS : FREE_CHECKS;
    if (!links.length) { toast("Вставьте хотя бы одну ссылку t.me/… или @username", true); return; }
    if (links.length > limit) {
      toast("За раз можно проверить " + limit + " ссылок. " + (isPro() ? "" : "Pro поднимает лимит до 50."), true);
      links = links.slice(0, limit);
    }
    state.checking = true;
    $("#check-results").innerHTML = "";
    var btn = $("#check-run");
    btn.disabled = true;
    btn.textContent = "Проверяем…";

    var done = 0;
    var promiseQueue = [];
    for (var i = 0; i < links.length; i++) {
      (function (username) {
        promiseQueue.push(
          checkOne(username).then(function (r) {
            addCheckRow(username, r.status, r.title, r.members);
          }).catch(function () {
            addCheckRow(username, "error", "", 0);
          }).then(function () {
            done++;
            $("#check-status").textContent = "Проверено " + done + " из " + links.length + "…";
          })
        );
      })(links[i]);
      if (promiseQueue.length >= 2) { await Promise.all(promiseQueue.splice(0)); }
    }
    await Promise.all(promiseQueue);

    state.checking = false;
    btn.disabled = false;
    btn.textContent = "Проверить";
    var tokens = $("#check-input").value.split(/[\s,;]+/).filter(Boolean);
    var skipped = Math.max(0, tokens.length - links.length);
    var n = links.length;
    var tail = n % 10 === 1 && n % 100 !== 11 ? "ссылка" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "ссылки" : "ссылок");
    var note = "Готово: " + n + " " + tail + ".";
    if (skipped) note += " Пропущено строк: " + skipped + " — приглашения t.me/+… и текст без юзернейма проверить нельзя.";
    $("#check-status").textContent = note;
  }

  /* ---------------------------------------------------------------- views */

  function setView(view, scroll) {
    state.view = view;
    $$(".tab[data-view]").forEach(function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-view") === view ? "true" : "false");
    });
    $("#view-base").hidden = view !== "base";
    $("#view-check").hidden = view !== "check";
    $$(".catalog-only").forEach(function (el) { el.hidden = view === "check"; });
    if (view === "check") {
      setTimeout(function () { $("#check-input").focus(); }, 50);
    }
    if (scroll) $("#catalog").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function init() {
    $("#stat-count").textContent = fmt(DATA.count);
    $("#stat-topics").textContent = String(new Set(DATA.chats.map(function (c) { return c.topic; })).size);
    $("#stat-cities").textContent = String(new Set(DATA.chats.map(function (c) { return c.city; }).filter(Boolean)).size);
    $("#stat-date").textContent = DATA.generated_at ? dateShort(DATA.generated_at) : "—";
    $("#hero-count").textContent = "Проверено вручную · " + dateShort(DATA.generated_at);

    renderCities();
    renderTopics();
    renderRows();

    $("#q").addEventListener("input", function (e) { state.query = e.target.value; renderRows(); });
    $("#city").addEventListener("change", function (e) { state.city = e.target.value; renderRows(); });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; renderRows(); });
    $("#reset-filters").addEventListener("click", function () {
      state.query = ""; state.city = ""; state.topic = "Все";
      $("#q").value = ""; $("#city").value = "";
      renderTopics(); renderRows();
    });

    $$(".tab[data-view]").forEach(function (t) {
      t.addEventListener("click", function () { setView(t.getAttribute("data-view"), false); });
    });
    $$("[data-view-link]").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); setView(a.getAttribute("data-view-link"), true); });
    });
    $("#hero-check").addEventListener("click", function () { setView("check", true); });
    $("#check-run").addEventListener("click", runCheck);

    $("#dl-csv").addEventListener("click", function () { download("csv"); });
    $("#dl-xlsx").addEventListener("click", function () {
      if (!isPro()) {
        toast("XLSX входит в Pro. CSV можно скачать бесплатно.", true);
        var b = document.querySelector('#view-base [data-unlock]');
        if (b) b.click();
        return;
      }
      download("xlsx");
    });

    document.addEventListener("unlock:changed", function () { renderRows(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
