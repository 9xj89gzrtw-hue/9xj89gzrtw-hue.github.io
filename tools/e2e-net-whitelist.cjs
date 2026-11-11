/* End-to-end check of /net-whitelist/ — the SNI white-list page.
 *
 * What a buyer must get, checked in a real browser against shipped files:
 *
 *   1. the page opens clean, renders the 25 demo domains and opens the pay modal;
 *   2. the free tester really measures the demo nodes from the browser
 *      (requests intercepted here, so the test is offline and deterministic);
 *   3. the local generator swaps in a new SNI without any network request;
 *   4. a TG Pro key with &pack=sni-whitelist&download=xlsx unlocks Pro,
 *      decrypts sni-pack.json.enc and downloads sni-whitelist-500-rf-nov2026.xlsx;
 *   5. a key for another product does NOT unlock the pack and downloads nothing.
 *
 *   node tools/e2e-net-whitelist.cjs [--shots <dir>]
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8824;
const AGENT_OUT = path.resolve(process.env.HOME, "gemini/agent1_out");
const KEYS = path.join(AGENT_OUT, "license_keys");
const shotsArg = process.argv.indexOf("--shots");
const SHOTS = shotsArg === -1 ? path.join(AGENT_OUT, "screenshots") : process.argv[shotsArg + 1];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".enc": "application/octet-stream"
};

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + extra : "")); }
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(ROOT, url);
    if (file.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "content-length": String(fs.statSync(file).size)
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(PORT, "127.0.0.1", () => r(server)));
}

function keysOf(product) {
  return fs.readFileSync(path.join(KEYS, product + ".txt"), "utf8").split("\n").filter(l => l.startsWith("TW1-"));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const BASE = "http://127.0.0.1:" + PORT;
  const TG_KEY = keysOf("tg-chats")[0];
  const NEWS_KEY = keysOf("newsflow")[0];

  /* ---------- 1: clean page, 25 demo rows, pay modal ---------- */
  console.log("\n1. страница и бесплатная выжимка");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    page.on("request", r => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    ok("HTTP 200 и без JS-ошибок", errors.length === 0, errors.join(" | ").slice(0, 300));

    const meta = await page.evaluate(() => window.SNI_META || {});
    ok("мета базы: 1 369 доменов", Number(meta.total) >= 500, JSON.stringify(meta.total));
    const rows = await page.$$eval("#tbl-body tr", els => els.length);
    ok("в таблице 25 демо-доменов", rows === 25, rows);
    const opts = await page.$$eval("#filter-cat option", els => els.map(e => e.textContent));
    ok("фильтр категорий собран из базы", opts.length > 3 && opts[0] === "Все", opts.join(","));
    ok("на загрузке нет внешних запросов", external.length === 0, external.slice(0, 3).join(" | "));

    await page.click('[data-unlock][data-product="sni-whitelist"]');
    const modal = await page.evaluate(() => {
      const m = document.querySelector(".modal-backdrop");
      return { present: !!m, visible: m ? !m.hidden : false, field: !!document.getElementById("unlock-hash") };
    });
    ok("модалка оплаты открылась", modal.visible && modal.field, JSON.stringify(modal));
    /* Лот Digiseller 6390371 (seller 1481449) открыт — кнопка СБП/Карты РФ
       обязана быть видимой, живой и вести на кассу за 99 ₽. */
    const card = await page.evaluate(() => {
      const el = document.getElementById("unlock-card");
      return {
        hidden: !!el.hidden,
        inFlow: el.offsetParent !== null,
        href: el.getAttribute("href") || "",
        label: (document.getElementById("unlock-card-label").textContent || "").trim()
      };
    });
    ok("кнопка карты РФ видна в модалке (!hidden, offsetParent ≠ null)",
      !card.hidden && card.inFlow, JSON.stringify(card));
    ok("кнопка карты РФ ведёт на живой лот SNI id_d=6390371",
      /id_d=6390371&ai=1481449&lang=ru-RU/.test(card.href), card.href);
    ok("в подписи кнопки цена 99 ₽ и ключ TW1 сразу", /99\s*₽/.test(card.label) && /TW1/i.test(card.label), card.label);
    ok("50 профилей спрятаны до оплаты", (await page.isVisible("#btn-batch").catch(() => false)) === false);
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-free.png") });
    await ctx.close();
  }

  /* ---------- 2: live tester, offline interception ---------- */
  console.log("\n2. живой тестер из браузера");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    let probed = 0;
    await page.route(/^https:\/\/[^/]+\/favicon\.ico\?snit=/, route => {
      probed++;
      const host = new URL(route.request().url()).host;
      /* first three answer instantly, the rest are slower, all answer */
      const delay = ["nalog.gov.ru", "mos.ru", "sberbank.ru"].includes(host) ? 5 : 120;
      setTimeout(() => route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }), delay);
    });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    await page.click("#run-tester");
    await page.waitForFunction(() => /Отвечают/.test(document.querySelector("#tester-status").textContent), null, { timeout: 15000 });
    const status = (await page.textContent("#tester-status")).trim();
    ok("тестер опросил все 25 доменов", probed === 25, probed);
    ok("отчёт: отвечают 25/25", /Отвечают\s*25\/25/.test(status.replace(/\s+/g, " ")), status.replace(/\s+/g, " ").slice(0, 120));
    const cells = await page.$$eval("#tbl-body tr", els => els.map(tr => tr.textContent));
    ok("в строках появились миллисекунды", cells.every(t => /\d+\s*ms|нет ответа/.test(t)) && cells.some(t => /\d+\s*ms/.test(t)));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-tester.png") });
    await ctx.close();
  }

  /* ---------- 3: local VLESS build with a new SNI, no network ---------- */
  console.log("\n3. генератор VLESS без сети (+ XHTTP ноября 2026)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", r => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) requests.push(r.url()); });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    const before = requests.length;
    await page.fill("#gen-input", "vless://11111111-2222-3333-4444-555555555555@edge.example.net:443?type=tcp&security=reality&pbk=pubkey123&sid=ab12#old-tag");
    await page.selectOption("#gen-sni", "sberbank.ru");
    await page.click("#gen-run");
    const link = (await page.textContent("#out-link")).trim();
    ok("ссылка собрана", /^vless:\/\/11111111-2222-3333-4444-555555555555@edge\.example\.net:443\?/.test(link), link.slice(0, 90));
    ok("SNI подставлен: sni=sberbank.ru", /[?&]sni=sberbank\.ru(&|$)/.test(link), link);
    ok("host совпадает с SNI", /[?&]host=sberbank\.ru(&|$)/.test(link), link);
    ok("Reality-ключ и fp сохранены", /pbk=pubkey123/.test(link) && /fp=chrome/.test(link) && /security=reality/.test(link), link);
    ok("новый тег = SNI", /#sberbank\.ru-tlsv13-h2$/.test(link), link);
    ok("QR и файл появились", await page.isVisible("#qr-holder svg") && await page.isVisible("#dl-link"));
    ok("генератор не ходил в сеть", requests.length === before, requests.slice(0, 3).join(" | "));

    /* XHTTP (SplitHTTP) + Reality — режим ноября 2026: валидный URI и JSON-конфиги. */
    await page.selectOption("#gen-transport", "xhttp");
    await page.click("#gen-run");
    const xlink = (await page.textContent("#out-link")).trim();
    ok("XHTTP: type=xhttp&mode=auto&path=%2F в URI",
      /[?&]type=xhttp(&|#|$)/.test(xlink) && /[?&]mode=auto(&|#|$)/.test(xlink) && /[?&]path=%2F(&|#|$)/.test(xlink), xlink);
    ok("XHTTP: reality + sni + fp на месте",
      /[?&]security=reality(&|#|$)/.test(xlink) && /[?&]sni=sberbank\.ru(&|#|$)/.test(xlink) && /[?&]fp=chrome(&|#|$)/.test(xlink), xlink);
    ok("XHTTP: тег профиля помечен xhttp", /#sberbank\.ru-xhttp-auto$/.test(xlink), xlink);

    await page.click('[data-tab="singbox"]');
    const sb = JSON.parse(await page.textContent("#gen-out pre.out"));
    const ob = sb.outbounds[0];
    ok("XHTTP: Sing-Box outbound с транспортом xhttp",
      ob.transport && ob.transport.type === "xhttp" && ob.transport.mode === "auto" && ob.transport.path === "/" && ob.transport.host === "sberbank.ru",
      JSON.stringify(ob.transport));
    ok("XHTTP: flow пуст, Reality и SNI в tls-блоке",
      ob.flow === "" && ob.tls.server_name === "sberbank.ru" && ob.tls.reality.public_key === "pubkey123",
      JSON.stringify({ flow: ob.flow, sni: ob.tls.server_name }));

    await page.click('[data-tab="xui"]');
    const inbound = JSON.parse(await page.textContent("#gen-out pre.out"));
    ok("XHTTP: 3x-ui inbound — vless на xhttp с Reality",
      inbound.protocol === "vless" && inbound.streamSettings.network === "xhttp" && inbound.streamSettings.security === "reality",
      JSON.stringify({ protocol: inbound.protocol, network: inbound.streamSettings.network }));
    ok("XHTTP: 3x-ui inbound — serverNames и shortIds из ключа клиента",
      inbound.streamSettings.realitySettings.serverNames[0] === "sberbank.ru" &&
      inbound.streamSettings.realitySettings.shortIds.includes("ab12") &&
      inbound.streamSettings.xhttpSettings.path === "/" && inbound.streamSettings.xhttpSettings.mode === "auto",
      JSON.stringify(inbound.streamSettings.realitySettings.serverNames));

    /* Классический TCP тоже остаётся рабочим: переключение туда-обратно не ломает сборку. */
    await page.click('[data-tab="vless"]');
    await page.selectOption("#gen-transport", "tcp");
    await page.click("#gen-run");
    const backLink = (await page.textContent("#out-link")).trim();
    ok("TCP: переключение назад даёт классический Reality-URI",
      /[?&]type=tcp(&|#|$)/.test(backLink) && /#sberbank\.ru-tlsv13-h2$/.test(backLink), backLink);
    await page.click('[data-tab="xui"]');
    const tcpInbound = JSON.parse(await page.textContent("#gen-out pre.out"));
    ok("TCP: 3x-ui inbound тоже собирается",
      tcpInbound.streamSettings.network === "tcp" && tcpInbound.streamSettings.tcpSettings && tcpInbound.streamSettings.realitySettings.serverNames[0] === "sberbank.ru",
      JSON.stringify(tcpInbound.streamSettings.network));
    ok("в XHTTP-режиме генератор не ходил в сеть", requests.length === before, requests.slice(0, 3).join(" | "));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-generator.png") });
    await ctx.close();
  }

  /* ---------- 3b: gRPC fallback + one-click "Скопировать JSON Inbound 3x-ui" ---------- */
  console.log("\n3b. gRPC-фолбэк и кнопка «Скопировать JSON Inbound для 3x-ui»");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU" });
    const page = await ctx.newPage();
    /* Capture what the button puts on the clipboard: the real code path is
       navigator.clipboard.writeText, we only record the payload. */
    await page.addInitScript(() => {
      window.__copied = null;
      const grab = (t) => { window.__copied = String(t); return Promise.resolve(); };
      try {
        if (navigator.clipboard) navigator.clipboard.writeText = grab;
        else Object.defineProperty(navigator, "clipboard", { value: { writeText: grab }, configurable: true });
      } catch (e) {
        Object.defineProperty(navigator, "clipboard", { value: { writeText: grab }, configurable: true });
      }
    });
    await page.goto(`${BASE}/net-whitelist/index.html`, { waitUntil: "load" });
    await page.fill("#gen-input", "vless://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@vps.example.com:8443?type=tcp&security=reality&pbk=PBKX&sid=9f9f#src");
    await page.selectOption("#gen-sni", "mos.ru");

    /* gRPC + Reality: третий транспорт, без flow */
    await page.selectOption("#gen-transport", "grpc");
    await page.click("#gen-run");
    const glink = (await page.textContent("#out-link")).trim();
    ok("gRPC: type=grpc + security=reality + sni", /[?&]type=grpc(&|#|$)/.test(glink) && /[?&]security=reality(&|#|$)/.test(glink) && /[?&]sni=mos\.ru(&|#|$)/.test(glink), glink);
    ok("gRPC: serviceName=grpc & mode=gun", /[?&]serviceName=grpc(&|#|$)/.test(glink) && /[?&]mode=gun(&|#|$)/.test(glink), glink);
    ok("gRPC: без flow и с тегом grpc-reality", !/[?&]flow=/.test(glink) && /#mos\.ru-grpc-reality$/.test(glink), glink);
    ok("gRPC: порт покупателя сохранён (:8443)", glink.indexOf("@vps.example.com:8443?") > 0, glink.slice(0, 80));

    /* Кнопка копирования: xhttp-инбаунд со всеми полями для 3x-ui */
    await page.selectOption("#gen-transport", "xhttp");
    await page.click("#btn-xui-json");
    await page.waitForFunction(() => !!window.__copied, null, { timeout: 5000 });
    let inbound = null;
    try { inbound = JSON.parse(await page.evaluate(() => window.__copied)); } catch (e) { inbound = null; }
    ok("кнопка положила в буфер валидный JSON", !!inbound, String(await page.evaluate(() => window.__copied)).slice(0, 100));
    const st = (inbound || {}).streamSettings || {};
    const rs = st.realitySettings || {};
    ok("3x-ui JSON: protocol vless, network xhttp, security reality",
      inbound && inbound.protocol === "vless" && st.network === "xhttp" && st.security === "reality", JSON.stringify({ n: st.network, s: st.security }));
    ok("3x-ui JSON: dest = mos.ru:8443", rs.dest === "mos.ru:8443", rs.dest);
    ok("3x-ui JSON: serverNames = [mos.ru]", Array.isArray(rs.serverNames) && rs.serverNames.length === 1 && rs.serverNames[0] === "mos.ru", JSON.stringify(rs.serverNames));
    ok("3x-ui JSON: xhttpSettings path=/ mode=auto host=mos.ru",
      !!st.xhttpSettings && st.xhttpSettings.path === "/" && st.xhttpSettings.mode === "auto" && st.xhttpSettings.host === "mos.ru", JSON.stringify(st.xhttpSettings));
    ok("3x-ui JSON: uuid клиента совпадает с ключом", inbound.settings.clients[0].id === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", inbound.settings.clients[0].id);
    ok("3x-ui JSON: flow пуст для xhttp", inbound.settings.clients[0].flow === "", inbound.settings.clients[0].flow);
    ok("3x-ui JSON: privateKey — плейсхолдер панели", /xray x25519/.test(rs.privateKey), rs.privateKey);
    ok("3x-ui JSON: publicKey/fingerprint из ключа клиента", rs.settings && rs.settings.publicKey === "PBKX" && rs.settings.fingerprint === "chrome", JSON.stringify(rs.settings));
    ok("вкладка 3x-ui открылась с тем же inbound", /"network": "xhttp"/.test(await page.textContent("#out-xui")));

    /* TCP-вариант той же кнопкой: Vision + tcpSettings */
    await page.selectOption("#gen-transport", "tcp");
    await page.evaluate(() => { window.__copied = null; });
    await page.click("#btn-xui-json");
    await page.waitForFunction(() => !!window.__copied, null, { timeout: 5000 });
    const tcpIn = JSON.parse(await page.evaluate(() => window.__copied));
    ok("3x-ui JSON TCP: flow=xtls-rprx-vision + tcpSettings",
      tcpIn.settings.clients[0].flow === "xtls-rprx-vision" && !!tcpIn.streamSettings.tcpSettings && !tcpIn.streamSettings.xhttpSettings,
      JSON.stringify(tcpIn.settings.clients[0].flow));
    ok("3x-ui JSON TCP: dest указывает на выбранный SNI", tcpIn.streamSettings.realitySettings.dest === "mos.ru:8443", tcpIn.streamSettings.realitySettings.dest);
    await ctx.close();
  }

  /* ---------- 4: TG key + pack=sni-whitelist&download=xlsx ---------- */
  console.log("\n4. чек-ссылка открывает Pro и качает Excel");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.goto(`${BASE}/net-whitelist/index.html?key=${encodeURIComponent(TG_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    const download = await downloadPromise;
    ok("файл называется sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename() === "sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename());
    const state = await page.evaluate(() => ({
      pro: window.Unlock.isPro("sni-whitelist"),
      loaded: window.SNIPack.isLoaded()
    }));
    ok("ключ TW1-TG открыл SNI Pro", state.pro === true, JSON.stringify(state));
    ok("пакет расшифрован в браузере", state.loaded === true, JSON.stringify(state));
    const pack = await page.evaluate(() => window.SNIPack.get());
    const total = pack ? pack.total || (pack.domains || []).length : 0;
    ok("в расшифрованном пакете ≥ 500 доменов", total >= 500, total);
    const status = (await page.textContent("#pro-status")).trim();
    ok("на странице подтверждение Pro", /открыта|открыт/i.test(status), status.slice(0, 100));
    ok("без JS-ошибок на чек-ссылке", errors.length === 0, errors.join(" | ").slice(0, 300));

    /* 100 reserve profiles: one buyer key, 50 different white SNI, each in
       both transports — 50 classic TCP+Vision and 50 XHTTP (Nov 2026). */
    await page.fill("#gen-input", "vless://99999999-8888-7777-6666-555555555555@edge.example.org:443?type=tcp&security=reality&pbk=pubkey999&sid=cd34#src");
    const batchPromise = page.waitForEvent("download", { timeout: 20000 });
    await page.click("#btn-batch");
    const batch = await batchPromise;
    ok("файл 100 резервных профилей (50 SNI × 2 транспорта)", batch.suggestedFilename() === "sni-whitelist-100-reserve-profiles-nov2026.txt", batch.suggestedFilename());
    const batchPath = await batch.path();
    const batchBody = fs.readFileSync(batchPath, "utf8");
    const links = batchBody.split("\n").filter(l => l.startsWith("vless://"));
    ok("в файле ровно 100 vless-ссылок", links.length === 100, links.length);
    ok("50 уникальных SNI (каждый в двух транспортах)",
      new Set(links.map(l => (l.match(/[?&]sni=([^&]+)/) || [])[1])).size === 50,
      "уникальных: " + new Set(links.map(l => (l.match(/[?&]sni=([^&]+)/) || [])[1])).size);
    ok("50 TCP + 50 XHTTP в одном файле",
      links.filter(l => /[?&]type=tcp(&|#|$)/.test(l)).length === 50 &&
      links.filter(l => /[?&]type=xhttp(&|#|$)/.test(l)).length === 50,
      "tcp: " + links.filter(l => /[?&]type=tcp(&|#|$)/.test(l)).length + ", xhttp: " + links.filter(l => /[?&]type=xhttp(&|#|$)/.test(l)).length);
    ok("сервер покупателя сохранён", links.every(l => l.includes("@edge.example.org:443")), links[0].slice(0, 80));
    await page.screenshot({ path: path.join(SHOTS, "net-whitelist-pro.png") });
    await ctx.close();
  }

  /* ---------- 5: foreign key is refused, nothing downloads ---------- */
  console.log("\n5. чужой ключ не открывает базу");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    let downloaded = false;
    page.on("download", () => { downloaded = true; });
    await page.goto(`${BASE}/net-whitelist/index.html?key=${encodeURIComponent(NEWS_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    await page.waitForTimeout(1800);
    const state = await page.evaluate(() => ({
      pro: window.Unlock.isPro("sni-whitelist"),
      loaded: window.SNIPack.isLoaded()
    }));
    ok("ключ NEWSF не открыл SNI Pro", state.pro === false, JSON.stringify(state));
    ok("пакет остался зашифрован", state.loaded === false, JSON.stringify(state));
    ok("скачивания не было", downloaded === false);
    await ctx.close();
  }

  /* ---------- 6: the same pack is the 5th quick pack on /tg-chats/ ---------- */
  console.log("\n6. tg-chats: пятый быстрый пак (SNI) отдаёт тот же Excel");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2, locale: "ru-RU", acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message)));
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.goto(`${BASE}/tg-chats/index.html?key=${encodeURIComponent(TG_KEY)}&pack=sni-whitelist&download=xlsx`, { waitUntil: "load" });
    const download = await downloadPromise;
    ok("tg-chats скачал sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename() === "sni-whitelist-500-rf-nov2026.xlsx", download.suggestedFilename());
    const state = await page.evaluate(() => ({
      pro: !!(window.Unlock && window.Unlock.isPro("tgchats")),
      loaded: !!(window.ChatPack && window.ChatPack.isSNILoaded()),
      has: !!(window.ChatPack && window.ChatPack.ensureSNI)
    }));
    ok("SNI-пакет в tg-chats расшифрован", state.pro && state.loaded && state.has, JSON.stringify(state));
    ok("без JS-ошибок на чек-ссылке tg-chats", errors.length === 0, errors.join(" | ").slice(0, 300));

    /* 5-й быстрый пак в каталоге — SNI-база за 99 ₽ на живом лоте 6390371. */
    const packs = await page.$$eval("#view-base .pack-btn", els => els.map(e => ({
      href: e.getAttribute("href") || "", text: e.textContent.replace(/\s+/g, " ").trim()
    })));
    ok("tg-chats: в блоке быстрых пакетов 5 карточек", packs.length === 5, packs.length);
    ok("tg-chats: 5-й пак «Белые Списки SNI LTE РФ» ведёт на лот 6390371",
      packs.length === 5 && /id_d=6390371&ai=1481449/.test(packs[4].href), JSON.stringify(packs[4]));
    ok("tg-chats: 5-й пак — SNI, 1 384 домена, 99 ₽",
      packs.length === 5 && /SNI/i.test(packs[4].text) && /1\s?384/.test(packs[4].text) && /99\s*₽/.test(packs[4].text),
      JSON.stringify(packs[4]));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " ok, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
