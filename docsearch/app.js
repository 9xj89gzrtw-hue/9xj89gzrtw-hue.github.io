/* Archive Studio — client-side archive search.
   No network calls except the optional Pro payment check and the optional
   user-supplied LLM endpoint. Files never leave the tab. */
(function () {
  "use strict";

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FREE_LIMIT = 25;
  const PRO_LIMIT = 10000;
  const PAGE = 10;

  const S = {
    docs: [], files: [], terms: [], results: [], query: "",
    page: 1, filter: "all", selected: null, demo: false,
    indexMs: 0, pro: false, unlock: null
  };

  const TYPE_GROUP = { eml: "mail", mbox: "mail", txt: "doc", md: "doc", csv: "table", json: "table" };
  const TYPE_LABEL = { eml: "EML", mbox: "MBOX", txt: "TXT", md: "MD", csv: "CSV", json: "JSON" };

  /* ---------- text utilities ---------- */

  const STOP = new Set(("и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем сказать всех никогда сегодня можно при над про").split(" "));
  const SUFFIX = ["иями","ями","ами","ыми","ими","ого","его","ому","ему","ов","ев","ий","ый","ая","ое","ые","ах","ях","ом","ем","ой","ей","ую","юю","ия","ии","ам","ям","ы","и","а","я","о","е","у","ю","ь"];

  function stem(t) {
    if (t.length <= 4 || /^\d+$/.test(t)) return t;
    for (const s of SUFFIX) {
      if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
    }
    return t;
  }

  function tokens(text) {
    const raw = String(text || "").toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9]+/g) || [];
    const out = [];
    for (const t of raw) {
      if (t.length < 2 && !/^\d$/.test(t)) continue;
      if (STOP.has(t)) continue;
      out.push(stem(t));
    }
    return out;
  }

  function countTokens(list) {
    const m = new Map();
    for (const t of list) m.set(t, (m.get(t) || 0) + 1);
    return m;
  }

  function fmtSize(bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    const months = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function highlight(text, terms) {
    const safe = esc(text);
    if (!terms || !terms.length) return safe;
    const uniq = Array.from(new Set(terms.filter(t => t.length >= 2))).sort((a, b) => b.length - a.length);
    if (!uniq.length) return safe;
    const re = new RegExp("(" + uniq.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    return safe.replace(re, "<mark>$1</mark>");
  }

  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || "utf-8").decode(bytes); }
    catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }

  function decodeQP(str, charset) {
    const s = str.replace(/=\n/g, "");
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(s.charCodeAt(i) & 0xff);
      }
    }
    return decodeBytes(Uint8Array.from(bytes), charset);
  }

  function decodeB64(str, charset) {
    try {
      const clean = str.replace(/\s+/g, "");
      const bin = atob(clean);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return decodeBytes(bytes, charset);
    } catch (e) { return str; }
  }

  function decodeWords(str) {
    return String(str || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
      try {
        if (enc.toUpperCase() === "B") return decodeB64(txt, cs);
        return decodeQP(txt.replace(/_/g, " "), cs);
      } catch (e) { return m; }
    });
  }

  function htmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script,style,head").forEach(n => n.remove());
      doc.querySelectorAll("br").forEach(n => n.replaceWith("\n"));
      doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4").forEach(n => n.append("\n"));
      return (doc.body ? doc.body.textContent : "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch (e) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
  }

  function parseHeaders(block) {
    const lines = block.replace(/\r\n/g, "\n").split("\n");
    const out = {};
    let key = null;
    for (const line of lines) {
      if (/^\s/.test(line) && key) { out[key] += " " + line.trim(); continue; }
      const i = line.indexOf(":");
      if (i < 1) continue;
      key = line.slice(0, i).trim().toLowerCase();
      out[key] = line.slice(i + 1).trim();
    }
    return out;
  }

  function bodyText(body, headers) {
    const ct = headers["content-type"] || "text/plain";
    const cs = (ct.match(/charset="?([^";]+)"?/i) || [])[1] || "utf-8";
    const enc = (headers["content-transfer-encoding"] || "").toLowerCase();
    let text = body;
    if (enc.includes("base64")) text = decodeB64(text, cs);
    else if (enc.includes("quoted-printable")) text = decodeQP(text, cs);
    else if (cs && !/utf-?8/i.test(cs)) {
      try { text = decodeBytes(Uint8Array.from(text, c => c.charCodeAt(0) & 0xff), cs); } catch (e) { /* keep */ }
    }
    if (/text\/html/i.test(ct)) text = htmlToText(text);
    return text.trim();
  }

  function emlDoc(raw, fileName) {
    raw = String(raw).replace(/\r\n/g, "\n");
    const cut = raw.indexOf("\n\n");
    const head = cut >= 0 ? raw.slice(0, cut) : raw;
    let body = cut >= 0 ? raw.slice(cut + 2) : "";
    const h = parseHeaders(head);
    const ct = h["content-type"] || "";

    if (/multipart/i.test(ct)) {
      const b = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
      if (b) {
        const parts = body.split("--" + b);
        let plain = "", html = "";
        for (const p of parts) {
          const pc = p.indexOf("\n\n");
          if (pc < 0) continue;
          const ph = parseHeaders(p.slice(0, pc));
          const pct = ph["content-type"] || "";
          const txt = bodyText(p.slice(pc + 2), ph);
          if (/text\/plain/i.test(pct) && txt.length > plain.length) plain = txt;
          if (/text\/html/i.test(pct) && txt.length > html.length) html = txt;
        }
        body = plain || html || body;
      }
    } else {
      body = bodyText(body, h);
    }

    const from = decodeWords(h.from || "");
    const to = decodeWords(h.to || "");
    const cc = decodeWords(h.cc || "");
    const subject = decodeWords(h.subject || "") || fileName.replace(/\.[^.]+$/, "");
    const date = h.date ? new Date(h.date) : null;
    const iso = date && !isNaN(date) ? date.toISOString().slice(0, 10) : (fileName.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
    return {
      subject, from, to, cc, date: iso, body,
      attachments: /name=|filename=/i.test(raw) ? (raw.match(/filename="?([^"\n;]+)"?/gi) || []).map(x => x.replace(/filename="?/i, "").replace(/"/g, "")).slice(0, 8) : []
    };
  }

  function docFromObject(obj, fileName, idx) {
    const pick = (...keys) => {
      for (const k of keys) if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
      return "";
    };
    const subject = pick("subject", "title", "name", "question", "theme") || `${fileName} — запись ${idx + 1}`;
    const from = pick("from", "sender", "author", "email");
    const to = pick("to", "recipient");
    const dateRaw = pick("date", "created_at", "createdAt", "timestamp", "sent");
    const d = dateRaw ? new Date(dateRaw) : null;
    const date = d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
    let body = pick("body", "text", "content", "description", "message", "notes");
    const extras = [];
    for (const [k, v] of Object.entries(obj)) {
      if (["subject","title","name","question","theme","from","sender","author","email","to","recipient","date","created_at","createdAt","timestamp","sent","body","text","content","description","message","notes"].includes(k)) continue;
      if (v == null || typeof v === "object") continue;
      extras.push(`${k}: ${v}`);
    }
    if (extras.length) body += (body ? "\n\n" : "") + extras.join("\n");
    return { subject, from, to, date, body: body.trim(), attachments: [] };
  }

  /* ---------- file readers ---------- */

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("read failed"));
      r.readAsText(file, "utf-8");
    });
  }

  function csvRows(text) {
    const rows = []; let row = []; let cell = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === "," || c === ";") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }

  async function docsFromFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const text = await readAsText(file);
    const out = [];
    if (ext === "eml") {
      out.push({ ...emlDoc(text, file.name), type: "eml" });
    } else if (ext === "mbox") {
      const chunks = text.split(/^From .*$/m).filter(c => c.trim().length > 20);
      for (const c of chunks) out.push({ ...emlDoc(c, file.name), type: "mbox" });
    } else if (ext === "csv") {
      const rows = csvRows(text);
      const head = rows.shift() || [];
      rows.forEach((r, i) => {
        const body = head.map((h, j) => `${h || "col" + (j + 1)}: ${r[j] || ""}`).join("\n");
        out.push({
          subject: r[0] && r[0].length < 120 ? r[0] : `${file.name} — строка ${i + 1}`,
          from: "", to: "", date: "", body, attachments: [], type: "csv"
        });
      });
    } else if (ext === "json") {
      let data;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (Array.isArray(data)) {
        data.forEach((item, i) => {
          if (item && typeof item === "object") out.push({ ...docFromObject(item, file.name, i), type: "json" });
          else out.push({ subject: `${file.name} — ${i + 1}`, from: "", to: "", date: "", body: String(item), attachments: [], type: "json" });
        });
      } else if (data && typeof data === "object") {
        const arrKey = ["emails","messages","documents","items","records","data"].find(k => Array.isArray(data[k]));
        if (arrKey) data[arrKey].forEach((item, i) => out.push({ ...docFromObject(item, file.name, i), type: "json" }));
        else out.push({ ...docFromObject(data, file.name, 0), type: "json" });
      } else {
        out.push({ subject: file.name, from: "", to: "", date: "", body: text, attachments: [], type: "json" });
      }
    } else {
      const heading = (text.match(/^#\s+(.+)$/m) || [])[1];
      out.push({
        subject: heading || file.name.replace(/\.[^.]+$/, ""),
        from: "", to: "", date: (file.name.match(/\d{4}-\d{2}-\d{2}/) || [""])[0],
        body: text, attachments: [], type: ext === "md" ? "md" : "txt"
      });
    }
    for (const d of out) {
      d.name = file.name;
      d.fileId = file._id;
      d.size = file.size;
      d.id = "d" + Math.random().toString(36).slice(2, 9);
      d.body = d.body || "";
      d.subject = d.subject || file.name;
      d.from = d.from || "";
      d.date = d.date || "";
      d.attachments = d.attachments || [];
    }
    return out;
  }

  /* ---------- index + search ---------- */

  function buildIndex() {
    const t0 = performance.now();
    const fields = ["title", "from", "body"];
    const df = { title: new Map(), from: new Map(), body: new Map() };
    let totalLen = 0;
    for (const d of S.docs) {
      d._f = {};
      const title = `${d.subject} ${d.name}`;
      const from = `${d.from} ${d.to || ""}`;
      d._f.title = countTokens(tokens(title));
      d._f.from = countTokens(tokens(from));
      d._f.body = countTokens(tokens(d.body));
      d._len = (d._f.title.size + d._f.from.size + d._f.body.size) || 1;
      totalLen += d._len;
      for (const f of fields) for (const t of d._f[f].keys()) df[f].set(t, (df[f].get(t) || 0) + 1);
    }
    S.df = df;
    S.avgLen = totalLen / Math.max(1, S.docs.length);
    S.indexMs = Math.max(1, Math.round(performance.now() - t0));
  }

  function parseQuery(q) {
    const filters = {};
    let text = q;
    text = text.replace(/\b(from|to|type|date):("[^"]+"|\S+)/gi, (m, k, v) => {
      filters[k.toLowerCase()] = v.replace(/^"|"$/g, "").toLowerCase();
      return "";
    });
    const phrases = [];
    text = text.replace(/"([^"]+)"/g, (m, p) => { phrases.push(p.toLowerCase()); return " " + p + " "; });
    const terms = tokens(text);
    return { terms, phrases, filters, raw: q.trim() };
  }

  function scoreDoc(d, q) {
    const k1 = 1.35, b = 0.7;
    let score = 0;
    const seen = new Set();
    for (const t of q.terms) {
      if (seen.has(t)) continue;
      seen.add(t);
      for (const f of ["title", "from", "body"]) {
        const tf = d._f[f].get(t) || 0;
        if (!tf) continue;
        const n = S.docs.length;
        const df = S.df[f].get(t) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const w = f === "title" ? 2.5 : f === "from" ? 1.5 : 1;
        score += w * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d._len / S.avgLen));
      }
    }
    const hay = `${d.subject} ${d.name} ${d.from} ${d.body}`.toLowerCase().replace(/ё/g, "е");
    for (const p of q.phrases) if (hay.includes(p)) score += 8;
    if (q.raw && hay.includes(q.raw.toLowerCase())) score += 10;
    if (q.terms.length && score > 0) {
      const age = d.date ? (Date.now() - new Date(d.date).getTime()) / 864e5 : 400;
      score += Math.max(0, 2.5 - age / 120);
    }
    return score;
  }

  function search(raw) {
    const q = parseQuery(raw);
    S.query = raw;
    S.terms = q.terms.slice();
    if (!raw.trim()) {
      S.results = plainResults();
      S.page = 1;
      S.selected = S.results.length ? S.results[0].doc.id : null;
      return;
    }
    const out = [];
    for (const d of S.docs) {
      if (q.filters.type && !d.type.includes(q.filters.type) && !TYPE_GROUP[d.type].includes(q.filters.type)) continue;
      if (q.filters.from && !(d.from + " " + d.name).toLowerCase().includes(q.filters.from)) continue;
      if (q.filters.to && !(d.to || "").toLowerCase().includes(q.filters.to)) continue;
      if (q.filters.date && !(d.date || "").includes(q.filters.date)) continue;
      const s = scoreDoc(d, q);
      if (s > 0) out.push({ doc: d, score: s });
    }
    out.sort((a, b) => b.score - a.score || String(b.doc.date).localeCompare(String(a.doc.date)));
    S.results = out;
    S.page = 1;
    S.selected = out.length ? out[0].doc.id : null;
  }

  function plainResults() {
    return S.docs.slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(d => ({ doc: d, score: 0 }));
  }

  function snippet(body, terms) {
    if (!body) return "";
    const flat = body.replace(/\s+/g, " ").trim();
    const lower = flat.toLowerCase();
    let best = -1, bestCount = 0;
    const step = 90;
    for (let i = 0; i < flat.length; i += step) {
      const win = lower.slice(i, i + 260);
      let c = 0;
      for (const t of terms) if (win.includes(t)) c++;
      if (c > bestCount) { bestCount = c; best = i; }
    }
    let start = Math.max(0, (best < 0 ? 0 : best) - 30);
    let text = flat.slice(start, start + 300);
    if (start > 0) text = "…" + text;
    if (start + 300 < flat.length) text += "…";
    return text;
  }

  /* ---------- requisites ---------- */

  function requisites(doc) {
    const body = doc.body || "";
    const out = [];
    const add = (type, value, m) => {
      const v = String(value).trim();
      if (!v) return;
      if (out.some(x => x.type === type && x.value === v)) return;
      out.push({ type, value: v, context: body.slice(Math.max(0, m.index - 40), m.index + 90).replace(/\s+/g, " ") });
    };
    let m;
    const reInn = /\bИНН[:\s]*(\d{10}|\d{12})\b/gi;
    while ((m = reInn.exec(body))) add("ИНН", m[1], m);
    const reKpp = /\bКПП[:\s]*(\d{9})\b/gi;
    while ((m = reKpp.exec(body))) add("КПП", m[1], m);
    const reAcc = /(?:р\/с|расч[её]тный\s+сч[её]т)[:\s]*(\d{20})/gi;
    while ((m = reAcc.exec(body))) add("Счёт", m[1], m);
    const reBik = /\bБИК[:\s]*(\d{9})\b/gi;
    while ((m = reBik.exec(body))) add("БИК", m[1], m);
    const reSum = /(\d[\d\s]{2,}(?:[.,]\d{2})?)\s*(?:₽|руб(?:\.|лей)?)/gi;
    while ((m = reSum.exec(body))) add("Сумма", m[1].replace(/\s+/g, " ") + " ₽", m);
    const reContract = /(?:договор[а-яё]*\s*(?:№\s*)?)([А-ЯA-Z]{2,6}[-–/]\d{1,4}(?:\/\d{2,4})?)/gi;
    while ((m = reContract.exec(body))) add("Договор", m[1], m);
    const reDate = /\b\d{2}\.\d{2}\.\d{4}\b/g;
    while ((m = reDate.exec(body))) add("Дата", m[0], m);
    const rePhone = /\+7[\d\s()-]{10,}\d/g;
    while ((m = rePhone.exec(body))) add("Телефон", m[0].trim(), m);
    return out;
  }

  /* ---------- rendering ---------- */

  function fileIcon(type) {
    if (TYPE_GROUP[type] === "mail") return '<svg class="file-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
    if (TYPE_GROUP[type] === "table") return '<svg class="file-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>';
    return '<svg class="file-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>';
  }

  function renderSidebar() {
    $("#stDocs").textContent = S.docs.length;
    $("#stSize").textContent = fmtSize(S.files.reduce((a, f) => a + f.size, 0));
    $("#archiveCount").textContent = `${S.files.length} ${S.files.length === 1 ? "файл" : "файлов"}`;
    const list = $("#fileList");
    list.innerHTML = S.files.map(f => `
      <li class="file-item" title="${esc(f.name)}">
        ${fileIcon(f.type)}
        <span class="file-name">${esc(f.name)}</span>
        <span class="file-count">${f.count}</span>
        <button class="file-del" data-del="${f.id}" aria-label="Удалить ${esc(f.name)}" title="Удалить">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5 5 19"/></svg>
        </button>
      </li>`).join("");
    $("#sideEmpty").classList.toggle("hidden", S.files.length > 0);
  }

  function groupFilter(d) {
    if (S.filter === "all") return true;
    return TYPE_GROUP[d.type] === S.filter;
  }

  function renderResults() {
    const hasQuery = S.query.trim().length > 0;
    const all = S.results;
    const rows = all.filter(r => groupFilter(r.doc));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (S.page > pages) S.page = pages;
    const slice = rows.slice((S.page - 1) * PAGE, S.page * PAGE);

    $("#emptyState").classList.toggle("hidden", S.docs.length > 0);
    $("#resultsBlock").classList.toggle("hidden", S.docs.length === 0);

    const mail = S.docs.filter(d => TYPE_GROUP[d.type] === "mail").length;
    const doc = S.docs.filter(d => TYPE_GROUP[d.type] === "doc").length;
    const table = S.docs.filter(d => TYPE_GROUP[d.type] === "table").length;
    $("#filters").innerHTML = [
      ["all", `Все ${S.docs.length}`], ["mail", `Письма ${mail}`], ["doc", `Документы ${doc}`], ["table", `Таблицы ${table}`]
    ].map(([k, label]) => `<button class="filter ${S.filter === k ? "on" : ""}" data-filter="${k}">${label}</button>`).join("");

    $("#resTitle").textContent = hasQuery ? `«${S.query.trim()}»` : (S.demo ? "Демо-архив строительной компании" : "Весь архив");
    const ms = hasQuery ? ` · ${S.indexMs} мс на индекс` : "";
    $("#resMeta").textContent = `${total} ${total === 1 ? "документ" : total < 5 ? "документа" : "документов"}${ms}`;

    $("#resultList").innerHTML = slice.map((r, i) => {
      const d = r.doc;
      const snip = hasQuery ? snippet(d.body, S.terms) : d.body.replace(/\s+/g, " ").slice(0, 230);
      return `<article class="result ${S.selected === d.id ? "sel" : ""}" data-id="${d.id}" tabindex="0">
        <div class="result-top">
          <span class="tag">${TYPE_LABEL[d.type] || d.type}</span>
          <span class="result-subject">${highlight(d.subject, S.terms)}</span>
          <span class="result-date">${esc(fmtDate(d.date))}</span>
        </div>
        <p class="result-from">${esc(d.from || d.name)}</p>
        <p class="result-snippet">${highlight(snip, S.terms)}</p>
        <div class="result-foot"><span>${esc(d.name)}</span>${hasQuery ? `<span class="score">релевантность ${r.score.toFixed(1)}</span>` : ""}</div>
      </article>`;
    }).join("") || `<p class="empty-side" style="padding:20px 4px">Ничего не найдено. Попробуйте другой запрос или снимите фильтр.</p>`;

    if (pages > 1) {
      $("#pager").innerHTML = Array.from({ length: pages }, (_, i) => i + 1)
        .filter(n => n === 1 || n === pages || Math.abs(n - S.page) <= 2)
        .map((n, idx, arr) => `${idx && n - arr[idx - 1] > 1 ? '<span style="color:var(--faint);font-size:11px">…</span>' : ""}<button data-page="${n}" class="${n === S.page ? "on" : ""}">${n}</button>`).join("");
    } else $("#pager").innerHTML = "";
  }

  function renderPreview() {
    const d = S.docs.find(x => x.id === S.selected);
    if (!d) {
      $("#previewEmpty").classList.remove("hidden");
      $("#previewBody").classList.add("hidden");
      return;
    }
    $("#previewEmpty").classList.add("hidden");
    $("#previewBody").classList.remove("hidden");
    const reqs = requisites(d);
    const shown = S.pro ? reqs : reqs.slice(0, 6);
    $("#previewBody").innerHTML = `
      <div class="preview-head">
        <p class="preview-kicker">${TYPE_LABEL[d.type] || d.type} · исходный файл</p>
        <h2 class="preview-subject">${highlight(d.subject, S.terms)}</h2>
        <div class="preview-meta">
          ${d.from ? `<b>От:</b> ${esc(d.from)}<br>` : ""}
          ${d.to ? `<b>Кому:</b> ${esc(d.to)}<br>` : ""}
          <b>Дата:</b> ${esc(fmtDate(d.date) || "не указана")}<br>
          <b>Файл:</b> ${esc(d.name)}
        </div>
      </div>
      <div class="preview-body">${highlight(d.body, S.terms)}</div>
      ${d.attachments && d.attachments.length ? `<div class="pro-section"><h3>Вложения</h3>${d.attachments.map(a => `<div class="req-row"><span class="req-type">файл</span><span class="req-val">${esc(a)}</span></div>`).join("")}</div>` : ""}
      <div class="pro-section ${S.pro || reqs.length <= 6 ? "" : "locked"}">
        <h3>Реквизиты и суммы</h3>
        ${shown.map(r => `<div class="req-row"><span class="req-type">${esc(r.type)}</span><span class="req-val">${esc(r.value)}</span></div>`).join("") || '<p class="lock-note">В документе не найдено явных реквизитов.</p>'}
      </div>
      ${!S.pro && reqs.length > 6 ? `<p class="lock-note">Ещё ${reqs.length - 6} значений — в Pro, вместе с выгрузкой в CSV.</p>` : ""}
      <div class="preview-actions">
        <button class="btn" id="downloadTxt" type="button">Скачать .txt</button>
        <button class="btn" id="llmBtn" type="button">Справка</button>
        ${S.pro ? `<button class="btn" id="csvBtn" type="button">CSV реквизитов</button>` : `<button class="btn" id="proInline" type="button">Pro для выгрузки</button>`}
      </div>`;
  }

  function renderAll() {
    renderSidebar();
    renderResults();
    renderPreview();
  }

  /* ---------- index persistence ---------- */

  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("archive-studio", 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("index")) r.result.createObjectStore("index"); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function saveIndex() {
    try {
      const db = await idb();
      const tx = db.transaction("index", "readwrite");
      tx.objectStore("index").put({
        savedAt: new Date().toISOString(),
        files: S.files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, count: f.count })),
        docs: S.docs.map(d => ({ ...d, _f: undefined }))
      }, "current");
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      toast(`Индекс сохранён: ${S.docs.length} документов`);
    } catch (e) { toast("Не удалось сохранить индекс: " + e.message); }
  }

  async function loadIndex() {
    try {
      const db = await idb();
      const tx = db.transaction("index", "readonly");
      const req = tx.objectStore("index").get("current");
      const val = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
      if (!val || !val.docs) { toast("Сохранённого индекса нет"); return; }
      S.docs = val.docs; S.files = val.files || []; S.demo = false;
      buildIndex(); S.query = ""; S.results = plainResults(); S.page = 1;
      S.selected = S.docs[0] ? S.docs[0].id : null;
      $("#q").value = "";
      renderAll();
      toast(`Загружено ${S.docs.length} документов, сохранено ${new Date(val.savedAt).toLocaleString("ru-RU")}`);
    } catch (e) { toast("Не удалось загрузить индекс: " + e.message); }
  }

  /* ---------- adding files ---------- */

  function ownDocCount() {
    return S.docs.filter(d => d.fileId !== "demo").length;
  }

  function addDocs(docs, fileMeta) {
    const limit = S.pro ? PRO_LIMIT : FREE_LIMIT;
    const own = ownDocCount();
    if (own >= limit) {
      if (!S.pro) openPro();
      else toast("Достигнут предел 10 000 документов");
      return 0;
    }
    const take = docs.slice(0, limit - own);
    S.docs.push(...take);
    const counts = {};
    for (const d of take) counts[d.fileId] = (counts[d.fileId] || 0) + 1;
    for (const f of fileMeta) S.files.push({ ...f, count: counts[f.id] || 0 });
    S.demo = false;
    if (take.length < docs.length) {
      toast(`Обработано ${take.length} из ${docs.length}: бесплатный лимит 25 файлов`);
      if (!S.pro) setTimeout(openPro, 500);
    }
    buildIndex();
    if (S.query.trim()) search(S.query); else S.results = plainResults();
    if (!S.selected && S.docs.length) S.selected = S.docs[0].id;
    renderAll();
    return take.length;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => /\.(eml|mbox|txt|md|csv|json)$/i.test(f.name));
    if (!files.length) { toast("Поддерживаются .eml, .mbox, .txt, .md, .csv, .json"); return; }
    const room = (S.pro ? PRO_LIMIT : FREE_LIMIT) - ownDocCount();
    if (room <= 0) { if (!S.pro) openPro(); return; }
    const meta = [];
    let added = 0;
    for (const f of files) {
      if (added >= room) break;
      f._id = "f" + Math.random().toString(36).slice(2, 9);
      try {
        const docs = await docsFromFile(f);
        const take = docs.slice(0, room - added);
        if (take.length) {
          const n = addDocs(take, [{ id: f._id, name: f.name, type: (f.name.split(".").pop() || "txt").toLowerCase(), size: f.size }]);
          added += n;
        }
      } catch (e) { toast(`Не удалось прочитать ${f.name}`); }
    }
    if (!files.length) return;
  }

  function loadDemo() {
    const docs = window.DEMO_DOCS.map((d, i) => ({
      ...d, id: "demo" + i, name: d.name, fileId: "demo",
      type: (d.name.split(".").pop() || "eml").toLowerCase(), size: d.body.length, attachments: d.attachments || []
    }));
    S.docs = docs;
    S.files = [{ id: "demo", name: `Демо-архив · ${docs.length}`, type: "eml", size: docs.reduce((a, d) => a + d.size, 0), count: docs.length }];
    S.demo = true;
    buildIndex();
    S.query = "";
    S.results = plainResults();
    S.page = 1;
    S.selected = S.results[0] ? S.results[0].doc.id : null;
    $("#q").value = "";
    renderAll();
    try { localStorage.setItem("archive-studio:seen", "1"); } catch (e) { /* ignore */ }
  }

  function clearAll() {
    S.docs = []; S.files = []; S.results = []; S.query = ""; S.selected = null; S.demo = false;
    $("#q").value = "";
    renderAll();
    toast("Архив очищен. Файлы удалены из этой вкладки.");
  }

  /* ---------- pro ---------- */

  function openPro() {
    if (S.pro) { toast("Pro уже активен в этом браузере"); return; }
    $("#proModalBg").classList.add("open");
    setTimeout(() => $("#txHash").focus(), 50);
  }

  function closePro() { $("#proModalBg").classList.remove("open"); }

  function applyPro() {
    S.pro = true;
    $("#proPill").classList.remove("hidden");
    $("#proBtn").textContent = "Pro активен";
    renderPreview();
  }

  async function verifyPayment() {
    const btn = $("#verifyBtn"), st = $("#payStatus");
    const hash = $("#txHash").value.trim();
    st.className = "status busy"; st.textContent = "Проверяем транзакцию в Base…";
    btn.disabled = true;
    try {
      const res = await S.unlock.verify(hash);
      st.className = "status ok";
      st.textContent = `Оплата подтверждена: ${(Number(res.received) / 1e6).toFixed(2)} USDC. Pro включён.`;
      applyPro();
      setTimeout(() => { closePro(); toast("Pro включён. Лимит увеличен до 10 000 документов."); }, 900);
    } catch (e) {
      st.className = "status err"; st.textContent = e.message;
    } finally { btn.disabled = false; }
  }

  /* ---------- export ---------- */

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportCsv(onlySelected) {
    if (!S.pro) { openPro(); return; }
    const docs = onlySelected && S.selected ? S.docs.filter(d => d.id === S.selected) : S.docs;
    const rows = [["Документ", "Дата", "Отправитель", "Тип", "Значение", "Контекст"]];
    for (const d of docs) {
      for (const r of requisites(d)) rows.push([d.name, d.date || "", d.from || "", r.type, r.value, r.context]);
    }
    const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    download(`archive-requisites-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
    toast(`Выгружено ${rows.length - 1} значений`);
  }

  /* ---------- llm ---------- */

  function openLlm() {
    if (!S.pro) { openPro(); return; }
    $("#llmModalBg").classList.add("open");
  }

  function closeLlm() { $("#llmModalBg").classList.remove("open"); }

  async function runLlm() {
    const endpoint = $("#llmEndpoint").value.trim().replace(/\/+$/, "");
    const key = $("#llmKey").value.trim();
    const model = $("#llmModel").value.trim();
    const st = $("#llmStatus"), out = $("#llmAnswer");
    if (!key) { st.className = "status err"; st.textContent = "Введите API key."; return; }
    st.className = "status busy"; st.textContent = "Готовим справку…"; out.classList.add("hidden");
    const docs = (S.results.length ? S.results.map(r => r.doc) : S.docs).slice(0, 8);
    const context = docs.map((d, i) => `[${i + 1}] ${d.subject} (${d.name}, ${d.date || "без даты"})\n${d.body.slice(0, 1600)}`).join("\n\n");
    const question = S.query.trim() || "Кратко изложи состояние дел по архиву: договоры, суммы, риски и сроки.";
    try {
      const res = await fetch(endpoint + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            { role: "system", content: "Ты — помощник по архиву документов. Отвечай по-русски, только по приведённым источникам. После каждого утверждения ставь ссылку в квадратных скобках, например [1]. Если данных нет, скажи об этом прямо." },
            { role: "user", content: `Вопрос: ${question}\n\nИсточники:\n${context}` }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : "HTTP " + res.status);
      const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      if (!text) throw new Error("Пустой ответ модели.");
      out.innerHTML = esc(text).replace(/\n/g, "<br>");
      out.classList.remove("hidden");
      st.className = "status ok"; st.textContent = "Готово. Проверьте ссылки на источники.";
    } catch (e) {
      st.className = "status err";
      st.textContent = "Ошибка запроса: " + e.message + ". Проверьте endpoint, ключ и CORS.";
    }
  }

  /* ---------- events ---------- */

  function bind() {
    $("#pickBtn").addEventListener("click", () => $("#fileInput").click());
    $("#emptyPick").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", e => { handleFiles(e.target.files); e.target.value = ""; });
    $("#emptyDemo").addEventListener("click", loadDemo);
    $("#demoBtn").addEventListener("click", loadDemo);

    const drop = $("#drop");
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
    drop.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
    const pane = $("#resultsPane");
    ["dragenter", "dragover"].forEach(ev => pane.addEventListener(ev, e => e.preventDefault()));
    pane.addEventListener("drop", e => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

    let t;
    $("#q").addEventListener("input", e => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { search(v); renderAll(); }, 60);
    });
    $("#q").addEventListener("keydown", e => {
      if (e.key === "Escape") { e.target.value = ""; search(""); S.selected = null; renderAll(); }
    });
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
      if (e.key === "Escape") { closePro(); closeLlm(); }
    });

    $("#chips").addEventListener("click", e => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      $("#q").value = b.dataset.q;
      search(b.dataset.q); renderAll();
    });

    $("#filters").addEventListener("click", e => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      S.filter = b.dataset.filter; S.page = 1; renderResults();
    });

    $("#resultList").addEventListener("click", e => {
      const card = e.target.closest("[data-id]");
      if (!card) return;
      S.selected = card.dataset.id;
      renderResults(); renderPreview();
    });
    $("#resultList").addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const card = e.target.closest("[data-id]");
      if (card) { S.selected = card.dataset.id; renderResults(); renderPreview(); }
    });

    $("#pager").addEventListener("click", e => {
      const b = e.target.closest("[data-page]");
      if (!b) return;
      S.page = Number(b.dataset.page); renderResults();
      $("#resultsPane").scrollIntoView({ block: "start", behavior: "smooth" });
    });

    $("#fileList").addEventListener("click", e => {
      const b = e.target.closest("[data-del]");
      if (!b) return;
      const id = b.dataset.del;
      S.docs = S.docs.filter(d => d.fileId !== id);
      S.files = S.files.filter(f => f.id !== id);
      if (S.selected && !S.docs.some(d => d.id === S.selected)) S.selected = null;
      buildIndex();
      if (S.query.trim()) search(S.query); else S.results = plainResults();
      renderAll();
    });

    $("#previewBody").addEventListener("click", e => {
      if (e.target.closest("#downloadTxt")) {
        const d = S.docs.find(x => x.id === S.selected);
        if (d) download(`${d.subject.replace(/[^\wа-яА-Я\- ]+/g, "").slice(0, 60) || "document"}.txt`,
          `${d.subject}\n${d.from}\n${d.date}\n\n${d.body}`);
      }
      if (e.target.closest("#llmBtn")) openLlm();
      if (e.target.closest("#csvBtn")) exportCsv(true);
      if (e.target.closest("#proInline")) openPro();
    });

    $("#proBtn").addEventListener("click", openPro);
    $("#proClose").addEventListener("click", closePro);
    $("#proModalBg").addEventListener("click", e => { if (e.target === $("#proModalBg")) closePro(); });
    $("#verifyBtn").addEventListener("click", verifyPayment);
    $("#txHash").addEventListener("keydown", e => { if (e.key === "Enter") verifyPayment(); });
    $("#copyAddr").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(S.unlock.PAY_TO); toast("Адрес скопирован"); }
      catch (e) { toast("Скопируйте адрес вручную"); }
    });

    $("#llmClose").addEventListener("click", closeLlm);
    $("#llmModalBg").addEventListener("click", e => { if (e.target === $("#llmModalBg")) closeLlm(); });
    $("#llmRun").addEventListener("click", runLlm);

    $("#mobilePreviewBtn").addEventListener("click", () => {
      if (!S.selected) { toast("Сначала выберите документ"); return; }
      const d = S.docs.find(x => x.id === S.selected);
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<meta charset="utf-8"><title>${esc(d.subject)}</title><body style="max-width:720px;margin:40px auto;font:16px/1.6 -apple-system,sans-serif;color:#222"><h1 style="font-size:22px">${esc(d.subject)}</h1><p style="color:#666">${esc(d.from)} · ${esc(d.date)} · ${esc(d.name)}</p><pre style="white-space:pre-wrap;font:inherit">${esc(d.body)}</pre></body>`);
      w.document.close();
    });

    $("#saveIdx").addEventListener("click", saveIndex);
    $("#loadIdx").addEventListener("click", loadIndex);
  }

  function boot() {
    S.unlock = ProUnlock.create({ priceUnits: 15000000n, storageKey: "archive-studio:pro" });
    S.pro = S.unlock.isPro();
    if (S.pro) { $("#proPill").classList.remove("hidden"); $("#proBtn").textContent = "Pro активен"; }
    // Saved index wins over the demo; a first visit opens the demo so the page
    // is useful before the visitor finds a file.
    let seen = false;
    try { seen = localStorage.getItem("archive-studio:seen") === "1"; } catch (e) { /* ignore */ }
    bind();
    if (!seen) loadDemo();
    else { renderAll(); }
    if (!S.docs.length) renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
