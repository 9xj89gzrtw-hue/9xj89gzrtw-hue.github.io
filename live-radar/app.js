/* Live Radar — static client. Data: Polymarket Gamma API + TonAPI. */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const GAMMA_PAGES = [0, 100, 200, 300, 400];
  const GAMMA_FALLBACK = "https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false";
  const marketUrl = offset => "https://gamma-api.polymarket.com/markets?limit=100&offset=" + offset + "&active=true&closed=false&order=volume24hr&ascending=false";
  const TON_RATE = "https://tonapi.io/v2/rates?tokens=ton&currencies=usd";
  const FREE_ROWS = 10;
  const LOCKED_ROWS = 8;

  const S = {
    markets: [],
    rows: [],
    selected: null,
    pro: false,
    q: "",
    cat: "all",
    sort: "score",
    minScore: 0,
    tab: "markets",
    ton: null,
    loading: false,
    loadSeq: 0,
    ts: null,
    unlock: null
  };

  /* ---------- format ---------- */

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function fmtMoney(n) {
    const v = Math.abs(n);
    if (v >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }

  function fmtCents(p) {
    const c = num(p) * 100;
    if (!c) return "—";
    if (c >= 99) return Math.min(c, 99.9).toFixed(1) + "¢";
    return (c < 10 ? Math.max(c, 0.1).toFixed(1) : String(Math.round(c))) + "¢";
  }

  function fmtChange(ch) {
    if (ch == null) return "—";
    const pp = num(ch) * 100;
    const sign = pp > 0 ? "+" : "";
    return sign + (Math.abs(pp) < 10 ? pp.toFixed(1) : Math.round(pp)) + "¢";
  }

  function fmtPct(n, digits) {
    const v = num(n);
    return (v > 0 ? "+" : "") + v.toFixed(digits == null ? 1 : digits) + "%";
  }

  function fmtTime(d) {
    return new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function parseJson(s, fallback) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function dateMs(v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }

  /* ---------- classification + scoring ---------- */

  const CATS = [
    ["Politics", /election|president|senate|house|congress|parliament|prime minister|party|trump|putin|zelensk|netanyahu|israel|iran|ukraine|russia|china|ceasefire|war|nato|government|minister|mayor|governor|referendum|vote|impeach/i],
    ["Crypto", /bitcoin|btc|ethereum|\beth\b|solana|\bxrp\b|doge|crypto|stablecoin|binance|coinbase|token|blockchain|defi|nft/i],
    ["Sports", /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|ufc|football|soccer|basketball|baseball|tennis|formula|f1|premier league|champions league|world cup|super bowl|match|game \d|playoff|championship|olympic|boxing|fight|\bvs\.?\b/i],
    ["Economy", /\bfed\b|fomc|interest rate|rate cut|rate hike|cpi|inflation|\bgdp\b|recession|unemployment|jobs report|tariff|dollar|euro|oil|gold|s&p|nasdaq|treasury|bond yield/i],
    ["Tech", /\bai\b|openai|anthropic|google|apple|microsoft|nvidia|tesla|spacex|launch|starship|iphone|android|chip|semiconductor|quantum/i],
    ["Culture", /movie|film|oscar|grammy|emmy|album|song|music|celebrity|taylor swift|box office|netflix|disney|miss universe|time person/i]
  ];

  function classify(m) {
    const text = (m.question || "") + " " + ((m.events && m.events[0] && m.events[0].title) || "");
    for (const [name, re] of CATS) if (re.test(text)) return name;
    return "Other";
  }

  function scoreMarket(m) {
    const liq = m.liq;
    const vol = m.vol;
    const spread = m.spread;
    const ch = m.change;

    const liqScore = clamp(Math.log10(liq + 10) / 6.3 * 100, 0, 100);
    const spreadScore = spread > 0 ? clamp(100 - spread / 0.05 * 100, 0, 100) : 35;
    const actScore = clamp(vol / (liq + 1) * 120, 0, 100);
    const moveScore = ch == null ? 0 : clamp(Math.abs(ch) / 0.08 * 100, 0, 100);

    let score = 0.34 * liqScore + 0.26 * spreadScore + 0.25 * actScore + 0.15 * moveScore;
    if (m.fresh) score = Math.min(100, score + 6);
    return Math.round(score);
  }

  function normalize(raw) {
    const outcomes = parseJson(raw.outcomes, []);
    const prices = parseJson(raw.outcomePrices, []).map(Number);
    if (!raw.question || !outcomes.length || !prices.length) return null;

    const liq = num(raw.liquidityNum != null ? raw.liquidityNum : raw.liquidity);
    const vol = num(raw.volume24hr);
    const spread = raw.spread == null ? null : num(raw.spread);
    const created = dateMs(raw.createdAt || raw.startDate);
    const fresh = created > 0 && Date.now() - created < 10 * 864e5;
    const event = raw.events && raw.events[0] ? raw.events[0] : null;

    let pi = 0;
    if (outcomes.length === 2 && prices[1] > prices[0] && prices[0] < 0.03) pi = 1;
    const change = raw.oneDayPriceChange == null ? null : num(raw.oneDayPriceChange);

    const m = {
      id: raw.id || raw.conditionId || raw.slug,
      slug: raw.slug,
      question: raw.question,
      event: event ? event.title : "",
      category: classify(raw),
      outcomes: outcomes.map(String),
      prices: outcomes.map((_, i) => clamp(num(prices[i]), 0, 1)),
      pi,
      primary: clamp(num(prices[pi]), 0, 1),
      primaryChange: pi === 1 && change != null ? -change : change,
      liq,
      vol,
      spread,
      change,
      createdAt: created,
      fresh,
      endDate: raw.endDate || "",
      image: raw.image || raw.icon || ""
    };
    if (m.primary > 0.985 || m.primary < 0.015) return null;
    m.score = scoreMarket(m);
    m.signal = m.score >= 70 && spread != null && spread <= 0.03 && liq >= 25000
      ? "snipe"
      : m.fresh ? "fresh"
        : m.change != null && m.change > 0 && vol > 25000 ? "green"
          : "watch";
    return m;
  }

  /* ---------- loading ---------- */

  async function getJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadMarkets(manual) {
    if (S.loading) return;
    S.loading = true;
    const seq = ++S.loadSeq;
    $("#refreshBtn").disabled = true;
    setLive("loading");

    let raw;
    try {
      const settled = await Promise.allSettled(GAMMA_PAGES.map(o => getJson(marketUrl(o))));
      const pages = settled.filter(r => r.status === "fulfilled" && Array.isArray(r.value)).map(r => r.value);
      if (!pages.length) throw new Error("Gamma API недоступен");
      raw = pages.flat();
    } catch (first) {
      try {
        raw = await getJson(GAMMA_FALLBACK);
      } catch (second) {
        if (seq !== S.loadSeq) return;
        S.loading = false;
        $("#refreshBtn").disabled = false;
        setLive("off");
        showError("Не удалось загрузить рынки Polymarket: " + (second.message || first.message) + ". Проверьте соединение и обновите страницу.");
        if (manual) toast("Нет связи с Polymarket");
        return;
      }
    }

    if (seq !== S.loadSeq) return;
    const seen = new Set();
    const list = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const m = normalize(item);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      list.push(m);
    }

    if (!list.length) {
      S.loading = false;
      $("#refreshBtn").disabled = false;
      setLive("off");
      showError("Polymarket вернул пустой список. Попробуйте обновить через минуту.");
      return;
    }

    S.markets = list;
    S.ts = Date.now();
    S.loading = false;
    $("#refreshBtn").disabled = false;
    hideError();
    setLive("live");
    renderAll();
    if (manual) toast("Данные обновлены · " + list.length + " рынков");
  }

  async function loadTon() {
    try {
      const j = await getJson(TON_RATE, 12000);
      const rate = j && j.rates && j.rates.TON && j.rates.TON.prices && j.rates.TON.prices.USD;
      if (!Number.isFinite(Number(rate))) throw new Error("no rate");
      S.ton = Number(rate);
      const diff = (j.rates.TON.diff_24h && j.rates.TON.diff_24h.USD) || "";
      $("#tonPrice").textContent = "$" + S.ton.toFixed(3);
      $("#tonSource").textContent = (diff ? diff + " за 24ч · " : "") + "TonAPI";
      renderGiftCalc();
    } catch (e) {
      S.ton = null;
      $("#tonPrice").textContent = "—";
      $("#tonSource").textContent = "курс недоступен · обновите страницу";
      renderGiftCalc();
    }
  }

  function setLive(mode) {
    const dot = $("#liveDot");
    const txt = $("#liveText");
    dot.classList.toggle("off", mode === "off");
    if (mode === "loading") {
      txt.textContent = "обновление…";
      $("#updated").textContent = "запрос к Polymarket…";
    } else if (mode === "off") {
      txt.textContent = "нет связи";
      $("#updated").textContent = "данные не получены";
    } else {
      txt.textContent = "live";
      $("#updated").innerHTML = "обновлено " + fmtTime(S.ts) + "<br>" + S.markets.length + " рынков";
    }
  }

  function showError(msg) {
    const box = $("#error");
    box.textContent = msg;
    box.classList.remove("hidden");
  }
  function hideError() { $("#error").classList.add("hidden"); }

  /* ---------- filtering ---------- */

  function filtered() {
    const terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = S.markets.filter(m => {
      if (S.cat !== "all" && m.category !== S.cat) return false;
      if (m.score < S.minScore) return false;
      if (terms.length) {
        const hay = (m.question + " " + m.event + " " + m.category).toLowerCase();
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    });

    const by = S.sort;
    out.sort((a, b) => {
      if (by === "volume") return b.vol - a.vol;
      if (by === "liquidity") return b.liq - a.liq;
      if (by === "spread") return (a.spread == null ? 9 : a.spread) - (b.spread == null ? 9 : b.spread);
      if (by === "change") return Math.abs(b.change || 0) - Math.abs(a.change || 0);
      return b.score - a.score;
    });
    return out;
  }

  /* ---------- render ---------- */

  function signalLabel(s) {
    return s === "snipe" ? "SNIPE" : s === "fresh" ? "FRESH" : s === "green" ? "GREEN" : "WATCH";
  }

  function rowHtml(m, rank, locked) {
    const ch = m.primaryChange;
    const chCls = ch > 0 ? "up" : ch < 0 ? "down" : "muted";
    const bar = m.score;
    const side = /^(yes|no)$/i.test(m.outcomes[m.pi]) ? "" : m.outcomes[m.pi] + " · ";
    const sub = m.event && m.event !== m.question ? m.event : m.category;
    return `<tr data-id="${esc(m.id)}"${locked ? ' aria-hidden="true"' : ""}>
      <td class="rank">${String(rank).padStart(2, "0")}</td>
      <td class="market"><b title="${esc(m.question)}">${esc(m.question)}</b><span>${esc(side + sub)}</span></td>
      <td class="col-hide"><span class="cat">${esc(m.category)}</span></td>
      <td class="num" title="${esc(m.outcomes[m.pi] + " · " + fmtCents(m.primary))}">${fmtCents(m.primary)}</td>
      <td class="num ${chCls} chg">${fmtChange(ch)}</td>
      <td class="num muted col-hide">${fmtMoney(m.liq)}</td>
      <td class="num muted col-hide">${m.spread == null ? "—" : (m.spread * 100).toFixed(1) + "¢"}</td>
      <td><div class="score"><b>${m.score}</b><span class="bar"><i style="width:${bar}%"></i></span></div></td>
      <td><span class="signal ${m.signal}">${signalLabel(m.signal)}</span></td>
    </tr>`;
  }

  function renderTable() {
    S.rows = filtered();
    const free = S.rows.slice(0, FREE_ROWS);
    const locked = S.rows.slice(FREE_ROWS, FREE_ROWS + LOCKED_ROWS);

    $("#tbody").innerHTML = free.length
      ? free.map((m, i) => rowHtml(m, i + 1, false)).join("")
      : `<tr><td colspan="9"><div class="empty">Ничего не найдено. Сбросьте фильтры или мин. скор.</div></td></tr>`;

    $("#tbody").querySelectorAll("tr[data-id]").forEach(tr => {
      tr.addEventListener("click", () => openDetail(tr.dataset.id));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(tr.dataset.id); });
      tr.tabIndex = 0;
    });

    const wrap = $("#lockedWrap");
    if (S.pro || !locked.length) {
      wrap.classList.add("hidden");
    } else {
      wrap.classList.remove("hidden");
      $("#lockedCount").textContent = S.rows.length - FREE_ROWS;
      $("#lockedRows").innerHTML = `<table><tbody>${locked.map((m, i) => rowHtml(m, i + FREE_ROWS + 1, true)).join("")}</tbody></table>`;
    }

    const hidden = Math.max(0, S.rows.length - FREE_ROWS);
    $("#tableMeta").textContent = S.rows.length
      ? `Показано ${Math.min(FREE_ROWS, S.rows.length)} из ${S.rows.length} после фильтра · всего в скане ${S.markets.length}${!S.pro && hidden ? " · " + hidden + " в Pro" : ""}`
      : `Нет строк под фильтром · всего в скане ${S.markets.length}`;
  }

  function renderKpis() {
    const spreads = S.markets.map(m => m.spread).filter(v => v != null && v > 0).sort((a, b) => a - b);
    const median = spreads.length ? spreads[Math.floor(spreads.length / 2)] : null;
    $("#kMarkets").textContent = S.markets.length;
    $("#kSnipe").textContent = S.markets.filter(m => m.signal === "snipe").length;
    $("#kFresh").textContent = S.markets.filter(m => m.signal === "fresh" || m.signal === "green").length;
    $("#kSpread").textContent = median == null ? "—" : (median * 100).toFixed(1);
  }

  function renderAll() {
    renderKpis();
    renderTable();
    syncProUI();
  }

  /* ---------- detail ---------- */

  function openDetail(id) {
    const m = S.markets.find(x => x.id === id);
    if (!m) return;
    S.selected = m;
    $("#detailKicker").textContent = "Polymarket · " + m.category;
    $("#detailQ").textContent = m.question;

    const meta = [
      ["Цена", fmtCents(m.primary)],
      ["24 часа", fmtChange(m.primaryChange)],
      ["Ликвидность", fmtMoney(m.liq)],
      ["Объём 24ч", fmtMoney(m.vol)],
      ["Спред", m.spread == null ? "—" : (m.spread * 100).toFixed(1) + "¢"],
      ["Скор", String(m.score)]
    ];
    $("#detailMeta").innerHTML = meta.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");

    const max = 6;
    const outs = m.outcomes.slice(0, max).map((name, i) => {
      const p = m.prices[i];
      return `<div class="outcome${i === m.pi ? " on" : ""}"><span class="nm">${esc(name)}</span><span class="ob"><i style="width:${Math.round(p * 100)}%"></i></span><span class="pr">${fmtCents(p)}</span></div>`;
    }).join("");
    $("#detailOutcomes").innerHTML = outs || `<p style="font-size:12px;color:var(--muted)">Нет данных по исходам.</p>`;

    const url = m.slug ? "https://polymarket.com/market/" + m.slug : "https://polymarket.com/markets";
    $("#detailLink").href = url;
    $("#detailCopy").onclick = async () => {
      const text = m.question + "\n" + m.outcomes[m.pi] + " " + fmtCents(m.primary) + " · " + fmtChange(m.primaryChange) + " за 24ч · скор " + m.score + "\n" + url;
      try { await navigator.clipboard.writeText(text); toast("Карточка скопирована"); }
      catch (e) { toast("Скопируйте вручную: " + url); }
    };
    $("#detailModalBg").classList.add("open");
  }

  function closeDetail() { $("#detailModalBg").classList.remove("open"); }

  /* ---------- pro ---------- */

  function openPro() {
    $("#payStatus").className = "status";
    $("#payStatus").textContent = S.pro ? "Pro уже активен в этом браузере." : "";
    $("#payStatus").className = S.pro ? "status ok" : "status";
    $("#verifyBtn").disabled = S.pro;
    $("#txHash").disabled = S.pro;
    $("#proModalBg").classList.add("open");
    if (!S.pro) setTimeout(() => $("#txHash").focus(), 40);
  }
  function closePro() { $("#proModalBg").classList.remove("open"); }

  function syncProUI() {
    const btn = $("#proBtn");
    if (S.pro) {
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg>Pro активен';
      $("#lockedWrap").classList.add("hidden");
      $("#verifyBtn").disabled = true;
      $("#txHash").disabled = true;
    } else {
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3Z"/></svg>Pro';
      $("#verifyBtn").disabled = false;
      $("#txHash").disabled = false;
    }
  }

  async function verifyPayment() {
    const btn = $("#verifyBtn"), st = $("#payStatus");
    const hash = $("#txHash").value.trim();
    st.className = "status busy";
    st.textContent = "Проверяем транзакцию в Base…";
    btn.disabled = true;
    try {
      const res = await S.unlock.verify(hash);
      st.className = "status ok";
      st.textContent = `Оплата подтверждена: ${(Number(res.received) / 1e6).toFixed(2)} USDC. Pro включён.`;
      S.pro = true;
      syncProUI();
      renderTable();
      setTimeout(() => { closePro(); toast("Pro включён: все рынки, CSV и Telegram."); }, 900);
    } catch (e) {
      st.className = "status err";
      st.textContent = e.message;
    } finally {
      if (!S.pro) btn.disabled = false;
    }
  }

  /* ---------- csv ---------- */

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function exportCsv() {
    if (!S.pro) { toast("CSV доступен в Pro"); openPro(); return; }
    const rows = filtered();
    if (!rows.length) { toast("Нет строк для экспорта"); return; }
    const head = ["rank", "question", "outcome", "event", "category", "price_cents", "change_24h_cents", "liquidity_usd", "volume_24h_usd", "spread_cents", "score", "signal", "url"];
    const lines = [head.join(";")];
    rows.forEach((m, i) => {
      const cells = [
        i + 1, m.question, m.outcomes[m.pi], m.event, m.category,
        (m.primary * 100).toFixed(1),
        m.primaryChange == null ? "" : (m.primaryChange * 100).toFixed(1),
        Math.round(m.liq), Math.round(m.vol),
        m.spread == null ? "" : (m.spread * 100).toFixed(2),
        m.score, m.signal,
        m.slug ? "https://polymarket.com/market/" + m.slug : ""
      ];
      lines.push(cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    });
    const date = new Date().toISOString().slice(0, 10);
    download("live-radar-" + date + ".csv", "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
    toast("CSV: " + rows.length + " строк");
  }

  /* ---------- calculator ---------- */

  function calc() {
    const stake = num($("#calcStake").value);
    const entry = num($("#calcEntry").value) / 100;
    const exit = num($("#calcExit").value) / 100;
    const fee = num($("#calcFee").value) / 100;

    if (!stake || entry <= 0 || entry >= 1) {
      $("#calcGross").textContent = "$0.00";
      $("#calcFees").textContent = "$0.00";
      $("#calcNet").textContent = "$0.00";
      $("#calcRoi").textContent = "0.0%";
      return;
    }
    const shares = stake / entry;
    const gross = shares * (exit - entry);
    const fees = stake * fee + shares * exit * fee;
    const net = gross - fees;
    const roi = net / stake * 100;

    $("#calcGross").textContent = (gross < 0 ? "-" : "") + "$" + Math.abs(gross).toFixed(2);
    $("#calcFees").textContent = "$" + fees.toFixed(2);
    $("#calcNet").textContent = (net < 0 ? "-" : "") + "$" + Math.abs(net).toFixed(2);
    $("#calcNet").classList.toggle("down", net < 0);
    $("#calcRoi").textContent = fmtPct(roi, 1);
    $("#calcRoi").classList.toggle("down", roi < 0);
  }

  function renderGiftCalc() {
    const ask = num($("#gAsk").value);
    const floor = num($("#gFloor").value);
    const qty = Math.max(1, Math.round(num($("#gQty").value) || 1));
    const fee = num($("#gFee").value) / 100;

    const costTon = ask * qty;
    const discount = floor > 0 ? (floor - ask) / floor * 100 : 0;
    const feeTon = floor * qty * fee;
    const profitTon = (floor - ask) * qty - feeTon;
    const maxTon = floor * (1 - fee) / 1.03;

    const usd = v => S.ton ? (v < 0 ? "-" : "") + "$" + Math.abs(v * S.ton).toFixed(2) : "—";

    $("#gCost").textContent = usd(costTon);
    $("#gDiscount").textContent = (discount > 0 ? "+" : "") + discount.toFixed(1) + "%";
    $("#gDiscount").classList.toggle("down", discount < 0);
    $("#gFeeOut").textContent = usd(feeTon);
    $("#gProfit").textContent = usd(profitTon);
    $("#gProfit").classList.toggle("down", profitTon < 0);
    $("#gMax").textContent = maxTon.toFixed(1) + " TON";
  }

  /* ---------- telegram ---------- */

  function tgMatches() {
    const min = num($("#tgMin").value);
    const cat = $("#tgCat").value;
    return S.markets
      .filter(m => m.score >= min && (cat === "all" || m.category === cat))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  function tgText() {
    const rows = tgMatches();
    const stamp = new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (!rows.length) return `<b>Live Radar</b> · ${stamp}\nНет рынков под фильтр: мин. скор ${num($("#tgMin").value)}.`;
    const lines = rows.map((m, i) =>
      `${i + 1}. <a href="https://polymarket.com/market/${esc(m.slug || "")}">${esc(m.question)}</a>\n   ${esc(m.outcomes[m.pi])} ${fmtCents(m.primary)} · ${fmtChange(m.primaryChange)} за 24ч · скор ${m.score} · ${signalLabel(m.signal)}`
    );
    return `<b>Live Radar</b> · ${stamp}\n` + lines.join("\n");
  }

  function syncTgPreview() {
    const token = $("#tgToken").value.trim();
    const chat = $("#tgChat").value.trim();
    const body = {
      chat_id: chat || "<CHAT_ID>",
      text: tgText(),
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    $("#tgPreview").value = JSON.stringify(body, null, 2);
    $("#tgSend").dataset.token = token;
  }

  function openTg() {
    if (!S.pro) { toast("Telegram-уведомления доступны в Pro"); openPro(); return; }
    syncTgPreview();
    $("#tgStatus").className = "status";
    $("#tgStatus").textContent = "";
    $("#tgModalBg").classList.add("open");
  }
  function closeTg() { $("#tgModalBg").classList.remove("open"); }

  async function sendTg() {
    const st = $("#tgStatus");
    const token = $("#tgToken").value.trim();
    const chat = $("#tgChat").value.trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      st.className = "status err"; st.textContent = "Токен не похож на токен бота: нужен формат 123456:ABC…"; return;
    }
    if (!chat) { st.className = "status err"; st.textContent = "Укажите chat_id получателя."; return; }

    const body = {
      chat_id: chat,
      text: tgText(),
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    st.className = "status busy"; st.textContent = "Отправляем через Telegram Bot API…";
    $("#tgSend").disabled = true;
    try {
      const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) {
        st.className = "status ok"; st.textContent = "Отправлено. Проверьте чат.";
        toast("Тестовое сообщение отправлено");
      } else {
        st.className = "status err"; st.textContent = "Telegram ответил: " + (j.description || "HTTP " + res.status);
      }
    } catch (e) {
      st.className = "status err";
      st.textContent = "Браузер заблокировал запрос. Скачайте JSON и отправьте из cron.";
    } finally {
      $("#tgSend").disabled = false;
    }
  }

  function downloadTg() {
    const body = {
      chat_id: $("#tgChat").value.trim() || "<CHAT_ID>",
      text: tgText(),
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    const payload = {
      method: "POST",
      url: "https://api.telegram.org/bot<BOT_TOKEN>/sendMessage",
      headers: { "content-type": "application/json" },
      body
    };
    download("telegram-radar.json", JSON.stringify(payload, null, 2), "application/json");
    toast("JSON скачан");
  }

  /* ---------- gift grid ---------- */

  const GIFTS = [
    ["Plush Pepe", "плюшевый Pepe", "https://fragment.com/gifts?query=Plush%20Pepe"],
    ["Durov's Cap", "кепка Дурова", "https://fragment.com/gifts?query=Durov%27s%20Cap"],
    ["Heart Locket", "сердце-медальон", "https://fragment.com/gifts?query=Heart%20Locket"],
    ["Vintage Cigars", "винтажные сигары", "https://fragment.com/gifts?query=Vintage%20Cigars"]
  ];

  function renderGifts() {
    $("#giftGrid").innerHTML = GIFTS.map(([name, note, url]) => `
      <a class="gift-card" href="${url}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <b>${esc(name)}</b>
        <span>${esc(note)} · Fragment</span>
        <div class="g-items">Открыть лоты →</div>
      </a>`).join("");
  }

  /* ---------- tabs ---------- */

  function setTab(tab) {
    S.tab = tab;
    const gifts = tab === "gifts";
    $("#tabMarkets").classList.toggle("on", tab === "markets");
    $("#tabGifts").classList.toggle("on", gifts);
    $("#marketsView").classList.toggle("hidden", tab !== "markets");
    $("#giftsView").classList.toggle("hidden", !gifts);
    $("#kpis").classList.toggle("hidden", gifts);
    $("#updated").classList.toggle("hidden", gifts);
    $(".page-head h1").textContent = gifts ? "Подарки Telegram: цена, скидка, выход" : "Что двигается прямо сейчас";
    $(".page-head p").textContent = gifts
      ? "Каталог популярных коллекций и живой курс TON. Считайте скидку к floor и точку безубытка до сделки на Fragment."
      : "Публичные рынки Polymarket, пересчитанные в понятный скор: ликвидность, спред, импульс и свежесть. Без регистрации и API-ключей.";
    if (history.replaceState) history.replaceState(null, "", "#" + tab);
  }

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(10px)";
    }, 2400);
  }

  /* ---------- boot ---------- */

  function bind() {
    $("#refreshBtn").addEventListener("click", () => {
      loadMarkets(true);
      loadTon();
    });

    let qTimer;
    $("#q").addEventListener("input", e => {
      clearTimeout(qTimer);
      const v = e.target.value;
      qTimer = setTimeout(() => { S.q = v.trim(); renderTable(); }, 120);
    });

    $("#cat").addEventListener("change", e => { S.cat = e.target.value; renderTable(); });
    $("#sortBy").addEventListener("change", e => { S.sort = e.target.value; renderTable(); });
    $("#minScore").addEventListener("input", e => {
      S.minScore = num(e.target.value);
      $("#minScoreVal").textContent = S.minScore;
      renderTable();
    });

    $("#exportCsv").addEventListener("click", exportCsv);

    $("#proBtn").addEventListener("click", openPro);
    $("#proInline").addEventListener("click", openPro);
    $("#proBtnGift").addEventListener("click", openPro);
    $("#proClose").addEventListener("click", closePro);
    $("#proModalBg").addEventListener("click", e => { if (e.target === $("#proModalBg")) closePro(); });
    $("#verifyBtn").addEventListener("click", verifyPayment);
    $("#txHash").addEventListener("keydown", e => { if (e.key === "Enter") verifyPayment(); });
    $("#copyAddr").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(S.unlock.PAY_TO); toast("Адрес скопирован"); }
      catch (e) { toast("Скопируйте адрес из блока выше"); }
    });

    $("#detailClose").addEventListener("click", closeDetail);
    $("#detailModalBg").addEventListener("click", e => { if (e.target === $("#detailModalBg")) closeDetail(); });

    $("#tgBtn").addEventListener("click", openTg);
    $("#tgClose").addEventListener("click", closeTg);
    $("#tgModalBg").addEventListener("click", e => { if (e.target === $("#tgModalBg")) closeTg(); });
    $("#tgMin").addEventListener("input", syncTgPreview);
    $("#tgCat").addEventListener("change", syncTgPreview);
    $("#tgChat").addEventListener("input", syncTgPreview);
    $("#tgSend").addEventListener("click", sendTg);
    $("#tgDownload").addEventListener("click", downloadTg);

    ["#calcStake", "#calcEntry", "#calcExit", "#calcFee"].forEach(sel =>
      $(sel).addEventListener("input", calc));
    ["#gAsk", "#gFloor", "#gQty", "#gFee"].forEach(sel =>
      $(sel).addEventListener("input", renderGiftCalc));

    $("#tabMarkets").addEventListener("click", () => setTab("markets"));
    $("#tabGifts").addEventListener("click", () => setTab("gifts"));

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      closeDetail(); closePro(); closeTg();
    });

    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (S.ts || 0) > 90000) loadMarkets(false); });
  }

  function init() {
    S.unlock = ProUnlock.create({ priceUnits: 14000000n, storageKey: "live-radar:pro" });
    S.pro = S.unlock.isPro();
    $("#payAddr").textContent = S.unlock.PAY_TO;

    renderGifts();
    calc();
    renderGiftCalc();
    bind();
    if (location.hash === "#gifts") setTab("gifts");

    loadMarkets(false);
    loadTon();
    setInterval(() => { if (!document.hidden) { loadMarkets(false); loadTon(); } }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
