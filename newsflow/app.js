/* NewsFlow Studio — client-side digest builder.
   No backend: sources are fetched through CORS where available and through a
   public reader as a fallback. Everything is stored in localStorage. */
(function () {
  "use strict";

  var PRODUCT = "newsflow";
  var PRICE = 12;
  var FREE_POSTS = 5;
  var FREE_SOURCES = 5;
  var PRO_SOURCES = 50;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var PRESETS = [
    { id: "hn", name: "Hacker News", kind: "hn", url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30", on: true },
    { id: "devto", name: "dev.to", kind: "devto", url: "https://dev.to/api/articles?per_page=25", on: true },
    { id: "habr", name: "Habr", kind: "rss", url: "https://habr.com/ru/rss/posts/top/?fl=ru", on: true },
    { id: "tg-rian", name: "Telegram · rian_ru", kind: "tg", url: "https://t.me/s/rian_ru", on: false }
  ];

  var LIMITS = { telegram: 4096, vk: 4096, shorts: 2200 };
  var state = { sources: [], items: [], selected: {}, format: "telegram", busy: false, filtered: 0, errors: [] };

  var AD_RE = /(подписывайтесь|подпишись|промокод|скидк|розыгрыш|казино|ставки|букмекер|заработ|инвестируй|переходи по ссылке|жми на ссылку|реклама\.|erid|18\+)/i;

  /* ---------------------------------------------------------------- storage */

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function isPro() { return !!(window.Unlock && window.Unlock.isPro(PRODUCT)); }

  function getSources() {
    var stored = load("newsflow:sources", null);
    if (!stored || !stored.length) return PRESETS.map(function (s) { return Object.assign({}, s); });
    return stored;
  }
  function saveSources() { save("newsflow:sources", state.sources); }

  /* ---------------------------------------------------------------- quota */

  function today() { return new Date().toISOString().slice(0, 10); }

  function getQuota() {
    var q = load("newsflow:quota", null);
    if (!q || q.date !== today()) q = { date: today(), used: 0 };
    return q;
  }

  function remainingPosts() { return isPro() ? Infinity : Math.max(0, FREE_POSTS - getQuota().used); }

  function spendPost() {
    if (isPro()) return true;
    var q = getQuota();
    if (q.used >= FREE_POSTS) return false;
    q.used += 1;
    save("newsflow:quota", q);
    renderQuota();
    return true;
  }

  function renderQuota() {
    var el = $("#quota-badge");
    if (isPro()) {
      el.textContent = "Pro · unlimited posts";
      el.className = "badge badge-pro";
    } else {
      var left = remainingPosts();
      el.textContent = left + " of " + FREE_POSTS + " posts left today";
      el.className = "badge" + (left === 0 ? " badge-warn" : "");
    }
    var proBtn = document.querySelector('[data-unlock][data-product="newsflow"]');
    if (proBtn) proBtn.textContent = isPro() ? "Pro active" : "Pro";
  }

  /* ---------------------------------------------------------------- network */

  var READER = "https://r.jina.ai/";
  var readerCalls = [];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function readerGate() {
    for (;;) {
      var now = Date.now();
      while (readerCalls.length && now - readerCalls[0] > 60000) readerCalls.shift();
      if (readerCalls.length < 12) { readerCalls.push(now); return; }
      var wait = 60000 - (Date.now() - readerCalls[0]) + 250;
      setStatus("Waiting for the public reader quota…", true);
      await sleep(Math.max(wait, 500));
    }
  }

  var CORS_HOSTS = ["hn.algolia.com", "dev.to", "api.groq.com", "generativelanguage.googleapis.com"];

  async function fetchText(url, asHtml) {
    var host = "";
    try { host = new URL(url).hostname; } catch (e) { /* relative or odd */ }
    if (CORS_HOSTS.indexOf(host) !== -1) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 12000);
      try {
        var direct = await fetch(url, { signal: ctrl.signal, mode: "cors" });
        clearTimeout(timer);
        if (direct.ok) return await direct.text();
      } catch (e) { /* fall through to the reader */ }
    }

    await readerGate();
    var res = await fetch(READER + url, {
      headers: { "x-respond-with": asHtml ? "html" : "text" }
    });
    if (!res.ok) throw new Error("reader returned " + res.status);
    return await res.text();
  }

  /* ---------------------------------------------------------------- parsing */

  function stripHtml(value) {
    var div = document.createElement("div");
    div.innerHTML = value || "";
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function tagText(node, names) {
    for (var i = 0; i < names.length; i++) {
      var el = node.querySelector(names[i]);
      if (el && (el.textContent || "").trim()) return el.textContent.trim();
    }
    return "";
  }

  function atomLink(node) {
    var links = Array.prototype.slice.call(node.querySelectorAll("link"));
    for (var i = 0; i < links.length; i++) {
      var rel = links[i].getAttribute("rel");
      if (!rel || rel === "alternate") {
        var href = links[i].getAttribute("href");
        if (href) return href;
      }
    }
    return "";
  }

  function parseFeed(xml, src) {
    var doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("address did not return a feed");
    var nodes = Array.prototype.slice.call(doc.querySelectorAll("item, entry"));
    if (!nodes.length) throw new Error("feed has no items");
    return nodes.map(function (node) {
      var link = atomLink(node) || tagText(node, ["link"]);
      var raw = tagText(node, ["description", "summary", "content", "content\\:encoded"]);
      var title = stripHtml(tagText(node, ["title"]));
      /* Habr puts "Пост @user — Блог компании X (+4) — N/P" in <title> and the
         real headline in the first paragraph. Use that instead of the boilerplate. */
      if (/^Пост\s+@/.test(title)) {
        var paras = Array.prototype.slice.call(
          new DOMParser().parseFromString(raw, "text/html").querySelectorAll("p")
        ).map(function (p) { return stripHtml(p.innerHTML); }).filter(Boolean);
        var lead = "";
        for (var i = 0; i < paras.length && i < 3; i++) {
          var text = paras[i];
          if (text.length < 18 || text.length > 220) continue;
          if (/^Блог компании/i.test(text)) continue;
          lead = text;
          break;
        }
        if (lead) title = lead;
      }
      return {
        title: title,
        url: link,
        summary: stripHtml(raw).slice(0, 320),
        published: tagText(node, ["pubDate", "published", "updated", "date"]),
        source: src.name,
        sourceId: src.id
      };
    });
  }

  function parseTelegram(html, src) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var nodes = Array.prototype.slice.call(doc.querySelectorAll(".tgme_widget_message_wrap"));
    if (!nodes.length) throw new Error("no public messages on that page");
    return nodes.map(function (node) {
      var textEl = node.querySelector(".tgme_widget_message_text");
      var dateEl = node.querySelector("time");
      var linkEl = node.querySelector(".tgme_widget_message_date a");
      var body = textEl ? textEl.innerHTML.replace(/<br\s*\/?>/gi, "\n") : "";
      var text = stripHtml(body.replace(/\n/g, " "));
      var firstLine = text.split(/(?<=[.!?])\s/)[0] || text;
      return {
        title: firstLine.slice(0, 150),
        url: linkEl ? linkEl.getAttribute("href") : "",
        summary: text.slice(0, 320),
        published: dateEl ? dateEl.getAttribute("datetime") : "",
        source: src.name,
        sourceId: src.id
      };
    }).reverse();
  }

  async function fetchSource(src) {
    if (src.kind === "hn") {
      var hn = JSON.parse(await fetchText(src.url, false));
      return (hn.hits || []).map(function (h) {
        return {
          title: h.title || h.story_title || "",
          url: h.url || ("https://news.ycombinator.com/item?id=" + h.objectID),
          summary: "",
          published: h.created_at,
          source: src.name,
          sourceId: src.id
        };
      });
    }
    if (src.kind === "devto") {
      var articles = JSON.parse(await fetchText(src.url, false));
      return articles.map(function (a) {
        return {
          title: a.title,
          url: a.url,
          summary: stripHtml(a.description || "").slice(0, 320),
          published: a.published_at,
          source: src.name,
          sourceId: src.id
        };
      });
    }
    if (src.kind === "tg") {
      return parseTelegram(await fetchText(src.url, true), src);
    }
    return parseFeed(await fetchText(src.url, false), src);
  }

  /* ---------------------------------------------------------------- pipeline */

  function canonUrl(url) {
    if (!url) return "";
    try {
      var u = new URL(url);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"].forEach(function (p) {
        u.searchParams.delete(p);
      });
      return (u.origin + u.pathname + u.search).replace(/\/$/, "").toLowerCase();
    } catch (e) { return String(url).toLowerCase(); }
  }

  function titleKey(title) {
    return (title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 70);
  }

  function noisy(item) {
    var text = item.title + " " + item.summary;
    var score = 0;
    if (item.title.length < 12) score += 2;
    if (AD_RE.test(text)) score += 3;
    if ((item.summary.match(/https?:\/\//g) || []).length > 1) score += 2;
    if (item.title.length > 20 && item.title === item.title.toUpperCase()) score += 1;
    return score >= 3;
  }

  function when(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + "m ago";
    if (diff < 86400) return Math.round(diff / 3600) + "h ago";
    if (diff < 604800) return Math.round(diff / 86400) + "d ago";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu;

  function cleanText(value) {
    return String(value || "").replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
  }

  /* Habr's feed titles look like "Пост @author — Headline (+4) — 31.10.2026 08:28".
     The decoration is noise in a digest, so strip it down to the headline. */
  function tidyTitle(title) {
    return String(title || "")
      .replace(/^Пост\s+@[\w-]+\s+—\s+/, "")
      .replace(/\s*\([+-]\d+\)\s*—.*$/, "")
      .trim();
  }

  function normalize(raw) {
    return {
      id: (raw.sourceId + ":" + (raw.url || raw.title)).slice(0, 90),
      title: cleanText(tidyTitle(raw.title)),
      url: raw.url || "",
      summary: cleanText(raw.summary),
      published: raw.published || "",
      source: raw.source,
      sourceId: raw.sourceId
    };
  }

  async function collect() {
    if (state.busy) return;
    var active = state.sources.filter(function (s) { return s.on; });
    if (!active.length) { toast("Turn on at least one source", true); return; }
    if (!isPro() && active.length > FREE_SOURCES) {
      toast("The free plan runs " + FREE_SOURCES + " sources at a time", true);
      return;
    }

    state.busy = true;
    state.errors = [];
    setStatus("Collecting from " + active.length + " " + (active.length === 1 ? "source" : "sources") + "…", true);
    renderSourceChips();
    renderSkeleton();

    var results = await Promise.allSettled(active.map(function (src) { return fetchSource(src); }));
    var raw = [];
    results.forEach(function (res, i) {
      if (res.status === "fulfilled") raw = raw.concat(res.value);
      else state.errors.push(active[i].name + ": " + (res.reason && res.reason.message ? res.reason.message : "failed"));
    });

    var seenUrl = {};
    var seenTitle = {};
    var kept = [];
    var filtered = 0;
    raw.forEach(function (item) {
      var n = normalize(item);
      if (!n.title) { filtered++; return; }
      if (noisy(n)) { filtered++; return; }
      var u = canonUrl(n.url);
      var t = titleKey(n.title);
      if (u && seenUrl[u]) { filtered++; return; }
      if (t && seenTitle[t]) { filtered++; return; }
      if (u) seenUrl[u] = true;
      if (t) seenTitle[t] = true;
      kept.push(n);
    });

    kept.sort(function (a, b) {
      var da = new Date(a.published).getTime() || 0;
      var db = new Date(b.published).getTime() || 0;
      return db - da;
    });

    state.items = kept.slice(0, 60);
    state.filtered = filtered;
    state.selected = {};
    state.items.slice(0, 10).forEach(function (item) { state.selected[item.id] = true; });
    state.busy = false;

    renderStories();
    renderSourceChips();
    renderDigest();
    renderQuota();

    if (!state.items.length) {
      setStatus("No stories came back. Check the source addresses, or try again in a minute.", false);
    } else {
      var msg = "Collected " + state.items.length + " stories from " + active.length +
        (active.length === 1 ? " source" : " sources");
      if (filtered) msg += " · " + filtered + " duplicates or ads removed";
      setStatus(msg, false);
    }
    if (state.errors.length) setStatus(state.errors[0], false);
  }

  /* ---------------------------------------------------------------- digest */

  function selectedItems() {
    return state.items.filter(function (item) { return state.selected[item.id]; });
  }

  function sentences(text, max) {
    var clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    var cut = clean.split(/(?<=[.!?])\s/)[0];
    if (cut.length > max) cut = cut.slice(0, max - 1).replace(/[,;:\s]+$/, "") + "…";
    return cut;
  }

  function dateLabel() {
    return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  function buildTelegram(items) {
    var head = "Daily digest · " + dateLabel() + "\n\n";
    var blocks = items.map(function (item, i) {
      var line = (i + 1) + ". " + item.title;
      var note = sentences(item.summary, 180);
      if (note && note !== item.title) line += "\n" + note;
      if (item.url) line += "\n" + item.url;
      return line;
    });
    var out = head + blocks.join("\n\n");
    if (out.length > LIMITS.telegram) {
      while (out.length > LIMITS.telegram && blocks.length > 1) {
        blocks.pop();
        out = head + blocks.join("\n\n") + "\n\nMore in the full issue.";
      }
    }
    return out;
  }

  function buildVk(items) {
    var head = "Digest for " + dateLabel() + "\n\n";
    var blocks = items.map(function (item, i) {
      var line = (i + 1) + ") " + item.title;
      var note = sentences(item.summary, 120);
      if (note && note !== item.title) line += ". " + note.replace(/\.$/, "");
      if (item.url) line += "\n" + item.url;
      return line;
    });
    return (head + blocks.join("\n\n")).slice(0, LIMITS.vk);
  }

  function buildShorts(items) {
    var top = items.slice(0, 4);
    if (!top.length) return "";
    var lines = [];
    lines.push("HOOK (0–3s)");
    lines.push("“" + sentences(top[0].title, 90) + "” — and three more things worth 60 seconds.");
    lines.push("");
    top.forEach(function (item, i) {
      lines.push("BEAT " + (i + 1) + " (" + (4 + i * 12) + "–" + (16 + i * 12) + "s)");
      lines.push(sentences(item.summary || item.title, 150));
      lines.push("");
    });
    lines.push("OUTRO (52–60s)");
    lines.push("Full links are in the description. Follow for a digest every weekday.");
    return lines.join("\n").slice(0, LIMITS.shorts);
  }

  function buildDigest() {
    var items = selectedItems();
    if (!items.length) return "";
    if (state.format === "vk") return buildVk(items);
    if (state.format === "shorts") return buildShorts(items);
    return buildTelegram(items);
  }

  function renderDigest() {
    var text = buildDigest();
    var box = $("#digest");
    if (!state.items.length) {
      box.value = "";
    } else {
      box.value = text;
    }
    var limit = LIMITS[state.format];
    $("#format-limit").textContent = limit.toLocaleString("en-US") + " chars";
    updateCount();
    $$(".tab").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-format") === state.format ? "true" : "false");
    });
  }

  function updateCount() {
    var box = $("#digest");
    var n = box.value.length;
    var limit = LIMITS[state.format];
    $("#char-count").textContent = n.toLocaleString("en-US") + " / " + limit.toLocaleString("en-US");
    $("#char-count").style.color = n > limit ? "var(--bad)" : "";
  }

  /* ---------------------------------------------------------------- render */

  function setStatus(text, busy) {
    var el = $("#status-line");
    el.innerHTML = "";
    if (busy) {
      var dot = document.createElement("span");
      dot.className = "spin";
      el.appendChild(dot);
    }
    var span = document.createElement("span");
    span.className = busy ? "" : "muted";
    span.textContent = text;
    el.appendChild(span);
  }

  function renderSourceChips() {
    var host = $("#source-chips");
    host.innerHTML = "";
    state.sources.forEach(function (src) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "source-chip" + (state.errors.some(function (e) { return e.indexOf(src.name) === 0; }) ? " err" : "");
      btn.setAttribute("aria-pressed", src.on ? "true" : "false");
      btn.title = src.url;
      var tick = document.createElement("span");
      tick.className = "tick";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = src.name;
      btn.appendChild(tick);
      btn.appendChild(name);
      btn.addEventListener("click", function () {
        if (!src.on && !isPro()) {
          var active = state.sources.filter(function (s) { return s.on; }).length;
          if (active >= FREE_SOURCES) {
            toast("Free plan: " + FREE_SOURCES + " sources at a time. Pro runs up to " + PRO_SOURCES + ".", true);
            return;
          }
        }
        src.on = !src.on;
        saveSources();
        renderSourceChips();
      });
      host.appendChild(btn);
    });
    var add = document.createElement("button");
    add.type = "button";
    add.className = "source-chip source-add";
    add.setAttribute("aria-pressed", "false");
    add.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="name">Add source</span>';
    add.addEventListener("click", openSourceDialog);
    if (state.sources.length < PRO_SOURCES) host.appendChild(add);
  }

  function renderSkeleton() {
    var list = $("#stories");
    $("#stories-empty").hidden = true;
    list.innerHTML = "";
    for (var i = 0; i < 5; i++) {
      var li = document.createElement("li");
      li.className = "story";
      li.innerHTML = '<div style="width:14px;height:14px;border:1px solid #e2e8f0;border-radius:4px;margin-top:3px;flex:none"></div>' +
        '<div class="story-main" style="flex:1"><div style="height:12px;width:' + (64 - i * 7) + '%;background:#eef2f7;border-radius:4px"></div>' +
        '<div style="height:10px;width:32%;background:#f1f5f9;border-radius:4px;margin-top:6px"></div></div>';
      list.appendChild(li);
    }
    $("#story-count").textContent = "loading";
  }

  function renderStories() {
    var list = $("#stories");
    var filter = $("#story-filter").value;
    list.innerHTML = "";
    var shown = state.items.filter(function (item) { return filter === "all" || item.sourceId === filter; });
    $("#story-count").textContent = state.items.length ? shown.length + " of " + state.items.length : "—";
    $("#stories-empty").hidden = shown.length > 0;

    shown.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "story";

      var check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!state.selected[item.id];
      check.setAttribute("aria-label", "Include " + item.title);
      check.addEventListener("change", function () {
        if (check.checked) state.selected[item.id] = true;
        else delete state.selected[item.id];
        renderDigest();
      });

      var main = document.createElement("div");
      main.className = "story-main";

      var title = document.createElement("p");
      title.className = "story-title";
      if (item.url) {
        var a = document.createElement("a");
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = item.title;
        title.appendChild(a);
      } else {
        title.textContent = item.title;
      }

      var meta = document.createElement("div");
      meta.className = "story-meta";
      var src = document.createElement("span");
      src.className = "story-src";
      src.textContent = item.source;
      meta.appendChild(src);
      if (item.published) {
        var sep = document.createElement("span");
        sep.className = "sep";
        var time = document.createElement("span");
        time.textContent = when(item.published);
        meta.appendChild(sep);
        meta.appendChild(time);
      }

      main.appendChild(title);
      main.appendChild(meta);
      li.appendChild(check);
      li.appendChild(main);
      list.appendChild(li);
    });
  }

  function renderFilter() {
    var sel = $("#story-filter");
    var current = sel.value;
    sel.innerHTML = '<option value="all">All sources</option>';
    state.sources.filter(function (s) { return s.on; }).forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = current && sel.querySelector('option[value="' + current + '"]') ? current : "all";
  }

  /* ---------------------------------------------------------------- actions */

  function toast(message, bad) {
    if (window.Unlock) window.Unlock.toast(message, bad);
  }

  function requirePro(what) {
    if (isPro()) return true;
    toast(what + " is part of Pro.", true);
    var btn = document.querySelector('[data-unlock][data-product="newsflow"]');
    if (btn) btn.click();
    return false;
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function exportRows() {
    var rows = [["Date", "Format", "Title", "Source", "Link"]];
    var day = new Date().toISOString().slice(0, 10);
    selectedItems().forEach(function (item) {
      rows.push([day, state.format, item.title, item.source, item.url]);
    });
    return rows;
  }

  function exportCsv() {
    if (!requirePro("Export")) return;
    var rows = exportRows();
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"';
      }).join(",");
    }).join("\r\n");
    download("newsflow-plan-" + new Date().toISOString().slice(0, 10) + ".csv", "\ufeff" + csv, "text/csv;charset=utf-8");
    toast("Content plan exported");
  }

  function exportXlsx() {
    if (!requirePro("Export")) return;
    window.XLSX.download(exportRows(), "newsflow-plan-" + new Date().toISOString().slice(0, 10) + ".xlsx", "Content plan");
    toast("Content plan exported");
  }

  /* ---------------------------------------------------------------- dialogs */

  var sourceDialog, keyDialog, scheduleDialog;

  function openSourceDialog() {
    $("#source-error").hidden = true;
    $("#source-url").value = "";
    $("#source-name").value = "";
    sourceDialog.showModal();
    setTimeout(function () { $("#source-url").focus(); }, 40);
  }

  function addSource() {
    var raw = $("#source-url").value.trim();
    var name = $("#source-name").value.trim();
    var err = $("#source-error");
    if (!raw) { err.textContent = "Paste a feed address."; err.hidden = false; return; }
    if (!/^https?:\/\//i.test(raw) && !/^t\.me\//i.test(raw)) {
      err.textContent = "The address should start with https:// or t.me/.";
      err.hidden = false;
      return;
    }
    if (!isPro() && state.sources.length >= FREE_SOURCES) {
      sourceDialog.close();
      requirePro("More than " + FREE_SOURCES + " sources");
      return;
    }
    var url = /^t\.me\//i.test(raw) ? "https://" + raw : raw;
    var kind = /t\.me\/s\//i.test(url) ? "tg" : "rss";
    if (kind === "tg" && !/t\.me\/s\//i.test(url)) {
      url = url.replace(/^https?:\/\/t\.me\//i, "https://t.me/s/");
    }
    var id = kind + "-" + Date.now().toString(36);
    state.sources.push({
      id: id,
      name: name || (kind === "tg" ? "Telegram · " + url.split("/s/")[1] : new URL(url).hostname.replace(/^www\./, "")),
      kind: kind,
      url: url,
      on: true
    });
    saveSources();
    renderSourceChips();
    renderFilter();
    sourceDialog.close();
    toast("Source added");
  }

  async function rewrite() {
    var key = $("#key-value").value.trim();
    var provider = $("#key-provider").value;
    var err = $("#key-error");
    err.hidden = true;
    if (!key) { err.textContent = "Paste your API key, or close this dialog."; err.hidden = false; return; }

    var items = selectedItems().slice(0, 10);
    if (!items.length) { err.textContent = "Select a few stories first."; err.hidden = false; return; }

    save("newsflow:key", { provider: provider, key: key });
    var btn = keyDialog.querySelector('[value="run"]');
    btn.disabled = true;
    btn.textContent = "Writing…";

    var prompt = "You are the editor of a daily digest. Rewrite the material below as one post for " +
      (state.format === "vk" ? "VK" : state.format === "shorts" ? "a 60-second short video script" : "Telegram") +
      ". Keep the facts, keep every link, do not invent anything, no emoji, no hashtags, no introductory filler. " +
      "Maximum " + (state.format === "shorts" ? "200" : "350") + " words.\n\n" +
      items.map(function (item, i) {
        return (i + 1) + ". " + item.title + "\n" + item.summary + "\n" + item.url;
      }).join("\n\n");

    try {
      var text = await callProvider(provider, key, prompt);
      $("#digest").value = text.trim();
      updateCount();
      keyDialog.close();
      toast("Post rewritten");
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Rewrite post";
    }
  }

  async function callProvider(provider, key, prompt) {
    if (provider === "groq") {
      var res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.4,
          messages: [{ role: "user", content: prompt }]
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error((data.error && data.error.message) || "Groq returned " + res.status);
      return data.choices[0].message.content;
    }
    var g = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      encodeURIComponent(key), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    var gd = await g.json().catch(function () { return {}; });
    if (!g.ok) throw new Error((gd.error && gd.error.message) || "Gemini returned " + g.status);
    return gd.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("");
  }

  /* ---------------------------------------------------------------- telegram */

  async function sendTelegram(token, chat, text) {
    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    try {
      var res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error((data.description) || "Telegram returned " + res.status);
      return { ok: true, verified: true };
    } catch (e) {
      var body = new URLSearchParams({ chat_id: chat, text: text });
      await fetch(url, { method: "POST", mode: "no-cors", body: body });
      return { ok: true, verified: false };
    }
  }

  function schedule() {
    var cfg = load("newsflow:schedule", null);
    $("#schedule-error").hidden = true;
    $("#bot-token").value = cfg ? cfg.token : "";
    $("#chat-id").value = cfg ? cfg.chat : "";
    $("#send-time").value = cfg ? cfg.time : "09:00";
    scheduleDialog.showModal();
  }

  async function runScheduler() {
    var cfg = load("newsflow:schedule", null);
    if (!cfg || !cfg.token || !cfg.chat || !isPro()) return;
    var now = new Date();
    var hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    if (hhmm < cfg.time) return;
    if (cfg.last === today()) return;
    if (state.busy) return;
    await collect();
    var digest = $("#digest").value.trim();
    if (!digest) { setStatus("Scheduled run found no stories, nothing was sent", false); return; }
    try {
      var out = await sendTelegram(cfg.token, cfg.chat, digest);
      cfg.last = today();
      save("newsflow:schedule", cfg);
      setStatus(out.verified ? "Scheduled post sent to " + cfg.chat : "Scheduled post submitted (the network hid the response)", false);
    } catch (e) {
      setStatus("Scheduled send failed: " + e.message, false);
    }
  }

  /* ---------------------------------------------------------------- wiring */

  function init() {
    state.sources = getSources();
    renderQuota();
    renderSourceChips();
    renderFilter();
    renderDigest();
    renderStories();
    $("#stories-empty").hidden = false;
    $("#empty-text").textContent = "Loading today’s stories…";

    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.format = tab.getAttribute("data-format");
        renderDigest();
      });
    });

    $("#btn-collect").addEventListener("click", collect);
    $("#btn-copy").addEventListener("click", function () {
      var text = $("#digest").value.trim();
      if (!text) { toast("Nothing to copy yet", true); return; }
      if (!spendPost()) { requirePro("More than " + FREE_POSTS + " posts a day"); return; }
      window.Unlock.copy(text);
    });
    $("#btn-download").addEventListener("click", function () {
      var text = $("#digest").value.trim();
      if (!text) { toast("Nothing to download yet", true); return; }
      if (!spendPost()) { requirePro("More than " + FREE_POSTS + " posts a day"); return; }
      download("newsflow-" + new Date().toISOString().slice(0, 10) + ".md", text, "text/markdown;charset=utf-8");
      toast("Post downloaded");
    });
    $("#btn-improve").addEventListener("click", function () {
      var saved = load("newsflow:key", null);
      if (saved) { $("#key-provider").value = saved.provider; $("#key-value").value = saved.key; }
      $("#key-error").hidden = true;
      keyDialog.showModal();
    });
    $("#btn-schedule").addEventListener("click", function () {
      if (!requirePro("Scheduling")) return;
      schedule();
    });
    $("#btn-export").addEventListener("click", function () {
      if (!requirePro("Export")) return;
      $("#export-dialog").showModal();
    });
    $("#btn-export-xlsx").addEventListener("click", function () { exportXlsx(); $("#export-dialog").close(); });
    $("#btn-export-csv").addEventListener("click", function () { exportCsv(); $("#export-dialog").close(); });
    $("#digest").addEventListener("input", updateCount);
    $("#story-filter").addEventListener("change", renderStories);

    document.addEventListener("unlock:changed", function () {
      renderQuota();
      renderSourceChips();
      renderDigest();
    });
    document.addEventListener("click", function (e) {
      var t = e.target.closest('[data-unlock][data-product="newsflow"]');
      if (t && isPro()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toast("Pro is active on this device. Clearing site data removes it.");
      }
    }, true);

    sourceDialog = $("#source-dialog");
    keyDialog = $("#key-dialog");
    scheduleDialog = $("#schedule-dialog");

    $("#source-form").addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.value === "add") { e.preventDefault(); addSource(); }
    });
    $("#key-form").addEventListener("submit", function (e) {
      var action = e.submitter ? e.submitter.value : "cancel";
      if (action === "run") { e.preventDefault(); rewrite(); }
      if (action === "forget") {
        e.preventDefault();
        save("newsflow:key", null);
        $("#key-value").value = "";
        toast("Key removed from this browser");
        keyDialog.close();
      }
    });
    $("#schedule-form").addEventListener("submit", function (e) {
      var action = e.submitter ? e.submitter.value : "cancel";
      if (action === "save") {
        e.preventDefault();
        var token = $("#bot-token").value.trim();
        var chat = $("#chat-id").value.trim();
        if (!token || !chat) {
          var err = $("#schedule-error");
          err.textContent = "Both the bot token and the chat id are needed.";
          err.hidden = false;
          return;
        }
        var prev = load("newsflow:schedule", {}) || {};
        save("newsflow:schedule", { token: token, chat: chat, time: $("#send-time").value || "09:00", last: prev.last || null });
        scheduleDialog.close();
        toast("Schedule saved. Keep this tab open.");
        setStatus("Scheduled daily at " + ($("#send-time").value || "09:00") + " · sends while this tab is open", false);
      }
      if (action === "stop") {
        e.preventDefault();
        save("newsflow:schedule", null);
        scheduleDialog.close();
        toast("Schedule removed");
      }
    });

    collect();
    setInterval(runScheduler, 45000);
    setTimeout(runScheduler, 4000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
