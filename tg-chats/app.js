/* TG Chat Validator — the catalogue is embedded, the checker reads public
   t.me pages in the browser. No account, no server, no stored lists. */
(function () {
  "use strict";

  var PRODUCT = "tgchats";
  var PRICE = 9;
  var FREE_CHECKS = 10;
  var PRO_CHECKS = 50;
  var AHA_LIMIT = 10;
  var AHA_PREVIEW_ROWS = 5;
  var FULL_XLSX_NAME = "telegram-chats-full-nov2026.xlsx";

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* Receipt link (?key=TW1-… / #key=TW1-…&download=xlsx) is read now,
     before Unlock.autoActivateFromUrl strips it from the address bar. */
  var URL_PARAMS = (function () {
    try {
      if (window.Unlock && window.Unlock.readUrlParams) return window.Unlock.readUrlParams();
      var search = new URLSearchParams(window.location.search || "");
      var hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
      return {
        key: (search.get("key") || hash.get("key") || "").trim(),
        download: (search.get("download") || hash.get("download") || "").trim().toLowerCase(),
        pack: (search.get("pack") || hash.get("pack") || "").trim().toLowerCase()
      };
    } catch (e) { return { key: "", download: "", pack: "" }; }
  })();

  var DATA = window.CHAT_CATALOG || { count: 0, chats: [], generated_at: "", total: 0 };
  var TOTAL = DATA.total || DATA.count || DATA.chats.length;
  var TOPICS = [
    { value: "Все", label: "Все" },
    { value: "Маркетплейсы WB/Ozon", label: "Селлеры WB/Ozon" },
    { value: "Закупки/Опт", label: "Закупки и Опт" },
    { value: "Логистика/Карго", label: "Логистика и Карго" },
    { value: "IT/Фриланс", label: "IT и Фриланс" },
    { value: "Недвижимость/Ремонт", label: "Недвижимость и ЖК" },
    { value: "Локальные услуги/Города", label: "Услуги и Города" },
    { value: "Крипто/Web3", label: "Крипто/Web3" },
    { value: "Образование/Школы", label: "Образование/Школы" },
    { value: "Авто/Спецтехника", label: "Авто/Спецтехника" }
  ];

  var state = {
    topic: "Все", city: "", query: "", sort: "members", view: "base", checking: false,
    urlKeyPresent: !!URL_PARAMS.key,
    urlDownload: URL_PARAMS.download || "",
    urlPack: URL_PARAMS.pack || "",
    sessionLicense: false,
    autoDownloaded: false
  };

  /* Digiseller lots 6378375 (WB/Ozon), 6378421 (IT/Фриланс) and 12 (B2B stores)
     deliver a ready-made Excel pack instead of re-building the chats file.
     `?key=TW1-TG-...&pack=b2b-stores&download=xlsx` downloads that exact file
     after Pro is on — no modal, no extra click. Pack unlocks the full
     1 500+ chats base on the same page. */
  var PACK_FILES = {
    "b2b-stores": "b2b-ecommerce-stores-nov2026.xlsx",
    "b2b": "b2b-ecommerce-stores-nov2026.xlsx",
    "wb-sellers": "tg-chats-wb-ozon-opt-cargo.xlsx",
    "wb": "tg-chats-wb-ozon-opt-cargo.xlsx",
    "freelance-it": "tg-chats-it-freelance-realty.xlsx",
    "freelance": "tg-chats-it-freelance-realty.xlsx",
    "realty-jk": "tg-chats-realty-jk-msk-spb.xlsx",
    "realty": "tg-chats-realty-jk-msk-spb.xlsx"
  };

  /* Rubric packs are cut from the full base by exact topic, not by a loose
     regex: a seller who bought "WB/Ozon + опт + карго" must receive every one
     of those 234 chats and nothing unrelated. */
  var PACK_TOPICS = {
    "wb-sellers": ["Маркетплейсы WB/Ozon", "Закупки/Опт", "Логистика/Карго"],
    "freelance-it": ["IT/Фриланс", "Недвижимость/Ремонт"]
  };


  function isPro() { return !!(window.Unlock && window.Unlock.isPro(PRODUCT)); }

  /* Aha-пейволл включается, когда человек начал искать: ввёл запрос, выбрал
     тему или город. В бесплатной части видно 10 лучших совпадений, дальше —
     живые строки полной базы под маской и кнопка покупки. */
  function isAhaMode() {
    if (isPro()) return false;
    return !!(state.query.trim() || state.city || state.topic !== "Все");
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* The demo must not decrypt the paid pack: `isPro()` is true for the 60 s
     preview, but the AES key is only reachable after a real entitlement. */
  function hasRealPro() {
    var rec = window.Unlock && window.Unlock.state(PRODUCT);
    return !!(rec && rec.hash);
  }
  function canLoadPack() {
    if (!isPro()) return false;
    if (window.Unlock && window.Unlock.isPreview && window.Unlock.isPreview(PRODUCT) && !hasRealPro()) return false;
    return true;
  }
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

  /* Counts above the table come from catalog.js (generated by Agent 4):
     h1, hero lede and pricing cards share the same TOTAL and categoryTotals,
     so they can never disagree with the "Все (N)" chip. */
  function syncCounts() {
    var fullCounts = DATA.categoryTotals || DATA.categories || {};
    var counts = {};
    (DATA.chats || []).forEach(function (c) { counts[c.topic] = (counts[c.topic] || 0) + 1; });
    $$("[data-total-chats]").forEach(function (el) { el.textContent = fmt(TOTAL); });
    $$("[data-cat-count]").forEach(function (el) {
      var key = el.getAttribute("data-cat-count");
      var n = fullCounts[key] != null ? fullCounts[key] : (counts[key] || 0);
      if (n != null) el.textContent = fmt(n);
    });
  }

  function renderTopics() {
    var host = $("#topics");
    host.innerHTML = "";
    var counts = {};
    DATA.chats.forEach(function (c) { counts[c.topic] = (counts[c.topic] || 0) + 1; });
    /* The free catalog ships only 35 rows, but the tabs must promise the
       full base (catalog.js categories), not the free slice: a buyer who
       taps "IT/Фриланс (1)" thinks the full base has one IT chat. */
    var fullCounts = DATA.categoryTotals || DATA.categories || {};
    TOPICS.forEach(function (item) {
      var topic = item.value;
      var n;
      if (topic === "Все") n = TOTAL;
      else if (fullCounts[topic] != null) n = fullCounts[topic];
      else n = counts[topic] || 0;
      if (!n) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", state.topic === topic ? "true" : "false");
      b.textContent = item.label;
      var span = document.createElement("span");
      span.className = "count";
      span.textContent = fmt(n);
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
    if (!sel) return;
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

  function ahaPreviewPool(shown, all) {
    var taken = {};
    shown.forEach(function (c) { taken[c.username] = true; });
    var pool = all.slice(shown.length).filter(function (c) { return !taken[c.username]; });
    pool.forEach(function (c) { taken[c.username] = true; });
    if (pool.length < AHA_PREVIEW_ROWS) {
      var topics = {};
      shown.forEach(function (c) { topics[c.topic] = true; });
      DATA.chats.forEach(function (c) {
        if (pool.length >= AHA_PREVIEW_ROWS) return;
        if (taken[c.username] || !topics[c.topic]) return;
        taken[c.username] = true;
        pool.push(c);
      });
    }
    if (pool.length < AHA_PREVIEW_ROWS) {
      DATA.chats.forEach(function (c) {
        if (pool.length >= AHA_PREVIEW_ROWS) return;
        if (taken[c.username]) return;
        taken[c.username] = true;
        pool.push(c);
      });
    }
    return pool;
  }

  function renderAha(all, shown) {
    var block = $("#aha-block");
    var active = isAhaMode() && all.length > 0;
    block.hidden = !active;
    if (!active) return;

    var rest = Math.max(0, TOTAL - shown.length);
    var catCount = state.topic === "Все"
      ? TOTAL
      : ((DATA.categories && DATA.categories[state.topic] != null)
        ? DATA.categories[state.topic]
        : all.length);
    if (state.topic !== "Все") {
      $("#aha-title").textContent = "В рубрике «" + state.topic + "» — " + fmt(catCount) + " " +
        plural(catCount, "чат", "чата", "чатов") + ". Бесплатно видно первые " + shown.length +
        ". Остальные — в готовом файле Excel.";
    } else {
      $("#aha-title").textContent = "Найдено ещё " + fmt(rest) + " " +
        plural(rest, "проверенный чат", "проверенных чата", "проверенных чатов") +
        " в полной базе (" + fmt(TOTAL) + " " + plural(TOTAL, "чат", "чата", "чатов") + ") по вашей теме";
    }
    $("#aha-sub").textContent = shown.length + " " +
      plural(shown.length, "совпадение", "совпадения", "совпадений") +
      " открыты полностью. Остальные — в полной выгрузке с Excel.";

    var buy = $("#aha-buy");
    if (buy) {
      buy.textContent = state.topic !== "Все"
        ? "Скачать все " + fmt(catCount) + " " + plural(catCount, "чат", "чата", "чатов") +
          " рубрики " + state.topic + " (и всю базу " + fmt(TOTAL) + " чатов) в готовом файле Excel за 490 ₽"
        : "Скачать все " + fmt(TOTAL) + " " + plural(TOTAL, "чат", "чата", "чатов") +
          " в готовом файле Excel за 490 ₽";
    }

    var host = $("#aha-rows");
    host.innerHTML = "";
    var pool = ahaPreviewPool(shown, all);
    for (var i = 0; i < AHA_PREVIEW_ROWS && pool.length; i++) {
      var c = pool[i % pool.length];
      var row = document.createElement("div");
      row.className = "aha-row";

      var chat = document.createElement("div");
      chat.className = "aha-chat";
      var handle = document.createElement("span");
      handle.className = "aha-handle";
      handle.textContent = "@" + c.username;
      var badge = document.createElement("span");
      badge.className = "pro-badge";
      badge.textContent = "PRO";
      chat.appendChild(handle);
      chat.appendChild(badge);

      var topic = document.createElement("div");
      topic.className = "aha-topic";
      topic.textContent = c.topic;
      var city = document.createElement("div");
      city.className = "aha-city";
      city.textContent = c.city || "РФ / СНГ";
      var members = document.createElement("div");
      members.className = "aha-members";
      members.textContent = fmt(c.members) + " участн.";

      row.appendChild(chat);
      row.appendChild(topic);
      row.appendChild(city);
      row.appendChild(members);
      host.appendChild(row);
    }
  }

  function renderRows() {
    var list = $("#rows");
    var all = filtered();
    var pro = isPro();
    var aha = isAhaMode();
    var shown = aha ? all.slice(0, AHA_LIMIT) : all;
    list.innerHTML = "";
    list.classList.toggle("aha-mode", aha);

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
    renderAha(all, shown);
    var more = TOTAL > DATA.chats.length;
    $("#limit-bar").hidden = pro || !more || aha;
    if (!pro && more) {
      $("#limit-text").textContent = "В бесплатной версии " + fmt(DATA.chats.length) +
        " чатов из " + fmt(TOTAL) + ". Поиск и фильтры работают по доступной части.";
    }

    var badge = $("#visible-badge");
    badge.textContent = pro ? fmt(all.length) + " чатов" : fmt(aha ? shown.length : all.length) + " из " + fmt(TOTAL);
    badge.className = "badge" + (!pro && more ? " badge-warn" : "");
    $("#check-quota").textContent = (isPro() ? PRO_CHECKS : FREE_CHECKS) + " ссылок за раз";
    var dlXlsx = $("#dl-xlsx");
    if (dlXlsx) {
      dlXlsx.textContent = state.topic === "Все"
        ? "Excel · " + fmt(TOTAL) + " чатов"
        : "Excel · " + fmt(all.length) + " " + plural(all.length, "чат", "чата", "чатов") + " рубрики";
    }
  }

  function exportTable(chats) {
    return [["Название", "Ссылка", "Тематика", "Город", "Участники", "Проверен", "Описание"]]
      .concat(chats.map(function (c) {
        return [c.title, c.link, c.topic, c.city || "", c.members, dateShort(c.checked_at), c.about || ""];
      }));
  }

  function downloadFullXlsx() {
    if (!DATA.chats || !DATA.chats.length) { toast("База ещё не загружена", true); return; }
    var rows = DATA.chats.slice().sort(function (a, b) { return b.members - a.members; });
    window.XLSX.download(exportTable(rows), FULL_XLSX_NAME, "Chats");
    toast("Скачано " + fmt(rows.length) + " чатов: " + FULL_XLSX_NAME);
  }

  function downloadB2BXlsx() {
    var rec = window.Unlock && window.Unlock.state(PRODUCT);
    var hash = rec && rec.hash;
    toast("Расшифровка базы B2B-магазинов...");
    if (!window.ChatPack || !window.ChatPack.ensureB2B) {
      toast("Модуль расшифровки недоступен", true);
      return;
    }
    window.ChatPack.ensureB2B(hash).then(function (pack) {
      var stores = (pack && pack.stores) || [];
      if (!stores.length) { toast("База B2B пуста", true); return; }
      var headers = ["domain", "url", "shop_name", "city", "category", "cms", "cms_hint", "email", "phone", "telegram", "vk", "whatsapp", "http_status", "live_http200", "shop_score", "major_bot_blocked", "checked_at"];
      var table = [headers].concat(stores.map(function (s) {
        return [s.domain, s.url, s.shop_name, s.city || "", s.category || "", s.cms || "unknown", s.cms_hint || "", s.email || "", s.phone || "", s.telegram || "", s.vk || "", s.whatsapp || "", s.http_status || 200, s.live_http200 || 1, s.shop_score || 2, s.major_bot_blocked || "0", s.checked_at || ""];
      }));
      var fileName = PACK_FILES["b2b-stores"] || "b2b-ecommerce-stores-1200-nov2026.xlsx";
      window.XLSX.download(table, fileName, "B2B leads Nov 2026");
      toast("Скачано " + fmt(stores.length) + " B2B-магазинов: " + fileName);
    }).catch(function (err) {
      toast("Ошибка расшифровки B2B: " + (err.message || err), true);
    });
  }

  function rowsByTopics(topics) {
    var wanted = {};
    topics.forEach(function (t) { wanted[t] = true; });
    return DATA.chats.filter(function (c) { return wanted[c.topic]; })
      .sort(function (a, b) { return b.members - a.members; });
  }

  function downloadWbXlsx() {
    if (!DATA.chats || !DATA.chats.length) { toast("База чатов ещё не загружена", true); return; }
    var rows = rowsByTopics(PACK_TOPICS["wb-sellers"]);
    var fileName = PACK_FILES["wb-sellers"];
    window.XLSX.download(exportTable(rows), fileName, "WB Ozon");
    toast("Скачано " + fmt(rows.length) + " чатов селлеров, опта и карго: " + fileName);
  }

  function downloadFreelanceXlsx() {
    if (!DATA.chats || !DATA.chats.length) { toast("База чатов ещё не загружена", true); return; }
    var rows = rowsByTopics(PACK_TOPICS["freelance-it"]);
    var fileName = PACK_FILES["freelance-it"];
    window.XLSX.download(exportTable(rows), fileName, "IT Freelance");
    toast("Скачано " + fmt(rows.length) + " чатов IT, фриланса и недвижимости: " + fileName);
  }

  /* Realty pack: the whole "Недвижимость/Ремонт" rubric (213 chats) plus every
     Moscow/SPb local chat (113) = 326 rows, exactly the pack Agent 4 QA tested.
     The body/description is deliberately not scanned: a loose regex pulled in
     "Маркетплейсы. ЧАТ", "Такси Москва" and авторемонт noise. */
  function downloadRealtyXlsx() {
    if (!DATA.chats || !DATA.chats.length) { toast("База чатов ещё не загружена", true); return; }
    var seen = {};
    var rows = [];
    DATA.chats.forEach(function (c) {
      if (seen[c.username]) return;
      if (c.topic === "Недвижимость/Ремонт" ||
          c.city === "Москва" || c.city === "Санкт-Петербург") {
        seen[c.username] = true;
        rows.push(c);
      }
    });
    rows.sort(function (a, b) { return b.members - a.members; });
    var fileName = PACK_FILES["realty-jk"];
    window.XLSX.download(exportTable(rows), fileName, "Realty JK");
    toast("Скачано " + fmt(rows.length) + " чатов недвижимости, ЖК и ремонта: " + fileName);
  }

  /* Receipt link (?key=…&download=xlsx) or a key pasted into the modal
     this session: once the encrypted pack is open, start the file.
     With &pack=… the profile Excel pack goes first (B2B stores /
     WB-Ozon niche / IT-freelance niche / Realty-JK niche); Pro also opens the full base. */
  function maybeAutoDownload() {
    if (state.autoDownloaded) return;
    var wantsFile = state.urlKeyPresent || state.sessionLicense;
    if (!wantsFile || !isPro()) return;
    var pack = (state.urlPack || "").trim().toLowerCase();
    if (pack === "b2b-stores" || pack === "b2b") {
      state.autoDownloaded = true;
      downloadB2BXlsx();
      return;
    }
    if (!window.ChatPack || !window.ChatPack.isLoaded()) return;
    if (pack === "wb-sellers" || pack === "wb") {
      state.autoDownloaded = true;
      downloadWbXlsx();
      return;
    }
    if (pack === "freelance-it" || pack === "freelance") {
      state.autoDownloaded = true;
      downloadFreelanceXlsx();
      return;
    }
    if (pack === "realty-jk" || pack === "realty") {
      state.autoDownloaded = true;
      downloadRealtyXlsx();
      return;
    }
    state.autoDownloaded = true;
    downloadFullXlsx();
  }

  function download(format) {
    var all = filtered();
    var pro = isPro();
    var rows = isAhaMode() ? all.slice(0, AHA_LIMIT) : all;
    if (!rows.length) { toast("Нет строк для выгрузки", true); return; }
    var table = exportTable(rows);
    var isFullBase = state.topic === "Все" && !state.query.trim() && !state.city;
    var stamp = new Date().toISOString().slice(0, 10);
    if (format === "xlsx") {
      var xlsxName = isFullBase && pro && DATA.chats.length >= TOTAL
        ? FULL_XLSX_NAME
        : ("telegram-chats-" + stamp + ".xlsx");
      window.XLSX.download(table, xlsxName, "Chats");
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
    if (!pro && TOTAL > DATA.chats.length) toast("Полная база, " + fmt(TOTAL) + " строк, открывается в Pro", false);
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

  function renderStats() {
    syncCounts();
    var pro = isPro() && DATA.count >= TOTAL;
    $("#stat-count").textContent = pro ? fmt(DATA.chats.length) : fmt(DATA.chats.length) + " из " + fmt(TOTAL);
    $("#stat-topics").textContent = String(new Set(DATA.chats.map(function (c) { return c.topic; })).size);
    $("#stat-cities").textContent = String(new Set(DATA.chats.map(function (c) { return c.city; }).filter(Boolean)).size);
    $("#stat-date").textContent = DATA.generated_at ? dateShort(DATA.generated_at) : "—";
    $("#hero-count").textContent = (pro ? "Полная база · " : "Бесплатная часть · ") + "проверено " + dateShort(DATA.generated_at);
  }

  /* The full catalogue ships encrypted; a verified USDC payment unlocks it. */
  function loadPro() {
    if (!isPro() || !window.ChatPack || window.ChatPack.isLoaded()) return;
    var rec = window.Unlock && window.Unlock.state("tgchats");
    var bar = $("#limit-bar");
    bar.hidden = false;
    $("#limit-text").textContent = "Оплата подтверждена. Проверяем перевод в Base и расшифровываем полную базу…";
    window.ChatPack.ensure(rec && rec.hash).then(function (pack) {
      if (!pack || !pack.chats || !pack.chats.length) throw new Error("Пакет Pro пуст");
      DATA = pack;
      TOTAL = pack.total || pack.count || pack.chats.length;
      renderCities();
      renderTopics();
      renderStats();
      renderRows();
      toast("Полная база открыта: " + fmt(DATA.chats.length) + " чатов");
      maybeAutoDownload();
    }).catch(function (err) {
      $("#limit-text").textContent = "Полная база не открылась: " + (err && err.message ? err.message : "ошибка");
      toast("Не удалось открыть полную базу", true);
      /* A hash that Base rejects is not a payment: drop it so the page stops
         retrying on every load. */
      if (err && err.paymentFailed && window.Unlock) window.Unlock.deactivate("tgchats");
    });
  }

  function init() {
    renderStats();

    renderCities();
    renderTopics();
    renderRows();
    if (canLoadPack()) loadPro();

    var qEl = $("#q");
    if (qEl) qEl.addEventListener("input", function (e) { state.query = e.target.value; renderRows(); });
    var cityEl = $("#city");
    if (cityEl) cityEl.addEventListener("change", function (e) { state.city = e.target.value; renderRows(); });
    var sortEl = $("#sort");
    if (sortEl) sortEl.addEventListener("change", function (e) { state.sort = e.target.value; renderRows(); });
    var resetEl = $("#reset-filters");
    if (resetEl) resetEl.addEventListener("click", function () {
      state.query = ""; state.city = ""; state.topic = "Все";
      if (qEl) qEl.value = "";
      if (cityEl) cityEl.value = "";
      renderTopics(); renderRows();
    });

    $$(".tab[data-view]").forEach(function (t) {
      t.addEventListener("click", function () { setView(t.getAttribute("data-view"), false); });
    });
    $$("[data-view-link]").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); setView(a.getAttribute("data-view-link"), true); });
    });
    var heroCheck = $("#hero-check");
    if (heroCheck) heroCheck.addEventListener("click", function () { setView("check", true); });
    var checkRun = $("#check-run");
    if (checkRun) checkRun.addEventListener("click", runCheck);

    var heroXlsx = $("#hero-xlsx");
    if (heroXlsx) heroXlsx.addEventListener("click", function () {
      if (!isPro()) {
        toast("Excel с полной базой — в Pro за 490 ₽. Ключ придёт сразу после оплаты.", true);
        var mb = document.querySelector('#view-base [data-unlock]');
        if (mb) mb.click();
        return;
      }
      if (window.ChatPack && window.ChatPack.isLoaded()) {
        downloadFullXlsx();
        return;
      }
      if (canLoadPack()) {
        loadPro();
        /* loadPro's then() calls maybeAutoDownload, which needs a buyer
           signal — the explicit click is that signal. */
        state.urlKeyPresent = true;
      } else {
        toast("База ещё не загружена", true);
      }
    });

    var dlCsv = $("#dl-csv");
    if (dlCsv) dlCsv.addEventListener("click", function () { download("csv"); });
    var dlXlsx = $("#dl-xlsx");
    if (dlXlsx) dlXlsx.addEventListener("click", function () {
      if (!isPro()) {
        toast("XLSX входит в Pro. CSV можно скачать бесплатно.", true);
        var b = document.querySelector('#view-base [data-unlock]');
        if (b) b.click();
        return;
      }
      if (window.ChatPack && !window.ChatPack.isLoaded() && canLoadPack()) {
        state.urlKeyPresent = true;
        loadPro();
        return;
      }
      download("xlsx");
    });

    window.__TGCHATS__ = {
      downloadFullXlsx: downloadFullXlsx,
      downloadB2BXlsx: downloadB2BXlsx,
      downloadWbXlsx: downloadWbXlsx,
      downloadFreelanceXlsx: downloadFreelanceXlsx,
      downloadRealtyXlsx: downloadRealtyXlsx,
      maybeAutoDownload: maybeAutoDownload,
      packFiles: PACK_FILES,
      urlPack: state.urlPack,
      fullName: FULL_XLSX_NAME
    };

    document.addEventListener("unlock:changed", function () {
      renderRows();
      var rec = window.Unlock && window.Unlock.state(PRODUCT);
      if (rec && rec.hash && String(rec.hash).indexOf("license:") === 0) state.sessionLicense = true;
      if (canLoadPack()) loadPro();
      else maybeAutoDownload();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
